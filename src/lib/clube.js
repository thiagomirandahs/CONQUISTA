// Contexto do clube: quem a pessoa é EM CADA CLUBE (papel do vínculo, unidade, marca, recursos) e qual clube está em uso.
// Lógica pura (sem React, sem rede) usada pelo ClubeProvider e testada à parte.
//
// Por que existe: o app lia `profiles.papel` e `profiles.unidade_id` — coisas GLOBAIS da pessoa. No modelo multi-clube o papel e a unidade
// pertencem ao VÍNCULO (pessoa x clube). Toda tela passa a perguntar ao contexto ("qual o meu papel NESTE clube?").
import { MARCA_LEGADA, marcaDaResposta } from './marca.js'

export const PAPEIS = ['desbravador', 'conselheiro', 'instrutor', 'diretoria', 'tesoureiro', 'pais']

// Recursos do catálogo da plataforma (espelho de public.recursos_catalogo — um teste confere que os dois não se afastam).
// Só serve ao modo LEGADO (front publicado antes do SQL): com o SQL, o servidor manda o mapa efetivo de cada clube.
export const RECURSOS_PADRAO = Object.freeze({
  desafios: true, chefao: true, missoes: true, jogos: true, leilao: false, chat: true,
  biblia: true, bichinho: true, agenda: true, atividades: true, mural: true, mensalidades: true,
})

const inclui = (lista, papel) => !!papel && lista.includes(papel)

// O que cada papel PODE FAZER no clube. É a fonte única dos grupos que as telas repetiam (`PODE_GERIR`, `FINANCEIRO`, ...).
// Segurança de verdade é o RLS/RPC no banco; isto é navegação e apresentação. Papel nulo (sem vínculo ativo) = nada (falha fechada).
export function permissoesDoPapel(papel) {
  return Object.freeze({
    papel: papel || null,
    ehPais: papel === 'pais',
    ehDiretoria: papel === 'diretoria',
    ehConselheiro: papel === 'conselheiro',
    ehDesbravador: papel === 'desbravador',
    podeGerir: inclui(['instrutor', 'diretoria'], papel),                       // aprovar, moderar, configurar o clube
    podeFinanceiro: inclui(['tesoureiro', 'diretoria'], papel),
    temGestao: inclui(['conselheiro', 'instrutor', 'diretoria', 'tesoureiro'], papel),   // vê a aba Gestão
    ehMembroAtivo: inclui(['desbravador', 'conselheiro'], papel),               // quem joga/conversa como membro da unidade
    ehLiderancaChat: inclui(['instrutor', 'diretoria', 'tesoureiro'], papel),
  })
}

// Para onde a pessoa vai ao entrar: o responsável só tem o portal do filho; os demais, o ranking.
export function rotaInicial(papel) { return papel === 'pais' ? '/meu-filho' : '/ranking' }
export const CAMINHOS_DO_RESPONSAVEL = ['/meu-filho', '/perfil']

// ---- normalização da resposta de `meu_contexto()` ----
export function normalizarVinculo(v) {
  const o = v && typeof v === 'object' ? v : {}
  return {
    clubeId: o.club_id ?? o.clubeId ?? null,
    nome: o.nome || '',
    slug: o.slug || null,
    timezone: o.timezone || null,
    papel: PAPEIS.includes(o.papel) ? o.papel : null,       // papel fora do vocabulário = sem papel (falha fechada)
    status: o.status || 'pendente',
    selecionavel: o.selecionavel === true,
    unidadeId: o.unidade_id ?? o.unidadeId ?? null,
    unidadeNome: o.unidade_nome ?? o.unidadeNome ?? null,
    marca: marcaDaResposta({ nome: o.nome, ...(o.marca || {}) }),
    recursos: Object.fromEntries(Object.entries(o.recursos && typeof o.recursos === 'object' ? o.recursos : {}).map(([k, val]) => [k, val === true])),
  }
}

export function normalizarContexto(raw) {
  const o = raw && typeof raw === 'object' ? raw : {}
  return {
    usuarioId: o.usuario_id ?? o.usuarioId ?? null,
    servidorClubeId: o.clube_atual_id ?? o.servidorClubeId ?? null,
    vinculos: (Array.isArray(o.vinculos) ? o.vinculos : []).map(normalizarVinculo).filter((v) => v.clubeId),
    legado: false,
  }
}

// Front publicado ANTES do SQL (o banco ainda não tem `meu_contexto`): monta o contexto do jeito antigo — o clube único, o papel e a
// unidade do perfil, e os recursos como o app sempre leu. O app segue igual para o Tenant 001; só não sabe de marca/recursos novos.
export function contextoLegado({ perfil, recursos }) {
  if (!perfil) return { usuarioId: null, servidorClubeId: null, vinculos: [], legado: true }
  const ativo = perfil.status === 'ativo'
  return {
    usuarioId: perfil.id ?? null,
    servidorClubeId: ativo ? 'legado' : null,
    legado: true,
    vinculos: [{
      clubeId: 'legado',
      nome: MARCA_LEGADA.nome,
      slug: null,
      timezone: null,
      papel: PAPEIS.includes(perfil.papel) ? perfil.papel : null,
      status: ativo ? 'ativo' : 'pendente',
      selecionavel: ativo,
      unidadeId: perfil.unidade_id ?? null,
      unidadeNome: null,
      marca: { ...MARCA_LEGADA },
      recursos: { ...RECURSOS_PADRAO, ...(recursos || {}) },
    }],
  }
}

// ---- qual clube está em uso ----
// Ordem: a escolha guardada da pessoa (se ainda vale) > o clube em que o SERVIDOR age > o 1º vínculo ativo selecionável.
// Só entra quem tem vínculo ATIVO e SELECIONÁVEL (o servidor só sabe agir em um clube por vez). Nada disso é "clube por padrão":
// sem vínculo utilizável => null.
export function escolherClubeAtual({ vinculos, servidorClubeId, preferidoId }) {
  const usaveis = (vinculos || []).filter((v) => v.status === 'ativo' && v.selecionavel)
  if (usaveis.length === 0) return null
  if (preferidoId && usaveis.some((v) => v.clubeId === preferidoId)) return preferidoId
  if (servidorClubeId && usaveis.some((v) => v.clubeId === servidorClubeId)) return servidorClubeId
  return usaveis[0].clubeId
}

// Pode trocar para este clube? Devolve { ok } ou { ok:false, motivo }:
//   sem_vinculo   — a pessoa NÃO tem vínculo com esse clube (nunca vira acesso);
//   vinculo_inativo — o vínculo existe mas está pendente/suspenso;
//   indisponivel  — o servidor não marcou esse vínculo como selecionável (não deveria acontecer
//                   pra um vínculo ativo e vigente — falha fechada se algum dia acontecer).
export function podeTrocarPara(vinculos, clubeId) {
  const v = (vinculos || []).find((x) => x.clubeId === clubeId)
  if (!v) return { ok: false, motivo: 'sem_vinculo' }
  if (v.status !== 'ativo') return { ok: false, motivo: 'vinculo_inativo' }
  if (!v.selecionavel) return { ok: false, motivo: 'indisponivel' }
  return { ok: true }
}

// ---- recursos ----
export function temRecursoNoVinculo(vinculo, chave) {
  return !!vinculo && vinculo.status === 'ativo' && vinculo.recursos?.[chave] === true
}

// ---- escolha guardada (por usuário) ----
const CHAVE_PREFERIDO = 'cq.clube.v1'
export function lerClubePreferido(uid) {
  try {
    const o = JSON.parse(localStorage.getItem(CHAVE_PREFERIDO) || 'null')
    return o && o.uid === uid ? o.clubeId || null : null
  } catch { return null }
}
export function guardarClubePreferido(uid, clubeId) {
  try { localStorage.setItem(CHAVE_PREFERIDO, JSON.stringify({ uid, clubeId })) } catch { /* sem storage */ }
}
export function esquecerClubePreferido() {
  try { localStorage.removeItem(CHAVE_PREFERIDO) } catch { /* sem storage */ }
}
