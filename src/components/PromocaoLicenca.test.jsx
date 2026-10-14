import { it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
const carregar = vi.fn()
vi.mock('../services/comercial.js', () => ({ carregarPromocaoLicenca: (...a) => carregar(...a), formatarPreco: n => `R$ ${n / 100}` }))
import PromocaoLicenca from './PromocaoLicenca.jsx'
beforeEach(() => carregar.mockReset())
afterEach(cleanup)
it('distingue pagamentos confirmados de vagas reservadas', async () => {
  carregar.mockResolvedValue({ limite: 50, valor_centavos: 20000, regular_centavos: 25000, confirmados: 10, reservados: 5, disponiveis: 35 })
  render(<PromocaoLicenca />)
  expect(await screen.findByText(/Primeiros 50 clubes/)).toHaveTextContent('R$ 200')
  expect(screen.getByText(/10 pagamentos confirmados/)).toHaveTextContent('5 vagas reservadas')
  expect(screen.getByText(/Criar conta não garante/)).toBeInTheDocument()
})
it('oferece preço regular quando todas as vagas já estão preenchidas', async () => {
  carregar.mockResolvedValue({ limite: 50, valor_centavos: 20000, regular_centavos: 25000, confirmados: 50, reservados: 0, disponiveis: 0 })
  render(<PromocaoLicenca />)
  expect(await screen.findByText(/vagas de lançamento foram preenchidas/)).toHaveTextContent('R$ 250')
  expect(screen.queryByText(/R\$ 200/)).not.toBeInTheDocument()
})
