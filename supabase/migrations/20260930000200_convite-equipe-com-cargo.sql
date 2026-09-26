-- Convite de equipe com CARGO (26/09): a diretoria escolhia só o NÍVEL de acesso (instrutor, conselheiro,
-- tesoureiro, diretoria) e não havia Capelão, Secretário, Diretor Associado etc. Agora o convite leva o
-- CARGO real do clube de Desbravadores, e o nível de acesso sai dele (mapa fixo no servidor — o cliente
-- não escolhe um cargo com acesso maior do que o cargo dá):
--   Diretor(a), Diretor(a) Associado(a), Secretário(a) -> diretoria
--   Tesoureiro(a)                                      -> tesoureiro
--   Capelão/Capelã, Instrutor(a)                       -> instrutor
--   Conselheiro(a)                                     -> conselheiro
-- O cargo fica no convite e vai para organization_memberships.metadata.cargo ao aceitar.
-- Desbravador/Capitão continuam FORA: criança entra por cadastro + aprovação (ver comentário original).

alter table public.club_team_invites add column if not exists cargo text;

create or replace function public._papel_do_cargo_de_equipe(p_cargo text) returns text
language sql immutable set search_path = '' as $$
  select case p_cargo
    when 'Diretor' then 'diretoria' when 'Diretora' then 'diretoria'
    when 'Diretor Associado' then 'diretoria' when 'Diretora Associada' then 'diretoria'
    when 'Secretário' then 'diretoria' when 'Secretária' then 'diretoria'
    when 'Tesoureiro' then 'tesoureiro' when 'Tesoureira' then 'tesoureiro'
    when 'Capelão' then 'instrutor' when 'Capelã' then 'instrutor'
    when 'Instrutor' then 'instrutor' when 'Instrutora' then 'instrutor'
    when 'Conselheiro' then 'conselheiro' when 'Conselheira' then 'conselheiro'
    else null end
$$;
revoke all on function public._papel_do_cargo_de_equipe(text) from public, anon;

-- 2 argumentos -> 3 (p_cargo opcional). Removido o antigo para não haver ambiguidade de sobrecarga.
drop function if exists public.convite_equipe_criar(text, text);
create or replace function public.convite_equipe_criar(p_email text, p_papel text default 'instrutor', p_cargo text default null)
returns jsonb
language plpgsql security definer set search_path = ''
as $function$
declare v_club uuid := public.clube_atual_id(); v_email text; v_id uuid; v_papel text := p_papel; v_cargo text := nullif(btrim(coalesce(p_cargo, '')), '');
begin
  if auth.uid() is null then raise exception 'Não autenticado.'; end if;
  if v_club is null or not public.pode_gerir_no_clube(v_club) then
    raise exception 'Sem permissão (apenas diretoria/instrutor deste clube).';
  end if;

  v_email := lower(btrim(coalesce(p_email, '')));
  if v_email = '' or position('@' in v_email) = 0 then raise exception 'Informe o e-mail de quem você quer convidar.'; end if;

  -- com cargo, o NÍVEL vem do cargo (o servidor decide; p_papel é ignorado)
  if v_cargo is not null then
    v_papel := public._papel_do_cargo_de_equipe(v_cargo);
    if v_papel is null then raise exception 'Cargo inválido para a equipe do clube.'; end if;
  end if;

  if v_papel not in ('conselheiro', 'instrutor', 'tesoureiro', 'diretoria') then
    raise exception 'Papel inválido. A equipe do clube aceita conselheiro, instrutor, tesoureiro ou diretoria.';
  end if;

  insert into public.club_team_invites (club_id, email, papel, cargo, criado_por, status, expires_at)
  values (v_club, v_email, v_papel, v_cargo, auth.uid(), 'pendente', now() + interval '14 days')
  on conflict (club_id, email) do update
     set papel = excluded.papel, cargo = excluded.cargo, status = 'pendente', criado_por = excluded.criado_por,
         aceito_por = null, aceito_em = null,
         expires_at = excluded.expires_at
  returning id into v_id;

  return jsonb_build_object('ok', true, 'id', v_id, 'papel', v_papel, 'cargo', v_cargo, 'expira_em', (now() + interval '14 days'));
end $function$;
revoke all on function public.convite_equipe_criar(text, text, text) from public, anon;
grant execute on function public.convite_equipe_criar(text, text, text) to authenticated;

create or replace function public.convite_equipe_aceitar(p_id uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $function$
declare v_uid uuid := auth.uid(); v_i public.club_team_invites; v_ja boolean;
begin
  if v_uid is null then raise exception 'Não autenticado.'; end if;

  select * into v_i from public.club_team_invites
   where id = p_id and status = 'pendente'
     and expires_at > now()
     and email = (select lower(u.email) from auth.users u where u.id = v_uid)
   for update;
  if not found then raise exception 'Convite não encontrado, vencido ou já usado.'; end if;

  select exists (
    select 1 from public.organization_memberships
     where user_id = v_uid and organizational_unit_id = v_i.club_id
  ) into v_ja;

  if not v_ja then
    insert into public.organization_memberships (user_id, organizational_unit_id, role, status, metadata)
    values (v_uid, v_i.club_id, v_i.papel, 'ativo',
            jsonb_strip_nulls(jsonb_build_object('source', 'convite_equipe', 'cargo', v_i.cargo)));
  end if;

  update public.club_team_invites
     set status = 'aceito', aceito_por = v_uid, aceito_em = now()
   where id = v_i.id;

  return jsonb_build_object('ok', true, 'club_id', v_i.club_id, 'ja_era_membro', v_ja);
end $function$;

notify pgrst, 'reload schema';
