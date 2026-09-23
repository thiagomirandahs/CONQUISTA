import { createClient } from '@supabase/supabase-js'

// As chaves vêm do arquivo .env (criado com os dados do SEU projeto Supabase).
const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || !anonKey) {
  console.warn('⚠️ Supabase ainda não configurado: crie o arquivo .env com VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY')
}

// Clube em uso NESTA ABA (memória do módulo — nunca localStorage/sessionStorage): cada aba tem a
// sua própria cópia deste módulo, então duas abas da MESMA conta podem estar em clubes diferentes
// sem uma pisar na outra. O servidor NUNCA confia cegamente nisso (clube_atual_id() só honra se
// bater com um vínculo ativo de verdade) — é só o pedido explícito de "em qual clube agir agora".
let clubeAtivoDaAba = null
export function definirClubeAtivoNoTransporte(clubeId) {
  clubeAtivoDaAba = clubeId && clubeId !== 'legado' ? clubeId : null
}

// ESCOPO institucional em uso NESTA ABA (distrito/região/campo/união/divisão) — header próprio, mesma
// mecânica e mesmas garantias do clube: cada aba tem a sua cópia, e o servidor (escopo_atual_id()) só
// honra se bater com um vínculo ativo numa unidade NÃO-clube. As duas jornadas convivem: a mesma
// requisição pode levar clube E escopo sem uma virar a outra.
let escopoAtivoDaAba = null
export function definirEscopoAtivoNoTransporte(escopoId) {
  escopoAtivoDaAba = escopoId || null
}

function fetchComClubeAtivo(input, init) {
  const opcoes = { ...(init || {}) }
  const cabecalhos = new Headers(opcoes.headers || (input && typeof input !== 'string' ? input.headers : undefined))
  if (clubeAtivoDaAba) cabecalhos.set('x-clube-atual', clubeAtivoDaAba)
  if (escopoAtivoDaAba) cabecalhos.set('x-escopo-atual', escopoAtivoDaAba)
  opcoes.headers = cabecalhos
  return fetch(input, opcoes)
}

export const supabase = createClient(url || 'http://localhost', anonKey || 'placeholder', {
  global: { fetch: fetchComClubeAtivo },
})
