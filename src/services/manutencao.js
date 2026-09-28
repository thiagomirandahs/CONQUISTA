// Modo manutenção (migration 400): leitura pública do estado e controle do admin da plataforma.
import { supabase } from '../lib/supabase.js'
import { normalizarEstado } from '../lib/manutencao.js'

// Uma linha fixa, sem parâmetro: barato para o 4G. anon também lê (a tela de login precisa saber).
export async function lerEstadoManutencao() {
  const { data, error } = await supabase.rpc('manutencao_estado')
  if (error) throw new Error(error.message)
  return normalizarEstado(data)
}

// Só o admin da plataforma (o servidor confere e audita).
export async function adminDefinirManutencao({ ativo, mensagem = null, avisoInicio = null, avisoMensagem = null }) {
  const { data, error } = await supabase.rpc('admin_manutencao_definir', {
    p_ativo: !!ativo,
    p_mensagem: mensagem || null,
    p_aviso_inicio: avisoInicio ? new Date(avisoInicio).toISOString() : null,
    p_aviso_mensagem: avisoMensagem || null,
  })
  if (error) throw new Error(error.message)
  return normalizarEstado(data)
}
