-- =====================================================================
-- Correções da revisão de REGRESSÃO contra a produção (Tenant 001).
-- Rodar DEPOIS da 20260921000018. Idempotente (create or replace / drop if exists).
--
--  A) "Excluir usuário" quebrava para quem já teve mensalidade: a FK ON DELETE SET NULL faz um UPDATE
--     de desbravador_id e o gatilho do clube exigia um dono ("Membro sem clube para mensalidade").
--  B) A foto do mural de outro clube migrava para o Tenant 001 quando o autor era excluído
--     (o gatilho caía no clube legado quando autor_id virava NULL).
--  C) nova_temporada() ficou mais permissiva que no legado: instrutor zerava o ranking (é da diretoria).
--  D) Desempenho: ranking_totais()/meu_total_pontos() chamavam temporada_inicio() e clube_atual_id()
--     POR LINHA (função SECURITY DEFINER em SQL não é "inlinada": ~35x mais lento que o legado), e o
--     RLS do chat encadeava 3 níveis dessas funções por mensagem. Agora:
--       * as consultas quentes calculam o clube/início da temporada UMA vez;
--       * os helpers de permissão viram plpgsql (plano em cache: ~25x mais barato por chamada).
-- =====================================================================

-- ==================== A) mensalidade sem dono continua no clube dela ====================
create or replace function public.definir_club_mensalidade()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- o UPDATE que a FK (ON DELETE SET NULL) faz ao excluir o membro: a mensalidade fica sem dono,
  -- mas continua no MESMO clube (o caixa é preservado)
  if new.desbravador_id is null then
    if new.club_id is null then raise exception 'Mensalidade sem clube.'; end if;
    return new;
  end if;
  select organizational_unit_id into new.club_id
  from public.organization_memberships
  where user_id = new.desbravador_id and status = 'ativo'
    and starts_at <= now() and (ends_at is null or ends_at > now())
  order by starts_at, created_at limit 1;
  if new.club_id is null then raise exception 'Membro sem clube para mensalidade.'; end if;
  return new;
end;
$$;
revoke all on function public.definir_club_mensalidade() from public, anon, authenticated;

-- ==================== B) foto sem autor continua no clube em que foi postada ====================
create or replace function public.definir_club_foto()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.autor_id is null then
    -- autor excluído (FK SET NULL): o clube da foto NÃO muda. Só uma foto nova, sem autor nenhum
    -- (rotina do banco), cai no clube legado.
    new.club_id := coalesce(new.club_id, public.clube_legado_id());
    return new;
  end if;
  select organizational_unit_id into new.club_id
  from public.organization_memberships
  where user_id = new.autor_id
    and status = 'ativo'
    and starts_at <= now()
    and (ends_at is null or ends_at > now())
  order by starts_at, created_at
  limit 1;

  new.club_id := coalesce(new.club_id, public.clube_legado_id());
  return new;
end;
$$;
revoke all on function public.definir_club_foto() from public, anon, authenticated;

-- ==================== C) nova temporada: só a diretoria do clube (como no legado) ====================
create or replace function public.nova_temporada(p_campeao_individual text, p_campeao_unidade text)
returns json language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_club_id uuid := public.clube_atual_id();
  v_num int;
begin
  if v_club_id is null or not exists (
       select 1 from public.organization_memberships m
       where m.user_id = v_uid and m.organizational_unit_id = v_club_id
         and m.role = 'diretoria' and m.status = 'ativo'
         and m.starts_at <= now() and (m.ends_at is null or m.ends_at > now())) then
    raise exception 'Só a diretoria pode iniciar uma nova temporada neste clube.';
  end if;
  perform pg_advisory_xact_lock(hashtext('nova_temporada:' || v_club_id::text));

  -- Leilão ainda é recurso legado exclusivo do Tenant 001 nesta fase.
  if v_club_id = public.clube_legado_id()
     and exists (select 1 from public.leiloes where status = 'aberto') then
    raise exception 'Encerre ou cancele o leilão aberto antes de iniciar uma nova temporada.';
  end if;

  update public.temporadas
     set fim = now(), campeao_individual = p_campeao_individual, campeao_unidade = p_campeao_unidade
   where club_id = v_club_id and fim is null;

  select coalesce(max(numero), 0) + 1 into v_num
  from public.temporadas where club_id = v_club_id;
  insert into public.temporadas (club_id, numero, inicio, criado_por)
  values (v_club_id, v_num, now(), v_uid);

  return json_build_object('numero', v_num);
end;
$$;
revoke all on function public.nova_temporada(text, text) from public, anon;
grant execute on function public.nova_temporada(text, text) to authenticated;

-- ==================== D) desempenho ====================
-- D1) helpers de permissão em plpgsql (mesma semântica; o plano fica em cache dentro da sessão).
--     "create or replace" mantém dono e privilégios (nenhum GRANT muda).
create or replace function public.clube_legado_id() returns uuid
language plpgsql stable security definer set search_path = public as $$
declare v uuid;
begin
  select id into v from public.organizational_units where slug = 'filhos-da-conquista' and type = 'clube' limit 1;
  return v;
end;
$$;

create or replace function public.clube_atual_id() returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare v uuid;
begin
  select m.organizational_unit_id into v
  from public.organization_memberships m
  join public.organizational_units u on u.id = m.organizational_unit_id and u.type = 'clube'
  where m.user_id = auth.uid() and m.status = 'ativo'
    and m.starts_at <= now() and (m.ends_at is null or m.ends_at > now())
  order by m.starts_at, m.created_at
  limit 1;
  return v;
end;
$$;

create or replace function public.membro_ativo_no_clube(p_club_id uuid) returns boolean
language plpgsql stable security definer set search_path = '' as $$
begin
  return exists (
    select 1 from public.organization_memberships m
    where m.user_id = auth.uid() and m.organizational_unit_id = p_club_id
      and m.role <> 'pais' and m.status = 'ativo'
      and m.starts_at <= now() and (m.ends_at is null or m.ends_at > now())
  );
end;
$$;

create or replace function public.pode_gerir_no_clube(p_club_id uuid) returns boolean
language plpgsql stable security definer set search_path = public as $$
begin
  return exists (
    select 1 from public.organization_memberships m
    where m.user_id = auth.uid() and m.organizational_unit_id = p_club_id
      and m.role in ('instrutor', 'diretoria') and m.status = 'ativo'
      and m.starts_at <= now() and (m.ends_at is null or m.ends_at > now())
  );
end;
$$;

create or replace function public.pode_financeiro_no_clube(p_club_id uuid) returns boolean
language plpgsql stable security definer set search_path = '' as $$
begin
  return exists (
    select 1 from public.organization_memberships m
    where m.user_id = auth.uid() and m.organizational_unit_id = p_club_id
      and m.role in ('tesoureiro', 'diretoria') and m.status = 'ativo'
      and m.starts_at <= now() and (m.ends_at is null or m.ends_at > now())
  );
end;
$$;

create or replace function public.tem_vinculo_unidade(p_unit_id uuid) returns boolean
language plpgsql stable security definer set search_path = public as $$
begin
  return exists (
    select 1 from public.organization_memberships m
    where m.user_id = auth.uid() and m.organizational_unit_id = p_unit_id
      and m.status = 'ativo'
      and m.starts_at <= now() and (m.ends_at is null or m.ends_at > now())
  );
end;
$$;

create or replace function public.temporada_inicio_clube(p_club_id uuid) returns timestamptz
language plpgsql stable security definer set search_path = '' as $$
begin
  return (select coalesce(max(inicio), '-infinity'::timestamptz)
          from public.temporadas where club_id = p_club_id and fim is null);
end;
$$;

create or replace function public.temporada_inicio() returns timestamptz
language plpgsql stable security definer set search_path = '' as $$
begin
  return public.temporada_inicio_clube(public.clube_atual_id());
end;
$$;

create or replace function public.pode_gerir() returns boolean
language plpgsql stable security definer set search_path = '' as $$
begin
  return public.pode_gerir_no_clube(public.clube_legado_id());
end;
$$;

create or replace function public.pode_aprovar() returns boolean
language plpgsql stable security definer set search_path = '' as $$
begin
  return public.pode_gerir_no_clube(public.clube_legado_id());
end;
$$;

create or replace function public.eh_membro_ativo() returns boolean
language plpgsql stable security definer set search_path = '' as $$
begin
  return public.membro_ativo_no_clube(public.clube_legado_id());
end;
$$;

create or replace function public.eh_financeiro() returns boolean
language plpgsql stable security definer set search_path = '' as $$
begin
  return public.pode_financeiro_no_clube(public.clube_legado_id());
end;
$$;

-- D2) consultas quentes: clube e início da temporada calculados UMA vez (CTE), não por linha
create or replace function public.ranking_totais() returns json
language sql security definer set search_path = '' as $$
  with ctx as (select public.clube_atual_id() as club, public.temporada_inicio() as ini)
  select case when public.membro_ativo_no_clube((select club from ctx)) then json_build_object(
    'pessoas', coalesce((
      select json_agg(json_build_object('id', usuario_id, 'total', total))
      from (select usuario_id, sum(pontos)::int as total from public.pontos
            where club_id = (select club from ctx)
              and usuario_id is not null
              and coalesce(data, '-infinity'::timestamptz) >= (select ini from ctx)
            group by usuario_id) p), '[]'::json),
    'times', coalesce((
      select json_agg(json_build_object('id', unidade_id, 'total', total))
      from (select unidade_id, sum(pontos)::int as total from public.pontos
            where club_id = (select club from ctx)
              and usuario_id is null and unidade_id is not null
              and coalesce(data, '-infinity'::timestamptz) >= (select ini from ctx)
            group by unidade_id) t), '[]'::json)
  ) else json_build_object('pessoas', '[]'::json, 'times', '[]'::json) end;
$$;

create or replace function public.meu_total_pontos() returns integer
language sql stable security definer set search_path = '' as $$
  with ctx as (select public.clube_atual_id() as club, public.temporada_inicio() as ini)
  select coalesce(sum(pontos)::int, 0) from public.pontos
  where usuario_id = auth.uid()
    and club_id = (select club from ctx)
    and coalesce(data, '-infinity'::timestamptz) >= (select ini from ctx);
$$;

create or replace function public.ranking_semana() returns json
language sql security definer set search_path = '' as $$
  with ini as (
    select (date_trunc('week', (now() at time zone 'America/Sao_Paulo'))
            at time zone 'America/Sao_Paulo') as ts
  ), ctx as (select public.clube_atual_id() as club)
  select case when public.membro_ativo_no_clube((select club from ctx)) then json_build_object(
    'inicio', (select ts from ini),
    'pessoas', coalesce((
      select json_agg(json_build_object('id', usuario_id, 'total', total))
      from (select usuario_id, sum(pontos)::int as total from public.pontos
            where club_id = (select club from ctx)
              and usuario_id is not null and data >= (select ts from ini)
            group by usuario_id) p), '[]'::json),
    'times', coalesce((
      select json_agg(json_build_object('id', unidade_id, 'total', total))
      from (select unidade_id, sum(pontos)::int as total from public.pontos
            where club_id = (select club from ctx)
              and usuario_id is null and unidade_id is not null and data >= (select ts from ini)
            group by unidade_id) t), '[]'::json)
  ) else json_build_object('inicio', null, 'pessoas', '[]'::json, 'times', '[]'::json) end;
$$;

-- D3) chat: a policy de leitura chama chat_pode_ver() por mensagem — em plpgsql fica barato
create or replace function public.chat_pode_ver(p_conversa_id uuid) returns boolean
language plpgsql stable security definer set search_path = '' as $$
begin
  return public.pode_gerir()
    or (public.eh_membro_ativo() and (
      exists (
        select 1 from public.chat_conversas ch where ch.id = p_conversa_id and ch.tipo = 'unidade'
          and ch.unidade_id = (
            select unidade_id from public.profiles where id = auth.uid() and status = 'ativo' and papel in ('desbravador', 'conselheiro')
          )
      )
      or exists (select 1 from public.chat_conversas cg where cg.id = p_conversa_id and cg.tipo = 'geral')
      or exists (
        select 1 from public.chat_participantes part where part.conversa_id = p_conversa_id and part.usuario_id = auth.uid()
      )
    ));
end;
$$;

-- ACL: nada novo ficou executável por PUBLIC/anon (só a do cadastro público)
revoke execute on all functions in schema public from public, anon;
grant execute on function public.clube_legado_id() to anon;

notify pgrst, 'reload schema';

insert into public.migracoes_aplicadas (arquivo)
values ('2026-09-21-regressoes-de-desempenho-e-compat.sql')
on conflict (arquivo) do update set aplicada_em = now();
