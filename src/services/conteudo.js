// Serviço: conteudo — extraído de lib/dados.js (verbatim, sem mudar queries/regras).
import { supabase } from '../lib/supabase.js'


// ------- Painel de conteúdo (versículos e desafios) — só liderança (RLS) -------
// O RLS "ler/gerir versiculos|desafios" já limita tudo a pode_gerir(); a criança
// nunca lê a tabela (a resposta certa continua secreta).
const TABELAS_CONTEUDO = ['versiculos', 'desafios']

function tabelaOk(tabela) {
  if (!TABELAS_CONTEUDO.includes(tabela)) throw new Error('Tabela inválida')
  return tabela
}

export async function carregarConteudo(tabela) {
  const { data, error } = await supabase.from(tabelaOk(tabela)).select('*').order('created_at')
  if (error) throw new Error(error.message)
  return data || []
}

export async function salvarConteudo(tabela, dados, id) {
  const t = tabelaOk(tabela)
  const resp = id
    ? await supabase.from(t).update(dados).eq('id', id).select('id')
    : await supabase.from(t).insert(dados).select('id')
  if (resp.error) throw new Error(resp.error.message)
  if (!resp.data || resp.data.length === 0) throw new Error('Sem permissão (só liderança).')
}

export async function excluirConteudo(tabela, id) {
  const { data, error } = await supabase.from(tabelaOk(tabela)).delete().eq('id', id).select('id')
  if (error) throw new Error(error.message)
  if (!data || data.length === 0) throw new Error('Sem permissão (só liderança).')
}
