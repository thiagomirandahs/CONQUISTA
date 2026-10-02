-- =============================================================================
--  Pré-janela (01/10/2026) — PUSH: só erro PERMANENTE apaga inscrição; poda SEGURA de inscrição morta.
--  (auditada e reescrita em 02/10/2026 — ver AUDITORIA-MIGRATION-534-PUSH.md)
--
--  REGRA DE OURO: somente erro comprovadamente PERMANENTE pode invalidar/remover a inscrição ou o token.
--  Erro temporário (timeout, rede, 408, 429, 5xx, oauth, resposta desconhecida) NUNCA apaga.
--
--  O que a investigação em produção (só leitura) mostrou:
--    * 404/410 funcionam como projetado: a Edge Function APAGA a inscrição/o token e a tentativa fica registrada.
--    * 'desconhecido' escondia o status real: `push_tentativas.codigo` era vocabulário FECHADO sem
--      400/401/403/413/502/504, e o `push_concluir` colapsava tudo o que não estava na lista.
--    * Há inscrições que NUNCA entregaram e falham a cada aviso (provável 401/403 = inscrição criada com outra
--      chave VAPID): nada as limpava.
--
--  O que esta migration faz (nada destrutivo roda sozinho; NENHUM agendamento é criado aqui):
--    1. vocabulário de `codigo` ampliado (400, 401, 403, 408, 413, 502, 504 e 'sub_invalida' = 400 que comprova
--       inscrição inválida) para o status real aparecer;
--    2. `registrada_em` (inscrição e token): marca de QUANDO a credencial passou a valer. Falha ANTIGA nunca
--       condena inscrição RECRIADA/reutilizada (endpoint reaproveitado, outro usuário): só conta tentativa POSTERIOR;
--    3. `push_remover_inscricao` — a remoção imediata feita pela Edge Function (404/410/400-inválida), atômica e
--       protegida contra corrida: não remove inscrição re-registrada depois que a tentativa começou;
--    4. `push_reservar` ganha teto de tentativas por evento (1 para erro definitivo, 3 para os demais), respeito ao
--       Retry-After (429/503) e trava por evento (dois workers simultâneos nunca duplicam);
--    5. `push_concluir` guarda `retry_apos` e continua com vocabulário fechado (nada de texto do provedor);
--    6. `push_inscricoes_mortas` / `push_podar_inscricoes_mortas(p_aplicar := false)` — só service_role; poda por
--       evidência acumulada: nunca entregou DESDE o registro, >= N falhas PERMANENTES (401/403/404/410/sub_invalida)
--       em >= D dias, E o provedor entregou a OUTRO aparelho do mesmo host nas 24 h da última falha (um problema de
--       chave do SERVIDOR, que derrubaria todos, nunca vira poda em massa);
--    7. `push_resumo_erros` — contagem por canal/código (observabilidade; sem identificar ninguém).
-- =============================================================================

-- 1) vocabulário -------------------------------------------------------------
alter table public.push_tentativas drop constraint if exists push_tentativas_codigo_check;
alter table public.push_tentativas add constraint push_tentativas_codigo_check check (codigo is null or codigo in
  ('200', '201', '400', '401', '403', '404', '408', '410', '413', '429', '500', '502', '503', '504',
   'timeout', 'rede', 'oauth', 'sub_invalida', 'desconhecido'));

alter table public.push_tentativas add column if not exists retry_apos timestamptz;

-- 2) "desde quando esta credencial vale" ---------------------------------------
alter table public.push_subscriptions add column if not exists registrada_em timestamptz;
alter table public.push_tokens        add column if not exists registrada_em timestamptz;
update public.push_subscriptions set registrada_em = coalesce(created_at, now()) where registrada_em is null;
update public.push_tokens        set registrada_em = coalesce(created_at, now()) where registrada_em is null;
alter table public.push_subscriptions alter column registrada_em set default now();
alter table public.push_subscriptions alter column registrada_em set not null;
alter table public.push_tokens        alter column registrada_em set default now();
alter table public.push_tokens        alter column registrada_em set not null;

-- O servidor decide a data (o cliente não consegue "envelhecer" nem "rejuvenescer" a própria inscrição).
-- Renova quando a credencial MUDA de verdade (outro usuário, outras chaves); um upsert idêntico (o app regrava a cada
-- abertura) NÃO renova — senão uma inscrição quebrada nunca envelheceria. Carimbar o aparelho (dispositivo_id) também não renova.
create or replace function public._push_carimbar_registro()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.registrada_em := now();
  elsif tg_table_name = 'push_subscriptions' then
    new.registrada_em := case when (new.user_id, new.endpoint, new.p256dh, new.auth)
                                   is distinct from (old.user_id, old.endpoint, old.p256dh, old.auth)
                              then now() else old.registrada_em end;
  else
    new.registrada_em := case when (new.user_id, new.token) is distinct from (old.user_id, old.token)
                              then now() else old.registrada_em end;
  end if;
  return new;
end $$;
revoke all on function public._push_carimbar_registro() from public, authenticated, anon;

drop trigger if exists trg_push_sub_registro on public.push_subscriptions;
create trigger trg_push_sub_registro before insert or update on public.push_subscriptions
  for each row execute function public._push_carimbar_registro();
drop trigger if exists trg_push_token_registro on public.push_tokens;
create trigger trg_push_token_registro before insert or update on public.push_tokens
  for each row execute function public._push_carimbar_registro();

-- 3) concluir: status real, Retry-After, vocabulário fechado ---------------------------------------
create or replace function public.push_concluir(p_resultados jsonb)
returns int
language plpgsql security definer set search_path = ''
as $$
declare v_n int;
begin
  update public.push_tentativas t
     set estado = case when (r->>'ok')::boolean then 'entregue' else 'falhou' end,
         codigo = case when r->>'codigo' in
                    ('200','201','400','401','403','404','408','410','413','429','500','502','503','504','timeout','rede','oauth','sub_invalida')
                  then r->>'codigo' else 'desconhecido' end,
         duracao_ms = nullif((r->>'ms')::int, 0),
         -- Retry-After do provedor (segundos), limitado a [1 s, 24 h]; ausente/ilegível = sem espera
         retry_apos = case when r->>'retry_s' ~ '^[0-9]{1,9}$' and not (r->>'ok')::boolean
                           then now() + make_interval(secs => least(greatest((r->>'retry_s')::int, 1), 86400))
                           else null end,
         quando = now()
    from jsonb_array_elements(coalesce(p_resultados, '[]'::jsonb)) r
   where r->>'id' ~ '^[0-9]{1,18}$' and t.id = (r->>'id')::bigint and t.estado = 'enviando';
  get diagnostics v_n = row_count;
  return v_n;
end $$;
revoke all on function public.push_concluir(jsonb) from public, authenticated, anon;
grant execute on function public.push_concluir(jsonb) to service_role;

-- 4) reservar: tetos de retry, Retry-After e trava por evento -------------------------------------------
--   * erro DEFINITIVO (400/401/403/404/410/413/sub_invalida) -> 1 tentativa por aparelho e evento (repetir não adianta);
--   * qualquer outra falha -> no máximo 3 tentativas por aparelho e evento;
--   * enquanto `retry_apos` (Retry-After) não passou, o aparelho não é reservado de novo;
--   * a trava de transação por evento serializa dois invokes simultâneos do MESMO evento (sem janela de tentativa dupla).
create or replace function public.push_reservar(p_evento_id uuid)
returns table (tentativa_id bigint, canal text, endpoint text, p256dh text, auth text, token text)
language plpgsql security definer set search_path = ''
as $$
#variable_conflict use_column
declare v_club uuid;
begin
  select club_id into v_club from public.push_eventos where id = p_evento_id;
  if v_club is null then return; end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('push_reservar:' || p_evento_id::text, 0));

  -- Tentativa 'enviando' antiga demais = invoke que morreu no meio. Liberar é o que permite o retry.
  update public.push_tentativas
     set estado = 'falhou', codigo = 'timeout'
   where estado = 'enviando' and quando < now() - interval '10 minutes'
     and destinatario_id in (select id from public.push_evento_destinatarios where evento_id = p_evento_id);

  return query
  with todos as (
    select d.id as dest, 'web'::text as ch,
           coalesce(s.dispositivo_id, md5(s.endpoint)::uuid) as disp,
           s.endpoint as ep, s.p256dh as pk, s.auth as au, null::text as tk
      from public.push_evento_destinatarios d
      join public.push_subscriptions s on s.user_id = d.user_id
     where d.evento_id = p_evento_id
    union all
    select d.id, 'fcm'::text,
           coalesce(k.dispositivo_id, md5(k.token)::uuid),
           null, null, null, k.token
      from public.push_evento_destinatarios d
      join public.push_tokens k on k.user_id = d.user_id
     where d.evento_id = p_evento_id
  ),
  candidatos as (
    select c.*
      from todos c
      cross join lateral (
        select count(*) as n,
               coalesce(bool_or(f.codigo in ('400','401','403','404','410','413','sub_invalida')), false) as definitivo,
               coalesce(max(f.retry_apos), '-infinity'::timestamptz) as espera_ate
          from public.push_tentativas f
         where f.destinatario_id = c.dest and f.dispositivo_id = c.disp and f.canal = c.ch and f.estado = 'falhou'
      ) h
     where h.n < 3 and not h.definitivo and h.espera_ate <= now()
  ),
  reservadas as (
    insert into public.push_tentativas (destinatario_id, dispositivo_id, canal, estado, club_id)
    select c.dest, c.disp, c.ch, 'enviando', v_club from candidatos c
    -- O coração da idempotência: quem já está 'enviando' ou 'entregue' não entra.
    on conflict (destinatario_id, dispositivo_id) where estado in ('enviando', 'entregue')
      do nothing
    returning id, destinatario_id, dispositivo_id, canal
  )
  select r.id, r.canal, c.ep, c.pk, c.au, c.tk
    from reservadas r
    join candidatos c on c.dest = r.destinatario_id and c.disp = r.dispositivo_id and c.ch = r.canal;
end $$;
revoke all on function public.push_reservar(uuid) from public, authenticated, anon;
grant execute on function public.push_reservar(uuid) to service_role;

-- 5) remoção imediata (Edge Function): atômica e à prova de corrida -------------------------------------
--   Só remove se (a) a tentativa ainda está 'enviando' (idempotente: 2ª chamada devolve 0), (b) a credencial é a do
--   aparelho da tentativa e (c) a inscrição NÃO foi (re)registrada depois que a tentativa começou — uma resposta
--   antiga/atrasada nunca derruba a inscrição nova (mesmo endpoint, mesmo ou outro usuário).
create or replace function public.push_remover_inscricao(p_tentativa_id bigint, p_credencial text)
returns int
language plpgsql security definer set search_path = ''
as $$
declare v_canal text; v_disp uuid; v_ini timestamptz; v_n int := 0;
begin
  if p_credencial is null then return 0; end if;
  select t.canal, t.dispositivo_id, t.quando into v_canal, v_disp, v_ini
    from public.push_tentativas t where t.id = p_tentativa_id and t.estado = 'enviando';
  if not found then return 0; end if;
  if v_canal = 'web' then
    delete from public.push_subscriptions s
     where s.endpoint = p_credencial and s.registrada_em <= v_ini
       and coalesce(s.dispositivo_id, md5(s.endpoint)::uuid) = v_disp;
  elsif v_canal = 'fcm' then
    delete from public.push_tokens k
     where k.token = p_credencial and k.registrada_em <= v_ini
       and coalesce(k.dispositivo_id, md5(k.token)::uuid) = v_disp;
  end if;
  get diagnostics v_n = row_count;
  return v_n;
end $$;
revoke all on function public.push_remover_inscricao(bigint, text) from public, authenticated, anon;
grant execute on function public.push_remover_inscricao(bigint, text) to service_role;

-- 6) candidatas (interna: devolve a credencial crua, por isso NINGUÉM executa direto) ---------------
drop function if exists public._push_mortas(int, int);
create or replace function public._push_mortas(p_min_falhas int, p_min_dias int, p_club_id uuid default null)
returns table (canal text, credencial text, host text, falhas int, dias int, primeira timestamptz, ultima timestamptz, registrada_em timestamptz)
language sql stable security definer set search_path = ''
as $$
  with permanentes(codigo) as (
    -- só o que comprova problema DA INSCRIÇÃO. Fora de propósito: 400 genérico e 413 (payload), 408/429/5xx/timeout/rede/oauth
    -- (temporários) e 'desconhecido' (não provado).
    values ('401'), ('403'), ('404'), ('410'), ('sub_invalida')
  ),
  web as (
    select 'web'::text as canal, s.endpoint as credencial,
           substring(s.endpoint from '^https://([^/]+)') as host, s.registrada_em, x.*
      from public.push_subscriptions s
      cross join lateral (
        select count(*) filter (where t.estado = 'entregue')::int as ok,
               count(*) filter (where t.estado = 'falhou' and t.codigo in (select codigo from permanentes))::int as perm,
               count(distinct (t.quando at time zone 'UTC')::date) filter (where t.estado = 'falhou' and t.codigo in (select codigo from permanentes))::int as dias,
               min(t.quando) filter (where t.estado = 'falhou' and t.codigo in (select codigo from permanentes)) as primeira,
               max(t.quando) filter (where t.estado = 'falhou' and t.codigo in (select codigo from permanentes)) as ultima,
               count(*) filter (where p_club_id is not null and t.club_id = p_club_id)::int as no_clube
          from public.push_tentativas t
          join public.push_evento_destinatarios d on d.id = t.destinatario_id and d.user_id = s.user_id
         where t.canal = 'web' and t.quando > s.registrada_em        -- só tentativa POSTERIOR ao registro vigente
           and t.dispositivo_id in (md5(s.endpoint)::uuid, coalesce(s.dispositivo_id, md5(s.endpoint)::uuid))
      ) x
  ),
  fcm as (
    select 'fcm'::text as canal, k.token as credencial, 'fcm'::text as host, k.registrada_em, x.*
      from public.push_tokens k
      cross join lateral (
        select count(*) filter (where t.estado = 'entregue')::int as ok,
               count(*) filter (where t.estado = 'falhou' and t.codigo in (select codigo from permanentes))::int as perm,
               count(distinct (t.quando at time zone 'UTC')::date) filter (where t.estado = 'falhou' and t.codigo in (select codigo from permanentes))::int as dias,
               min(t.quando) filter (where t.estado = 'falhou' and t.codigo in (select codigo from permanentes)) as primeira,
               max(t.quando) filter (where t.estado = 'falhou' and t.codigo in (select codigo from permanentes)) as ultima,
               count(*) filter (where p_club_id is not null and t.club_id = p_club_id)::int as no_clube
          from public.push_tentativas t
          join public.push_evento_destinatarios d on d.id = t.destinatario_id and d.user_id = k.user_id
         where t.canal = 'fcm' and t.quando > k.registrada_em
           and t.dispositivo_id in (md5(k.token)::uuid, coalesce(k.dispositivo_id, md5(k.token)::uuid))
      ) x
  ),
  todas as (select * from web union all select * from fcm)
  select t.canal, t.credencial, t.host, t.perm, t.dias, t.primeira, t.ultima, t.registrada_em
    from todas t
   where t.ok = 0
     and t.perm >= greatest(coalesce(p_min_falhas, 3), 2)
     and t.dias >= greatest(coalesce(p_min_dias, 2), 2)
     and (p_club_id is null or t.no_clube > 0)
     -- o provedor/canal funciona para OUTROS aparelhos: houve entrega no mesmo host nas 24 h da última falha
     and (
       (t.canal = 'web' and exists (
          select 1 from public.push_tentativas g
            join public.push_subscriptions s2
              on g.dispositivo_id in (md5(s2.endpoint)::uuid, coalesce(s2.dispositivo_id, md5(s2.endpoint)::uuid))
           where g.canal = 'web' and g.estado = 'entregue' and g.quando >= t.ultima - interval '1 day'
             and substring(s2.endpoint from '^https://([^/]+)') is not distinct from t.host))
       or
       (t.canal = 'fcm' and exists (
          select 1 from public.push_tentativas g
            join public.push_tokens k2
              on g.dispositivo_id in (md5(k2.token)::uuid, coalesce(k2.dispositivo_id, md5(k2.token)::uuid))
           where g.canal = 'fcm' and g.estado = 'entregue' and g.quando >= t.ultima - interval '1 day'))
     );
$$;
revoke all on function public._push_mortas(int, int, uuid) from public, authenticated, anon, service_role;

-- 7) lista (anonimizada: só um hash curto da credencial) ---------------------------------------------
drop function if exists public.push_inscricoes_mortas(int, int);
create or replace function public.push_inscricoes_mortas(p_min_falhas int default 3, p_min_dias int default 2, p_club_id uuid default null)
returns table (canal text, ref text, host text, falhas int, dias int, primeira timestamptz, ultima timestamptz)
language sql stable security definer set search_path = ''
as $$
  select m.canal, left(md5(m.credencial), 8), m.host, m.falhas, m.dias, m.primeira, m.ultima
    from public._push_mortas(p_min_falhas, p_min_dias, p_club_id) m
   order by m.ultima desc;
$$;
revoke all on function public.push_inscricoes_mortas(int, int, uuid) from public, authenticated, anon;
grant execute on function public.push_inscricoes_mortas(int, int, uuid) to service_role;

-- 8) poda: ENSAIO por padrão ------------------------------------------------------------------------
--   Uma única leitura das candidatas (sem janela entre contar e apagar) e o DELETE confere `registrada_em`: se a inscrição
--   foi re-registrada entre a leitura e a remoção, ela NÃO é apagada.
drop function if exists public.push_podar_inscricoes_mortas(boolean, int, int);
create or replace function public.push_podar_inscricoes_mortas(
  p_aplicar boolean default false, p_min_falhas int default 3, p_min_dias int default 2, p_club_id uuid default null)
returns table (canal text, candidatas int, removidas int)
language plpgsql security definer set search_path = ''
as $$
#variable_conflict use_column
begin
  if coalesce(p_aplicar, false) then
    return query
    with m as materialized (select * from public._push_mortas(p_min_falhas, p_min_dias, p_club_id)),
         dw as (delete from public.push_subscriptions s using m
                 where m.canal = 'web' and s.endpoint = m.credencial and s.registrada_em = m.registrada_em returning 1),
         dk as (delete from public.push_tokens k using m
                 where m.canal = 'fcm' and k.token = m.credencial and k.registrada_em = m.registrada_em returning 1)
    select 'web'::text, (select count(*)::int from m where m.canal = 'web'), (select count(*)::int from dw)
    union all
    select 'fcm'::text, (select count(*)::int from m where m.canal = 'fcm'), (select count(*)::int from dk);
  else
    return query
    with m as (select * from public._push_mortas(p_min_falhas, p_min_dias, p_club_id))
    select 'web'::text, (select count(*)::int from m where m.canal = 'web'), 0
    union all
    select 'fcm'::text, (select count(*)::int from m where m.canal = 'fcm'), 0;
  end if;
end $$;
revoke all on function public.push_podar_inscricoes_mortas(boolean, int, int, uuid) from public, authenticated, anon;
grant execute on function public.push_podar_inscricoes_mortas(boolean, int, int, uuid) to service_role;

-- 9) observabilidade: contagem por canal/código (sem identificar ninguém) ---------------------------
create or replace function public.push_resumo_erros(p_horas int default 24, p_club_id uuid default null)
returns table (canal text, codigo text, tentativas int, aparelhos int)
language sql stable security definer set search_path = ''
as $$
  select t.canal, coalesce(t.codigo, '-'), count(*)::int, count(distinct t.dispositivo_id)::int
    from public.push_tentativas t
   where t.estado = 'falhou' and t.quando > now() - make_interval(hours => least(greatest(coalesce(p_horas, 24), 1), 720))
     and (p_club_id is null or t.club_id = p_club_id)
   group by 1, 2 order by 3 desc;
$$;
revoke all on function public.push_resumo_erros(int, uuid) from public, authenticated, anon;
grant execute on function public.push_resumo_erros(int, uuid) to service_role;
