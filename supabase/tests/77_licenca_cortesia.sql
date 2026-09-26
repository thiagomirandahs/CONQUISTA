-- Migration 150: licença cortesia (sorteio/promoção) — códigos do admin, resgate no onboarding,
-- aplicação direta pelo admin, expiração de volta ao fluxo normal, e nenhuma cobrança criada.
begin;
\ir _lib.sql
\ir _fixtures.sql

\o /dev/null
select t.signup('admin77', '{"tipo":"fundador","nome":"Admin 77"}'::jsonb);
select t.signup('ganhador77', '{"tipo":"fundador","nome":"Ganhador 77"}'::jsonb);
select t.signup('outro77', '{"tipo":"fundador","nome":"Outro 77"}'::jsonb);
insert into public.platform_admins (user_id, papel, motivo) values (t.id('admin77'), 'operacao', 'teste 77');
create temp table t77 (chave text primary key, valor text);
grant all on t77 to authenticated;
\o

-- ==================== 1) só admin da plataforma ====================
select t.como('lider_a');
select t.throws('diretoria: gerar código recusado', $q$select public.admin_cortesia_gerar('x')$q$, 'Sem permissão');
select t.throws('diretoria: listar recusado', 'select public.admin_cortesias_listar()', 'Sem permissão');
select t.throws('diretoria: aplicar recusado', format('select public.admin_cortesia_aplicar(%L)', t.id('clube_b')), 'Sem permissão');
reset role;
select t.eq('anon sem EXECUTE em nenhuma RPC de cortesia',
  t.n($q$select count(*) from unnest(array['admin_cortesia_gerar(text, int, int, int)','admin_cortesias_listar()',
          'admin_cortesia_revogar(uuid, text)','admin_cortesia_apagar(uuid)','admin_cortesia_aplicar(uuid, int, text)',
          'onboarding_cortesia_resgatar(text)','cortesias_expirar()']) f
         where has_function_privilege('anon', 'public.' || f, 'execute')$q$), 0);
select t.ok('authenticated não roda a expiração', not has_function_privilege('authenticated', 'public.cortesias_expirar()', 'execute'));
select t.ok('tabelas de cortesia sem acesso direto', not has_table_privilege('authenticated', 'public.courtesy_codes', 'select'));

-- ==================== 2) gerar ====================
select t.como('admin77');
insert into t77 select 'cod', public.admin_cortesia_gerar('Sorteio outubro 2026') ->> 'codigo';
insert into t77 select 'cod2', public.admin_cortesia_gerar('Revogável', 12, 1, 30) ->> 'codigo';
select t.throws('usos acima do teto recusado', $q$select public.admin_cortesia_gerar('x', 12, 9999)$q$, 'usos');
reset role;
select t.ok('código tem o formato DC-XXXX-XXXX-XXXX-XXXX', (select valor from t77 where chave = 'cod') ~ '^DC-[0-9A-F]{4}(-[0-9A-F]{4}){3}$');
select t.eq('padrões: 12 meses, 1 uso',
  t.txt($q$select duracao_meses || '/' || max_usos from public.courtesy_codes where rotulo = 'Sorteio outubro 2026'$q$), '12/1');
select t.eq('o código em claro não fica no banco',
  t.n($q$select count(*) from public.courtesy_codes c, t77 where c.codigo_hash = t77.valor or c.prefixo = t77.valor$q$), 0);
select t.ok('auditoria da geração', exists (select 1 from public.platform_admin_audit where acao = 'cortesia_gerar'));

-- ==================== 3) resgate no onboarding ====================
select t.como('ganhador77');
select t.throws('sem onboarding: recusado', $q$select public.onboarding_cortesia_resgatar('DC-0000')$q$, 'Nenhum cadastro');
select public.onboarding_iniciar() is not null;
select t.permitido('conta', $q$select public.onboarding_etapa('conta', '{"nome":"Ganhador"}'::jsonb)$q$);
select t.throws('antes do clube: recusado', $q$select public.onboarding_cortesia_resgatar('DC-0000')$q$, 'Crie o clube');
select t.permitido('dados', $q$select public.onboarding_etapa('dados_basicos', '{}'::jsonb)$q$);
select t.permitido('clube', $q$select public.onboarding_etapa('clube', '{"nome":"Clube do Sorteio 77","plano":"anual"}'::jsonb)$q$);
select t.eq('código errado: ok=false, mensagem genérica',
  t.txt($q$select public.onboarding_cortesia_resgatar('DC-FFFF-FFFF-FFFF-FFFF') ->> 'erro'$q$),
  'Código de cortesia inválido, expirado ou já utilizado.');
select t.eq('resgate válido (minúsculas e sem hífen também valem)',
  t.txt($q$select public.onboarding_cortesia_resgatar(lower(replace((select valor from t77 where chave = 'cod'), '-', ''))) ->> 'ok'$q$), 'true');
select t.throws('segundo código no mesmo clube recusado',
  $q$select public.onboarding_cortesia_resgatar((select valor from t77 where chave = 'cod2'))$q$, 'já está com licença cortesia');
reset role;
insert into t77 select 'sub', subscription_id::text from public.onboarding_sessions where user_id = t.id('ganhador77');
select t.eq('assinatura ATIVA, provider cortesia',
  t.txt($q$select status || '/' || provider from public.subscriptions where id = (select valor::uuid from t77 where chave = 'sub')$q$), 'ativa/cortesia');
select t.ok('fim = agora + 12 meses',
  (select abs(extract(epoch from periodo_fim - (now() + interval '12 months'))) < 5 from public.subscriptions where id = (select valor::uuid from t77 where chave = 'sub')));
select t.eq('valor 0 marcado', t.txt($q$select metadata -> 'cortesia' ->> 'valor_centavos' from public.subscriptions where id = (select valor::uuid from t77 where chave = 'sub')$q$), '0');
select t.eq('nenhuma cobrança criada', t.n($q$select count(*) from public.billing_invoices where subscription_id = (select valor::uuid from t77 where chave = 'sub')$q$), 0);
select t.eq('nenhum evento de pagamento', t.n($q$select count(*) from public.billing_events where subscription_id = (select valor::uuid from t77 where chave = 'sub')$q$), 0);
select t.ok('evento trial -> ativa no histórico', exists (select 1 from public.subscription_events
  where subscription_id = (select valor::uuid from t77 where chave = 'sub') and de = 'trial' and para = 'ativa' and (detalhe ->> 'cortesia')::boolean));
select t.ok('auditoria do resgate', exists (select 1 from public.platform_admin_audit where acao = 'cortesia_resgatar'));
select t.eq('código consumido (1/1)', t.txt($q$select usos || '/' || max_usos from public.courtesy_codes where rotulo = 'Sorteio outubro 2026'$q$), '1/1');
select t.eq('assinatura_avaliar não volta pra trial', t.txt($q$select public.assinatura_avaliar((select valor::uuid from t77 where chave = 'sub'))$q$), 'ativa');

-- um código não passa dos usos: outro fundador tenta o mesmo código
select t.como('outro77');
select public.onboarding_iniciar() is not null;
select public.onboarding_etapa('conta', '{"nome":"Outro"}'::jsonb) is not null;
select public.onboarding_etapa('dados_basicos', '{}'::jsonb) is not null;
select public.onboarding_etapa('clube', '{"nome":"Clube Outro 77","plano":"anual"}'::jsonb) is not null;
select t.eq('código já usado: recusado',
  t.txt($q$select public.onboarding_cortesia_resgatar((select valor from t77 where chave = 'cod')) ->> 'ok'$q$), 'false');
-- rate limit: 10 erros em 10 minutos fecham a porta
select count(*) from generate_series(1, 9) g, lateral (select public.onboarding_cortesia_resgatar('DC-ERRADO' || g)) x;
select t.throws('rate limit após 10 erros', $q$select public.onboarding_cortesia_resgatar('DC-0')$q$, 'Muitas tentativas');
reset role;
select t.ok('check estrutural: usos nunca passam de max_usos',
  not exists (select 1 from public.courtesy_codes where usos > max_usos));

-- ==================== 4) revogar / apagar ====================
insert into t77 select 'id_rev', id::text from public.courtesy_codes where rotulo = 'Revogável';
insert into t77 select 'id_sort', id::text from public.courtesy_codes where rotulo = 'Sorteio outubro 2026';
insert into t77 select 'sub_outro', subscription_id::text from public.onboarding_sessions where user_id = t.id('outro77');
insert into t77 select 'club_outro', club_id::text from public.onboarding_sessions where user_id = t.id('outro77');
select t.como('admin77');
select t.throws('apagar código ativo recusado',
  $q$select public.admin_cortesia_apagar((select valor::uuid from t77 where chave = 'id_rev'))$q$, 'revogue');
select t.permitido('revogar', $q$select public.admin_cortesia_revogar((select valor::uuid from t77 where chave = 'id_rev'), 'teste')$q$);
select t.eq('lista mostra revogado e resgatado',
  t.txt($q$select string_agg(x ->> 'status', ',' order by x ->> 'status') from json_array_elements(public.admin_cortesias_listar()) x$q$),
  'resgatado,revogado');
select t.permitido('apagar revogado', $q$select public.admin_cortesia_apagar((select valor::uuid from t77 where chave = 'id_rev'))$q$);
select t.permitido('apagar resgatado (histórico fica)', $q$select public.admin_cortesia_apagar((select valor::uuid from t77 where chave = 'id_sort'))$q$);
reset role;
select t.eq('histórico da cortesia sobrevive ao código apagado',
  t.n($q$select count(*) from public.courtesy_grants where subscription_id = (select valor::uuid from t77 where chave = 'sub')$q$), 1);

-- ==================== 5) admin aplica a clube existente; Tenant 001 recusado ====================
select t.como('admin77');
select t.throws('Tenant 001 recusado', format('select public.admin_cortesia_aplicar(%L)', t.id('clube_a')), 'assinatura viva');
select t.permitido('admin aplica cortesia ao clube em teste',
  $q$select public.admin_cortesia_aplicar((select valor::uuid from t77 where chave = 'club_outro'), 12, 'ganhador do sorteio')$q$);
reset role;
select t.eq('clube do admin: ativa/cortesia',
  t.txt($q$select status || '/' || provider from public.subscriptions where id = (select valor::uuid from t77 where chave = 'sub_outro')$q$), 'ativa/cortesia');
select t.ok('auditoria da aplicação', exists (select 1 from public.platform_admin_audit where acao = 'cortesia_aplicar'));

-- ==================== 6) Plano do clube mostra a cortesia ====================
\o /dev/null
insert into public.organization_memberships (user_id, organizational_unit_id, role, status)
select t.id('ganhador77'), club_id, 'diretoria', 'ativo' from public.onboarding_sessions where user_id = t.id('ganhador77')
on conflict do nothing;
\o
select t.como('ganhador77');
select t.pedir_clube((select club_id from public.onboarding_sessions where user_id = auth.uid()));
select t.ok('assinatura_do_clube traz cortesia.ate',
  (public.assinatura_do_clube() -> 'cortesia' ->> 'ate') is not null);
reset role;

-- ==================== 7) fim da cortesia -> aguardando pagamento ====================
update public.subscriptions set periodo_fim = now() - interval '1 minute' where id = (select valor::uuid from t77 where chave = 'sub');
select t.eq('expirar pega a cortesia vencida', public.cortesias_expirar(), 1);
select t.eq('volta ao fluxo normal: pagamento_pendente/mock',
  t.txt($q$select status || '/' || provider from public.subscriptions where id = (select valor::uuid from t77 where chave = 'sub')$q$), 'pagamento_pendente/mock');
select t.eq('rodar de novo não faz nada', public.cortesias_expirar(), 0);
select t.ok('job diário agendado', exists (select 1 from cron.job where jobname = 'expirar-cortesias'));

-- ==================== 8) nada de clube real mexido ====================
select t.eq('Tenant 001 sem cortesia', t.n($q$select count(*) from public.courtesy_grants g join public.organizational_units u on u.id = g.club_id
  where u.slug = 'filhos-da-conquista' or u.nome ilike 'exército da colina'$q$), 0);

select * from t.fim();
rollback;
