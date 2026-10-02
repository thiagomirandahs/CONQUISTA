// Regressão (telemetria de 02/10/2026): o jogo chamava onTerminar mais de uma vez (toques repetidos em
// "Concluir", evento de fim em duplicidade). Só o 1º registro vale; as cópias viravam um falso
// "erro" (avisar.erro) na tela da criança — 9 de 9 erros 'ui' de /trilha vieram logo após um registro ok.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'

const d = {
  carregarTrilha: vi.fn(async () => ({ feito: false, passos: 0, hoje: [] })), registrarJogo: vi.fn(),
  carregarRankingTrilha: vi.fn(async () => []), carregarJogosTrilha: vi.fn(async () => [{ chave: 'teste', ativo: true }]),
  lerJogoDaSemana: vi.fn(async () => null), ajudasRecebidas: vi.fn(async () => []), bonusTodosJogos: vi.fn(async () => ({})),
  statusJogosDoDia: vi.fn(async () => null), liberarJogo: vi.fn(), trancarJogo: vi.fn(), iniciarPartida: vi.fn(async () => ({})),
}
vi.mock('../lib/dados.js', () => d)
vi.mock('../context/Auth.jsx', () => ({ useAuth: () => ({ profile: { id: 'u1', nome: 'Ana' } }) }))
vi.mock('../context/Clube.jsx', () => ({ useClube: () => ({ papel: 'desbravador', clubeId: 'c1' }) }))
const avisar = { erro: vi.fn(), info: vi.fn(), sucesso: vi.fn(), confirmar: vi.fn(async () => true) }
vi.mock('../ui/avisos.jsx', () => ({ avisar }))
vi.mock('../lib/juice.js', () => ({ vitoria: vi.fn(), festa: vi.fn(), acerto: vi.fn() }))
vi.mock('../components/FeedbackJogo.jsx', () => ({ default: () => null }))
vi.mock('../features/jogos/registry.jsx', () => {
  const JogoTeste = ({ onTerminar }) => <button onClick={() => { onTerminar(3); onTerminar(3); onTerminar(3) }}>Concluir</button>
  return {
    JOGOS: { teste: { nome: 'Jogo de teste', curto: 'Teste', emoji: '🧪', desc: 'x', Comp: JogoTeste } },
    ARCADE: new Set(), RESERVAS: {}, JogoMemoria: JogoTeste,
    JogoBoundary: ({ children }) => children,
  }
})

const { default: Trilha } = await import('./Trilha.jsx')

beforeEach(() => {
  d.registrarJogo.mockReset(); avisar.erro.mockReset()
  d.registrarJogo.mockResolvedValue({ estrelas: 3, pontos: 30 })
})

describe('Trilha: fim de partida chamado várias vezes', () => {
  it('registra UMA vez e não mostra erro por causa das cópias', async () => {
    render(<MemoryRouter><Trilha /></MemoryRouter>)
    await userEvent.click(await screen.findByRole('button', { name: /Jogo de teste/ }))
    await userEvent.click(await screen.findByRole('button', { name: 'Concluir' }))
    await vi.waitFor(() => expect(d.registrarJogo).toHaveBeenCalledTimes(1))
    await new Promise((r) => setTimeout(r, 30))
    expect(d.registrarJogo).toHaveBeenCalledTimes(1)
    expect(avisar.erro).not.toHaveBeenCalled()
  })

  it('uma partida NOVA volta a registrar (a trava é por partida, não para sempre)', async () => {
    d.carregarTrilha.mockResolvedValue({ feito: false, passos: 1, hoje: [] }) // não "joga hoje" o jogo: continua disponível
    render(<MemoryRouter><Trilha /></MemoryRouter>)
    await userEvent.click(await screen.findByRole('button', { name: /Jogo de teste/ }))
    await userEvent.click(await screen.findByRole('button', { name: 'Concluir' }))
    await vi.waitFor(() => expect(d.registrarJogo).toHaveBeenCalledTimes(1))
    await userEvent.click(await screen.findByRole('button', { name: /Jogo de teste/ }))
    await userEvent.click(await screen.findByRole('button', { name: 'Concluir' }))
    await vi.waitFor(() => expect(d.registrarJogo).toHaveBeenCalledTimes(2))
  })

  it('se o 1º registro FALHA de verdade, o erro aparece uma única vez (não uma por cópia)', async () => {
    d.registrarJogo.mockRejectedValue(new Error('Você já jogou este jogo hoje.'))
    render(<MemoryRouter><Trilha /></MemoryRouter>)
    await userEvent.click(await screen.findByRole('button', { name: /Jogo de teste/ }))
    await userEvent.click(await screen.findByRole('button', { name: 'Concluir' }))
    await vi.waitFor(() => expect(avisar.erro).toHaveBeenCalledTimes(1))
    await new Promise((r) => setTimeout(r, 30))
    expect(avisar.erro).toHaveBeenCalledTimes(1)
    expect(d.registrarJogo).toHaveBeenCalledTimes(1)
  })
})
