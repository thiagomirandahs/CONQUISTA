// Serviço: ⚔️ Chefão do Fim de Semana (evento cooperativo).
import { supabase } from '../lib/supabase.js'

// Estado ao vivo do chefão (barra de vida, dano por unidade, meu golpe...).
export async function chefaoEstado() {
  const { data, error } = await supabase.rpc('chefao_estado')
  if (error) throw new Error(error.message)
  return data
}

// Golpe especial (1x por hora, dano fixo — não gera ponto).
export async function chefaoGolpe() {
  const { data, error } = await supabase.rpc('chefao_golpe')
  if (error) throw new Error(error.message)
  return data
}

// Liderança configura/liga/desliga o chefão.
export async function chefaoConfig({ nome, emoji, vida, versiculo, inicio, ativo }) {
  const { data, error } = await supabase.rpc('chefao_config', {
    p_nome: nome, p_emoji: emoji, p_vida: vida,
    p_versiculo: versiculo || null, p_inicio: inicio || null, p_ativo: !!ativo,
  })
  if (error) throw new Error(error.message)
  return data
}
