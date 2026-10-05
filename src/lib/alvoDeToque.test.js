// Mobile-first (fase 7): nenhum botão de ícone com menos de 44 px nas telas varridas.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

describe('alvos de toque ≥ 44 px', () => {
  it.each(['src/pages/Mural.jsx', 'src/pages/Ranking.jsx', 'src/pages/Unidades.jsx'])('%s não tem botão w-8/w-9', (arq) => {
    const linhas = readFileSync(arq, 'utf8').split('\n').filter((l) => /<button/.test(l) && /\b(w|h)-(6|7|8|9|10)\b/.test(l))
    expect(linhas).toEqual([])
  })
})

describe('campos de texto no iPhone', () => {
  it('em tela de toque, input/textarea/select têm fonte de pelo menos 16px (senão o Safari dá zoom ao focar e não volta)', () => {
    const css = readFileSync('src/index.css', 'utf8')
    const bloco = css.slice(css.indexOf('iPhone (PWA/Safari)'))
    expect(bloco).toMatch(/@media \(pointer: coarse\)/)
    expect(bloco).toMatch(/textarea/)
    expect(bloco).toMatch(/font-size:\s*max\(16px,\s*1em\)/)
  })
})
