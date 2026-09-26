// /admin › Cortesias: o código aparece UMA vez (resposta da RPC), a lista mostra status e as ações
// chamam as RPCs auditadas. O guard real é o servidor (_exigir_admin_plataforma).
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const f = {
  cortesiasListar: vi.fn(), cortesiasConcedidas: vi.fn(), cortesiaGerar: vi.fn(), cortesiaRevogar: vi.fn(),
  cortesiaApagar: vi.fn(), cortesiaAplicar: vi.fn(), clubesListar: vi.fn(),
}
vi.mock('../services/admin.js', () => Object.fromEntries(Object.keys(f).map((k) => [k, (...a) => f[k](...a)])))
const { default: AdminCortesias } = await import('./AdminCortesias.jsx')

beforeEach(() => {
  for (const fn of Object.values(f)) fn.mockReset()
  f.cortesiasListar.mockResolvedValue([
    { id: 'k1', prefixo: 'AB12', rotulo: 'Sorteio outubro 2026', duracao_meses: 12, max_usos: 1, usos: 1, status: 'resgatado',
      resgate_ate: '2026-12-31T00:00:00Z', resgates: [{ clube: 'Clube Ganhador', fim: '2027-10-01T12:00:00Z' }] },
    { id: 'k2', prefixo: 'CD34', rotulo: 'Live', duracao_meses: 12, max_usos: 5, usos: 0, status: 'ativo', resgate_ate: '2026-12-31T00:00:00Z', resgates: [] },
  ])
  f.cortesiasConcedidas.mockResolvedValue([])
  f.clubesListar.mockResolvedValue([{ club_id: 'c2', nome: 'Clube Teste', assinatura_status: 'trial' }])
  f.cortesiaGerar.mockResolvedValue({ ok: true, codigo: 'DC-1111-2222-3333-4444', duracao_meses: 12, max_usos: 1, resgate_ate: '2026-12-25T00:00:00Z' })
})

describe('AdminCortesias', () => {
  it('lista com status e resgates', async () => {
    render(<AdminCortesias />)
    expect(await screen.findByText('Sorteio outubro 2026')).toBeInTheDocument()
    expect(screen.getByText('Resgatado')).toBeInTheDocument()
    expect(screen.getByText('Ativo')).toBeInTheDocument()
    expect(screen.getByText(/Clube Ganhador: cortesia até/)).toBeInTheDocument()
  })

  it('gera com padrões 12 meses / 1 uso e mostra o código uma vez', async () => {
    render(<AdminCortesias />)
    await screen.findByText('Sorteio outubro 2026')
    await userEvent.type(screen.getByLabelText(/Nome/), 'Sorteio novembro')
    await userEvent.click(screen.getByTestId('cortesia-gerar'))
    expect(f.cortesiaGerar).toHaveBeenCalledWith({ rotulo: 'Sorteio novembro', meses: 12, usos: 1, diasParaResgate: 90 })
    expect(await screen.findByTestId('cortesia-codigo')).toHaveTextContent('DC-1111-2222-3333-4444')
    await userEvent.click(screen.getByText('Fechar'))
    expect(screen.queryByTestId('cortesia-codigo')).toBeNull()
  })

  it('revoga código ativo com confirmação', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    f.cortesiaRevogar.mockResolvedValue({ ok: true })
    render(<AdminCortesias />)
    await screen.findByText('Live')
    await userEvent.click(screen.getByText('Revogar'))
    expect(f.cortesiaRevogar).toHaveBeenCalledWith('k2', 'revogado no /admin')
  })
})
