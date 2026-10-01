-- AUDITORIA PÓS-DEPLOY — permissões do Admin SaaS (SOMENTE LEITURA na prática: transação que termina em ROLLBACK).
-- Simula a identidade (JWT) de: platform_admin, diretoria, desbravador e conta sem vínculo, e chama as RPCs admin_* de LEITURA sem argumentos.
-- Não usa senha de ninguém; não contorna autenticação (testa o que o SERVIDOR responde para cada papel). Sem sessão real = visual PENDENTE.
-- Uso:  psql "$DB_URL_PRODUCAO" -X -q -A -t -f scripts/janela-fase8/auditoria-admin-permissoes.sql 2>&1 | grep 'R|' | sort | uniq -c
\set ON_ERROR_STOP on
begin;
do $$
declare ids record; f record; n int; msg text; st text;
begin
  for ids in
    (select 'platform_admin' as p, user_id as u from public.platform_admins limit 1)
    union all
    (select 'diretoria', user_id from public.organization_memberships where role = 'diretoria' and status = 'ativo' and user_id not in (select user_id from public.platform_admins) limit 1)
    union all
    (select 'desbravador', user_id from public.organization_memberships where role = 'desbravador' and status = 'ativo' and user_id not in (select user_id from public.platform_admins) limit 1)
    union all
    (select 'sem_vinculo', id from auth.users where id not in (select user_id from public.organization_memberships) and id not in (select user_id from public.platform_admins) limit 1)
  loop
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', ids.u, 'role', 'authenticated')::text, true);
    for f in select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.proname ~ '^admin_' and p.pronargs = 0
                and p.proname ~ '(listar|pendencias|contagem|painel|hierarquia|armazenamento|planos_recursos|termos|config)$' order by 1 loop
      begin
        execute format('select count(*) from (select * from public.%I()) s', f.proname) into n;
        raise notice 'R|%|PERMITIDO', ids.p;
      exception when others then
        get stacked diagnostics msg = message_text;
        st := sqlstate;
        raise notice 'R|%|%', ids.p, case when st in ('42501', 'P0001') or msg ~* '(permiss|negad|admin|autoriz|acesso)' then 'NEGADO' else 'ERRO ' || st || ' ' || left(msg, 40) || ' @' || f.proname end;
      end;
    end loop;
    execute 'reset role';
  end loop;
end $$;
rollback;
