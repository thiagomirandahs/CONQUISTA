// Prazo real para chamadas (fase 7 — travamento na abertura).
import { describe, it, expect, vi, afterEach } from 'vitest'
import { comPrazo, PrazoEsgotado, ehErroDeRede, PRAZOS } from './prazo.js'

afterEach(() => { vi.useRealTimers() })

describe('comPrazo', () => {
  it('resolve com o valor quando a chamada termina a tempo (e não deixa timer para trás)', async () => {
    vi.useFakeTimers()
    const p = comPrazo(Promise.resolve(42), 5000, 'x')
    await expect(p).resolves.toBe(42)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('propaga o erro da própria chamada (não o troca por prazo)', async () => {
    await expect(comPrazo(Promise.reject(new Error('boom')), 5000)).rejects.toThrow('boom')
  })

  it('chamada PENDURADA vira PrazoEsgotado — nunca espera para sempre', async () => {
    vi.useFakeTimers()
    const p = comPrazo(new Promise(() => {}), 5000, 'perfil')
    const capturado = p.catch((e) => e)
    await vi.advanceTimersByTimeAsync(5000)
    const erro = await capturado
    expect(erro).toBeInstanceOf(PrazoEsgotado)
    expect(erro.rotulo).toBe('perfil')
    expect(ehErroDeRede(erro)).toBe(true)
  })

  it('a chamada original continua viva: se responder depois, quem guardou a promessa aproveita', async () => {
    vi.useFakeTimers()
    let resolver
    const original = new Promise((r) => { resolver = r })
    const limitada = comPrazo(original, 1000).catch((e) => e)
    await vi.advanceTimersByTimeAsync(1000)
    expect(await limitada).toBeInstanceOf(PrazoEsgotado)
    resolver('chegou tarde')
    await expect(original).resolves.toBe('chegou tarde')
  })
})

describe('ehErroDeRede: transporte × "o servidor disse não"', () => {
  it.each([
    [new TypeError('Failed to fetch'), true],
    [{ message: 'TypeError: Failed to fetch', code: '' }, true],
    [{ name: 'AbortError', message: 'The operation was aborted' }, true],
    [{ name: 'TimeoutError' }, true],
    [{ name: 'AuthRetryableFetchError', message: '{}' }, true],
    [{ message: 'NetworkError when attempting to fetch resource.' }, true],
    [{ message: 'Load failed' }, true],
    [{ code: '42501', message: 'permission denied for table profiles' }, false],
    [{ code: 'PGRST301', message: 'JWT expired' }, false],
    [{ message: 'Sem permissão.' }, false],
    [null, false],
  ])('%j → %s', (erro, esperado) => {
    expect(ehErroDeRede(erro)).toBe(esperado)
  })
})

describe('PRAZOS', () => {
  it('a tela avisa antes de o prazo do login acabar, e o do clube é maior que o da sessão', () => {
    expect(PRAZOS.avisoMs).toBeLessThan(PRAZOS.sessaoMs)
    expect(PRAZOS.sessaoMs).toBeLessThan(PRAZOS.contextoMs)
  })
})
