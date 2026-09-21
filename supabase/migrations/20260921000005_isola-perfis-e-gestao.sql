-- =====================================================================
-- DesbravaClube — Perfis e gestão por clube
-- =====================================================================

create or replace function public.compartilha_clube_com(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.organization_memberships eu
    join public.organization_memberships alvo
      on alvo.organizational_unit_id = eu.organizational_unit_id
    where eu.user_id = auth.uid()
      and alvo.user_id = p_user_id
      and eu.status = 'ativo'
      and alvo.status in ('pendente', 'ativo')
      and eu.starts_at <= now()
      and (eu.ends_at is null or eu.ends_at > now())
      and alvo.starts_at <= now()
      and (alvo.ends_at is null or alvo.ends_at > now())
  );
$$;

revoke execute on function public.compartilha_clube_com(uuid) from public, anon;
grant execute on function public.compartilha_clube_com(uuid) to authenticated;

drop policy if exists "ler perfis" on public.profiles;
create policy "usuario le perfis do proprio clube"
on public.profiles for select to authenticated
using (id = auth.uid() or public.compartilha_clube_com(id));

drop policy if exists "admin atualiza perfis" on public.profiles;
create policy "lideranca atualiza perfis do proprio clube"
on public.profiles for update to authenticated
using (
  exists (
    select 1
    from public.organization_memberships eu
    join public.organization_memberships alvo
      on alvo.organizational_unit_id = eu.organizational_unit_id
    where eu.user_id = auth.uid()
      and alvo.user_id = profiles.id
      and eu.role in ('instrutor', 'diretoria')
      and eu.status = 'ativo'
      and alvo.status in ('pendente', 'ativo')
      and eu.starts_at <= now()
      and (eu.ends_at is null or eu.ends_at > now())
      and alvo.starts_at <= now()
      and (alvo.ends_at is null or alvo.ends_at > now())
  )
)
with check (public.compartilha_clube_com(id));

drop function if exists public.listar_usuarios();
create function public.listar_usuarios()
returns table (id uuid, nome text, foto text, papel text, status text, unidade_id uuid, email text, teste boolean)
language sql
security definer
set search_path = ''
as $$
  select p.id, p.nome, p.foto, p.papel, p.status, p.unidade_id,
         u.email::text, coalesce(p.teste, false)
  from public.profiles p
  left join auth.users u on u.id = p.id
  where exists (
    select 1
    from public.organization_memberships eu
    join public.organization_memberships alvo
      on alvo.organizational_unit_id = eu.organizational_unit_id
    where eu.user_id = auth.uid()
      and alvo.user_id = p.id
      and eu.role in ('instrutor', 'diretoria')
      and eu.status = 'ativo'
      and alvo.status in ('pendente', 'ativo')
      and eu.starts_at <= now()
      and (eu.ends_at is null or eu.ends_at > now())
      and alvo.starts_at <= now()
      and (alvo.ends_at is null or alvo.ends_at > now())
  )
  order by p.nome;
$$;
grant execute on function public.listar_usuarios() to authenticated;

notify pgrst, 'reload schema';

insert into public.migracoes_aplicadas (arquivo)
values ('2026-09-21-isola-perfis-e-gestao.sql')
on conflict (arquivo) do update set aplicada_em = now();
