import { describe, it, expect, beforeEach } from 'vitest'
import { TOURS, IDS_DOS_TOURS, chaveDoTourDaArea, marcarTourDaAreaVisto, tourDaAreaVisto, tourPermitido, toursDoPapel } from './tours.js'
import { PASSOS_DO_TOUR, tourJaVisto } from './tutorial.js'

beforeEach(() => localStorage.clear())

describe('mini-tours', () => {
  it('existem os 4 tours, todos com passos (ícone, título, texto)', () => {
    expect(IDS_DOS_TOURS).toEqual(['primeiros-passos', 'classes', 'rede', 'gestao'])
    for (const id of IDS_DOS_TOURS) {
      expect(TOURS[id].passos.length, id).toBeGreaterThanOrEqual(3)
      for (const p of TOURS[id].passos) expect(p.icone && p.titulo && p.texto, id).toBeTruthy()
    }
  })
  it('primeiros-passos é o tour antigo (compatível)', () => {
    expect(PASSOS_DO_TOUR).toBe(TOURS['primeiros-passos'].passos)
    expect(PASSOS_DO_TOUR.map((p) => p.titulo)).toEqual(['Início', 'Jornada', 'Clube', 'Eu'])
  })
  it('gestão só para diretoria e instrutor', () => {
    expect(tourPermitido('gestao', 'diretoria')).toBe(true)
    expect(tourPermitido('gestao', 'instrutor')).toBe(true)
    expect(tourPermitido('gestao', 'desbravador')).toBe(false)
    expect(tourPermitido('gestao', 'conselheiro')).toBe(false)
    expect(tourPermitido('inexistente', 'diretoria')).toBe(false)
    expect(toursDoPapel('pais').map((t) => t.id)).toEqual(['primeiros-passos', 'classes', 'rede'])
    expect(toursDoPapel('diretoria').map((t) => t.titulo)).toEqual(['Primeiros passos', 'Classes', 'Rede DBV', 'Gestão'])
  })
  it('"visto" é por usuário E por tour; primeiros-passos usa a chave antiga', () => {
    expect(chaveDoTourDaArea('u1', 'primeiros-passos')).toBe('dc:tour-visto:u1')
    localStorage.setItem('dc:tour-visto:u1', '1') // quem viu o tour genérico antigo
    expect(tourDaAreaVisto('u1', 'primeiros-passos')).toBe(true)
    expect(tourJaVisto('u1')).toBe(true)
    expect(tourDaAreaVisto('u1', 'classes')).toBe(false)
    marcarTourDaAreaVisto('u1', 'classes')
    expect(tourDaAreaVisto('u1', 'classes')).toBe(true)
    expect(tourDaAreaVisto('u2', 'classes')).toBe(false)
    expect(tourDaAreaVisto(null, 'classes')).toBe(true) // sem usuário, nunca incomoda
  })
})
