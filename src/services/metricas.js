// Leitura das métricas anônimas de uso (migration 545) — só administrador da plataforma.
import { supabase } from '../lib/supabase.js'

export async function metricasDeUso() {
  const { data, error } = await supabase.rpc('admin_metricas')
  if (error) throw new Error(error.message)
  return data
}
