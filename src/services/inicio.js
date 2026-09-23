// Serviço: Início contextual e fila única de avaliação (fase 7).
// A priorização roda no SERVIDOR (meu_inicio): a regra de quem vê o quê não é duplicada aqui, e o
// celular faz UMA chamada em vez de oito ao abrir o app.
import { supabase } from '../lib/supabase.js'

export async function carregarInicio() {
  const { data, error } = await supabase.rpc('meu_inicio')
  if (error) throw new Error(error.message)
  return data || []
}

export async function carregarAvaliacoesPendentes() {
  const { data, error } = await supabase.rpc('avaliacoes_pendentes')
  if (error) throw new Error(error.message)
  return data || {}
}
