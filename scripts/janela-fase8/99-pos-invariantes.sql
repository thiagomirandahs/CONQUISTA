-- JANELA FASE 8 — INVARIANTES (somente leitura). Cada linha: "OK ..." ou "FALHOU ...". Rode depois de CADA migration.
\set ON_ERROR_STOP on
begin read only;
-- 1) toda tabela do schema public tem RLS ligada
select case when count(*) = 0 then 'OK   rls: todas as tabelas public têm RLS' else 'FALHOU rls: sem RLS em ' || string_agg(relname, ', ') end
  from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and not c.relrowsecurity;
-- 2) nenhuma função SECURITY DEFINER sem search_path fixo
select case when count(*) = 0 then 'OK   definer: todas com search_path fixo' else 'FALHOU definer sem search_path: ' || string_agg(proname, ', ') end
  from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prosecdef and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%');
-- 3) anon só executa as RPCs públicas intencionais
select case when count(*) = 0 then 'OK   anon: só as RPCs públicas intencionais' else 'FALHOU anon executa: ' || string_agg(proname, ', ') end
  from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f' and has_function_privilege('anon', p.oid, 'execute') and proname !~ '^(_|pg_)'
   and proname not in ('convite_hierarquia_abrir', 'documento_verificar', 'entrada_abrir_publico', 'manutencao_estado', 'parceiros_publico', 'planos_disponiveis', 'vitrine_clube_publico', 'vitrine_clubes_publico');
-- 4) anon sem escrita direta em tabela
select case when count(*) = 0 then 'OK   grants: anon sem INSERT/UPDATE/DELETE' else 'FALHOU anon com escrita direta em ' || string_agg(distinct table_name, ', ') end
  from information_schema.role_table_grants where table_schema = 'public' and grantee = 'anon' and privilege_type in ('INSERT', 'UPDATE', 'DELETE');
-- 5) existência por etapa (só exige o que o ledger já diz estar aplicado)
with l as (select version from supabase_migrations.schema_migrations)
select case when ok then 'OK   ' || item else 'FALHOU ' || item end from (
  select '514 leitura_materiais/minha_jornada' as item, to_regclass('public.leitura_materiais') is not null and to_regprocedure('public.minha_jornada()') is not null as ok, '20260930000514' as v
  union all select '515 comunidade_posts.alcance + plataforma_acesso_log', exists (select 1 from information_schema.columns where table_name = 'comunidade_posts' and column_name = 'alcance') and to_regclass('public.plataforma_acesso_log') is not null, '20260930000515'
  union all select '516 audiolivros sem fonte desligados', not exists (select 1 from public.audiolivros where titulo in ('Expedição Galápagos', 'O Fim do Começo') and ativo), '20260930000516'
  union all select '517 rede_conquistas_publicaveis', to_regprocedure('public.rede_conquistas_publicaveis(text)') is not null, '20260930000517'
  union all select '518 classes_disponiveis com bloqueio/anterior (função existe)', to_regprocedure('public._classe_eh_anterior(uuid,uuid)') is not null, '20260930000518'
  union all select '519 classes_concluidas_anteriormente', to_regprocedure('public.classes_concluidas_anteriormente()') is not null, '20260930000519'
  union all select '520 relato_salvar', to_regprocedure('public.requisito_relato_salvar(uuid,text)') is not null and exists (select 1 from information_schema.columns where table_name = 'member_requirements' and column_name = 'relato'), '20260930000520'
  union all select '521 registro de conclusão anterior + log', to_regprocedure('public.classe_concluida_anteriormente_registrar(uuid,uuid,date,boolean,text,text)') is not null and to_regclass('public.class_prior_completion_log') is not null, '20260930000521'
  union all select '522 prévia de atualização + equivalências (vazia)', to_regprocedure('public.classe_atualizacao_previa(uuid)') is not null and to_regclass('public.class_requirement_equivalencias') is not null, '20260930000522'
  union all select '523 matrícula equivalente', to_regprocedure('public._classe_matricula_equivalente(uuid,uuid,uuid)') is not null, '20260930000523'
  union all select '524 fila unificada', to_regprocedure('public.fila_avaliacao_unificada(text,uuid)') is not null, '20260930000524'
  union all select '525 reconhecimentos de conclusão', to_regclass('public.class_completion_recognitions') is not null, '20260930000525'
  union all select '526 (mensagem) classe_iniciar existe', to_regprocedure('public.classe_iniciar(uuid)') is not null, '20260930000526'
  union all select '527 índice único de conquista ativa', exists (select 1 from pg_indexes where tablename = 'curriculum_achievements' and indexdef ilike '%classe_codigo%'), '20260930000527'
) x where v in (select version from l);
-- 6) ledger sem buracos fora da ordem da janela (informativo)
select 'INFO ledger_max = ' || max(version) from supabase_migrations.schema_migrations;
commit;
