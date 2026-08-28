// Serviço: bichinho — extraído de lib/dados.js (verbatim, sem mudar queries/regras).
import { supabase } from '../lib/supabase.js'


// ------- Bichinho virtual (mascote de cuidado diário) -------
export async function meuBichinho() {
  const { data, error } = await supabase.rpc('meu_bichinho')
  if (error) throw new Error(error.message)
  return data
}

export async function adotarBichinho(nome, especie) {
  const { data, error } = await supabase.rpc('bichinho_adotar', { p_nome: nome, p_especie: especie })
  if (error) throw new Error(error.message)
  return data
}

export async function cuidarBichinho(acao) {
  const { data, error } = await supabase.rpc('bichinho_cuidar', { p_acao: acao })
  if (error) throw new Error(error.message)
  return data
}

export async function equiparBichinho(item) {
  const { data, error } = await supabase.rpc('bichinho_equipar', { p_item: item })
  if (error) throw new Error(error.message)
  return data
}

// 💤 Dormir / ☀️ acordar (modo acampamento: congela barras, morte e ofensiva)
export async function dormirBichinho() {
  const { data, error } = await supabase.rpc('bichinho_dormir')
  if (error) throw new Error(error.message)
  return data
}

export async function acordarBichinho() {
  const { data, error } = await supabase.rpc('bichinho_acordar')
  if (error) throw new Error(error.message)
  return data
}


// Personalizar o visual: campo ∈ 'cenario' | 'cor' | 'olhos'
export async function vestirBichinho(campo, valor) {
  const { data, error } = await supabase.rpc('bichinho_vestir', { p_campo: campo, p_valor: valor })
  if (error) throw new Error(error.message)
  return data
}

export async function petsDoClube() {
  const { data, error } = await supabase.rpc('pets_do_clube')
  if (error) throw new Error(error.message)
  return data || []
}
