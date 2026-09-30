// Identidade da Rede DBV (Fase 6): as cores vivem em variáveis --rede-* dentro de src/index.css, com um
// bloco para o tema claro e outro para o escuro. Este teste lê o CSS de verdade (não uma cópia) e garante:
//   1) as variáveis que as telas usam existem nos DOIS temas, escopadas em [data-rede];
//   2) tinta sobre fundo e ação sobre fundo passam de 4.5:1 (WCAG AA) nos dois temas;
//   3) texto sobre a ação, sobre o dourado e os selos também são legíveis;
//   4) o bloco antigo de override hex por hex (frágil) não voltou, e nada da rede usa azul/roxo Instagram.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'
import { razaoDeContraste } from './contraste.js'

// caminho pela raiz do projeto (o vitest roda de lá); import.meta.url não é file: no Windows
const css = readFileSync(join(process.cwd(), 'src', 'index.css'), 'utf8')

// pega o bloco `{...}` cujo seletor contém `seletor`
function bloco(seletorRegex) {
  const m = css.match(new RegExp(`${seletorRegex.source}\\s*\\{([^}]*)\\}`))
  if (!m) throw new Error(`bloco não encontrado: ${seletorRegex}`)
  return Object.fromEntries([...m[1].matchAll(/(--rede-[\w-]+)\s*:\s*([^;]+);/g)].map(([, k, v]) => [k, v.trim()]))
}

const claro = bloco(/:root,\s*\[data-rede\]/)
const escuro = bloco(/:root\[data-theme="dark"\],\s*:root\[data-theme="dark"\] \[data-rede\]/)

const OBRIGATORIAS = [
  '--rede-bg', '--rede-superficie', '--rede-ink', '--rede-ink-suave', '--rede-linha', '--rede-acao', '--rede-sobre-acao',
  '--rede-acao-suave', '--rede-destaque', '--rede-destaque-suave', '--rede-destaque-texto', '--rede-sobre-destaque',
  '--rede-ambar', '--rede-curtido',
]

describe('variáveis --rede-* da identidade da Rede DBV', () => {
  it('existem nos dois temas, escopadas em [data-rede]', () => {
    for (const v of OBRIGATORIAS) {
      expect(claro[v], `${v} no tema claro`).toMatch(/^#[0-9a-f]{6}$/i)
      expect(escuro[v], `${v} no tema escuro`).toMatch(/^#[0-9a-f]{6}$/i)
    }
  })

  it('o tema escuro é escuro de verdade e o claro é claro (não são o mesmo valor)', () => {
    expect(claro['--rede-bg']).not.toBe(escuro['--rede-bg'])
    expect(razaoDeContraste(claro['--rede-bg'], '#ffffff')).toBeLessThan(1.5)
    expect(razaoDeContraste(escuro['--rede-bg'], '#000000')).toBeLessThan(2)
  })

  it('fundo marinho e dourado de destaque: a paleta do produto, sem azul-elétrico nem roxo', () => {
    expect(escuro['--rede-bg']).toBe('#07122f')          // azul-marinho do DesbravaClube
    expect(claro['--rede-acao']).toBe('#0b1f4d')         // marinho como ação no claro
    expect(css).not.toMatch(/3b5bff|8b5cf6|6d28d9|4b3cff/i)  // cores do visual Instagram/roxo antigo
  })

  describe.each([['claro', claro], ['escuro', escuro]])('contraste no tema %s (WCAG AA)', (_, t) => {
    const pares = [
      ['ink sobre bg', t['--rede-ink'], t['--rede-bg']],
      ['ink sobre superfície', t['--rede-ink'], t['--rede-superficie']],
      ['ink-suave sobre bg', t['--rede-ink-suave'], t['--rede-bg']],
      ['ação sobre bg (links, #hashtags, aba ativa)', t['--rede-acao'], t['--rede-bg']],
      ['ação sobre superfície', t['--rede-acao'], t['--rede-superficie']],
      ['texto sobre a ação (botão marinho)', t['--rede-sobre-acao'], t['--rede-acao']],
      ['ação sobre ação-suave (selo desafio)', t['--rede-acao'], t['--rede-acao-suave']],
      ['texto sobre o dourado (selo de coordenação, botão do story)', t['--rede-sobre-destaque'], t['--rede-destaque']],
      ['texto dourado sobre dourado-suave (selo conquista)', t['--rede-destaque-texto'], t['--rede-destaque-suave']],
    ]
    it.each(pares)('%s ≥ 4.5:1', (_, frente, fundo) => {
      expect(razaoDeContraste(frente, fundo)).toBeGreaterThanOrEqual(4.5)
    })
    it('coração curtido e risco dourado da barra são visíveis (≥ 3:1, elementos gráficos)', () => {
      expect(razaoDeContraste(t['--rede-curtido'], t['--rede-bg'])).toBeGreaterThanOrEqual(3)
      expect(razaoDeContraste(t['--rede-destaque'], t['--rede-bg'])).toBeGreaterThanOrEqual(3)
      expect(razaoDeContraste(t['--rede-ambar'], t['--rede-bg'])).toBeGreaterThanOrEqual(3)
    })
  })

  it('o override frágil hex por hex do tema escuro foi embora', () => {
    expect(css).not.toMatch(/\[data-rede\] \.bg-\\\[\\#/)
    expect(css).not.toMatch(/\[data-rede\] \.text-\\\[\\#/)
    expect(css).not.toMatch(/\[data-rede\] \.border-\\\[\\#/)
  })
})
