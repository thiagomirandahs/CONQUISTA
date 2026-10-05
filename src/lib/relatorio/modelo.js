// Motor de relatório estruturado (fase 7) — regras PURAS do modelo (schema) e do conteúdo.
//
// Um requisito não tem "tela própria": ele traz um MODELO (`{ versao: 1, campos: [...] }`) e a interface
// monta o formulário a partir dele. O SERVIDOR (SQL `_relatorio_validar`) é quem decide de verdade; este
// arquivo é o espelho para a tela avisar cedo e para o validador do manifesto recusar modelo inválido.
// Os dois são provados contra os MESMOS casos (src/lib/relatorio/casos.json).
//
// Tipos de campo:
//   texto_curto | texto_longo  {max, min}
//   numero                      {min, max, unidade, inteiro}
//   data                        {nao_futura}
//   selecao                     {opcoes:[{chave,rotulo}]}
//   checklist                   {itens:[{chave,rotulo,obrigatorio}], min_marcados, max_marcados}  → { chave: true|false }
//   lista                       {min, max, rotulo_item, tipo_item}                                → ["…", "…"]
//   entradas                    {min, max, rotulo_item, campos:[…]}   (diário, histórias…)         → [ {…}, {…} ]
//   escolha                     {opcoes:[{chave,rotulo,campos:[…],pendente}]}                      → { opcao, dados:{…} }
//   confirmacao                 (marcar "fiz isto"; quem CONFIRMA é a avaliação, com auditoria)      → true
//   anexos                      {min, max, tipos:['imagem'|'arquivo']}  (valor vai em `anexos`, não em `conteudo`)

import { hojeLocalISO } from '../data.js'

export const TIPOS = ['texto_curto', 'texto_longo', 'numero', 'data', 'selecao', 'checklist', 'lista', 'entradas', 'escolha', 'confirmacao', 'anexos']
export const LIMITES = Object.freeze({ curto: 200, longo: 2000, longoMax: 4000, lista: 30, entradas: 31, anexos: 10, campos: 40, total: 40000, chave: 40 })
const CHAVE = /^[a-z][a-z0-9_]{0,39}$/
const ISO = /^\d{4}-\d{2}-\d{2}$/

const obrigatorio = (c) => c.obrigatorio === true
const ehTexto = (v) => typeof v === 'string'
const vazio = (v) => v == null || (typeof v === 'string' && v.trim() === '')
const hoje = () => hojeLocalISO()

// ---------------------------------------------------------------- validação do MODELO (schema)
export function validarModelo(schema) {
  const erros = []
  if (!schema || typeof schema !== 'object' || schema.versao !== 1 || !Array.isArray(schema.campos)) {
    return ['modelo: precisa de { versao: 1, campos: [...] }']
  }
  checarCampos(schema.campos, 'modelo', erros, { nivel: 0 })
  return erros
}

function checarCampos(campos, pref, erros, ctx) {
  if (campos.length > LIMITES.campos) erros.push(`${pref}: campos demais (máx. ${LIMITES.campos})`)
  const vistas = new Set()
  let anexos = 0
  for (const c of campos) {
    const id = `${pref} › ${c?.chave ?? '?'}`
    if (!c || typeof c !== 'object') { erros.push(`${id}: campo inválido`); continue }
    if (!CHAVE.test(c.chave || '')) erros.push(`${id}: chave inválida (minúsculas, números e _)`)
    if (vistas.has(c.chave)) erros.push(`${id}: chave repetida`)
    vistas.add(c.chave)
    if (!TIPOS.includes(c.tipo)) { erros.push(`${id}: tipo desconhecido (${c.tipo})`); continue }
    if (!c.rotulo || String(c.rotulo).length > 240) erros.push(`${id}: rotulo obrigatório (até 240)`)
    switch (c.tipo) {
      case 'selecao':
        if (!Array.isArray(c.opcoes) || c.opcoes.length < 2) erros.push(`${id}: selecao precisa de 2+ opcoes`)
        else opcoesUnicas(c.opcoes, id, erros)
        break
      case 'checklist':
        if (!Array.isArray(c.itens) || !c.itens.length) erros.push(`${id}: checklist precisa de itens`)
        else opcoesUnicas(c.itens, id, erros)
        if (c.min_marcados != null && (!Number.isInteger(c.min_marcados) || c.min_marcados < 0 || c.min_marcados > (c.itens?.length || 0))) erros.push(`${id}: min_marcados inválido`)
        if (c.max_marcados != null && (!Number.isInteger(c.max_marcados) || c.max_marcados < (c.min_marcados || 0))) erros.push(`${id}: max_marcados inválido`)
        break
      case 'lista':
        if (c.min != null && (!Number.isInteger(c.min) || c.min < 0)) erros.push(`${id}: min inválido`)
        if (c.max != null && (!Number.isInteger(c.max) || c.max > LIMITES.lista || c.max < (c.min || 0))) erros.push(`${id}: max inválido (até ${LIMITES.lista})`)
        if (c.tipo_item && !['texto_curto', 'texto_longo'].includes(c.tipo_item)) erros.push(`${id}: tipo_item inválido`)
        break
      case 'entradas':
        if (ctx.nivel > 0) erros.push(`${id}: entradas não pode ficar dentro de outro campo composto`)
        if (!Number.isInteger(c.min) || !Number.isInteger(c.max) || c.min < 0 || c.max < c.min || c.max > LIMITES.entradas) erros.push(`${id}: min/max inválidos (até ${LIMITES.entradas})`)
        if (!Array.isArray(c.campos) || !c.campos.length) erros.push(`${id}: entradas precisa de campos`)
        else checarCampos(c.campos, id, erros, { nivel: ctx.nivel + 1, semAnexos: true })
        break
      case 'escolha':
        if (ctx.nivel > 0) erros.push(`${id}: escolha não pode ficar dentro de outro campo composto`)
        if (!Array.isArray(c.opcoes) || c.opcoes.length < 2) { erros.push(`${id}: escolha precisa de 2+ opcoes`); break }
        opcoesUnicas(c.opcoes, id, erros)
        c.opcoes.forEach((o) => checarCampos(o.campos || [], `${id} › ${o.chave}`, erros, { nivel: ctx.nivel + 1, semAnexos: true }))
        if (c.opcoes.every((o) => o.pendente)) erros.push(`${id}: todas as opções estão pendentes`)
        break
      case 'anexos':
        anexos++
        if (ctx.semAnexos) erros.push(`${id}: anexos só no nível principal`)
        if (c.max != null && (!Number.isInteger(c.max) || c.max < 1 || c.max > LIMITES.anexos)) erros.push(`${id}: max inválido (até ${LIMITES.anexos})`)
        if (c.min != null && (!Number.isInteger(c.min) || c.min < 0 || c.min > (c.max ?? LIMITES.anexos))) erros.push(`${id}: min inválido`)
        if (c.tipos && !c.tipos.every((t) => ['imagem', 'arquivo'].includes(t))) erros.push(`${id}: tipos de anexo inválidos`)
        break
      default:
    }
  }
  if (anexos > 1) erros.push(`${pref}: no máximo 1 campo de anexos`)
}

function opcoesUnicas(lista, id, erros) {
  const v = new Set()
  for (const o of lista) {
    if (!CHAVE.test(o?.chave || '')) erros.push(`${id}: opção com chave inválida (${o?.chave})`)
    if (!o?.rotulo) erros.push(`${id}: opção sem rotulo (${o?.chave})`)
    if (v.has(o?.chave)) erros.push(`${id}: opção repetida (${o?.chave})`)
    v.add(o?.chave)
  }
}

// ---------------------------------------------------------------- validação do CONTEÚDO
// envio=false → só forma/limites (rascunho pode estar incompleto); envio=true → exige o que é obrigatório.
export function validarConteudo(schema, conteudo, anexos = [], { envio = false } = {}) {
  const erros = []
  const dados = conteudo ?? {}
  if (JSON.stringify(dados).length > LIMITES.total) return ['conteúdo grande demais']
  validarCampos(schema.campos, dados, envio, '', erros)
  const campoAnexos = schema.campos.find((c) => c.tipo === 'anexos')
  const lista = Array.isArray(anexos) ? anexos : []
  if (!Array.isArray(anexos)) erros.push('anexos inválidos')
  if (lista.length && !campoAnexos) erros.push('este requisito não aceita anexos')
  if (campoAnexos) {
    const max = campoAnexos.max ?? LIMITES.anexos
    if (lista.length > max) erros.push(`no máximo ${max} anexo(s)`)
    if (envio && lista.length < (campoAnexos.min || 0)) erros.push(`Envie pelo menos ${campoAnexos.min} anexo(s): ${campoAnexos.rotulo}`)
    if (lista.some((a) => !a || a.campo !== campoAnexos.chave || typeof a.path !== 'string' || !a.path)) erros.push('anexo inválido')
  }
  return erros
}

function validarCampos(campos, dados, envio, pref, erros) {
  if (!dados || typeof dados !== 'object' || Array.isArray(dados)) { erros.push(`${pref}conteúdo inválido`); return }
  for (const k of Object.keys(dados)) {
    if (!campos.some((c) => c.chave === k && c.tipo !== 'anexos')) erros.push(`${pref}campo desconhecido: ${String(k).slice(0, 40)}`)
  }
  for (const c of campos) {
    if (c.tipo === 'anexos') continue
    const rot = c.rotulo || c.chave
    const v = dados[c.chave]
    if (v == null) { if (envio && (obrigatorio(c))) erros.push(`${pref}Preencha: ${rot}`); continue }
    switch (c.tipo) {
      case 'texto_curto': case 'texto_longo': {
        if (!ehTexto(v)) { erros.push(`${pref}${rot}: texto inválido`); break }
        const max = Math.min(c.max ?? (c.tipo === 'texto_curto' ? LIMITES.curto : LIMITES.longo), LIMITES.longoMax)
        if (v.length > max) erros.push(`${pref}${rot}: passou de ${max} caracteres`)
        if (envio && obrigatorio(c) && vazio(v)) erros.push(`${pref}Preencha: ${rot}`)
        if (envio && c.min && v.trim().length < c.min) erros.push(`${pref}${rot}: escreva pelo menos ${c.min} caracteres`)
        break
      }
      case 'numero': {
        if (typeof v !== 'number' || !Number.isFinite(v)) { erros.push(`${pref}${rot}: número inválido`); break }
        if (c.inteiro && !Number.isInteger(v)) erros.push(`${pref}${rot}: use número inteiro`)
        if (envio && c.min != null && v < c.min) erros.push(`${pref}${rot}: mínimo ${c.min}`)
        if (c.max != null && v > c.max) erros.push(`${pref}${rot}: máximo ${c.max}`)
        break
      }
      case 'data': {
        if (!ehTexto(v) || !ISO.test(v) || Number.isNaN(Date.parse(`${v}T00:00:00Z`))) { erros.push(`${pref}${rot}: data inválida`); break }
        if (c.nao_futura && v > hoje()) erros.push(`${pref}${rot}: não pode ser no futuro`)
        break
      }
      case 'selecao': {
        if (!ehTexto(v) || !c.opcoes.some((o) => o.chave === v)) erros.push(`${pref}${rot}: opção inválida`)
        break
      }
      case 'checklist': {
        if (typeof v !== 'object' || Array.isArray(v)) { erros.push(`${pref}${rot}: checklist inválido`); break }
        let marcados = 0
        for (const [k, val] of Object.entries(v)) {
          if (!c.itens.some((i) => i.chave === k)) erros.push(`${pref}${rot}: item desconhecido`)
          if (typeof val !== 'boolean') erros.push(`${pref}${rot}: valor inválido`)
          if (val === true) marcados++
        }
        if (c.max_marcados != null && marcados > c.max_marcados) erros.push(`${pref}${rot}: marque no máximo ${c.max_marcados}`)
        if (envio) {
          if (c.min_marcados != null && marcados < c.min_marcados) erros.push(`${pref}${rot}: marque pelo menos ${c.min_marcados}`)
          for (const i of c.itens) if (i.obrigatorio === true && v[i.chave] !== true) erros.push(`${pref}${rot}: falta marcar "${i.rotulo}"`)
        }
        break
      }
      case 'lista': {
        if (!Array.isArray(v)) { erros.push(`${pref}${rot}: lista inválida`); break }
        const max = c.max ?? LIMITES.lista
        if (v.length > max) erros.push(`${pref}${rot}: no máximo ${max} itens`)
        const lim = c.tipo_item === 'texto_longo' ? LIMITES.longo : LIMITES.curto
        if (v.some((x) => !ehTexto(x) || x.length > lim)) erros.push(`${pref}${rot}: item inválido`)
        if (envio) {
          const cheios = v.filter((x) => ehTexto(x) && x.trim() !== '').length
          if (cheios < (c.min || (obrigatorio(c) ? 1 : 0))) erros.push(`${pref}${rot}: preencha pelo menos ${c.min || 1} item(ns)`)
        }
        break
      }
      case 'entradas': {
        if (!Array.isArray(v)) { erros.push(`${pref}${rot}: entradas inválidas`); break }
        if (v.length > c.max) erros.push(`${pref}${rot}: no máximo ${c.max}`)
        if (envio && v.length < c.min) erros.push(`${pref}${rot}: faltam entradas (${v.length}/${c.min})`)
        v.forEach((e, i) => validarCampos(c.campos, e, envio, `${pref}${c.rotulo_item || 'Item'} ${i + 1}: `, erros))
        break
      }
      case 'escolha': {
        if (typeof v !== 'object' || Array.isArray(v) || !ehTexto(v.opcao)) { erros.push(`${pref}${rot}: escolha inválida`); break }
        const op = c.opcoes.find((o) => o.chave === v.opcao)
        if (!op) { erros.push(`${pref}${rot}: opção inválida`); break }
        if (op.pendente) { erros.push(`${pref}${rot}: esta opção ainda não está disponível`); break }
        validarCampos(op.campos || [], v.dados ?? {}, envio, `${pref}${op.rotulo}: `, erros)
        break
      }
      case 'confirmacao': {
        if (typeof v !== 'boolean') erros.push(`${pref}${rot}: valor inválido`)
        else if (envio && obrigatorio(c) && v !== true) erros.push(`${pref}Confirme: ${rot}`)
        break
      }
      default:
    }
  }
  // escolha obrigatória sem valor já caiu no `v == null` acima; garante o mesmo para checklist/entradas vazios
}

// Campo obrigatório ausente que a escolha ativa esconde não conta — só o que aparece na tela.
export function camposVisiveis(schema, conteudo) {
  const lista = []
  const percorrer = (campos, dados) => {
    for (const c of campos) {
      lista.push(c)
      if (c.tipo === 'escolha') {
        const op = c.opcoes.find((o) => o.chave === dados?.[c.chave]?.opcao)
        if (op) percorrer(op.campos || [], dados[c.chave].dados || {})
      }
    }
  }
  percorrer(schema.campos, conteudo || {})
  return lista
}
