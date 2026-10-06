import { describe, it, expect } from 'vitest'
import { readdirSync } from 'node:fs'
import { EMBLEMAS_ESPECIALIDADES } from './emblemasEspecialidades.js'

describe('índice de emblemas das especialidades', () => {
  it('bate com os arquivos de public/especialidades (se falhar: node scripts/emblemas-indice.mjs)', () => {
    const arquivos = readdirSync('public/especialidades').filter((f) => /^[a-z]{2}(-[a-z]{2})?-\d{3}\.(png|jpg|webp)$/.test(f)).sort()
    const indice = Object.entries(EMBLEMAS_ESPECIALIDADES).map(([c, e]) => `${c.toLowerCase()}.${e}`).sort()
    expect(indice).toEqual(arquivos)
  })
  it('há emblemas', () => { expect(Object.keys(EMBLEMAS_ESPECIALIDADES).length).toBeGreaterThan(400) })
})
