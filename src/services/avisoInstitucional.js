// Serviço: aviso institucional (migrations 536/554) — coordenação -> liderança dos clubes da área; plataforma -> todos os clubes.
// Desde a 554 dá para ESCOLHER os destinatários (clubes e/ou região, distrito…); o servidor recorta pela área de quem envia.
import { supabase } from '../lib/supabase.js'

/** Quantos clubes um envio alcançaria e se a pessoa PODE enviar (não grava nada). { pode, clubes, origem, plataforma } */
export async function alcanceAvisoInstitucional(plataforma = false, alvos = null) {
  const { data, error } = await supabase.rpc('aviso_institucional_alcance', { p_plataforma: !!plataforma, p_alvos: alvos?.length ? alvos : null })
  if (error) throw new Error(error.message)
  return data || { pode: false, clubes: 0 }
}

/** A árvore da área (unidades + clubes ativos) para escolher. { pode, origem, raiz, unidades: [{ id, nome, tipo, pai, clubes }] } */
export async function destinosAvisoInstitucional(plataforma = false) {
  const { data, error } = await supabase.rpc('aviso_institucional_destinos', { p_plataforma: !!plataforma })
  if (error) throw new Error(error.message)
  return data || { pode: false, unidades: [] }
}

/** Envia o aviso. Devolve { ok, clubes, falhas, mensagem } (ok:false + motivo 'limite' quando passou do limite do dia). */
export async function enviarAvisoInstitucional({ titulo, corpo, destino = 'lideranca', plataforma = false, alvos = null }) {
  const { data, error } = await supabase.rpc('aviso_institucional_enviar', {
    p_titulo: titulo, p_corpo: corpo || null, p_destino: destino, p_plataforma: !!plataforma, p_alvos: alvos?.length ? alvos : null,
  })
  if (error) throw new Error(error.message)
  return data
}

// Quantos clubes a escolha alcança (local, para mostrar na hora): um clube conta se ele OU alguma unidade acima dele foi marcada.
export function clubesDaEscolha(unidades, marcados) {
  const pai = new Map((unidades || []).map((u) => [u.id, u.pai]))
  const sel = new Set(marcados || [])
  return (unidades || []).filter((u) => u.tipo === 'clube').filter((c) => {
    for (let x = c.id, guarda = 0; x && guarda < 20; x = pai.get(x), guarda++) if (sel.has(x)) return true
    return false
  }).length
}
