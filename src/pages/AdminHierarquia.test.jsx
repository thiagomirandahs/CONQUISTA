// Convites de coordenação (migration 140): válido só se revoga; revogado/expirado/esgotado se apaga
// (arquivado no servidor, com auditoria); filtro e "limpar inativos".
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const hierarquiaAdmin = vi.fn()
const conviteApagar = vi.fn()
const conviteRevogar = vi.fn()
const convitesLimparInativos = vi.fn()
vi.mock('../services/hierarquia.js', async (orig) => ({
  ...(await orig()),
  hierarquiaAdmin: (...a) => hierarquiaAdmin(...a),
  conviteApagar: (...a) => conviteApagar(...a),
  conviteRevogar: (...a) => conviteRevogar(...a),
  convitesLimparInativos: (...a) => convitesLimparInativos(...a),
}))
vi.mock('../ui/avisos.jsx', () => ({ avisar: { sucesso: vi.fn(), erro: vi.fn(), info: vi.fn() } }))
const { default: AdminHierarquia } = await import('./AdminHierarquia.jsx')

const conv = (id, situacao) => ({ id, rotulo: `Convite ${id}`, situacao, usos: 0, max_usos: 1, modo: 'fixo', prefixo: 'abc123', expira_em: '2026-10-01' })
beforeEach(() => {
  hierarquiaAdmin.mockReset().mockResolvedValue({
    unidades: [], clubes: [], pedidos_clube: [], coordenadores_pendentes: [], convites_arquivados: 3,
    convites: [conv('v', 'valido'), conv('r', 'revogado'), conv('e', 'expirado')],
  })
  conviteApagar.mockReset().mockResolvedValue({ ok: true })
  convitesLimparInativos.mockReset().mockResolvedValue({ ok: true, apagados: 2 })
  vi.spyOn(window, 'confirm').mockReturnValue(true)
})

describe('AdminHierarquia — convites', () => {
  it('por padrão mostra só os válidos, com Revogar e sem Apagar', async () => {
    render(<AdminHierarquia />)
    const lista = await screen.findByTestId('hier-lista-convites')
    const itens = within(lista).getAllByTestId('hier-convite')
    expect(itens).toHaveLength(1)
    expect(within(itens[0]).getByRole('button', { name: 'Revogar' })).toBeInTheDocument()
    expect(within(itens[0]).queryByRole('button', { name: 'Apagar' })).not.toBeInTheDocument()
    expect(screen.getByText(/3 convite\(s\) apagado\(s\) ficam guardados/)).toBeInTheDocument()
  })

  it('inativos: cada um tem Apagar, e não Revogar', async () => {
    render(<AdminHierarquia />)
    await userEvent.click(await screen.findByRole('button', { name: /Inativos \(2\)/ }))
    const itens = screen.getAllByTestId('hier-convite')
    expect(itens).toHaveLength(2)
    for (const i of itens) expect(within(i).queryByRole('button', { name: 'Revogar' })).not.toBeInTheDocument()
    await userEvent.click(within(itens[0]).getByRole('button', { name: 'Apagar' }))
    expect(conviteApagar).toHaveBeenCalledWith('r')
  })

  it('limpar inativos pede confirmação e chama o servidor', async () => {
    render(<AdminHierarquia />)
    await userEvent.click(await screen.findByRole('button', { name: 'Limpar inativos (2)' }))
    expect(window.confirm).toHaveBeenCalled()
    expect(convitesLimparInativos).toHaveBeenCalled()
  })
})
