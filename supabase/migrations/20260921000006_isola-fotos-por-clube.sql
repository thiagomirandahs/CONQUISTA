-- =====================================================================
-- DesbravaClube — Fotos do mural por clube
-- =====================================================================

alter table public.fotos
  add column if not exists club_id uuid references public.organizational_units(id);

update public.fotos f
set club_id = coalesce(
  (select m.organizational_unit_id
   from public.organization_memberships m
   where m.user_id = f.autor_id
     and m.status = 'ativo'
     and m.starts_at <= now()
     and (m.ends_at is null or m.ends_at > now())
   order by m.starts_at, m.created_at
   limit 1),
  public.clube_legado_id()
)
where f.club_id is null;

alter table public.fotos
  alter column club_id set not null;
create index if not exists idx_fotos_club on public.fotos(club_id);

create or replace function public.definir_club_foto()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
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

drop trigger if exists trg_definir_club_foto on public.fotos;
create trigger trg_definir_club_foto
before insert or update of autor_id on public.fotos
for each row execute function public.definir_club_foto();

drop policy if exists "ler fotos" on public.fotos;
drop policy if exists "postar foto" on public.fotos;
drop policy if exists "apagar foto" on public.fotos;
create policy "membro le fotos do proprio clube"
on public.fotos for select to authenticated
using (public.tem_vinculo_unidade(club_id));
create policy "membro posta foto no proprio clube"
on public.fotos for insert to authenticated
with check (autor_id = auth.uid() and public.tem_vinculo_unidade(club_id));
create policy "autor ou lideranca apaga foto do proprio clube"
on public.fotos for delete to authenticated
using (
  public.tem_vinculo_unidade(club_id)
  and (autor_id = auth.uid() or public.pode_gerir_no_clube(club_id))
);

notify pgrst, 'reload schema';

insert into public.migracoes_aplicadas (arquivo)
values ('2026-09-21-isola-fotos-por-clube.sql')
on conflict (arquivo) do update set aplicada_em = now();
