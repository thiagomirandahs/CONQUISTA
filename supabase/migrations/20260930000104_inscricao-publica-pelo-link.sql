-- =============================================================================
--  Inscrição pelo link/QR do clube, ANTES de ter conta.
--
--  1) entrada_abrir_publico(código): quem abre o link sem conta vê a identidade PÚBLICA do clube
--     (nome, sigla, lema, logo) — o mesmo que entrada_abrir já mostrava depois do login. Só isso:
--     nada de membros, unidades ou contagens. O clube continua sendo decidido pelo servidor a partir
--     do código (hash); o cliente nunca manda club_id.
--
--     Sem auth.uid() não dá para limitar por pessoa, então o limite é por ORIGEM (hash do IP que o
--     gateway repassa) e por um TETO GLOBAL de erros — o teto vale mesmo para quem forja o IP. Código
--     inválido, vencido, revogado e inexistente dão a MESMA resposta. O código tem 64 bits aleatórios.
--
--  2) entrada_solicitar: responsável (profiles.papel = 'pais') que entra pelo link do clube nasce
--     como vínculo 'pais' pendente — antes nascia com o papel do código ('desbravador'). Não mexe no
--     vínculo responsável → filho, que é outro processo (responsaveis + consentimento).
-- =============================================================================

create table if not exists public.entrada_tentativas_publicas (
  id bigserial primary key,
  origem_hash text not null,
  quando timestamptz not null default now(),
  acertou boolean not null
);
create index if not exists idx_entrada_publica_origem on public.entrada_tentativas_publicas (origem_hash, quando desc);
create index if not exists idx_entrada_publica_quando on public.entrada_tentativas_publicas (quando desc);
alter table public.entrada_tentativas_publicas enable row level security;
revoke all on public.entrada_tentativas_publicas from public, anon, authenticated;

create or replace function public._entrada_origem() returns text
language sql stable set search_path = '' as $$
  select encode(extensions.digest(
    coalesce(nullif(btrim(split_part(coalesce(nullif(current_setting('request.headers', true), '')::json ->> 'x-forwarded-for', ''), ',', 1)), ''), 'desconhecida'),
    'sha256'), 'hex');
$$;
revoke all on function public._entrada_origem() from public, anon, authenticated;

create or replace function public.entrada_abrir_publico(p_codigo text)
returns json
language plpgsql security definer set search_path = ''
as $$
declare v_row public.club_entry_codes; v_marca jsonb; v_nome text; v_achou boolean; v_origem text := public._entrada_origem();
begin
  if (select count(*) from public.entrada_tentativas_publicas
       where origem_hash = v_origem and not acertou and quando > now() - interval '10 minutes') >= 10
     or (select count(*) from public.entrada_tentativas_publicas
          where not acertou and quando > now() - interval '10 minutes') >= 300 then
    raise exception 'Muitas tentativas. Espere alguns minutos e tente de novo.';
  end if;

  select * into v_row from public.club_entry_codes
   where codigo_hash = encode(extensions.digest(upper(btrim(coalesce(p_codigo, ''))), 'sha256'), 'hex')
     and revoked_at is null
     and (expires_at is null or expires_at > now());
  v_achou := found;   -- antes do insert: o insert redefine `found`

  insert into public.entrada_tentativas_publicas (origem_hash, acertou) values (v_origem, v_achou);
  delete from public.entrada_tentativas_publicas where quando < now() - interval '1 day';

  if not v_achou then return json_build_object('encontrado', false); end if;

  select o.nome, o.metadata -> 'marca' into v_nome, v_marca
    from public.organizational_units o where o.id = v_row.club_id and o.status = 'ativo';
  if v_nome is null then return json_build_object('encontrado', false); end if;

  return json_build_object(
    'encontrado', true,
    'clube', v_nome,
    'sigla', v_marca ->> 'sigla',
    'lema', v_marca ->> 'lema',
    'logo_url', v_marca ->> 'logo_url'
  );
end $$;
revoke all on function public.entrada_abrir_publico(text) from public;
grant execute on function public.entrada_abrir_publico(text) to anon, authenticated;

create or replace function public.entrada_solicitar(p_codigo text)
returns json
language plpgsql security definer set search_path = ''
as $$
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

  -- o papel NÃO vem do cliente: é o do código, exceto para quem se cadastrou como responsável
  v_papel := case when (select p.papel from public.profiles p where p.id = v_uid) = 'pais' then 'pais' else v_row.papel end;

  insert into public.organization_memberships (user_id, organizational_unit_id, role, status, metadata)
  values (v_uid, v_row.club_id, v_papel, 'pendente',
          jsonb_build_object('source', 'codigo_de_entrada', 'codigo_id', v_row.id));

  return json_build_object('encontrado', true, 'ok', true, 'ja_era', false, 'situacao', 'pendente', 'papel', v_papel);
end $$;
revoke all on function public.entrada_solicitar(text) from public, anon;
grant execute on function public.entrada_solicitar(text) to authenticated;

-- 3) Cadastro de responsável SEM convite nominal. Com convite: inalterado (entra direto no clube do
--    convite, que a liderança emitiu para uma criança específica). Sem convite: a conta nasce como
--    responsável SEM clube e SEM filho — igual a qualquer cadastro sem clube. Ela só entra num clube
--    pedindo pelo link (vínculo 'pais' PENDENTE, a liderança aprova), e o vínculo com o filho segue
--    sendo o processo separado de "Vínculos dos pais", confirmado pela diretoria. Ninguém se declara
--    responsável por criança nenhuma só por se cadastrar.
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = ''
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
    insert into public.profiles (id, nome, papel, status) values (new.id, v_meta->>'nome', 'pais', 'ativo');
    insert into public.organization_memberships (user_id, organizational_unit_id, role, status, metadata)
    values (new.id, v_club, 'pais', 'ativo', '{"source":"cadastro"}'::jsonb);
    update public.club_invites set used_at = now(), used_by = new.id where id = v_inv.id;
    perform set_config('app.signup_club', '', true);
    return new;
  end if;

  perform set_config('app.signup_sem_clube', '1', true);
  if v_tipo = 'pais' then
    insert into public.profiles (id, nome, papel, status) values (new.id, v_meta->>'nome', 'pais', 'ativo');
  else
    insert into public.profiles (id, nome, nascimento, cargo, papel, status)
    values (new.id, v_meta->>'nome', (nullif(v_meta->>'nascimento', ''))::date,
            v_meta->>'cargo', 'desbravador', 'ativo');
  end if;
  perform set_config('app.signup_sem_clube', '', true);
  return new;
end $function$;

notify pgrst, 'reload schema';
