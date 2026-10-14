-- SOMENTE LEITURA: executar com administração do banco. Não devolve registros pessoais.
-- 1. Tabelas/views expostas e situação de RLS/permissões (avaliar políticas separadamente).
select n.nspname as esquema,c.relname as objeto,c.relkind,c.relrowsecurity as rls,
  has_table_privilege('authenticated',c.oid,'select,insert,update,delete') as acesso_autenticado,
  has_any_column_privilege('authenticated',c.oid,'select,insert,update') as acesso_por_coluna,
  has_table_privilege('anon',c.oid,'select,insert,update,delete') as acesso_anonimo
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname in ('public','storage') and c.relkind in ('r','p','v','m')
order by n.nspname,c.relname;

-- 2. Políticas atuais: precisa conferir cargos, vínculo válido e clube em cada expressão.
select schemaname,tablename,policyname,permissive,roles,cmd,qual,with_check
from pg_policies where schemaname in ('public','storage')
order by schemaname,tablename,policyname;

-- 3. Funções privilegiadas executáveis como usuário: só nome/configuração, não corpo.
select p.oid::regprocedure::text as funcao,p.prosecdef,p.proconfig
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.prosecdef and has_function_privilege('authenticated',p.oid,'execute')
order by 1;

-- 4. Usuário do app não precisa criar funções/tabelas próprias no schema da API.
select r,has_schema_privilege(r,'public','create') as pode_criar_objetos
from unnest(array['anon','authenticated']) r;

-- 5. Buckets: somente publico e parceiros foram desenhados como públicos.
select id,public,file_size_limit,allowed_mime_types from storage.buckets order by id;

-- 6. Presença de segredo literal em DEFINIÇÕES: somente sinaliza o objeto; nunca mostra o valor.
select 'funcao' as tipo,p.oid::regprocedure::text as objeto
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname not in ('pg_catalog','information_schema')
  and p.prosrc ~ '(eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}|sb_secret_[A-Za-z0-9_-]{15,}|-----BEGIN (RSA |EC )?PRIVATE KEY-----)'
union all
select 'gatilho',t.tgname||' em '||t.tgrelid::regclass::text
from pg_trigger t where not t.tgisinternal
  and pg_get_triggerdef(t.oid) ~ '(eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}|sb_secret_[A-Za-z0-9_-]{15,})';

-- 7. Confirma as migrations desta rodada sem conteúdo pessoal.
select arquivo,aplicada_em from public.migracoes_aplicadas
where arquivo in ('2026-10-14-auditoria-superficie-anonima.sql',
  '2026-10-14-autoridade-vigente-e-protecao-dados.sql') order by arquivo;

-- 8. Fatores verificados dos admins: apenas contagem, não identidade/segredo.
-- Ter fator cadastrado não comprova exigência de MFA no servidor.
select count(*) as admins_ativos,
  count(*) filter(where exists(select 1 from auth.mfa_factors f where f.user_id=a.user_id and f.status='verified')) as com_fator_verificado,
  count(*) filter(where not exists(select 1 from auth.mfa_factors f where f.user_id=a.user_id and f.status='verified')) as sem_fator_verificado
from public.platform_admins a where a.ativo;
