-- =====================================================================
-- DesbravaClube — Isola atividades, entregas e pontos por clube
-- =====================================================================

alter table public.atividades
  add column if not exists club_id uuid references public.organizational_units(id);
alter table public.entregas
  add column if not exists club_id uuid references public.organizational_units(id);
alter table public.pontos
  add column if not exists club_id uuid references public.organizational_units(id);

update public.atividades
set club_id = public.clube_legado_id()
where club_id is null;

update public.entregas e
set club_id = coalesce(a.club_id, public.clube_legado_id())
from public.atividades a
where e.atividade_id = a.id
  and e.club_id is null;

update public.entregas
set club_id = public.clube_legado_id()
where club_id is null;

update public.pontos p
set club_id = coalesce(
  (select u.club_id from public.unidades u where u.id = p.unidade_id),
  (select m.organizational_unit_id
   from public.organization_memberships m
   where m.user_id = p.usuario_id
     and m.status = 'ativo'
     and m.starts_at <= now()
     and (m.ends_at is null or m.ends_at > now())
   order by m.starts_at, m.created_at
   limit 1),
  public.clube_legado_id()
)
where p.club_id is null;

alter table public.atividades
  alter column club_id set default public.clube_legado_id(),
  alter column club_id set not null;
alter table public.entregas
  alter column club_id set not null;
alter table public.pontos
  alter column club_id set not null;

create index if not exists idx_atividades_club on public.atividades(club_id);
create index if not exists idx_entregas_club on public.entregas(club_id);
create index if not exists idx_pontos_club on public.pontos(club_id);

create or replace function public.definir_club_entrega()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  select club_id into new.club_id
  from public.atividades
  where id = new.atividade_id;

  if new.club_id is null then
    raise exception 'Atividade inválida ou sem clube.';
  end if;

  if not exists (
    select 1
    from public.organization_memberships m
    where m.user_id = new.usuario_id
      and m.organizational_unit_id = new.club_id
      and m.status in ('pendente', 'ativo')
      and m.starts_at <= now()
      and (m.ends_at is null or m.ends_at > now())
  ) then
    raise exception 'O usuário não pertence ao clube desta atividade.';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_definir_club_entrega on public.entregas;
create trigger trg_definir_club_entrega
before insert or update of atividade_id, usuario_id on public.entregas
for each row execute function public.definir_club_entrega();

create or replace function public.definir_club_ponto()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.unidade_id is not null then
    select club_id into new.club_id
    from public.unidades
    where id = new.unidade_id;
  elsif new.usuario_id is not null then
    select organizational_unit_id into new.club_id
    from public.organization_memberships
    where user_id = new.usuario_id
      and status in ('pendente', 'ativo')
      and starts_at <= now()
      and (ends_at is null or ends_at > now())
    order by starts_at, created_at
    limit 1;
  end if;

  new.club_id := coalesce(new.club_id, public.clube_legado_id());
  return new;
end;
$$;

drop trigger if exists trg_definir_club_ponto on public.pontos;
create trigger trg_definir_club_ponto
before insert or update of unidade_id, usuario_id on public.pontos
for each row execute function public.definir_club_ponto();

-- Atividades: visíveis e gerenciáveis apenas no clube do membership.
drop policy if exists "ler atividades" on public.atividades;
drop policy if exists "gerir atividades" on public.atividades;
drop policy if exists "editar atividade" on public.atividades;
create policy "membro le atividades do proprio clube"
on public.atividades for select to authenticated
using (public.tem_vinculo_unidade(club_id));
create policy "lideranca gere atividades do proprio clube"
on public.atividades for all to authenticated
using (public.pode_gerir_no_clube(club_id))
with check (public.pode_gerir_no_clube(club_id));

-- Entregas: o participante vê/envia a própria; liderança do clube avalia.
drop policy if exists "ler entregas" on public.entregas;
drop policy if exists "criar entrega" on public.entregas;
drop policy if exists "corrigir entrega" on public.entregas;
drop policy if exists "apagar entrega" on public.entregas;
drop policy if exists "reenviar entrega" on public.entregas;
create policy "participante le entrega do proprio clube"
on public.entregas for select to authenticated
using (
  public.tem_vinculo_unidade(club_id)
  and (usuario_id = auth.uid() or public.pode_gerir_no_clube(club_id))
);
create policy "participante envia entrega no proprio clube"
on public.entregas for insert to authenticated
with check (
  usuario_id = auth.uid()
  and status = 'pendente'
  and public.tem_vinculo_unidade(club_id)
);
create policy "participante reenvia entrega no proprio clube"
on public.entregas for update to authenticated
using (usuario_id = auth.uid() and status = 'reprovada' and public.tem_vinculo_unidade(club_id))
with check (usuario_id = auth.uid() and status = 'pendente' and public.tem_vinculo_unidade(club_id));
create policy "lideranca avalia entrega do proprio clube"
on public.entregas for update to authenticated
using (public.pode_gerir_no_clube(club_id))
with check (public.pode_gerir_no_clube(club_id));
create policy "lideranca apaga entrega do proprio clube"
on public.entregas for delete to authenticated
using (public.pode_gerir_no_clube(club_id));

-- Pontos: ranking e lançamentos nunca cruzam o clube associado ao registro.
drop policy if exists "ler pontos" on public.pontos;
drop policy if exists "lancar pontos" on public.pontos;
drop policy if exists "apagar pontos" on public.pontos;
create policy "membro le pontos do proprio clube"
on public.pontos for select to authenticated
using (public.tem_vinculo_unidade(club_id));
create policy "lideranca lanca pontos do proprio clube"
on public.pontos for insert to authenticated
with check (
  public.tem_vinculo_unidade(club_id)
  and (
    public.pode_gerir_no_clube(club_id)
    or (unidade_id is null and public.pode_apontar(usuario_id))
  )
);
create policy "lideranca apaga pontos do proprio clube"
on public.pontos for delete to authenticated
using (
  public.tem_vinculo_unidade(club_id)
  and (
    public.pode_gerir_no_clube(club_id)
    or (unidade_id is null and public.pode_apontar(usuario_id))
  )
);

create or replace function public.aprovar_entrega(p_entrega_id uuid)
returns json language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_ent public.entregas;
  v_atv public.atividades;
  v_pts int;
begin
  select * into v_ent from public.entregas where id = p_entrega_id and status = 'pendente' for update;
  if v_ent.id is null then
    return json_build_object('ok', false, 'motivo', 'ja_avaliada');
  end if;
  if not public.pode_gerir_no_clube(v_ent.club_id) then
    raise exception 'Sem permissão neste clube.';
  end if;

  update public.entregas
     set status = 'aprovada', avaliado_por = v_uid
   where id = v_ent.id;

  select * into v_atv from public.atividades where id = v_ent.atividade_id;
  v_pts := coalesce(v_atv.pontos, 0);
  update public.entregas set pontos_dados = v_pts where id = v_ent.id;
  insert into public.pontos (usuario_id, origem, pontos, motivo, lancado_por, entrega_id, club_id)
    values (v_ent.usuario_id, 'atividade', v_pts,
            'Atividade: ' || coalesce(v_atv.titulo, ''), v_uid, v_ent.id, v_ent.club_id);

  return json_build_object('ok', true, 'pontos', v_pts);
end;
$$;
grant execute on function public.aprovar_entrega(uuid) to authenticated;

notify pgrst, 'reload schema';

insert into public.migracoes_aplicadas (arquivo)
values ('2026-09-21-tenantiza-nucleo-operacional.sql')
on conflict (arquivo) do update set aplicada_em = now();
