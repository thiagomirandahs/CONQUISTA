import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const f = { criar: vi.fn(), listar: vi.fn(), confirmar: vi.fn(), clubes: vi.fn(), ir: vi.fn(), retorno: vi.fn(), mesmaTela: true }
vi.mock('../../services/pagamento.js', () => ({
  criarVendaTeste: (...a) => f.criar(...a), listarVendasTeste: (...a) => f.listar(...a), confirmarVendaTeste: (...a) => f.confirmar(...a),
}))
vi.mock('../../services/admin.js', () => ({ clubesListar: (...a) => f.clubes(...a) }))
vi.mock('../../lib/checkoutNaMesmaTela.js', () => ({
  abrirNaMesmaTela: () => f.mesmaTela, irParaCheckout: (...a) => f.ir(...a), lerRetornoDoCheckout: () => f.retorno(),
}))
vi.mock('../../ui/avisos.jsx', () => ({ avisar: { sucesso: vi.fn(), erro: vi.fn(), info: vi.fn(), confirmar: vi.fn() } }))
const { default: VendaDeTeste } = await import('./VendaDeTeste.jsx')

beforeEach(() => {
  for (const k of ['criar', 'listar', 'confirmar', 'clubes', 'ir', 'retorno']) f[k].mockReset()
  f.mesmaTela = true
  f.retorno.mockReturnValue(null)
  f.clubes.mockResolvedValue([{ club_id: 'c1', nome: 'Everest' }, { club_id: 'c2', nome: 'Clube Pinheiros' }])
  f.listar.mockResolvedValue([])
})

describe('VendaDeTeste', () => {
  it('no celular/web: gera o link de R$ 1,00 e vai para o pagamento NA MESMA aba', async () => {
    const u = userEvent.setup()
    f.criar.mockResolvedValue({ teste: true, id: 't1', valor_centavos: 100, url: 'https://checkout.infinitepay.com.br/x' })
    render(<VendaDeTeste />)
    expect(await screen.findByText('Nenhum teste feito ainda.')).toBeInTheDocument()
    expect(screen.getByTestId('teste-gerar')).toBeDisabled()
    await u.selectOptions(await screen.findByTestId('teste-clube'), 'c1')
    await u.click(screen.getByTestId('teste-gerar'))
    expect(f.criar).toHaveBeenCalledWith('c1')
    expect(f.ir).toHaveBeenCalledWith('https://checkout.infinitepay.com.br/x')
  })

  it('no APK: mostra o link (abre fora do app)', async () => {
    const u = userEvent.setup()
    f.mesmaTela = false
    f.criar.mockResolvedValue({ teste: true, id: 't1', valor_centavos: 100, url: 'https://checkout.infinitepay.com.br/x' })
    render(<VendaDeTeste />)
    await u.selectOptions(await screen.findByTestId('teste-clube'), 'c1')
    await u.click(screen.getByTestId('teste-gerar'))
    expect(await screen.findByTestId('teste-link')).toHaveAttribute('href', 'https://checkout.infinitepay.com.br/x')
    expect(f.ir).not.toHaveBeenCalled()
  })

  it('lista os testes com a situação (pago via Pix / aguardando)', async () => {
    f.listar.mockResolvedValue([
      { id: 'a', clube: 'Everest', valor_centavos: 100, status: 'pago', metodo: 'pix', criado_em: '2026-10-16T14:00:00Z' },
      { id: 'b', clube: 'Everest', valor_centavos: 100, status: 'pendente', metodo: null, criado_em: '2026-10-16T14:05:00Z' },
    ])
    render(<VendaDeTeste />)
    const lista = await screen.findByTestId('teste-lista')
    expect(lista).toHaveTextContent('Pago (Pix) ✓')
    expect(lista).toHaveTextContent('Aguardando pagamento')
    expect(lista).toHaveTextContent('R$ 1,00')
  })

  it('voltando do checkout: confirma SOZINHO (sem botão); se falhar, oferece tentar de novo', async () => {
    f.retorno.mockReturnValue({ order_nsu: 't1', transaction_nsu: 'tx9', slug: 'abc' })
    f.confirmar.mockRejectedValueOnce(new Error('ainda não'))
    f.confirmar.mockResolvedValueOnce({ ok: true, teste: true })
    const u = userEvent.setup()
    render(<VendaDeTeste />)
    expect(await screen.findByTestId('teste-confirmar-retorno')).toHaveTextContent('Tentar confirmar de novo')
    expect(f.confirmar).toHaveBeenCalledWith({ order_nsu: 't1', transaction_nsu: 'tx9', slug: 'abc' })
    await u.click(screen.getByTestId('teste-confirmar-retorno'))
    expect(f.confirmar).toHaveBeenCalledTimes(2)
  })
})
