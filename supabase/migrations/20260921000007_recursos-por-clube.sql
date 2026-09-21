-- =====================================================================
-- DesbravaClube — Recursos opcionais por clube
-- Leilão é um recurso de evento/acampamento, não uma obrigação da plataforma.
-- =====================================================================

create table if not exists public.club_features (
  club_id uuid not null references public.organizational_units(id) on delete cascade,
  feature text not null,
  enabled boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (club_id, feature),
  constraint club_features_feature_valida check (feature in ('leilao'))
);

alter table public.club_features enable row level security;

drop policy if exists "membro le recursos do proprio clube" on public.club_features;
create policy "membro le recursos do proprio clube"
on public.club_features for select to authenticated
using (public.tem_vinculo_unidade(club_id));

drop policy if exists "lideranca gere recursos do proprio clube" on public.club_features;
create policy "lideranca gere recursos do proprio clube"
on public.club_features for all to authenticated
using (public.pode_gerir_no_clube(club_id))
with check (public.pode_gerir_no_clube(club_id));

insert into public.club_features (club_id, feature, enabled, metadata)
select id, 'leilao', true, '{"purpose":"acampamento","legacy":true}'::jsonb
from public.organizational_units
where slug = 'filhos-da-conquista'
on conflict (club_id, feature) do update
set enabled = excluded.enabled,
    metadata = public.club_features.metadata || excluded.metadata,
    updated_at = now();

insert into public.club_features (club_id, feature, enabled, metadata)
select id, 'leilao', false, '{"purpose":"optional","environment":"local"}'::jsonb
from public.organizational_units
where slug = 'clube-teste-tenant-002'
on conflict (club_id, feature) do nothing;

create or replace function public.recurso_habilitado_no_clube(p_club_id uuid, p_feature text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select enabled
    from public.club_features
    where club_id = p_club_id and feature = p_feature
  ), false);
$$;

revoke execute on function public.recurso_habilitado_no_clube(uuid, text) from public, anon;
grant execute on function public.recurso_habilitado_no_clube(uuid, text) to authenticated;

notify pgrst, 'reload schema';

insert into public.migracoes_aplicadas (arquivo)
values ('2026-09-21-recursos-por-clube.sql')
on conflict (arquivo) do update set aplicada_em = now();
