import { describe, it, expect } from 'vitest'
import { podeSoltar, frasesDoMovimento, RAIZ } from './arrastarHierarquia.js'

const campo = { id: 'c1', tipo: 'campo', nome: 'Campo', parent_id: null, status: 'ativo' }
const regiao = { id: 'r1', tipo: 'regiao', nome: 'Região 1', parent_id: 'c1', status: 'ativo' }
const regiao2 = { id: 'r2', tipo: 'regiao', nome: 'Região 2', parent_id: 'c1', status: 'ativo' }
const dist = { id: 'd1', tipo: 'distrito', nome: 'Distrito 1', parent_id: 'r1', status: 'ativo' }
const distInativo = { id: 'd9', tipo: 'distrito', nome: 'Velho', parent_id: 'r1', status: 'inativo' }
const clube = { id: 'k1', tipo: 'clube', nome: 'Everest', parent_id: 'd1' }
const itens = [campo, regiao, regiao2, dist, distInativo, clube]

describe('arrastar na hierarquia', () => {
  it('clube vai para distrito, região ou campo ativos, ou fica sem unidade', () => {
    expect(podeSoltar(clube, regiao2, itens)).toBe(true)
    expect(podeSoltar(clube, campo, itens)).toBe(true)
    expect(podeSoltar(clube, RAIZ, itens)).toBe(true)
    expect(podeSoltar(clube, dist, itens)).toBe(false) // já está lá
    expect(podeSoltar(clube, distInativo, itens)).toBe(false)
    expect(podeSoltar(clube, { id: 'k2', tipo: 'clube' }, itens)).toBe(false)
  })
  it('unidade só vai para debaixo de um nível acima, nunca para dentro de si mesma', () => {
    expect(podeSoltar(dist, regiao2, itens)).toBe(true)
    expect(podeSoltar(dist, campo, itens)).toBe(true)
    expect(podeSoltar(regiao, dist, itens)).toBe(false) // distrito é nível abaixo
    expect(podeSoltar(regiao, regiao2, itens)).toBe(false) // mesmo nível
    expect(podeSoltar(campo, dist, itens)).toBe(false) // descendente
    expect(podeSoltar(regiao, RAIZ, itens)).toBe(true)
    expect(podeSoltar(campo, RAIZ, itens)).toBe(false) // já está no topo
  })
  it('a confirmação diz o que vai acontecer', () => {
    const r = { clube: 'Clube', regiao: 'Região', distrito: 'Distrito' }
    expect(frasesDoMovimento(clube, regiao2, r)).toMatch(/Mover Clube "Everest" para Região Região 2\?[\s\S]*coordenação/)
    expect(frasesDoMovimento(dist, RAIZ, r)).toMatch(/topo da árvore[\s\S]*vai junto/)
  })
})
