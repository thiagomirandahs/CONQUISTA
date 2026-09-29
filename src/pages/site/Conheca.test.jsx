// /conheca: apresentação do produto em 8 etapas (Fase 6, item 7) — estrutura, navegação, link direto e vídeo sob demanda.
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

vi.mock('../../services/comercial.js', async () => ({ ...(await vi.importActual('../../services/comercial.js')), carregarPlanos: async () => [] }))

const { default: Conheca, VideoCurto } = await import('./Conheca.jsx')
const { ETAPAS, ORIGEM_DO_PLAYER, urlDoVideo, indiceDoHash } = await import('../../lib/apresentacao/etapas.js')

const abrir = (caminho = '/conheca') => render(
  <MemoryRouter initialEntries={[caminho]}><Routes><Route path="/conheca" element={<Conheca />} /></Routes></MemoryRouter>,
)
const palco = () => screen.getByRole('region', { name: /^Etapa \d de 8$/ })
const tituloAtual = () => within(palco()).getByRole('heading', { level: 2 }).textContent

describe('conteúdo (src/lib/apresentacao/etapas.js)', () => {
  it('são 8 etapas numeradas de 1 a 8, com id, título e descrição curta', () => {
    expect(ETAPAS).toHaveLength(8)
    ETAPAS.forEach((e, i) => {
      expect(e.numero).toBe(i + 1)
      expect(e.id).toMatch(/^[a-z-]+$/)
      expect(e.titulo.length).toBeGreaterThan(3)
      expect(e.descricao.length).toBeGreaterThan(80)
      expect(e.descricao.length).toBeLessThan(420)
    })
    expect(ETAPAS.map((e) => e.titulo)).toEqual([
      'O que é o DesbravaClube', 'Criando ou entrando em um clube', 'Área do Desbravador', 'Classes e requisitos',
      'Especialidades', 'Rede DBV', 'Gestão do clube', 'Coordenação e administração',
    ])
  })
  it('por enquanto nenhuma etapa tem vídeo (estrutura pronta, conteúdo depois)', () => {
    expect(ETAPAS.every((e) => e.video === undefined)).toBe(true)
  })
  it('o embed é sempre do youtube-nocookie (a única origem em frame-src da CSP) e o id é saneado', () => {
    expect(ORIGEM_DO_PLAYER).toBe('https://www.youtube-nocookie.com')
    expect(urlDoVideo('abc_DEF-123')).toBe('https://www.youtube-nocookie.com/embed/abc_DEF-123?autoplay=1&rel=0')
    expect(urlDoVideo('x"/><script>')).toBe('https://www.youtube-nocookie.com/embed/xscript?autoplay=1&rel=0')
  })
  it('indiceDoHash: #etapa-4 → 3; fora do intervalo ou sem hash → 0', () => {
    expect(indiceDoHash('#etapa-4')).toBe(3)
    expect(indiceDoHash('#etapa-1')).toBe(0)
    expect(indiceDoHash('#etapa-9')).toBe(0)
    expect(indiceDoHash('#etapa-0')).toBe(0)
    expect(indiceDoHash('')).toBe(0)
    expect(indiceDoHash('#outra')).toBe(0)
  })
})

describe('/conheca', () => {
  it('abre na etapa 1 com o stepper de 8 paradas e a ilustração-padrão (sem imagem ainda)', () => {
    abrir()
    expect(document.title).toBe('Conheça o DesbravaClube')
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Conheça o DesbravaClube')
    const stepper = screen.getByRole('list', { name: 'Etapas' })
    expect(within(stepper).getAllByRole('button')).toHaveLength(8)
    expect(within(stepper).getByRole('button', { name: /^Etapa 1:/ })).toHaveAttribute('aria-current', 'step')
    expect(tituloAtual()).toBe('O que é o DesbravaClube')
    expect(screen.getByTestId('ilustracao-padrao')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Quero começar' })).toBeNull()
    expect(document.querySelector('iframe')).toBeNull()
  })

  it('Próximo/Anterior avançam e voltam; Anterior fica desabilitado na primeira', async () => {
    abrir()
    const anterior = screen.getByRole('button', { name: 'Anterior' })
    expect(anterior).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: 'Próximo' }))
    expect(tituloAtual()).toBe('Criando ou entrando em um clube')
    expect(anterior).toBeEnabled()
    const pontos = screen.getByRole('list', { name: 'Progresso' })
    expect(within(pontos).getByRole('button', { name: 'Ir para a etapa 2' })).toHaveAttribute('aria-current', 'step')
    expect(within(pontos).getByRole('button', { name: 'Ir para a etapa 1' })).not.toHaveAttribute('aria-current')
    await userEvent.click(anterior)
    expect(tituloAtual()).toBe('O que é o DesbravaClube')
  })

  it('setas do teclado, Home e End navegam', async () => {
    abrir()
    palco().focus()
    await userEvent.keyboard('{ArrowRight}{ArrowRight}')
    expect(tituloAtual()).toBe('Área do Desbravador')
    await userEvent.keyboard('{ArrowLeft}')
    expect(tituloAtual()).toBe('Criando ou entrando em um clube')
    await userEvent.keyboard('{End}')
    expect(tituloAtual()).toBe('Coordenação e administração')
    await userEvent.keyboard('{Home}')
    expect(tituloAtual()).toBe('O que é o DesbravaClube')
  })

  it('arrastar para a esquerda avança; arrasto curto ou vertical não muda nada', () => {
    abrir()
    const p = palco()
    fireEvent.touchStart(p, { touches: [{ clientX: 300, clientY: 100 }] })
    fireEvent.touchEnd(p, { changedTouches: [{ clientX: 100, clientY: 110 }] })
    expect(tituloAtual()).toBe('Criando ou entrando em um clube')
    fireEvent.touchStart(p, { touches: [{ clientX: 100, clientY: 100 }] })
    fireEvent.touchEnd(p, { changedTouches: [{ clientX: 120, clientY: 100 }] })
    expect(tituloAtual()).toBe('Criando ou entrando em um clube')
    fireEvent.touchStart(p, { touches: [{ clientX: 100, clientY: 100 }] })
    fireEvent.touchEnd(p, { changedTouches: [{ clientX: 160, clientY: 400 }] })
    expect(tituloAtual()).toBe('Criando ou entrando em um clube')
    fireEvent.touchStart(p, { touches: [{ clientX: 100, clientY: 100 }] })
    fireEvent.touchEnd(p, { changedTouches: [{ clientX: 300, clientY: 100 }] })
    expect(tituloAtual()).toBe('O que é o DesbravaClube')
  })

  it('link direto #etapa-4 abre na quarta etapa', () => {
    abrir('/conheca#etapa-4')
    expect(tituloAtual()).toBe('Classes e requisitos')
    expect(screen.getByRole('button', { name: /^Etapa 4:/ })).toHaveAttribute('aria-current', 'step')
    expect(document.getElementById('etapa-4')).not.toBeNull()
  })

  it('a última etapa troca "Próximo" pelo CTA "Quero começar" → /adquirir', async () => {
    abrir('/conheca#etapa-8')
    expect(screen.queryByRole('button', { name: 'Próximo' })).toBeNull()
    const ctas = screen.getAllByRole('link', { name: /Quero começar/ })
    expect(ctas.length).toBeGreaterThanOrEqual(1)
    ctas.forEach((l) => expect(l).toHaveAttribute('href', '/adquirir'))
  })

  it('o stepper leva direto a qualquer etapa', async () => {
    abrir()
    await userEvent.click(screen.getByRole('button', { name: /^Etapa 6:/ }))
    expect(tituloAtual()).toBe('Rede DBV')
  })
})

describe('VideoCurto', () => {
  it('só mostra o poster com play; o iframe do youtube-nocookie nasce depois do clique e nunca antes', async () => {
    render(<VideoCurto youtubeId="dQw4w9WgXcQ" titulo="Teste" />)
    expect(document.querySelector('iframe')).toBeNull()
    const play = screen.getByRole('button', { name: 'Assistir ao vídeo: Teste' })
    await userEvent.click(play)
    const iframe = document.querySelector('iframe')
    expect(iframe).not.toBeNull()
    expect(iframe.getAttribute('src')).toBe('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1&rel=0')
    expect(iframe.getAttribute('src').startsWith(ORIGEM_DO_PLAYER + '/')).toBe(true)
    expect(iframe).toHaveAttribute('title', 'Vídeo: Teste')
    expect(iframe).toHaveAttribute('loading', 'lazy')
    expect(document.querySelector('video')).toBeNull()
  })
})
