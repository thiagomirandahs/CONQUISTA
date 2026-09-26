import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { TelaDeAbertura, EsqueletoTela } from './carregamento.jsx'
import { encerrarAbertura } from '../lib/abertura.js'
import { MARCA_PRODUTO } from '../lib/marca.js'

const css = readFileSync(join(process.cwd(), 'public', 'abertura.css'), 'utf8')
const html = readFileSync(join(process.cwd(), 'index.html'), 'utf8')

afterEach(() => { document.body.innerHTML = ''; vi.restoreAllMocks() })

describe('TelaDeAbertura', () => {
  it('mostra só a identidade do PRODUTO (nome, lema, emblema) — nunca a de um clube', () => {
    const { container } = render(<TelaDeAbertura />)
    expect(screen.getByText('DesbravaClube')).toBeInTheDocument()
    expect(screen.getByText(MARCA_PRODUTO.lema)).toBeInTheDocument()
    expect(container.querySelector('img').getAttribute('src')).toBe(MARCA_PRODUTO.logoUrl)
    // nada de texto de clube: todo texto visível é do produto (ou o aviso para leitor de tela)
    const textos = [...container.querySelectorAll('p, span')].map((n) => n.textContent)
    expect(textos).toEqual(['Carregando…', MARCA_PRODUTO.nome, MARCA_PRODUTO.lema])
    expect(screen.getByRole('status')).toBeInTheDocument()
  })

  it('é o mesmo visual da abertura sem JS do index.html (sem salto do HTML para o React)', () => {
    for (const classe of ['ab-emblema', 'ab-nome', 'ab-lema', 'ab-barra']) expect(html).toContain(`class="${classe}"`)
    expect(html).toContain('<p class="ab-nome">DesbravaClube</p>')
    expect(html).toContain(`<p class="ab-lema">${MARCA_PRODUTO.lema}</p>`)
    expect(html).toMatch(/<link rel="stylesheet" href="\/abertura.css"/)
    // <style> inline ganharia hash na CSP e desligaria o 'unsafe-inline' dos style={{}} do React
    expect(html).not.toMatch(/<style/)
  })

  it('respeita prefers-reduced-motion (sem respiração, brilho nem barra correndo)', () => {
    const bloco = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'))
    expect(bloco).toMatch(/animation:\s*none/)
    expect(bloco).toContain('.ab-barra i')
    expect(bloco).toContain('.ab-emblema img')
  })

  it('fundo azul-marinho em degradê (#0b1f4d → #07122f), nunca branco', () => {
    expect(css).toMatch(/#0b1f4d/)
    expect(css).toMatch(/#07122f/)
    expect(css).not.toMatch(/background:\s*#fff\s*;[^}]*inset/)
  })
})

describe('EsqueletoTela', () => {
  it('é silhueta com status acessível, sem texto visível nem spinner', () => {
    const { container } = render(<EsqueletoTela cartoes={2} />)
    expect(screen.getByRole('status')).toHaveTextContent('Carregando…')
    expect(container.querySelector('.sr-only').textContent).toBe('Carregando…')
    expect(container.querySelector('.animate-spin')).toBeNull()
    // o pulso é só com movimento permitido
    const pulsos = container.querySelectorAll('[class*="animate-pulse"]')
    expect(pulsos.length).toBeGreaterThan(0)
    for (const p of pulsos) expect(p.className).toContain('motion-safe:animate-pulse')
  })
})

describe('encerrarAbertura', () => {
  it('com movimento reduzido, tira a abertura na hora', () => {
    document.body.innerHTML = '<div id="abertura"></div>'
    const antes = window.matchMedia
    window.matchMedia = (q) => ({ matches: q.includes('reduce') })
    try {
      encerrarAbertura()
      expect(document.getElementById('abertura')).toBeNull()
    } finally { window.matchMedia = antes }
  })

  it('sem abertura na página, não faz nada (e não quebra)', () => {
    expect(() => encerrarAbertura()).not.toThrow()
  })
})
