-- =====================================================================
-- DesbravaClube — Agenda por clube
-- Eventos são dados operacionais do clube e não podem aparecer fora dele.
-- =====================================================================

alter table public.eventos
  add column if not exists club_id uuid references public.organizational_units(id);

update public.eventos
set club_id = public.clube_legado_id()
where club_id is null;

alter table public.eventos
  alter column club_id set default public.clube_atual_id(),
  alter column club_id set not null;

create index if not exists idx_eventos_club_data
  on public.eventos (club_id, data, data_fim);

drop policy if exists "ler eventos" on public.eventos;
drop policy if exists "gerir eventos" on public.eventos;
create policy "membro le eventos do proprio clube"
on public.eventos for select to authenticated
using (public.tem_vinculo_unidade(club_id));
create policy "lideranca gere eventos do proprio clube"
on public.eventos for all to authenticated
using (public.pode_gerir_no_clube(club_id))
with check (
  public.pode_gerir_no_clube(club_id)
  and club_id = public.clube_atual_id()
);

notify pgrst, 'reload schema';

insert into public.migracoes_aplicadas (arquivo)
values ('2026-09-21-tenantiza-agenda.sql')
on conflict (arquivo) do update set aplicada_em = now();
