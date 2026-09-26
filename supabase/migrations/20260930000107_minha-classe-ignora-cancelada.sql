-- Minha Classe (sem id) abria a matrícula mais recente MESMO cancelada: quem cancelava uma classe ficava
-- preso nela e nunca via a lista de classes disponíveis. Agora a escolha automática ignora 'cancelada'
-- (por id explícito continua abrindo, para histórico). Resto da função idêntico à migration 86.
CREATE OR REPLACE FUNCTION public.minha_classe(p_member_class_id uuid DEFAULT NULL::uuid)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_uid uuid := auth.uid(); v_club uuid := public.clube_atual_id(); v_mc record;
begin
  if v_uid is null or v_club is null then return null; end if;
  perform public._exigir_classes_habilitado(v_club);
  if p_member_class_id is not null then
    select * into v_mc from public.member_classes
     where id = p_member_class_id and usuario_id = v_uid and club_id = v_club
       and public._classe_do_catalogo_oficial(class_id);
  else
    select * into v_mc from public.member_classes
     where usuario_id = v_uid and club_id = v_club and status <> 'cancelada' and public._classe_do_catalogo_oficial(class_id)
     order by (status = 'em_andamento') desc, iniciada_em desc
     limit 1;
  end if;
  if v_mc.id is null then return null; end if;

  return json_build_object(
    'member_class', json_build_object(
      'id', v_mc.id, 'status', v_mc.status, 'iniciada_em', v_mc.iniciada_em, 'concluida_em', v_mc.concluida_em, 'investida_em', v_mc.investida_em,
      'percentual', public.classe_percentual(v_mc.id)
    ),
    'classe', (select json_build_object('id', c.id, 'codigo', c.codigo, 'nome', c.nome, 'faixa_etaria', c.faixa_etaria,
                                        'idade_minima', c.idade_minima, 'manifesto_id', c.manifesto_id, 'vigente_desde', c.vigente_desde,
                                        'fonte_url', c.fonte_url, 'fonte_publicado_em', c.fonte_publicado_em)
               from public.classes c where c.id = v_mc.class_id),
    'curriculum_version', (
      select json_build_object('id', ver.id, 'origem', ver.origem, 'identificador', ver.identificador, 'versao', ver.versao,
               'status', ver.status, 'fonte_url', ver.fonte_url, 'fonte_descricao', ver.fonte_descricao,
               'vigente_desde', ver.vigente_desde, 'fonte_hash', ver.fonte_hash, 'importado_em', ver.importado_em)
      from public.classes c join public.curriculum_versions ver on ver.id = c.curriculum_version_id where c.id = v_mc.class_id
    ),
    'conclusao', json_build_object(
      'snapshot', (select json_build_object('id', s.id, 'versao', s.versao, 'hash', s.hash, 'selado_em', s.selado_em, 'status', s.status)
                   from public.class_completion_snapshots s where s.member_class_id = v_mc.id and s.status = 'selado' order by s.versao desc limit 1),
      'revisao', (select json_build_object('status', ir.status, 'solicitado_em', ir.solicitado_em, 'revisado_em', ir.revisado_em, 'comentario', ir.comentario,
                    'revisado_por_nome', (select nome from public.profiles where id = ir.revisado_por), 'revisado_papel', ir.revisado_papel)
                  from public.investiture_reviews ir where ir.member_class_id = v_mc.id order by ir.solicitado_em desc limit 1),
      'investidura', (select json_build_object('data', i.data_investidura, 'registrado_em', i.created_at, 'observacao', i.observacao,
                        'registrado_por_nome', (select nome from public.profiles where id = i.registrado_por), 'status', i.status)
                      from public.class_investitures i where i.member_class_id = v_mc.id order by i.created_at desc limit 1)
    ),
    'secoes', (
      select coalesce(json_agg(json_build_object(
        'id', s.id, 'codigo', s.codigo, 'nome', s.nome, 'ordem', s.ordem,
        'requisitos', (
          select coalesce(json_agg(json_build_object(
            'id', r.id, 'codigo', r.codigo, 'descricao', r.descricao, 'manifesto_id', r.manifesto_id, 'status_fonte', r.status_fonte,
            'tipo_evidencia', r.tipo_evidencia, 'evidencia_obrigatoria', r.evidencia_obrigatoria,
            'member_requirement_id', mr.id, 'status', coalesce(mr.status, 'nao_iniciado'),
            'evidencia_texto', mr.evidencia_texto, 'evidencia_path', mr.evidencia_path, 'enviado_em', mr.enviado_em,
            'conteudo_dinamico', (select public._conteudo_do_requisito(mr.id, d.chave)
                                  from public.dynamic_content_definitions d where d.id = r.conteudo_dinamico_definicao_id),
            'escolha', (
              select (public._requisito_escolha_estado(mr.id) || jsonb_build_object(
                'opcoes', (select coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'rotulo', o.rotulo, 'specialty_id', o.specialty_id) order by o.ordem), '[]'::jsonb)
                           from public.requirement_options o where o.grupo_id = g.id)))::json
              from public.requirement_option_groups g where g.alvo_tipo = 'class_requirement' and g.alvo_id = r.id and mr.id is not null
            ),
            'bloqueios', case when mr.id is null then '[]'::json else to_json(public._requisito_bloqueios(mr.id)) end,
            'avaliacoes', (
              select coalesce(json_agg(json_build_object(
                'decisao', a.decisao, 'avaliado_por_nome', p.nome, 'avaliado_papel', a.avaliado_papel,
                'comentario', a.comentario, 'created_at', a.created_at
              ) order by a.created_at), '[]'::json)
              from public.requirement_approvals a
              join public.profiles p on p.id = a.avaliado_por
              where mr.id is not null and a.member_requirement_id = mr.id
            )
          ) order by r.ordem, r.codigo), '[]'::json)
          from public.class_requirements r
          left join public.member_requirements mr on mr.requirement_id = r.id and mr.member_class_id = v_mc.id
          where r.section_id = s.id and r.ativo
        )
      ) order by s.ordem), '[]'::json)
      from public.class_sections s where s.class_id = v_mc.class_id
    )
  );
end;
$function$

;
