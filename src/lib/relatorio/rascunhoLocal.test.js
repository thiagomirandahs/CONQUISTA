import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  chaveLocalDe, hashRascunho, lerLocal, gravarLocal, limparLocal, lerBackup, gravarBackup, limparRascunhosLocais,
  descartarLocalComBackup, decidirCarga,
} from './rascunhoLocal.js'

const K = chaveLocalDe('u1', 'classe', 'r1')
const srv = (conteudo = {}, anexos = [], editavel = true) => ({ conteudo, anexos, editavel })
const loc = (conteudo, base, sincronizado = false) => ({ v: 1, conteudo, anexos: [], base, editadoEm: 1, sincronizado })

beforeEach(() => { localStorage.clear(); vi.restoreAllMocks() })

describe('chave e hash', () => {
  it('chave cq.rel.<user>.<alvo>.<id>; sem dados → null', () => {
    expect(K).toBe('cq.rel.u1.classe.r1')
    expect(chaveLocalDe('u1', 'especialidade', 'x')).toBe('cq.rel.u1.especialidade.x')
    expect(chaveLocalDe(null, 'classe', 'r1')).toBeNull()
  })
  it('hash é estável, ignora a ordem das chaves e null vale como vazio', () => {
    expect(hashRascunho({ a: 1, b: [1, 2] }, [])).toBe(hashRascunho({ b: [1, 2], a: 1 }, []))
    expect(hashRascunho(null, null)).toBe(hashRascunho({}, []))
    expect(hashRascunho({ a: 1 }, [])).not.toBe(hashRascunho({ a: 2 }, []))
    expect(hashRascunho({ a: 1 }, [{ campo: 'f', path: 'x' }])).not.toBe(hashRascunho({ a: 1 }, []))
  })
})

describe('ler/gravar/limpar', () => {
  it('grava no formato { v:1, conteudo, anexos, base, editadoEm, sincronizado } e lê de volta', () => {
    expect(gravarLocal(K, { conteudo: { a: 'x' }, anexos: [], base: 'b1' }, 123)).toBe(true)
    expect(lerLocal(K)).toEqual({ v: 1, conteudo: { a: 'x' }, anexos: [], base: 'b1', editadoEm: 123, sincronizado: false })
  })
  it('lixo/versão desconhecida não quebra', () => {
    localStorage.setItem(K, '{nao json'); expect(lerLocal(K)).toBeNull()
    localStorage.setItem(K, '{"v":9}'); expect(lerLocal(K)).toBeNull()
  })
  it('limparLocal apaga o local E o backup', () => {
    gravarLocal(K, { conteudo: { a: 1 } }); gravarBackup(K, { conteudo: { a: 2 } })
    expect(lerBackup(K).conteudo).toEqual({ a: 2 })
    limparLocal(K)
    expect(lerLocal(K)).toBeNull(); expect(lerBackup(K)).toBeNull()
  })
  it('storage cheio ou bloqueado: devolve false/null sem lançar', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('QuotaExceededError') })
    expect(gravarLocal(K, { conteudo: {} })).toBe(false)
    vi.restoreAllMocks()
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('SecurityError') })
    expect(lerLocal(K)).toBeNull()
    expect(() => limparLocal(K)).not.toThrow()
    expect(() => limparRascunhosLocais()).not.toThrow()
  })
  it('limparRascunhosLocais: tudo cq.rel.* (ou só o usuário), nada além', () => {
    gravarLocal('cq.rel.u1.classe.a', { conteudo: {} }); gravarBackup('cq.rel.u1.classe.a', { conteudo: {} })
    gravarLocal('cq.rel.u2.classe.b', { conteudo: {} }); localStorage.setItem('outra', '1')
    expect(limparRascunhosLocais('u1')).toBe(2)
    expect(lerLocal('cq.rel.u2.classe.b')).not.toBeNull()
    expect(limparRascunhosLocais()).toBe(1)
    expect(localStorage.getItem('outra')).toBe('1')
  })
})

describe('decidirCarga', () => {
  it('sem local → servidor', () => { expect(decidirCarga({ local: null, servidor: srv() }).acao).toBe('servidor') })
  it('local já sincronizado → servidor (e pode apagar)', () => {
    expect(decidirCarga({ local: loc({ a: 1 }, 'x', true), servidor: srv({ a: 2 }) })).toEqual({ acao: 'servidor', limpar: true })
  })
  it('local igual ao servidor → servidor', () => {
    expect(decidirCarga({ local: loc({ a: 1 }, 'x'), servidor: srv({ a: 1 }) })).toEqual({ acao: 'servidor', limpar: true })
  })
  it('local pendente e servidor não mudou desde a base → local (sem conflito)', () => {
    const base = hashRascunho({ a: 0 }, [])
    expect(decidirCarga({ local: loc({ a: 1 }, base), servidor: srv({ a: 0 }) }).acao).toBe('local')
  })
  it('servidor sem rascunho (null) e base do vazio → local', () => {
    expect(decidirCarga({ local: loc({ a: 1 }, hashRascunho({}, [])), servidor: { conteudo: null, anexos: null, editavel: true } }).acao).toBe('local')
  })
  it('local pendente e servidor mudou desde a base → conflito', () => {
    const base = hashRascunho({ a: 0 }, [])
    expect(decidirCarga({ local: loc({ a: 1 }, base), servidor: srv({ a: 9 }) }).acao).toBe('conflito')
  })
  it('local pendente sem base → conflito (nunca sobrescreve)', () => {
    expect(decidirCarga({ local: loc({ a: 1 }, null), servidor: srv({ a: 9 }) }).acao).toBe('conflito')
  })
  it('requisito não editável com local pendente → descartar-local com backup; sem pendência → servidor', () => {
    expect(decidirCarga({ local: loc({ a: 1 }, 'x'), servidor: srv({ a: 2 }, [], false) })).toEqual({ acao: 'descartar-local', backup: true })
    expect(decidirCarga({ local: loc({ a: 1 }, 'x', true), servidor: srv({ a: 2 }, [], false) }).acao).toBe('servidor')
  })
})

describe('descartarLocalComBackup', () => {
  it('pendente: move para o backup e avisa (true)', () => {
    gravarLocal(K, { conteudo: { a: 'meu texto' }, base: 'b' })
    expect(descartarLocalComBackup(K)).toBe(true)
    expect(lerLocal(K)).toBeNull()
    expect(lerBackup(K).conteudo).toEqual({ a: 'meu texto' })
  })
  it('já sincronizado ou inexistente: só apaga, sem backup', () => {
    gravarLocal(K, { conteudo: { a: 1 }, sincronizado: true })
    expect(descartarLocalComBackup(K)).toBe(false)
    expect(lerBackup(K)).toBeNull()
    expect(descartarLocalComBackup(K)).toBe(false)
  })
})
