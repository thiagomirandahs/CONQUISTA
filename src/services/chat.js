// Serviço: chat — extraído de lib/dados.js.
import { supabase } from '../lib/supabase.js'
import { membrosDoClube, PAPEIS_DE_UNIDADE } from './membros.js'


// ------- Chat (grupo da unidade + conversas diretas; tudo auditável pela liderança) -------
const LIMITE_MENSAGENS = 300

async function carregarMensagensDaConversa(conversaId) {
  // Lê da VIEW (não da tabela direto): ela apaga o texto de verdade de
  // mensagens marcadas 'apagada' pra quem não é liderança — ver supabase/2026-08-24-chat.sql.
  // as N mais RECENTES (ordem decrescente + limit) e depois na ordem de leitura: com o histórico grande o PostgREST
  // devolve no máximo 1000 linhas e, sem isto, seriam as mais ANTIGAS.
  const { data: recentes, error } = await supabase
    .from('chat_mensagens_visiveis').select('id,autor_id,texto,created_at,apagada')
    .eq('conversa_id', conversaId).order('created_at', { ascending: false }).limit(LIMITE_MENSAGENS)
  if (error) throw new Error(error.message)
  const data = (recentes || []).slice().reverse()
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
  // só nome e foto: a unidade do espelho profiles é a do clube primário da pessoa, não a daqui
  const { data: perfis } = outroIds.length
    ? await supabase.from('profiles').select('id,nome,foto').in('id', outroIds)
    : { data: [] }
  const perfilPorId = Object.fromEntries((perfis || []).map((p) => [p.id, p]))
  return conversaIds
    .filter((cid) => outroPorConversa[cid] && perfilPorId[outroPorConversa[cid]])
    .map((cid) => ({ conversaId: cid, outro: perfilPorId[outroPorConversa[cid]] }))
}


export async function carregarMensagensDireta(conversaId) {
  return carregarMensagensDaConversa(conversaId)
}


// Junta a conversa que está na tela com a que acabou de vir do servidor, SEM duplicar: a chave é o
// id da mensagem, e a versão do servidor vence (ela traz o 'apagada' e o texto já filtrado pela
// view). O que só existe na tela (chegou pelo tempo real depois da leitura) fica. Se nada mudou,
// devolve a MESMA lista — assim a releitura periódica do chat não redesenha a conversa à toa.
export function mesclarMensagens(atuais, doServidor) {
  const antes = atuais || []
  const porId = new Map(antes.map((m) => [m.id, m]))
  let mudou = false
  for (const m of doServidor || []) {
    const velha = porId.get(m.id)
    if (!velha || velha.texto !== m.texto || velha.apagada !== m.apagada || (!velha.autor && m.autor)) mudou = true
    porId.set(m.id, velha ? { ...velha, ...m, autor: m.autor || velha.autor } : m)
  }
  if (!mudou) return antes
  const quando = (m) => new Date(m.created_at).getTime() || 0
  return [...porId.values()].sort((a, b) => quando(a) - quando(b))
}


// Colegas com quem dá pra conversar (só quem também usa o chat: desbravador/conselheiro).
// Pelo VÍNCULO ativo no clube da aba — o mesmo critério do chat_enviar_direta. Com o espelho
// profiles, a criança de dois clubes via na aba B colegas SÓ de A (nome e foto de outro clube) e,
// ao escolher um deles, o servidor respondia "Essa pessoa não está disponível pro chat."
export async function listarColegasChat(meuId) {
  const lista = await membrosDoClube({ papeis: PAPEIS_DE_UNIDADE })
  return lista.filter((p) => p.id !== meuId)
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
