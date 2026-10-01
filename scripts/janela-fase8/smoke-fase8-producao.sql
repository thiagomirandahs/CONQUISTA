-- SMOKE da Fase 8 — TUDO DENTRO DE UMA TRANSAÇÃO QUE TERMINA EM ROLLBACK (nada persiste). Rode DEPOIS das migrations 514–527 e ANTES de publicar o front.
-- Usa pessoas do clube só como IDENTIDADE (escolhidas por papel, sem ler nome/dado pessoal) e ajusta nascimento/recursos SÓ dentro da transação.
-- Uso:  psql "$DB_URL_PRODUCAO" -X -v ON_ERROR_STOP=1 -v clube_slug=filhos-da-conquista -f scripts/janela-fase8/smoke-fase8-producao.sql
--   (ensaio local: -v clube_slug=hml-clube-a com o banco de trabalho; o seed _seed_homologacao.mjs cria as pessoas hml-*)
\if :{?clube_slug}
\else
  \echo 'defina -v clube_slug=<slug do clube>'
  \quit
\endif
begin;
set local statement_timeout = '180s';
set local lock_timeout = '10s';
\ir ../../supabase/tests/_lib.sql
\o NUL
insert into t.ids (chave, id) select 'clube_a', id from public.organizational_units where slug = :'clube_slug';
-- identidades por papel (o 1º de cada, ordenado por id — nada pessoal é lido)
insert into t.ids (chave, id) select 'dir1', user_id from (select user_id from public.organization_memberships m where m.organizational_unit_id = t.id('clube_a') and m.role in ('diretoria') and m.status = 'ativo' order by user_id limit 1) x;
insert into t.ids (chave, id) select 'instr', user_id from (select user_id from public.organization_memberships m where m.organizational_unit_id = t.id('clube_a') and m.role in ('instrutor', 'diretoria') and m.status = 'ativo' and m.user_id <> t.id('dir1') order by user_id limit 1) x;
insert into t.ids (chave, id) select 'aluno', user_id from (select user_id from public.organization_memberships m where m.organizational_unit_id = t.id('clube_a') and m.role = 'desbravador' and m.status = 'ativo' order by user_id limit 1) x;
insert into t.ids (chave, id) select 'aluno2', user_id from (select user_id from public.organization_memberships m where m.organizational_unit_id = t.id('clube_a') and m.role = 'desbravador' and m.status = 'ativo' and m.user_id <> t.id('aluno') order by user_id limit 1) x;
-- ajustes SÓ nesta transação (rollback): idade verificável, recursos ligados, sem classes/conquistas prévias das duas pessoas de teste
update public.profiles set nascimento = date '2000-01-01' where id in (t.id('aluno'), t.id('aluno2'), t.id('dir1'), t.id('instr'));
insert into public.club_features (club_id, feature, enabled) values (t.id('clube_a'), 'classes', true), (t.id('clube_a'), 'comunidade', true)
  on conflict (club_id, feature) do update set enabled = true;
delete from public.member_classes where usuario_id in (t.id('aluno'), t.id('aluno2')) and club_id = t.id('clube_a');
delete from public.curriculum_achievements where usuario_id in (t.id('aluno'), t.id('aluno2')) and tipo = 'classe';
create function t.classe(p text) returns uuid language sql stable security definer as $$
  select c.id from public.classes c join public.curriculum_versions v on v.id = c.curriculum_version_id where v.origem = 'oficial' and v.status = 'publicado' and c.manifesto_id = p and c.tipo_classe = 'regular' $$;
create function t.req(p text) returns uuid language sql stable security definer as $$
  select r.id from public.class_requirements r join public.class_sections s on s.id = r.section_id join public.classes c on c.id = s.class_id
  join public.curriculum_versions v on v.id = c.curriculum_version_id where r.manifesto_id = p and v.origem = 'oficial' and v.status = 'publicado' $$;
create function t.mr(p_user text, p_req text) returns uuid language sql stable security definer as $$
  select mr.id from public.member_requirements mr where mr.usuario_id = t.id(p_user) and mr.requirement_id = t.req(p_req) and mr.club_id = t.id('clube_a') $$;
\o

\o NUL
-- ======================= 0) sanidade =======================
select t.eq('as 14 migrations da fase 8 estão no ledger', (select count(*) from supabase_migrations.schema_migrations where version between '20260930000514' and '20260930000527'), 14);
select t.ok('identidades encontradas (diretoria, instrutor/diretoria, 2 desbravadores) no clube', (select count(*) from t.ids where chave in ('dir1', 'instr', 'aluno', 'aluno2', 'clube_a')) = 5);

-- ======================= 1) leituras novas respondem (sem dados) =======================
select t.como('aluno'); select t.pedir_clube('clube_a');
select t.ok('classes_disponiveis traz bloqueio/anterior em todas as linhas', (select bool_and((c::jsonb) ? 'bloqueio' and (c::jsonb) ? 'anterior') from json_array_elements(public.classes_disponiveis()::json) c));
select t.ok('minha_jornada traz as 5 seções', (select count(*) from json_object_keys(public.minha_jornada())) = 5);
select t.ok('meu_portfolio responde', public.meu_portfolio() is not null);
select t.ok('leituras_catalogo responde', public.leituras_catalogo('todos') is not null);
select t.ok('classes_concluidas_anteriormente responde (lista)', json_typeof(public.classes_concluidas_anteriormente()) = 'array');
select t.permitido('inicia a classe Amigo (regular; idade verificável dentro da transação)', format($q$select public.classe_iniciar(%L)$q$, t.classe('amigo')));
reset role;
select t.eq('1 matrícula do Amigo para o aluno (sem duplicar)', (select count(*) from public.member_classes where usuario_id = t.id('aluno') and class_id = t.classe('amigo') and status <> 'cancelada'), 1);

-- ======================= 2) COMPROVAÇÃO: relato em requisito simples, devolução, reenvio, histórico =======================
select t.como('aluno'); select t.pedir_clube('clube_a');
select t.permitido('salva o relato (rascunho)', format($q$select public.requisito_relato_salvar(%L, %L)$q$, t.req('amigo.II.1'), 'Relato 1 (smoke).'));
select t.permitido('envia (tentativa 1)', format($q$select public.requisito_enviar(%L)$q$, t.req('amigo.II.1')));
select t.como('instr'); select t.pedir_clube('clube_a');
select t.ok('a fila unificada mostra o relato da tentativa', exists (select 1 from json_array_elements(public.fila_avaliacao_unificada(null, null)::json) x where x ->> 'relato' = 'Relato 1 (smoke).'));
select t.permitido('devolve com comentário', format($q$select public.requisito_avaliar(%L, 'correcao_solicitada', 'Detalhe mais (smoke).')$q$, t.mr('aluno', 'amigo.II.1')));
select t.como('aluno'); select t.pedir_clube('clube_a');
select t.permitido('novo relato + reenvio (tentativa 2)', format($q$select public.requisito_relato_salvar(%L, %L)$q$, t.req('amigo.II.1'), 'Relato 2 (smoke).'));
select t.permitido('reenvia', format($q$select public.requisito_enviar(%L)$q$, t.req('amigo.II.1')));
select t.eq('HISTÓRICO: 2 tentativas, cada uma com o seu relato; a 1ª intacta',
  (select string_agg((x ->> 'tentativa_numero') || ':' || (x ->> 'relato'), ' | ' order by (x ->> 'tentativa_numero')::int)
     from json_array_elements(public.requisito_historico(t.mr('aluno', 'amigo.II.1')) -> 'tentativas') x), '1:Relato 1 (smoke). | 2:Relato 2 (smoke).');
reset role;
select t.throws('a tentativa antiga é IMUTÁVEL', format($q$update public.requirement_submissions set relato = 'x' where member_requirement_id = %L and tentativa_numero = 1$q$, t.mr('aluno', 'amigo.II.1')), 'imutável');

-- ======================= 3) CLASSE JÁ CONCLUÍDA: registro, efeitos, revogação, conquista ativa única =======================
select t.como('dir1'); select t.pedir_clube('clube_a');
select t.permitido('diretoria registra a Pesquisador como já concluída (data desconhecida) para o aluno2', format($q$select public.classe_concluida_anteriormente_registrar(%L, %L, null, true, 'registro do smoke', null)$q$, t.id('aluno2'), t.classe('pesquisador')));
select t.throws('registrar a MESMA classe de novo é recusado (não duplica)', format($q$select public.classe_concluida_anteriormente_registrar(%L, %L, null, true, 'duplicada do smoke', null)$q$, t.id('aluno2'), t.classe('pesquisador')), 'já');
select t.throws('ninguém registra para si', format($q$select public.classe_concluida_anteriormente_registrar(%L, %L, null, true, 'para mim do smoke', null)$q$, t.id('dir1'), t.classe('amigo')));
select t.como('aluno2'); select t.pedir_clube('clube_a');
select t.eq('a Pesquisador NÃO é mais oferecida ao aluno2', (select count(*) from json_array_elements(public.classes_disponiveis()::json) c where c ->> 'codigo' = 'pesquisador'), 0);
select t.ok('aparece em "Concluídas anteriormente"', exists (select 1 from json_array_elements(public.classes_concluidas_anteriormente()::json) c where c ->> 'codigo' = 'pesquisador'));
select t.throws('classe_iniciar da Pesquisador é recusada (já concluída)', format($q$select public.classe_iniciar(%L)$q$, t.classe('pesquisador')), 'concluíd');
reset role;
select t.eq('sem matrícula nem aprovação falsas para a conclusão registrada', (select count(*) from public.member_classes where usuario_id = t.id('aluno2') and class_id = t.classe('pesquisador')), 0);
select t.eq('1 conquista ATIVA do aluno2 na Pesquisador', (select count(*) from public.curriculum_achievements a join public.classes c on c.id = a.classe_id where a.usuario_id = t.id('aluno2') and c.codigo = 'pesquisador' and a.status = 'ativa'), 1);
savepoint dup;
select t.throws('o BANCO recusa uma 2ª conquista ATIVA equivalente (índice único)',
  format($q$insert into public.curriculum_achievements (usuario_id, tipo, classe_id, club_id_origem, concluida_em, status) values (%L, 'classe', %L, %L, now(), 'ativa')$q$, t.id('aluno2'), t.classe('pesquisador'), t.id('clube_a')), 'unique');
rollback to savepoint dup;
select t.como('dir1'); select t.pedir_clube('clube_a');
select t.permitido('revoga o registro (auditável) e a classe volta a ser oferecida', format($q$select public.classe_concluida_anteriormente_revogar((select a.id from public.curriculum_achievements a join public.classes c on c.id = a.classe_id where a.usuario_id = %L and c.codigo = 'pesquisador' and a.status = 'ativa'), 'revogado no smoke')$q$, t.id('aluno2')));
select t.como('aluno2'); select t.pedir_clube('clube_a');
select t.eq('depois de revogar a Pesquisador volta a ser oferecida', (select count(*) from json_array_elements(public.classes_disponiveis()::json) c where c ->> 'codigo' = 'pesquisador'), 1);
reset role;
select t.eq('a conquista revogada continua no histórico (1 revogada, 0 ativas)', (select count(*) filter (where status = 'revogada') || '/' || count(*) filter (where status = 'ativa') from public.curriculum_achievements a join public.classes c on c.id = a.classe_id where a.usuario_id = t.id('aluno2') and c.codigo = 'pesquisador'), '1/0');
select t.eq('o log de auditoria tem registrar e revogar', (select count(*) from public.class_prior_completion_log where usuario_id = t.id('aluno2')), 2);

-- ======================= 4) REDE: papéis de publicação =======================
select t.como('dir1'); select t.pedir_clube('clube_a');
select t.permitido('diretoria publica AVISO no clube', $q$select public.rede_publicar('aviso', 'aviso do smoke', null, null, null, null, 'clube')$q$);
select t.como('aluno'); select t.pedir_clube('clube_a');
select t.throws('desbravador NÃO publica aviso', $q$select public.rede_publicar('aviso', 'aviso do aluno (smoke)', null, null, null, null, 'clube')$q$);
select t.throws('desbravador NÃO publica na Comunidade', $q$select public.rede_publicar('livre', 'olá (smoke)', null, null, null, null, 'comunidade')$q$);
select t.ok('a lista de conquistas publicáveis do desbravador é vazia', json_array_length(public.rede_conquistas_publicaveis('clube')::json) = 0);
reset role;

-- ======================= 5) anon e invariantes =======================
select t.como_anon();
select t.eq('anon NÃO executa as RPCs novas', (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and has_function_privilege('anon', p.oid, 'execute') and p.proname in
  ('minha_jornada', 'meu_portfolio', 'leituras_catalogo', 'requisito_relato_salvar', 'classe_concluida_anteriormente_registrar', 'classe_concluida_anteriormente_revogar', 'classes_concluidas_anteriormente', 'rede_conquistas_publicaveis', 'classe_atualizacao_previa', 'classe_conclusao_reconhecida')), 0);
reset role;
\o
select * from t.fim();
rollback;
