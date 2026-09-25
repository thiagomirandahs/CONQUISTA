import { describe, it, expect } from 'vitest'
import { FERRAMENTAS, PAPEIS_POR_ROTA, RECURSO_POR_ROTA } from './permissoes.js'

describe('matriz de permissões', () => {
  it('toda ferramenta tem rota (to), título e ao menos um papel', () => {
    for (const f of FERRAMENTAS) {
      expect(f.to.startsWith('/')).toBe(true)
      expect(f.titulo).toBeTruthy()
      expect(Array.isArray(f.papeis) && f.papeis.length > 0).toBe(true)
    }
  })

  it('PAPEIS_POR_ROTA reflete exatamente a lista', () => {
    // +2 rotas que não são card de Gestão: a fila ÚNICA de avaliação (/gestao/avaliar, fase 7) e a
    // central Classes+Especialidades (/gestao/avaliacoes, Etapa 3). /gestao/inscricoes JÁ é um card
    // (está em FERRAMENTAS), então não soma aqui.
    expect(Object.keys(PAPEIS_POR_ROTA).length).toBe(FERRAMENTAS.length + 2)
    expect(PAPEIS_POR_ROTA['/gestao/avaliar']).toEqual(['diretoria', 'instrutor'])
    expect(PAPEIS_POR_ROTA['/gestao/avaliacoes']).toEqual(['diretoria', 'instrutor'])
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

// Fase 9, item 9: as especialidades ficam FORA do piloto enquanto o catálogo oficial não existe (o atual é só de teste).
// Antes, elas usavam o recurso 'classes', e um clube que ligava as Classes oficiais levava junto as especialidades de teste.
describe('especialidades têm recurso próprio (não pegam carona em "classes")', () => {
  // o mesmo filtro que a tela de Gestão usa para montar os cards
  const cardsDaGestao = (papel, temRecurso) =>
    FERRAMENTAS.filter((f) => f.papeis.includes(papel) && (!f.recurso || temRecurso(f.recurso))).map((f) => f.to)
  const soClasses = (c) => c === 'classes'

  it('as duas rotas de especialidade dependem de "especialidades" — nunca de "classes"', () => {
    expect(RECURSO_POR_ROTA['/minhas-especialidades']).toBe('especialidades')
    expect(RECURSO_POR_ROTA['/avaliar-especialidades']).toBe('especialidades')
    expect(FERRAMENTAS.find((f) => f.to === '/avaliar-especialidades').recurso).toBe('especialidades')
    const rotasDeClasses = Object.entries(RECURSO_POR_ROTA).filter(([, r]) => r === 'classes').map(([rota]) => rota)
    expect(rotasDeClasses.some((rota) => rota.includes('especialidade'))).toBe(false)
  })

  it('com "classes" ligado e "especialidades" desligado, a Gestão mostra as classes e NÃO o card de especialidades', () => {
    for (const papel of ['diretoria', 'instrutor']) {
      const cards = cardsDaGestao(papel, soClasses)
      expect(cards, papel).toContain('/avaliar-classe')
      expect(cards, papel).toContain('/investiduras')
      expect(cards, papel).not.toContain('/avaliar-especialidades')
    }
  })

  it('o card de especialidades só aparece quando o próprio recurso "especialidades" está ligado', () => {
    expect(cardsDaGestao('diretoria', (c) => c === 'especialidades')).toContain('/avaliar-especialidades')
    expect(cardsDaGestao('diretoria', () => false)).not.toContain('/avaliar-especialidades')
  })
})
