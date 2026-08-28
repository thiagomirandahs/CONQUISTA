// Serviço: missoes — extraído de lib/dados.js (verbatim, sem mudar queries/regras).
import { supabase } from '../lib/supabase.js'
import { subirComprovacao } from '../lib/upload.js'


// Missão do dia (devocional OU desafio da classe) + resumo (feito/sequência).
export async function carregarMissao() {
  const [{ data: m }, { data: resumo }] = await Promise.all([
    supabase.rpc('missao_do_dia'),
    supabase.rpc('meu_resumo_missoes'),
  ])
  const missao = Array.isArray(m) ? m[0] : m
  return { missao: missao || null, resumo: resumo || { feito: false, sequencia: 0, foto: null } }
}


// Envia a foto (se a missão pedir) e registra a missão do dia (pontua na hora).
// Hardening etapa 2: a comprovação vai pro bucket PRIVADO 'comprovacoes' e o
// banco guarda o CAMINHO — quem vê (dono/liderança) gera signed URL na hora.
export async function enviarMissao({ foto, resposta, userId }) {
  let fotoUrl = null
  if (foto) {
    fotoUrl = await subirComprovacao({ file: foto, tipo: 'missoes', userId })
  }
  const { data, error } = await supabase.rpc('registrar_missao', { p_foto_url: fotoUrl, p_resposta: resposta ?? null })
  if (error) throw new Error(error.message)
  return data
}


// Resolve o valor guardado em foto_url pra algo exibível:
//  * registro ANTIGO = URL pública completa → devolve como está (transição);
//  * registro NOVO = caminho no bucket privado → gera signed URL de 1 hora
//    (o Storage só assina pra quem TEM acesso: dono ou liderança).
export async function urlComprovacao(valor) {
  if (!valor) return null
  if (/^https?:\/\//i.test(valor)) return valor
  const { data, error } = await supabase.storage.from('comprovacoes').createSignedUrl(valor, 3600)
  if (error) throw new Error(error.message)
  return data.signedUrl
}


// Missões de foto aguardando aprovação (só liderança).
export async function carregarMissoesPendentes() {
  const { data, error } = await supabase.rpc('missoes_pendentes')
  if (error) throw new Error(error.message)
  return data || []
}


// Aprovar (vira pontos) ou reprovar (0) uma missão de foto.
export async function avaliarMissao(id, aprovar) {
  const { error } = await supabase.rpc('avaliar_missao', { p_id: id, p_aprovar: aprovar })
  if (error) throw new Error(error.message)
}
