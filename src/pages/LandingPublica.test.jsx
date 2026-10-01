// Página pública refeita com as telas REAIS do app: CTAs, seções, imagens (alt/tamanho/lazy), veracidade
// (nada de marca antiga, gateway, localhost ou recurso em preparação), metadados por rota e arquivos estáticos.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { urlPublicaDoSite, URL_IMAGEM_COMPARTILHAR } from '../lib/dominios.js'

vi.mock('../services/comercial.js', async () => {
  const real = await vi.importActual('../services/comercial.js')
  return { ...real, carregarPlanos: async () => [] }
})
vi.mock('../services/vitrine.js', async () => {
  const real = await vi.importActual('../services/vitrine.js')
  return { ...real, parceirosDoSite: async () => [] }
})
const { default: Landing } = await import('./Landing.jsx')
const { META_LANDING } = await import('./landing/conteudo.js')

const renderT = () => render(<MemoryRouter><Landing /></MemoryRouter>)

describe('Landing pública (telas reais)', () => {
  beforeEach(() => { document.head.querySelectorAll('link[rel="canonical"]').forEach((e) => e.remove()) })

  it('CTAs do hero: "Conhecer o DesbravaClube" leva a /conheca e "Ver planos" leva a /planos', () => {
    renderT()
    const hero = document.getElementById('inicio')
    expect(within(hero).getByRole('link', { name: /Conhecer o DesbravaClube/ })).toHaveAttribute('href', '/conheca')
    expect(within(hero).getByRole('link', { name: 'Ver planos' })).toHaveAttribute('href', '/planos')
    for (const l of screen.getAllByRole('link', { name: 'Ver planos' })) expect(l).toHaveAttribute('href', '/planos')
    expect(within(hero).getByRole('heading', { level: 1 })).toHaveTextContent('DesbravaClube')
    expect(hero).toHaveTextContent('Uma plataforma para gestão, desenvolvimento e conexão dos Clubes de Desbravadores.')
  })

  it('tem as seções esperadas, na ordem da página', () => {
    renderT()
    const ids = ['inicio', 'recursos', 'como-funciona', 'fluxo', 'classes', 'rede', 'gestao', 'seguranca', 'planos', 'faq']
    const noDom = ids.map((id) => document.getElementById(id))
    noDom.forEach((el, i) => expect(el, ids[i]).not.toBeNull())
    for (let i = 1; i < noDom.length; i++) {
      expect(noDom[i - 1].compareDocumentPosition(noDom[i]) & Node.DOCUMENT_POSITION_FOLLOWING, ids[i]).toBeTruthy()
    }
    expect(within(document.getElementById('recursos')).getAllByRole('heading', { level: 3 }).map((h) => h.textContent))
      .toEqual(['Minha Classe', 'Rede DBV', 'Gestão', 'Desenvolvimento', 'Família', 'Coordenação'])
    expect(document.getElementById('fluxo').querySelectorAll('ol > li')).toHaveLength(7)
    expect(document.querySelectorAll('#como-funciona ul[aria-label="Telas do aplicativo"] > li')).toHaveLength(4)
  })

  it('imagens: toda <img> tem alt, width e height; só a do hero é prioritária e as demais são lazy', () => {
    renderT()
    const imgs = [...document.querySelectorAll('img')]
    expect(imgs.length).toBeGreaterThanOrEqual(8)
    for (const img of imgs) {
      expect(img.hasAttribute('alt'), img.src).toBe(true)
      expect(img.getAttribute('width'), img.src).toBeTruthy()
      expect(img.getAttribute('height'), img.src).toBeTruthy()
    }
    const telas = imgs.filter((i) => i.getAttribute('src').startsWith('/landing/app/'))
    for (const img of telas) expect(img.getAttribute('alt').length, img.src).toBeGreaterThan(30)
    const prioritarias = telas.filter((i) => i.getAttribute('fetchpriority') === 'high')
    expect(prioritarias).toHaveLength(1)
    expect(document.getElementById('inicio').contains(prioritarias[0])).toBe(true)
    expect(prioritarias[0].getAttribute('loading')).toBeNull()
    for (const img of telas.filter((i) => i !== prioritarias[0])) expect(img.getAttribute('loading'), img.src).toBe('lazy')
    expect(imgs.some((i) => i.getAttribute('src') === '/icon-192.png')).toBe(true) // logo oficial do produto
  })

  it('não usa a marca antiga, gateway, endereço local nem recursos em preparação', () => {
    const { container } = renderT()
    const texto = container.textContent
    expect(texto).not.toMatch(/gateway/i)
    expect(texto).not.toMatch(/\bConquista\b/)
    expect(container.innerHTML).not.toMatch(/localhost|127\.0\.0\.1/)
    expect(texto).not.toMatch(/audiolivro|audiobook|Classes? de Lideran|v[íi]deo/i)
    expect(texto).not.toMatch(/pagamento online ainda|pague (pelo|no) (app|aplicativo)/i)
  })

  it('Rede DBV: não é rede social aberta e vale para clubes habilitados', () => {
    renderT()
    const rede = document.getElementById('rede')
    expect(within(rede).getByRole('heading', { name: 'Uma comunidade para os Clubes' })).toBeInTheDocument()
    expect(within(rede).getByText('Não é uma rede social aberta')).toBeInTheDocument()
    expect(within(rede).getByText('Disponível para clubes habilitados')).toBeInTheDocument()
    expect(rede.textContent).toMatch(/Moderação/)
  })

  it('administração centralizada aparece em uma frase, sem detalhes internos', () => {
    renderT()
    const bloco = screen.getByRole('region', { name: 'Administração da plataforma' })
    expect(bloco.textContent.split('.').filter(Boolean)).toHaveLength(1)
    expect(bloco.textContent).not.toMatch(/auditoria|armazenamento|painel|licen/i)
  })

  it('título, descrição, canonical, Open Graph e imagem de compartilhamento vêm do domínio canônico', () => {
    renderT()
    expect(document.title).toBe(META_LANDING.titulo)
    expect(document.head.querySelector('meta[name="description"]').getAttribute('content')).toBe(META_LANDING.descricao)
    expect(document.head.querySelector('link[rel="canonical"]').getAttribute('href')).toBe('https://desbravaclube.com.br/')
    expect(document.head.querySelector('meta[property="og:url"]').getAttribute('content')).toBe('https://desbravaclube.com.br/')
    expect(document.head.querySelector('meta[property="og:image"]').getAttribute('content')).toBe(URL_IMAGEM_COMPARTILHAR)
    expect(document.head.querySelector('meta[name="twitter:image"]').getAttribute('content')).toBe(URL_IMAGEM_COMPARTILHAR)
  })
})

describe('metadados estáticos (index.html, robots, manifest) e URL canônica', () => {
  const RAIZ = join(import.meta.dirname, '..', '..')
  const ler = (f) => readFileSync(join(RAIZ, f), 'utf8')

  it('urlPublicaDoSite sempre aponta para https://desbravaclube.com.br', () => {
    expect(urlPublicaDoSite('/conheca')).toBe('https://desbravaclube.com.br/conheca')
    expect(urlPublicaDoSite('planos')).toBe('https://desbravaclube.com.br/planos')
    expect(URL_IMAGEM_COMPARTILHAR).toBe('https://desbravaclube.com.br/og-desbravaclube.png')
  })

  it('index.html: canonical, Open Graph completo (pt_BR, imagem absoluta 1200x630), Twitter large e theme-color', () => {
    const html = ler('index.html')
    expect(html).toMatch(/<link rel="canonical" href="https:\/\/desbravaclube\.com\.br\/" \/>/)
    for (const re of [
      /property="og:type" content="website"/, /property="og:locale" content="pt_BR"/, /property="og:title"/, /property="og:description"/,
      /property="og:url" content="https:\/\/desbravaclube\.com\.br\/"/, /property="og:image" content="https:\/\/desbravaclube\.com\.br\/og-desbravaclube\.png"/,
      /property="og:image:width" content="1200"/, /property="og:image:height" content="630"/, /name="twitter:card" content="summary_large_image"/,
      /name="theme-color" content="#07122f"/, /rel="apple-touch-icon"/,
    ]) expect(html).toMatch(re)
    expect(html).not.toMatch(/Conquista/)
    expect(readFileSync(join(RAIZ, 'public', 'og-desbravaclube.png')).subarray(1, 4).toString()).toBe('PNG')
  })

  it('robots.txt libera só as páginas públicas; o manifest se chama DesbravaClube', () => {
    const robots = ler('public/robots.txt')
    for (const rota of ['/$', '/conheca', '/planos', '/adquirir']) expect(robots).toContain(`Allow: ${rota}`)
    expect(robots).toMatch(/Disallow: \/\s*$/m)
    const vite = ler('vite.config.js')
    expect(vite).toMatch(/name: 'DesbravaClube'/)
    expect(vite).toMatch(/short_name: 'DesbravaClube'/)
  })
})

// SEO: canonical/og:url estáticos do index.html são do SITE; no domínio do app (app.*) o script do index.html os remove.
describe('index.html: canonical só no site, não no domínio do app', () => {
  const html = readFileSync(join(process.cwd(), 'index.html'), 'utf8')
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1])
  const rodar = (hostname) => {
    document.head.innerHTML = '<link rel="canonical" href="https://desbravaclube.com.br/"><meta property="og:url" content="https://desbravaclube.com.br/">'
    // eslint-disable-next-line no-new-func
    for (const codigo of scripts) new Function('location', codigo)({ hostname })
    return { canonical: !!document.head.querySelector('link[rel="canonical"]'), ogUrl: !!document.head.querySelector('meta[property="og:url"]') }
  }
  it('app.desbravaclube.com.br: sem canonical nem og:url', () => {
    expect(rodar('app.desbravaclube.com.br')).toEqual({ canonical: false, ogUrl: false })
    expect(rodar('APP.desbravaclube.com.br')).toEqual({ canonical: false, ogUrl: false })
  })
  it('site e dev: mantém', () => {
    expect(rodar('desbravaclube.com.br')).toEqual({ canonical: true, ogUrl: true })
    expect(rodar('www.desbravaclube.com.br')).toEqual({ canonical: true, ogUrl: true })
    expect(rodar('localhost')).toEqual({ canonical: true, ogUrl: true })
  })
})
