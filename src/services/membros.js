// Serviço: membros do CLUBE DA ABA — a única fonte de "quem está neste clube" do front.
//
// Por que existe: profiles é a única tabela de pessoas cuja RLS é por PESSOA (enxerga quem divide
// QUALQUER clube com você), e as colunas profiles.papel/status/unidade_id são um ESPELHO do clube
// primário da pessoa. Toda lista montada a partir delas errava de dois jeitos ao mesmo tempo quando
// alguém está em dois clubes: trazia gente do OUTRO clube, e classificava cada um pelo papel/unidade
// do clube primário. A criança desbravadora em A (unidade UA) e em B (unidade UB) sumia da chamada
// da UB, não contava na média da UB e aparecia "sem unidade" no ranking de B.
//
// A RPC membros_do_clube lê organization_memberships do clube da aba (clube_atual_id(), o mesmo
// header x-clube-atual que o resto do app usa) e devolve papel, unidade_id e status DO VÍNCULO
// naquele clube. O servidor exige que quem chama tenha vínculo ativo lá; pedir status além de
// 'ativo' é só para quem gere o clube ou cuida do financeiro.
import { supabase } from '../lib/supabase.js'

// Quem pertence a uma unidade e entra em mensalidade, chat de colegas e "faltam entregar".
export const PAPEIS_DE_UNIDADE = ['desbravador', 'conselheiro']

// Chama a RPC só com os parâmetros que a tela pediu: o que fica de fora usa o padrão do servidor
// (todos os papéis menos 'pais'; só vínculo 'ativo'). Mandar null explícito trocaria o padrão.
export async function membrosDoClube({ papeis, unidadeId, status, busca } = {}) {
  const args = {}
  if (papeis && papeis.length) args.p_papeis = papeis
  if (unidadeId) args.p_unidade_id = unidadeId
  if (status && status.length) args.p_status = status
  const termo = (busca || '').trim()
  if (termo) args.p_busca = termo
  const { data, error } = await supabase.rpc('membros_do_clube', args)
  if (error) throw new Error(error.message)
  return data || []
}

// Lista da CHAMADA de uma unidade (Apontamentos). A unidade é a do VÍNCULO no clube da aba, então
// quem está em dois clubes aparece na unidade certa de cada um.
//  * liderança (instrutor/diretoria): todo mundo da unidade, menos 'pais' — inclusive líderes
//    realocados lá (decisão do dono, 24/07: a liderança também pontua nos apontamentos);
//  * conselheiro: só desbravadores (o banco não o deixaria pontuar conselheiros nem líderes).
// Conta de teste fica fora (não pontua nem aparece no ranking). A ordem é a de sempre: por papel
// (decrescente, o que põe os desbravadores antes dos conselheiros) e depois por nome.
export async function chamadaDaUnidade(unidadeId, { soDesbravadores = false } = {}) {
  if (!unidadeId) return []
  const lista = await membrosDoClube({ unidadeId, papeis: soDesbravadores ? ['desbravador'] : undefined })
  return lista
    .filter((p) => !p.teste && p.unidade_id === unidadeId)
    .sort((a, b) => (b.papel || '').localeCompare(a.papel || '') || (a.nome || '').localeCompare(b.nome || '', 'pt-BR'))
}
