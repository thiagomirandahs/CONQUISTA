-- =====================================================================
-- DesbravaClube — Unidades por clube
--
-- A tabela legada de unidades passa a pertencer a um clube organizacional.
-- Dados existentes são preservados no Tenant 001 e novas consultas deixam de
-- atravessar clubes.
-- =====================================================================

create or replace function public.clube_legado_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id
  from public.organizational_units
  where slug = 'filhos-da-conquista'
    and type = 'clube'
  limit 1;
$$;

revoke execute on function public.clube_legado_id() from public, anon;
grant execute on function public.clube_legado_id() to authenticated;

alter table public.unidades
  add column if not exists club_id uuid references public.organizational_units(id);

update public.unidades
set club_id = public.clube_legado_id()
where club_id is null;

alter table public.unidades
  alter column club_id set default public.clube_legado_id(),
  alter column club_id set not null;

do $chk$
begin
  if exists (select 1 from public.unidades group by club_id, nome having count(*) > 1) then
    raise exception 'Há unidades com o MESMO nome no mesmo clube (%). Renomeie/una antes de aplicar esta migration: select nome, count(*) from public.unidades group by 1 having count(*) > 1;',
      (select string_agg(nome, ', ') from (select nome from public.unidades group by club_id, nome having count(*) > 1) d);
  end if;
end $chk$;

create unique index if not exists uq_unidades_club_nome
  on public.unidades(club_id, nome);
create index if not exists idx_unidades_club
  on public.unidades(club_id);

create or replace function public.pode_gerir_no_clube(p_club_id uuid)
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
      and m.organizational_unit_id = p_club_id
      and m.role in ('instrutor', 'diretoria')
      and m.status = 'ativo'
      and m.starts_at <= now()
      and (m.ends_at is null or m.ends_at > now())
  );
$$;

revoke execute on function public.pode_gerir_no_clube(uuid) from public, anon;
grant execute on function public.pode_gerir_no_clube(uuid) to authenticated;

drop policy if exists "ler unidades publico" on public.unidades;
drop policy if exists "gerir unidades" on public.unidades;

-- O cadastro legado continua exibindo somente as unidades do Tenant 001.
create policy "anon le unidades tenant legado"
on public.unidades for select to anon
using (club_id = public.clube_legado_id());

create policy "membro le unidades do proprio clube"
on public.unidades for select to authenticated
using (public.tem_vinculo_unidade(club_id));

create policy "lideranca gere unidades do proprio clube"
on public.unidades for all to authenticated
using (public.pode_gerir_no_clube(club_id))
with check (public.pode_gerir_no_clube(club_id));

notify pgrst, 'reload schema';

insert into public.migracoes_aplicadas (arquivo)
values ('2026-09-21-tenantiza-unidades.sql')
on conflict (arquivo) do update set aplicada_em = now();
