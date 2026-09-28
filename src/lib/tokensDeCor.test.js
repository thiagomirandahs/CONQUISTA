import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { razaoDeContraste } from '../ui/contraste.js'

// Contrato de contraste dos TOKENS (não tela por tela): texto secundário (text-muted/text-faint)
// e o texto principal passam de 4.5:1 (WCAG AA, texto normal) sobre todos os fundos do tema,
// no claro, no escuro e com o alto contraste ligado em cada um.
const css = readFileSync(join(process.cwd(), 'src', 'index.css'), 'utf8')

function bloco(seletor) {
  const i = css.indexOf(`${seletor} {`)
  if (i < 0) throw new Error(`bloco ${seletor} não achado no index.css`)
  const corpo = css.slice(i, css.indexOf('}', i))
  const out = {}
  for (const m of corpo.matchAll(/--c-([a-z0-9]+):\s*(#[0-9a-fA-F]{6})\b/g)) out[m[1]] = m[2]
  return out
}

const claro = bloco(':root')
const escuro = { ...claro, ...bloco(':root[data-theme="dark"]') }
const claroAlto = { ...claro, ...bloco(':root[data-contraste="alto"]') }
const escuroAlto = { ...escuro, ...bloco(':root[data-theme="dark"][data-contraste="alto"]') }

// fim do degradê do palco (--stage) — o fundo mais "difícil" do tema claro / escuro
const PALCO = { claro: '#e9eefb', escuro: '#0a1130' }

const casos = [
  ['claro', claro, PALCO.claro], ['escuro', escuro, PALCO.escuro],
  ['claro + alto contraste', claroAlto, PALCO.claro], ['escuro + alto contraste', escuroAlto, PALCO.escuro],
]

describe('tokens de cor: contraste ≥ 4.5:1', () => {
  for (const [nome, t, palco] of casos) {
    it(nome, () => {
      for (const texto of ['ink', 'muted', 'faint']) {
        for (const fundo of [t.bg, t.surface, t.surface2, palco]) {
          const r = razaoDeContraste(t[texto], fundo)
          expect(r, `${nome}: ${texto} ${t[texto]} sobre ${fundo} = ${r?.toFixed(2)}`).toBeGreaterThanOrEqual(4.5)
        }
      }
    })
  }

  it('alto contraste deixa o texto secundário MAIS forte que o normal', () => {
    expect(razaoDeContraste(claroAlto.faint, claro.surface)).toBeGreaterThan(razaoDeContraste(claro.faint, claro.surface))
    expect(razaoDeContraste(escuroAlto.faint, escuro.surface)).toBeGreaterThan(razaoDeContraste(escuro.faint, escuro.surface))
  })

  it('movimento reduzido: a regra global zera animações e transições', () => {
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*animation-duration: 0\.001ms !important/)
  })
})
