import { describe, it, expect } from 'vitest'
import { filtrar, termoDoRequisito, normalizar } from './catalogoEspecialidades.js'

const L = [
  { codigo: 'AR-050', nome: 'Acampamento I', area: 'AR' },
  { codigo: 'AR-051', nome: 'Acampamento II', area: 'AR' },
  { codigo: 'AR-001', nome: 'Nós e Amarras', area: 'AR' },
  { codigo: 'EN-006', nome: 'Árvores', area: 'EN' },
]

describe('catálogo de especialidades', () => {
  it('busca sem acento, por nome ou código, e filtra por área', () => {
    expect(filtrar(L, { busca: 'nos' }).map((e) => e.codigo)).toEqual(['AR-001'])
    expect(filtrar(L, { busca: 'arvores' }).map((e) => e.codigo)).toEqual(['EN-006'])
    expect(filtrar(L, { busca: 'ar-05' })).toHaveLength(2)
    expect(filtrar(L, { area: 'EN' })).toHaveLength(1)
    expect(filtrar(L, {})).toHaveLength(4)
  })
  it('requisito de classe vira atalho para o catálogo', () => {
    expect(termoDoRequisito('Completar a especialidade de Acampamento I.')).toBe('Acampamento I')
    expect(termoDoRequisito('Completar a especialidade de Cidadania cristã, se ainda não a tiver feito.')).toBe('Cidadania cristã')
    expect(termoDoRequisito('Completar 1 destas especialidades: Felinos, Cães ou Aves.')).toBe('')
    expect(termoDoRequisito('Ter pelo menos 10 anos de idade.')).toBeNull()
  })
  it('normaliza', () => { expect(normalizar('  Árvores  E  ')).toBe('arvores e') })
})
