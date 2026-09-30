// Mobile-first (fase 7): nenhum botão de ícone com menos de 44 px nas telas varridas.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

describe('alvos de toque ≥ 44 px', () => {
  it.each(['src/pages/Mural.jsx', 'src/pages/Ranking.jsx', 'src/pages/Unidades.jsx'])('%s não tem botão w-8/w-9', (arq) => {
    const linhas = readFileSync(arq, 'utf8').split('\n').filter((l) => /<button/.test(l) && /\b(w|h)-(6|7|8|9|10)\b/.test(l))
    expect(linhas).toEqual([])
  })
})
