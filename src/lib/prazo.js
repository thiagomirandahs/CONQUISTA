// Prazo REAL para chamadas de rede (fase 7 — travamento na abertura).
//
// Causa provada (auditoria de 30/09/2026, auth-js 2.108.2): a primeira tela do app depende de chamadas
// de rede em fila — renovar o token, ler o perfil, ler o clube — e NENHUMA tinha prazo. Uma chamada
// que erra já era tratada (tela "Tentar de novo"); uma chamada que PENDURA nunca erra, então a tela de
// abertura ficava para sempre. Aqui uma espera ilimitada vira um erro tratável.
//
// Regra de ouro: o prazo NÃO esconde o problema. Quem chama decide o que mostrar (aviso, tela de
// conexão, erro) e a chamada original continua viva — se responder depois, o app segue sozinho.

export const PRAZOS = Object.freeze({
  // depois disto sem resposta do login, a tela deixa de fingir que "está carregando" e explica
  sessaoMs: 6000,
  // cada tentativa de ler o perfil (são 2)
  perfilMs: 10000,
  // contexto do clube (RPC) — o ClubeGuard já sabe mostrar "Tentar de novo" quando isto rejeita
  contextoMs: 15000,
  // pedido de LOGIN (renovar o token): payload minúsculo, não há motivo para esperar mais que isto
  authMs: 12000,
  // pedidos comuns ao banco que não podem ficar pendurados para sempre
  pedidoMs: 25000,
  // depois de quanto tempo sem sair da abertura o texto "Conectando…" aparece (só informativo)
  avisoMs: 4000,
})

export class PrazoEsgotado extends Error {
  constructor(rotulo = 'chamada', ms = 0) {
    super(`Prazo esgotado (${rotulo}, ${ms} ms)`)
    this.name = 'PrazoEsgotado'
    this.rotulo = rotulo
    this.ms = ms
  }
}

export const esperar = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// Rejeita com PrazoEsgotado se a promessa não terminar a tempo. NÃO cancela a original: se ela
// terminar depois, o resultado é simplesmente ignorado por aqui (quem quiser aproveitá-lo guarda a
// promessa original — é o que o arranque faz).
export function comPrazo(promessa, ms, rotulo = 'chamada') {
  let timer
  const limite = new Promise((_, rejeitar) => { timer = setTimeout(() => rejeitar(new PrazoEsgotado(rotulo, ms)), ms) })
  return Promise.race([Promise.resolve(promessa), limite]).finally(() => clearTimeout(timer))
}

// Erro de TRANSPORTE (sem internet, resposta que não veio, prazo) — diferente de "o servidor respondeu
// que não" (permissão, linha inexistente). Só o primeiro tipo autoriza dizer "confira a internet".
const PADRAO_REDE = /failed to fetch|networkerror|network request failed|load failed|err_internet|err_network|err_connection|abort|timeout|timed out|prazo esgotado|fetch/i
export function ehErroDeRede(erro) {
  if (!erro) return false
  if (erro.name === 'PrazoEsgotado' || erro.name === 'AbortError' || erro.name === 'TimeoutError') return true
  if (erro.name === 'AuthRetryableFetchError') return true
  if (erro.status === 0) return true
  return PADRAO_REDE.test(String(erro.message || erro))
}
