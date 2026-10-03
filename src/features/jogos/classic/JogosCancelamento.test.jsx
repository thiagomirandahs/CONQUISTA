import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { StrictMode } from 'react'
import { useGameTimeout } from '../hooks/useGameTimeout.js'
import JogoForca from './JogoForca.jsx'
import JogoCampoMinado from './JogoCampoMinado.jsx'
import JogoContas from './JogoContas.jsx'
import JogoSequencia from './JogoSequencia.jsx'

vi.mock('../../../lib/juice.js', () => ({ acerto: vi.fn(), erro: vi.fn(), colisao: vi.fn() }))
vi.mock('../../../components/Ajuda.jsx', () => ({ PedirAjuda: () => null }))
vi.mock('../conteudo/vocabulario.js', () => ({ palavras: () => ['UNIDADE'] }))

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('Saída da partida cancela transições e resultados', () => {
  it('Forca não conclui depois de sair durante a comemoração', () => {
    const terminar = vi.fn()
    const { unmount } = render(<JogoForca onTerminar={terminar} onCancelar={() => {}} />)
    for (const l of new Set('UNIDADE')) fireEvent.click(screen.getByRole('button', { name: l, exact: true }))
    expect(screen.getByText('Você descobriu! 🎉')).toBeInTheDocument()
    unmount()
    act(() => vi.advanceTimersByTime(2000))
    expect(terminar).not.toHaveBeenCalled()
  })
  it('Conta Rápida não conclui depois de sair ao terminar o tempo', () => {
    const terminar = vi.fn()
    const { unmount } = render(<JogoContas onTerminar={terminar} onCancelar={() => {}} />)
    for (let i = 0; i < 30; i++) act(() => vi.advanceTimersByTime(1000))
    expect(screen.getByText(/Tempo! Você acertou/)).toBeInTheDocument()
    unmount()
    act(() => vi.advanceTimersByTime(1000))
    expect(terminar).not.toHaveBeenCalled()
  })
  it('Sequência interrompe os flashes pendentes ao desmontar', () => {
    const { unmount } = render(<JogoSequencia onTerminar={() => {}} onCancelar={() => {}} />)
    act(() => vi.advanceTimersByTime(600))
    unmount()
    expect(vi.getTimerCount()).toBe(0)
  })
  it('agendador funciona com remontagem de efeitos do StrictMode e cancela timers encadeados', () => {
    const terminou = vi.fn()
    function Partida() {
      const agendar = useGameTimeout()
      return <button onClick={() => agendar(() => agendar(terminou, 100), 100)}>Começar</button>
    }
    const { unmount } = render(<StrictMode><Partida /></StrictMode>)
    fireEvent.click(screen.getByText('Começar'))
    act(() => vi.advanceTimersByTime(100))
    unmount()
    act(() => vi.advanceTimersByTime(1000))
    expect(terminou).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('Campo Minado', () => {
  it('a abertura em cascata respeita uma casa marcada com bandeira', () => {
    const { container } = render(<JogoCampoMinado onTerminar={() => {}} onCancelar={() => {}} />)
    const cells = [...container.querySelectorAll('button.alvo-livre')]
    fireEvent.click(screen.getByRole('button', { name: /Marcar/ }))
    fireEvent.click(cells[1])
    fireEvent.click(screen.getByRole('button', { name: /Cavar/ }))
    fireEvent.click(cells[0])
    expect(cells[1]).toHaveTextContent('🚩')
    expect(cells[0]).not.toHaveTextContent(/💣|💥/)
  })
})
