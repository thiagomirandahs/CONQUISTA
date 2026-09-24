// Achado F-R4 da revisão da fase 9.1: o reforço do tempo real relia as 300 mensagens mais recentes
// a cada 15 s para TODO mundo — inclusive a criança de um clube só, cujo tempo real funciona. Agora:
//   * o relógio só existe quando o clube da aba pode não ser o do tempo real;
//   * ele para quando o tempo real prova que chega (entregou uma mensagem desta conversa);
//   * e pede só o que é novo. A mescla continua por id.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'

let clube
vi.mock('../context/Clube.jsx', () => ({ useClube: () => clube }))
vi.mock('../context/Auth.jsx', () => ({ useAuth: () => ({ profile: { id: 'eu' } }) }))
vi.mock('../components/Avatar.jsx', () => ({ default: () => null }))
vi.mock('../lib/juice.js', () => ({ acerto: () => {} }))

// o canal do tempo real: guarda o callback para o teste "entregar" uma mensagem
let aoInserir = null
vi.mock('../lib/supabase.js', () => {
  const canal = { on: (_t, _f, cb) => { aoInserir = cb; return canal }, subscribe: () => canal }
  return { supabase: { channel: () => canal, removeChannel: () => {}, from: () => { throw new Error('não deveria ler profiles') } } }
})

const carregarChatGeral = vi.fn()
const carregarMensagensDesde = vi.fn()
vi.mock('../lib/dados.js', async () => {
  const real = await vi.importActual('../services/chat.js')
  return {
    mesclarMensagens: real.mesclarMensagens,
    ultimoCarimbo: real.ultimoCarimbo,
    carregarChatGeral: (...a) => carregarChatGeral(...a),
    carregarMensagensDesde: (...a) => carregarMensagensDesde(...a),
    carregarChatUnidade: vi.fn(), carregarMinhasConversasDiretas: vi.fn(async () => []), carregarMensagensDireta: vi.fn(),
    listarColegasChat: vi.fn(async () => []), enviarMensagemUnidade: vi.fn(), enviarMensagemGeral: vi.fn(), enviarMensagemDireta: vi.fn(),
  }
})
const { default: Chat } = await import('./Chat.jsx')

const ANA = { id: 'u1', nome: 'Ana', foto: null }
const M1 = { id: 'm1', autor_id: 'u1', texto: 'primeira', created_at: '2026-09-24T12:00:00Z', apagada: false, autor: ANA }
const M2 = { id: 'm2', autor_id: 'u1', texto: 'segunda', created_at: '2026-09-24T12:00:20Z', apagada: false, autor: ANA }

let intervalos
beforeEach(() => {
  aoInserir = null
  carregarChatGeral.mockReset().mockResolvedValue({ conversaId: 'c1', mensagens: [M1] })
  carregarMensagensDesde.mockReset().mockResolvedValue([])
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })
  Element.prototype.scrollIntoView = () => {}   // o jsdom não tem; a tela rola para a última mensagem
  // captura o relógio do reforço em vez de esperar 15 s de verdade. O efeito é refeito quando a
  // conversa ganha id (null -> 'c1'), então conta só os relógios VIVOS (criados e não limpos).
  intervalos = new Map()
  let proximo = 1000
  const criar = window.setInterval
  const limpar = window.clearInterval
  vi.spyOn(window, 'setInterval').mockImplementation((fn, ms, ...resto) => {
    if (ms !== 15000) return criar(fn, ms, ...resto)
    const id = proximo++
    intervalos.set(id, fn)
    return id
  })
  vi.spyOn(window, 'clearInterval').mockImplementation((id) => (intervalos.has(id) ? intervalos.delete(id) : limpar(id)))
})
const vivos = () => [...intervalos.values()]
const tique = () => act(async () => { vivos().forEach((fn) => fn()) })
afterEach(() => { vi.restoreAllMocks() })

async function abrirChat() {
  render(<Chat />)
  await screen.findByText('primeira')
}

describe('Chat: reforço do tempo real', () => {
  it('clube de um só clube (o do tempo real): NENHUM relógio de 15 s', async () => {
    clube = { papel: 'desbravador', unidadeId: 'un1', clubeDaAbaEhOPadrao: true }
    await abrirChat()
    expect(vivos()).toHaveLength(0)
    expect(carregarMensagensDesde).not.toHaveBeenCalled()
  })

  it('ao voltar para o app a leitura é COMPLETA (o websocket dorme em segundo plano; e pega mensagem apagada)', async () => {
    clube = { papel: 'desbravador', unidadeId: 'un1', clubeDaAbaEhOPadrao: true }
    await abrirChat()
    await act(async () => { window.dispatchEvent(new Event('focus')) })
    expect(carregarMensagensDesde).toHaveBeenCalledWith('c1', null, expect.any(Object))
  })

  it('clube que pode não ser o do tempo real: o relógio relê SÓ o que é novo e mescla por id', async () => {
    clube = { papel: 'desbravador', unidadeId: 'un1', clubeDaAbaEhOPadrao: false }
    await abrirChat()
    expect(vivos()).toHaveLength(1)
    // o servidor devolve a repetida (folga) e a nova: a tela fica com as duas, sem duplicar
    carregarMensagensDesde.mockResolvedValueOnce([M1, M2])
    await tique()
    expect(carregarMensagensDesde).toHaveBeenCalledWith('c1', M1.created_at, expect.any(Object))
    expect(await screen.findByText('segunda')).toBeInTheDocument()
    expect(screen.getAllByText('primeira')).toHaveLength(1)
    // a próxima volta parte da última que a tela tem
    await tique()
    expect(carregarMensagensDesde).toHaveBeenLastCalledWith('c1', M2.created_at, expect.any(Object))
  })

  it('o tempo real entregou nesta conversa: o relógio para (ele chega nesta aba)', async () => {
    clube = { papel: 'desbravador', unidadeId: 'un1', clubeDaAbaEhOPadrao: false }
    await abrirChat()
    await act(async () => { await aoInserir({ new: { ...M2, autor: undefined } }) })
    expect(await screen.findByText('segunda')).toBeInTheDocument()
    await tique()
    expect(carregarMensagensDesde).not.toHaveBeenCalled()
  })

  it('com a tela escondida o relógio não gasta dados', async () => {
    clube = { papel: 'desbravador', unidadeId: 'un1', clubeDaAbaEhOPadrao: false }
    await abrirChat()
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })
    await tique()
    expect(carregarMensagensDesde).not.toHaveBeenCalled()
  })
})
