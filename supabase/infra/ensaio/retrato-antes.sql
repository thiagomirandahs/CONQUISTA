-- =====================================================================
-- ENSAIO DE PRODUÇÃO — o RETRATO DE ANTES (fase 9.1, item 3).
--
-- Roda SÓ na cópia descartável, logo depois do restore e ANTES de qualquer migration. Copia cada
-- tabela do `public` (e os recortes de auth/storage/cron que importam) para o schema `ensaio_antes`,
-- linha por linha. Depois das migrations, `diferencas.sql` compara linha a linha: o que sumiu, o que
-- apareceu e, coluna por coluna, o que mudou. Contar linhas não basta — uma migration pode manter a
-- contagem e trocar o conteúdo (é a F2 do runbook: "Success" e dado estragado).
--
-- Nunca rode isto em produção: cria um schema e duplica os dados. O `ensaio-producao.mjs` só o
-- executa no container do ambiente descartável.
-- =====================================================================
\set ON_ERROR_STOP on
drop schema if exists ensaio_antes cascade;
create schema ensaio_antes;
revoke all on schema ensaio_antes from public;

-- copia → origem, e a chave primária da origem (sem chave: compara a linha inteira)
create table ensaio_antes._copias (copia text primary key, origem_schema text not null, origem_tabela text not null, chave text[]);

do $$
declare
  r record; v_pk text[]; v_cols text;
  -- recortes fora do public: só colunas que o upgrade não tem motivo para tocar
  v_extra constant jsonb := jsonb_build_object(
    'auth__users',       jsonb_build_array('auth', 'users', 'id, email, encrypted_password, email_confirmed_at, phone, raw_user_meta_data, banned_until, deleted_at, is_anonymous'),
    'auth__identities',  jsonb_build_array('auth', 'identities', 'id, user_id, provider, provider_id'),
    'storage__buckets',  jsonb_build_array('storage', 'buckets', '*'),
    'storage__objects',  jsonb_build_array('storage', 'objects', 'id, bucket_id, name, owner, owner_id, metadata'),
    'cron__job',         jsonb_build_array('cron', 'job', 'jobid, jobname, schedule, command, active'));
  k text;
begin
  for r in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' and c.relkind = 'r' order by 1 loop
    execute format('create table ensaio_antes.%I as select * from public.%I', r.relname, r.relname);
    select array_agg(a.attname::text order by array_position(i.indkey::int2[], a.attnum)) into v_pk
      from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any (i.indkey)
     where i.indrelid = format('public.%I', r.relname)::regclass and i.indisprimary;
    insert into ensaio_antes._copias values (r.relname, 'public', r.relname, v_pk);
  end loop;

  for k in select jsonb_object_keys(v_extra) loop
    continue when to_regclass(format('%I.%I', v_extra->k->>0, v_extra->k->>1)) is null;   -- ex.: projeto sem pg_cron
    v_cols := v_extra->k->>2;
    execute format('create table ensaio_antes.%I as select %s from %I.%I', k, v_cols, v_extra->k->>0, v_extra->k->>1);
    select array_agg(a.attname::text order by array_position(i.indkey::int2[], a.attnum)) into v_pk
      from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any (i.indkey)
     where i.indrelid = format('%I.%I', v_extra->k->>0, v_extra->k->>1)::regclass and i.indisprimary;
    insert into ensaio_antes._copias values (k, v_extra->k->>0, v_extra->k->>1, v_pk);
  end loop;
  -- um job de cron se reconhece pelo NOME: desagendar e agendar de novo troca o jobid
  update ensaio_antes._copias set chave = array['jobname'] where copia = 'cron__job';
end $$;

-- as regras que EXPLICAM diferenças (preenchidas pelo ensaio a partir de scripts/lib/ensaio-regras.mjs)
create table ensaio_antes._regras (id serial primary key, copia text not null, tipo text not null check (tipo in ('removida', 'adicionada', 'alterada')),
  coluna text, onde text not null, motivo text not null, migration text not null);

select json_object_agg(copia, n order by copia) from (
  select c.copia, (xpath('/row/n/text()', query_to_xml(format('select count(*) as n from ensaio_antes.%I', c.copia), false, true, '')))[1]::text::bigint as n
  from ensaio_antes._copias c
) x;
