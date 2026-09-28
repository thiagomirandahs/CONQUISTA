import { describe, it, expect, beforeEach } from 'vitest'
import {
  normalizarPreferencias, aplicarPreferencias, lerPreferenciasLocais, guardarPreferenciasLocais,
  sincronizarComPerfil, escalaDaFonte, FONTES, CHAVE_LOCAL,
} from './acessibilidade.js'

const html = document.documentElement

describe('preferências de acessibilidade', () => {
  beforeEach(() => {
    localStorage.clear()
    html.style.fontSize = ''
    html.removeAttribute('data-contraste')
  })

  it('A− / A / A+ / A++ nessa ordem, crescendo', () => {
    expect(FONTES.map((f) => f.rotulo)).toEqual(['A−', 'A', 'A+', 'A++'])
    const esc = FONTES.map((f) => f.escala)
    expect([...esc].sort((a, b) => a - b)).toEqual(esc)
    expect(escalaDaFonte('normal')).toBe(1)
  })

  it('valor desconhecido vira o padrão (banco/localStorage nunca quebram a tela)', () => {
    expect(normalizarPreferencias({ fonte: 'gigante', alto_contraste: 'sim' })).toEqual({ fonte: 'normal', alto_contraste: false })
    expect(normalizarPreferencias(null)).toEqual({ fonte: 'normal', alto_contraste: false })
  })

  it('aplica no <html>: font-size em % (Tailwind usa rem) e atributo de contraste', () => {
    aplicarPreferencias({ fonte: 'enorme', alto_contraste: true })
    expect(html.style.fontSize).toBe('130%')
    expect(html.getAttribute('data-contraste')).toBe('alto')
    aplicarPreferencias({ fonte: 'normal', alto_contraste: false })
    expect(html.style.fontSize).toBe('')
    expect(html.hasAttribute('data-contraste')).toBe(false)
  })

  it('não mexe no tema claro/escuro', () => {
    html.setAttribute('data-theme', 'dark')
    aplicarPreferencias({ fonte: 'grande', alto_contraste: true })
    expect(html.getAttribute('data-theme')).toBe('dark')
    html.removeAttribute('data-theme')
  })

  it('cópia local: guarda e lê; JSON quebrado volta ao padrão', () => {
    guardarPreferenciasLocais({ fonte: 'grande', alto_contraste: true })
    expect(lerPreferenciasLocais()).toEqual({ fonte: 'grande', alto_contraste: true })
    localStorage.setItem(CHAVE_LOCAL, '{quebrado')
    expect(lerPreferenciasLocais()).toEqual({ fonte: 'normal', alto_contraste: false })
  })

  it('a conta manda: perfil com preferência sobrescreve o aparelho; perfil sem nada mantém', () => {
    guardarPreferenciasLocais({ fonte: 'pequena', alto_contraste: false })
    expect(sincronizarComPerfil({})).toBeNull()
    expect(lerPreferenciasLocais().fonte).toBe('pequena')
    sincronizarComPerfil({ fonte: 'enorme', alto_contraste: true })
    expect(lerPreferenciasLocais()).toEqual({ fonte: 'enorme', alto_contraste: true })
    expect(html.style.fontSize).toBe('130%')
  })
})
