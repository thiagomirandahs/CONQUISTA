-- =============================================================================
-- 340 — Entrada em clube: o papel do PEDIDO não lê mais profiles.papel
-- =============================================================================
-- Regressão achada pelo gate SQL 29 (28/09): entrada_solicitar_clube (migration 204) decidia se o
-- pedido pendente nascia 'pais' olhando profiles.papel. profiles.papel é só o ESPELHO do vínculo do
-- clube primário (gatilho vínculo -> perfil), então quem é 'pais' no clube A pedia o clube B e o
-- pedido herdava 'pais' do clube A — papel vindo de OUTRO clube. entrada_solicitar (migration 104)
-- tinha o mesmo desenho e estava só "declarado" como exceção no teste 29.
--
-- Correção: o que as duas funções queriam saber não é "qual o papel dele", e sim "esta conta foi
-- aberta como responsável?". Isso agora é um fato próprio, gravado UMA vez no cadastro:
--   profiles.tipo_cadastro  ('membro' | 'pais')
--   * escrito só pelo gatilho handle_new_user (security definer);
--   * authenticated não tem UPDATE nessa coluna e profiles não tem policy de INSERT;
--   * o espelho vínculo -> perfil NÃO toca nele (não depende de clube nenhum).
-- O resto do fluxo não muda: pedido sempre 'pendente', papel decidido no servidor (código do clube
-- ou 'desbravador'; 'pais' só para conta aberta como responsável), a diretoria aprova e pode ajustar
-- o papel em vinculo_gerir; vínculo com filho continua sendo o processo separado.
-- =============================================================================

alter table public.profiles
  add column if not exists tipo_cadastro text not null default 'membro'
  constraint profiles_tipo_cadastro_chk check (tipo_cadastro in ('membro', 'pais'));

comment on column public.profiles.tipo_cadastro is
  'Como a conta foi aberta (membro|pais). Gravado só no cadastro (handle_new_user); não é papel em clube nenhum.';

-- Backfill conservador: só é 'pais' quem se cadastrou como responsável (metadata do cadastro) E cujo
-- perfil ainda diz 'pais'. Na dúvida fica 'membro' — o pior caso é o pedido nascer 'desbravador' e a
-- diretoria ajustar na aprovação (nunca o contrário).
update public.profiles p
   set tipo_cadastro = 'pais'
  from auth.users u
 where u.id = p.id
   and u.raw_user_meta_data->>'tipo' = 'pais'
   and p.papel = 'pais'
   and p.tipo_cadastro <> 'pais';

create or replace function public.handle_new_user()
 returns trigger
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_tipo text := v_meta->>'tipo';
  v_token text := v_meta->>'convite_responsavel';
  v_inv public.club_invites;
  v_club uuid;
begin
  if v_tipo = 'pais' and coalesce(v_token, '') <> '' then
    select * into v_inv from public.club_invites
     where token_hash = encode(extensions.digest(v_token, 'sha256'), 'hex')
       and used_at is null and revoked_at is null and expires_at > now()
     for update;
    if v_inv.id is null then raise exception 'Convite inválido, usado, revogado ou expirado.'; end if;
    v_club := v_inv.club_id;
    perform set_config('app.signup_club', v_club::text, true);
    insert into public.profiles (id, nome, papel, status, tipo_cadastro) values (new.id, v_meta->>'nome', 'pais', 'ativo', 'pais');
    insert into public.organization_memberships (user_id, organizational_unit_id, role, status, metadata)
    values (new.id, v_club, 'pais', 'ativo', '{"source":"cadastro"}'::jsonb);
    update public.club_invites set used_at = now(), used_by = new.id where id = v_inv.id;
    perform set_config('app.signup_club', '', true);
    return new;
  end if;

  perform set_config('app.signup_sem_clube', '1', true);
  if v_tipo = 'pais' then
    insert into public.profiles (id, nome, papel, status, tipo_cadastro) values (new.id, v_meta->>'nome', 'pais', 'ativo', 'pais');
  else
    insert into public.profiles (id, nome, nascimento, cargo, papel, status, tipo_cadastro)
    values (new.id, v_meta->>'nome', (nullif(v_meta->>'nascimento', ''))::date,
            v_meta->>'cargo', 'desbravador', 'ativo', 'membro');
  end if;
  perform set_config('app.signup_sem_clube', '', true);
  return new;
end $function$;

create or replace function public.entrada_solicitar(p_codigo text)
 returns json
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare v_uid uuid := auth.uid(); v_row public.club_entry_codes; v_ja public.organization_memberships; v_achou boolean;
        v_papel text;
begin
  if v_uid is null then raise exception 'Entre na sua conta para continuar.'; end if;
  if public._entrada_excedeu_limite() then
    raise exception 'Muitas tentativas. Espere alguns minutos e tente de novo.';
  end if;

  select * into v_row from public.club_entry_codes
   where codigo_hash = encode(extensions.digest(upper(btrim(coalesce(p_codigo, ''))), 'sha256'), 'hex')
     and revoked_at is null
     and (expires_at is null or expires_at > now())
   for update;
  v_achou := found;
  perform public._entrada_registrar_tentativa(v_achou);
  if not v_achou then return json_build_object('encontrado', false); end if;

  select * into v_ja from public.organization_memberships
   where user_id = v_uid and organizational_unit_id = v_row.club_id
   for update;
  if found then
    return json_build_object('encontrado', true, 'ok', true, 'ja_era', true, 'situacao', v_ja.status);
  end if;

  -- o papel NÃO vem do cliente nem de outro clube: é o do código, exceto para conta aberta como responsável
  v_papel := case when (select p.tipo_cadastro from public.profiles p where p.id = v_uid) = 'pais' then 'pais' else v_row.papel end;

  insert into public.organization_memberships (user_id, organizational_unit_id, role, status, metadata)
  values (v_uid, v_row.club_id, v_papel, 'pendente',
          jsonb_build_object('source', 'codigo_de_entrada', 'codigo_id', v_row.id));

  return json_build_object('encontrado', true, 'ok', true, 'ja_era', false, 'situacao', 'pendente', 'papel', v_papel);
end $function$;

create or replace function public.entrada_solicitar_clube(p_slug text)
 returns json
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare v_uid uuid := auth.uid(); v_club public.organizational_units; v_show public.club_showcase; v_ja public.organization_memberships; v_papel text;
begin
  if v_uid is null then raise exception 'Entre na sua conta para continuar.'; end if;
  if public._entrada_excedeu_limite() then
    raise exception 'Muitas tentativas. Espere alguns minutos e tente de novo.';
  end if;
  select * into v_club from public.organizational_units
   where slug = lower(btrim(coalesce(p_slug, ''))) and type = 'clube' and status = 'ativo';
  select * into v_show from public.club_showcase where club_id = v_club.id;
  if v_club.id is null or not public._vitrine_clube_listavel(v_club, v_show) then
    perform public._entrada_registrar_tentativa(false);
    return json_build_object('encontrado', false);
  end if;
  perform public._entrada_registrar_tentativa(true);

  select * into v_ja from public.organization_memberships where user_id = v_uid and organizational_unit_id = v_club.id for update;
  if found then
    return json_build_object('encontrado', true, 'ok', true, 'ja_era', true, 'situacao', v_ja.status, 'clube', v_club.nome);
  end if;

  -- papel decidido no servidor; nunca herdado do papel em outro clube (o papel do perfil é só espelho)
  v_papel := case when (select p.tipo_cadastro from public.profiles p where p.id = v_uid) = 'pais' then 'pais' else 'desbravador' end;
  insert into public.organization_memberships (user_id, organizational_unit_id, role, status, metadata)
  values (v_uid, v_club.id, v_papel, 'pendente', jsonb_build_object('source', 'cadastro_escolheu_clube'));

  return json_build_object('encontrado', true, 'ok', true, 'ja_era', false, 'situacao', 'pendente', 'papel', v_papel, 'clube', v_club.nome);
end $function$;

-- create or replace preserva os grants; reafirma o fechamento a anon
revoke execute on function public.entrada_solicitar(text), public.entrada_solicitar_clube(text) from public, anon;
