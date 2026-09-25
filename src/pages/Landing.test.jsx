// Landing pública: acessível sem sessão, CTAs nas rotas reais, oferta vinda do backend (nada de preço
// fixo no código), menu móvel acessível e nenhuma promessa que o produto não cumpre.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'

const carregarPlanos = vi.fn()
vi.mock('../services/comercial.js', async () => {
  const real = await vi.importActual('../services/comercial.js')
  return { ...real, carregarPlanos: (...a) => carregarPlanos(...a) }
})
const { default: Landing } = await import('./Landing.jsx')

const LICENCA = {
  chave: 'anual', nome: 'Licença Anual', descricao: 'Tudo incluso.', recursos: null,
  limites: { membros: 300, clubes: 3 },
  precos: [{ ciclo: 'anual', moeda: 'BRL', valor_centavos: 22990, metadata: { pix_centavos: 19990, parcelas_cartao: 12, parcela_centavos: 1916, campanha: 'Clube Fundador' } }],
}

const renderT = () => render(<MemoryRouter><Landing /></MemoryRouter>)

beforeEach(() => { carregarPlanos.mockReset().mockResolvedValue([LICENCA]) })

describe('Landing', () => {
  it('CTA principal leva a /adquirir e "Já tenho conta" leva a /login', () => {
    renderT()
    expect(screen.getAllByRole('link', { name: /quero criar meu clube/i })[0]).toHaveAttribute('href', '/adquirir')
    expect(screen.getByRole('link', { name: /já tenho conta/i })).toHaveAttribute('href', '/login')
  })

  it('tem um único h1 e a navegação principal aponta para as seções', () => {
    renderT()
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    const nav = screen.getByRole('navigation', { name: 'Principal' })
    for (const [nome, href] of [['Funcionalidades', '#funcionalidades'], ['Para Clubes', '#para-clubes'], ['Documentos', '#documentos'], ['Planos', '#planos'], ['FAQ', '#faq']]) {
      expect(within(nav).getByRole('link', { name: nome })).toHaveAttribute('href', href)
      expect(document.querySelector(href)).not.toBeNull()
    }
  })

  it('menu móvel abre e fecha pelo botão e pelo Esc, devolvendo o foco', async () => {
    renderT()
    const botao = screen.getByRole('button', { name: 'Abrir menu' })
    expect(botao).toHaveAttribute('aria-expanded', 'false')
    expect(document.getElementById('menu-movel')).not.toBeVisible()
    await userEvent.click(botao)
    expect(botao).toHaveAttribute('aria-expanded', 'true')
    expect(document.getElementById('menu-movel')).toBeVisible()
    await userEvent.keyboard('{Escape}')
    expect(botao).toHaveAttribute('aria-expanded', 'false')
    expect(botao).toHaveFocus()
  })

  it('a oferta vem do catálogo do backend, com Pix, parcelamento e CTA para a aquisição real', async () => {
    renderT()
    expect(await screen.findByRole('heading', { name: 'Licença Anual' })).toBeInTheDocument()
    expect(screen.getByText(/R\$\s?229,90/)).toBeInTheDocument()
    expect(screen.getByText(/12x de R\$\s?19,16 sem juros/)).toBeInTheDocument()
    expect(screen.getByText(/R\$\s?199,90 no Pix/)).toBeInTheDocument()
    const cta = screen.getAllByRole('link', { name: 'Começar agora' }).find((l) => l.getAttribute('href').startsWith('/criar-clube'))
    expect(cta).toHaveAttribute('href', '/criar-clube?plano=anual&ciclo=anual')
  })

  it('se o catálogo falhar, oferece o caminho para /adquirir em vez de inventar preço', async () => {
    carregarPlanos.mockRejectedValue(new Error('rede'))
    renderT()
    expect(await screen.findByText(/Não conseguimos carregar a oferta/)).toBeInTheDocument()
    expect(screen.queryByText(/R\$/)).not.toBeInTheDocument()
  })

  it('não promete o que o produto não garante nem inventa contato', () => {
    const { container } = renderT()
    const texto = container.textContent
    expect(texto).not.toMatch(/validade jurídica/i)
    expect(texto).not.toMatch(/CNPJ|@[a-z0-9-]+\.[a-z]{2,}|\(\d{2}\)\s?\d{4,5}-?\d{4}/i)
  })

  it('o FAQ tem as 10 perguntas pedidas', () => {
    renderT()
    const faq = document.getElementById('faq')
    expect(faq.querySelectorAll('details')).toHaveLength(10)
  })
})
