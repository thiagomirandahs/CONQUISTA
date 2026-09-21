-- =====================================================================
-- DesbravaClube — Central de notificações por clube
-- A camada central impede que avisos, inclusive avisos pessoais, atravessem
-- clubes. Rotinas legadas sem remetente/destinatário continuam no Tenant 001
-- até serem convertidas para informar explicitamente a origem.
-- =====================================================================

alter table public.notificacoes
  add column if not exists club_id uuid references public.organizational_units(id);

update public.notificacoes
set club_id = public.clube_legado_id()
where club_id is null;

create or replace function public.definir_club_notificacao()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Destinatário pessoal é a fonte mais precisa; em avisos gerais o remetente
  -- define o clube. O fallback preserva os avisos históricos no Tenant 001.
  select m.organizational_unit_id into new.club_id
  from public.organization_memberships m
  where m.user_id = new.para_usuario
    and m.status = 'ativo'
    and m.starts_at <= now()
    and (m.ends_at is null or m.ends_at > now())
  order by m.starts_at, m.created_at
  limit 1;

  if new.club_id is null then
    select m.organizational_unit_id into new.club_id
    from public.organization_memberships m
    where m.user_id = new.criado_por
      and m.status = 'ativo'
      and m.starts_at <= now()
      and (m.ends_at is null or m.ends_at > now())
    order by m.starts_at, m.created_at
    limit 1;
  end if;

  new.club_id := coalesce(new.club_id, public.clube_legado_id());
  return new;
end;
$$;

drop trigger if exists trg_definir_club_notificacao on public.notificacoes;
create trigger trg_definir_club_notificacao
before insert or update of para_usuario, criado_por on public.notificacoes
for each row execute function public.definir_club_notificacao();

alter table public.notificacoes
  alter column club_id set not null;
create index if not exists idx_notificacoes_club_created
  on public.notificacoes (club_id, created_at desc);

drop policy if exists "ler notificacoes" on public.notificacoes;
drop policy if exists "criar notificacao" on public.notificacoes;
create policy "membro le notificacoes do proprio clube"
on public.notificacoes for select to authenticated
using (
  public.tem_vinculo_unidade(club_id)
  and (
    para_usuario = auth.uid()
    or (para_usuario is null and public.eh_membro_ativo()
        and (para = 'todos' or (para = 'lideranca' and public.pode_aprovar())))
  )
);
create policy "lideranca cria notificacoes do proprio clube"
on public.notificacoes for insert to authenticated
with check (
  public.pode_gerir_no_clube(club_id)
  and club_id = public.clube_atual_id()
);

notify pgrst, 'reload schema';

insert into public.migracoes_aplicadas (arquivo)
values ('2026-09-21-tenantiza-notificacoes.sql')
on conflict (arquivo) do update set aplicada_em = now();
