// Catálogo público de planos (item 4): dado vem do serviço (que chama a RPC pública
// planos_disponiveis()), nunca hardcoded aqui — e "Quero este plano" linka pra /criar-clube com o
// plano na querystring.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const carregarPlanos = vi.fn()
vi.mock('../services/comercial.js', async (importOriginal) => {
  const real = await importOriginal()
  return { ...real, carregarPlanos: (...a) => carregarPlanos(...a) }
})

const { default: Adquirir } = await import('./Adquirir.jsx')

const PLANO = {
  chave: 'essencial', nome: 'Essencial', descricao: 'Pra começar', provisorio: true,
  recursos: ['chat', 'agenda'], precos: [{ ciclo: 'mensal', moeda: 'BRL', valor_centavos: 4990, provisorio: true }],
}

beforeEach(() => vi.clearAllMocks())

describe('Adquirir', () => {
  it('lista o plano vindo do serviço e o CTA linka pro criar-clube com o plano certo', async () => {
    carregarPlanos.mockResolvedValue([PLANO])
    render(<MemoryRouter><Adquirir /></MemoryRouter>)
    await screen.findByText('Essencial')
    expect(screen.getByText(/pagamento online ainda não integrado/i)).toBeInTheDocument()
    const cta = screen.getByRole('link', { name: /quero este plano/i })
    expect(cta).toHaveAttribute('href', '/criar-clube?plano=essencial')
  })

  it('catálogo vazio não quebra a tela', async () => {
    carregarPlanos.mockResolvedValue([])
    render(<MemoryRouter><Adquirir /></MemoryRouter>)
    await screen.findByText(/nenhum plano publicado/i)
  })

  it('erro do serviço aparece pro usuário', async () => {
    carregarPlanos.mockRejectedValue(new Error('catálogo fora do ar'))
    render(<MemoryRouter><Adquirir /></MemoryRouter>)
    await screen.findByRole('alert')
  })
})
