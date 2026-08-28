// Serviço: chat — extraído de lib/dados.js (verbatim, sem mudar queries/regras).
import { supabase } from '../lib/supabase.js'


// ------- Chat (grupo da unidade + conversas diretas; tudo auditável pela liderança) -------
async function carregarMensagensDaConversa(conversaId) {
  // Lê da VIEW (não da tabela direto): ela apaga o texto de verdade de
  // mensagens marcadas 'apagada' pra quem não é liderança — ver supabase/2026-08-24-chat.sql.
  const { data, error } = await supabase
    .from('chat_mensagens_visiveis').select('id,autor_id,texto,created_at,apagada')
    .eq('conversa_id', conversaId).order('created_at')
  if (error) throw new Error(error.message)
  const autorIds = [...new Set((data || []).map((m) => m.autor_id))]
  const { data: perfis } = autorIds.length
    ? await supabase.from('profiles').select('id,nome,foto').in('id', autorIds)
    : { data: [] }
  const porId = Object.fromEntries((perfis || []).map((p) => [p.id, p]))
  return (data || []).map((m) => ({ ...m, autor: porId[m.autor_id] || { nome: '?' } }))
}


// Chat da MINHA unidade (cria-se sozinho no 1º envio; antes disso não existe ainda).
export async function carregarChatUnidade(unidadeId) {
  if (!unidadeId) return { conversaId: null, mensagens: [] }
  const { data: conv, error } = await supabase
    .from('chat_conversas').select('id').eq('tipo', 'unidade').eq('unidade_id', unidadeId).maybeSingle()
  if (error) throw new Error(error.message)
  if (!conv) return { conversaId: null, mensagens: [] }
  return { conversaId: conv.id, mensagens: await carregarMensagensDaConversa(conv.id) }
}


// Chat GERAL do clube (todos juntos, inclusive liderança) — ver 2026-08-26-chat-geral.sql.
export async function carregarChatGeral() {
  const { data: conv, error } = await supabase
    .from('chat_conversas').select('id').eq('tipo', 'geral').maybeSingle()
  if (error) throw new Error(error.message)
  if (!conv) return { conversaId: null, mensagens: [] }
  return { conversaId: conv.id, mensagens: await carregarMensagensDaConversa(conv.id) }
}

export async function enviarMensagemGeral(texto) {
  const { data, error } = await supabase.rpc('chat_enviar_geral', { p_texto: texto })
  if (error) throw new Error(error.message)
  return data
}


// Minhas conversas diretas (1 linha por pessoa com quem já troquei mensagem).
export async function carregarMinhasConversasDiretas(meuId) {
  const { data: cps, error } = await supabase.from('chat_participantes').select('conversa_id').eq('usuario_id', meuId)
  if (error) throw new Error(error.message)
  const conversaIds = [...new Set((cps || []).map((c) => c.conversa_id))]
  if (!conversaIds.length) return []
  const { data: todos } = await supabase.from('chat_participantes').select('conversa_id,usuario_id').in('conversa_id', conversaIds)
  const outroPorConversa = {}
  ;(todos || []).forEach((p) => { if (p.usuario_id !== meuId) outroPorConversa[p.conversa_id] = p.usuario_id })
  const outroIds = [...new Set(Object.values(outroPorConversa))]
  const { data: perfis } = outroIds.length
    ? await supabase.from('profiles').select('id,nome,foto,unidade_id').in('id', outroIds)
    : { data: [] }
  const perfilPorId = Object.fromEntries((perfis || []).map((p) => [p.id, p]))
  return conversaIds
    .filter((cid) => outroPorConversa[cid] && perfilPorId[outroPorConversa[cid]])
    .map((cid) => ({ conversaId: cid, outro: perfilPorId[outroPorConversa[cid]] }))
}


export async function carregarMensagensDireta(conversaId) {
  return carregarMensagensDaConversa(conversaId)
}


// Colegas com quem dá pra conversar (só quem também usa o chat: desbravador/conselheiro).
export async function listarColegasChat(meuId) {
  const { data, error } = await supabase.from('profiles').select('id,nome,foto,unidade_id')
    .eq('status', 'ativo').in('papel', ['desbravador', 'conselheiro']).order('nome')
  if (error) throw new Error(error.message)
  return (data || []).filter((p) => p.id !== meuId)
}


export async function enviarMensagemUnidade(texto) {
  const { data, error } = await supabase.rpc('chat_enviar_unidade', { p_texto: texto })
  if (error) throw new Error(error.message)
  return data
}

export async function enviarMensagemDireta(destinatarioId, texto) {
  const { data, error } = await supabase.rpc('chat_enviar_direta', { p_destinatario_id: destinatarioId, p_texto: texto })
  if (error) throw new Error(error.message)
  return data
}

export async function apagarMensagemChat(mensagemId) {
  const { data, error } = await supabase.rpc('chat_apagar_mensagem', { p_mensagem_id: mensagemId })
  if (error) throw new Error(error.message)
  return data
}


// Só liderança: todas as conversas do clube (moderação/auditoria).
export async function carregarTodasConversasChat() {
  const { data, error } = await supabase.rpc('chat_todas_conversas')
  if (error) throw new Error(error.message)
  const unidadeIds = [...new Set((data || []).map((c) => c.unidade_id).filter(Boolean))]
  const { data: us } = unidadeIds.length
    ? await supabase.from('unidades').select('id,nome,cor').in('id', unidadeIds)
    : { data: [] }
  const uniPorId = Object.fromEntries((us || []).map((u) => [u.id, u]))
  return (data || []).map((c) => ({ ...c, unidade: c.unidade_id ? uniPorId[c.unidade_id] : null }))
}
