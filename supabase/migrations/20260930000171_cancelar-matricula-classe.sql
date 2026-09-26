-- =============================================================================
--  Pendência do piloto: CANCELAR a matrícula numa classe.
--
--  O status 'cancelada' já existia e minha_classe/minhas_classes/classes_disponiveis já o ignoram
--  (107/108), mas não havia como chegar nele. Agora:
--    · classe_cancelar(member_class_id): a própria pessoa (membro ativo do clube da aba) ou a liderança
--      (pode_gerir_no_clube) do clube da matrícula. Só 'em_andamento' — concluída, em revisão, apta ou
--      investida NÃO se cancela por aqui. Nada é apagado: requisitos, envios e avaliações ficam no
--      histórico. Registro na trilha auditoria_operacoes (77).
--    · classes_do_membro(usuario_id): a liderança vê as classes (não canceladas) de um membro do clube,
--      para escolher qual cancelar na gestão de membros.
--    · _classe_matricular: iniciar de novo uma classe cancelada REATIVA a mesma matrícula (a chave única
--      é pessoa+clube+classe). Antes, o `on conflict do nothing` devolvia a matrícula cancelada e a pessoa
--      "iniciava" e continuava sem classe. O progresso guardado volta junto.
-- =============================================================================

create or replace function public._classe_matricular(p_usuario_id uuid, p_club_id uuid, p_class_id uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_mc_id uuid;
begin
  insert into public.member_classes (usuario_id, club_id, class_id) values (p_usuario_id, p_club_id, p_class_id)
  on conflict (usuario_id, club_id, class_id) do nothing
  returning id into v_mc_id;
  if v_mc_id is null then
    select id into v_mc_id from public.member_classes where usuario_id = p_usuario_id and club_id = p_club_id and class_id = p_class_id;
    -- recomeçar depois de cancelar: a mesma matrícula volta a andar, com o progresso guardado
    update public.member_classes set status = 'em_andamento', updated_at = now()
     where id = v_mc_id and status = 'cancelada';
  end if;
  insert into public.member_requirements (member_class_id, requirement_id)
  select v_mc_id, r.id
  from public.class_requirements r
  join public.class_sections s on s.id = r.section_id
  where s.class_id = p_class_id and r.ativo
  on conflict (member_class_id, requirement_id) do nothing;
  return v_mc_id;
end;
$$;
revoke all on function public._classe_matricular(uuid, uuid, uuid) from public, anon, authenticated;

create or replace function public.classe_cancelar(p_member_class_id uuid) returns json
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_club uuid := public.clube_atual_id(); v_mc public.member_classes; v_proprio boolean;
begin
  if v_uid is null or v_club is null then raise exception 'Sem clube em uso.'; end if;
  select * into v_mc from public.member_classes where id = p_member_class_id and club_id = v_club for update;
  if not found then raise exception 'Matrícula não encontrada.'; end if;
  v_proprio := v_mc.usuario_id = v_uid;
  if not ((v_proprio and public.membro_ativo_no_clube(v_club)) or public.pode_gerir_no_clube(v_club)) then
    raise exception 'Sem permissão (apenas a própria pessoa ou a liderança deste clube).';
  end if;
  if v_mc.status = 'cancelada' then
    return json_build_object('ok', true, 'status', 'cancelada');
  end if;
  if v_mc.status <> 'em_andamento' then
    raise exception 'Só dá para cancelar uma classe em andamento (esta já foi concluída ou está em revisão/investidura).';
  end if;
  update public.member_classes set status = 'cancelada', updated_at = now() where id = v_mc.id;
  perform public._auditar('classe_cancelada', v_club, v_mc.usuario_id,
    jsonb_build_object('member_class_id', v_mc.id, 'class_id', v_mc.class_id, 'pela_propria_pessoa', v_proprio));
  return json_build_object('ok', true, 'status', 'cancelada');
end;
$$;
revoke all on function public.classe_cancelar(uuid) from public, anon;
grant execute on function public.classe_cancelar(uuid) to authenticated;

create or replace function public.classes_do_membro(p_usuario_id uuid) returns json
language plpgsql stable security definer set search_path = '' as $$
declare v_club uuid := public.clube_atual_id();
begin
  if v_club is null or not public.pode_gerir_no_clube(v_club) then
    raise exception 'Sem permissão (apenas a liderança deste clube).';
  end if;
  return (
    select coalesce(json_agg(json_build_object(
      'member_class_id', mc.id, 'class_id', c.id, 'codigo', c.codigo, 'nome', c.nome, 'status', mc.status,
      'iniciada_em', mc.iniciada_em, 'percentual', public.classe_percentual(mc.id)
    ) order by (mc.status = 'em_andamento') desc, c.ordem, c.nome), '[]'::json)
    from public.member_classes mc
    join public.classes c on c.id = mc.class_id
    where mc.usuario_id = p_usuario_id and mc.club_id = v_club and mc.status <> 'cancelada'
  );
end;
$$;
revoke all on function public.classes_do_membro(uuid) from public, anon;
grant execute on function public.classes_do_membro(uuid) to authenticated;

notify pgrst, 'reload schema';

insert into public.migracoes_aplicadas (arquivo)
values ('2026-09-30-cancelar-matricula-classe.sql')
on conflict (arquivo) do update set aplicada_em = now();
