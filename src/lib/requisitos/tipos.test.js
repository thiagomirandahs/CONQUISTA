import { describe, it, expect } from 'vitest'
import { tipoDoRequisito, soConfirmacao, TIPOS, ROTULOS } from './tipos.js'

const req = (over) => ({ descricao: 'Fazer algo.', tipo_evidencia: 'nenhuma', bloqueios: [], ...over })
const form = (familia) => ({ modelo: { familia, schema: { campos: [] } } })
const t = (requisito, formulario) => tipoDoRequisito({ requisito, formulario })

describe('tipoDoRequisito', () => {
  it('famílias L* = LEITURA', () => {
    for (const f of ['L1', 'L2', 'L3']) expect(t(req(), form(f))).toMatchObject({ tipo: TIPOS.LEITURA, rotulo: 'Leitura' })
  })
  it('famílias A*/E* = ENTREGA', () => {
    for (const f of ['A1', 'A1r', 'A2', 'A3', 'A4', 'A5', 'A6', 'E1', 'E2', 'E3']) expect(t(req(), form(f)).tipo).toBe(TIPOS.ENTREGA)
  })
  it('famílias R1–R6 = ATIVIDADE', () => {
    for (const f of ['R1', 'R2', 'R3', 'R4', 'R5', 'R6']) expect(t(req(), form(f)).tipo).toBe(TIPOS.ATIVIDADE)
  })
  it('famílias V* = PARTICIPACAO', () => {
    for (const f of ['V1', 'V2', 'V4', 'V6', 'V8']) expect(t(req(), form(f))).toMatchObject({ tipo: TIPOS.PARTICIPACAO, rotulo: 'Participação' })
  })
  it('sem formulário: evidência texto = ENTREGA; foto/arquivo = PRATICA', () => {
    expect(t(req({ tipo_evidencia: 'texto' })).tipo).toBe(TIPOS.ENTREGA)
    expect(t(req({ tipo_evidencia: 'foto' })).tipo).toBe(TIPOS.PRATICA)
    expect(t(req({ tipo_evidencia: 'arquivo' })).tipo).toBe(TIPOS.PRATICA)
  })
  it('a família do formulário vale mais que o tipo de evidência', () => {
    expect(t(req({ tipo_evidencia: 'foto' }), form('L1')).tipo).toBe(TIPOS.LEITURA)
  })
  it('"Decorar"/"Memorizar" = MEMORIZACAO (vence as demais regras)', () => {
    expect(t(req({ descricao: 'Decorar e explicar o Voto.' }), form('A1')).tipo).toBe(TIPOS.MEMORIZACAO)
    expect(t(req({ descricao: 'memorizar os livros do Novo Testamento' })).rotulo).toBe('Memorização')
    expect(t(req({ descricao: 'Não decorar nada.' })).tipo).toBeNull() // só no INÍCIO do texto
  })
  it('referência explícita a especialidade = ESPECIALIDADE', () => {
    expect(t(req({ tipo: 'escolha_especialidade' })).tipo).toBe(TIPOS.ESPECIALIDADE)
    expect(t(req({ especialidade: { id: 'x' } })).tipo).toBe(TIPOS.ESPECIALIDADE)
  })
  it('dependência soma o chip "Dependência" ao principal', () => {
    const r = t(req({ tipo_evidencia: 'texto', bloqueios: ['Faça o requisito 2 antes.'] }))
    expect(r.tipo).toBe(TIPOS.ENTREGA)
    expect(r.chips.map((c) => c.rotulo)).toEqual(['Entrega', 'Dependência'])
  })
  it('só dependência (sem outra pista) = DEPENDENCIA', () => {
    expect(t(req({ bloqueios: ['x'] }))).toMatchObject({ tipo: TIPOS.DEPENDENCIA, rotulo: 'Dependência' })
  })
  it('sem informação suficiente: rótulo neutro, nada inventado', () => {
    expect(t(req())).toEqual({ tipo: null, rotulo: 'Requisito', chips: [{ tipo: null, rotulo: 'Requisito' }] })
    expect(t(req(), form('Z9')).tipo).toBeNull()
    expect(tipoDoRequisito()).toMatchObject({ tipo: null, rotulo: 'Requisito' })
  })
  it('todos os tipos têm rótulo em pt-BR', () => {
    expect(Object.keys(TIPOS).sort()).toEqual(Object.keys(ROTULOS).sort())
  })
})

describe('soConfirmacao', () => {
  it('só confirmação (anexos opcionais não contam)', () => {
    expect(soConfirmacao({ campos: [{ tipo: 'confirmacao', chave: 'a' }] })).toBe(true)
    expect(soConfirmacao({ campos: [{ tipo: 'confirmacao', chave: 'a' }, { tipo: 'anexos', chave: 'f' }] })).toBe(true)
  })
  it('qualquer outro campo de resposta desliga', () => {
    expect(soConfirmacao({ campos: [{ tipo: 'confirmacao', chave: 'a' }, { tipo: 'texto_longo', chave: 'b' }] })).toBe(false)
    expect(soConfirmacao({ campos: [] })).toBe(false)
    expect(soConfirmacao(null)).toBe(false)
  })
})
