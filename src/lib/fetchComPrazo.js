// fetch com prazo para o cliente do Supabase (fase 7 — travamento na abertura).
//
// Um pedido de dados ou de login que nunca responde deixa QUALQUER tela esperando para sempre — e, como
// todo pedido passa pelo login para pegar o token, um único pedido de renovação pendurado segura o app
// inteiro. Aqui os pedidos comuns ganham prazo (aborta e devolve erro de rede tratável).
//
// FICAM DE FORA, de propósito: Storage (upload de foto/PDF pode demorar mesmo), Edge Functions (gerar
// documento) e qualquer coisa que não seja /auth/v1/ ou /rest/v1/.
import { PRAZOS } from './prazo.js'

const COM_PRAZO = /\/(auth|rest)\/v1\//
const DO_LOGIN = /\/auth\/v1\//

export function precisaDePrazo(url) {
  return COM_PRAZO.test(String(url))
}

// `ms` força um prazo único (testes); sem ele, login = PRAZOS.authMs e dados = PRAZOS.pedidoMs.
export function criarFetchComPrazo(fetchBase, { ms } = {}) {
  return function fetchComPrazo(input, init) {
    const url = typeof input === 'string' ? input : input?.url
    if (!precisaDePrazo(url)) return fetchBase(input, init)
    const prazo = ms ?? (DO_LOGIN.test(String(url)) ? PRAZOS.authMs : PRAZOS.pedidoMs)
    const controle = new AbortController()
    // respeita um cancelamento que o chamador já tenha pedido
    const dele = init?.signal
    if (dele) {
      if (dele.aborted) controle.abort(dele.reason)
      else dele.addEventListener('abort', () => controle.abort(dele.reason), { once: true })
    }
    const timer = setTimeout(() => {
      const erro = new Error(`Prazo esgotado (${prazo} ms)`)
      erro.name = 'TimeoutError'
      controle.abort(erro)
    }, prazo)
    return fetchBase(input, { ...(init || {}), signal: controle.signal }).finally(() => clearTimeout(timer))
  }
}
