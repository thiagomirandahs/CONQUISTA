// Missões: falha ao carregar NÃO vira "a liderança ainda vai cadastrar as missões" (auditoria de 05/10/2026); "Tentar de novo" recarrega.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const f = { carregar: vi.fn() }
vi.mock('../context/Auth.jsx', () => ({ useAuth: () => ({ profile: { id: 'u1', nascimento: '2014-03-01' } }) }))
vi.mock('../lib/dados.js', () => ({ carregarMissao: (...a) => f.carregar(...a), enviarMissao: vi.fn(), classeDoUsuario: () => 'Amigo' }))
vi.mock('../lib/juice.js', () => ({ vitoria: vi.fn() }))
vi.mock('../components/Comprovacao.jsx', () => ({ default: () => null }))
const { default: Missoes } = await import('./Missoes.jsx')

beforeEach(() => f.carregar.mockReset())

describe('Missões', () => {
  it('falha de carga: aviso com "Tentar de novo" (não o texto de "missões chegando"); tentar de novo traz a missão', async () => {
    const u = userEvent.setup()
    f.carregar.mockRejectedValueOnce(new Error('offline'))
    f.carregar.mockResolvedValueOnce({ missao: { id: 'm1', tipo: 'devocional', titulo: 'Ler Salmo 23', texto: 'Leia o Salmo 23', pontos: 10 }, resumo: { feito: false, sequencia: 0, foto: null } })
    render(<Missoes />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Não consegui carregar a missão de hoje')
    expect(screen.queryByText('Missões chegando!')).not.toBeInTheDocument()
    await u.click(screen.getByRole('button', { name: 'Tentar de novo' }))
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
    expect(f.carregar).toHaveBeenCalledTimes(2)
  })
  it('sem missão cadastrada de verdade: "Missões chegando!" sem pedir para rodar SQL', async () => {
    f.carregar.mockResolvedValue({ missao: null, resumo: { feito: false, sequencia: 0, foto: null } })
    render(<Missoes />)
    expect(await screen.findByText('Missões chegando!')).toBeInTheDocument()
    expect(screen.queryByText(/rode o SQL/)).not.toBeInTheDocument()
  })
})
