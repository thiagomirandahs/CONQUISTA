import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  ORIGEM_YT, VELOCIDADES, urlDoPlayerComApi, montarComando, enviarComando, formatarTempo, tempoPorExtenso, valorFalado,
  criarAdaptador, limitarSalvamento, lerProgressoLocal, salvarProgressoLocal,
} from './youtube.js'

function iframeFalso() {
  const win = { postMessage: vi.fn() }
  return { contentWindow: win, win }
}
const msg = (iframe, data, origin = ORIGEM_YT, source) => ({ origin, source: source ?? iframe.contentWindow, data })

describe('youtube: URL e comandos', () => {
  it('monta a URL com a API por postMessage, só no youtube-nocookie', () => {
    const u = new URL(urlDoPlayerComApi('abcDEF12345', 'https://app.desbravaclube.com.br'))
    expect(u.origin).toBe(ORIGEM_YT)
    expect(u.pathname).toBe('/embed/abcDEF12345')
    expect(u.searchParams.get('enablejsapi')).toBe('1')
    expect(u.searchParams.get('origin')).toBe('https://app.desbravaclube.com.br')
    expect(u.searchParams.get('rel')).toBe('0')
    expect(u.searchParams.get('modestbranding')).toBe('1')
    expect(u.searchParams.get('playsinline')).toBe('1')
  })
  it('comando tem o formato do YouTube e vai só para a origem do YouTube', () => {
    expect(JSON.parse(montarComando('seekTo', [10, true]))).toEqual({ event: 'command', func: 'seekTo', args: [10, true] })
    const f = iframeFalso()
    expect(enviarComando(f, 'playVideo')).toBe(true)
    expect(f.win.postMessage).toHaveBeenCalledWith(montarComando('playVideo', []), ORIGEM_YT)
    expect(enviarComando(null, 'playVideo')).toBe(false)
  })
  it('velocidades', () => expect(VELOCIDADES).toEqual([0.75, 1, 1.25, 1.5, 2]))
})

describe('youtube: formatar tempo', () => {
  it('m:ss e h:mm:ss', () => {
    expect(formatarTempo(0)).toBe('0:00')
    expect(formatarTempo(65)).toBe('1:05')
    expect(formatarTempo(3723)).toBe('1:02:03')
    expect(formatarTempo(-5)).toBe('0:00')
    expect(formatarTempo(NaN)).toBe('0:00')
  })
  it('texto falado', () => {
    expect(tempoPorExtenso(80)).toBe('1 minuto e 20')
    expect(valorFalado(80, 2400)).toBe('1 minuto e 20 de 40 minutos')
  })
})

describe('youtube: adaptador', () => {
  let iframe, janela, ouvinte, cbs
  beforeEach(() => {
    vi.useFakeTimers()
    iframe = iframeFalso()
    janela = { addEventListener: vi.fn((t, f) => { ouvinte = f }), removeEventListener: vi.fn() }
    cbs = { aoPronto: vi.fn(), aoInfo: vi.fn(), aoTerminar: vi.fn() }
  })
  afterEach(() => vi.useRealTimers())

  it('faz o handshake periodicamente até o primeiro infoDelivery', () => {
    const a = criarAdaptador(iframe, { ...cbs, janela })
    a.iniciar()
    expect(iframe.win.postMessage).toHaveBeenCalledTimes(1)
    expect(JSON.parse(iframe.win.postMessage.mock.calls[0][0]).event).toBe('listening')
    vi.advanceTimersByTime(1000)
    expect(iframe.win.postMessage).toHaveBeenCalledTimes(3)
    ouvinte(msg(iframe, JSON.stringify({ event: 'infoDelivery', info: { currentTime: 1, duration: 100, playerState: 1 } })))
    vi.advanceTimersByTime(5000)
    expect(iframe.win.postMessage).toHaveBeenCalledTimes(3)
    expect(cbs.aoPronto).toHaveBeenCalledTimes(1)
    expect(cbs.aoInfo).toHaveBeenCalledWith(expect.objectContaining({ currentTime: 1, duration: 100, playerState: 1 }))
    a.parar()
    expect(janela.removeEventListener).toHaveBeenCalled()
  })

  it('ignora mensagem de origem errada ou que não vem do nosso iframe', () => {
    criarAdaptador(iframe, { ...cbs, janela }).iniciar()
    const info = JSON.stringify({ event: 'infoDelivery', info: { currentTime: 9, playerState: 0 } })
    ouvinte(msg(iframe, info, 'https://www.youtube.com'))
    ouvinte(msg(iframe, info, 'https://evil.example'))
    ouvinte(msg(iframe, info, ORIGEM_YT, { postMessage() {} }))
    ouvinte(msg(iframe, 'lixo que nao e json'))
    expect(cbs.aoInfo).not.toHaveBeenCalled()
    expect(cbs.aoTerminar).not.toHaveBeenCalled()
    expect(cbs.aoPronto).not.toHaveBeenCalled()
  })

  it('onReady avisa pronto; playerState 0 = terminou (uma vez só)', () => {
    criarAdaptador(iframe, { ...cbs, janela }).iniciar()
    ouvinte(msg(iframe, { event: 'onReady' }))
    expect(cbs.aoPronto).toHaveBeenCalledTimes(1)
    ouvinte(msg(iframe, { event: 'infoDelivery', info: { playerState: 0 } }))
    ouvinte(msg(iframe, { event: 'infoDelivery', info: { playerState: 0 } }))
    expect(cbs.aoTerminar).toHaveBeenCalledTimes(1)
    ouvinte(msg(iframe, { event: 'infoDelivery', info: { playerState: 1 } }))
    ouvinte(msg(iframe, { event: 'infoDelivery', info: { playerState: 0 } }))
    expect(cbs.aoTerminar).toHaveBeenCalledTimes(2)
  })

  it('comandos prontos: tocar, pausar, buscar, velocidade', () => {
    const a = criarAdaptador(iframe, { janela })
    a.tocar(); a.pausar(); a.buscar(42); a.velocidade(1.5)
    const funcs = iframe.win.postMessage.mock.calls.map((c) => JSON.parse(c[0]))
    expect(funcs.map((c) => c.func)).toEqual(['playVideo', 'pauseVideo', 'seekTo', 'setPlaybackRate'])
    expect(funcs[2].args).toEqual([42, true])
    expect(funcs[3].args).toEqual([1.5])
  })
})

describe('youtube: limitarSalvamento', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())
  it('salva no máximo a cada 15 s; agora() força e só o que está pendente', () => {
    vi.setSystemTime(1_000_000)
    const salvar = vi.fn()
    const f = limitarSalvamento(salvar)
    f({ p: 1 })                       // primeira vez salva
    vi.advanceTimersByTime(5000); f({ p: 2 })
    vi.advanceTimersByTime(5000); f({ p: 3 })
    expect(salvar).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(5000); f({ p: 4 })
    expect(salvar).toHaveBeenCalledTimes(2)
    expect(salvar).toHaveBeenLastCalledWith({ p: 4 })
    f({ p: 5 })
    f.agora()                         // ao pausar/sair: salva o pendente
    expect(salvar).toHaveBeenLastCalledWith({ p: 5 })
    f.agora()                         // nada pendente: não repete
    expect(salvar).toHaveBeenCalledTimes(3)
  })
})

describe('youtube: cópia local', () => {
  beforeEach(() => localStorage.clear())
  it('guarda por usuário + material', () => {
    salvarProgressoLocal('u1', 'm1', { capitulo: 4, posicao_seg: 1122, duracao_seg: 2000, concluido: false, ouvidos: [1, 2, 3] })
    expect(lerProgressoLocal('u1', 'm1')).toMatchObject({ capitulo: 4, posicao_seg: 1122, ouvidos: [1, 2, 3] })
    expect(lerProgressoLocal('u2', 'm1')).toBeNull()
  })
})
