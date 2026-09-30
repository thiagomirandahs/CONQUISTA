// Achado da fase 7 (/trilha): se a leitura da trilha falhasse (sem internet/prazo), a promessa estourava solta
// (erro 'promessa' na telemetria) e a tela ficava sem explicação. Agora mostra "Tentar de novo".
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'

const d = {
  carregarTrilha: vi.fn(), registrarJogo: vi.fn(), carregarRankingTrilha: vi.fn(async () => []), carregarJogosTrilha: vi.fn(async () => []),
  lerJogoDaSemana: vi.fn(async () => null), ajudasRecebidas: vi.fn(async () => []), bonusTodosJogos: vi.fn(async () => ({})),
  statusJogosDoDia: vi.fn(async () => null), liberarJogo: vi.fn(), trancarJogo: vi.fn(), iniciarPartida: vi.fn(async () => ({})),
}
vi.mock('../lib/dados.js', () => d)
vi.mock('../context/Auth.jsx', () => ({ useAuth: () => ({ profile: { id: 'u1', nome: 'Ana' } }) }))
vi.mock('../context/Clube.jsx', () => ({ useClube: () => ({ papel: 'desbravador', clubeId: 'c1' }) }))
vi.mock('../ui/avisos.jsx', () => ({ avisar: { erro: vi.fn(), info: vi.fn(), sucesso: vi.fn(), confirmar: vi.fn(async () => true) } }))

const { default: Trilha } = await import('./Trilha.jsx')

beforeEach(() => { d.carregarTrilha.mockReset() })

describe('Trilha: falha ao carregar', () => {
  it('não estoura promessa solta: mostra o aviso e o botão "Tentar de novo" que recarrega', async () => {
    const soltas = []
    const ouvir = (e) => soltas.push(e)
    process.on('unhandledRejection', ouvir)
    d.carregarTrilha.mockRejectedValueOnce(new Error('Failed to fetch'))
    d.carregarTrilha.mockResolvedValue({ passos: 0 })
    render(<MemoryRouter><Trilha /></MemoryRouter>)
    expect(await screen.findByTestId('trilha-erro')).toHaveTextContent(/Não consegui carregar sua trilha/)
    await userEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }))
    await vi.waitFor(() => expect(screen.queryByTestId('trilha-erro')).toBeNull())
    expect(d.carregarTrilha).toHaveBeenCalledTimes(2)
    process.off('unhandledRejection', ouvir)
    expect(soltas).toEqual([])
  })
})
