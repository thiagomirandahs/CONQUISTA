import { describe, it, expect, beforeEach } from 'vitest'
import { PAPEIS_DO_TUTORIAL, TOPICOS } from './conteudo.js'
import {
  atalhoPermitido, buscarTopicos, marcarTourVisto, secaoDoPapel, secoesOrdenadas, topicosDaSecao,
  topicosVisiveis, tourJaVisto,
} from './tutorial.js'
import { PAPEIS_POR_ROTA } from '../permissoes.js'

const tudoLigado = () => true

describe('conteúdo do tutorial', () => {
  it('todo tópico tem id único, seção conhecida, para que serve e passos', () => {
    const ids = new Set()
    const secoes = new Set(PAPEIS_DO_TUTORIAL.map((p) => p.chave))
    for (const t of TOPICOS) {
      expect(ids.has(t.id), t.id).toBe(false)
      ids.add(t.id)
      expect(secoes.has(t.papel), t.id).toBe(true)
      expect(t.paraQueServe, t.id).toBeTruthy()
      expect(t.passos?.length, t.id).toBeGreaterThan(0)
    }
  })

  it('cada papel tem tópicos', () => {
    for (const p of PAPEIS_DO_TUTORIAL) expect(topicosDaSecao(p.chave).length, p.chave).toBeGreaterThan(0)
  })

  it('as âncoras dos botões "?" existem', () => {
    for (const id of ['minha-classe', 'cantinho', 'avaliar-classes', 'inscricoes', 'usuarios-equipe', 'gestao']) {
      expect(TOPICOS.some((t) => t.id === id), id).toBe(true)
    }
  })
})

describe('busca', () => {
  it('acha por palavra, sem ligar para acento e maiúscula', () => {
    const ids = buscarTopicos('CADEADO').map((t) => t.id)
    expect(ids).toContain('minha-classe')
    expect(buscarTopicos('oração').map((t) => t.id)).toContain('cantinho')
    expect(buscarTopicos('oracao').map((t) => t.id)).toContain('cantinho')
  })
  it('todas as palavras precisam aparecer; vazio devolve tudo', () => {
    expect(buscarTopicos('')).toHaveLength(TOPICOS.length)
    expect(buscarTopicos('qr código').map((t) => t.id)).toContain('inscricoes')
    expect(buscarTopicos('xyzzy inexistente')).toHaveLength(0)
  })
})

describe('papel e seções', () => {
  it('mapeia o papel do vínculo para a seção', () => {
    expect(secaoDoPapel('pais')).toBe('responsavel')
    expect(secaoDoPapel('instrutor')).toBe('instrutor')
    expect(secaoDoPapel(null, { temEscopo: true })).toBe('coordenacao')
    expect(secaoDoPapel(null)).toBeNull()
  })
  it('a seção da pessoa vem primeiro', () => {
    expect(secoesOrdenadas('conselheiro')[0].chave).toBe('conselheiro')
    expect(secoesOrdenadas('conselheiro')).toHaveLength(PAPEIS_DO_TUTORIAL.length)
  })
  it('no app, tópico de recurso desligado some; no site, os "soNoApp" somem', () => {
    const semEsp = (r) => r !== 'especialidades'
    expect(topicosVisiveis({ modo: 'app', temRecurso: semEsp }).some((t) => t.recurso === 'especialidades')).toBe(false)
    expect(topicosVisiveis({ modo: 'app', temRecurso: tudoLigado }).some((t) => t.recurso === 'especialidades')).toBe(true)
    expect(topicosVisiveis({ modo: 'site' }).some((t) => t.soNoApp)).toBe(false)
  })
})

describe('atalho "Abrir essa tela" só para rota permitida', () => {
  it('desbravador não ganha atalho para tela da liderança', () => {
    const ctx = { papel: 'desbravador', temRecurso: tudoLigado }
    expect(atalhoPermitido('/minha-classe', ctx)).toBe(true)
    for (const rota of ['/usuarios', '/avaliar-classe', '/gestao', '/gestao/inscricoes', '/apontamentos', '/meu-filho', '/institucional']) {
      expect(atalhoPermitido(rota, ctx), rota).toBe(false)
    }
  })
  it('segue a matriz de papéis (instrutor não administra; conselheiro faz apontamentos)', () => {
    expect(atalhoPermitido('/avaliar-classe', { papel: 'instrutor', temRecurso: tudoLigado })).toBe(true)
    expect(atalhoPermitido('/usuarios', { papel: 'instrutor', temRecurso: tudoLigado })).toBe(false)
    expect(atalhoPermitido('/apontamentos', { papel: 'conselheiro', temRecurso: tudoLigado })).toBe(true)
    expect(atalhoPermitido('/usuarios', { papel: 'diretoria', temRecurso: tudoLigado })).toBe(true)
  })
  it('recurso desligado no clube = sem atalho', () => {
    expect(atalhoPermitido('/minha-classe', { papel: 'desbravador', temRecurso: () => false })).toBe(false)
    expect(atalhoPermitido('/avaliar-classe', { papel: 'diretoria', temRecurso: (r) => r !== 'classes' })).toBe(false)
  })
  it('sem papel nem escopo, nada abre; coordenação abre o portal', () => {
    expect(atalhoPermitido('/ranking', {})).toBe(false)
    expect(atalhoPermitido('/institucional', { temEscopo: true })).toBe(true)
  })
  it('toda rota restrita citada no conteúdo está na matriz', () => {
    for (const t of TOPICOS.filter((x) => x.rota && PAPEIS_POR_ROTA[x.rota])) {
      expect(PAPEIS_POR_ROTA[t.rota].length, t.id).toBeGreaterThan(0)
    }
  })
})

describe('tour de primeiro acesso (storage)', () => {
  beforeEach(() => localStorage.clear())
  it('marca por usuário', () => {
    expect(tourJaVisto('u1')).toBe(false)
    marcarTourVisto('u1')
    expect(tourJaVisto('u1')).toBe(true)
    expect(tourJaVisto('u2')).toBe(false)
  })
})
