import { describe, it, expect } from 'vitest'
import { FERRAMENTAS, PAPEIS_POR_ROTA } from './permissoes.js'

describe('matriz de permissões', () => {
  it('toda ferramenta tem rota (to), título e ao menos um papel', () => {
    for (const f of FERRAMENTAS) {
      expect(f.to.startsWith('/')).toBe(true)
      expect(f.titulo).toBeTruthy()
      expect(Array.isArray(f.papeis) && f.papeis.length > 0).toBe(true)
    }
  })

  it('PAPEIS_POR_ROTA reflete exatamente a lista', () => {
    expect(Object.keys(PAPEIS_POR_ROTA).length).toBe(FERRAMENTAS.length)
    for (const f of FERRAMENTAS) {
      expect(PAPEIS_POR_ROTA[f.to]).toEqual(f.papeis)
    }
  })

  it('desbravador/pais NÃO têm acesso a nenhuma ferramenta de gestão', () => {
    for (const papeis of Object.values(PAPEIS_POR_ROTA)) {
      expect(papeis).not.toContain('desbravador')
      expect(papeis).not.toContain('pais')
    }
  })

  it('rotas sensíveis de dinheiro/temporada são as mais restritas', () => {
    expect(PAPEIS_POR_ROTA['/mensalidades']).toEqual(expect.arrayContaining(['tesoureiro', 'diretoria']))
    expect(PAPEIS_POR_ROTA['/temporada']).toEqual(['diretoria'])
  })
})
