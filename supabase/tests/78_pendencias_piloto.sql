-- Migrations 170–173: pendências do piloto — nascimento editável, cancelar matrícula em classe,
-- teste gratuito que expira sozinho e limpeza de foto órfã de comprovação.
begin;
\ir _lib.sql
\ir _curriculo_regular_2026.sql
\ir _fixtures.sql
insert into public.club_features (club_id, feature, enabled) values (t.id('clube_a'), 'classes', true), (t.id('clube_b'), 'classes', true)
on conflict (club_id, feature) do update set enabled = true;
create function t.classe(p_versao text, p_codigo text) returns uuid language sql stable security definer as $$
  select public.curriculo_uuid('class:' || p_versao || ':' || p_codigo) $$;
create temp table t78 (chave text primary key, valor text);
grant all on t78 to authenticated;

-- ==================== 1) nascimento ====================
select t.como('membro_a');
select t.bloqueado('UPDATE direto do próprio nascimento não passa mais (só pela RPC)',
  format($q$update public.profiles set nascimento = '2015-01-01' where id = %L$q$, t.id('membro_a')));
select t.throws('futuro recusado', format($q$select public.nascimento_definir(%L, current_date + 1)$q$, t.id('membro_a')), 'futuro');
select t.throws('absurdo recusado (mais de 100 anos)', format($q$select public.nascimento_definir(%L, '1900-01-01')$q$, t.id('membro_a')), 'confira o ano');
select t.throws('nulo recusado', format($q$select public.nascimento_definir(%L, null)$q$, t.id('membro_a')), 'Informe');
select t.eq('a própria pessoa corrige', t.txt(format($q$select public.nascimento_definir(%L, '2014-05-15') ->> 'alterado'$q$, t.id('membro_a'))), 'true');
select t.throws('colega do mesmo clube NÃO corrige o nascimento de outro', format($q$select public.nascimento_definir(%L, '2013-01-01')$q$, t.id('membro_a2')), 'Sem permissão');
select t.throws('colega NÃO lê o nascimento de outro', format($q$select public.membro_nascimento(%L)$q$, t.id('membro_a2')), 'Sem permissão');
reset role;
select t.eq('gravou', (select nascimento::text from public.profiles where id = t.id('membro_a')), '2014-05-15');

select t.como('lider_a'); select t.pedir_clube('clube_a');
select t.eq('liderança lê o nascimento do membro do próprio clube', t.txt(format($q$select public.membro_nascimento(%L)::text$q$, t.id('membro_a'))), '2014-05-15');
select t.permitido('liderança corrige o nascimento do membro ativo do próprio clube', format($q$select public.nascimento_definir(%L, '2014-05-05')$q$, t.id('membro_a')));
select t.throws('liderança do A NÃO corrige membro do clube B', format($q$select public.nascimento_definir(%L, '2014-01-01')$q$, t.id('membro_b')), 'Sem permissão');
select t.throws('liderança do A NÃO lê nascimento de membro do B', format($q$select public.membro_nascimento(%L)$q$, t.id('membro_b')), 'Sem permissão');
reset role;
select t.como('lider_b'); select t.pedir_clube('clube_b');
select t.throws('liderança do B NÃO corrige membro do clube A', format($q$select public.nascimento_definir(%L, '2014-01-01')$q$, t.id('membro_a')), 'Sem permissão');
reset role;
select t.como('conselheiro_a'); select t.pedir_clube('clube_a');
select t.throws('conselheiro não é liderança que gere', format($q$select public.nascimento_definir(%L, '2014-01-01')$q$, t.id('membro_a')), 'Sem permissão');
reset role;
select t.como_anon();
select t.throws('anon sem acesso', format($q$select public.nascimento_definir(%L, '2014-01-01')$q$, t.id('membro_a')));
reset role;
select t.eq('duas correções auditadas (própria + liderança), com o clube só na da liderança',
  (select string_agg(coalesce(club_id::text, 'sem-clube') || ':' || (detalhe ->> 'pela_propria_pessoa'), ',' order by id)
     from public.auditoria_operacoes where operacao = 'nascimento_alterado' and alvo = t.id('membro_a')),
  'sem-clube:true,' || t.id('clube_a') || ':false');
select t.ok('auditoria sem a data (dado de criança)',
  not exists (select 1 from public.auditoria_operacoes where operacao = 'nascimento_alterado' and detalhe::text like '%2014%'));

-- ==================== 2) cancelar matrícula ====================
select t.como('membro_a'); select t.pedir_clube('clube_a');
insert into t78 select 'mc', public.classe_iniciar(t.classe('2026.4', 'amigo')) ->> 'member_class_id';
reset role;
select t.como('membro_a2'); select t.pedir_clube('clube_a');
select t.throws('outro membro NÃO cancela a matrícula de colega', $q$select public.classe_cancelar((select valor::uuid from t78 where chave = 'mc'))$q$, 'Sem permissão');
reset role;
select t.como('lider_b'); select t.pedir_clube('clube_b');
select t.throws('liderança de outro clube não enxerga a matrícula', $q$select public.classe_cancelar((select valor::uuid from t78 where chave = 'mc'))$q$, 'não encontrada');
select t.eq('liderança de outro clube não vê as classes do membro (lista vazia: só o clube da aba)', t.n(format($q$select json_array_length(public.classes_do_membro(%L))$q$, t.id('membro_a'))), 0);
reset role;
select t.como('membro_a'); select t.pedir_clube('clube_a');
select t.throws('membro comum não usa a lista da liderança', format($q$select public.classes_do_membro(%L)$q$, t.id('membro_a')), 'Sem permissão');
select t.eq('a própria pessoa cancela', t.txt($q$select public.classe_cancelar((select valor::uuid from t78 where chave = 'mc')) ->> 'status'$q$), 'cancelada');
select t.eq('minhas_classes não mostra a cancelada', t.n($q$select json_array_length(public.minhas_classes())$q$), 0);
select t.eq('classes_disponiveis volta a oferecer a Amigo 2026.4',
  t.n($q$select count(*) from json_array_elements(public.classes_disponiveis()) c where c->>'codigo' = 'amigo' and (c->>'elegivel')::boolean$q$), 1);
select t.eq('reiniciar reativa a MESMA matrícula (progresso guardado)',
  t.txt(format($q$select public.classe_iniciar(%L) ->> 'member_class_id'$q$, t.classe('2026.4', 'amigo'))), (select valor from t78 where chave = 'mc'));
select t.eq('...e ela volta a andar', t.txt($q$select string_agg(x->>'status', ',') from json_array_elements(public.minhas_classes()) x$q$), 'em_andamento');
reset role;
select t.como('lider_a'); select t.pedir_clube('clube_a');
select t.eq('liderança lista as classes do membro', t.n(format($q$select json_array_length(public.classes_do_membro(%L))$q$, t.id('membro_a'))), 1);
select t.permitido('liderança cancela a matrícula do membro do próprio clube', $q$select public.classe_cancelar((select valor::uuid from t78 where chave = 'mc'))$q$);
reset role;
select t.eq('duas cancelamentos auditados', (select count(*) from public.auditoria_operacoes where operacao = 'classe_cancelada' and alvo = t.id('membro_a'))::bigint, 2::bigint);
select t.ok('nada foi apagado: os requisitos da matrícula continuam lá',
  exists (select 1 from public.member_requirements where member_class_id = (select valor::uuid from t78 where chave = 'mc')));
-- concluída/investida não se cancela
update public.member_classes set status = 'investida' where id = (select valor::uuid from t78 where chave = 'mc');
select t.como('lider_a'); select t.pedir_clube('clube_a');
select t.throws('investida não se cancela', $q$select public.classe_cancelar((select valor::uuid from t78 where chave = 'mc'))$q$, 'em andamento');
reset role;
update public.member_classes set status = 'apto_investidura' where id = (select valor::uuid from t78 where chave = 'mc');
select t.como('membro_a'); select t.pedir_clube('clube_a');
select t.throws('apta à investidura não se cancela', $q$select public.classe_cancelar((select valor::uuid from t78 where chave = 'mc'))$q$, 'em andamento');
reset role;

-- ==================== 3) teste gratuito expira sozinho ====================
\o /dev/null
insert into public.billing_accounts (id, nome, status) values
  (public.curriculo_uuid('t78:conta1'), 'Conta 78 vencida [TESTE]', 'ativa'),
  (public.curriculo_uuid('t78:conta2'), 'Conta 78 no prazo [TESTE]', 'ativa'),
  (public.curriculo_uuid('t78:conta3'), 'Conta 78 tenant 001 [TESTE]', 'ativa');
insert into public.subscriptions (id, billing_account_id, plan_id, status, ciclo, trial_ate)
select public.curriculo_uuid('t78:' || x.k), public.curriculo_uuid('t78:conta' || x.n), p.id, 'trial', 'anual', x.ate
  from (values ('vencida', 1, now() - interval '1 hour'), ('prazo', 2, now() + interval '2 days'), ('t001', 3, now() - interval '5 days')) x(k, n, ate),
       lateral (select id from public.billing_plans where chave = 'anual' order by versao desc limit 1) p;
insert into public.subscription_clubs (subscription_id, club_id) values
  (public.curriculo_uuid('t78:vencida'), t.id('clube_b')),
  (public.curriculo_uuid('t78:t001'), t.id('clube_a'));
\o
select t.ok('job diário agendado', exists (select 1 from cron.job where jobname = 'expirar-trials' and command like '%trials_expirar%'));
select t.ok('authenticated não roda a expiração', not has_function_privilege('authenticated', 'public.trials_expirar()', 'execute'));
select t.ok('anon não roda a expiração', not has_function_privilege('anon', 'public.trials_expirar()', 'execute'));
select t.como_cron();
select t.eq('só a vencida expira (Tenant 001 e a no prazo ficam)', public.trials_expirar()::bigint, 1::bigint);
select t.eq('vencida -> pagamento_pendente', (select status from public.subscriptions where id = public.curriculo_uuid('t78:vencida')), 'pagamento_pendente');
select t.eq('no prazo continua trial', (select status from public.subscriptions where id = public.curriculo_uuid('t78:prazo')), 'trial');
select t.eq('Tenant 001 nunca é tocado', (select status from public.subscriptions where id = public.curriculo_uuid('t78:t001')), 'trial');
select t.ok('evento no histórico (origem sistema)', exists (select 1 from public.subscription_events
  where subscription_id = public.curriculo_uuid('t78:vencida') and de = 'trial' and para = 'pagamento_pendente' and origem = 'sistema'));
select t.eq('rodar de novo não faz nada (idempotente)', public.trials_expirar()::bigint, 0::bigint);
select t.eq('um evento só', (select count(*) from public.subscription_events where subscription_id = public.curriculo_uuid('t78:vencida'))::bigint, 1::bigint);

-- ==================== 4) foto órfã ====================
reset role;
insert into storage.objects (bucket_id, name, owner, created_at) values
  ('comprovacoes', t.id('membro_a') || '/requisitos/orfa-velha.jpg', t.id('membro_a'), now() - interval '10 days'),
  ('comprovacoes', t.id('membro_a') || '/requisitos/orfa-nova.jpg', t.id('membro_a'), now() - interval '1 day'),
  ('comprovacoes', t.id('membro_a') || '/requisitos/ligada.jpg', t.id('membro_a'), now() - interval '10 days'),
  ('comprovacoes', t.id('membro_a') || '/requisitos/historico.jpg', t.id('membro_a'), now() - interval '10 days'),
  ('comprovacoes', t.id('membro_a') || '/missoes/velha.jpg', t.id('membro_a'), now() - interval '30 days'),
  ('comprovacoes', t.id('membro_b') || '/requisitos/orfa-b.jpg', t.id('membro_b'), now() - interval '10 days');
update public.member_requirements set evidencia_path = t.id('membro_a') || '/requisitos/ligada.jpg'
 where id = (select id from public.member_requirements where member_class_id = (select valor::uuid from t78 where chave = 'mc') limit 1);
insert into public.requirement_submissions (member_requirement_id, tentativa_numero, tipo_evidencia_entregue, evidencia_path)
select id, 99, 'foto', t.id('membro_a') || '/requisitos/historico.jpg'
  from public.member_requirements where member_class_id = (select valor::uuid from t78 where chave = 'mc') offset 1 limit 1;

select t.ok('só service_role lista órfãs', not has_function_privilege('authenticated', 'public.comprovacoes_orfas(int, int)', 'execute'));
select t.como_service();
select t.eq('lista só as órfãs de requisitos com mais de 7 dias (nunca referenciadas, nunca outro prefixo)',
  t.txt($q$select string_agg(split_part(nome, '/', 3), ',' order by nome) from public.comprovacoes_orfas(7, 500)$q$),
  (select string_agg(x, ',' order by k) from (values
     (t.id('membro_a') || '/requisitos/orfa-velha.jpg', 'orfa-velha.jpg'),
     (t.id('membro_b') || '/requisitos/orfa-b.jpg', 'orfa-b.jpg')) v(k, x)));
select t.eq('menos de 7 dias não é aceito (piso de 7)', t.n($q$select count(*) from public.comprovacoes_orfas(0, 500)$q$), 2);
reset role;

select set_config('storage.allow_delete_query', 'true', true);  -- o que a API do Storage faz antes do DELETE
select t.como('membro_a');
select set_config('storage.allow_delete_query', 'true', true);
select t.permitido('dono apaga a própria foto órfã de requisito',
  format($q$delete from storage.objects where bucket_id = 'comprovacoes' and name = %L$q$, t.id('membro_a') || '/requisitos/orfa-nova.jpg'));
select t.bloqueado('dono NÃO apaga foto ligada a requisito',
  format($q$delete from storage.objects where bucket_id = 'comprovacoes' and name = %L$q$, t.id('membro_a') || '/requisitos/ligada.jpg'));
select t.bloqueado('dono NÃO apaga foto do histórico de envios',
  format($q$delete from storage.objects where bucket_id = 'comprovacoes' and name = %L$q$, t.id('membro_a') || '/requisitos/historico.jpg'));
select t.bloqueado('dono NÃO apaga fora do prefixo requisitos/',
  format($q$delete from storage.objects where bucket_id = 'comprovacoes' and name = %L$q$, t.id('membro_a') || '/missoes/velha.jpg'));
select t.bloqueado('ninguém apaga a foto de outra pessoa',
  format($q$delete from storage.objects where bucket_id = 'comprovacoes' and name = %L$q$, t.id('membro_b') || '/requisitos/orfa-b.jpg'));
select t.eq('sem oráculo: arquivo alheio conta como referenciado',
  t.txt(format($q$select public._comprovacao_referenciada(%L)::text$q$, t.id('membro_b') || '/requisitos/orfa-b.jpg')), 'true');
reset role;
select t.eq('só a órfã do dono saiu (sobram a órfã velha, a ligada, a do histórico e a do B)', (select count(*) from storage.objects where bucket_id = 'comprovacoes' and name like '%/requisitos/%')::bigint, 4::bigint);

select t.fim();
rollback;
