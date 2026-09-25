// Serviço: Caderno Digital DesbravaClube (fase 4.1). O documento é emitido de um snapshot selado
// (migration 44/45); o renderer NUNCA consulta o currículo corrente — tudo vem do snapshot.
import { supabase } from '../lib/supabase.js'

// Liderança/dono emite (ou reobtém, idempotente) o documento de uma matrícula. Sem tipo, o servidor
// escolhe: 'final' se investida, senão 'acompanhamento'.
export async function emitirDocumento(memberClassId, tipo = null) {
  const { data, error } = await supabase.rpc('documento_emitir', { p_member_class_id: memberClassId, p_tipo: tipo })
  if (error) throw new Error(error.message)
  return data
}

// Documentos já emitidos de uma matrícula (dono/liderança) — pra oferecer "ver/imprimir".
export async function documentosDaMatricula(memberClassId) {
  const { data, error } = await supabase.rpc('documentos_da_matricula', { p_member_class_id: memberClassId })
  if (error) throw new Error(error.message)
  return data || []
}

// Conteúdo COMPLETO do documento pra renderizar (dono/liderança) — sanitizado no servidor.
export async function conteudoDocumento(token) {
  const { data, error } = await supabase.rpc('documento_conteudo', { p_token: token })
  if (error) throw new Error(error.message)
  return data
}

// Verificação PÚBLICA por token (anon) — só o resumo mínimo + integridade + estado.
export async function verificarDocumento(token) {
  const { data, error } = await supabase.rpc('documento_verificar', { p_token: token })
  if (error) throw new Error(error.message)
  return data
}

// ---------------------------------------------------------------------------------------------
// Fase 4 (Bloco 1) — Central de Documentos (Gestão → Documentos): só LEITURA + geração de PDF.
// Nenhuma correção pedagógica passa por aqui (isso continua no fluxo de requisito/avaliação).
// ---------------------------------------------------------------------------------------------
export async function carregarDocumentosDoClube() {
  const { data, error } = await supabase.rpc('documentos_do_clube')
  if (error) throw new Error(error.message)
  return data || []
}

// Chama a Edge Function que monta o PDF no SERVIDOR (pdf-lib, dentro da função) e registra
// hash+caminho via documento_pdf_registrar. O cliente nunca monta o PDF.
export async function gerarPdf(token) {
  const { data, error } = await supabase.functions.invoke('gerar-documento-pdf', { body: { token } })
  if (error) {
    const corpo = await error.context?.json?.().catch(() => null)
    throw new Error(corpo?.erro || error.message)
  }
  return data
}

export async function baixarPdf(storagePath) {
  const { data, error } = await supabase.storage.from('documentos-emitidos').createSignedUrl(storagePath, 300)
  if (error) throw new Error(error.message)
  return data.signedUrl
}

export const ROTULO_ESTADO = {
  em_preparacao: 'Em preparação',
  pronto_revisao: 'Pronto para revisão',
  correcao_solicitada: 'Correção solicitada',
  pronto_para_assinatura: 'Pronto para assinatura',
  parcialmente_assinado: 'Parcialmente assinado',
  assinado: 'Assinado',
  substituido: 'Substituído',
  revogado: 'Revogado',
}

// ---------------------------------------------------------------------------------------------
// Revisão DOCUMENTAL — diferente de avaliação curricular (isso continua em Avaliar Classes/
// Especialidades). Aponta problema do DOCUMENTO/PDF (dado ausente, inconsistência, apresentação),
// nunca reabre requisito/evidência/aprovação. Exigida (aprovada) antes de assinar.
// ---------------------------------------------------------------------------------------------
export async function revisarDocumento(token, decisao, motivo = null, orientacao = null) {
  const { data, error } = await supabase.rpc('documento_revisar', { p_token: token, p_decisao: decisao, p_motivo: motivo, p_orientacao: orientacao })
  if (error) throw new Error(error.message)
  return data
}

// ---------------------------------------------------------------------------------------------
// Fase 4 (Bloco 2) — Assinatura eletrônica interna do DesbravaClube. NÃO existe assinatura por
// requisito/tentativa — só no documento final, depois do PDF gerado. Quem pode assinar vem de
// workflow_stage_decisions (o servidor decide; o cliente nunca declara autoridade).
// ---------------------------------------------------------------------------------------------
export async function carregarAssinaturas(token) {
  const { data, error } = await supabase.rpc('documento_assinaturas', { p_token: token })
  if (error) throw new Error(error.message)
  return data
}

export async function assinarDocumento(token, consentimentoTexto) {
  const { data, error } = await supabase.rpc('documento_assinar', { p_token: token, p_consentimento_texto: consentimentoTexto })
  if (error) throw new Error(error.message)
  return data
}

export async function assinarLote(tokens, consentimentoTexto) {
  const { data, error } = await supabase.rpc('documento_assinar_lote', { p_tokens: tokens, p_consentimento_texto: consentimentoTexto })
  if (error) throw new Error(error.message)
  return data
}

export async function revogarAssinatura(signatureId, motivo) {
  const { data, error } = await supabase.rpc('documento_assinatura_revogar', { p_signature_id: signatureId, p_motivo: motivo })
  if (error) throw new Error(error.message)
  return data
}

// H2 — representação final assinada, gerada depois da 1ª assinatura (nunca antes). Idempotente pro
// mesmo conjunto de assinaturas: `gerado_agora: false` quando já existia. NÃO substitui o H1 (o PDF
// que a assinatura declara continua sendo aquele, ver documento_assinar) — é só a página de leitura.
export async function gerarRepresentacaoFinal(token) {
  const { data, error } = await supabase.functions.invoke('gerar-documento-pdf-final', { body: { token } })
  if (error) {
    const corpo = await error.context?.json?.().catch(() => null)
    throw new Error(corpo?.erro || error.message)
  }
  return data
}

// Sobe o desenho da assinatura (PNG) no bucket privado — path escopado por clube/documento/assinatura
// (a policy do Storage já garante isso; o path aqui só segue a MESMA convenção). Depois registra a
// referência na linha da assinatura (é a única coluna que pode mudar depois do INSERT).
export async function subirDesenhoAssinatura(clubId, documentoId, signatureId, blobPng) {
  const path = `${clubId}/${documentoId}/${signatureId}.png`
  const { error: erroUpload } = await supabase.storage.from('assinaturas-desenhadas').upload(path, blobPng, { contentType: 'image/png', upsert: false })
  if (erroUpload) throw new Error(erroUpload.message)
  const { data, error } = await supabase.rpc('documento_assinatura_desenho_registrar', { p_signature_id: signatureId, p_path: path })
  if (error) throw new Error(error.message)
  return data
}
