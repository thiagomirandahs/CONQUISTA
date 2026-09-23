-- =============================================================================
--  Fase 8.1 — BENCHMARK DO CHAT: as três consultas reais, antiga x nova.
--
--  A Fase 8 mediu o chat com UMA consulta que juntava conversa e mensagens (9.111 buffers).
--  Ao implementar a correção ficou claro que o app não faz isso: `src/services/chat.js` faz
--  DUAS idas ao servidor. Então o benchmark honesto mede as três formas:
--
--    (1) ACHAR A CONVERSA   select id from chat_conversas where tipo='geral'
--        É a consulta que escala com o NÚMERO DE CLUBES do banco, não com o histórico:
--        a RLS precisa decidir, para cada conversa existente na instalação inteira, se esta
--        pessoa a alcança. Com a policy antiga isso era uma chamada de função por conversa.
--
--    (2) LER A PÁGINA       from chat_mensagens_visiveis where conversa_id = X
--                           order by created_at desc limit 300
--        É o que o app realmente pede (LIMITE_MENSAGENS = 300). Escala com o HISTÓRICO
--        da conversa se a policy não deixar o índice trabalhar.
--
--    (3) A FORMA DA FASE 8  o join conversa+mensagens, mantido só para comparar com a baseline
--        publicada em PRODUCTION-READINESS.md §4 e fechar a série.
--
--  As duas implementações rodam no MESMO banco, com os MESMOS dados, na mesma sessão.
--  O script termina restaurando as policies da migration 51.
--
--  Uso:  docker exec -i <container> psql -U postgres -f /tmp/carga/bench-chat.sql
--  Depende do dataset sintético (gerar-dataset.sql) carregado.
-- =============================================================================
\set ON_ERROR_STOP on
\timing off
\pset pager off

\echo '=== preparando conversas de 1k / 10k / 50k / 100k mensagens ==='
do $$
declare
  v_clube uuid := md5('carga:clube:1')::uuid;
  v_autor uuid := md5('carga:user:1:20')::uuid;
  v_conv  uuid;
  v_n     int;
begin
  set local session_replication_role = replica;
  delete from public.chat_mensagens where conversa_id in (select id from public.chat_conversas where club_id = v_clube and tipo = 'direta');
  delete from public.chat_participantes where conversa_id in (select id from public.chat_conversas where club_id = v_clube and tipo = 'direta');
  delete from public.chat_conversas where club_id = v_clube and tipo = 'direta';

  foreach v_n in array array[1000, 10000, 50000, 100000] loop
    v_conv := md5('carga:bench:conv:' || v_n)::uuid;
    insert into public.chat_conversas (id, tipo, club_id, unidade_id) values (v_conv, 'direta', v_clube, null);
    insert into public.chat_participantes (conversa_id, usuario_id, club_id) values (v_conv, v_autor, v_clube);
    insert into public.chat_mensagens (conversa_id, autor_id, club_id, texto, created_at)
    select v_conv, v_autor, v_clube, 'msg ' || g, now() - ((v_n - g) || ' seconds')::interval
      from generate_series(1, v_n) g;
  end loop;
  set local session_replication_role = origin;
end $$;
analyze public.chat_mensagens;
analyze public.chat_conversas;
analyze public.chat_participantes;

select 'conversas no banco inteiro' as escala, count(*) from public.chat_conversas
union all select 'mensagens no banco inteiro', count(*) from public.chat_mensagens;

-- ---------------------------------------------------------------------------
-- A implementação ANTIGA, recriada para ser medida lado a lado.
-- Cópia literal de chat_pode_ver() como estava antes da migration 51.
-- ---------------------------------------------------------------------------
create or replace function public._bench_legado(p_conversa_id uuid) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare v_club uuid; v_tipo text; v_unidade uuid; v_uid uuid := auth.uid();
begin
  select club_id, tipo, unidade_id into v_club, v_tipo, v_unidade from public.chat_conversas where id = p_conversa_id;
  if v_club is null then return false; end if;
  if public.pode_gerir_no_clube(v_club) then return true; end if;
  if not public.membro_ativo_no_clube(v_club) then return false; end if;
  if v_tipo = 'geral' then return true; end if;
  if v_tipo = 'unidade' then
    return v_unidade is not null and v_unidade is not distinct from (
      select m.unidade_id from public.organization_memberships m
      where m.user_id = v_uid and m.organizational_unit_id = v_club and m.status = 'ativo'
        and m.role in ('desbravador', 'conselheiro')
        and m.starts_at <= now() and (m.ends_at is null or m.ends_at > now())
    );
  end if;
  return exists (select 1 from public.chat_participantes part where part.conversa_id = p_conversa_id and part.usuario_id = v_uid);
end $$;
grant execute on function public._bench_legado(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Medidor genérico: roda a consulta como ela é, devolve tempo e buffers do plano.
-- ---------------------------------------------------------------------------
create or replace function public._bench_medir(p_sql text)
returns table (ms numeric, buffers bigint) language plpgsql as $$
declare v json;
begin
  execute 'explain (analyze, buffers, format json) ' || p_sql into v;
  return query select round((v->0->>'Execution Time')::numeric, 3),
    ((v->0->'Plan'->>'Shared Hit Blocks')::bigint + (v->0->'Plan'->>'Shared Read Blocks')::bigint);
end $$;
grant execute on function public._bench_medir(text) to authenticated;

drop table if exists public._bench_resultado;
create table public._bench_resultado (impl text, consulta text, historico int, ms numeric, buffers bigint);
grant all on public._bench_resultado to authenticated;

-- ---------------------------------------------------------------------------
-- As três consultas, parametrizadas pelo tamanho do histórico.
-- ---------------------------------------------------------------------------
create or replace function public._bench_rodar(p_impl text) returns void language plpgsql as $$
declare v_n int; v_conv uuid; v_clube uuid := md5('carga:clube:1')::uuid;
begin
  -- (1) achar a conversa geral: não depende do histórico, depende do nº de conversas do banco
  insert into public._bench_resultado
  select p_impl, '1-achar-conversa', 0, m.ms, m.buffers from public._bench_medir(
    'select id from public.chat_conversas where tipo = ''geral''') m;

  foreach v_n in array array[1000, 10000, 50000, 100000] loop
    v_conv := md5('carga:bench:conv:' || v_n)::uuid;
    -- (2) a página que o app pede de verdade: as 300 mais recentes, pela VIEW
    insert into public._bench_resultado
    select p_impl, '2-pagina-300', v_n, m.ms, m.buffers from public._bench_medir(format(
      'select id, autor_id, texto, created_at, apagada from public.chat_mensagens_visiveis
        where conversa_id = %L order by created_at desc limit 300', v_conv)) m;
  end loop;

  -- (3) a forma da Fase 8 (join), para fechar a série com a baseline publicada
  insert into public._bench_resultado
  select p_impl, '3-forma-fase8', 0, m.ms, m.buffers from public._bench_medir(format(
    'select m.id, m.texto, m.created_at from public.chat_mensagens m
       join public.chat_conversas c on c.id = m.conversa_id and c.tipo = ''geral'' and c.club_id = %L
      order by m.created_at desc limit 50', v_clube)) m;

  -- (4) varredura por TAMANHO DE PÁGINA, com o histórico fixo em 100k. Serve para responder
  --     "com o que o custo escalava, afinal?": se dobrar a página dobra o custo, o gargalo era
  --     por LINHA RETORNADA (a chamada de função), não pelo tamanho do histórico.
  foreach v_n in array array[50, 300, 1000] loop
    insert into public._bench_resultado
    select p_impl, '4-pagina-' || lpad(v_n::text, 4, '0'), 100000, m.ms, m.buffers from public._bench_medir(format(
      'select id, texto, created_at from public.chat_mensagens
        where conversa_id = %L order by created_at desc limit %s',
      md5('carga:bench:conv:100000')::uuid, v_n)) m;
  end loop;
end $$;
grant execute on function public._bench_rodar(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Rodada A — policies ANTIGAS (função por linha, nas três tabelas)
-- ---------------------------------------------------------------------------
\echo ''
\echo '=== rodada A: policies ANTIGAS (funcao por linha) ==='
drop policy if exists "ler minhas conversas" on public.chat_conversas;
create policy "ler minhas conversas" on public.chat_conversas for select to authenticated using (public._bench_legado(id));
drop policy if exists "ler mensagens" on public.chat_mensagens;
create policy "ler mensagens" on public.chat_mensagens for select to authenticated using (public._bench_legado(conversa_id));

select set_config('request.jwt.claim.sub', md5('carga:user:1:20')::uuid::text, false);
select set_config('request.jwt.claims', json_build_object('sub', md5('carga:user:1:20')::uuid, 'role', 'authenticated')::text, false);
set role authenticated;
select public._bench_rodar('aquecimento');   -- descarta: primeira leitura traz página do disco
delete from public._bench_resultado;
select public._bench_rodar('antiga');
reset role;

-- ---------------------------------------------------------------------------
-- Rodada B — policies NOVAS (conjunto calculado uma vez)
-- ---------------------------------------------------------------------------
\echo '=== rodada B: policies NOVAS (chat_conversas_visiveis, set-based) ==='
drop policy if exists "ler minhas conversas" on public.chat_conversas;
create policy "ler minhas conversas" on public.chat_conversas for select to authenticated
  using (id in (select public.chat_conversas_visiveis()));
drop policy if exists "ler mensagens" on public.chat_mensagens;
create policy "ler mensagens" on public.chat_mensagens for select to authenticated
  using (conversa_id in (select public.chat_conversas_visiveis()));

set role authenticated;
select public._bench_rodar('aquecimento');
delete from public._bench_resultado where impl = 'aquecimento';
select public._bench_rodar('nova');
reset role;

-- ---------------------------------------------------------------------------
-- Resultados
-- ---------------------------------------------------------------------------
\echo ''
\echo '=== (1) ACHAR A CONVERSA GERAL — escala com o numero de conversas da instalacao ==='
select max(ms)      filter (where impl='antiga') as "antiga ms",
       max(buffers) filter (where impl='antiga') as "antiga buffers",
       max(ms)      filter (where impl='nova')   as "nova ms",
       max(buffers) filter (where impl='nova')   as "nova buffers",
       round(max(ms) filter (where impl='antiga') / greatest(max(ms) filter (where impl='nova'), 0.001), 1) as "ganho (x)"
  from public._bench_resultado where consulta = '1-achar-conversa';

\echo ''
\echo '=== (2) A PAGINA QUE O APP PEDE (300 mais recentes), por tamanho de historico ==='
select historico as "historico (msgs)",
       max(ms)      filter (where impl='antiga') as "antiga ms",
       max(buffers) filter (where impl='antiga') as "antiga buffers",
       max(ms)      filter (where impl='nova')   as "nova ms",
       max(buffers) filter (where impl='nova')   as "nova buffers"
  from public._bench_resultado where consulta = '2-pagina-300' group by historico order by historico;

\echo ''
\echo '=== O CUSTO DA PAGINA CRESCE COM O HISTORICO? (1k -> 100k, mesma pagina de 300) ==='
select impl,
       min(buffers) filter (where historico = 1000)   as "buffers @1k",
       min(buffers) filter (where historico = 100000) as "buffers @100k",
       round(min(buffers) filter (where historico=100000)::numeric / greatest(min(buffers) filter (where historico=1000),1), 2) as "cresceu (x)"
  from public._bench_resultado where consulta = '2-pagina-300' group by impl order by impl desc;

\echo ''
\echo '=== (3) A FORMA DA FASE 8 (join), para fechar a serie com a baseline ==='
select impl, ms, buffers from public._bench_resultado where consulta = '3-forma-fase8' order by impl desc;

\echo ''
\echo '=== (4) COM O QUE O CUSTO ESCALAVA? historico fixo em 100k, pagina crescente ==='
select replace(consulta, '4-pagina-', '')::int as "pagina (linhas)",
       max(buffers) filter (where impl='antiga') as "antiga buffers",
       round(max(buffers) filter (where impl='antiga')::numeric / replace(consulta,'4-pagina-','')::int, 1) as "antiga buffers/linha",
       max(buffers) filter (where impl='nova')   as "nova buffers",
       round(max(buffers) filter (where impl='nova')::numeric / replace(consulta,'4-pagina-','')::int, 2) as "nova buffers/linha"
  from public._bench_resultado where consulta like '4-pagina-%' group by consulta order by 1;

\echo ''
\echo '=== plano da implementacao NOVA: achar a conversa geral ==='
select set_config('request.jwt.claim.sub', md5('carga:user:1:20')::uuid::text, false);
select set_config('request.jwt.claims', json_build_object('sub', md5('carga:user:1:20')::uuid, 'role', 'authenticated')::text, false);
set role authenticated;
explain (analyze, buffers, costs off, timing off) select id from public.chat_conversas where tipo = 'geral';
reset role;

-- ---------------------------------------------------------------------------
-- Restaura o estado definitivo (migration 51) e derruba o andaime.
-- ---------------------------------------------------------------------------
drop policy if exists "ler minhas conversas" on public.chat_conversas;
create policy "ler minhas conversas" on public.chat_conversas for select to authenticated
  using (id in (select public.chat_conversas_visiveis()));
drop policy if exists "ler mensagens" on public.chat_mensagens;
create policy "ler mensagens" on public.chat_mensagens for select to authenticated
  using (conversa_id in (select public.chat_conversas_visiveis()));
drop function if exists public._bench_legado(uuid);
drop function if exists public._bench_rodar(text);
drop function if exists public._bench_medir(text);
\echo ''
\echo '=== policies restauradas (migration 51) ==='
select tablename, policyname, qual from pg_policies where tablename in ('chat_conversas','chat_mensagens') order by tablename;
