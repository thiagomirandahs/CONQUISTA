// Autorização do responsável para a Comunidade: some quando o recurso está desligado; autoriza e revoga
// chamando a RPC com o filho certo.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const autorizacoesDosFilhos = vi.fn()
const autorizar = vi.fn()
vi.mock('../services/comunidade.js', () => ({
  autorizacoesDosFilhos: (...a) => autorizacoesDosFilhos(...a),
  autorizar: (...a) => autorizar(...a),
}))
vi.mock('../ui/avisos.jsx', () => ({ avisar: { sucesso: vi.fn(), info: vi.fn(), erro: vi.fn(), confirmar: vi.fn(async () => true) } }))

const { default: AutorizacaoComunidade } = await import('./AutorizacaoComunidade.jsx')

beforeEach(() => { autorizacoesDosFilhos.mockReset(); autorizar.mockReset(); autorizar.mockResolvedValue({ ok: true }) })

describe('Autorização da Comunidade (responsável)', () => {
  it('recurso desligado: não mostra nada', async () => {
    autorizacoesDosFilhos.mockResolvedValue({ recurso_ligado: false, filhos: [{ desbravador_id: 'f1', nome: 'Lia', autorizado: false }] })
    const { container } = render(<AutorizacaoComunidade />)
    await vi.waitFor(() => expect(autorizacoesDosFilhos).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()
  })

  it('autoriza o filho', async () => {
    const u = userEvent.setup()
    autorizacoesDosFilhos.mockResolvedValue({ recurso_ligado: true, filhos: [{ desbravador_id: 'f1', nome: 'Lia', autorizado: false }] })
    render(<AutorizacaoComunidade />)
    await u.click(await screen.findByRole('button', { name: 'Autorizar' }))
    expect(autorizar).toHaveBeenCalledWith('f1', true)
  })

  it('revoga (com confirmação)', async () => {
    const u = userEvent.setup()
    autorizacoesDosFilhos.mockResolvedValue({ recurso_ligado: true, filhos: [{ desbravador_id: 'f1', nome: 'Lia', autorizado: true }] })
    render(<AutorizacaoComunidade />)
    await u.click(await screen.findByRole('button', { name: 'Revogar' }))
    expect(autorizar).toHaveBeenCalledWith('f1', false)
  })
})
