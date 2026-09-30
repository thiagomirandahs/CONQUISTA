// ARRANQUE do app (fase 7 — travamento na abertura). Causa provada na auditoria de 30/09/2026: a primeira
// tela dependia de chamadas de rede sem prazo (renovar o token, ler o perfil, ler o clube). Chamada que
// PENDURA nunca erra, então a abertura girava para sempre; e falha de rede com login guardado virava
// "sem sessão" (tela de login) depois de ~25 s.
//
// Aqui roda o AuthProvider de verdade, com a biblioteca REAL de login (auth-js) e o MESMO fetch com prazo
// de produção, contra uma rede simulada: sessão válida, expirada, sem internet, lenta e "sem resposta".
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act, cleanup } from '@testing-library/react'

vi.mock('../lib/pushNativo.js', () => ({ registrarPushNativo: () => {}, desassociarPushNativo: async () => {} }))
vi.mock('../lib/push.js', () => ({ sincronizarPush: async () => {}, desassociarPush: async () => {} }))
vi.mock('../lib/imagens.js', () => ({ definirUsuarioImagens: () => {} }))

// cliente REAL do Supabase + o fetch com prazo real, falando com `globalThis.__rede` (a rede de cada teste).
// O cliente é RECRIADO a cada teste (globalThis.__cliente): ele guarda estado (sessão em memória, relógio de
// renovação) e um teste não pode herdar o do vizinho.
vi.mock('../lib/supabase.js', async () => {
  const { createClient } = await import('@supabase/supabase-js')
  const { criarFetchComPrazo } = await import('../lib/fetchComPrazo.js')
  const { CHAVE_DA_SESSAO } = await import('../lib/chaveDaSessao.js')
  const base = (url, init) => globalThis.__rede(String(url), init)
  globalThis.__criarCliente = () => createClient('https://x.supabase.co', 'anon', {
    auth: { storageKey: CHAVE_DA_SESSAO },
    global: { fetch: criarFetchComPrazo(base) },
  })
  const supabase = new Proxy({}, {
    get: (_, prop) => { const c = globalThis.__cliente; const v = c[prop]; return typeof v === 'function' ? v.bind(c) : v },
  })
  return { supabase }
})

const { AuthProvider, useAuth } = await import('./Auth.jsx')
const { CHAVE_DA_SESSAO } = await import('../lib/chaveDaSessao.js')
const { limparMarcas } = await import('../lib/arranque.js')

// jsdom não recarrega página: espiamos window.location.reload
let recarregou
const localizacaoOriginal = Object.getOwnPropertyDescriptor(window, 'location')
function espiarRecarga() {
  recarregou = vi.fn()
  Object.defineProperty(window, 'location', { configurable: true, value: { ...window.location, reload: recarregou } })
}

// ------------------------------------------------------------------ rede simulada
const b64 = (o) => btoa(JSON.stringify(o)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')
const jwt = (exp) => `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: 'u-1', role: 'authenticated', exp })}.assinatura`
const agora = () => Math.floor(Date.now() / 1000)
const USUARIO = { id: 'u-1', aud: 'authenticated', role: 'authenticated', email: 'x@y.z', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' }
const json = (corpo, status = 200) => new Response(JSON.stringify(corpo), { status, headers: { 'content-type': 'application/json' } })
const tokenOk = () => { const exp = agora() + 3600; return json({ access_token: jwt(exp), refresh_token: 'refresh-novo', token_type: 'bearer', expires_in: 3600, expires_at: exp, user: USUARIO }) }

// pendura, mas obedece ao cancelamento (como o fetch de verdade)
const pendurado = (init) => new Promise((_, rejeitar) => {
  init?.signal?.addEventListener('abort', () => rejeitar(init.signal.reason || new DOMException('aborted', 'AbortError')))
})

let chamadas
let modo // { token, perfil }: qualquer função (url, init) => Promise<Response> | nomes abaixo
const COMPORTAMENTOS = {
  ok: () => Promise.resolve(tokenOk()),
  offline: () => Promise.reject(new TypeError('Failed to fetch')),
  pendurado: (_url, init) => pendurado(init),
  invalido: () => Promise.resolve(json({ error: 'invalid_grant', error_description: 'Invalid Refresh Token' }, 400)),
  lento10s: () => new Promise((res) => setTimeout(() => res(tokenOk()), 10000)),
}
const PERFIS = {
  ok: () => Promise.resolve(json([{ id: 'u-1', nome: 'Ana' }])),
  vazio: () => Promise.resolve(json([])),
  pendurado: (_url, init) => pendurado(init),
}

function rede(url, init) {
  chamadas.push({ url, corpo: init?.body ? String(init.body) : '' })
  if (url.includes('/auth/v1/token')) { const f = typeof modo.token === 'function' ? modo.token : COMPORTAMENTOS[modo.token]; return f(url, init) }
  if (url.includes('/rpc/meu_perfil')) { const f = typeof modo.perfil === 'function' ? modo.perfil : PERFIS[modo.perfil]; return f(url, init) }
  if (url.includes('/rpc/registrar_erro')) return Promise.resolve(new Response(null, { status: 204 }))
  return Promise.resolve(json({}))
}

function guardarSessao(exp) {
  localStorage.setItem(CHAVE_DA_SESSAO, JSON.stringify({
    access_token: jwt(exp), refresh_token: 'refresh-antigo', token_type: 'bearer', expires_in: 3600, expires_at: exp, user: USUARIO,
  }))
}
const VALIDA = () => agora() + 3600
const EXPIRADA = () => agora() - 7200

// ------------------------------------------------------------------ tela de teste
function Sonda() {
  const a = useAuth()
  return (
    <div>
      <p data-testid="estado">{JSON.stringify({ carregando: a.carregando, sessao: !!a.session, problema: a.problema, perfil: a.profile?.nome ?? null, pronto: a.perfilPronto })}</p>
      <button onClick={a.tentarDeNovo}>tentar</button>
    </div>
  )
}
const estado = () => JSON.parse(screen.getByTestId('estado').textContent)
const avancar = (ms) => act(async () => { await vi.advanceTimersByTimeAsync(ms) })
const chamadasDeToken = () => chamadas.filter((c) => c.url.includes('/auth/v1/token')).length
const sessaoNoAparelho = () => localStorage.getItem(CHAVE_DA_SESSAO) !== null
async function abrir() {
  render(<AuthProvider><Sonda /></AuthProvider>)
  await avancar(0)
}
function comInternet(ligada) {
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => ligada })
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] })
  globalThis.__rede = rede
  globalThis.__cliente = globalThis.__criarCliente()
  chamadas = []
  modo = { token: 'ok', perfil: 'ok' }
  localStorage.clear()
  limparMarcas()
  sessionStorage.clear()
  espiarRecarga()
  comInternet(true)
})
afterEach(async () => {
  cleanup()
  try { await globalThis.__cliente.auth.stopAutoRefresh() } catch { /* ok */ }
  vi.useRealTimers()
  delete globalThis.__cliente
  delete globalThis.__rede
  delete navigator.onLine
  Object.defineProperty(window, 'location', localizacaoOriginal)
})

describe('abertura fria — o app NUNCA fica preso na abertura sem dizer o que acontece', () => {
  it('sessão VÁLIDA: abre na hora, sem pedir nada de renovação à rede', async () => {
    guardarSessao(VALIDA())
    await abrir()
    expect(estado()).toMatchObject({ carregando: false, sessao: true, perfil: 'Ana', problema: null })
    expect(chamadasDeToken()).toBe(0)
  })

  it('sessão EXPIRADA com rede boa: renova e abre', async () => {
    guardarSessao(EXPIRADA())
    await abrir()
    expect(estado()).toMatchObject({ carregando: false, sessao: true, perfil: 'Ana', problema: null })
    expect(chamadasDeToken()).toBe(1)
  })

  it('SEM sessão guardada: vai para o login na hora (carregando termina, sem aviso de rede)', async () => {
    await abrir()
    expect(estado()).toMatchObject({ carregando: false, sessao: false, problema: null })
    expect(chamadasDeToken()).toBe(0)
  })

  it('refresh token INVÁLIDO (o servidor disse não): login na hora — isto NÃO é problema de rede', async () => {
    guardarSessao(EXPIRADA())
    modo.token = 'invalido'
    await abrir()
    expect(estado()).toMatchObject({ carregando: false, sessao: false, problema: null })
  })

  it('perfil de "0 linhas" segue significando "sem perfil" (comportamento de sempre), sem tela de problema', async () => {
    guardarSessao(VALIDA())
    modo.perfil = 'vazio'
    await abrir()
    expect(estado()).toMatchObject({ carregando: false, sessao: true, perfil: null, pronto: true, problema: null })
  })
})

describe('SEM INTERNET com login guardado: preserva a sessão, avisa e continua quando a rede volta', () => {
  it('não desloga: depois de mais de 30 s offline o login CONTINUA guardado e a pessoa NÃO é mandada ao login', async () => {
    guardarSessao(EXPIRADA())
    modo.token = 'offline'
    await abrir()
    await avancar(6100)
    expect(estado()).toMatchObject({ carregando: true, sessao: false, problema: 'lento' })
    await avancar(30000)                                  // a biblioteca desiste da renovação (~25 s)
    expect(estado()).toMatchObject({ carregando: true, problema: 'erro' })  // continua na tela de conexão…
    expect(estado().sessao).toBe(false)                   // …sem virar "logado" com token vencido
    expect(sessaoNoAparelho()).toBe(true)                 // e o login segue guardado no aparelho
  })

  it('com o aparelho reportando "sem internet", a fase é sem_conexao', async () => {
    comInternet(false)
    guardarSessao(EXPIRADA())
    modo.token = 'offline'
    await abrir()
    await avancar(6100)
    expect(estado()).toMatchObject({ carregando: true, problema: 'sem_conexao' })
    expect(sessaoNoAparelho()).toBe(true)
  })

  // Achado da fase 7 (experimento com a biblioteca): depois de uma falha de rede na abertura o cliente de login
  // fica PRESO no erro — não tenta mais nada, nem com a internet de volta. Só uma instância nova recupera,
  // e o que recria a instância é recarregar a abertura (o login guardado continua no aparelho).
  it('"Tentar de novo" recarrega a abertura (repetir a chamada não adiantaria) e o login guardado abre o app', async () => {
    guardarSessao(EXPIRADA())
    modo.token = 'offline'
    await abrir()
    await avancar(35000)
    expect(estado().carregando).toBe(true)
    modo.token = 'ok'
    await act(async () => { screen.getByText('tentar').click() })
    expect(recarregou).toHaveBeenCalledTimes(1)
    expect(sessaoNoAparelho()).toBe(true)                 // nada foi apagado para recomeçar
    // …a página recarrega: instância NOVA do cliente, mesmo login guardado, rede de volta
    cleanup()
    globalThis.__cliente = globalThis.__criarCliente()
    await abrir()
    await avancar(500)
    expect(estado()).toMatchObject({ carregando: false, sessao: true, perfil: 'Ana', problema: null })
  })

  it('a internet volta (evento "online") → recomeça SOZINHO, sem toque, no máximo 1x a cada 20 s', async () => {
    guardarSessao(EXPIRADA())
    modo.token = 'offline'
    await abrir()
    await avancar(35000)
    expect(estado().carregando).toBe(true)
    await act(async () => { window.dispatchEvent(new Event('online')) })
    expect(recarregou).toHaveBeenCalledTimes(1)
    await avancar(4000)
    await act(async () => { window.dispatchEvent(new Event('online')) })   // 2º aviso logo depois: NÃO forma laço
    expect(recarregou).toHaveBeenCalledTimes(1)
  })

  it('o botão sempre funciona, mesmo logo depois de um recomeço automático', async () => {
    guardarSessao(EXPIRADA())
    modo.token = 'offline'
    await abrir()
    await avancar(35000)
    await act(async () => { window.dispatchEvent(new Event('online')) })
    expect(recarregou).toHaveBeenCalledTimes(1)
    await avancar(4000)
    await act(async () => { screen.getByText('tentar').click() })
    expect(recarregou).toHaveBeenCalledTimes(2)
  })
})

describe('REDE LENTA: a tela avisa e, quando a resposta chega, o app segue sozinho', () => {
  it('renovação demora 10 s: aos 6 s a abertura DIZ que está lenta; aos 10 s abre sem ninguém tocar', async () => {
    guardarSessao(EXPIRADA())
    modo.token = 'lento10s'
    await abrir()
    await avancar(5900)
    expect(estado()).toMatchObject({ carregando: true, problema: null })      // ainda dentro do prazo
    await avancar(300)
    expect(estado()).toMatchObject({ carregando: true, problema: 'lento' })   // passou do prazo: fala a verdade
    await avancar(4200)
    expect(estado()).toMatchObject({ carregando: false, sessao: true, perfil: 'Ana', problema: null })
  })
})

describe('CHAMADA SEM RESPOSTA (a que travava para sempre)', () => {
  it('renovação pendurada: aos 6 s a tela oferece ajuda; aos 12 s o pedido é abortado e o app se recupera quando a rede responde', async () => {
    guardarSessao(EXPIRADA())
    modo.token = 'pendurado'
    await abrir()
    await avancar(6100)
    expect(estado()).toMatchObject({ carregando: true, problema: 'lento' })   // NÃO fica "carregando" mudo
    modo.token = 'ok'                                                          // a rede volta a responder
    await avancar(6000)                                                        // o prazo (12 s) derruba o pedido pendurado
    await avancar(2000)                                                        // a biblioteca tenta de novo e agora dá certo
    expect(estado()).toMatchObject({ carregando: false, sessao: true, perfil: 'Ana', problema: null })
  })

  it('perfil pendurado: vira "erro" com Tentar de novo (NUNCA "sem perfil"); com a rede de volta, abre', async () => {
    guardarSessao(VALIDA())
    modo.perfil = 'pendurado'
    await abrir()
    await avancar(23000)                                                       // 2 tentativas de 10 s + espera
    expect(estado()).toMatchObject({ carregando: true, problema: 'erro', pronto: false, perfil: null })
    modo.perfil = 'ok'
    await act(async () => { screen.getByText('tentar').click() })
    await avancar(500)
    expect(estado()).toMatchObject({ carregando: false, sessao: true, perfil: 'Ana', problema: null })
  })
})

describe('TELEMETRIA de abertura lenta (sem dado pessoal)', () => {
  it('abertura lenta que se recupera registra a ETAPA e o tempo — e só isso', async () => {
    guardarSessao(EXPIRADA())
    modo.token = 'lento10s'
    await abrir()
    await avancar(11000)
    await avancar(500)
    expect(estado().carregando).toBe(false)
    const envio = chamadas.find((c) => c.url.includes('/rpc/registrar_erro'))
    expect(envio).toBeTruthy()
    const corpo = JSON.parse(envio.corpo)
    expect(corpo.p_origem).toBe('ui')
    expect(corpo.p_rota).toBe('/abertura')
    expect(corpo.p_codigo).toMatch(/^BOOT:(sessao|perfil):lento:(ate3s|ate8s|ate20s|mais20s)$/)
    const tudo = JSON.stringify(corpo)
    expect(tudo).not.toMatch(/x@y\.z/)              // e-mail da pessoa
    expect(tudo).not.toMatch(/u-1/)                 // id da pessoa
    expect(tudo).not.toMatch(/refresh-|eyJ/)        // token
    expect(localStorage.getItem('cq.boot.pend')).toBeNull() // enviado com sucesso: fila limpa
  })

  it('abertura rápida NÃO gera telemetria', async () => {
    guardarSessao(VALIDA())
    await abrir()
    expect(chamadas.some((c) => c.url.includes('/rpc/registrar_erro'))).toBe(false)
  })
})
