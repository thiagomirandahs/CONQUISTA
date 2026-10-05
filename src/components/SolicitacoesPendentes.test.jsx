// Fila de cadastros pendentes: erro de rede NÃO pode virar "Tudo em dia" (auditoria de 05/10/2026) — a diretoria acharia que não há ninguém esperando.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const f = { pendentes: vi.fn() }
vi.mock('../services/entrada.js', () => ({ entradasPendentes: (...a) => f.pendentes(...a) }))
vi.mock('../context/Clube.jsx', () => ({ useClube: () => ({ clubeId: 'c1' }) }))
vi.mock('../lib/supabase.js', () => ({ supabase: { rpc: vi.fn(async () => ({ error: null })) } }))
vi.mock('../ui/avisos.jsx', () => ({ avisar: { erro: vi.fn(), sucesso: vi.fn(), info: vi.fn(), confirmar: vi.fn() } }))
const { default: SolicitacoesPendentes } = await import('./SolicitacoesPendentes.jsx')

beforeEach(() => f.pendentes.mockReset())

describe('SolicitacoesPendentes', () => {
  it('lista vazia de verdade: "Tudo em dia!"', async () => {
    f.pendentes.mockResolvedValue([])
    render(<SolicitacoesPendentes />)
    expect(await screen.findByText('Tudo em dia!')).toBeInTheDocument()
  })
  it('falha de rede: aviso de erro com "Tentar de novo", NUNCA "Tudo em dia"; tentar de novo recarrega', async () => {
    const u = userEvent.setup()
    f.pendentes.mockRejectedValueOnce(new Error('offline'))
    f.pendentes.mockResolvedValueOnce([{ id: 'p1', nome: 'Ana', nascimento: '2014-05-01', papel_pedido: 'desbravador' }])
    render(<SolicitacoesPendentes />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Não consegui carregar os cadastros pendentes')
    expect(screen.queryByText('Tudo em dia!')).not.toBeInTheDocument()
    await u.click(screen.getByRole('button', { name: 'Tentar de novo' }))
    await waitFor(() => expect(screen.getByText('Ana')).toBeInTheDocument())
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
