import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const rpc = vi.fn()
vi.mock('../lib/supabase.js', () => ({ supabase: { rpc: (...a) => rpc(...a) } }))
vi.mock('../services/admin.js', () => ({
  clubesListar: () => Promise.resolve([
    { club_id: 'a', nome: 'Clube A', status: 'ativo' },
    { club_id: 'b', nome: 'Clube B', status: 'ativo' },
    { club_id: 'c', nome: 'Clube Inativo', status: 'inativo' },
  ]),
}))
const confirmar = vi.fn()
vi.mock('../ui/avisos.jsx', () => ({ avisar: { sucesso: vi.fn(), erro: vi.fn(), info: vi.fn(), confirmar: (...a) => confirmar(...a) } }))
const { default: Todos } = await import('./AdminRedeTodosClubes.jsx')

describe('Admin: Rede DBV em todos os clubes', () => {
  beforeEach(() => { confirmar.mockReset().mockResolvedValue(true) })

  it('libera só nos clubes ativos e mostra quem ficou de fora com o motivo do servidor', async () => {
    rpc.mockReset()
      .mockResolvedValueOnce({ error: null })
      .mockResolvedValueOnce({ error: { message: 'O plano deste clube não inclui "Comunidade".' } })
    render(<Todos />)
    await userEvent.click(screen.getByTestId('rede-liberar-todos'))
    // a confirmação diz QUANTOS clubes (só os ativos)
    expect(confirmar).toHaveBeenCalledTimes(1)
    expect(confirmar.mock.calls[0][0].titulo).toContain('2 clubes ativos')
    expect(rpc).toHaveBeenCalledTimes(2)
    expect(rpc).toHaveBeenCalledWith('admin_recurso_do_clube_definir', { p_club_id: 'a', p_feature: 'comunidade', p_enabled: true })
    expect(await screen.findByRole('status')).toHaveTextContent('liberada em 1 clube')
    expect(screen.getByText(/Clube B/)).toBeInTheDocument()
  })

  it('recusou a confirmação: nenhum clube é tocado', async () => {
    rpc.mockReset().mockResolvedValue({ error: null })
    confirmar.mockResolvedValueOnce(false)
    render(<Todos />)
    await userEvent.click(screen.getByTestId('rede-desligar-todos'))
    expect(confirmar).toHaveBeenCalledTimes(1)
    expect(confirmar.mock.calls[0][0].titulo).toMatch(/Desligar/)
    expect(rpc).not.toHaveBeenCalled()
    expect(screen.queryByRole('status')).toBeNull()
  })
})
