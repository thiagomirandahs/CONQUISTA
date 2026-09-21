-- =====================================================================
-- DesbravaClube — Ponte de perfis legados para o Tenant 001
--
-- Todo perfil que ainda não tenha vínculo organizacional ativo pertence ao
-- clube legado Filhos da Conquista. Perfis já vinculados a outro tenant são
-- preservados: esta migration nunca transfere usuários entre clubes.
-- =====================================================================

insert into public.organization_memberships (
  user_id,
  organizational_unit_id,
  role,
  status,
  metadata
)
select
  p.id,
  tenant_001.id,
  case p.papel
    when 'diretoria' then 'diretoria'
    when 'instrutor' then 'instrutor'
    when 'conselheiro' then 'conselheiro'
    when 'tesoureiro' then 'tesoureiro'
    when 'pais' then 'responsavel'
    else 'desbravador'
  end,
  case when p.status = 'ativo' then 'ativo' else 'pendente' end,
  jsonb_build_object(
    'source', 'legacy-profile-backfill',
    'legacy_papel', p.papel,
    'legacy_status', p.status
  )
from public.profiles p
cross join lateral (
  select id
  from public.organizational_units
  where slug = 'filhos-da-conquista'
    and type = 'clube'
    and status = 'ativo'
) tenant_001
where not exists (
  select 1
  from public.organization_memberships m
  where m.user_id = p.id
    and m.status in ('pendente', 'ativo')
    and m.starts_at <= now()
    and (m.ends_at is null or m.ends_at > now())
);

notify pgrst, 'reload schema';

insert into public.migracoes_aplicadas (arquivo)
values ('2026-09-21-mapear-perfis-legados-tenant-001.sql')
on conflict (arquivo) do update set aplicada_em = now();
