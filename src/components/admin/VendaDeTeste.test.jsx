import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const f = { criar: vi.fn(), listar: vi.fn(), confirmar: vi.fn(), clubes: vi.fn() }
vi.mock('../../services/pagamento.js', () => ({
  criarVendaTeste: (...a) => f.criar(...a), listarVendasTeste: (...a) => f.listar(...a), confirmarVendaTeste: (...a) => f.confirmar(...a),
}))
vi.mock('../../services/admin.js', () => ({ clubesListar: (...a) => f.clubes(...a) }))
vi.mock('../../ui/avisos.jsx', () => ({ avisar: { sucesso: vi.fn(), erro: vi.fn(), info: vi.fn(), confirmar: vi.fn() } }))
const { default: VendaDeTeste } = await import('./VendaDeTeste.jsx')

const urlOriginal = window.location.href
beforeEach(() => {
  Object.values(f).forEach((m) => m.mockReset())
  f.clubes.mockResolvedValue([{ club_id: 'c1', nome: 'Everest' }, { club_id: 'c2', nome: 'Filhos da Conquista' }])
  f.listar.mockResolvedValue([])
})
afterEach(() => { window.history.replaceState(null, '', urlOriginal) })

describe('VendaDeTeste', () => {
  it('escolhe o clube, gera o link de R$ 1,00 e mostra "Abrir pagamento de teste"', async () => {
    const u = userEvent.setup()
    f.criar.mockResolvedValue({ teste: true, id: 't1', valor_centavos: 100, url: 'https://checkout.infinitepay.com.br/x' })
    render(<VendaDeTeste />)
    expect(await screen.findByText('Nenhum teste feito ainda.')).toBeInTheDocument()
    expect(screen.getByTestId('teste-gerar')).toBeDisabled()
    await u.selectOptions(await screen.findByTestId('teste-clube'), 'c1')
    await u.click(screen.getByTestId('teste-gerar'))
    expect(f.criar).toHaveBeenCalledWith('c1')
    expect(await screen.findByTestId('teste-link')).toHaveAttribute('href', 'https://checkout.infinitepay.com.br/x')
    expect(screen.getByTestId('teste-link')).toHaveAttribute('rel', expect.stringContaining('noopener'))
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

  it('voltando do checkout (?order_nsu=…): botão confirma consultando a InfinitePay', async () => {
    const u = userEvent.setup()
    window.history.replaceState(null, '', '/admin?aba=assinaturas&order_nsu=t1&transaction_nsu=tx9&slug=abc')
    f.confirmar.mockResolvedValue({ ok: true, teste: true })
    render(<VendaDeTeste />)
    await u.click(await screen.findByTestId('teste-confirmar-retorno'))
    expect(f.confirmar).toHaveBeenCalledWith({ order_nsu: 't1', transaction_nsu: 'tx9', slug: 'abc' })
  })
})
