-- =============================================================================
--  Fase 9.1 — defeitos de código achados pela auditoria do pré-voo (migration 85).
--
--    1. excluir_usuario × histórico curricular: quem avaliou/revisou/revogou/selou é trilha de
--       auditoria — a exclusão definitiva é RECUSADA com mensagem clara (não um erro de FK), e quem
--       só criou/é responsável por algo (turma, versão do catálogo) sai com a coluna em NULL.
--    2. o job 'reconciliar-armazenamento' chama uma função interna, sem portão: roda sem sessão
--       (como o pg_cron), enquanto a RPC continua exigindo administrador da plataforma.
--  (O item 3 — a confirmação do lance conjunto devolvendo a PARCELA — está no teste 53, seção 11.)
-- =============================================================================
begin;
\ir _lib.sql
\ir _fixtures.sql

\o /dev/null
-- O motor curricular com a classe PILOTO (o dado pequeno), como o teste 32: só nesta transação, o
-- teste faz o papel da plataforma e publica a versão piloto como oficial.
update public.curriculum_versions set status = 'arquivado' where origem = 'oficial';
update public.curriculum_versions set origem = 'oficial' where id = '00000000-0000-4000-a000-000000000001'::uuid;
insert into t.ids (chave, id) values
  ('versao_piloto', '00000000-0000-4000-a000-000000000001'::uuid),
  ('classe_piloto', '00000000-0000-4000-a000-000000000002'::uuid),
  ('versao_esp_piloto', '00000000-0000-4000-a000-000000000101'::uuid);
insert into t.ids (chave, id)
  select 'req_' || s.codigo || '_' || r.codigo, r.id
  from public.class_requirements r join public.class_sections s on s.id = r.section_id
  where s.class_id = t.id('classe_piloto');
insert into public.club_features (club_id, feature, enabled) values (t.id('clube_a'), 'classes', true)
on conflict (club_id, feature) do update set enabled = true;

-- Pessoas só do clube A (o caminho da exclusão DEFINITIVA), cada uma com um tipo de rastro.
select t.mk('avaliador_a',   'Avaliador A',   'instrutor', 'ativo', 'clube_a');  -- aprova requisito (RPC real)
select t.mk('revisor_a',     'Revisor A',     'diretoria', 'ativo', 'clube_a');  -- revisou investidura
select t.mk('revogador_a',   'Revogador A',   'diretoria', 'ativo', 'clube_a');  -- revogou conquista
select t.mk('selador_a',     'Selador A',     'diretoria', 'ativo', 'clube_a');  -- selou snapshot (tabela imutável)
select t.mk('coordenador_a', 'Coordenador A', 'instrutor', 'ativo', 'clube_a');  -- só abriu turma / importou versão
\o

-- =============================================================================
--  1. excluir_usuario × histórico curricular
-- =============================================================================
-- membro_a faz a classe e envia um requisito; avaliador_a aprova — pelas RPCs de verdade.
select t.como('membro_a'); select t.pedir_clube('clube_a');
select t.permitido('membro_a inicia a classe piloto no clube A', format($q$select public.classe_iniciar(%L)$q$, t.id('classe_piloto')));
select t.permitido('...salva espiritual/2', format($q$select public.requisito_salvar(%L, %L, null)$q$, t.id('req_espiritual_2'), 'Aprendi sobre paciência.'));
select t.permitido('...e envia para avaliação', format($q$select public.requisito_enviar(%L)$q$, t.id('req_espiritual_2')));
reset role;
\o /dev/null
insert into t.ids (chave, id) select 'mc_a', id from public.member_classes where usuario_id = t.id('membro_a') and club_id = t.id('clube_a');
\o
select t.como('avaliador_a'); select t.pedir_clube('clube_a');
select t.permitido('avaliador_a (instrutor) aprova o requisito de membro_a',
  format($q$select public.requisito_avaliar((select id from public.member_requirements where member_class_id = %L and requirement_id = %L), 'aprovado', 'Muito bem!')$q$,
         t.id('mc_a'), t.id('req_espiritual_2')));
reset role;
select t.eq('a aprovação ficou registrada em nome de avaliador_a',
  (select count(*) from public.requirement_approvals where avaliado_por = t.id('avaliador_a')), 1);

-- Os outros rastros, gravados direto (o que interessa aqui é a exclusão, não o fluxo que os gera).
\o /dev/null
insert into public.investiture_reviews (member_class_id, club_id, usuario_id, status, revisado_por, revisado_em, revisado_papel, comentario)
values (t.id('mc_a'), t.id('clube_a'), t.id('membro_a'), 'correcao_solicitada', t.id('revisor_a'), now(), 'diretoria', 'refazer a seção 2');
insert into public.curriculum_achievements (usuario_id, tipo, classe_id, club_id_origem, concluida_em, status, revogada_em, revogada_por, revogada_motivo)
values (t.id('membro_a'), 'classe', t.id('classe_piloto'), t.id('clube_a'), now(), 'revogada', now(), t.id('revogador_a'), 'registrado por engano');
insert into public.class_completion_snapshots (member_class_id, usuario_id, club_id_origem, classe_id, curriculum_version_id, versao, conteudo, hash, gerado_por)
values (t.id('mc_a'), t.id('membro_a'), t.id('clube_a'), t.id('classe_piloto'), t.id('versao_piloto'), 1, '{}'::jsonb,
        md5('snapshot-63') || md5('snapshot-63b'), t.id('selador_a'));
-- coordenador_a: responsável e criador de uma turma de especialidade, e importador de uma versão do catálogo
insert into public.specialty_offerings (club_id, specialty_id, instrutor_responsavel_id, titulo, criado_por)
select t.id('clube_a'), s.id, t.id('coordenador_a'), 'Turma do coordenador (teste 63)', t.id('coordenador_a')
  from public.specialties s order by s.id limit 1;
update public.curriculum_versions set criado_por = t.id('coordenador_a'), importado_por = t.id('coordenador_a')
 where id = t.id('versao_esp_piloto');
\o

select t.como('lider_a'); select t.pedir_clube('clube_a');
-- ---- quem AVALIOU: recusa clara ----
select t.throws('excluir quem AVALIOU um requisito é RECUSADO com mensagem clara',
  format('select public.excluir_usuario(%L)', t.id('avaliador_a')), 'histórico curricular');
select t.ok('...que manda desativar o vínculo, e não é um erro de foreign key',
  t.txt(format('select public.excluir_usuario(%L)::text', t.id('avaliador_a'))) ilike '%desative o vínculo em vez de excluir%'
  and t.txt(format('select public.excluir_usuario(%L)::text', t.id('avaliador_a'))) not ilike '%foreign key%'
  and t.txt(format('select public.excluir_usuario(%L)::text', t.id('avaliador_a'))) not ilike '%violates%');
-- ---- quem REVISOU a investidura / REVOGOU a conquista / SELOU o snapshot: idem ----
select t.throws('excluir quem REVISOU uma investidura é recusado com a mesma mensagem',
  format('select public.excluir_usuario(%L)', t.id('revisor_a')), 'desative o vínculo em vez de excluir');
select t.throws('excluir quem REVOGOU uma conquista curricular é recusado',
  format('select public.excluir_usuario(%L)', t.id('revogador_a')), 'desative o vínculo em vez de excluir');
select t.throws('excluir quem SELOU um snapshot é recusado com a mensagem clara (antes: "class_completion_snapshots é imutável")',
  format('select public.excluir_usuario(%L)', t.id('selador_a')), 'histórico curricular');
-- ---- sem histórico de auditor: funciona ----
select t.permitido('excluir quem só ABRIU turma e IMPORTOU versão do catálogo funciona (colunas opcionais viram NULL)',
  format('select public.excluir_usuario(%L)', t.id('coordenador_a')));
select t.permitido('excluir uma pessoa sem histórico nenhum funciona',
  format('select public.excluir_usuario(%L)', t.id('membro_a2')));
reset role;

select t.eq('o avaliador continua existindo', (select count(*) from public.profiles where id = t.id('avaliador_a')), 1);
select t.eq('...e a avaliação continua com o nome dele (a trilha ficou)',
  (select count(*) from public.requirement_approvals where avaliado_por = t.id('avaliador_a')), 1);
select t.eq('o revisor, o revogador e o selador continuam existindo',
  (select count(*) from public.profiles where id in (t.id('revisor_a'), t.id('revogador_a'), t.id('selador_a'))), 3);
select t.eq('o coordenador foi excluído', (select count(*) from public.profiles where id = t.id('coordenador_a')), 0);
select t.eq('...a turma dele continua, sem responsável nem criador',
  (select count(*) from public.specialty_offerings
    where titulo = 'Turma do coordenador (teste 63)' and instrutor_responsavel_id is null and criado_por is null), 1);
select t.eq('...e a versão do catálogo continua, sem criado_por/importado_por',
  (select count(*) from public.curriculum_versions where id = t.id('versao_esp_piloto') and criado_por is null and importado_por is null), 1);
select t.eq('a pessoa sem histórico foi excluída', (select count(*) from public.profiles where id = t.id('membro_a2')), 0);

-- O banco protege a trilha também POR FORA da RPC (ex.: alguém apagar o login no painel do Supabase).
select t.throws('apagar o perfil do avaliador direto no banco esbarra na FK — a trilha não some por fora da RPC',
  format('delete from public.profiles where id = %L', t.id('avaliador_a')), 'foreign key');
select t.eq('...e o avaliador continua lá', (select count(*) from public.profiles where id = t.id('avaliador_a')), 1);

-- Com vínculo em OUTRO clube, excluir continua tirando só o vínculo deste — o perfil e a trilha ficam.
\o /dev/null
insert into public.investiture_reviews (member_class_id, club_id, usuario_id, status, revisado_por, revisado_em, revisado_papel)
values (t.id('mc_a'), t.id('clube_a'), t.id('membro_a'), 'aprovado', t.id('dir_a_membro_b'), now(), 'diretoria');
\o
select t.como('lider_b'); select t.pedir_clube('clube_b');
select t.eq('quem tem histórico E outro clube: sai só o vínculo deste clube (sem recusa)',
  t.txt(format($q$select public.excluir_usuario(%L) ->> 'somente_vinculo'$q$, t.id('dir_a_membro_b'))), 'true');
reset role;
select t.eq('...o perfil continua', (select count(*) from public.profiles where id = t.id('dir_a_membro_b')), 1);
select t.eq('...e a revisão continua com o nome dele', (select count(*) from public.investiture_reviews where revisado_por = t.id('dir_a_membro_b')), 1);

-- Quem é só o SUJEITO do histórico continua podendo ser excluído (desenho da 44: o registro imutável
-- fica, anonimizado; o progresso da própria pessoa vai em cascata, como sempre foi).
select t.como('lider_a'); select t.pedir_clube('clube_a');
select t.permitido('excluir o DESBRAVADOR que fez a classe continua funcionando (ele é o sujeito, não o auditor)',
  format('select public.excluir_usuario(%L)', t.id('membro_a')));
reset role;
select t.eq('...o snapshot selado fica, anonimizado', (select count(*) from public.class_completion_snapshots
  where gerado_por = t.id('selador_a') and usuario_id is null and member_class_id is null), 1);

-- Guarda: as únicas FKs para pessoas SEM on delete são as três da trilha de auditoria. Uma tabela
-- nova com FK solta para profiles/auth.users faria excluir_usuario voltar a morrer com erro de FK.
select t.eq('FKs para profiles/auth.users sem on delete: só avaliou/revisou/revogou (trilha de auditoria)',
  (select string_agg(c.conrelid::regclass::text || '.' || a.attname, ', ' order by c.conrelid::regclass::text, a.attname)
     from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
    where c.contype = 'f' and c.connamespace = 'public'::regnamespace
      and c.confrelid in ('public.profiles'::regclass, 'auth.users'::regclass)
      and c.confdeltype in ('a', 'r')),
  'curriculum_achievements.revogada_por, document_final_renders.criado_por, investiture_reviews.revisado_por, requirement_approvals.avaliado_por');
select t.eq('as colunas "quem criou / é responsável" viraram ON DELETE SET NULL',
  (select count(*) from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
    where c.contype = 'f' and c.confrelid = 'public.profiles'::regclass and c.confdeltype = 'n'
      and c.conrelid::regclass::text || '.' || a.attname in ('curriculum_versions.criado_por', 'curriculum_versions.importado_por',
                                                             'specialty_offerings.criado_por', 'specialty_offerings.instrutor_responsavel_id')), 4);
select t.ok('as constraints da trilha dizem, no catálogo, por que não têm on delete',
  (select count(*) from pg_constraint c where c.conname in ('requirement_approvals_avaliado_por_fkey', 'investiture_reviews_revisado_por_fkey', 'curriculum_achievements_revogada_por_fkey', 'document_final_renders_criado_por_fkey')
      and obj_description(c.oid, 'pg_constraint') ilike '%SEM on delete DE PROPÓSITO%') = 4);

-- =============================================================================
--  2. Reconciliação do armazenamento: o job roda sem sessão; a RPC continua exigindo admin
-- =============================================================================
\o /dev/null
-- Simula deriva no clube A (alguém mexeu por fora / objeto entrou antes do gatilho existir).
insert into public.club_storage_uso (club_id, bytes, objetos, atualizado_em)
values (t.id('clube_a'), 777777, 7, now())
on conflict (club_id) do update set bytes = public.club_storage_uso.bytes + 777777;
create table t.real_a as
  select coalesce(sum(coalesce((o.metadata->>'size')::bigint, 0)), 0)::bigint as bytes
    from storage.objects o where public._storage_clube_do_objeto(o.name, coalesce(o.owner_id, o.owner::text)) = t.id('clube_a');
grant select on t.real_a to public;
\o

select t.eq('existe UM job de reconciliação, no mesmo horário de sempre',
  (select count(*)::text || ' | ' || min(schedule) from cron.job where jobname = 'reconciliar-armazenamento'), '1 | 20 4 * * 0');
select t.ok('...e ele chama a função INTERNA (sem portão de admin)',
  (select command from cron.job where jobname = 'reconciliar-armazenamento') ~ '_storage_reconciliar_interno'
  and (select command from cron.job where jobname = 'reconciliar-armazenamento') !~ 'public\.storage_reconciliar\(');

select t.como_cron();
select t.throws('o defeito: a RPC com portão, chamada sem sessão (como o job antigo), falha sempre',
  'select * from public.storage_reconciliar(null, true)', 'administração da plataforma');
select t.permitido('o COMANDO do job, rodado sem sessão (como o pg_cron), funciona',
  (select command from cron.job where jobname = 'reconciliar-armazenamento'));
reset role;
select t.eq('...e corrigiu a deriva: o agregado do clube A bate com a soma real dos objetos',
  (select bytes from public.club_storage_uso where club_id = t.id('clube_a')), (select bytes from t.real_a));

select t.como('lider_a');
select t.throws('a RPC continua exigindo administrador da plataforma (diretor de clube não reconcilia)',
  'select * from public.storage_reconciliar(null, true)', 'administração da plataforma');
select t.bloqueado('a função interna não é exposta à API: authenticated não executa',
  'select * from public._storage_reconciliar_interno(null, false)');
select t.como_anon();
select t.bloqueado('...nem anon', 'select * from public._storage_reconciliar_interno(null, false)');
reset role;
select t.eq('authenticated não tem EXECUTE na interna',
  coalesce(has_function_privilege('authenticated', to_regprocedure('public._storage_reconciliar_interno(uuid, boolean)'), 'execute'), true), false);
select t.eq('anon também não', coalesce(has_function_privilege('anon', to_regprocedure('public._storage_reconciliar_interno(uuid, boolean)'), 'execute'), true), false);

\o /dev/null
insert into public.platform_admins (user_id, papel) values (t.id('lider_b'), 'operacao') on conflict do nothing;
update public.club_storage_uso set bytes = bytes + 1234 where club_id = t.id('clube_a');
\o
select t.como('lider_b');
select t.eq('um administrador da plataforma reconcilia pela RPC — na MESMA transação em que o job já rodou (a tabela temporária não colide)',
  t.n($q$select diferenca from public.storage_reconciliar((select id from t.ids where chave = 'clube_a'), true)$q$), -1234);
reset role;

select t.fim();
rollback;
