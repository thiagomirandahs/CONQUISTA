-- =============================================================================
--  Biblioteca de testes (incluída por cada teste com:  \ir _lib.sql).
--  Tudo vive no schema "t", criado DENTRO da transação do teste — o ROLLBACK
--  final apaga tudo. Convenção de um teste:
--      begin;  \ir _lib.sql  \ir _fixtures.sql
--      ...asserts...
--      select t.fim();  rollback;
--  t.fim() levanta erro "FALHOU ..." se algum assert falhou (psql sai != 0).
-- =============================================================================
create schema t;
grant usage on schema t to public;
-- funções que os testes criarem depois também precisam ser executáveis por quem for "logado" no teste
-- (o default privilege GLOBAL das migrations tira o PUBLIC implícito das funções novas)
alter default privileges in schema t grant execute on functions to public;

create table t.res (id serial primary key, nome text, ok boolean, detalhe text);
grant all on t.res to public;
grant usage, select on sequence t.res_id_seq to public;

-- mapa chave -> uuid (usuários, clubes, unidades e registros dos fixtures)
create table t.ids (chave text primary key, id uuid not null);
grant select on t.ids to public;

create function t.registrar(p_nome text, p_ok boolean, p_detalhe text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  insert into t.res (nome, ok, detalhe) values (p_nome, coalesce(p_ok, false), p_detalhe);
end $$;

create function t.id(p_chave text) returns uuid
language sql stable security definer set search_path = '' as $$
  select id from t.ids where chave = p_chave;
$$;

-- ---------- asserts ----------
create function t.ok(p_nome text, p_cond boolean) returns void language sql as $$
  select t.registrar(p_nome, p_cond, 'condição = ' || coalesce(p_cond::text, 'null'));
$$;
create function t.eq(p_nome text, p_got bigint, p_want bigint) returns void language sql as $$
  select t.registrar(p_nome, p_got is not distinct from p_want, 'obtido=' || coalesce(p_got::text, 'null') || ' esperado=' || coalesce(p_want::text, 'null'));
$$;
create function t.eq(p_nome text, p_got text, p_want text) returns void language sql as $$
  select t.registrar(p_nome, p_got is not distinct from p_want, 'obtido=' || coalesce(p_got, 'null') || ' esperado=' || coalesce(p_want, 'null'));
$$;
create function t.eq(p_nome text, p_got boolean, p_want boolean) returns void language sql as $$
  select t.registrar(p_nome, p_got is not distinct from p_want, 'obtido=' || coalesce(p_got::text, 'null') || ' esperado=' || coalesce(p_want::text, 'null'));
$$;
create function t.eq(p_nome text, p_got uuid, p_want uuid) returns void language sql as $$
  select t.registrar(p_nome, p_got is not distinct from p_want, 'obtido=' || coalesce(p_got::text, 'null') || ' esperado=' || coalesce(p_want::text, 'null'));
$$;

-- Espera que o SQL LANCE erro (opcionalmente com trecho da mensagem). Roda como o papel ATUAL.
create function t.throws(p_nome text, p_sql text, p_trecho text default null) returns void
language plpgsql as $$
declare v_msg text;
begin
  begin
    execute p_sql;
  exception when others then
    v_msg := sqlerrm;
  end;
  if v_msg is null then
    perform t.registrar(p_nome, false, 'não lançou erro');
  else
    perform t.registrar(p_nome, p_trecho is null or v_msg ilike '%' || p_trecho || '%', 'erro=' || v_msg || coalesce(' esperado~' || p_trecho, ''));
  end if;
end $$;

-- Espera que a operação seja BLOQUEADA: erro OU 0 linhas afetadas/retornadas (RLS filtra em silêncio).
create function t.bloqueado(p_nome text, p_sql text) returns void
language plpgsql as $$
declare v_n bigint; v_msg text;
begin
  begin
    execute p_sql;
    get diagnostics v_n = row_count;
  exception when others then
    v_msg := sqlerrm;
  end;
  perform t.registrar(p_nome, v_msg is not null or v_n = 0,
    case when v_msg is not null then 'bloqueado por erro: ' || v_msg else 'linhas=' || coalesce(v_n::text, 'null') || ' (esperado 0 ou erro)' end);
end $$;

-- Executa e ENGOLE o erro (para tentativas de ataque cujo efeito conferimos depois, pelo ESTADO).
create function t.tenta(p_sql text) returns void language plpgsql as $$
begin
  begin execute p_sql; exception when others then null; end;
end $$;

-- Espera que a operação FUNCIONE e afete/retorne pelo menos p_min linhas.
create function t.permitido(p_nome text, p_sql text, p_min bigint default 1) returns void
language plpgsql as $$
declare v_n bigint; v_msg text;
begin
  begin
    execute p_sql;
    get diagnostics v_n = row_count;
  exception when others then
    v_msg := sqlerrm;
  end;
  perform t.registrar(p_nome, v_msg is null and v_n >= p_min,
    case when v_msg is not null then 'falhou com erro: ' || v_msg else 'linhas=' || v_n || ' (esperado >= ' || p_min || ')' end);
end $$;

-- ---------- leituras que NÃO derrubam o teste (rodam como o papel ATUAL) ----------
-- t.n(sql)  : escalar bigint; -1 se der erro (falha qualquer igualdade esperada >= 0)
-- t.nv(sql) : escalar bigint; 0 se der erro (permissão negada = "nada visível")
-- t.txt(sql): escalar texto; 'ERRO: ...' se der erro
create function t.n(p_sql text) returns bigint language plpgsql as $$
declare v bigint;
begin execute p_sql into v; return v; exception when others then return -1; end $$;
create function t.nv(p_sql text) returns bigint language plpgsql as $$
declare v bigint;
begin execute p_sql into v; return coalesce(v, 0); exception when others then return 0; end $$;
create function t.txt(p_sql text) returns text language plpgsql as $$
declare v text;
begin execute p_sql into v; return v; exception when others then return 'ERRO: ' || sqlerrm; end $$;

-- ---------- troca de papel/sessão (simula o JWT do PostgREST) ----------
create function t.como(p_uid uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claim.sub', p_uid::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.headers', '{}', true);  -- cada troca de "quem está logado" começa sem clube pedido
  set local role authenticated;
end $$;
create function t.como(p_chave text) returns void language sql as $$ select t.como(t.id(p_chave)); $$;

-- ---------- clube pedido pelo cliente (simula o header x-clube-atual do PostgREST) ----------
-- Representa uma REQUISIÇÃO pedindo pra agir num clube específico (a "aba" que escolheu esse
-- clube). clube_atual_id() só HONRA se corresponder a um vínculo ativo real de quem chama.
create function t.pedir_clube(p_club_id uuid) returns void language plpgsql as $$
begin
  perform set_config('request.headers', json_build_object('x-clube-atual', p_club_id::text)::text, true);
end $$;
create function t.pedir_clube(p_chave text) returns void language sql as $$ select t.pedir_clube(t.id(p_chave)); $$;
create function t.esquecer_clube_pedido() returns void language plpgsql as $$
begin
  perform set_config('request.headers', '{}', true);
end $$;

create function t.como_anon() returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claim.role', 'anon', true);
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  set local role anon;
end $$;

-- postgres SEM sessão de usuário: é exatamente o contexto do pg_cron (auth.uid() = null)
create function t.como_cron() returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claim.role', '', true);
  perform set_config('request.jwt.claims', '', true);
end $$;

create function t.como_service() returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claim.role', 'service_role', true);
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  set local role service_role;
end $$;

-- cadastro público de verdade: insere em auth.users e deixa o gatilho handle_new_user agir
create function t.signup(p_chave text, p_meta jsonb) returns uuid language plpgsql as $$
declare v_id uuid := md5('cq-test:' || p_chave)::uuid;
begin
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token,
    email_change_token_new, email_change, phone_change, phone_change_token, email_change_token_current,
    reauthentication_token, is_sso_user, is_anonymous)
  values ('00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated',
    p_chave || '@teste.local', extensions.crypt('senha', extensions.gen_salt('bf')), now(),
    '{}'::jsonb, p_meta, now(), now(), '', '', '', '', '', '', '', '', false, false);
  insert into t.ids (chave, id) values (p_chave, v_id);
  return v_id;
end $$;

-- ---------- fim ----------
create function t.fim() returns text language plpgsql as $$
declare v_total int; v_falhas text;
begin
  reset role;
  select count(*) into v_total from t.res;
  select string_agg('  - ' || nome || '  [' || coalesce(detalhe, '') || ']', E'\n' order by id)
    into v_falhas from t.res where not ok;
  if v_falhas is not null then
    raise exception E'FALHOU: % de % asserts:\n%', (select count(*) from t.res where not ok), v_total, v_falhas;
  end if;
  return 'ok  - ' || v_total || ' asserts';
end $$;
grant execute on all functions in schema t to public;
