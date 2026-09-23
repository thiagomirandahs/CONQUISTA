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
