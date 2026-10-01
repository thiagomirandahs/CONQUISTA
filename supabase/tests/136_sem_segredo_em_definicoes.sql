-- Fase 9 / migration 528 — nenhum JWT/segredo LITERAL pode morar na definição de gatilho, função, view ou job do banco; o webhook legado
-- `push-notificacoes` (com service_role na definição, sempre 401) foi retirado; o push segue pelo caminho do cofre (Vault).
begin;
\ir _lib.sql

create function t.jwt_literais() returns bigint language sql stable as $$
  select count(*) from (
    select pg_get_triggerdef(tg.oid) txt from pg_trigger tg join pg_class c on c.oid = tg.tgrelid where not tg.tgisinternal
    union all select p.prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname not in ('pg_catalog', 'information_schema')
    union all select definition from pg_views where schemaname not in ('pg_catalog', 'information_schema')
  ) a where txt ~ 'eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.' $$;

select t.eq('nenhum JWT literal em gatilhos/funções/views', t.jwt_literais(), 0::bigint);

-- controle negativo: o detector NÃO é vazio — um segredo plantado numa função é achado
create function t.plantado() returns text language sql as $$ select 'Bearer eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.assinatura_falsa_para_teste' $$;
select t.eq('detector acha um JWT plantado (controle negativo)', t.jwt_literais(), 1::bigint);

select t.ok('webhook legado push-notificacoes não existe em notificacoes',
  not exists (select 1 from pg_trigger tg join pg_class c on c.oid = tg.tgrelid where c.relname = 'notificacoes' and tg.tgname = 'push-notificacoes'));
select t.ok('push segue pelo cofre: _push_disparar lê o Vault e usa o cabeçalho x-push-webhook-secret',
  (select prosrc ~ 'vault\.decrypted_secrets' and prosrc ~ 'x-push-webhook-secret' and prosrc !~ 'eyJ' from pg_proc where oid = 'public._push_disparar'::regproc));
select t.ok('gatilho trg_notificacao_push segue ativo', exists (select 1 from pg_trigger tg join pg_class c on c.oid = tg.tgrelid where c.relname = 'notificacoes' and tg.tgname = 'trg_notificacao_push' and tg.tgenabled = 'O'));
select t.fim();
rollback;
