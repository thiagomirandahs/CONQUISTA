-- Teste de CONTRATO (estrutural) da fase 2 do motor curricular: Especialidades +
-- dependências declarativas + preparação do catálogo oficial (migration 37).
begin;
\ir _lib.sql
\ir _fixtures.sql

-- ---------- 1) catálogo de especialidades: conteúdo da PLATAFORMA (sem club_id) ----------
select t.eq('specialties/specialty_requirements existem', (select count(*) from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
    and c.relname in ('specialties', 'specialty_requirements')), 2);
select t.eq('as 2 tabelas do catálogo de especialidade têm RLS ligado', (select count(*) from pg_class c where c.relnamespace = 'public'::regnamespace and c.relrowsecurity
    and c.relname in ('specialties', 'specialty_requirements')), 2);
select t.eq('authenticated NÃO grava no catálogo de especialidade — só lê', (select count(*) from information_schema.table_privileges
    where table_schema = 'public' and grantee = 'authenticated' and table_name in ('specialties', 'specialty_requirements')
      and privilege_type in ('INSERT', 'UPDATE', 'DELETE')), 0);

-- ---------- 2) progresso de especialidade: SEMPRE por clube ----------
select t.eq('specialty_offerings/member_specialties/member_specialty_requirements têm club_id NOT NULL',
  (select count(*) from pg_attribute a join pg_class c on c.oid = a.attrelid
    where c.relnamespace = 'public'::regnamespace and a.attname = 'club_id' and a.attnotnull and not a.attisdropped
      and c.relname in ('specialty_offerings', 'member_specialties', 'member_specialty_requirements')), 3);
select t.eq('e o club_id delas aponta pra organizational_units (FK)',
  (select count(*) from pg_class c join pg_attribute a on a.attrelid = c.oid and a.attname = 'club_id' and not a.attisdropped
    where c.relnamespace = 'public'::regnamespace and c.relname in ('specialty_offerings', 'member_specialties', 'member_specialty_requirements')
      and exists (select 1 from pg_constraint k where k.conrelid = c.oid and k.contype = 'f'
                    and k.confrelid = 'public.organizational_units'::regclass and a.attnum = any(k.conkey))), 3);
select t.eq('as 3 tabelas de progresso de especialidade têm RLS ligado',
  (select count(*) from pg_class c where c.relnamespace = 'public'::regnamespace and c.relrowsecurity
    and c.relname in ('specialty_offerings', 'member_specialties', 'member_specialty_requirements')), 3);
select t.eq('authenticated NÃO grava direto em member_specialties/member_specialty_requirements (só RPC escreve)',
  (select count(*) from information_schema.table_privileges
    where table_schema = 'public' and grantee = 'authenticated' and table_name in ('member_specialties', 'member_specialty_requirements')
      and privilege_type in ('INSERT', 'UPDATE', 'DELETE')), 0);

-- ---------- 3) reuso de verdade (não duplicação): o gatilho de escopo é GENÉRICO e serve às duas tabelas ----------
select t.eq('definir_escopo_progresso() é usado por member_requirements E member_specialty_requirements (reuso, não duplicação)',
  (select count(*) from pg_trigger tg join pg_class c on c.oid = tg.tgrelid join pg_proc p on p.oid = tg.tgfoid
    where p.proname = 'definir_escopo_progresso' and not tg.tgisinternal
      and c.relname in ('member_requirements', 'member_specialty_requirements')), 2);
select t.eq('requirement_approvals é reusado (POLIMÓRFICO: uma linha é de classe OU de especialidade, nunca as duas)',
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'requirement_approvals'
    and column_name in ('member_specialty_requirement_id', 'specialty_requirement_id')), 2);
select t.eq('...e o CHECK que garante "exatamente um alvo" existe', (select count(*) from pg_constraint
    where conrelid = 'public.requirement_approvals'::regclass and conname = 'requirement_approvals_alvo_exclusivo'), 1);
select t.eq('curriculum_versions é reusado por specialties (mesma tabela de classes, não uma versão paralela)',
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'specialties'
    and column_name = 'curriculum_version_id'), 1);

-- ---------- 4) rastreabilidade de importação (preparação do catálogo oficial) ----------
select t.eq('curriculum_versions ganhou as colunas de importação (hash, arquivo, quando, quem)',
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'curriculum_versions'
    and column_name in ('fonte_hash', 'fonte_arquivo', 'importado_em', 'importado_por')), 4);

-- ---------- 5) dependências declarativas: existem, são validadas, são checadas no SERVIDOR ----------
select t.eq('curriculum_dependencies existe, com RLS e leitura pública (autenticado)', (select count(*) from pg_class c
    where c.relnamespace = 'public'::regnamespace and c.relname = 'curriculum_dependencies' and c.relrowsecurity), 1);
select t.eq('authenticated NÃO grava em curriculum_dependencies (só migration/SQL direto)', (select count(*) from information_schema.table_privileges
    where table_schema = 'public' and grantee = 'authenticated' and table_name = 'curriculum_dependencies' and privilege_type in ('INSERT', 'UPDATE', 'DELETE')), 0);
select t.throws('uma dependência com alvo_id inexistente é recusada (gatilho de validação)',
  format($q$insert into public.curriculum_dependencies (alvo_tipo, alvo_id, depende_de_tipo, depende_de_id) values ('class_requirement', %L, 'specialty', %L)$q$,
    gen_random_uuid(), '00000000-0000-4000-a000-000000000102'::uuid),
  'não existe');
select t.throws('uma dependência circular (depende de si mesma) é recusada',
  format($q$insert into public.curriculum_dependencies (alvo_tipo, alvo_id, depende_de_tipo, depende_de_id) values ('specialty', %L, 'specialty', %L)$q$,
    '00000000-0000-4000-a000-000000000102'::uuid, '00000000-0000-4000-a000-000000000102'::uuid),
  'não pode depender de si mesma');
select t.eq('dependencias_pendentes() é executável por authenticated (o servidor decide, não o frontend)',
  has_function_privilege('authenticated', 'public.dependencias_pendentes(text,uuid,uuid,uuid)', 'execute'), true);

-- ---------- 6) as RPCs de especialidade existem, com EXECUTE só para authenticated ----------
select t.eq('as 9 RPCs de especialidade existem', (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('especialidades_disponiveis', 'especialidade_iniciar', 'especialidade_atribuir',
      'oferta_especialidade_criar', 'ofertas_especialidade_do_clube', 'minha_especialidade', 'especialidade_requisito_salvar',
      'especialidade_requisito_enviar', 'especialidade_avaliacoes_pendentes')), 9);
select t.eq('especialidade_requisito_avaliar (a RPC crítica) existe', (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'especialidade_requisito_avaliar'), 1);
select t.eq('nenhuma RPC de especialidade é executável por anon', (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('especialidades_disponiveis', 'especialidade_iniciar', 'especialidade_atribuir',
      'oferta_especialidade_criar', 'ofertas_especialidade_do_clube', 'minha_especialidade', 'especialidade_requisito_salvar',
      'especialidade_requisito_enviar', 'especialidade_avaliacoes_pendentes', 'especialidade_requisito_avaliar')
      and has_function_privilege('anon', p.oid, 'execute')), 0);

-- ---------- 7) o recurso "classes" agora bloqueia ESCRITA de verdade (achado da auditoria: só escondia a rota) ----------
select t.eq('classe_iniciar/requisito_avaliar/especialidade_iniciar citam o gate de recurso habilitado',
  (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace
    and p.proname in ('classe_iniciar', 'classe_atribuir', 'requisito_salvar', 'requisito_enviar', 'requisito_avaliar', 'investidura_confirmar',
                       'especialidade_iniciar', 'especialidade_atribuir', 'oferta_especialidade_criar',
                       'especialidade_requisito_salvar', 'especialidade_requisito_enviar', 'especialidade_requisito_avaliar')
    and pg_get_functiondef(p.oid) ~ '_exigir_classes_habilitado'), 12);

-- ---------- 8) ferramenta de diff entre versões existe e é executável ----------
select t.eq('comparar_versoes_curriculares existe e é executável por authenticated',
  has_function_privilege('authenticated', 'public.comparar_versoes_curriculares(uuid,uuid)', 'execute'), true);

-- ---------- 9) especialidade PILOTO continua marcada como dado de TESTE ----------
select t.eq('a especialidade piloto é origem=''piloto_teste'', publicada, com aviso de que não é oficial',
  (select count(*) from public.curriculum_versions where identificador = 'piloto-motor-curricular-especialidade'
    and origem = 'piloto_teste' and status = 'publicado' and fonte_descricao ilike '%NÃO é o regulamento oficial%'), 1);
select t.eq('a especialidade piloto tem 3 requisitos ativos', (select count(*) from public.specialty_requirements
    where specialty_id = '00000000-0000-4000-a000-000000000102'::uuid and ativo), 3);
select t.eq('existe 1 dependência de TESTE ligando o requisito novo da classe piloto à especialidade piloto',
  (select count(*) from public.curriculum_dependencies where depende_de_tipo = 'specialty' and depende_de_id = '00000000-0000-4000-a000-000000000102'::uuid), 1);

select t.fim();
rollback;
