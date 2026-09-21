-- =====================================================================
-- DesbravaClube — Temporadas e rankings por clube
-- A temporada deixa de ser global: cada clube tem sua própria janela de
-- pontuação e seu próprio histórico de campeões.
-- =====================================================================

create or replace function public.clube_atual_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select m.organizational_unit_id
  from public.organization_memberships m
  where m.user_id = auth.uid()
    and m.status = 'ativo'
    and m.starts_at <= now()
    and (m.ends_at is null or m.ends_at > now())
  order by m.starts_at, m.created_at
  limit 1;
$$;

revoke all on function public.clube_atual_id() from public, anon;
grant execute on function public.clube_atual_id() to authenticated;

alter table public.temporadas
  add column if not exists club_id uuid references public.organizational_units(id);

update public.temporadas
set club_id = public.clube_legado_id()
where club_id is null;

alter table public.temporadas
  alter column club_id set not null;

drop index if exists public.uma_temporada_aberta;
create unique index if not exists uma_temporada_aberta_por_clube
  on public.temporadas (club_id) where fim is null;
create unique index if not exists uq_temporada_numero_por_clube
  on public.temporadas (club_id, numero);
create index if not exists idx_temporadas_club_inicio
  on public.temporadas (club_id, inicio desc);

drop policy if exists "ler temporadas" on public.temporadas;
create policy "membro le temporadas do proprio clube"
on public.temporadas for select to authenticated
using (public.tem_vinculo_unidade(club_id));

create or replace function public.temporada_inicio()
returns timestamptz language sql stable security definer set search_path = '' as $$
  select coalesce(max(inicio), '-infinity'::timestamptz)
  from public.temporadas
  where club_id = public.clube_atual_id() and fim is null;
$$;

create or replace function public.ranking_totais()
returns json language sql security definer set search_path = '' as $$
  select case when public.eh_membro_ativo() then json_build_object(
    'pessoas', coalesce((
      select json_agg(json_build_object('id', usuario_id, 'total', total))
      from (select usuario_id, sum(pontos)::int as total from public.pontos
            where club_id = public.clube_atual_id()
              and usuario_id is not null
              and coalesce(data, '-infinity'::timestamptz) >= public.temporada_inicio()
            group by usuario_id) p), '[]'::json),
    'times', coalesce((
      select json_agg(json_build_object('id', unidade_id, 'total', total))
      from (select unidade_id, sum(pontos)::int as total from public.pontos
            where club_id = public.clube_atual_id()
              and usuario_id is null and unidade_id is not null
              and coalesce(data, '-infinity'::timestamptz) >= public.temporada_inicio()
            group by unidade_id) t), '[]'::json)
  ) else json_build_object('pessoas', '[]'::json, 'times', '[]'::json) end;
$$;

create or replace function public.ranking_semana()
returns json language sql security definer set search_path = '' as $$
  with ini as (
    select (date_trunc('week', (now() at time zone 'America/Sao_Paulo'))
            at time zone 'America/Sao_Paulo') as ts
  )
  select case when public.eh_membro_ativo() then json_build_object(
    'inicio', (select ts from ini),
    'pessoas', coalesce((
      select json_agg(json_build_object('id', usuario_id, 'total', total))
      from (select usuario_id, sum(pontos)::int as total from public.pontos
            where club_id = public.clube_atual_id()
              and usuario_id is not null and data >= (select ts from ini)
            group by usuario_id) p), '[]'::json),
    'times', coalesce((
      select json_agg(json_build_object('id', unidade_id, 'total', total))
      from (select unidade_id, sum(pontos)::int as total from public.pontos
            where club_id = public.clube_atual_id()
              and usuario_id is null and unidade_id is not null and data >= (select ts from ini)
            group by unidade_id) t), '[]'::json)
  ) else json_build_object('inicio', null, 'pessoas', '[]'::json, 'times', '[]'::json) end;
$$;

create or replace function public.meu_total_pontos()
returns int language sql stable security definer set search_path = '' as $$
  select coalesce(sum(pontos)::int, 0) from public.pontos
  where usuario_id = auth.uid()
    and club_id = public.clube_atual_id()
    and coalesce(data, '-infinity'::timestamptz) >= public.temporada_inicio();
$$;

create or replace function public.pontos_temporada_unidade(p_unidade_id uuid)
returns int language sql stable security definer set search_path = '' as $$
  select case when exists (
    select 1 from public.unidades u
    where u.id = p_unidade_id and u.club_id = public.clube_atual_id()
  ) then
    coalesce((
      select sum(p.pontos)::int from public.pontos p
      join public.profiles pr on pr.id = p.usuario_id
      where p.club_id = public.clube_atual_id()
        and pr.unidade_id = p_unidade_id and pr.status = 'ativo'
        and coalesce(p.data, '-infinity'::timestamptz) >= public.temporada_inicio()
    ), 0)
    + coalesce((
      select sum(p2.pontos)::int from public.pontos p2
      where p2.club_id = public.clube_atual_id()
        and p2.unidade_id = p_unidade_id and p2.usuario_id is null
        and coalesce(p2.data, '-infinity'::timestamptz) >= public.temporada_inicio()
    ), 0)
  else 0 end;
$$;

create or replace function public.nova_temporada(p_campeao_individual text, p_campeao_unidade text)
returns json language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_club_id uuid := public.clube_atual_id();
  v_num int;
begin
  if v_club_id is null or not public.pode_gerir_no_clube(v_club_id) then
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

notify pgrst, 'reload schema';

insert into public.migracoes_aplicadas (arquivo)
values ('2026-09-21-tenantiza-temporadas-e-ranking.sql')
on conflict (arquivo) do update set aplicada_em = now();
