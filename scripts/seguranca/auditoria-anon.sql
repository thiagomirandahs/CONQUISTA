-- SOMENTE LEITURA. Executar no SQL Editor de produção para conferir o estado real.
-- Não inclui nomes, tokens, fotos, segredos ou conteúdo de pessoas.
select n.nspname as esquema,p.oid::regprocedure::text as funcao,p.prosecdef as security_definer
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and has_function_privilege('anon',p.oid,'execute')
order by 1,2;

select n.nspname as esquema,c.relname as objeto,c.relrowsecurity as rls,
  has_table_privilege('anon',c.oid,'select') or has_any_column_privilege('anon',c.oid,'select') as leitura,
  has_table_privilege('anon',c.oid,'insert') as insercao,
  has_table_privilege('anon',c.oid,'update') as alteracao,
  has_table_privilege('anon',c.oid,'delete') as exclusao
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relkind in ('r','p','v','m')
  and (has_table_privilege('anon',c.oid,'select,insert,update,delete')
       or has_any_column_privilege('anon',c.oid,'select'))
order by 1,2;

select schemaname,tablename,policyname,roles,cmd,qual,with_check
from pg_policies where schemaname in ('public','storage') and (roles && array['anon','public']::name[])
order by schemaname,tablename,policyname;

select id,public,file_size_limit,allowed_mime_types from storage.buckets order by id;
