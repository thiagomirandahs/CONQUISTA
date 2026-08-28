// Serviço: notificacoes — extraído de lib/dados.js (verbatim, sem mudar queries/regras).
import { supabase } from '../lib/supabase.js'


// Aviso PESSOAL (só uma pessoa vê/recebe) — usa a coluna para_usuario. Só liderança (RLS).
export async function enviarAvisoPessoal({ userId, titulo, corpo, criadoPor }) {
  const { error } = await supabase.from('notificacoes').insert({
    titulo, corpo: corpo || null, tipo: 'geral', link: '/', para: 'pessoal', para_usuario: userId, criado_por: criadoPor,
  })
  if (error) throw new Error(error.message)
}


// =====================================================================
//  NOTIFICAÇÕES (sininho) — o RLS já filtra o que cada cargo pode ver
// =====================================================================

export async function carregarNotificacoes() {
  const { data } = await supabase
    .from('notificacoes')
    .select('id,titulo,corpo,tipo,link,created_at')
    .order('created_at', { ascending: false })
    .limit(30)
  return data || []
}


// Marca no perfil que a pessoa viu as notificações agora (zera o contador).
export async function marcarNotificacoesVistas(userId) {
  await supabase.from('profiles').update({ notif_visto_em: new Date().toISOString() }).eq('id', userId)
}


// Envia um aviso geral (aparece no sino de todos, ou só da liderança).
// O RLS "criar notificacao" já exige liderança; o push sai sozinho se ativado.
export async function enviarAviso({ titulo, corpo, para, criadoPor }) {
  const { error } = await supabase.from('notificacoes').insert({
    titulo, corpo: corpo || null, tipo: 'geral', link: '/', para: para || 'todos', criado_por: criadoPor,
  })
  if (error) throw new Error(error.message)
}
