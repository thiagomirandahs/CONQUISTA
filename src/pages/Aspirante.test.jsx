// Trilha do Aspirante: lista, lição, mini-quiz com cliques reais, progresso guardado e checklist do lenço.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { LICOES, BANCO, acharPergunta, REQUISITOS_LENCO } from '../features/aspirante/licoes.js'
import { lerProgresso, registrarNota, licaoConcluida, alternarLenco } from '../features/aspirante/progresso.js'

vi.mock('../context/Auth.jsx', () => ({ useAuth: () => ({ profile: { id: 'u-asp' } }) }))
const { default: Aspirante } = await import('./Aspirante.jsx')

beforeEach(() => localStorage.clear())

describe('conteúdo', () => {
  it('toda lição tem pelo menos 3 perguntas achadas (e cada trecho acha UMA só)', () => {
    for (const l of LICOES) {
      for (const t of l.quiz) expect(acharPergunta(t), `${l.id}: "${t}"`).not.toBeNull()
      expect(l.quiz.map(acharPergunta).filter(Boolean).length, l.id).toBeGreaterThanOrEqual(3)
    }
    expect(BANCO.length).toBeGreaterThan(50)
  })
  it('são 10 lições e 10 requisitos do lenço', () => {
    expect(LICOES).toHaveLength(10)
    expect(new Set(LICOES.map((l) => l.id)).size).toBe(10)
    expect(REQUISITOS_LENCO).toHaveLength(10)
  })
})

describe('progresso', () => {
  it('guarda a melhor nota e nunca piora; storage quebrado vira vazio', () => {
    let p = lerProgresso('x')
    p = registrarNota(p, 'hino', 3); p = registrarNota(p, 'hino', 1)
    expect(p.licoes.hino).toBe(3)
    expect(licaoConcluida(p, 'hino', 2)).toBe(true)
    expect(licaoConcluida(p, 'emblema', 2)).toBe(false)
    expect(alternarLenco(alternarLenco(p, 2), 2).lenco).toEqual({})
    localStorage.setItem('dbv:aspirante:y', '{lixo')
    expect(lerProgresso('y')).toEqual({ licoes: {}, lenco: {} })
  })
})

describe('tela', () => {
  const abrir = () => render(<MemoryRouter><Aspirante /></MemoryRouter>)

  it('lista as 10 lições, abre uma, faz o quiz certo e conclui (progresso salvo)', async () => {
    const u = userEvent.setup()
    abrir()
    expect(screen.getByText('0 de 10 lições concluídas')).toBeInTheDocument()
    await u.click(screen.getByRole('button', { name: /1\. Bem-vindo ao clube/ }))
    await u.click(screen.getByRole('button', { name: 'Fazer o mini-quiz' }))
    const l = LICOES[0]
    const certas = new Map(l.quiz.map(acharPergunta).filter(Boolean).map((h) => [h.q, h.certa]))
    for (let i = 0; i < 3; i++) {
      const enunciado = [...document.querySelectorAll('p')].map((p) => p.textContent).find((t) => certas.has(t))
      expect(enunciado).toBeTruthy()
      await u.click(screen.getByRole('button', { name: certas.get(enunciado) }))
      await u.click(screen.getByRole('button', { name: i === 2 ? 'Ver resultado' : 'Próxima' }))
    }
    expect(screen.getByText('Você acertou 3 de 3')).toBeInTheDocument()
    expect(screen.getByText(/Lição concluída/)).toBeInTheDocument()
    expect(lerProgresso('u-asp').licoes['bem-vindo']).toBe(3)
    await u.click(screen.getByRole('button', { name: 'Voltar à lista' }))
    expect(screen.getByText('1 de 10 lições concluídas')).toBeInTheDocument()
    expect(screen.getByText('Feita ✓')).toBeInTheDocument()
  })

  it('errar tudo não conclui e oferece reler', async () => {
    const u = userEvent.setup()
    abrir()
    await u.click(screen.getByRole('button', { name: /2\. O Voto e a Lei/ }))
    await u.click(screen.getByRole('button', { name: 'Fazer o mini-quiz' }))
    const certas = new Set(LICOES[1].quiz.map(acharPergunta).filter(Boolean).map((h) => h.certa))
    for (let i = 0; i < 3; i++) {
      const errada = screen.getAllByRole('button').find((b) => b.className.includes('rounded-xl') && !certas.has(b.textContent))
      await u.click(errada)
      await u.click(screen.getByRole('button', { name: i === 2 ? 'Ver resultado' : 'Próxima' }))
    }
    expect(screen.getByText(/Você acertou 0 de 3/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reler a lição' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Próxima lição' })).not.toBeInTheDocument()
    expect(licaoConcluida(lerProgresso('u-asp'), 'voto-lei', 2)).toBe(false)
  })

  it('checklist do lenço marca e persiste', async () => {
    const u = userEvent.setup()
    abrir()
    const caixa = screen.getByRole('checkbox', { name: /Saber de cor o Voto e a Lei/ })
    await u.click(caixa)
    expect(caixa).toBeChecked()
    expect(screen.getByText('1 de 10 requisitos')).toBeInTheDocument()
    expect(lerProgresso('u-asp').lenco[1]).toBe(true)
    within(document.body)
  })
})
