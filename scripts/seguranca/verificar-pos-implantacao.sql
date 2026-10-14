-- SOMENTE LEITURA. Não retorna registros pessoais ou credenciais.
select 'migrations' as verificacao, arquivo as objeto,
       aplicada_em::text as resultado
from public.migracoes_aplicadas
where arquivo in ('2026-10-14-auditoria-superficie-anonima.sql',
                  '2026-10-14-autoridade-vigente-e-protecao-dados.sql')
union all
select 'view_chat', c.relname,
       coalesce(('security_invoker=true' = any(c.reloptions))::text, 'false')
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relname='chat_mensagens_visiveis'
union all
select 'acesso_anonimo_direto', c.relname, 'REVISAR: privilégio direto encontrado'
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relkind in ('r','p','v','m')
  and (has_table_privilege('anon',c.oid,'select,insert,update,delete')
       or has_any_column_privilege('anon',c.oid,'select,insert,update'))
union all
select 'helper_privado_exposto', p.oid::regprocedure::text,
       'REVISAR: execução concedida a cliente'
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public'
  and (p.proname like '\_anon\_%' escape '\'
       or p.proname like '\_seg549\_%' escape '\')
  and (has_function_privilege('anon',p.oid,'execute')
       or has_function_privilege('authenticated',p.oid,'execute'))
union all
select 'criar_objetos', r.papel,
       has_schema_privilege(r.papel,'public','create')::text
from unnest(array['anon','authenticated']) as r(papel)
order by verificacao,objeto;
