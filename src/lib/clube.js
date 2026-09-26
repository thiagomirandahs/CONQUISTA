// Contexto do clube: quem a pessoa é EM CADA CLUBE (papel do vínculo, unidade, marca, recursos) e qual clube está em uso.
// Lógica pura (sem React, sem rede) usada pelo ClubeProvider e testada à parte.
//
// Por que existe: o app lia `profiles.papel` e `profiles.unidade_id` — coisas GLOBAIS da pessoa. No modelo multi-clube o papel e a unidade
// pertencem ao VÍNCULO (pessoa x clube). Toda tela passa a perguntar ao contexto ("qual o meu papel NESTE clube?").
import { MARCA_LEGADA, marcaDaResposta } from './marca.js'

export const PAPEIS = ['desbravador', 'conselheiro', 'instrutor', 'diretoria', 'tesoureiro', 'pais']

// Recursos do catálogo da plataforma (espelho de public.recursos_catalogo — um teste confere que os dois não se afastam).
// Só serve ao modo LEGADO (front publicado antes do SQL): com o SQL, o servidor manda o mapa efetivo de cada clube.
// `especialidades` é chave PRÓPRIA (fase 9, item 9) e nasce desligada: antes, as especialidades viviam atrás de `classes`, e um
// clube que ligava as Classes oficiais levava junto o catálogo de especialidades de TESTE para todas as crianças. Quem liga é
// só a plataforma, quando existir catálogo oficial; o padrão aqui fica `false` para o modo legado também não mostrar nada.
export const RECURSOS_PADRAO = Object.freeze({
  desafios: true, chefao: true, missoes: true, jogos: true, leilao: false, chat: true,
  biblia: true, bichinho: true, agenda: true, atividades: true, mural: true, mensalidades: true,
  classes: false, experiencias: false, especialidades: false, cantinho_unidade: true,
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
    // Capacidades (espelho das funções do banco, migration 210 — decisão do dono de 26/09):
    //   podeAdministrar     = pode_administrar_clube: aprovar cadastros/inscrições, equipe, papéis, senha, config, responsáveis
    //   podeAvaliar         = pode_avaliar_curriculo: Classes e Especialidades
    //   podeGerirAtividades = pode_gerir_atividades: desafios, missões, experiências
    //   podeGerir           = liderança (diretoria|instrutor): moderação, jogos, avisos, conteúdo
    podeGerir: inclui(['instrutor', 'diretoria'], papel),
    podeAdministrar: papel === 'diretoria',
    podeAvaliar: inclui(['instrutor', 'diretoria'], papel),
    podeGerirAtividades: inclui(['instrutor', 'diretoria'], papel),
    podeFinanceiro: inclui(['tesoureiro', 'diretoria'], papel),
    temGestao: inclui(['conselheiro', 'instrutor', 'diretoria', 'tesoureiro'], papel),   // vê a aba Gestão
    ehMembroAtivo: inclui(['desbravador', 'conselheiro'], papel),               // quem joga/conversa como membro da unidade
    ehLiderancaChat: inclui(['instrutor', 'diretoria', 'tesoureiro'], papel),
  })
}

// Para onde a pessoa vai ao entrar: o responsável só tem o portal do filho; os demais, o ranking.
// Fase 7: quem não é responsável entra no INÍCIO contextual, não mais num placar.
export function rotaInicial(papel) { return papel === 'pais' ? '/meu-filho' : '/inicio' }
export const CAMINHOS_DO_RESPONSAVEL = ['/meu-filho', '/perfil', '/eu']

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
//
// Devolve { clubeId, situacao }, e a `situacao` é a parte que importa:
//
//   'resolvido'       — há um clube em uso. `clubeId` preenchido.
//   'precisa_escolher' — a pessoa TINHA um clube escolhido, ele deixou de valer (foi suspensa,
//                        removida, o clube saiu do ar) e existe outro vínculo utilizável.
//                        `clubeId` é null: a escolha é dela, não nossa.
//   'sem_vinculo'     — nenhum vínculo utilizável. `clubeId` é null.
//
// POR QUE ESTA FUNÇÃO DEIXOU DE DEVOLVER SÓ UM ID (fase 8.5, item 3):
//
// A versão anterior terminava em `return usaveis[0].clubeId` — se o clube guardado não estivesse
// mais na lista, ela pegava OUTRO e não contava a ninguém. Para quem tem um clube só isso nunca
// acontecia. Para quem tem dois, o dia em que a diretoria de um deles encerrasse o vínculo, a
// pessoa recarregava e simplesmente aparecia dentro do outro clube — mesma sessão, mesma tela,
// outro clube, sem um aviso.
//
// Isso é fallback silencioso de segurança: o app decide sozinho, em nome de quem perdeu acesso,
// em qual outro lugar colocá-la. A decisão é dela, e ela precisa saber que algo mudou.
//
// Escolher o primeiro continua certo em DOIS casos, e só neles: quando não havia escolha guardada
// (primeiro acesso — não há nada a perder nem a avisar) e quando o clube guardado continua valendo.
export function resolverClubeDaAba({ vinculos, servidorClubeId, preferidoId }) {
  const usaveis = (vinculos || []).filter((v) => v.status === 'ativo' && v.selecionavel)
  if (usaveis.length === 0) return { clubeId: null, situacao: 'sem_vinculo' }
  if (preferidoId && usaveis.some((v) => v.clubeId === preferidoId)) {
    return { clubeId: preferidoId, situacao: 'resolvido' }
  }
  // Havia uma escolha e ela não vale mais: pára aqui. Não importa que exista um "próximo".
  if (preferidoId) return { clubeId: null, situacao: 'precisa_escolher' }
  if (servidorClubeId && usaveis.some((v) => v.clubeId === servidorClubeId)) {
    return { clubeId: servidorClubeId, situacao: 'resolvido' }
  }
  return { clubeId: usaveis[0].clubeId, situacao: 'resolvido' }
}

// Forma antiga, só o id. Mantida porque several telas/testes só querem saber "qual clube".
// Repare que ela devolve null tanto para 'sem_vinculo' quanto para 'precisa_escolher' — quem
// precisa distinguir os dois usa `resolverClubeDaAba`.
export function escolherClubeAtual(args) {
  return resolverClubeDaAba(args).clubeId
}

// O clube que o SERVIDOR usa quando a requisição chega sem o header x-clube-atual — que é sempre o
// caso do websocket do Realtime (o header só vai no fetch; ver lib/supabase.js). Sem header,
// clube_atual_id() cai no vínculo ATIVO mais antigo da pessoa (starts_at, created_at, id), e a RLS
// do tempo real filtra por esse clube. Quem pergunta isto quer saber: "o tempo real vai chegar na
// aba deste clube?".
//
// O front só consegue AFIRMAR a resposta quando a pessoa tem UM clube utilizável — aí não existe
// outro para o servidor escolher. Com dois ou mais, devolve null ("não sei"), por dois motivos:
//   * o `clube_atual_id` que vem em meu_contexto NÃO é esse padrão: a própria chamada de
//     meu_contexto leva o header da aba (desde a primeira carga, pela semente do aparelho), então
//     ele volta com o clube PEDIDO, não com o que valeria sem header;
//   * a lista de vínculos não traz as datas que decidem o desempate.
// "Não sei" deve ser tratado como "o tempo real pode não chegar" — errar para o lado seguro.
export function clubePadraoSemCabecalho(vinculos) {
  const usaveis = (vinculos || []).filter((v) => v.status === 'ativo' && v.selecionavel)
  return usaveis.length === 1 ? usaveis[0].clubeId : null
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

// ---- o clube DESTA ABA, e a semente para uma aba nova ----
//
// Dois storages, com papéis diferentes, e a distinção é o item 2 da fase 8.5:
//
//   sessionStorage (`cq.clube.aba.v1`)  — o clube DESTA ABA. sessionStorage é, por definição do
//     navegador, por aba: duas abas da mesma conta têm cópias independentes. Recarregar lê daqui,
//     então a aba volta no SEU clube, não no da aba vizinha.
//
//   localStorage (`cq.clube.v1`)        — a SEMENTE, e só isso: de onde uma aba RECÉM-ABERTA (que
//     ainda não tem nada em sessionStorage) começa. É o "meu clube de costume".
//
// Antes da 8.5 só existia o localStorage, e ele era lido a cada resolução. Consequência medida na
// fase 8.4, com duas abas abertas: trocar o clube na aba 2 reescrevia a preferência compartilhada,
// e um F5 na aba 1 a levava junto — apesar de a própria tela "Eu" prometer, por escrito, que "cada
// aba pode estar em um clube diferente".
//
// NADA DISTO É AUTORIZAÇÃO. É um pedido: vai no header `x-clube-atual`, e o servidor só honra
// depois de conferir o vínculo ativo (`clube_atual_id()`); um valor forjado aqui não abre nada,
// e desde a migration 63 um pedido que não vale deixa a requisição SEM clube, nunca em outro.
const CHAVE_SEMENTE = 'cq.clube.v1'
const CHAVE_ABA = 'cq.clube.aba.v1'

const leJson = (armazem, chave) => {
  try { return JSON.parse(armazem.getItem(chave) || 'null') } catch { return null }
}
const gravaJson = (armazem, chave, valor) => {
  try { armazem.setItem(chave, JSON.stringify(valor)) } catch { /* sem storage */ }
}
const apaga = (armazem, chave) => {
  try { armazem.removeItem(chave) } catch { /* sem storage */ }
}

// O clube desta aba; se a aba ainda não tem um, cai na semente. O `uid` casado em ambos impede que
// a escolha de uma pessoa vire a escolha da próxima que entrar no mesmo aparelho.
export function lerClubePreferido(uid) {
  if (!uid) return null
  const daAba = leJson(sessionStorage, CHAVE_ABA)
  if (daAba && daAba.uid === uid && daAba.clubeId) return daAba.clubeId
  const semente = leJson(localStorage, CHAVE_SEMENTE)
  return semente && semente.uid === uid ? semente.clubeId || null : null
}

// Grava nos dois: a aba passa a ter o seu, e a semente passa a ser este para a PRÓXIMA aba.
// Chamado tanto na troca explícita quanto quando a aba resolve seu clube na primeira carga — sem
// o segundo caso, uma aba que nunca trocou de clube continuaria sem registro próprio e seguiria a
// semente que outra aba reescreveu.
export function guardarClubePreferido(uid, clubeId) {
  if (!uid || !clubeId) return
  gravaJson(sessionStorage, CHAVE_ABA, { uid, clubeId })
  gravaJson(localStorage, CHAVE_SEMENTE, { uid, clubeId })
}

// Sair zera os dois. A aba não guarda mais clube nenhum, e o aparelho não guarda de quem saiu.
export function esquecerClubePreferido() {
  apaga(sessionStorage, CHAVE_ABA)
  apaga(localStorage, CHAVE_SEMENTE)
}
