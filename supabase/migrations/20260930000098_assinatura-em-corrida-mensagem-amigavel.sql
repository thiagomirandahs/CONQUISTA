-- Bug real achado provando a assinatura em LOTE sob concorrência de verdade (item 2 da rodada de
-- fechamento): o pré-check "já assinou" (select ... if exists) e o INSERT não são atômicos — duas
-- chamadas concorrentes de documento_assinar pro MESMO documento/signatário podem passar as duas pelo
-- pré-check antes de qualquer uma comitar. A SEGUNDA a chegar no INSERT esbarra no índice único
-- (ux_document_signatures_doc_signatario_ativa) e o erro cru do Postgres ("duplicate key value
-- violates unique constraint...") vazava pro resultado do item no lote, em vez da mensagem amigável
-- que o pré-check já usa no caso não-concorrente. O índice único continua sendo a garantia de
-- verdade (nunca duas assinaturas ativas) — isto só troca a MENSAGEM de quem perde a corrida.
create or replace function public.documento_assinar(p_token text, p_consentimento_texto text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_d record; v_s record; v_elegivel record; v_id uuid; v_revisao public.document_reviews;
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

  v_revisao := public._documento_revisao_atual(v_d.id, v_d.pdf_versao);
  if v_revisao is null or v_revisao.status <> 'aprovado' then
    raise exception 'Este documento precisa passar pela revisão documental (aprovada) antes de ser assinado.';
  end if;

  select * into v_elegivel from public._documento_signatarios_elegiveis(v_d.id) where decisor_id = v_uid limit 1;
  if not found then
    raise exception 'Sem autoridade para assinar este documento — só quem decidiu uma etapa do workflow pode assinar.';
  end if;

  if exists (select 1 from public.document_signatures s where s.documento_id = v_d.id and s.signatario_id = v_uid and s.status = 'registrada') then
    raise exception 'Você já assinou este documento.';
  end if;

  begin
    insert into public.document_signatures (
      documento_id, snapshot_id, usuario_id, club_id_origem, signatario_id, signatario_papel,
      escopo_organizational_unit_id, metodo, pdf_hash, consentimento_texto, consentimento_em,
      workflow_stage_decision_id, status
    ) values (
      v_d.id, v_d.snapshot_id, v_d.usuario_id, v_d.club_id_origem, v_uid, v_elegivel.papel_utilizado,
      v_elegivel.escopo_organizational_unit_id, 'assinatura_eletronica', v_d.pdf_hash, btrim(p_consentimento_texto), now(),
      v_elegivel.decisao_id, 'registrada'
    ) returning id into v_id;
  exception when unique_violation then
    -- perdeu a corrida: outra chamada concorrente (ou o mesmo lote, duas vezes) já registrou a
    -- assinatura ativa entre o pré-check acima e este INSERT. Mesma mensagem do pré-check normal.
    raise exception 'Você já assinou este documento.';
  end;

  perform public._auditar('documento_assinado', v_d.club_id_origem, v_d.usuario_id, jsonb_build_object('documento_id', v_d.id, 'signature_id', v_id, 'papel', v_elegivel.papel_utilizado));

  return jsonb_build_object('ok', true, 'signature_id', v_id, 'pdf_hash', v_d.pdf_hash);
end;
$$;
revoke all on function public.documento_assinar(text, text) from public, anon;
grant execute on function public.documento_assinar(text, text) to authenticated;

notify pgrst, 'reload schema';

insert into public.migracoes_aplicadas (arquivo)
values ('2026-09-30-assinatura-em-corrida-mensagem-amigavel.sql')
on conflict (arquivo) do update set aplicada_em = now();
