-- =============================================================================
--  Pré-janela (01/10/2026) — PUSH: erro permanente além do 404/410, e poda SEGURA de inscrição morta.
--
--  O que a investigação em produção (só leitura) mostrou:
--    * 404/410 funcionam como projetado: a Edge Function APAGA a inscrição (web, por endpoint) ou o
--      token (FCM, 404) e a tentativa fica registrada. As inscrições dos 5 erros de 24 h já não existem.
--    * 'desconhecido' escondia o status real: `push_tentativas.codigo` era vocabulário FECHADO sem
--      400/401/403/413/502/504, e o `push_concluir` colapsava tudo o que não estava na lista.
--    * Há inscrições que NUNCA entregaram e falham a cada aviso (retry eterno por evento, sem fim):
--      o erro delas não é 404/410 (provável 401/403 = inscrição criada com outra chave VAPID), então
--      a Edge Function não as remove. Nada as limpava.
--
--  O que esta migration faz (nada destrutivo roda sozinho):
--    1. amplia o vocabulário de `codigo` (400, 401, 403, 413, 502, 504) para o status real aparecer;
--    2. `push_inscricoes_mortas(...)`  — LISTA candidatas (read-only, service_role), sem identificar ninguém;
--    3. `push_podar_inscricoes_mortas(p_aplicar := false, ...)` — por padrão é ENSAIO (não apaga);
--       só com p_aplicar = true remove, e só inscrição/token de aparelho que (a) nunca entregou,
--       (b) acumulou >= N falhas PERMANENTES em >= D dias distintos e (c) o provedor comprovadamente
--       funciona para OUTROS aparelhos (houve entrega no mesmo host/canal nos últimos 7 dias) — assim
--       um problema de chave do SERVIDOR (que derrubaria todos) nunca vira poda em massa.
--    Falhas temporárias (timeout, rede, 429, 500, 502, 503, 504, oauth) NUNCA contam como morte.
--    Nenhum agendamento é criado aqui: a poda é decisão do dono (ver PRE-JANELA-CHAVES-APP-ERROS-PUSH-ORFAOS.md).
-- =============================================================================

-- 1) vocabulário -------------------------------------------------------------
alter table public.push_tentativas drop constraint if exists push_tentativas_codigo_check;
alter table public.push_tentativas add constraint push_tentativas_codigo_check check (codigo is null or codigo in
  ('200', '201', '400', '401', '403', '404', '410', '413', '429', '500', '502', '503', '504',
   'timeout', 'rede', 'oauth', 'desconhecido'));

create or replace function public.push_concluir(p_resultados jsonb)
returns int
language plpgsql security definer set search_path = ''
as $$
declare v_n int;
begin
  update public.push_tentativas t
     set estado = case when (r->>'ok')::boolean then 'entregue' else 'falhou' end,
         codigo = case when r->>'codigo' in
                    ('200','201','400','401','403','404','410','413','429','500','502','503','504','timeout','rede','oauth')
                  then r->>'codigo' else 'desconhecido' end,
         duracao_ms = nullif((r->>'ms')::int, 0),
         quando = now()
    from jsonb_array_elements(coalesce(p_resultados, '[]'::jsonb)) r
   where t.id = (r->>'id')::bigint and t.estado = 'enviando';
  get diagnostics v_n = row_count;
  return v_n;
end $$;
revoke all on function public.push_concluir(jsonb) from public, authenticated, anon;
grant execute on function public.push_concluir(jsonb) to service_role;

-- 2) candidatas (interna: devolve a credencial crua, por isso NINGUÉM executa direto) ---------------
create or replace function public._push_mortas(p_min_falhas int, p_min_dias int)
returns table (canal text, credencial text, host text, falhas int, dias int, primeira timestamptz, ultima timestamptz)
language sql stable security definer set search_path = ''
as $$
  with permanentes(codigo) as (
    values ('400'), ('401'), ('403'), ('404'), ('410'), ('413'), ('desconhecido')
  ),
  web as (
    select 'web'::text as canal, s.endpoint as credencial,
           substring(s.endpoint from '^https://([^/]+)') as host,
           x.ok, x.perm, x.dias, x.primeira, x.ultima
      from public.push_subscriptions s
      cross join lateral (
        select count(*) filter (where t.estado = 'entregue')::int as ok,
               count(*) filter (where t.estado = 'falhou' and t.codigo in (select codigo from permanentes))::int as perm,
               count(distinct t.quando::date) filter (where t.estado = 'falhou' and t.codigo in (select codigo from permanentes))::int as dias,
               min(t.quando) filter (where t.estado = 'falhou' and t.codigo in (select codigo from permanentes)) as primeira,
               max(t.quando) filter (where t.estado = 'falhou' and t.codigo in (select codigo from permanentes)) as ultima
          from public.push_tentativas t
         where t.canal = 'web'
           and t.dispositivo_id in (md5(s.endpoint)::uuid, coalesce(s.dispositivo_id, md5(s.endpoint)::uuid))
      ) x
  ),
  fcm as (
    select 'fcm'::text as canal, k.token as credencial, 'fcm'::text as host,
           x.ok, x.perm, x.dias, x.primeira, x.ultima
      from public.push_tokens k
      cross join lateral (
        select count(*) filter (where t.estado = 'entregue')::int as ok,
               count(*) filter (where t.estado = 'falhou' and t.codigo in (select codigo from permanentes))::int as perm,
               count(distinct t.quando::date) filter (where t.estado = 'falhou' and t.codigo in (select codigo from permanentes))::int as dias,
               min(t.quando) filter (where t.estado = 'falhou' and t.codigo in (select codigo from permanentes)) as primeira,
               max(t.quando) filter (where t.estado = 'falhou' and t.codigo in (select codigo from permanentes)) as ultima
          from public.push_tentativas t
         where t.canal = 'fcm'
           and t.dispositivo_id in (md5(k.token)::uuid, coalesce(k.dispositivo_id, md5(k.token)::uuid))
      ) x
  ),
  todas as (select * from web union all select * from fcm),
  -- o provedor/canal funciona para OUTROS aparelhos? (entrega nos últimos 7 dias, no mesmo host)
  saudaveis as (
    select distinct 'web'::text as canal, substring(s2.endpoint from '^https://([^/]+)') as host
      from public.push_subscriptions s2
      join public.push_tentativas g
        on g.canal = 'web' and g.estado = 'entregue' and g.quando > now() - interval '7 days'
       and g.dispositivo_id in (md5(s2.endpoint)::uuid, coalesce(s2.dispositivo_id, md5(s2.endpoint)::uuid))
    union
    select distinct 'fcm'::text, 'fcm'::text
      from public.push_tokens k2
      join public.push_tentativas g
        on g.canal = 'fcm' and g.estado = 'entregue' and g.quando > now() - interval '7 days'
       and g.dispositivo_id in (md5(k2.token)::uuid, coalesce(k2.dispositivo_id, md5(k2.token)::uuid))
  )
  select t.canal, t.credencial, t.host, t.perm, t.dias, t.primeira, t.ultima
    from todas t
   where t.ok = 0
     and t.perm >= greatest(coalesce(p_min_falhas, 3), 2)
     and t.dias >= greatest(coalesce(p_min_dias, 2), 2)
     and exists (select 1 from saudaveis sa where sa.canal = t.canal and sa.host is not distinct from t.host);
$$;
revoke all on function public._push_mortas(int, int) from public, authenticated, anon, service_role;

-- 3) lista (anonimizada: só um hash curto da credencial) ---------------------------------------------
create or replace function public.push_inscricoes_mortas(p_min_falhas int default 3, p_min_dias int default 2)
returns table (canal text, ref text, host text, falhas int, dias int, primeira timestamptz, ultima timestamptz)
language sql stable security definer set search_path = ''
as $$
  select m.canal, left(md5(m.credencial), 8), m.host, m.falhas, m.dias, m.primeira, m.ultima
    from public._push_mortas(p_min_falhas, p_min_dias) m
   order by m.ultima desc;
$$;
revoke all on function public.push_inscricoes_mortas(int, int) from public, authenticated, anon;
grant execute on function public.push_inscricoes_mortas(int, int) to service_role;

-- 4) poda: ENSAIO por padrão ------------------------------------------------------------------------
create or replace function public.push_podar_inscricoes_mortas(
  p_aplicar boolean default false, p_min_falhas int default 3, p_min_dias int default 2)
returns table (canal text, candidatas int, removidas int)
language plpgsql security definer set search_path = ''
as $$
declare v_web int := 0; v_fcm int := 0;
begin
  if coalesce(p_aplicar, false) then
    with m as (select * from public._push_mortas(p_min_falhas, p_min_dias)),
         d as (delete from public.push_subscriptions s using m
                where m.canal = 'web' and s.endpoint = m.credencial returning 1)
    select count(*) into v_web from d;
    with m as (select * from public._push_mortas(p_min_falhas, p_min_dias)),
         d as (delete from public.push_tokens k using m
                where m.canal = 'fcm' and k.token = m.credencial returning 1)
    select count(*) into v_fcm from d;
  end if;
  return query
    select 'web'::text, (select count(*)::int from public._push_mortas(p_min_falhas, p_min_dias) m where m.canal = 'web') + v_web, v_web
    union all
    select 'fcm'::text, (select count(*)::int from public._push_mortas(p_min_falhas, p_min_dias) m where m.canal = 'fcm') + v_fcm, v_fcm;
end $$;
revoke all on function public.push_podar_inscricoes_mortas(boolean, int, int) from public, authenticated, anon;
grant execute on function public.push_podar_inscricoes_mortas(boolean, int, int) to service_role;
