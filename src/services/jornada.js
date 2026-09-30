// Serviço da Minha Jornada e do Portfólio (migration 514). Só leitura; nada aqui aprova requisito.
import { supabase } from '../lib/supabase.js'

async function rpc(nome, args) {
  const { data, error } = await supabase.rpc(nome, args)
  if (error) throw new Error(error.message)
  return data
}

const lista = (v) => (Array.isArray(v) ? v : [])

export async function carregarMinhaJornada() {
  const d = await rpc('minha_jornada')
  if (!d) return null   // sem vínculo ativo no clube
  return {
    classes: lista(d.classes), especialidades: lista(d.especialidades), investiduras: lista(d.investiduras),
    conquistas: lista(d.conquistas), leituras: lista(d.leituras),
  }
}

// depois = cursor 'ISO|uuid' devolvido em `proximo` (ou null na primeira página)
export async function carregarPortfolio({ limite = 20, depois = null } = {}) {
  const lim = Math.min(50, Math.max(1, Math.round(Number(limite) || 20)))
  const d = await rpc('meu_portfolio', { p_limite: lim, p_depois: depois || null })
  return { itens: lista(d?.itens), proximo: d?.proximo || null }
}
