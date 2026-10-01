-- AUDITORIA (somente leitura) — procura JWT/segredo LITERAL nas definições do banco, SEM imprimir o valor.
-- Mostra tipo, objeto e o `role` decodificado do payload do JWT (anon/service_role/authenticated) e se há `ref` (projeto).
-- Uso: psql "$DB_URL" -X -q -A -t -F' | ' -f scripts/auditoria-segredos-em-definicoes.sql   (esperado após a 528: nenhuma linha)
with achados as (
  select 'trigger' tipo, c.relnamespace::regnamespace::text || '.' || c.relname || ' / ' || t.tgname obj, pg_get_triggerdef(t.oid) txt
    from pg_trigger t join pg_class c on c.oid = t.tgrelid where not t.tgisinternal
  union all select 'funcao', n.nspname || '.' || p.proname, p.prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname not in ('pg_catalog', 'information_schema')
  union all select 'view', schemaname || '.' || viewname, definition from pg_views where schemaname not in ('pg_catalog', 'information_schema')
  union all select 'cron', 'cron.job ' || jobid, command from cron.job
), jw as (
  select tipo, obj, (regexp_match(txt, 'eyJ[A-Za-z0-9_-]{10,}\.([A-Za-z0-9_-]{10,})\.'))[1] pl from achados where txt ~ 'eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.'
)
select tipo, obj,
       (convert_from(decode(rpad(translate(pl, '-_', '+/'), ((length(pl) + 3) / 4) * 4, '='), 'base64'), 'UTF8')::jsonb) ->> 'role' as role_do_jwt
  from jw;
