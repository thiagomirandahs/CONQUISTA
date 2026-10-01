-- =============================================================================
--  Comprovação universal — TODO requisito (Classes e Especialidades) aceita um RELATO complementar
--  ("Conte ao instrutor como você cumpriu este requisito"), em texto livre.
--
--  O que NÃO muda: manifesto, currículo, class_requirements, tipo_evidencia, evidencia_obrigatoria, os modelos
--  de relatório estruturado (formulários), foto/arquivo/anexo. O relato é COMPLEMENTAR e OPCIONAL: nunca vira
--  obrigação curricular nem substitui a evidência que o requisito já exige.
--
--  Desenho (aditivo; o front ANTIGO continua chamando as RPCs antigas, que seguem com a mesma assinatura):
--   · member_requirements.relato / member_specialty_requirements.relato  = rascunho do relato (editável até enviar);
--   · requirement_submissions.relato / specialty_requirement_submissions.relato = relato CONGELADO no envio
--     (a tentativa é imutável pelo gatilho existente: a tentativa 2 nunca sobrescreve a 1);
--   · limite de 2000 caracteres, trim, sem caracteres de controle (valida no servidor e por CHECK);
--   · o relato é uma coluna PRÓPRIA — nunca mistura com evidencia_texto (comprovação antiga em texto/resumo do
--     formulário). Requisito sem modelo: evidencia_texto segue sendo o texto de comprovação; o relato é à parte.
--   · escrita só por requisito_relato_salvar / especialidade_requisito_relato_salvar (mesmos guardas dos demais
--     salvar: dono, clube em uso, recurso habilitado, catálogo oficial, não aprovado, não aguardando avaliação);
--   · leitura: o dono (requisito_formulario, minha_classe, minha_especialidade) e a liderança (fila de avaliação e
--     histórico) — as policies de requirement_submissions já restringem a dono/liderança do clube;
--   · PDF/dossiê/snapshot NÃO mudam (não leem o texto da comprovação, só se existe).
--  Sem tabela nova: não precisa da guarda de manutenção.
-- =============================================================================

-- ==================== 1) colunas ====================
alter table public.member_requirements
  add column if not exists relato text check (relato is null or (length(relato) <= 2000 and relato !~ '^\s*$'));
alter table public.requirement_submissions
  add column if not exists relato text check (relato is null or (length(relato) <= 2000 and relato !~ '^\s*$'));
alter table public.member_specialty_requirements
  add column if not exists relato text check (relato is null or (length(relato) <= 2000 and relato !~ '^\s*$'));
alter table public.specialty_requirement_submissions
  add column if not exists relato text check (relato is null or (length(relato) <= 2000 and relato !~ '^\s*$'));

-- ==================== 2) normalização única do relato ====================
-- null/vazio -> null (apagar o relato); trim de qualquer espaço em branco (inclui quebras); quebras de linha viram \n; recusa caracteres de controle e de
-- direção de texto (bidi), e mais de 2000 caracteres. Emojis (ZWJ, seletores) passam.
create or replace function public._relato_normalizar(p_relato text) returns text
language plpgsql immutable set search_path = '' as $$
declare v text;
begin
  if p_relato is null then return null; end if;
  if length(p_relato) > 20000 then raise exception 'O relato passou de 2000 caracteres.'; end if;
  v := regexp_replace(replace(replace(p_relato, E'\r\n', E'\n'), E'\r', E'\n'), '^\s+|\s+$', '', 'g');
  if v ~ '[\u0001-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f​‎‏‪-‮⁦-⁩﻿]' then
    raise exception 'O relato tem caracteres inválidos.';
  end if;
  if length(v) > 2000 then raise exception 'O relato passou de 2000 caracteres.'; end if;
  return nullif(v, '');
end;
$$;
revoke all on function public._relato_normalizar(text) from public, anon, authenticated;

-- ==================== 3) Classes: salvar o relato (qualquer tipo de requisito) ====================
create or replace function public.requisito_relato_salvar(p_requirement_id uuid, p_relato text)
returns json
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid(); v_club uuid := public.clube_atual_id(); v_mr record; v_relato text; v_em timestamptz;
begin
  if v_uid is null or v_club is null then raise exception 'Sem clube em uso.'; end if;
  perform public._exigir_classes_habilitado(v_club);
  select * into v_mr from public.member_requirements
   where requirement_id = p_requirement_id and usuario_id = v_uid and club_id = v_club for update;
  if not found or not public._classe_do_catalogo_oficial((select mc.class_id from public.member_classes mc where mc.id = v_mr.member_class_id)) then
    raise exception 'Requisito não encontrado para você neste clube.';
  end if;
  if v_mr.status = 'aprovado' then raise exception 'Este requisito já foi aprovado.'; end if;
  if v_mr.status = 'aguardando_avaliacao' then raise exception 'Este requisito já foi enviado. Aguarde a avaliação.'; end if;
  v_relato := public._relato_normalizar(p_relato);
  update public.member_requirements
     set relato = v_relato,
         status = case when v_relato is not null and status in ('nao_iniciado', 'correcao_solicitada') then 'em_andamento' else status end,
         rascunho_em = now(), updated_at = now()
   where id = v_mr.id
  returning rascunho_em into v_em;
  return json_build_object('ok', true, 'relato', v_relato, 'rascunho_em', v_em);
end;
$$;
revoke all on function public.requisito_relato_salvar(uuid, text) from public, anon;
grant execute on function public.requisito_relato_salvar(uuid, text) to authenticated;


-- requisito_salvar (3 args, front antigo): identico a migration 86; so passa a registrar o horario do rascunho.
create or replace function public.requisito_salvar(p_requirement_id uuid, p_texto text default null, p_evidencia_path text default null)
returns json
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_club uuid := public.clube_atual_id(); v_mr record;
begin
  if v_uid is null or v_club is null then raise exception 'Sem clube em uso.'; end if;
  perform public._exigir_classes_habilitado(v_club);
  select * into v_mr from public.member_requirements
   where requirement_id = p_requirement_id and usuario_id = v_uid and club_id = v_club for update;
  if not found or not public._classe_do_catalogo_oficial((select mc.class_id from public.member_classes mc where mc.id = v_mr.member_class_id)) then
    raise exception 'Requisito não encontrado para você neste clube.';
  end if;
  if v_mr.status = 'aprovado' then raise exception 'Este requisito já foi aprovado.'; end if;
  update public.member_requirements
     set evidencia_texto = coalesce(p_texto, evidencia_texto),
         evidencia_path = coalesce(p_evidencia_path, evidencia_path),
         status = case when status in ('nao_iniciado', 'correcao_solicitada') then 'em_andamento' else status end,
         rascunho_em = case when p_texto is not null or p_evidencia_path is not null then now() else rascunho_em end,
         updated_at = now()
   where id = v_mr.id;
  return json_build_object('ok', true);
end;
$$;

-- requisito_enviar: identico a 510 (modo compativel, bloqueios, validacao do formulario); so CONGELA o relato na tentativa.
create or replace function public.requisito_enviar(p_requirement_id uuid) returns json
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid(); v_club uuid := public.clube_atual_id();
  v_mr record; v_req record; v_bloq text[]; v_tipo text; v_prox_tentativa int; v_submission_id uuid;
  v_mod public.requisito_modelos; v_erros text[]; v_resumo text; v_primeiro text; v_usa_modelo boolean;
begin
  if v_uid is null or v_club is null then raise exception 'Sem clube em uso.'; end if;
  perform public._exigir_classes_habilitado(v_club);
  select * into v_mr from public.member_requirements
   where requirement_id = p_requirement_id and usuario_id = v_uid and club_id = v_club for update;
  if not found or not public._classe_do_catalogo_oficial((select mc.class_id from public.member_classes mc where mc.id = v_mr.member_class_id)) then
    raise exception 'Requisito não encontrado para você neste clube.';
  end if;
  if v_mr.status = 'aprovado' then raise exception 'Este requisito já foi aprovado.'; end if;
  select * into v_req from public.class_requirements where id = p_requirement_id;
  v_mod := public._modelo_da_classe(p_requirement_id);
  -- MODO COMPATÍVEL: quem nunca abriu o formulário (rascunho vazio) — tela antiga em cache, requisito já em andamento
  -- com texto/foto — segue pelo caminho de sempre. Quem usou o formulário é validado por inteiro, no servidor.
  v_usa_modelo := v_mod.id is not null and v_mr.rascunho is not null;

  if not v_usa_modelo then
    if v_req.evidencia_obrigatoria and coalesce(trim(v_mr.evidencia_texto), '') = '' and coalesce(v_mr.evidencia_path, '') = '' then
      raise exception 'Este requisito exige uma evidência antes de enviar.';
    end if;
  else
    v_erros := public._relatorio_validar(v_mod.schema, coalesce(v_mr.rascunho, '{}'::jsonb), v_mr.rascunho_anexos, true)
            || public._anexos_do_dono_erros(v_mr.rascunho_anexos, v_uid, v_club);
    if array_length(v_erros, 1) > 0 then raise exception 'Formulário incompleto: %', public._erros_em_texto(v_erros); end if;
  end if;

  v_bloq := public._requisito_bloqueios(v_mr.id);
  if array_length(v_bloq, 1) > 0 then raise exception 'Requisito bloqueado: %', array_to_string(v_bloq, ' '); end if;
  perform public._fixar_conteudo_do_requisito(v_mr.id, 'envio');

  select coalesce(max(tentativa_numero), 0) + 1 into v_prox_tentativa
    from public.requirement_submissions where member_requirement_id = v_mr.id;

  if not v_usa_modelo then
    v_tipo := case
      when v_mr.evidencia_path is not null and v_req.tipo_evidencia = 'arquivo' then 'arquivo'
      when v_mr.evidencia_path is not null then 'foto'
      when coalesce(trim(v_mr.evidencia_texto), '') <> '' then 'texto'
      else 'nenhuma'
    end;
    insert into public.requirement_submissions (member_requirement_id, tentativa_numero, tipo_evidencia_entregue, evidencia_texto, evidencia_path, relato)
    values (v_mr.id, v_prox_tentativa, v_tipo, v_mr.evidencia_texto, v_mr.evidencia_path, v_mr.relato)
    returning id into v_submission_id;
  else
    v_resumo := public._relatorio_resumo(v_mod.schema -> 'campos', coalesce(v_mr.rascunho, '{}'::jsonb));
    v_primeiro := v_mr.rascunho_anexos -> 0 ->> 'path';
    insert into public.requirement_submissions
      (member_requirement_id, tentativa_numero, tipo_evidencia_entregue, evidencia_texto, evidencia_path, conteudo, anexos, modelo_versao, relato)
    values (v_mr.id, v_prox_tentativa, 'relatorio', nullif(v_resumo, ''), v_primeiro, coalesce(v_mr.rascunho, '{}'::jsonb), v_mr.rascunho_anexos, v_mod.versao, v_mr.relato)
    returning id into v_submission_id;
    -- telas/PDF antigos leem estes dois campos: recebem o resumo legível
    update public.member_requirements set evidencia_texto = nullif(v_resumo, ''), evidencia_path = coalesce(v_primeiro, evidencia_path) where id = v_mr.id;
  end if;

  update public.member_requirements set status = 'aguardando_avaliacao', enviado_em = now(), updated_at = now() where id = v_mr.id;
  return json_build_object('ok', true, 'submission_id', v_submission_id, 'tentativa_numero', v_prox_tentativa);
end;
$$;

CREATE OR REPLACE FUNCTION public.requisito_formulario(p_requirement_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_uid uuid := auth.uid(); v_club uuid := public.clube_atual_id(); v_mr record; v_mod public.requisito_modelos;
begin
  if v_uid is null or v_club is null then raise exception 'Sem clube em uso.'; end if;
  perform public._exigir_classes_habilitado(v_club);
  select * into v_mr from public.member_requirements
   where requirement_id = p_requirement_id and usuario_id = v_uid and club_id = v_club;
  if not found or not public._classe_do_catalogo_oficial((select mc.class_id from public.member_classes mc where mc.id = v_mr.member_class_id)) then
    raise exception 'Requisito não encontrado para você neste clube.';
  end if;
  v_mod := public._modelo_da_classe(p_requirement_id);
  return json_build_object(
    'tem_formulario', v_mod.id is not null,
    'modelo', case when v_mod.id is null then null else json_build_object('versao', v_mod.versao, 'schema', v_mod.schema, 'categoria', v_mod.categoria, 'familia', v_mod.familia, 'nota', v_mod.nota) end,
    'member_requirement_id', v_mr.id,
    'status', v_mr.status,
    'rascunho', v_mr.rascunho, 'rascunho_em', v_mr.rascunho_em, 'relato', v_mr.relato,
    'anexos', v_mr.rascunho_anexos,
    'tentativas', (select count(*) from public.requirement_submissions s where s.member_requirement_id = v_mr.id),
    'ultima_avaliacao', (
      select json_build_object('decisao', ap.decisao, 'comentario', ap.comentario, 'avaliado_em', ap.created_at, 'avaliado_papel', ap.avaliado_papel, 'avaliado_por_nome', av.nome)
        from public.requirement_approvals ap left join public.profiles av on av.id = ap.avaliado_por
          left join public.requirement_submissions sb on sb.id = ap.submission_id
       where ap.member_requirement_id = v_mr.id order by sb.tentativa_numero desc nulls last, ap.created_at desc limit 1)
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.classe_formularios(p_member_class_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_uid uuid := auth.uid(); v_club uuid := public.clube_atual_id(); v_mc record;
begin
  if v_uid is null or v_club is null then raise exception 'Sem clube em uso.'; end if;
  perform public._exigir_classes_habilitado(v_club);
  select * into v_mc from public.member_classes where id = p_member_class_id and usuario_id = v_uid and club_id = v_club;
  if not found or not public._classe_do_catalogo_oficial(v_mc.class_id) then raise exception 'Matrícula não encontrada para você neste clube.'; end if;
  return coalesce((
    select json_object_agg(mr.requirement_id::text, json_build_object(
      'modelo', json_build_object('versao', m.versao, 'schema', m.schema, 'categoria', m.categoria, 'familia', m.familia, 'nota', m.nota),
      'member_requirement_id', mr.id,
      'status', mr.status,
      'rascunho', mr.rascunho, 'rascunho_em', mr.rascunho_em, 'relato', mr.relato,
      'anexos', mr.rascunho_anexos,
      'tentativas', (select count(*) from public.requirement_submissions s where s.member_requirement_id = mr.id),
      'ultima_avaliacao', (
        select json_build_object('decisao', ap.decisao, 'comentario', ap.comentario, 'avaliado_em', ap.created_at, 'avaliado_papel', ap.avaliado_papel, 'avaliado_por_nome', av.nome)
          from public.requirement_approvals ap left join public.profiles av on av.id = ap.avaliado_por
            left join public.requirement_submissions sb on sb.id = ap.submission_id
         where ap.member_requirement_id = mr.id order by sb.tentativa_numero desc nulls last, ap.created_at desc limit 1)
    ))
    from public.member_requirements mr
    join public.class_requirements r on r.id = mr.requirement_id
    join lateral (
      select m2.* from public.requisito_modelos m2 where m2.alvo = 'classe' and m2.chave = r.manifesto_id order by m2.versao desc limit 1
    ) m on true
    where mr.member_class_id = v_mc.id and mr.status in ('nao_iniciado', 'em_andamento', 'correcao_solicitada')
  ), '{}'::json);
end;
$function$;

create or replace function public.requisito_historico(p_member_requirement_id uuid) returns json
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_club uuid := public.clube_atual_id(); v_mr record; v_mod public.requisito_modelos;
begin
  if v_uid is null or v_club is null then raise exception 'Sem clube em uso.'; end if;
  select * into v_mr from public.member_requirements
   where id = p_member_requirement_id and club_id = v_club
     and (usuario_id = v_uid or public.pode_gerir_no_clube(v_club));
  if not found then raise exception 'Requisito não encontrado para você neste clube.'; end if;
  v_mod := public._modelo_da_classe(v_mr.requirement_id);

  return json_build_object(
    'requirement_id', v_mr.requirement_id,
    'status_atual', v_mr.status,
    'modelo', case when v_mod.id is null then null else json_build_object('versao', v_mod.versao, 'schema', v_mod.schema, 'familia', v_mod.familia) end,
    'tentativas', (
      select coalesce(json_agg(json_build_object(
        'submission_id', sub.id,
        'tentativa_numero', sub.tentativa_numero,
        'tipo_evidencia', sub.tipo_evidencia_entregue,
        'evidencia_texto', sub.evidencia_texto,
        'evidencia_path', sub.evidencia_path,
        'conteudo', sub.conteudo,
        'relato', sub.relato,
        'anexos', sub.anexos,
        'modelo_versao', sub.modelo_versao,
        'enviado_em', sub.enviado_em,
        'decisao', ap.decisao,
        'avaliado_por_nome', av.nome,
        'avaliado_papel', ap.avaliado_papel,
        'comentario', ap.comentario,
        'avaliado_em', ap.created_at
      ) order by sub.tentativa_numero), '[]'::json)
      from public.requirement_submissions sub
      left join public.requirement_approvals ap on ap.submission_id = sub.id
      left join public.profiles av on av.id = ap.avaliado_por
      where sub.member_requirement_id = v_mr.id
    )
  );
end;
$$;

create or replace function public.classe_avaliacoes_pendentes() returns json
language plpgsql stable security definer set search_path = '' as $$
declare v_club uuid := public.clube_atual_id();
begin
  if v_club is null or not public.pode_gerir_no_clube(v_club) then return '[]'::json; end if;
  perform public._exigir_classes_habilitado(v_club);
  return coalesce((
    select json_agg(json_build_object(
      'member_requirement_id', mr.id,
      'submission_id', sub.id,
      'tentativa_numero', sub.tentativa_numero,
      'usuario_id', p.id, 'usuario_nome', p.nome, 'usuario_foto', p.foto,
      'classe_nome', c.nome, 'secao_nome', s.nome,
      'requisito_id', r.id, 'requisito_codigo', r.codigo, 'requisito_descricao', r.descricao,
      'tipo_evidencia', coalesce(sub.tipo_evidencia_entregue, r.tipo_evidencia),
      'evidencia_texto', coalesce(sub.evidencia_texto, mr.evidencia_texto),
      'evidencia_path', coalesce(sub.evidencia_path, mr.evidencia_path),
      'conteudo', sub.conteudo,
      'relato', sub.relato,
      'anexos', coalesce(sub.anexos, '[]'::jsonb),
      'modelo', (select json_build_object('versao', m.versao, 'schema', m.schema, 'familia', m.familia)
                   from public.requisito_modelos m where m.alvo = 'classe' and m.chave = r.manifesto_id and m.versao = sub.modelo_versao),
      'enviado_em', mr.enviado_em,
      'escolha', public._requisito_escolha_estado(mr.id),
      'conteudo_dinamico', (select public._conteudo_do_requisito(mr.id, d.chave) from public.dynamic_content_definitions d where d.id = r.conteudo_dinamico_definicao_id),
      'bloqueios', to_json(public._requisito_bloqueios(mr.id)),
      'unidade_nome', u.nome
    ) order by mr.enviado_em)
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
    where mr.club_id = v_club and mr.status = 'aguardando_avaliacao'
      and public._classe_do_catalogo_oficial(mc.class_id)
  ), '[]'::json);
end;
$$;

-- minha_classe: identica a 107; cada requisito ganha 'relato' e 'rascunho_em' (qualquer tipo, com ou sem modelo).
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
            'relato', mr.relato, 'rascunho_em', mr.rascunho_em,
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
$function$;


-- ==================== 4) Especialidades: o MESMO conceito, de forma aditiva ====================
-- (motor paralelo da 511: member_specialty_requirements / specialty_requirement_submissions; conteúdo real
-- das Especialidades intocado. Funções abaixo = cópias das vigentes, só com o campo 'relato' a mais.)
create or replace function public.especialidade_requisito_relato_salvar(p_specialty_requirement_id uuid, p_relato text)
returns json
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid(); v_club uuid := public.clube_atual_id(); v_mr record; v_req record; v_relato text; v_em timestamptz;
begin
  if v_uid is null or v_club is null then raise exception 'Sem clube em uso.'; end if;
  perform public._exigir_especialidades_habilitado(v_club);
  select * into v_mr from public.member_specialty_requirements
   where specialty_requirement_id = p_specialty_requirement_id and usuario_id = v_uid and club_id = v_club for update;
  select * into v_req from public.specialty_requirements where id = p_specialty_requirement_id;
  if v_mr.id is null or not public._especialidade_do_catalogo_oficial(v_req.specialty_id) then
    raise exception 'Requisito não encontrado para você neste clube.';
  end if;
  if v_mr.status = 'aprovado' then raise exception 'Este requisito já foi aprovado.'; end if;
  if v_mr.status = 'aguardando_avaliacao' then raise exception 'Este requisito já foi enviado. Aguarde a avaliação.'; end if;
  v_relato := public._relato_normalizar(p_relato);
  update public.member_specialty_requirements
     set relato = v_relato,
         status = case when v_relato is not null and status in ('nao_iniciado', 'correcao_solicitada') then 'em_andamento' else status end,
         rascunho_em = now(), updated_at = now()
   where id = v_mr.id
  returning rascunho_em into v_em;
  return json_build_object('ok', true, 'relato', v_relato, 'rascunho_em', v_em);
end;
$$;
revoke all on function public.especialidade_requisito_relato_salvar(uuid, text) from public, anon;
grant execute on function public.especialidade_requisito_relato_salvar(uuid, text) to authenticated;


create or replace function public.especialidade_requisito_enviar(p_specialty_requirement_id uuid)
returns json
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid(); v_club uuid := public.clube_atual_id(); v_mr record; v_req record;
  v_erros text[]; v_bloq text[]; v_tipo text; v_prox int; v_sub uuid; v_resumo text; v_primeiro text;
begin
  if v_uid is null or v_club is null then raise exception 'Sem clube em uso.'; end if;
  perform public._exigir_especialidades_habilitado(v_club);
  select * into v_mr from public.member_specialty_requirements
   where specialty_requirement_id = p_specialty_requirement_id and usuario_id = v_uid and club_id = v_club for update;
  select * into v_req from public.specialty_requirements where id = p_specialty_requirement_id;
  if v_mr.id is null or not public._especialidade_do_catalogo_oficial(v_req.specialty_id) then
    raise exception 'Requisito não encontrado para você neste clube.';
  end if;
  if v_mr.status = 'aprovado' then raise exception 'Este requisito já foi aprovado.'; end if;
  if v_mr.status = 'aguardando_avaliacao' then raise exception 'Este requisito já foi enviado. Aguarde a avaliação.'; end if;

  v_bloq := public._especialidade_bloqueios(v_mr.id);
  if array_length(v_bloq, 1) > 0 then raise exception 'Requisito bloqueado: %', array_to_string(v_bloq, ' '); end if;

  if v_req.modelo is null then
    if v_req.evidencia_obrigatoria and coalesce(trim(v_mr.evidencia_texto), '') = '' and coalesce(v_mr.evidencia_path, '') = '' then
      raise exception 'Este requisito exige uma evidência antes de enviar.';
    end if;
  else
    v_erros := public._relatorio_validar(v_req.modelo, coalesce(v_mr.rascunho, '{}'::jsonb), v_mr.rascunho_anexos, true)
            || public._anexos_do_dono_erros(v_mr.rascunho_anexos, v_uid, v_club);
    if array_length(v_erros, 1) > 0 then raise exception 'Formulário incompleto: %', public._erros_em_texto(v_erros); end if;
  end if;

  select coalesce(max(tentativa_numero), 0) + 1 into v_prox
    from public.specialty_requirement_submissions where member_specialty_requirement_id = v_mr.id;

  if v_req.modelo is null then
    v_tipo := case
      when v_mr.evidencia_path is not null and v_req.tipo_evidencia = 'arquivo' then 'arquivo'
      when v_mr.evidencia_path is not null then 'foto'
      when coalesce(trim(v_mr.evidencia_texto), '') <> '' then 'texto'
      else 'nenhuma'
    end;
    insert into public.specialty_requirement_submissions (member_specialty_requirement_id, tentativa_numero, tipo_evidencia_entregue, evidencia_texto, evidencia_path, relato)
    values (v_mr.id, v_prox, v_tipo, v_mr.evidencia_texto, v_mr.evidencia_path, v_mr.relato) returning id into v_sub;
  else
    v_resumo := public._relatorio_resumo(v_req.modelo -> 'campos', coalesce(v_mr.rascunho, '{}'::jsonb));
    v_primeiro := v_mr.rascunho_anexos -> 0 ->> 'path';
    insert into public.specialty_requirement_submissions
      (member_specialty_requirement_id, tentativa_numero, tipo_evidencia_entregue, evidencia_texto, evidencia_path, conteudo, anexos, modelo_versao, relato)
    values (v_mr.id, v_prox, 'relatorio', nullif(v_resumo, ''), v_primeiro, coalesce(v_mr.rascunho, '{}'::jsonb), v_mr.rascunho_anexos, 1, v_mr.relato) returning id into v_sub;
    update public.member_specialty_requirements set evidencia_texto = nullif(v_resumo, ''), evidencia_path = coalesce(v_primeiro, evidencia_path) where id = v_mr.id;
  end if;

  update public.member_specialty_requirements set status = 'aguardando_avaliacao', enviado_em = now(), updated_at = now() where id = v_mr.id;
  return json_build_object('ok', true, 'submission_id', v_sub, 'tentativa_numero', v_prox);
end;
$$;

create or replace function public.especialidade_historico(p_member_specialty_requirement_id uuid) returns json
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_club uuid := public.clube_atual_id(); v_mr record; v_req record;
begin
  if v_uid is null or v_club is null then raise exception 'Sem clube em uso.'; end if;
  perform public._exigir_especialidades_habilitado(v_club);
  select * into v_mr from public.member_specialty_requirements
   where id = p_member_specialty_requirement_id and club_id = v_club
     and (usuario_id = v_uid or public._pode_avaliar_especialidade(member_specialty_id, v_club));
  if not found then raise exception 'Requisito não encontrado para você neste clube.'; end if;
  select * into v_req from public.specialty_requirements where id = v_mr.specialty_requirement_id;
  return json_build_object(
    'requirement_id', v_mr.specialty_requirement_id,
    'status_atual', v_mr.status,
    'modelo', v_req.modelo,
    'tentativas', (
      select coalesce(json_agg(json_build_object(
        'submission_id', sub.id, 'tentativa_numero', sub.tentativa_numero, 'tipo_evidencia', sub.tipo_evidencia_entregue,
        'evidencia_texto', sub.evidencia_texto, 'evidencia_path', sub.evidencia_path, 'conteudo', sub.conteudo, 'relato', sub.relato, 'anexos', sub.anexos,
        'modelo_versao', sub.modelo_versao, 'enviado_em', sub.enviado_em,
        'decisao', ap.decisao, 'avaliado_por_nome', av.nome, 'avaliado_papel', ap.avaliado_papel, 'comentario', ap.comentario, 'avaliado_em', ap.created_at
      ) order by sub.tentativa_numero), '[]'::json)
      from public.specialty_requirement_submissions sub
      left join public.requirement_approvals ap on ap.specialty_submission_id = sub.id
      left join public.profiles av on av.id = ap.avaliado_por
      where sub.member_specialty_requirement_id = v_mr.id
    )
  );
end;
$$;

create or replace function public.especialidade_avaliacoes_pendentes()
returns json
language plpgsql stable security definer set search_path = '' as $$
declare v_club uuid := public.clube_atual_id();
begin
  if v_club is null then return '[]'::json; end if;
  perform public._exigir_especialidades_habilitado(v_club);
  return coalesce((
    select json_agg(json_build_object(
      'member_specialty_requirement_id', mr.id,
      'submission_id', sub.id, 'tentativa_numero', sub.tentativa_numero,
      'usuario_id', p.id, 'usuario_nome', p.nome, 'usuario_foto', p.foto,
      'especialidade_nome', sp.nome,
      'requisito_id', r.id, 'requisito_codigo', r.codigo, 'requisito_descricao', r.descricao,
      'tipo_evidencia', coalesce(sub.tipo_evidencia_entregue, r.tipo_evidencia),
      'evidencia_texto', coalesce(sub.evidencia_texto, mr.evidencia_texto), 'evidencia_path', coalesce(sub.evidencia_path, mr.evidencia_path),
      'conteudo', sub.conteudo, 'relato', sub.relato, 'anexos', coalesce(sub.anexos, '[]'::jsonb), 'modelo', r.modelo,
      'enviado_em', mr.enviado_em
    ) order by mr.enviado_em)
    from public.member_specialty_requirements mr
    join public.specialty_requirements r on r.id = mr.specialty_requirement_id
    join public.specialties sp on sp.id = r.specialty_id
    join public.profiles p on p.id = mr.usuario_id
    left join lateral (
      select * from public.specialty_requirement_submissions s2 where s2.member_specialty_requirement_id = mr.id order by s2.tentativa_numero desc limit 1
    ) sub on true
    where mr.club_id = v_club and mr.status = 'aguardando_avaliacao'
      and public._especialidade_do_catalogo_oficial(sp.id)
      and public._pode_avaliar_especialidade(mr.member_specialty_id, v_club)
  ), '[]'::json);
end;
$$;

CREATE OR REPLACE FUNCTION public.minha_especialidade(p_member_specialty_id uuid DEFAULT NULL::uuid)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_uid uuid := auth.uid(); v_club uuid := public.clube_atual_id(); v_ms record;
begin
  if v_uid is null or v_club is null then return null; end if;
  perform public._exigir_especialidades_habilitado(v_club);
  if p_member_specialty_id is not null then
    select * into v_ms from public.member_specialties
     where id = p_member_specialty_id and usuario_id = v_uid and club_id = v_club
       and public._especialidade_do_catalogo_oficial(specialty_id);
  else
    select * into v_ms from public.member_specialties
     where usuario_id = v_uid and club_id = v_club and public._especialidade_do_catalogo_oficial(specialty_id)
     order by (status = 'em_andamento') desc, iniciada_em desc
     limit 1;
  end if;
  if v_ms.id is null then return null; end if;

  return json_build_object(
    'member_specialty', json_build_object(
      'id', v_ms.id, 'status', v_ms.status, 'iniciada_em', v_ms.iniciada_em, 'concluida_em', v_ms.concluida_em,
      'percentual', public.especialidade_percentual(v_ms.id)
    ),
    'especialidade', (select json_build_object('id', sp.id, 'codigo', sp.codigo, 'nome', sp.nome, 'categoria', sp.categoria, 'nivel', sp.nivel,
                              'fonte_url', sp.fonte_url, 'fonte_consultada_em', sp.fonte_consultada_em, 'fonte_revisao', sp.fonte_revisao)
                       from public.specialties sp where sp.id = v_ms.specialty_id),
    'curriculum_version', (
      select json_build_object('id', ver.id, 'origem', ver.origem, 'identificador', ver.identificador, 'versao', ver.versao,
               'status', ver.status, 'fonte_url', ver.fonte_url, 'fonte_descricao', ver.fonte_descricao)
      from public.specialties sp join public.curriculum_versions ver on ver.id = sp.curriculum_version_id where sp.id = v_ms.specialty_id
    ),
    'oferta', (select json_build_object('titulo', o.titulo, 'instrutor_responsavel_nome', p.nome, 'periodo_inicio', o.periodo_inicio, 'periodo_fim', o.periodo_fim)
               from public.specialty_offerings o left join public.profiles p on p.id = o.instrutor_responsavel_id where o.id = v_ms.oferta_id),
    'grupos', (
      select coalesce(json_agg(json_build_object(
        'chave', g.chave, 'rotulo', g.rotulo, 'minimo', g.minimo,
        'aprovados', (select count(*) from public.specialty_requirements r2
                        join public.member_specialty_requirements m2 on m2.specialty_requirement_id = r2.id and m2.member_specialty_id = v_ms.id
                       where r2.specialty_id = g.specialty_id and r2.grupo = g.chave and m2.status = 'aprovado')
      ) order by g.chave), '[]'::json)
      from public.specialty_requirement_groups g where g.specialty_id = v_ms.specialty_id
    ),
    'requisitos', (
      select coalesce(json_agg(json_build_object(
        'id', r.id, 'codigo', r.codigo, 'descricao', r.descricao,
        'tipo_evidencia', r.tipo_evidencia, 'evidencia_obrigatoria', r.evidencia_obrigatoria,
        'modelo', r.modelo, 'grupo', r.grupo, 'depende_de', to_json(r.depende_de), 'prazo_dias', r.prazo_dias,
        'prazo_em', case when r.prazo_dias is null then null else v_ms.iniciada_em + make_interval(days => r.prazo_dias) end,
        'bloqueios', case when mr.id is null then '[]'::json else to_json(public._especialidade_bloqueios(mr.id)) end,
        'member_specialty_requirement_id', mr.id, 'status', coalesce(mr.status, 'nao_iniciado'),
        'evidencia_texto', mr.evidencia_texto, 'evidencia_path', mr.evidencia_path, 'enviado_em', mr.enviado_em,
        'rascunho', mr.rascunho, 'rascunho_em', mr.rascunho_em, 'relato', mr.relato, 'anexos', coalesce(mr.rascunho_anexos, '[]'::jsonb),
        'tentativas', (select count(*) from public.specialty_requirement_submissions s where s.member_specialty_requirement_id = mr.id),
        'avaliacoes', (
          select coalesce(json_agg(json_build_object(
            'decisao', a.decisao, 'avaliado_por_nome', p2.nome, 'avaliado_papel', a.avaliado_papel,
            'comentario', a.comentario, 'created_at', a.created_at
          ) order by a.created_at), '[]'::json)
          from public.requirement_approvals a
          join public.profiles p2 on p2.id = a.avaliado_por
          where mr.id is not null and a.member_specialty_requirement_id = mr.id
        )
      ) order by r.ordem, r.codigo), '[]'::json)
      from public.specialty_requirements r
      left join public.member_specialty_requirements mr on mr.specialty_requirement_id = r.id and mr.member_specialty_id = v_ms.id
      where r.specialty_id = v_ms.specialty_id and r.ativo
    )
  );
end;
$function$;

notify pgrst, 'reload schema';
