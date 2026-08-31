// Serviço: atividades — extraído de lib/dados.js (verbatim, sem mudar queries/regras).
import { supabase } from '../lib/supabase.js'
import { hojeLocalISO } from '../lib/data.js'


// ------- Agenda do clube (eventos) — todos leem, liderança gerencia (RLS) -------
export async function carregarEventos({ futuros = true } = {}) {
  const hoje = hojeLocalISO()
  const ordenar = (q) => q.order('data').order('hora', { nullsFirst: true })
  if (!futuros) {
    const { data, error } = await ordenar(supabase.from('eventos').select('*'))
    if (error) throw new Error(error.message)
    return data || []
  }
  // futuros = eventos que ainda vêm OU que ainda estão ROLANDO (data_fim >= hoje)
  let { data, error } = await ordenar(
    supabase.from('eventos').select('*').or(`data.gte.${hoje},data_fim.gte.${hoje}`))
  // coluna data_fim ainda não existe? cai no filtro simples (só pela data de início)
  if (error && /data_fim/i.test(error.message || '')) {
    ;({ data, error } = await ordenar(supabase.from('eventos').select('*').gte('data', hoje)))
  }
  if (error) throw new Error(error.message)
  return data || []
}

export async function salvarEvento(dados, id) {
  const salvar = (d) => id
    ? supabase.from('eventos').update(d).eq('id', id).select('id')
    : supabase.from('eventos').insert(d).select('id')
  let resp = await salvar(dados)
  // coluna data_fim ainda não existe (SQL não rodou)? salva sem ela, não trava
  if (resp.error && /data_fim/i.test(resp.error.message || '')) {
    const semFim = { ...dados }; delete semFim.data_fim
    resp = await salvar(semFim)
  }
  if (resp.error) throw new Error(resp.error.message)
  if (!resp.data || resp.data.length === 0) throw new Error('Sem permissão (só liderança).')
}

export async function excluirEvento(id) {
  const { data, error } = await supabase.from('eventos').delete().eq('id', id).select('id')
  if (error) throw new Error(error.message)
  if (!data || data.length === 0) throw new Error('Sem permissão (só liderança).')
}
