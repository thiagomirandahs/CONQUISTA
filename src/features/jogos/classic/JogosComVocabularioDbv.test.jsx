// Jogos antigos com o vocabulário DBV: ainda montam, e a Memória completa a partida com os pares sorteados do conjunto maior.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'

vi.mock('../../../lib/juice.js', () => ({ acerto: vi.fn(), erro: vi.fn() }))
vi.mock('../../../context/Auth.jsx', () => ({ useAuth: () => ({ profile: { id: 'u1' } }) }))
vi.mock('../../../services/dados.js', () => ({}), { virtual: true })
const { default: JogoMemoria } = await import('./JogoMemoria.jsx')
const { default: JogoCacaPalavras } = await import('./JogoCacaPalavras.jsx')
const { default: JogoMorse } = await import('./JogoMorse.jsx')
const { default: JogoForca } = await import('./JogoForca.jsx')
const { default: JogoAnagrama } = await import('./JogoAnagrama.jsx')
const { default: JogoTermo } = await import('./JogoTermo.jsx')
const { default: JogoProximo } = await import('./JogoProximo.jsx')
const { default: JogoMudou } = await import('./JogoMudou.jsx')

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('Memória com 12 símbolos (6 pares por partida)', () => {
  it('tem 12 cartas com 6 símbolos diferentes e a partida chega ao fim com estrelas', () => {
    const onTerminar = vi.fn()
    const { container } = render(<JogoMemoria onTerminar={onTerminar} onCancelar={() => {}} />)
    const cartas = () => [...container.querySelectorAll('button')].filter((b) => b.textContent !== 'Cancelar')
    expect(cartas()).toHaveLength(12)
    const lido = new Map() // índice -> emoji já visto
    const pass = () => act(() => { vi.advanceTimersByTime(1500) })
    const virar = (i) => { fireEvent.click(cartas()[i]); const e = cartas()[i].textContent; lido.set(i, e); return e }
    const feitos = new Set()
    for (let i = 0; i < 12 && onTerminar.mock.calls.length === 0; i++) {
      if (feitos.has(i)) continue
      const e = virar(i)
      const conhecido = [...lido].find(([k, v]) => k !== i && v === e && !feitos.has(k))
      if (conhecido) { virar(conhecido[0]); feitos.add(i); feitos.add(conhecido[0]); pass(); continue }
      const j = [...Array(12).keys()].find((k) => k !== i && !lido.has(k) && !feitos.has(k))
      const e2 = virar(j)
      if (e2 === e) { feitos.add(i); feitos.add(j) }
      pass()
    }
    pass(); pass()
    expect(new Set(lido.values()).size).toBeLessThanOrEqual(6)
    expect(onTerminar).toHaveBeenCalledTimes(1)
    expect([1, 2, 3]).toContain(onTerminar.mock.calls[0][0])
  })
  it('o conjunto sorteado muda entre partidas (12 símbolos no total)', () => {
    const vistos = new Set()
    for (let n = 0; n < 40; n++) {
      const { container, unmount } = render(<JogoMemoria onTerminar={() => {}} onCancelar={() => {}} />)
      const bs = [...container.querySelectorAll('button')].filter((b) => b.textContent !== 'Cancelar')
      bs.forEach((b) => { fireEvent.click(b); if (b.textContent !== '?') vistos.add(b.textContent) })
      act(() => { vi.advanceTimersByTime(2000) })
      unmount()
    }
    expect(vistos.size).toBeGreaterThan(6)
  })
})

describe('os demais montam sem quebrar', () => {
  it.each([
    ['Caça-palavras', JogoCacaPalavras], ['Morse', JogoMorse], ['Forca', JogoForca], ['Anagrama', JogoAnagrama],
    ['Termo', JogoTermo], ['Qual é o Próximo?', JogoProximo], ['O Que Mudou?', JogoMudou],
  ])('%s', (_, Jogo) => {
    for (let i = 0; i < 15; i++) {
      const { unmount } = render(<Jogo onTerminar={() => {}} onCancelar={() => {}} />)
      expect(screen.getAllByRole('button').length).toBeGreaterThan(0)
      unmount()
    }
  })
})
