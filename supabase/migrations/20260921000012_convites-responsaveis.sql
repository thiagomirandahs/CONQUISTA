create table public.club_invites (
  id uuid primary key default gen_random_uuid(), club_id uuid not null references public.organizational_units(id) on delete cascade,
  token_hash text not null unique, expires_at timestamptz not null, used_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null, created_at timestamptz not null default now()
);
alter table public.club_invites enable row level security;

create or replace function public.criar_convite_responsavel()
returns json language plpgsql security definer set search_path = public as $$
declare v_club uuid := public.clube_atual_id(); v_token text := encode(extensions.gen_random_bytes(24), 'hex');
begin
  if v_club is null or not public.pode_gerir_no_clube(v_club) then raise exception 'Sem permissão para criar convite.'; end if;
  insert into public.club_invites(club_id, token_hash, expires_at, created_by)
  values (v_club, encode(extensions.digest(v_token, 'sha256'), 'hex'), now() + interval '14 days', auth.uid());
  return json_build_object('token', v_token, 'expires_at', now() + interval '14 days');
end; $$;
grant execute on function public.criar_convite_responsavel() to authenticated;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_tipo text := new.raw_user_meta_data->>'tipo'; v_token text := new.raw_user_meta_data->>'convite_responsavel'; v_inv public.club_invites;
begin
  if v_tipo = 'pais' then
    if coalesce(v_token, '') = '' then raise exception 'Cadastro de responsável exige convite do clube.'; end if;
    select * into v_inv from public.club_invites
    where token_hash = encode(extensions.digest(v_token, 'sha256'), 'hex') and used_at is null and expires_at > now() for update;
    if v_inv.id is null then raise exception 'Convite inválido, usado ou expirado.'; end if;
    insert into public.profiles(id,nome,papel,status) values (new.id,new.raw_user_meta_data->>'nome','pais','ativo');
    insert into public.organization_memberships(user_id,organizational_unit_id,role,status,metadata)
    values(new.id,v_inv.club_id,'pais','ativo','{"source":"responsavel_invite"}'::jsonb);
    update public.club_invites set used_at=now() where id=v_inv.id;
  else
    insert into public.profiles(id,nome,nascimento,unidade_id,cargo,papel,status)
    values(new.id,new.raw_user_meta_data->>'nome',(nullif(new.raw_user_meta_data->>'nascimento',''))::date,
      (nullif(new.raw_user_meta_data->>'unidade_id',''))::uuid,new.raw_user_meta_data->>'cargo','desbravador','pendente');
  end if;
  return new;
end; $$;
notify pgrst, 'reload schema';
insert into public.migracoes_aplicadas(arquivo) values ('2026-09-21-convites-responsaveis.sql') on conflict(arquivo) do update set aplicada_em=now();
