import { describe, it, expect } from 'vitest'
import { validarModelo, validarConteudo, camposVisiveis } from './modelo.js'
import classes from '../../../supabase/curriculo-manifesto/modelos-de-relatorio/classes.json'
import { limparConteudo, completarEntradas, schemaDoModelo, fmtDataBR } from './conteudo.js'

const S = (...campos) => ({ versao: 1, campos })
const envio = { envio: true }

describe('validarModelo', () => {
  it('TODOS os modelos das classes passam', () => {
    const chaves = Object.keys(classes.modelos)
    expect(chaves).toHaveLength(71)
    for (const k of chaves) expect(validarModelo(classes.modelos[k].schema), k).toEqual([])
  })
  it('recusa modelo sem versão/campos, tipo desconhecido, chave repetida e escolha toda pendente', () => {
    expect(validarModelo({})).not.toEqual([])
    expect(validarModelo(S({ chave: 'a', tipo: 'foto', rotulo: 'A' }))[0]).toMatch(/tipo desconhecido/)
    expect(validarModelo(S({ chave: 'a', tipo: 'texto_curto', rotulo: 'A' }, { chave: 'a', tipo: 'texto_curto', rotulo: 'B' })).join()).toMatch(/repetida/)
    const op = (chave, pendente) => ({ chave, rotulo: chave, campos: [], pendente })
    expect(validarModelo(S({ chave: 'e', tipo: 'escolha', rotulo: 'E', opcoes: [op('a', true), op('b', true)] })).join()).toMatch(/pendentes/)
  })
})

describe('validarConteudo — por tipo', () => {
  it('texto: obrigatório, mínimo e máximo', () => {
    const s = S({ chave: 't', tipo: 'texto_longo', rotulo: 'Resumo', obrigatorio: true, min: 10, max: 20 })
    expect(validarConteudo(s, {}, [], envio)).toContain('Preencha: Resumo')
    expect(validarConteudo(s, { t: 'curto' }, [], envio).join()).toMatch(/pelo menos 10/)
    expect(validarConteudo(s, { t: 'x'.repeat(21) }).join()).toMatch(/passou de 20/)
    expect(validarConteudo(s, { t: 'um texto bom demais' }, [], envio)).toEqual([])
    expect(validarConteudo(s, {}, [])).toEqual([]) // rascunho pode estar incompleto
  })
  it('número inteiro e mínimo', () => {
    const s = S({ chave: 'n', tipo: 'numero', rotulo: 'Km', min: 2, inteiro: true, obrigatorio: true })
    expect(validarConteudo(s, { n: 2.5 }).join()).toMatch(/inteiro/)
    expect(validarConteudo(s, { n: 1 }, [], envio).join()).toMatch(/mínimo 2/)
    expect(validarConteudo(s, { n: 1 })).toEqual([]) // mínimo só vale no envio
    expect(validarConteudo(s, { n: 3 }, [], envio)).toEqual([])
  })
  it('data: formato e não-futura', () => {
    const s = S({ chave: 'd', tipo: 'data', rotulo: 'Quando', nao_futura: true })
    expect(validarConteudo(s, { d: '31/12/2020' }).join()).toMatch(/data inválida/)
    expect(validarConteudo(s, { d: '2999-01-01' }).join()).toMatch(/futuro/)
    expect(validarConteudo(s, { d: '2020-01-01' })).toEqual([])
  })
  it('seleção aceita só as opções do modelo', () => {
    const s = S({ chave: 's', tipo: 'selecao', rotulo: 'Qual', opcoes: [{ chave: 'a', rotulo: 'A' }, { chave: 'b', rotulo: 'B' }] })
    expect(validarConteudo(s, { s: 'c' }).join()).toMatch(/opção inválida/)
    expect(validarConteudo(s, { s: 'a' })).toEqual([])
  })
  it('checklist 2 de 4', () => {
    const itens = ['a', 'b', 'c', 'd'].map((chave) => ({ chave, rotulo: chave.toUpperCase() }))
    const s = S({ chave: 'c', tipo: 'checklist', rotulo: 'Marque', itens, min_marcados: 2, max_marcados: 3 })
    expect(validarConteudo(s, { c: { a: true } }, [], envio).join()).toMatch(/pelo menos 2/)
    expect(validarConteudo(s, { c: { a: true, b: true } }, [], envio)).toEqual([])
    expect(validarConteudo(s, { c: { a: true, b: true, c: true, d: true } }).join()).toMatch(/no máximo 3/)
    const o = S({ chave: 'c', tipo: 'checklist', rotulo: 'M', itens: [{ chave: 'a', rotulo: 'Item A', obrigatorio: true }, { chave: 'b', rotulo: 'B' }] })
    expect(validarConteudo(o, { c: { b: true } }, [], envio).join()).toMatch(/falta marcar "Item A"/)
  })
  it('lista: mínimo de itens preenchidos e máximo', () => {
    const s = S({ chave: 'l', tipo: 'lista', rotulo: 'Itens', min: 2, max: 3 })
    expect(validarConteudo(s, { l: ['a', ' '] }, [], envio).join()).toMatch(/pelo menos 2/)
    expect(validarConteudo(s, { l: ['a', 'b', 'c', 'd'] }).join()).toMatch(/no máximo 3/)
    expect(validarConteudo(s, { l: ['a', 'b'] }, [], envio)).toEqual([])
  })
  it('entradas: diário de 7 dias aponta o dia com problema', () => {
    const s = S({ chave: 'dia', tipo: 'entradas', rotulo: 'Diário', min: 7, max: 7, rotulo_item: 'Dia', campos: [{ chave: 'o', tipo: 'texto_curto', rotulo: 'O que fez', obrigatorio: true }] })
    expect(validarConteudo(s, { dia: [{ o: 'x' }] }, [], envio).join()).toMatch(/faltam entradas \(1\/7\)/)
    const sete = Array.from({ length: 7 }, (_, i) => (i === 2 ? {} : { o: 'ok' }))
    expect(validarConteudo(s, { dia: sete }, [], envio)).toEqual(['Dia 3: Preencha: O que fez'])
    expect(validarConteudo(s, { dia: Array.from({ length: 7 }, () => ({ o: 'ok' })) }, [], envio)).toEqual([])
  })
  it('escolha: opção pendente não é aceita; só valida os campos da opção escolhida', () => {
    const s = S({
      chave: 'e', tipo: 'escolha', rotulo: 'Como', obrigatorio: true,
      opcoes: [
        { chave: 'a', rotulo: 'Opção A', campos: [{ chave: 'x', tipo: 'texto_curto', rotulo: 'Detalhe', obrigatorio: true }] },
        { chave: 'p', rotulo: 'Opção P', campos: [], pendente: true },
      ],
    })
    expect(validarConteudo(s, { e: { opcao: 'p', dados: {} } }).join()).toMatch(/ainda não está disponível/)
    expect(validarConteudo(s, { e: { opcao: 'a', dados: {} } }, [], envio)).toEqual(['Opção A: Preencha: Detalhe'])
    expect(validarConteudo(s, { e: { opcao: 'a', dados: { x: 'ok' } } }, [], envio)).toEqual([])
    expect(camposVisiveis(s, { e: { opcao: 'a' } }).map((c) => c.chave)).toEqual(['e', 'x'])
  })
  it('confirmação obrigatória só vale no envio', () => {
    const s = S({ chave: 'f', tipo: 'confirmacao', rotulo: 'Fiz', obrigatorio: true })
    expect(validarConteudo(s, { f: false }, [], envio)).toEqual(['Confirme: Fiz'])
    expect(validarConteudo(s, { f: true }, [], envio)).toEqual([])
  })
  it('anexos: mínimo no envio, máximo sempre, e recusa anexo onde o modelo não tem', () => {
    const s = S({ chave: 'a', tipo: 'anexos', rotulo: 'Fotos', min: 1, max: 2, tipos: ['imagem'] })
    const ax = (n) => Array.from({ length: n }, (_, i) => ({ campo: 'a', path: 'u/requisitos/' + i + '.jpg' }))
    expect(validarConteudo(s, {}, [], envio).join()).toMatch(/pelo menos 1 anexo/)
    expect(validarConteudo(s, {}, ax(3)).join()).toMatch(/no máximo 2/)
    expect(validarConteudo(s, {}, ax(1), envio)).toEqual([])
    expect(validarConteudo(S({ chave: 't', tipo: 'texto_curto', rotulo: 'T' }), {}, ax(1)).join()).toMatch(/não aceita anexos/)
  })
})

describe('conteudo.js', () => {
  it('schemaDoModelo aceita { schema } e o schema direto', () => {
    const sc = S({ chave: 't', tipo: 'texto_curto', rotulo: 'T' })
    expect(schemaDoModelo({ versao: 1, schema: sc })).toBe(sc)
    expect(schemaDoModelo(sc)).toBe(sc)
    expect(schemaDoModelo(null)).toBeNull()
    expect(schemaDoModelo({ nada: 1 })).toBeNull()
  })
  it('limparConteudo tira vazios mas mantém a posição das entradas', () => {
    const campos = [
      { chave: 't', tipo: 'texto_curto', rotulo: 'T' }, { chave: 'l', tipo: 'lista', rotulo: 'L' },
      { chave: 'e', tipo: 'entradas', rotulo: 'E', min: 2, max: 2, campos: [{ chave: 'x', tipo: 'texto_curto', rotulo: 'X' }] },
    ]
    expect(limparConteudo(campos, { t: '  ', l: ['a', ''], e: [{ x: '' }, { x: 'ok' }] })).toEqual({ l: ['a'], e: [{}, { x: 'ok' }] })
  })
  it('completarEntradas preenche até o mínimo; fmtDataBR formata sem mudar de dia', () => {
    const campos = [{ chave: 'e', tipo: 'entradas', rotulo: 'E', min: 3, max: 7, campos: [] }]
    expect(completarEntradas(campos, { e: [{ a: 1 }] }).e).toEqual([{ a: 1 }, {}, {}])
    expect(fmtDataBR('2026-01-01')).toBe('01/01/2026')
    expect(fmtDataBR('')).toBe('')
  })
})
