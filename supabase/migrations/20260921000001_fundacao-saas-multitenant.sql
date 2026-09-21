-- =====================================================================
-- DesbravaClube — Fundação SaaS multi-tenant (FASE 1)
-- Cria a árvore organizacional e vínculos sem alterar o comportamento legado.
-- Nesta migration NÃO adicionamos club_id às tabelas operacionais existentes.
-- =====================================================================

create table if not exists public.organizational_units (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid references public.organizational_units(id) on delete restrict,
  type text not null check (type in ('divisao','uniao','campo','regiao','distrito','igreja','clube')),
  nome text not null,
  slug text unique,
  codigo_oficial text,
  pais text not null default 'BR',
  timezone text not null default 'America/Recife',
  status text not null default 'ativo' check (status in ('ativo','inativo')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint organizational_units_parent_not_self check (parent_id is null or parent_id <> id)
);

create index if not exists idx_organizational_units_parent
  on public.organizational_units(parent_id);
create index if not exists idx_organizational_units_type_status
  on public.organizational_units(type, status);

create table if not exists public.organization_memberships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  organizational_unit_id uuid not null references public.organizational_units(id) on delete cascade,
  role text not null,
  status text not null default 'ativo' check (status in ('pendente','ativo','suspenso','encerrado')),
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint organization_memberships_periodo_valido check (ends_at is null or ends_at > starts_at)
);

create unique index if not exists uq_membership_ativa_por_papel
  on public.organization_memberships(user_id, organizational_unit_id, role)
  where status in ('pendente','ativo') and ends_at is null;
create index if not exists idx_memberships_user_status
  on public.organization_memberships(user_id, status);
create index if not exists idx_memberships_unit_status
  on public.organization_memberships(organizational_unit_id, status);

-- Helper sem SECURITY DEFINER: a própria RLS pode verificar vínculos do usuário.
create or replace function public.tem_vinculo_unidade(p_unit_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.organization_memberships m
    where m.user_id = auth.uid()
      and m.organizational_unit_id = p_unit_id
      and m.status = 'ativo'
      and m.starts_at <= now()
      and (m.ends_at is null or m.ends_at > now())
  );
$$;

revoke execute on function public.tem_vinculo_unidade(uuid) from public, anon;
grant execute on function public.tem_vinculo_unidade(uuid) to authenticated;

alter table public.organizational_units enable row level security;
alter table public.organization_memberships enable row level security;

-- Fase 1: usuário autenticado enxerga somente unidades às quais está vinculado.
-- Acesso a ancestrais/descendentes será adicionado junto do motor de escopo,
-- evitando conceder hierarquia implicitamente.
drop policy if exists "membro le unidade vinculada" on public.organizational_units;
create policy "membro le unidade vinculada"
on public.organizational_units for select to authenticated
using (public.tem_vinculo_unidade(id));

drop policy if exists "usuario le proprios vinculos" on public.organization_memberships;
create policy "usuario le proprios vinculos"
on public.organization_memberships for select to authenticated
using (user_id = auth.uid());

-- Bootstrap seguro do Tenant 001. O vínculo dos usuários atuais será feito em
-- migration posterior, após mapear papel/unidade e validar a transição.
insert into public.organizational_units (type, nome, slug, pais, timezone, metadata)
values (
  'clube',
  'Filhos da Conquista',
  'filhos-da-conquista',
  'BR',
  'America/Recife',
  '{"tenant":"001","legacy":true}'::jsonb
)
on conflict (slug) do update
set nome = excluded.nome,
    metadata = public.organizational_units.metadata || excluded.metadata,
    updated_at = now();

notify pgrst, 'reload schema';

insert into public.migracoes_aplicadas (arquivo)
values ('2026-09-21-fundacao-saas-multitenant.sql')
on conflict (arquivo) do update set aplicada_em = now();
