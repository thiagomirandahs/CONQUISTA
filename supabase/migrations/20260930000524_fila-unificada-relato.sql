-- 524 — Fila unificada de avaliação (Gestão → Avaliações) passa a trazer o RELATO complementar da tentativa mais recente (520).
-- Aditivo: só acrescenta a chave 'relato' ao JSON; mesma autorização, mesmos filtros. Sem isso o instrutor não via o relato da 1ª tentativa nessa fila.
CREATE OR REPLACE FUNCTION public.fila_avaliacao_unificada(p_tipo text DEFAULT NULL::text, p_unidade_id uuid DEFAULT NULL::uuid)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_club uuid := public.clube_atual_id(); v_classes_ok boolean := true; v_especialidades_ok boolean := true;
begin
  if v_club is null or not public.pode_avaliar_curriculo(v_club) then
    raise exception 'Sem permissão (apenas diretoria/instrutor deste clube).';
  end if;
  -- os dois recursos são opt-in por clube; uma fila unificada não pode listar o que o clube não
  -- tem ligado (mesma regra que classe_avaliacoes_pendentes/especialidade_avaliacoes_pendentes já
  -- aplicam cada uma na sua tela própria) — aqui só filtra em vez de lançar erro, pra um recurso
  -- desligado não derrubar a fila inteira.
  begin perform public._exigir_classes_habilitado(v_club); exception when others then v_classes_ok := false; end;
  begin perform public._exigir_especialidades_habilitado(v_club); exception when others then v_especialidades_ok := false; end;

  return coalesce((
    select json_agg(x order by x->>'enviado_em')
    from (
      select json_build_object(
        'tipo', 'classe',
        'item_id', mr.id,
        'submission_id', sub.id,
        'tentativa_numero', sub.tentativa_numero,
        'usuario_id', p.id, 'usuario_nome', p.nome,
        'titulo', c.nome, 'subtitulo', r.descricao,
        'tipo_evidencia', coalesce(sub.tipo_evidencia_entregue, r.tipo_evidencia),
        'relato', sub.relato,
        'enviado_em', mr.enviado_em,
        'unidade_id', u.id, 'unidade_nome', u.nome
      ) as x
      from public.member_requirements mr
      join public.member_classes mc on mc.id = mr.member_class_id
      join public.class_requirements r on r.id = mr.requirement_id
      join public.class_sections s on s.id = r.section_id
      join public.classes c on c.id = s.class_id
      join public.profiles p on p.id = mr.usuario_id
      left join lateral (
        select * from public.requirement_submissions s2
         where s2.member_requirement_id = mr.id order by s2.tentativa_numero desc limit 1
      ) sub on true
      left join public.organization_memberships om on om.user_id = mr.usuario_id and om.organizational_unit_id = mr.club_id and om.status = 'ativo'
      left join public.unidades u on u.id = om.unidade_id
      where v_classes_ok and mr.club_id = v_club and mr.status = 'aguardando_avaliacao'
        and public._classe_do_catalogo_oficial(mc.class_id)
        and (p_tipo is null or p_tipo = 'classe')
        and (p_unidade_id is null or u.id = p_unidade_id)

      union all

      select json_build_object(
        'tipo', 'especialidade',
        'item_id', msr.id,
        'submission_id', null,
        'tentativa_numero', 1,
        'usuario_id', p.id, 'usuario_nome', p.nome,
        'titulo', sp.nome, 'subtitulo', sr.descricao,
        'tipo_evidencia', case when msr.evidencia_path is not null then 'foto' when coalesce(trim(msr.evidencia_texto),'')<>'' then 'texto' else 'nenhuma' end,
        'relato', (select s3.relato from public.specialty_requirement_submissions s3 where s3.member_specialty_requirement_id = msr.id order by s3.tentativa_numero desc limit 1),
        'enviado_em', msr.enviado_em,
        'unidade_id', u.id, 'unidade_nome', u.nome
      ) as x
      from public.member_specialty_requirements msr
      join public.specialty_requirements sr on sr.id = msr.specialty_requirement_id
      join public.member_specialties ms on ms.id = msr.member_specialty_id
      join public.specialties sp on sp.id = ms.specialty_id
      join public.profiles p on p.id = msr.usuario_id
      left join public.organization_memberships om on om.user_id = msr.usuario_id and om.organizational_unit_id = msr.club_id and om.status = 'ativo'
      left join public.unidades u on u.id = om.unidade_id
      where v_especialidades_ok and msr.club_id = v_club and msr.status = 'aguardando_avaliacao'
        and public._especialidade_do_catalogo_oficial(sp.id)
        and public._pode_avaliar_especialidade(msr.member_specialty_id, v_club)
        and (p_tipo is null or p_tipo = 'especialidade')
        and (p_unidade_id is null or u.id = p_unidade_id)
    ) t
  ), '[]'::json);
end;
$function$;
revoke all on function public.fila_avaliacao_unificada(text, uuid) from public, anon;
grant execute on function public.fila_avaliacao_unificada(text, uuid) to authenticated;
