-- 526 — Mensagem de recusa da 523 alinhada à DECISÃO DO DONO (01/10/2026): matrícula iniciada PERMANECE na versão em que começou e não há
-- migração automática; portanto não se manda mais "pedir a atualização da matrícula". Só o TEXTO muda; regra, grants e fluxo iguais.
CREATE OR REPLACE FUNCTION public.classe_iniciar(p_class_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_uid uuid := auth.uid(); v_club uuid := public.clube_atual_id(); v_mc_id uuid; v_faltando text[]; v_motivo text; v_origem uuid;
begin
  if v_uid is null or v_club is null or not public.membro_ativo_no_clube(v_club) then
    raise exception 'Sem clube em uso.';
  end if;
  perform public._exigir_classes_habilitado(v_club);
  if not public._classe_no_fluxo_normal(p_class_id) then raise exception 'Classe não encontrada.'; end if;
  v_origem := public._classe_conclusao_ativa_clube(v_uid, p_class_id);
  if v_origem is not null and not exists (
    select 1 from public.member_classes mc where mc.usuario_id = v_uid and mc.club_id = v_club and mc.class_id = p_class_id and mc.status <> 'cancelada'
  ) then
    raise exception 'Esta classe já foi concluída por você em %.', coalesce((select u.nome from public.organizational_units u where u.id = v_origem), 'outro clube');
  end if;
  if public._classe_matricula_equivalente(v_uid, v_club, p_class_id) is not null then
    raise exception 'Você já tem esta classe em andamento neste clube. Ela continua na versão do currículo em que foi iniciada.';
  end if;
  v_motivo := public._classe_motivo_inelegivel(v_uid, p_class_id);
  if v_motivo is not null then raise exception '%', v_motivo; end if;
  v_faltando := public.dependencias_pendentes('class', p_class_id, v_uid, v_club);
  if array_length(v_faltando, 1) > 0 then
    raise exception 'Falta concluir antes: %', array_to_string(v_faltando, ', ');
  end if;
  v_mc_id := public._classe_matricular(v_uid, v_club, p_class_id);
  return json_build_object('ok', true, 'member_class_id', v_mc_id);
end;
$function$;

CREATE OR REPLACE FUNCTION public.classe_atribuir(p_usuario_id uuid, p_class_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_club uuid := public.clube_atual_id(); v_mc_id uuid; v_faltando text[]; v_motivo text; v_origem uuid;
begin
  if v_club is null or not public.pode_avaliar_curriculo(v_club) then
    raise exception 'Sem permissão (apenas diretoria/instrutor deste clube).';
  end if;
  perform public._exigir_classes_habilitado(v_club);
  if not exists (
    select 1 from public.organization_memberships m
    where m.user_id = p_usuario_id and m.organizational_unit_id = v_club and m.role <> 'pais' and m.status = 'ativo'
      and m.starts_at <= now() and (m.ends_at is null or m.ends_at > now())
  ) then
    raise exception 'Pessoa sem vínculo ativo neste clube.';
  end if;
  if not public._classe_no_fluxo_normal(p_class_id) then raise exception 'Classe não encontrada.'; end if;
  v_origem := public._classe_conclusao_ativa_clube(p_usuario_id, p_class_id);
  if v_origem is not null and not exists (
    select 1 from public.member_classes mc where mc.usuario_id = p_usuario_id and mc.club_id = v_club and mc.class_id = p_class_id and mc.status <> 'cancelada'
  ) then
    -- versão neutra: a diretoria não precisa saber o nome do outro clube
    raise exception 'Esta classe já foi concluída por esta pessoa%.', case when v_origem = v_club then ' neste clube' else ' em outro clube' end;
  end if;
  if public._classe_matricula_equivalente(p_usuario_id, v_club, p_class_id) is not null then
    raise exception 'Esta pessoa já tem esta classe em andamento neste clube. Ela continua na versão do currículo em que foi iniciada.';
  end if;
  v_motivo := public._classe_motivo_inelegivel(p_usuario_id, p_class_id);
  if v_motivo is not null then raise exception '%', v_motivo; end if;
  v_faltando := public.dependencias_pendentes('class', p_class_id, p_usuario_id, v_club);
  if array_length(v_faltando, 1) > 0 then
    raise exception 'Falta concluir antes: %', array_to_string(v_faltando, ', ');
  end if;
  v_mc_id := public._classe_matricular(p_usuario_id, v_club, p_class_id);
  return json_build_object('ok', true, 'member_class_id', v_mc_id);
end;
$function$;

revoke all on function public.classe_iniciar(uuid) from public, anon;
revoke all on function public.classe_atribuir(uuid, uuid) from public, anon;
grant execute on function public.classe_iniciar(uuid) to authenticated;
grant execute on function public.classe_atribuir(uuid, uuid) to authenticated;
