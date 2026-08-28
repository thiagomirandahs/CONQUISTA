// Serviço: biblia — extraído de lib/dados.js (verbatim, sem mudar queries/regras).
import { supabase } from '../lib/supabase.js'


// ------- Bíblia (leitor + pontos + link do Devocional) -------
export async function carregarLivrosBiblia() {
  const { data, error } = await supabase.from('biblia_livros').select('*').order('ordem')
  if (error) throw new Error(error.message)
  return data || []
}

export async function carregarCapituloBiblia(livroAbrev, capitulo) {
  const { data, error } = await supabase
    .from('biblia_versiculos')
    .select('versiculo,texto')
    .eq('livro_abrev', livroAbrev)
    .eq('capitulo', capitulo)
    .order('versiculo')
  if (error) throw new Error(error.message)
  return data || []
}

// Leitura em 2 passos (anti-atalho): abrir grava a hora no servidor;
// confirmar só pontua depois do tempo mínimo. Ver 2026-08-26-biblia-antifarm.sql.
export async function iniciarLeituraBiblia(livroAbrev, capitulo) {
  const { data, error } = await supabase.rpc('biblia_iniciar_leitura', {
    p_livro_abrev: livroAbrev, p_capitulo: capitulo,
  })
  if (error) throw new Error(error.message)
  return data
}

export async function confirmarLeituraBiblia(livroAbrev, capitulo) {
  const { data, error } = await supabase.rpc('biblia_confirmar_leitura', {
    p_livro_abrev: livroAbrev, p_capitulo: capitulo,
  })
  if (error) throw new Error(error.message)
  return data
}

export async function minhaLeituraBiblia() {
  const { data, error } = await supabase.rpc('minha_leitura_biblia')
  if (error) throw new Error(error.message)
  return data
}
