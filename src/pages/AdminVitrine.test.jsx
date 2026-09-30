// /admin › Vitrine: apagar parceiro passa pelo modal do app (avisar.confirmar, Fase 6), nunca por
// window.confirm — recusou, nada vai ao servidor; confirmou, chama a RPC auditada.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const f = {
  adminParceirosListar: vi.fn(), adminParceiroSalvar: vi.fn(), adminParceiroApagar: vi.fn(), subirLogoDoParceiro: vi.fn(),
  adminCartoesListar: vi.fn(), adminCartaoModerar: vi.fn(),
}
vi.mock('../services/vitrine.js', () => Object.fromEntries(Object.keys(f).map((k) => [k, (...a) => f[k](...a)])))
const confirmar = vi.fn()
vi.mock('../ui/avisos.jsx', () => ({ avisar: { sucesso: vi.fn(), info: vi.fn(), erro: vi.fn(), confirmar: (...a) => confirmar(...a) } }))
const { default: AdminVitrine } = await import('./AdminVitrine.jsx')

const PARCEIRO = { id: 'p1', nome: 'Loja do Desbravador', descricao: '', link: 'https://loja.exemplo', whatsapp: '', categoria: 'Uniformes', ordem: 10, destaque: false, ativo: true, no_ar: true, inicio: null, fim: null, logo_url: '' }

beforeEach(() => {
  for (const fn of Object.values(f)) fn.mockReset()
  confirmar.mockReset().mockResolvedValue(true)
  f.adminParceirosListar.mockResolvedValue([PARCEIRO])
  f.adminCartoesListar.mockResolvedValue([])
  f.adminParceiroApagar.mockResolvedValue({ ok: true })
})

describe('AdminVitrine › apagar parceiro', () => {
  it('confirmação de perigo com parceiro, "No ar" → Apagado e impacto; recusou → nada; confirmou → RPC', async () => {
    render(<AdminVitrine />)
    await userEvent.click(await screen.findByText('Editar'))
    const botao = await screen.findByText('Apagar parceiro')

    confirmar.mockResolvedValueOnce(false)
    await userEvent.click(botao)
    expect(confirmar).toHaveBeenCalledTimes(1)
    const pedido = confirmar.mock.calls[0][0]
    expect(pedido.perigo).toBe(true)
    expect(pedido.titulo).toContain('Apagar o parceiro "Loja do Desbravador"')
    expect(pedido.rotulo).toBe('Apagar parceiro')
    expect(pedido.descricao).toContain('Parceiro: Loja do Desbravador (Uniformes)')
    expect(pedido.descricao).toContain('Situação atual: No ar em /parceiros → nova: Apagado')
    expect(pedido.descricao).toContain('não dá para desfazer')
    expect(f.adminParceiroApagar).not.toHaveBeenCalled()

    confirmar.mockResolvedValueOnce(true)
    await userEvent.click(botao)
    expect(f.adminParceiroApagar).toHaveBeenCalledWith('p1')
  })
})
