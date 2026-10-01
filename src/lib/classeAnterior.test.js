import { describe, it, expect } from 'vitest'
import {
  podeRegistrarClasseAnterior, validarRegistro, validarMotivo, mensagemRegistro, rotuloOrigem, rotuloData, rpcAusente, IMPACTO_REGISTRO,
} from './classeAnterior.js'

describe('visibilidade por papel', () => {
  it('só diretoria e instrutor', () => {
    for (const p of ['diretoria', 'instrutor']) expect(podeRegistrarClasseAnterior(p)).toBe(true)
    for (const p of ['conselheiro', 'tesoureiro', 'desbravador', 'pais', null, undefined]) expect(podeRegistrarClasseAnterior(p)).toBe(false)
  })
})

describe('validarRegistro', () => {
  const ok = { classId: 'c1', data: '2024-05-10', dataDesconhecida: false, observacao: 'Cartão da classe' }
  it('válido', () => expect(validarRegistro(ok, '2026-10-01')).toEqual({}))
  it('classe, data e observação obrigatórias', () => {
    const e = validarRegistro({ classId: '', data: '', dataDesconhecida: false, observacao: 'abc' }, '2026-10-01')
    expect(Object.keys(e).sort()).toEqual(['classe', 'data', 'observacao'])
  })
  it('data futura recusada', () => expect(validarRegistro({ ...ok, data: '2027-01-01' }, '2026-10-01').data).toMatch(/futuro/))
  it('data desconhecida dispensa a data', () => expect(validarRegistro({ ...ok, data: '', dataDesconhecida: true }, '2026-10-01')).toEqual({}))
  it('observação só com espaços não vale', () => expect(validarRegistro({ ...ok, observacao: '      ' }).observacao).toBeTruthy())
})

describe('motivo e erros', () => {
  it('motivo com no mínimo 5 letras', () => { expect(validarMotivo('abc')).toBeTruthy(); expect(validarMotivo('motivo certo')).toBe('') })
  it.each([
    ['Esta classe já consta como concluída por esta pessoa neste clube.', /já consta como concluída/],
    ['Esta pessoa já tem matrícula em andamento nesta classe.', /em andamento/],
    ['A data da conclusão não pode ser no futuro.', /futuro/],
    ['Sem permissão (apenas diretoria/instrutor deste clube).', /diretoria e os instrutores/],
    ['Peça a outra pessoa da liderança para registrar a sua classe já concluída.', /Ninguém registra a própria/],
  ])('traduz %s', (bruto, esperado) => expect(mensagemRegistro(new Error(bruto))).toMatch(esperado))
  it('erro desconhecido não vaza texto cru', () => expect(mensagemRegistro(new Error('xyz pg boom'))).not.toMatch(/boom/))
  it('rpcAusente', () => {
    expect(rpcAusente({ message: 'function public.x() does not exist' })).toBe(true)
    expect(rpcAusente({ message: 'Sem permissão' })).toBe(false)
  })
  it('impacto cita dependências e que não cria aprovações', () => {
    expect(IMPACTO_REGISTRO).toMatch(/concluída anteriormente/)
    expect(IMPACTO_REGISTRO).toMatch(/Não cria aprovações de requisitos nem documento/)
  })
})

describe('rótulos por origem', () => {
  it('registro anterior', () => {
    expect(rotuloOrigem({ origem: 'registro_anterior', registrado_em: '2026-09-30T10:00:00Z', registrado_por_nome: 'Ana' }))
      .toBe('Concluída anteriormente · Registrada em 30/09/2026 por Ana')
  })
  it('outro clube e app', () => {
    expect(rotuloOrigem({ origem: 'outro_clube', clube_nome: 'Aurora' })).toBe('Concluída em outro clube (Aurora)')
    expect(rotuloOrigem({ origem: 'conclusao_no_app', neste_clube: true })).toBe('Concluída no app')
  })
  it('data desconhecida nunca vira data', () => {
    expect(rotuloData({ concluida_em: null, data_desconhecida: true })).toBe('Data da conclusão desconhecida')
    expect(rotuloData({ concluida_em: '2025-11-03' })).toBe('Concluída em 03/11/2025')
  })
})
