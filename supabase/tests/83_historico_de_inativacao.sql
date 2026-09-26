-- Migration 310: inativar exige MOTIVO e deixa HISTÓRICO por vínculo; reativar registra; só a
-- diretoria do clube em uso lê; instrutor/conselheiro não inativam; nada é apagado.
begin;
\ir _lib.sql
\ir _fixtures.sql

\o /dev/null
insert into public.pontos (usuario_id, origem, pontos, motivo, club_id) values (t.id('membro_a'), 'manual', 7, 'ponto 83', t.id('clube_a'));
\o
create temp table t83 (chave text primary key, valor text);
grant all on t83 to authenticated;
insert into t83 select 'pontos', (select count(*) from public.pontos where usuario_id = t.id('membro_a'))::text;

-- ---- quem NÃO inativa ----
select t.como('instrutor_a'); select t.pedir_clube('clube_a');
select t.throws('instrutor não inativa', format($q$select public.vinculo_inativar(%L, 'faltas')$q$, t.id('membro_a')), 'Sem permissão');
select t.como('conselheiro_a'); select t.pedir_clube('clube_a');
select t.throws('conselheiro não inativa', format($q$select public.vinculo_inativar(%L, 'faltas')$q$, t.id('membro_a')), 'Sem permissão');
select t.throws('conselheiro não lê histórico', format($q$select public.vinculo_historico_listar(%L)$q$, t.id('membro_a')), 'Sem permissão');
select t.como('membro_a'); select t.pedir_clube('clube_a');
select t.throws('o próprio membro não lê o histórico', format($q$select public.vinculo_historico_listar(%L)$q$, t.id('membro_a')), 'Sem permissão');
select t.throws('membro não lista inativos', $q$select public.membros_inativos()$q$, 'Sem permissão');
reset role;
select t.ok('tabela sem acesso direto', not has_table_privilege('authenticated', 'public.vinculo_historico', 'select'));
select t.eq('anon sem EXECUTE nas RPCs novas',
  t.n($q$select count(*) from unnest(array['vinculo_inativar(uuid, text, text, text)', 'vinculo_reativar(uuid, text, text)',
         'vinculo_historico_listar(uuid)', 'membros_inativos()']) f where has_function_privilege('anon', 'public.' || f, 'execute')$q$), 0);

-- ---- MOTIVO obrigatório ----
select t.como('lider_a'); select t.pedir_clube('clube_a');
select t.throws('vinculo_gerir sem motivo recusado', format($q$select public.vinculo_gerir(%L, p_status := 'inativo')$q$, t.id('membro_a')), 'motivo');
select t.throws('vinculo_inativar sem categoria recusado', format($q$select public.vinculo_inativar(%L, null)$q$, t.id('membro_a')), 'motivo');
select t.throws('categoria inválida recusada', format($q$select public.vinculo_inativar(%L, 'qualquer')$q$, t.id('membro_a')), 'motivo');
select t.throws('"outro" sem texto recusado', format($q$select public.vinculo_inativar(%L, 'outro', '  ')$q$, t.id('membro_a')), 'Outro');
select t.permitido('diretoria inativa com motivo', format($q$select public.vinculo_inativar(%L, 'mudou_cidade_igreja', 'Foi para Campinas')$q$, t.id('membro_a')));
select t.throws('não inativa duas vezes', format($q$select public.vinculo_inativar(%L, 'faltas')$q$, t.id('membro_a')), 'não está ativa');
reset role;
select t.eq('vínculo ficou suspenso (continua no clube)',
  t.txt(format($q$select status from public.organization_memberships where user_id = %L and organizational_unit_id = %L$q$, t.id('membro_a'), t.id('clube_a'))), 'suspenso');
select t.eq('histórico registrou', t.txt(format($q$select acao || '|' || motivo_categoria || '|' || motivo_texto || '|' || (feito_por = %L) from public.vinculo_historico where user_id = %L$q$,
  t.id('lider_a'), t.id('membro_a'))), 'inativado|mudou_cidade_igreja|Foi para Campinas|true');
select t.ok('auditoria sem o texto do motivo', exists (select 1 from public.auditoria_operacoes where operacao = 'vinculo_inativado' and alvo = t.id('membro_a')
  and detalhe ->> 'motivo' = 'mudou_cidade_igreja' and not detalhe::text like '%Campinas%'));
select t.eq('motivo não vaza para a próxima escrita da transação', coalesce(current_setting('app.vinculo_motivo_cat', true), ''), '');
select t.eq('pontos continuam', t.txt(format($q$select count(*)::text from public.pontos where usuario_id = %L$q$, t.id('membro_a'))), (select valor from t83 where chave = 'pontos'));

-- ---- diretoria lê; lista de inativos ----
select t.como('lider_a'); select t.pedir_clube('clube_a');
select t.eq('lista de inativos traz o membro com o último motivo',
  t.txt($q$select x ->> 'motivo_categoria' from json_array_elements(public.membros_inativos()) x where x ->> 'nome' = 'Membro A'$q$), 'mudou_cidade_igreja');
select t.ok('...e desde quando', t.txt($q$select x ->> 'inativo_desde' from json_array_elements(public.membros_inativos()) x where x ->> 'nome' = 'Membro A'$q$) is not null);
select t.throws('excluir inativo recusado', format($q$select public.excluir_usuario(%L)$q$, t.id('membro_a')), 'inativo não é apagado');

-- ---- REATIVAR registra ----
select t.permitido('reativa com motivo opcional', format($q$select public.vinculo_reativar(%L, null, 'Voltou a morar aqui')$q$, t.id('membro_a')));
select t.eq('linha do tempo com 2 eventos (mais recente primeiro)',
  t.txt(format($q$select string_agg(x ->> 'acao', ',') from json_array_elements(public.vinculo_historico_listar(%L)) x$q$, t.id('membro_a'))), 'reativado,inativado');
select t.permitido('encerra (saiu do clube)', format($q$select public.vinculo_inativar(%L, 'saiu_do_clube', null, 'encerrado')$q$, t.id('membro_a')));
select t.permitido('reativa sem motivo', format($q$select public.vinculo_reativar(%L)$q$, t.id('membro_a')));
reset role;
select t.eq('4 eventos', t.n(format($q$select count(*) from public.vinculo_historico where user_id = %L$q$, t.id('membro_a'))), 4);
select t.eq('reativação sem motivo fica sem categoria',
  t.txt(format($q$select coalesce(motivo_categoria, 'nulo') from public.vinculo_historico where user_id = %L order by id desc limit 1$q$, t.id('membro_a'))), 'nulo');

-- ---- outro clube não vê ----
select t.como('lider_b'); select t.pedir_clube('clube_b');
select t.eq('diretoria de outro clube não vê o histórico', t.txt(format($q$select public.vinculo_historico_listar(%L)::text$q$, t.id('membro_a'))), '[]');
select t.throws('nem inativa gente de outro clube', format($q$select public.vinculo_inativar(%L, 'faltas')$q$, t.id('membro_a')), 'não tem vínculo');
reset role;

-- ---- saída por outro caminho (rotina) entra como "não informado"; pendente recusado não entra ----
\o /dev/null
select t.mk('pend83', 'Pendente 83', 'desbravador', 'pendente', 'clube_a');
update public.organization_memberships set status = 'suspenso' where user_id = t.id('membro_a2') and organizational_unit_id = t.id('clube_a');
update public.organization_memberships set status = 'encerrado' where user_id = t.id('pend83');
\o
select t.eq('rotina: nao_informado', t.txt(format($q$select motivo_categoria from public.vinculo_historico where user_id = %L$q$, t.id('membro_a2'))), 'nao_informado');
select t.eq('recusa de cadastro pendente não vira histórico', t.n(format($q$select count(*) from public.vinculo_historico where user_id = %L$q$, t.id('pend83'))), 0);

select t.fim();
rollback;
