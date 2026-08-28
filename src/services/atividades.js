// Serviço: atividades — extraído de lib/dados.js (verbatim, sem mudar queries/regras).
import { supabase } from '../lib/supabase.js'
import { hojeLocalISO } from '../lib/data.js'


// ------- Agenda do clube (eventos) — todos leem, liderança gerencia (RLS) -------
export async function carregarEventos({ futuros = true } = {}) {
  let q = supabase.from('eventos').select('*')
  if (futuros) q = q.gte('data', hojeLocalISO())
  const { data, error } = await q.order('data').order('hora', { nullsFirst: true })
  if (error) throw new Error(error.message)
  return data || []
}

export async function salvarEvento(dados, id) {
  const resp = id
    ? await supabase.from('eventos').update(dados).eq('id', id).select('id')
    : await supabase.from('eventos').insert(dados).select('id')
  if (resp.error) throw new Error(resp.error.message)
  if (!resp.data || resp.data.length === 0) throw new Error('Sem permissão (só liderança).')
}

export async function excluirEvento(id) {
  const { data, error } = await supabase.from('eventos').delete().eq('id', id).select('id')
  if (error) throw new Error(error.message)
  if (!data || data.length === 0) throw new Error('Sem permissão (só liderança).')
}
