-- Migration 109: licença = 1 clube (teto aplicado no servidor) + teste gratuito gerenciado pelo /admin.
begin;
\ir _lib.sql
\ir _fixtures.sql

\o /dev/null
select t.signup('admin73', '{"tipo":"fundador","nome":"Admin 73"}'::jsonb);
insert into public.platform_admins (user_id, papel, motivo) values (t.id('admin73'), 'operacao', 'teste 73');
insert into public.billing_accounts (id, nome, status) values (public.curriculo_uuid('t73:conta'), 'Conta 73 [TESTE]', 'ativa');
insert into public.subscriptions (id, billing_account_id, plan_id, status, ciclo, trial_ate)
select public.curriculo_uuid('t73:assin'), public.curriculo_uuid('t73:conta'), p.id, 'trial', 'anual', now() + interval '3 days'
  from public.billing_plans p where p.chave = 'anual' order by p.versao desc limit 1;
insert into t.ids (chave, id) values ('assin73', public.curriculo_uuid('t73:assin'));
insert into public.subscription_clubs (subscription_id, club_id) values (t.id('assin73'), t.id('clube_b'));
\o

-- ==================== 1) teto de clubes ====================
select t.eq('Licença Anual: teto de clubes = 1',
  t.txt($q$select limites ->> 'clubes' from public.billing_plans where chave = 'anual' order by versao desc limit 1$q$), '1');
select t.eq('nenhum plano com teto de clubes acima de 1',
  t.n($q$select count(*) from public.billing_plans where (limites ->> 'clubes') ~ '^\d+$' and (limites ->> 'clubes')::int > 1$q$), 0);
select t.eq('...e só a chave "clubes" mudou (membros da Licença Anual continua 300)',
  t.txt($q$select limites ->> 'membros' from public.billing_plans where chave = 'anual' and versao = 1$q$), '300');
select t.ok('plano legado-fundador continua sem teto de clubes',
  not exists (select 1 from public.billing_plans where chave = 'legado-fundador' and limites ? 'clubes'));
select t.throws('2º clube na mesma licença é recusado no servidor',
  format($q$insert into public.subscription_clubs (subscription_id, club_id) values (%L, %L)$q$, t.id('assin73'), t.id('clube_a')),
  'Limite de clubes');
\o /dev/null
insert into public.subscriptions (id, billing_account_id, plan_id, status, ciclo)
select public.curriculo_uuid('t73:assin-velha'), public.curriculo_uuid('t73:conta'), plan_id, 'cancelada', 'anual'
  from public.subscriptions where id = t.id('assin73');
insert into public.subscription_clubs (subscription_id, club_id) values (public.curriculo_uuid('t73:assin-velha'), t.id('clube_a'));
\o
select t.throws('...nem movendo um clube de outra licença pra ela',
  format($q$update public.subscription_clubs set subscription_id = %L where club_id = %L$q$, t.id('assin73'), t.id('clube_a')),
  'Limite de clubes');
\o /dev/null
delete from public.subscription_clubs where club_id = t.id('clube_a');
\o
select t.eq('limites_do_clube mostra 1 / 1',
  t.txt(format($q$select (public.limites_do_clube(%1$L) -> 'clubes' ->> 'limite') || '/' || (public.limites_do_clube(%1$L) -> 'clubes' ->> 'uso')$q$, t.id('clube_b'))), '1/1');

-- ==================== 2) só admin da plataforma gerencia o teste ====================
select t.como('lider_a');
select t.throws('diretoria: admin_trial_estender recusada', format('select public.admin_trial_estender(%L, 7)', t.id('clube_b')), 'Sem permissão');
select t.throws('diretoria: admin_trial_encerrar recusada', format('select public.admin_trial_encerrar(%L)', t.id('clube_b')), 'Sem permissão');
select t.throws('diretoria: admin_trial_padrao_definir recusada', 'select public.admin_trial_padrao_definir(10)', 'Sem permissão');
select t.throws('diretoria: admin_trial_padrao recusada', 'select public.admin_trial_padrao()', 'Sem permissão');
reset role;
select t.eq('anon sem EXECUTE nas RPCs de teste gratuito',
  t.n($q$select count(*) from unnest(array['admin_trial_padrao()','admin_trial_padrao_definir(int, text)',
          'admin_trial_estender(uuid, int, timestamptz, text)','admin_trial_encerrar(uuid, text)']) f
         where has_function_privilege('anon', 'public.' || f, 'execute')$q$), 0);

-- ==================== 3) estender ====================
select set_config('t73.antes', (select trial_ate::text from public.subscriptions where id = t.id('assin73')), true) is not null;
select t.como('admin73');
select t.permitido('admin: +7 dias', format('select public.admin_trial_estender(%L, 7, null, %L)', t.id('clube_b'), 'cliente pediu'));
reset role;
select t.ok('+7 dias somados ao fim atual do teste',
  (select abs(extract(epoch from (trial_ate - (current_setting('t73.antes')::timestamptz + interval '7 days')))) < 1
     from public.subscriptions where id = t.id('assin73')));
select t.ok('auditoria registrada', exists (select 1 from public.platform_admin_audit where acao = 'trial_estender' and alvo_id = t.id('clube_b')));
select t.ok('evento da assinatura com origem admin', exists (select 1 from public.subscription_events
  where subscription_id = t.id('assin73') and origem = 'admin' and motivo = 'cliente pediu'));
select t.eq('nenhuma cobrança foi criada', t.n(format($q$select count(*) from public.billing_invoices where subscription_id = %L$q$, t.id('assin73'))), 0);
select t.como('admin73');
select t.permitido('admin: data escolhida', format('select public.admin_trial_estender(%L, null, %L)', t.id('clube_b'), (now() + interval '40 days')::text));
select t.throws('admin: data no passado recusada', format('select public.admin_trial_estender(%L, null, %L)', t.id('clube_b'), (now() - interval '1 day')::text), 'futuro');
select t.throws('admin: dias E data juntos recusados', format('select public.admin_trial_estender(%L, 7, %L)', t.id('clube_b'), now()::text), 'um dos dois');
select t.throws('admin: clube sem assinatura dá erro claro', format('select public.admin_trial_estender(%L, 7)', t.id('clube_a')), 'não tem assinatura');

-- ==================== 4) encerrar e reabrir ====================
select t.permitido('admin: encerra o teste', format('select public.admin_trial_encerrar(%L, %L)', t.id('clube_b'), 'fim combinado'));
reset role;
select t.eq('encerrado: aguardando pagamento', t.txt(format($q$select status from public.subscriptions where id = %L$q$, t.id('assin73'))), 'pagamento_pendente');
select t.ok('...e trial_ate não está mais no futuro', (select trial_ate <= now() from public.subscriptions where id = t.id('assin73')));
select t.eq('...sem criar cobrança', t.n(format($q$select count(*) from public.billing_invoices where subscription_id = %L$q$, t.id('assin73'))), 0);
select t.como('admin73');
select t.throws('encerrar de novo: não está em teste', format('select public.admin_trial_encerrar(%L)', t.id('clube_b')), 'não está em teste');
select t.permitido('reabrir o teste por +15 dias', format('select public.admin_trial_estender(%L, 15)', t.id('clube_b')));
reset role;
select t.eq('reaberto: volta a trial', t.txt(format($q$select status from public.subscriptions where id = %L$q$, t.id('assin73'))), 'trial');
update public.subscriptions set status = 'ativa' where id = t.id('assin73');
select t.como('admin73');
select t.throws('assinatura ativa (paga) não vira teste', format('select public.admin_trial_estender(%L, 7)', t.id('clube_b')), 'situação atual: ativa');

-- ==================== 5) padrão de dias para clubes novos ====================
select t.permitido('admin lê o padrão', 'select public.admin_trial_padrao()');
select set_config('t73.versao', (public.admin_trial_padrao() ->> 'politica_versao'), true) is not null;
select t.permitido('admin define 14 dias', 'select public.admin_trial_padrao_definir(14)');
select t.eq('padrão agora é 14', t.txt($q$select public.admin_trial_padrao() ->> 'trial_dias'$q$), '14');
select t.throws('padrão negativo recusado', 'select public.admin_trial_padrao_definir(-1)', 'inválidos');
reset role;
select t.eq('política versionada: nova versão publicada', t.txt($q$select (versao)::text from public.politica_comercial()$q$),
  ((coalesce(nullif(current_setting('t73.versao'), ''), '0'))::int + 1)::text);
select t.eq('...e só UMA política ativa', t.n($q$select count(*) from public.billing_policies where ativo and chave = (select chave from public.politica_comercial())$q$), 1);
select t.ok('auditoria do padrão', exists (select 1 from public.platform_admin_audit where acao = 'trial_padrao_definir'));

select * from t.fim();
rollback;
