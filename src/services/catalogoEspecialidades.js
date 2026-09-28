// Catálogo de ESPECIALIDADES e MESTRADOS (migration 460) — só leitura, global, uma vez por sessão.
// Não é o módulo de Especialidades (specialties/…, recurso 'especialidades'): é a lista de referência
// que a criança e a liderança consultam; os requisitos abrem na página de origem (MDA Wiki).
import { supabase } from '../lib/supabase.js'

let emCache = null
export function catalogoEspecialidades() {
  if (!emCache) {
    emCache = supabase.rpc('catalogo_especialidades').then(({ data, error }) => {
      if (error) throw new Error(error.message)
      return data || { especialidades: [], mestrados: [] }
    }).catch((e) => { emCache = null; throw e })
  }
  return emCache
}
