// Motor dos jogos de perguntas DBV: cliques reais, explicação depois da resposta, estrelas e fim da partida.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act, fireEvent } from '@testing-library/react'

vi.mock('../../../lib/juice.js', () => ({ acerto: vi.fn(), erro: vi.fn() }))
const { JogoQuizDbv, JogoVerdadeiroFalsoDbv, JogoQualClasseDbv, estrelasDe } = await import('./JogoPerguntasDbv.jsx')
const { perguntasQuiz } = await import('../conteudo/dbv.js')

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('estrelasDe', () => {
  it('todas certas = 3; 2/3 ou mais = 2; senão 1', () => {
    expect(estrelasDe(6, 6)).toBe(3)
    expect(estrelasDe(4, 6)).toBe(2)
    expect(estrelasDe(3, 6)).toBe(1)
    expect(estrelasDe(0, 6)).toBe(1)
    expect(estrelasDe(5, 7)).toBe(2)
    expect(estrelasDe(4, 7)).toBe(1)
  })
})

describe('Quiz DBV', () => {
  it('6 perguntas; errar mostra a certa e a explicação; termina com estrelas e não repete onTerminar', () => {
    const onTerminar = vi.fn()
    render(<JogoQuizDbv onTerminar={onTerminar} onCancelar={() => {}} />)
    expect(screen.getByText('Pergunta 1 de 6')).toBeInTheDocument()
    for (let i = 0; i < 6; i++) {
      const botoes = screen.getAllByRole('button').filter((b) => b.textContent !== 'Cancelar')
      expect(botoes).toHaveLength(4)
      fireEvent.click(botoes[0])
      // enquanto mostra o feedback, outro clique é ignorado
      fireEvent.click(screen.getAllByRole('button').filter((b) => b.textContent !== 'Cancelar')[1])
      expect(screen.getByRole('status')).toBeInTheDocument()
      act(() => { vi.advanceTimersByTime(1900) })
    }
    expect(onTerminar).toHaveBeenCalledTimes(1)
    expect([1, 2, 3]).toContain(onTerminar.mock.calls[0][0])
  })

  it('acertar todas dá 3 estrelas (acha a certa pelo banco)', () => {
    const banco = perguntasQuiz()
    const certaPor = new Map(banco.map((q) => [q.p, q.o[q.c]]))
    const onTerminar = vi.fn()
    render(<JogoQuizDbv onTerminar={onTerminar} onCancelar={() => {}} />)
    for (let i = 0; i < 6; i++) {
      // o enunciado é o <p> da pergunta; geradores sorteiam números falsos, então a chave pode variar só em V/F — aqui é o quiz
      const enunciado = [...document.querySelectorAll('p')].map((p) => p.textContent).find((t) => certaPor.has(t))
      expect(enunciado, `enunciado conhecido na rodada ${i}`).toBeTruthy()
      fireEvent.click(screen.getByRole('button', { name: certaPor.get(enunciado) }))
      act(() => { vi.advanceTimersByTime(1900) })
    }
    expect(onTerminar).toHaveBeenCalledWith(3)
  })

  it('Cancelar chama onCancelar e desmontar não dispara onTerminar', () => {
    const onCancelar = vi.fn(); const onTerminar = vi.fn()
    const { unmount } = render(<JogoQuizDbv onTerminar={onTerminar} onCancelar={onCancelar} />)
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(onCancelar).toHaveBeenCalled()
    fireEvent.click(screen.getAllByRole('button').filter((b) => b.textContent !== 'Cancelar')[0])
    unmount()
    act(() => { vi.advanceTimersByTime(5000) })
    expect(onTerminar).not.toHaveBeenCalled()
  })
})

describe('Verdadeiro ou Falso DBV e Qual é a Classe?', () => {
  it('V ou F: 7 rodadas, duas opções na ordem fixa Verdadeiro/Falso', () => {
    render(<JogoVerdadeiroFalsoDbv onTerminar={() => {}} onCancelar={() => {}} />)
    expect(screen.getByText('Pergunta 1 de 7')).toBeInTheDocument()
    const rot = screen.getAllByRole('button').map((b) => b.textContent).filter((t) => t !== 'Cancelar')
    expect(rot).toEqual(['Verdadeiro', 'Falso'])
  })
  it('Qual é a Classe?: 5 rodadas, 6 classes em ordem de idade', () => {
    render(<JogoQualClasseDbv onTerminar={() => {}} onCancelar={() => {}} />)
    expect(screen.getByText('Pergunta 1 de 5')).toBeInTheDocument()
    const rot = screen.getAllByRole('button').map((b) => b.textContent).filter((t) => t !== 'Cancelar')
    expect(rot).toEqual(['Amigo', 'Companheiro', 'Pesquisador', 'Pioneiro', 'Excursionista', 'Guia'])
  })
})
