// Mensalidades: falha ao consultar NÃO vira "todos pendentes" (auditoria de 05/10/2026): aviso, nada de marcar pagamento, e "Tentar de novo".
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const f = { consulta: vi.fn(), membros: vi.fn() }
vi.mock('../lib/supabase.js', () => ({
  supabase: {
    from: () => ({ select: () => ({ eq: () => ({ eq: () => f.consulta() }) }), upsert: async () => ({ error: null }) }),
    rpc: async () => ({ data: [], error: null }),
  },
}))
vi.mock('../context/Auth.jsx', () => ({ useAuth: () => ({ profile: { id: 'tes' } }) }))
vi.mock('../context/Clube.jsx', () => ({ useClube: () => ({ papel: 'tesoureiro' }) }))
vi.mock('../services/membros.js', () => ({ membrosDoClube: (...a) => f.membros(...a), PAPEIS_DE_UNIDADE: ['desbravador'] }))
vi.mock('../components/Avatar.jsx', () => ({ default: () => null }))
vi.mock('../ui/avisos.jsx', () => ({ useAvisos: () => ({ sucesso: vi.fn(), erro: vi.fn(), confirmar: vi.fn(async () => true) }) }))
const { default: Mensalidades } = await import('./Mensalidades.jsx')

beforeEach(() => { f.consulta.mockReset(); f.membros.mockReset(); f.membros.mockResolvedValue([{ id: 'd1', nome: 'Davi Souza', papel: 'desbravador' }]) })

describe('Mensalidades', () => {
  it('consulta falhou: mostra o aviso, esconde a lista e os totais, e "Tentar de novo" recarrega', async () => {
    const u = userEvent.setup()
    f.consulta.mockResolvedValueOnce({ data: null, error: { message: 'offline' } })
    f.consulta.mockResolvedValueOnce({ data: [{ desbravador_id: 'd1', status: 'pago', valor: 30 }], error: null })
    render(<Mensalidades />)
    expect(await screen.findByTestId('falha-mensalidades')).toHaveTextContent('Não consegui carregar os pagamentos')
    expect(screen.queryByText('Davi Souza')).not.toBeInTheDocument()
    expect(screen.queryByText('Pendentes')).not.toBeInTheDocument()
    await u.click(screen.getByRole('button', { name: 'Tentar de novo' }))
    await waitFor(() => expect(screen.getByText('Davi Souza')).toBeInTheDocument())
    expect(screen.queryByTestId('falha-mensalidades')).not.toBeInTheDocument()
    expect(screen.getByText('Pendentes')).toBeInTheDocument()
  })
  it('consulta ok: lista e totais aparecem sem aviso', async () => {
    f.consulta.mockResolvedValue({ data: [], error: null })
    render(<Mensalidades />)
    expect(await screen.findByText('Davi Souza')).toBeInTheDocument()
    expect(screen.queryByTestId('falha-mensalidades')).not.toBeInTheDocument()
  })
})
