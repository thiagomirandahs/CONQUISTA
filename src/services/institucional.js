// Serviço: escopo INSTITUCIONAL (distrito/região/campo/união/divisão) — fase 4.3.
// Nada aqui é "clube": são camadas acima na árvore, com contexto próprio. O servidor resolve o escopo
// em uso pelo header x-escopo-atual (sempre validado contra vínculo ativo) e devolve SÓ o que o escopo
// justifica — agregados dos clubes abaixo, nunca dado operacional/pessoal deles.
import { supabase } from '../lib/supabase.js'

// Vínculos institucionais da pessoa + capacidades em cada um. Vem vazio pra quem só tem clube.
export async function carregarContextoInstitucional() {
  const { data, error } = await supabase.rpc('meu_contexto_institucional')
  if (error) throw new Error(error.message)
  return data
}

// Situação geral dos clubes abaixo do escopo em uso — SÓ contagens.
export async function carregarPainelDoEscopo() {
  const { data, error } = await supabase.rpc('escopo_painel')
  if (error) throw new Error(error.message)
  return data || []
}

// Investiduras paradas numa etapa que EXIGE a atuação desta autoridade. Para as Classes Regulares
// isto é sempre vazio hoje (o workflow ativo tem as 2 etapas no clube) — e o portal diz isso.
export async function carregarInvestidurasDoEscopo() {
  const { data, error } = await supabase.rpc('escopo_investiduras_pendentes')
  if (error) throw new Error(error.message)
  return data || []
}
