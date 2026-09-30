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
// Fase 6: revogar/apagar/aplicar passam pelo modal do app (avisar.confirmar), nunca por window.confirm.
const confirmar = vi.fn()
vi.mock('../ui/avisos.jsx', () => ({ avisar: { sucesso: vi.fn(), info: vi.fn(), erro: vi.fn(), confirmar: (...a) => confirmar(...a) } }))
const { default: AdminCortesias } = await import('./AdminCortesias.jsx')

beforeEach(() => {
  for (const fn of Object.values(f)) fn.mockReset()
  confirmar.mockReset().mockResolvedValue(true)
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

  it('revogar: confirmação de perigo com código, Ativo → Revogado e impacto; recusou → nada; confirmou → RPC', async () => {
    f.cortesiaRevogar.mockResolvedValue({ ok: true })
    render(<AdminCortesias />)
    await screen.findByText('Live')
    confirmar.mockResolvedValueOnce(false)
    await userEvent.click(screen.getByText('Revogar'))
    expect(confirmar).toHaveBeenCalledTimes(1)
    const pedido = confirmar.mock.calls[0][0]
    expect(pedido.perigo).toBe(true)
    expect(pedido.titulo).toContain('Revogar o código "Live"')
    expect(pedido.rotulo).toBe('Revogar código')
    expect(pedido.descricao).toContain('DC-CD34')
    expect(pedido.descricao).toContain('Situação atual: Ativo → nova: Revogado')
    expect(pedido.descricao).toContain('ninguém mais consegue resgatar')
    expect(pedido.descricao).toContain('Nenhum clube resgatou ainda')
    expect(f.cortesiaRevogar).not.toHaveBeenCalled()

    confirmar.mockResolvedValueOnce(true)
    await userEvent.click(screen.getByText('Revogar'))
    expect(f.cortesiaRevogar).toHaveBeenCalledWith('k2', 'revogado no /admin')
  })

  it('apagar: confirmação de perigo diz quem já resgatou e que o histórico fica; recusou → nada; confirmou → RPC', async () => {
    f.cortesiaApagar.mockResolvedValue({ ok: true })
    render(<AdminCortesias />)
    await screen.findByText('Sorteio outubro 2026')
    confirmar.mockResolvedValueOnce(false)
    await userEvent.click(screen.getByText('Apagar'))
    expect(confirmar).toHaveBeenCalledTimes(1)
    const pedido = confirmar.mock.calls[0][0]
    expect(pedido.perigo).toBe(true)
    expect(pedido.titulo).toContain('Apagar o código "Sorteio outubro 2026"')
    expect(pedido.rotulo).toBe('Apagar código')
    expect(pedido.descricao).toContain('Clubes que já resgataram: Clube Ganhador')
    expect(pedido.descricao).toContain('histórico das cortesias já concedidas aos clubes fica')
    expect(f.cortesiaApagar).not.toHaveBeenCalled()

    confirmar.mockResolvedValueOnce(true)
    await userEvent.click(screen.getByText('Apagar'))
    expect(f.cortesiaApagar).toHaveBeenCalledWith('k1')
  })

  it('aplicar cortesia a um clube: confirmação neutra com clube, situação atual → cortesia e "nenhuma cobrança"', async () => {
    f.cortesiaAplicar.mockResolvedValue({ ok: true, ate: '2027-10-01T12:00:00Z' })
    render(<AdminCortesias />)
    await screen.findByText('Sorteio outubro 2026')
    await userEvent.selectOptions(await screen.findByLabelText('Clube'), 'c2')
    confirmar.mockResolvedValueOnce(false)
    await userEvent.click(screen.getByTestId('cortesia-aplicar'))
    expect(confirmar).toHaveBeenCalledTimes(1)
    const pedido = confirmar.mock.calls[0][0]
    expect(pedido.perigo).toBe(false)
    expect(pedido.titulo).toContain('12 mese(s)')
    expect(pedido.rotulo).toBe('Aplicar cortesia')
    expect(pedido.descricao).toContain('Clube: Clube Teste')
    expect(pedido.descricao).toContain('Situação atual: Teste grátis → nova: Licença cortesia ativa por 12 mese(s)')
    expect(pedido.descricao).toContain('Nenhuma cobrança é criada')
    expect(f.cortesiaAplicar).not.toHaveBeenCalled()

    confirmar.mockResolvedValueOnce(true)
    await userEvent.click(screen.getByTestId('cortesia-aplicar'))
    expect(f.cortesiaAplicar).toHaveBeenCalledWith('c2', 12, 'ganhador de sorteio / promoção')
  })
})
