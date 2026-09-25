-- =====================================================================
--  Observabilidade (achado da auditoria da Fase 4 de fechamento): "revogar documento" e "assinar/
--  revogar assinatura" não empurravam nada pra auditoria_operacoes (a trilha genérica, lida pelo
--  painel do admin da plataforma via painel_operacoes) — só ficavam na trilha específica de classe
--  (_classe_evento) ou no próprio *_por/*_em da linha. Um admin de plataforma investigando um
--  incidente não veria essas ações no painel dele.
--
--  Esta migration só ACRESCENTA `perform public._auditar(...)` dentro de 3 funções já existentes
--  (create or replace, mesmo corpo de resto) — nenhuma tabela nova, nenhum comportamento mudado
--  além do registro em auditoria_operacoes. Nada sensível vai no `detalhe` (ids e motivo/decisão
--  apenas — nunca texto de evidência, e-mail ou conteúdo do PDF).
-- =====================================================================

create or replace function public.snapshot_revogar(p_snapshot_id uuid, p_motivo text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_s record; v_inv record; v_ach record;
begin
  if coalesce(trim(p_motivo), '') = '' then raise exception 'Informe o motivo da revogação.'; end if;
  select * into v_s from public.class_completion_snapshots where id = p_snapshot_id for update;
  if not found then raise exception 'Snapshot não encontrado.'; end if;
  if not public.pode_gerir_no_clube(v_s.club_id_origem) then raise exception 'Sem permissão (só a liderança do clube que emitiu este snapshot pode revogar).'; end if;
  if v_s.status = 'revogado' then raise exception 'Este snapshot já está revogado.'; end if;
  update public.class_completion_snapshots set status = 'revogado', revogado_em = now(), revogado_por = v_uid, revogado_motivo = p_motivo where id = v_s.id;
  perform public._classe_evento(v_s.member_class_id, 'snapshot_revogado', v_s.id, p_motivo, null);
  perform public._auditar('documento_snapshot_revogado', v_s.club_id_origem, v_s.usuario_id, jsonb_build_object('snapshot_id', v_s.id, 'motivo', p_motivo));
  select * into v_inv from public.class_investitures where snapshot_id = v_s.id and status = 'registrada';
  if found then
    update public.class_investitures set status = 'revogada', revogado_em = now(), revogado_por = v_uid, revogado_motivo = p_motivo where id = v_inv.id;
    perform public._classe_evento(v_s.member_class_id, 'investidura_revogada', v_s.id, p_motivo, jsonb_build_object('investidura_id', v_inv.id));
    select * into v_ach from public.curriculum_achievements where member_class_id = v_s.member_class_id and tipo = 'classe' and status = 'ativa';
    if found then
      update public.curriculum_achievements set status = 'revogada', revogada_em = now(), revogada_por = v_uid, revogada_motivo = p_motivo where id = v_ach.id;
      perform public._classe_evento(v_s.member_class_id, 'conquista_revogada', v_s.id, p_motivo, jsonb_build_object('conquista_id', v_ach.id));
    end if;
  end if;
  update public.investiture_reviews set status = 'recusado' where snapshot_id = v_s.id and status in ('pendente', 'aprovado');
  if v_s.member_class_id is not null then
    update public.member_classes set status = 'em_andamento', concluida_em = null, investida_em = null, updated_at = now() where id = v_s.member_class_id;
  end if;
  return json_build_object('ok', true)::jsonb;
end;
$$;
revoke all on function public.snapshot_revogar(uuid, text) from public, anon;
grant execute on function public.snapshot_revogar(uuid, text) to authenticated;

create or replace function public.documento_assinar(p_token text, p_consentimento_texto text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_d record; v_s record; v_elegivel record; v_id uuid;
begin
  if v_uid is null then raise exception 'Entre na sua conta para continuar.'; end if;
  if p_consentimento_texto is null or length(btrim(p_consentimento_texto)) < 20 then
    raise exception 'Confirme a declaração de revisão antes de assinar.';
  end if;

  select * into v_d from public.class_documents where token_publico = p_token;
  if not found then raise exception 'Documento não encontrado.'; end if;
  select * into v_s from public.class_completion_snapshots where id = v_d.snapshot_id;
  if v_s.status <> 'selado' then raise exception 'Este documento não está mais válido (revogado ou substituído) — não é possível assinar.'; end if;
  if v_d.pdf_hash is null then raise exception 'Gere o PDF antes de assinar.'; end if;

  select * into v_elegivel from public._documento_signatarios_elegiveis(v_d.id) where decisor_id = v_uid limit 1;
  if not found then
    raise exception 'Sem autoridade para assinar este documento — só quem decidiu uma etapa do workflow pode assinar.';
  end if;

  if exists (select 1 from public.document_signatures s where s.documento_id = v_d.id and s.signatario_id = v_uid and s.status = 'registrada') then
    raise exception 'Você já assinou este documento.';
  end if;

  insert into public.document_signatures (
    documento_id, snapshot_id, usuario_id, club_id_origem, signatario_id, signatario_papel,
    escopo_organizational_unit_id, metodo, pdf_hash, consentimento_texto, consentimento_em,
    workflow_stage_decision_id, status
  ) values (
    v_d.id, v_d.snapshot_id, v_d.usuario_id, v_d.club_id_origem, v_uid, v_elegivel.papel_utilizado,
    v_elegivel.escopo_organizational_unit_id, 'assinatura_eletronica', v_d.pdf_hash, btrim(p_consentimento_texto), now(),
    v_elegivel.decisao_id, 'registrada'
  ) returning id into v_id;

  perform public._auditar('documento_assinado', v_d.club_id_origem, v_d.usuario_id, jsonb_build_object('documento_id', v_d.id, 'signature_id', v_id, 'papel', v_elegivel.papel_utilizado));

  return jsonb_build_object('ok', true, 'signature_id', v_id, 'pdf_hash', v_d.pdf_hash);
end;
$$;
revoke all on function public.documento_assinar(text, text) from public, anon;
grant execute on function public.documento_assinar(text, text) to authenticated;

create or replace function public.documento_assinatura_revogar(p_signature_id uuid, p_motivo text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_s record;
begin
  select * into v_s from public.document_signatures where id = p_signature_id;
  if not found then raise exception 'Assinatura não encontrada.'; end if;
  if not (v_s.signatario_id = v_uid or public.pode_gerir_no_clube(v_s.club_id_origem)) then
    raise exception 'Sem permissão para revogar esta assinatura.';
  end if;
  if v_s.status = 'revogada' then raise exception 'Esta assinatura já está revogada.'; end if;
  if p_motivo is null or length(btrim(p_motivo)) < 5 then raise exception 'Informe o motivo.'; end if;
  update public.document_signatures set status = 'revogada' where id = p_signature_id;
  perform public._auditar('documento_assinatura_revogada', v_s.club_id_origem, v_s.usuario_id, jsonb_build_object('signature_id', p_signature_id, 'motivo', p_motivo));
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.documento_assinatura_revogar(uuid, text) from public, anon;
grant execute on function public.documento_assinatura_revogar(uuid, text) to authenticated;

notify pgrst, 'reload schema';

insert into public.migracoes_aplicadas (arquivo)
values ('2026-09-30-auditoria-de-documentos-e-assinatura.sql')
on conflict (arquivo) do update set aplicada_em = now();
