// Vitrine do site: /clubes (opt-in), /clubes/:slug (cartão de visita), /parceiros (links patrocinados)
// e o editor do cartão nas Configurações do clube (pré-visualização = só o que é publicado).
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

const f = {
  clubesDaVitrine: vi.fn(), cartaoDoClube: vi.fn(), parceirosDoSite: vi.fn(),
  lerCartaoDoClube: vi.fn(), salvarCartaoDoClube: vi.fn(),
}
vi.mock('../../services/vitrine.js', async () => {
  const real = await vi.importActual('../../services/vitrine.js')
  return { ...real, ...Object.fromEntries(Object.keys(f).map((k) => [k, (...a) => f[k](...a)])) }
})
vi.mock('../../services/comercial.js', async () => ({ ...(await vi.importActual('../../services/comercial.js')), carregarPlanos: async () => [] }))

const { default: SiteClubes } = await import('./SiteClubes.jsx')
const { default: SiteCartaoClube } = await import('./SiteCartaoClube.jsx')
const { default: SiteParceiros } = await import('./SiteParceiros.jsx')
const { default: ClubeVitrine, errosDoCartao } = await import('../ClubeVitrine.jsx')

const em = (caminho, el, rota = caminho) => render(
  <MemoryRouter initialEntries={[caminho]}><Routes><Route path={rota} element={el} /></Routes></MemoryRouter>,
)

beforeEach(() => { Object.values(f).forEach((m) => m.mockReset()); f.parceirosDoSite.mockResolvedValue([]) })

describe('/clubes', () => {
  it('lista os cartões publicados com link para o cartão do clube', async () => {
    f.clubesDaVitrine.mockResolvedValue([{ slug: 'clube-x', nome: 'Clube X', sigla: 'CX', cidade: 'Recife', estado: 'PE', cor: '#123456' }])
    em('/clubes', <SiteClubes />)
    const cartao = await screen.findByTestId('cartao-clube')
    expect(cartao).toHaveAttribute('href', '/clubes/clube-x')
    expect(within(cartao).getByText('Recife · PE')).toBeInTheDocument()
    expect(document.title).toMatch(/Clubes que estão com a gente/)
  })

  it('sem clube na vitrine: estado vazio (nenhum clube aparece sem ativação)', async () => {
    f.clubesDaVitrine.mockResolvedValue([])
    em('/clubes', <SiteClubes />)
    expect(await screen.findByText(/os primeiros clubes aparecem aqui/)).toBeInTheDocument()
    expect(screen.queryByTestId('cartao-clube')).toBeNull()
  })
})

describe('/clubes/:slug', () => {
  const CLUBE = {
    encontrado: true, slug: 'clube-x', nome: 'Clube X', sigla: 'CX', lema: 'Sempre alerta', cidade: 'Recife', estado: 'PE',
    apresentacao: 'Venha conhecer!', reuniao_dia: 'Domingo', reuniao_horario: '8h', reuniao_local: 'Igreja Central',
    diretor_nome: 'Maria', whatsapp: '5581999998888',
  }
  it('cartão com WhatsApp e "Quero participar"; título dinâmico', async () => {
    f.cartaoDoClube.mockResolvedValue(CLUBE)
    em('/clubes/clube-x', <SiteCartaoClube />, '/clubes/:slug')
    expect(await screen.findByRole('heading', { name: 'Clube X', level: 1 })).toBeInTheDocument()
    expect(f.cartaoDoClube).toHaveBeenCalledWith('clube-x')
    expect(screen.getByRole('link', { name: /chamar no whatsapp/i }).getAttribute('href')).toMatch(/^https:\/\/wa\.me\/5581999998888\?text=/)
    // sem link de inscrição publicado, "Quero participar" cai no WhatsApp
    expect(screen.getByRole('link', { name: /quero participar/i }).getAttribute('href')).toMatch(/^https:\/\/wa\.me\//)
    expect(document.title).toBe('Clube X — Clube de Desbravadores')
    expect(document.querySelector('meta[name="description"]').getAttribute('content')).toBe('Venha conhecer!')
  })

  it('link de inscrição publicado vira o destino de "Quero participar"; javascript: é ignorado', async () => {
    f.cartaoDoClube.mockResolvedValue({ ...CLUBE, link_inscricao: 'https://app.desbravaclube.com.br/entrar?codigo=ABC' })
    const { unmount } = em('/clubes/clube-x', <SiteCartaoClube />, '/clubes/:slug')
    expect(await screen.findByRole('link', { name: /quero participar/i })).toHaveAttribute('href', 'https://app.desbravaclube.com.br/entrar?codigo=ABC')
    unmount()
    f.cartaoDoClube.mockResolvedValue({ ...CLUBE, whatsapp: undefined, link_inscricao: 'javascript:alert(1)' })
    em('/clubes/clube-x', <SiteCartaoClube />, '/clubes/:slug')
    await screen.findByRole('heading', { name: 'Clube X', level: 1 })
    expect(screen.queryByRole('link', { name: /quero participar/i })).toBeNull()
  })

  it('clube desligado/inexistente: mensagem neutra', async () => {
    f.cartaoDoClube.mockResolvedValue({ encontrado: false })
    em('/clubes/nada', <SiteCartaoClube />, '/clubes/:slug')
    expect(await screen.findByText('Este clube não está na vitrine.')).toBeInTheDocument()
  })
})

describe('/parceiros', () => {
  it('cartões com links patrocinados (rel noopener noreferrer sponsored)', async () => {
    f.parceirosDoSite.mockResolvedValue([
      { id: '1', nome: 'Loja A', link: 'https://loja-a.com.br', categoria: 'Loja', destaque: true },
      { id: '2', nome: 'Serviço B', whatsapp: '5581988887777' },
    ])
    em('/parceiros', <SiteParceiros />)
    expect(await screen.findAllByTestId('cartao-parceiro')).toHaveLength(2)
    const conhecer = screen.getByRole('link', { name: 'Conhecer' })
    expect(conhecer).toHaveAttribute('href', 'https://loja-a.com.br')
    expect(conhecer).toHaveAttribute('rel', 'noopener noreferrer sponsored')
    const zap = within(screen.getByRole('article', { name: 'Serviço B' })).getByRole('link', { name: /whatsapp/i })
    expect(zap).toHaveAttribute('rel', 'noopener noreferrer sponsored')
  })

  it('sem parceiros no ar: estado vazio', async () => {
    em('/parceiros', <SiteParceiros />)
    expect(await screen.findByText(/primeiros parceiros aparecem aqui/)).toBeInTheDocument()
  })
})

describe('Configurações do clube › cartão na vitrine', () => {
  const MARCA = { nome: 'Clube X', sigla: 'CX', lema: null, corPrimaria: null, logoUrl: null }
  it('nasce desligado; ligar sem aceite e sem contato publicado é bloqueado antes de enviar', async () => {
    f.lerCartaoDoClube.mockResolvedValue({ ativo: false, aceite_contato: false, slug: 'clube-x' })
    render(<MemoryRouter><ClubeVitrine clubeId="c1" marca={MARCA} /></MemoryRouter>)
    const chave = await screen.findByTestId('vitrine-ativo')
    expect(chave).toHaveAttribute('aria-checked', 'false')
    await userEvent.click(chave)
    expect(screen.getByText(/aceite publicar o contato/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Salvar cartão' })).toBeDisabled()
    expect(f.salvarCartaoDoClube).not.toHaveBeenCalled()
  })

  it('pré-visualização mostra só o contato marcado para publicar', async () => {
    f.lerCartaoDoClube.mockResolvedValue({
      ativo: true, aceite_contato: true, slug: 'clube-x', diretor_nome: 'Maria Secreta', diretor_whatsapp: '5581999998888',
      diretor_email: 'maria@exemplo.com', publicar_whatsapp: true, publicar_nome: false, publicar_email: false,
    })
    render(<MemoryRouter><ClubeVitrine clubeId="c1" marca={MARCA} /></MemoryRouter>)
    await userEvent.click(await screen.findByRole('button', { name: /pré-visualizar/i }))
    const previa = screen.getByTestId('vitrine-previa')
    expect(within(previa).getByRole('link', { name: /chamar no whatsapp/i })).toBeInTheDocument()
    expect(within(previa).queryByText('Maria Secreta')).toBeNull()
    expect(within(previa).queryByText('maria@exemplo.com')).toBeNull()
  })

  it('errosDoCartao: regras do opt-in', () => {
    const base = { ativo: false, aceite_contato: false, publicar_nome: false, publicar_whatsapp: false, publicar_email: false,
      diretor_nome: '', diretor_whatsapp: '', diretor_email: '', link_inscricao: '' }
    expect(errosDoCartao(base)).toEqual([])
    expect(errosDoCartao({ ...base, ativo: true, aceite_contato: true, publicar_whatsapp: true, diretor_whatsapp: '81999998888' })).toEqual([])
    expect(errosDoCartao({ ...base, link_inscricao: 'ftp://x' })).toHaveLength(1)
    expect(errosDoCartao({ ...base, publicar_email: true })).toHaveLength(1)
  })
})
