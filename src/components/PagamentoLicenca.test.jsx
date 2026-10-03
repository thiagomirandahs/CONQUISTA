import { vi, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
const pagamento = vi.fn()
vi.mock('../services/pagamentoLicenca.js', async importar => ({ ...(await importar()), pagamentoLicenca: (...a) => pagamento(...a) }))
import PagamentoLicenca from './PagamentoLicenca.jsx'
const situacao = { habilitado: true, pode_pagar: true, pix_centavos: 22000, cartao_centavos: 25000, parcelas: 12 }
beforeEach(() => pagamento.mockReset())
it('integração desligada não oferece cobrança', async () => {
  pagamento.mockResolvedValue({ habilitado: false })
  render(<MemoryRouter><PagamentoLicenca aoConfirmar={vi.fn()} /></MemoryRouter>)
  await vi.waitFor(() => expect(pagamento).toHaveBeenCalled())
  expect(screen.queryByRole('button', { name: 'Preparar pagamento' })).not.toBeInTheDocument()
})
it('mostra o preço do servidor e só abre checkout validado', async () => {
  pagamento.mockResolvedValueOnce(situacao).mockResolvedValueOnce({ url: 'https://evil.test/' })
  render(<MemoryRouter><PagamentoLicenca aoConfirmar={vi.fn()} /></MemoryRouter>)
  fireEvent.click(await screen.findByRole('button', { name: 'Preparar pagamento' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Link de pagamento inválido')
  expect(screen.queryByRole('link')).not.toBeInTheDocument()
})
it('retorno do checkout não ativa licença sem confirmação do servidor', async () => {
  pagamento.mockResolvedValueOnce(situacao).mockRejectedValueOnce(new Error('Pagamento ainda não confirmado.'))
  const atualizar = vi.fn()
  render(<MemoryRouter initialEntries={['/planos?order_nsu=pedido&transaction_nsu=transacao&slug=fatura']}><PagamentoLicenca aoConfirmar={atualizar} /></MemoryRouter>)
  fireEvent.click(await screen.findByRole('button', { name: 'Confirmar pagamento' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('ainda não confirmado')
  expect(atualizar).not.toHaveBeenCalled()
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
})
it('integração desligada durante o retorno não anuncia pagamento confirmado', async () => {
  pagamento.mockResolvedValueOnce(situacao).mockResolvedValueOnce({ habilitado: false })
  const atualizar = vi.fn()
  render(<MemoryRouter initialEntries={['/planos?order_nsu=pedido&transaction_nsu=transacao&slug=fatura']}><PagamentoLicenca aoConfirmar={atualizar} /></MemoryRouter>)
  fireEvent.click(await screen.findByRole('button', { name: 'Confirmar pagamento' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('ainda não confirmado')
  expect(atualizar).not.toHaveBeenCalled()
})
