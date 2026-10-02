// Serviço: aviso institucional (migration 536) — coordenação -> liderança dos clubes da área; plataforma -> todos os clubes.
import { supabase } from '../lib/supabase.js'

/** Quantos clubes um envio alcançaria e se a pessoa PODE enviar (não grava nada). { pode, clubes, origem, plataforma } */
export async function alcanceAvisoInstitucional(plataforma = false) {
  const { data, error } = await supabase.rpc('aviso_institucional_alcance', { p_plataforma: !!plataforma })
  if (error) throw new Error(error.message)
  return data || { pode: false, clubes: 0 }
}

/** Envia o aviso. Devolve { ok, clubes, falhas, mensagem } (ok:false + motivo 'limite' quando passou do limite do dia). */
export async function enviarAvisoInstitucional({ titulo, corpo, destino = 'lideranca', plataforma = false }) {
  const { data, error } = await supabase.rpc('aviso_institucional_enviar', {
    p_titulo: titulo, p_corpo: corpo || null, p_destino: destino, p_plataforma: !!plataforma,
  })
  if (error) throw new Error(error.message)
  return data
}
