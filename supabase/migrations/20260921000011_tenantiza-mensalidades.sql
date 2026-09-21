-- Mensalidades pertencem ao clube do membro cobrado.
create or replace function public.pode_financeiro_no_clube(p_club_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.organization_memberships m
    where m.user_id = auth.uid() and m.organizational_unit_id = p_club_id
      and m.role in ('tesoureiro', 'diretoria') and m.status = 'ativo'
      and m.starts_at <= now() and (m.ends_at is null or m.ends_at > now())
  );
$$;
revoke all on function public.pode_financeiro_no_clube(uuid) from public, anon;
grant execute on function public.pode_financeiro_no_clube(uuid) to authenticated;

alter table public.mensalidades
  add column if not exists club_id uuid references public.organizational_units(id);

update public.mensalidades m
set club_id = coalesce((
  select om.organizational_unit_id from public.organization_memberships om
  where om.user_id = m.desbravador_id and om.status = 'ativo'
  order by om.starts_at, om.created_at limit 1
), public.clube_legado_id())
where club_id is null;

create or replace function public.definir_club_mensalidade()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  select organizational_unit_id into new.club_id
  from public.organization_memberships
  where user_id = new.desbravador_id and status = 'ativo'
    and starts_at <= now() and (ends_at is null or ends_at > now())
  order by starts_at, created_at limit 1;
  if new.club_id is null then raise exception 'Membro sem clube para mensalidade.'; end if;
  return new;
end;
$$;
drop trigger if exists trg_definir_club_mensalidade on public.mensalidades;
create trigger trg_definir_club_mensalidade before insert or update of desbravador_id
on public.mensalidades for each row execute function public.definir_club_mensalidade();

alter table public.mensalidades alter column club_id set not null;
alter table public.mensalidades drop constraint if exists mensalidades_desbravador_id_mes_ano_key;
alter table public.mensalidades add constraint uq_mensalidade_clube_mes
  unique (club_id, desbravador_id, mes, ano);
create index if not exists idx_mensalidades_club_periodo on public.mensalidades(club_id, ano, mes);

drop policy if exists "ler mensalidades" on public.mensalidades;
drop policy if exists "gerir mensalidades" on public.mensalidades;
create policy "membro le propria mensalidade do clube"
on public.mensalidades for select to authenticated
using (public.tem_vinculo_unidade(club_id) and (desbravador_id = auth.uid() or public.pode_financeiro_no_clube(club_id)));
create policy "financeiro gere mensalidades do proprio clube"
on public.mensalidades for all to authenticated
using (public.pode_financeiro_no_clube(club_id))
with check (public.pode_financeiro_no_clube(club_id) and club_id = public.clube_atual_id());

notify pgrst, 'reload schema';
insert into public.migracoes_aplicadas (arquivo) values ('2026-09-21-tenantiza-mensalidades.sql')
on conflict (arquivo) do update set aplicada_em = now();
