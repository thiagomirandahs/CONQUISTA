// Cada fato do banco de perguntas DBV é conferido contra o manifesto do currículo (fonte única no repositório).
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { HISTORIA } from './historia.js'
import { MANUAL } from './manual.js'
import { SIMBOLOS } from './simbolos.js'
import { CLASSES, PISTAS, NUMEROS, perguntasQuiz, afirmacoesVF, pistasDeClasse } from './dbv.js'

const DIR = join(__dirname, '..', '..', '..', '..', 'supabase', 'curriculo-manifesto', 'classes')
const sem = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
const manifesto = Object.fromEntries(readdirSync(DIR).filter((f) => f.endsWith('.json')).map((f) => {
  const d = JSON.parse(readFileSync(join(DIR, f), 'utf8'))
  const reg = d.classe_regular
  const textos = reg.secoes.flatMap((s) => s.requisitos.map((r) => sem(r.descricao_resumida)))
  return [reg.id, { reg, av: d.classe_avancada, textos }]
}))

describe('banco de perguntas DBV x manifesto', () => {
  it('as 6 classes, idade, livro e avançada batem com o manifesto', () => {
    expect(Object.keys(manifesto).sort()).toEqual(CLASSES.map((c) => c.id).sort())
    for (const c of CLASSES) {
      const m = manifesto[c.id]
      expect(m.reg.nome, c.id).toBe(c.nome)
      expect(m.reg.idade_minima, c.id).toBe(c.idade)
      expect(m.av.nome, c.id).toBe(c.avancada)
      expect(m.textos.some((t) => t.includes(sem(`livro da classe: "${c.livro}"`))), `livro ${c.id}`).toBe(true)
    }
  })
  it('classes em ordem crescente de idade', () => {
    expect(CLASSES.map((c) => c.idade)).toEqual([...CLASSES.map((c) => c.idade)].sort((a, b) => a - b))
  })
  it.each(PISTAS)('pista só existe na classe certa: $busca', (x) => {
    for (const c of CLASSES) {
      const tem = manifesto[c.id].textos.some((t) => t.includes(x.busca))
      expect(tem, `${x.busca} em ${c.id}`).toBe(c.id === x.classe)
    }
  })
  it.each(NUMEROS)('contagem está no texto da classe: $busca', (x) => {
    expect(manifesto[x.classe].textos.some((t) => t.includes(x.busca)), x.busca).toBe(true)
  })
})

describe('história e manual', () => {
  it.each([...HISTORIA, ...MANUAL, ...SIMBOLOS])('$q', (h) => {
    expect(h.errados).toHaveLength(3)
    expect(new Set([h.certa, ...h.errados]).size).toBe(4)
    expect(h.t.split('{}')).toHaveLength(2)
    expect(h.e.length).toBeGreaterThan(5)
  })
})

describe('geradores', () => {
  const validar = (qs) => {
    expect(qs.length).toBeGreaterThan(20)
    for (const q of qs) {
      expect(q.p.length).toBeGreaterThan(5)
      expect(new Set(q.o).size).toBe(q.o.length)
      expect(q.c).toBeGreaterThanOrEqual(0)
      expect(q.c).toBeLessThan(q.o.length)
      expect(q.e).toBeTruthy()
    }
  }
  it('quiz: opções únicas, 4 opções, certa existe', () => {
    for (let i = 0; i < 20; i++) { const qs = perguntasQuiz(); validar(qs); expect(qs.every((q) => q.o.length === 4)).toBe(true) }
  })
  it('verdadeiro/falso: duas opções e as duas respostas aparecem', () => {
    for (let i = 0; i < 20; i++) {
      const qs = afirmacoesVF(); validar(qs)
      expect(qs.every((q) => q.o.join() === 'Verdadeiro,Falso')).toBe(true)
      expect(qs.some((q) => q.c === 0) && qs.some((q) => q.c === 1)).toBe(true)
    }
  })
  it('qual é a classe: 6 opções e a certa é a classe da pista', () => {
    const qs = pistasDeClasse()
    expect(qs.length).toBe(PISTAS.length)
    qs.forEach((q, i) => { expect(q.o.length).toBe(6); expect(q.o[q.c]).toBe(CLASSES.find((c) => c.id === PISTAS[i].classe).nome) })
  })
})
