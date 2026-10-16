import { vi, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
const pagamento = vi.fn()
const ir = vi.fn()
vi.mock('../services/pagamentoLicenca.js', async importar => ({ ...(await importar()), pagamentoLicenca: (...a) => pagamento(...a) }))
// web/PWA: o checkout abre na MESMA aba (pedido do dono, 16/10/2026)
vi.mock('../lib/checkoutNaMesmaTela.js', () => ({ abrirNaMesmaTela: () => true, irParaCheckout: (...a) => ir(...a) }))
import PagamentoLicenca from './PagamentoLicenca.jsx'
const situacao = { habilitado: true, pode_pagar: true, pix_centavos: 22000, cartao_centavos: 25000, parcelas: 12 }
const RETORNO = '/planos?order_nsu=pedido&transaction_nsu=transacao&slug=fatura'
beforeEach(() => { pagamento.mockReset(); ir.mockReset() })

it('integração desligada não oferece cobrança', async () => {
  pagamento.mockResolvedValue({ habilitado: false })
  render(<MemoryRouter><PagamentoLicenca aoConfirmar={vi.fn()} /></MemoryRouter>)
  await vi.waitFor(() => expect(pagamento).toHaveBeenCalled())
  expect(screen.queryByRole('button', { name: 'Pagar agora' })).not.toBeInTheDocument()
})

it('mostra o preço do servidor e só abre checkout validado', async () => {
  pagamento.mockResolvedValueOnce(situacao).mockResolvedValueOnce({ url: 'https://evil.test/' })
  render(<MemoryRouter><PagamentoLicenca aoConfirmar={vi.fn()} /></MemoryRouter>)
  fireEvent.click(await screen.findByRole('button', { name: 'Pagar agora' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Link de pagamento inválido')
  expect(screen.queryByRole('link')).not.toBeInTheDocument()
  expect(ir).not.toHaveBeenCalled()
})

it('"Pagar agora" vai para o checkout validado NA MESMA aba (sem aba nova)', async () => {
  pagamento.mockResolvedValueOnce(situacao)
    .mockResolvedValueOnce({ url: 'https://checkout.infinitepay.com.br/pedido', pix_centavos: 25000, cartao_centavos: 25000, parcelas: 12 })
  render(<MemoryRouter><PagamentoLicenca aoConfirmar={vi.fn()} /></MemoryRouter>)
  fireEvent.click(await screen.findByRole('button', { name: 'Pagar agora' }))
  await vi.waitFor(() => expect(ir).toHaveBeenCalledWith('https://checkout.infinitepay.com.br/pedido'))
  expect(await screen.findByRole('link', { name: 'Continuar na InfinitePay' })).not.toHaveAttribute('target')
})

it('voltando do checkout, confirma SOZINHO; pago => avisa e atualiza a licença', async () => {
  pagamento.mockResolvedValueOnce(situacao).mockResolvedValueOnce({ ok: true })
  const atualizar = vi.fn(async () => {})
  render(<MemoryRouter initialEntries={[RETORNO]}><PagamentoLicenca aoConfirmar={atualizar} /></MemoryRouter>)
  expect(await screen.findByText('Pagamento confirmado. Sua licença anual está ativa.')).toBeInTheDocument()
  expect(pagamento).toHaveBeenCalledWith('confirmar', { order_nsu: 'pedido', transaction_nsu: 'transacao', slug: 'fatura' })
  expect(atualizar).toHaveBeenCalled()
})

it('retorno do checkout não ativa licença sem confirmação do servidor (e oferece tentar de novo)', async () => {
  pagamento.mockResolvedValueOnce(situacao).mockRejectedValueOnce(new Error('Pagamento ainda não confirmado.'))
  const atualizar = vi.fn()
  render(<MemoryRouter initialEntries={[RETORNO]}><PagamentoLicenca aoConfirmar={atualizar} /></MemoryRouter>)
  expect(await screen.findByRole('alert')).toHaveTextContent('ainda não confirmado')
  expect(atualizar).not.toHaveBeenCalled()
  expect(screen.getByRole('button', { name: 'Tentar confirmar de novo' })).toBeInTheDocument()
})

it('integração desligada durante o retorno não anuncia pagamento confirmado', async () => {
  pagamento.mockResolvedValueOnce(situacao).mockResolvedValueOnce({ habilitado: false })
  const atualizar = vi.fn()
  render(<MemoryRouter initialEntries={[RETORNO]}><PagamentoLicenca aoConfirmar={atualizar} /></MemoryRouter>)
  expect(await screen.findByRole('alert')).toHaveTextContent('ainda não confirmado')
  expect(atualizar).not.toHaveBeenCalled()
})

it('checkout usa o preço final reservado pelo servidor, mesmo se a última vaga mudou', async () => {
  pagamento.mockResolvedValueOnce({ ...situacao, pix_centavos: 22000, cartao_centavos: 22000, promocao: true, renovacao_centavos: 25000 })
    .mockResolvedValueOnce({ url: 'https://checkout.infinitepay.com.br/pedido', pix_centavos: 25000, cartao_centavos: 25000, parcelas: 12, promocao: false })
  render(<MemoryRouter><PagamentoLicenca aoConfirmar={vi.fn()} /></MemoryRouter>)
  fireEvent.click(await screen.findByRole('button', { name: 'Pagar agora' }))
  await screen.findByRole('link', { name: 'Continuar na InfinitePay' })
  expect(screen.getByText(/no Pix ou/)).toHaveTextContent('250,00')
  expect(screen.queryByText(/Oferta de lançamento no primeiro ano/)).not.toBeInTheDocument()
})
