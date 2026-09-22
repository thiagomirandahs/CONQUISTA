-- Teste de CONTRATO (estrutural) do motor curricular versionado (Classes/Especialidades — fase 1).
-- Trava, direto no catálogo do banco: o catálogo curricular (currículo/classe/seção/requisito) é
-- conteúdo da PLATAFORMA (sem club_id, ninguém grava pela API); TODO progresso operacional (member_
-- classes/member_requirements/requirement_approvals/investiture_reviews) é por clube (club_id NOT
-- NULL + RLS) e nunca lê profiles.papel/.status/.unidade_id (a garantia geral já vem do teste 29,
-- que varre TODA função nova do banco — aqui só confirma as peças específicas desta fase: as 9 RPCs
-- existem com o grant certo, os 2 gatilhos existem, e os dados piloto continuam marcados como teste).
begin;
\ir _lib.sql
\ir _fixtures.sql

-- ---------- 1) catálogo curricular: conteúdo da PLATAFORMA (sem club_id — já exigido pela exceção do teste 20) ----------
select t.eq('curriculum_versions/classes/class_sections/class_requirements existem',
  (select count(*) from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
    and c.relname in ('curriculum_versions', 'classes', 'class_sections', 'class_requirements')), 4);
select t.eq('as 4 tabelas do catálogo têm RLS ligado',
  (select count(*) from pg_class c where c.relnamespace = 'public'::regnamespace and c.relrowsecurity
    and c.relname in ('curriculum_versions', 'classes', 'class_sections', 'class_requirements')), 4);
select t.eq('authenticated NÃO grava no catálogo curricular (nem INSERT, UPDATE ou DELETE) — só lê',
  (select count(*) from information_schema.table_privileges
    where table_schema = 'public' and grantee = 'authenticated'
      and table_name in ('curriculum_versions', 'classes', 'class_sections', 'class_requirements')
      and privilege_type in ('INSERT', 'UPDATE', 'DELETE')), 0);

-- ---------- 2) progresso operacional: SEMPRE por clube (club_id NOT NULL + FK + RLS) ----------
select t.eq('member_classes/member_requirements/requirement_approvals/investiture_reviews têm club_id NOT NULL',
  (select count(*) from pg_attribute a join pg_class c on c.oid = a.attrelid
    where c.relnamespace = 'public'::regnamespace and a.attname = 'club_id' and a.attnotnull and not a.attisdropped
      and c.relname in ('member_classes', 'member_requirements', 'requirement_approvals', 'investiture_reviews')), 4);
select t.eq('e o club_id delas aponta pra organizational_units (FK)',
  (select count(*) from pg_class c join pg_attribute a on a.attrelid = c.oid and a.attname = 'club_id' and not a.attisdropped
    where c.relnamespace = 'public'::regnamespace
      and c.relname in ('member_classes', 'member_requirements', 'requirement_approvals', 'investiture_reviews')
      and exists (select 1 from pg_constraint k where k.conrelid = c.oid and k.contype = 'f'
                    and k.confrelid = 'public.organizational_units'::regclass and a.attnum = any(k.conkey))), 4);
select t.eq('as 4 tabelas de progresso têm RLS ligado',
  (select count(*) from pg_class c where c.relnamespace = 'public'::regnamespace and c.relrowsecurity
    and c.relname in ('member_classes', 'member_requirements', 'requirement_approvals', 'investiture_reviews')), 4);
select t.eq('authenticated NÃO grava direto nas 4 tabelas de progresso (só RPC security definer escreve)',
  (select count(*) from information_schema.table_privileges
    where table_schema = 'public' and grantee = 'authenticated'
      and table_name in ('member_classes', 'member_requirements', 'requirement_approvals', 'investiture_reviews')
      and privilege_type in ('INSERT', 'UPDATE', 'DELETE')), 0);

-- ---------- 3) as 9 RPCs existem, com EXECUTE só para authenticated (nunca anon) ----------
select t.eq('as 9 RPCs do motor curricular existem',
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('classes_disponiveis', 'classe_iniciar', 'classe_atribuir', 'minha_classe',
      'requisito_salvar', 'requisito_enviar', 'classe_avaliacoes_pendentes', 'requisito_avaliar', 'investidura_confirmar')), 9);
select t.eq('nenhuma delas é executável por anon',
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('classes_disponiveis', 'classe_iniciar', 'classe_atribuir', 'minha_classe',
      'requisito_salvar', 'requisito_enviar', 'classe_avaliacoes_pendentes', 'requisito_avaliar', 'investidura_confirmar')
      and has_function_privilege('anon', p.oid, 'execute')), 0);

-- ---------- 4) os 2 gatilhos (escopo derivado + conclusão automática) existem ----------
-- definir_escopo_progresso() é GENÉRICO desde a migration 37 (mesmo idioma de definir_club_por_usuario):
-- reusado por member_requirements (classe) E member_specialty_requirements (especialidade) — ver teste 33.
select t.eq('member_requirements deriva usuario_id/club_id de member_class_id (nunca aceita do cliente)',
  (select count(*) from pg_trigger tg join pg_class c on c.oid = tg.tgrelid join pg_proc p on p.oid = tg.tgfoid
    where c.relname = 'member_requirements' and p.proname = 'definir_escopo_progresso' and not tg.tgisinternal), 1);
select t.eq('a classe conclui e abre a revisão de investidura sozinha (gatilho de conclusão)',
  (select count(*) from pg_trigger tg join pg_class c on c.oid = tg.tgrelid join pg_proc p on p.oid = tg.tgfoid
    where c.relname = 'member_requirements' and p.proname = 'avaliar_conclusao_classe' and not tg.tgisinternal), 1);

-- ---------- 5) a classe piloto continua marcada como dado de TESTE (nunca vira "oficial" por acidente) ----------
select t.eq('a versão curricular piloto é origem=''piloto_teste'', publicada, e traz a fonte_descricao avisando que não é oficial',
  (select count(*) from public.curriculum_versions
    where identificador = 'piloto-motor-curricular' and origem = 'piloto_teste' and status = 'publicado'
      and fonte_descricao ilike '%NÃO é o regulamento oficial%'), 1);
select t.eq('a classe piloto tem 3 seções e 7 requisitos ativos (6 da fase 1 + 1 novo com dependência de especialidade, migration 37)',
  (select count(*) from public.class_requirements r join public.class_sections s on s.id = r.section_id
    where s.class_id = '00000000-0000-4000-a000-000000000002'::uuid and r.ativo), 7);

-- ---------- 6) o recurso "classes" existe no catálogo, desligado por padrão (como o leilão) ----------
select t.eq('recursos_catalogo tem "classes", padrao=false', (select count(*) from public.recursos_catalogo where chave = 'classes' and padrao = false), 1);

select t.fim();
rollback;
