// Serviço: leilao — extraído de lib/dados.js (verbatim, sem mudar queries/regras).
import { supabase } from '../lib/supabase.js'


// ------- Leilão (unidades juntam pontos da temporada e dão lance) -------
// Traz o leilão mais recente (aberto ou já encerrado) + itens + lances + unidades.
export async function carregarLeilao() {
  const { data: ls, error: erroL } = await supabase
    .from('leiloes').select('*').order('created_at', { ascending: false }).limit(1)
  if (erroL) throw new Error(erroL.message)
  const leilao = (ls || [])[0] || null

  const { data: us, error: erroU } = await supabase.from('unidades').select('id,nome,cor,emblema').order('nome')
  if (erroU) throw new Error(erroU.message)
  const unidades = us || []
  if (!leilao) return { leilao: null, itens: [], unidades }

  const { data: its, error: erroIt } = await supabase
    .from('leilao_itens').select('*').eq('leilao_id', leilao.id).order('ordem')
  if (erroIt) throw new Error(erroIt.message)
  const itensIds = (its || []).map((i) => i.id)

  const { data: lcs, error: erroLc } = itensIds.length
    ? await supabase.from('leilao_lances').select('*').in('item_id', itensIds).order('valor', { ascending: false })
    : { data: [], error: null }
  if (erroLc) throw new Error(erroLc.message)

  const lanceIds = (lcs || []).map((l) => l.id)
  const { data: lus, error: erroLu } = lanceIds.length
    ? await supabase.from('leilao_lance_unidades').select('*').in('lance_id', lanceIds)
    : { data: [], error: null }
  if (erroLu) throw new Error(erroLu.message)

  const uniPorId = Object.fromEntries(unidades.map((u) => [u.id, u]))
  const unidadesPorLance = {}
  for (const lu of lus || []) {
    ;(unidadesPorLance[lu.lance_id] ||= []).push({ ...(uniPorId[lu.unidade_id] || { nome: '?' }), confirmado: lu.confirmado })
  }
  const lancesPorItem = {}
  for (const l of lcs || []) {
    ;(lancesPorItem[l.item_id] ||= []).push({ ...l, unidades: unidadesPorLance[l.id] || [] })
  }
  const itens = (its || []).map((it) => {
    const lances = (lancesPorItem[it.id] || []).sort((a, b) => b.valor - a.valor)
    const atual = lances.find((l) => l.status === 'ativo') || lances.find((l) => l.id === it.vencedor_lance_id) || null
    const pendentes = lances.filter((l) => l.status === 'pendente')
    return { ...it, lances, atual, pendentes }
  })

  return { leilao, itens, unidades }
}


// Quanto a unidade tem disponível AGORA pro leilão (já descontando reservas em outros itens).
export async function saldoLeilaoUnidade(unidadeId) {
  if (!unidadeId) return 0
  const { data, error } = await supabase.rpc('leilao_saldo_unidade', { p_unidade_id: unidadeId })
  if (error) throw new Error(error.message)
  return data || 0
}


// Total de pontos da unidade na temporada (a "carteira" cheia, sem descontar reservas).
export async function pontosTemporadaUnidade(unidadeId) {
  if (!unidadeId) return 0
  const { data, error } = await supabase.rpc('pontos_temporada_unidade', { p_unidade_id: unidadeId })
  if (error) throw new Error(error.message)
  return data || 0
}


// Dá um lance PELA MINHA unidade; unidadesExtra (opcional) convida outras pro
// mesmo lance conjunto — nesse caso o lance nasce PENDENTE até cada unidade
// convidada confirmar (não gasta ponto de unidade alheia sem alguém de lá aceitar).
export async function darLance(itemId, valor, unidadesExtra) {
  const { data, error } = await supabase.rpc('dar_lance', {
    p_item_id: itemId, p_valor: valor, p_unidades_extra: unidadesExtra?.length ? unidadesExtra : null,
  })
  if (error) throw new Error(error.message)
  return data
}


// Alguém ATIVO da unidade convidada aceita entrar num lance conjunto pendente.
// Só ativa de vez quando TODAS as unidades convidadas já tiverem confirmado.
export async function confirmarLanceConjunto(lanceId) {
  const { data, error } = await supabase.rpc('confirmar_lance_conjunto', { p_lance_id: lanceId })
  if (error) throw new Error(error.message)
  return data
}


// Alguém ATIVO da unidade convidada recusa um lance conjunto pendente — sem
// aquela unidade o lance não pode mais se completar, então ele cai inteiro.
export async function recusarLanceConjunto(lanceId) {
  const { data, error } = await supabase.rpc('recusar_lance_conjunto', { p_lance_id: lanceId })
  if (error) throw new Error(error.message)
  return data
}


// Só liderança: cria o leilão. itens: [{nome, emoji, descricao, preco_base, incremento_minimo}]
export async function criarLeilao(titulo, fechaEm, itens) {
  const { data, error } = await supabase.rpc('criar_leilao', { p_titulo: titulo, p_fecha_em: fechaEm, p_itens: itens })
  if (error) throw new Error(error.message)
  return data
}


export async function encerrarLeilao(id) {
  const { data, error } = await supabase.rpc('encerrar_leilao', { p_id: id })
  if (error) throw new Error(error.message)
  return data
}


export async function cancelarLeilao(id) {
  const { data, error } = await supabase.rpc('cancelar_leilao', { p_id: id })
  if (error) throw new Error(error.message)
  return data
}
