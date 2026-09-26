-- Cadastro escolhendo o CLUBE numa lista (pedido do dono, 26/09): o menino se cadastra, escolhe o clube
-- entre os cadastrados e a DIRETORIA aprova. Mesmo resultado do código/link de entrada: vínculo PENDENTE,
-- papel decidido pelo servidor (desbravador; responsável se o perfil é de responsável), nunca pelo cliente.
-- Só clubes que aparecem na vitrine pública (ativos e não ocultados — o clube de teste fica de fora).
-- Limite de tentativas: o mesmo da entrada por código.
create or replace function public.entrada_solicitar_clube(p_slug text)
returns json language plpgsql security definer set search_path = '' as $$
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

  v_papel := case when (select p.papel from public.profiles p where p.id = v_uid) = 'pais' then 'pais' else 'desbravador' end;
  insert into public.organization_memberships (user_id, organizational_unit_id, role, status, metadata)
  values (v_uid, v_club.id, v_papel, 'pendente', jsonb_build_object('source', 'cadastro_escolheu_clube'));

  return json_build_object('encontrado', true, 'ok', true, 'ja_era', false, 'situacao', 'pendente', 'papel', v_papel, 'clube', v_club.nome);
end $$;
revoke all on function public.entrada_solicitar_clube(text) from public, anon;
grant execute on function public.entrada_solicitar_clube(text) to authenticated;
