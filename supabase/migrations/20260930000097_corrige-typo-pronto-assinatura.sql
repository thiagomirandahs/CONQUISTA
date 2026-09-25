-- Bug real achado ao provar a assinatura em LOTE pelo NAVEGADOR (item 2 da rodada de fechamento):
-- a migration 92 (revisão documental) reescreveu documentos_do_clube() e, ao mexer no `case`, trocou
-- 'pronto_para_assinatura' por 'pronto_assinatura' por engano — o front (ROTULO_ESTADO e o array
-- ASSINAVEIS em GestaoDocumentos.jsx) continuou esperando 'pronto_para_assinatura'. Resultado: desde
-- a migration 92, NENHUM documento pronto pra assinar mostrava o botão "Assinar" nem o checkbox de
-- seleção em lote na Central de Documentos — a tela renderizava o código cru ("pronto_assinatura")
-- em vez do rótulo, e a lista ASSINAVEIS nunca casava. Achado ao logar de verdade e olhar a tela, não
-- só por leitura de código.
create or replace function public.documentos_do_clube() returns json
language plpgsql stable security definer set search_path = '' as $$
declare v_club uuid := public.clube_atual_id();
begin
  if v_club is null or not public.pode_gerir_no_clube(v_club) then
    raise exception 'Sem permissão (apenas diretoria/instrutor deste clube).';
  end if;
  return coalesce((
    select json_agg(json_build_object(
      'documento_id', d.id, 'token', d.token_publico, 'tipo', d.tipo, 'conferencia', d.conferencia,
      'titular_nome', p.nome, 'classe_nome', cl.nome, 'emitido_em', d.emitido_em,
      'snapshot_status', s.status, 'pdf_versao', d.pdf_versao, 'pdf_gerado_em', d.pdf_gerado_em,
      'pdf_storage_path', d.pdf_storage_path,
      'assinaturas_registradas', (select count(*) from public.document_signatures sg where sg.documento_id = d.id and sg.status = 'registrada'),
      'assinaturas_exigidas', (select count(distinct decisor_id) from public._documento_signatarios_elegiveis(d.id)),
      'revisao', (select jsonb_build_object('status', r.status, 'motivo', r.motivo, 'orientacao', r.orientacao, 'decidido_em', r.decidido_em)
                  from public._documento_revisao_atual(d.id, d.pdf_versao) r),
      'estado', case
        when s.status = 'revogado' then 'revogado'
        when s.status = 'substituido' then 'substituido'
        when d.pdf_hash is null then 'em_preparacao'
        when (select r.status from public._documento_revisao_atual(d.id, d.pdf_versao) r) = 'correcao_solicitada' then 'correcao_solicitada'
        when (select r.status from public._documento_revisao_atual(d.id, d.pdf_versao) r) is distinct from 'aprovado' then 'pronto_revisao'
        when (select count(*) from public.document_signatures sg where sg.documento_id = d.id and sg.status = 'registrada') = 0 then 'pronto_para_assinatura'
        when (select count(*) from public.document_signatures sg where sg.documento_id = d.id and sg.status = 'registrada')
             < (select count(distinct decisor_id) from public._documento_signatarios_elegiveis(d.id)) then 'parcialmente_assinado'
        else 'assinado'
      end
    ) order by d.emitido_em desc)
    from public.class_documents d
    join public.class_completion_snapshots s on s.id = d.snapshot_id
    join public.profiles p on p.id = d.usuario_id
    left join public.classes cl on cl.id = s.classe_id
    where d.club_id_origem = v_club
  ), '[]'::json);
end;
$$;

notify pgrst, 'reload schema';

insert into public.migracoes_aplicadas (arquivo)
values ('2026-09-30-corrige-typo-pronto-assinatura.sql')
on conflict (arquivo) do update set aplicada_em = now();
