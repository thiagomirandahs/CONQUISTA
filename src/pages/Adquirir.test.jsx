// Catálogo público de planos (item 4): dado vem do serviço (que chama a RPC pública
// planos_disponiveis()), nunca hardcoded aqui — e "Quero este plano" linka pra /criar-clube com o
// plano na querystring. Produto é licença ANUAL (sem toggle mensal/anual): Pix/parcelamento/campanha
// vêm de precos[0].metadata, nunca hardcoded no componente.
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
  chave: 'anual', nome: 'Licença Anual', descricao: 'Tudo incluso', provisorio: false,
  recursos: null,
  precos: [{
    ciclo: 'anual', moeda: 'BRL', valor_centavos: 22990, provisorio: false,
    metadata: { pix_centavos: 19990, parcelas_cartao: 12, parcela_centavos: 1916, campanha: 'Clube Fundador — condição especial' },
  }],
}

beforeEach(() => vi.clearAllMocks())

describe('Adquirir', () => {
  it('lista o plano vindo do serviço, com preço/parcelamento/Pix/campanha do banco (nada hardcoded)', async () => {
    carregarPlanos.mockResolvedValue([PLANO])
    render(<MemoryRouter><Adquirir /></MemoryRouter>)
    await screen.findByText('Licença Anual')
    expect(screen.getByText(/pagamento online ainda não integrado/i)).toBeInTheDocument()
    expect(screen.getByText('R$ 229,90')).toBeInTheDocument()
    expect(screen.getByText(/12x de R\$ 19,16/)).toBeInTheDocument()
    expect(screen.getByText(/R\$ 199,90 no Pix/)).toBeInTheDocument()
    expect(screen.getByText(/Clube Fundador — condição especial/)).toBeInTheDocument()
    const cta = screen.getByRole('link', { name: /quero este plano/i })
    expect(cta).toHaveAttribute('href', '/criar-clube?plano=anual&ciclo=anual')
  })

  it('plano sem metadata (ex.: plano legado arquivado reaparecendo) não quebra — só não mostra parcelamento/Pix', async () => {
    carregarPlanos.mockResolvedValue([{ ...PLANO, precos: [{ ciclo: 'anual', moeda: 'BRL', valor_centavos: 22990, provisorio: false, metadata: {} }] }])
    render(<MemoryRouter><Adquirir /></MemoryRouter>)
    await screen.findByText('Licença Anual')
    expect(screen.queryByText(/no Pix/)).not.toBeInTheDocument()
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
