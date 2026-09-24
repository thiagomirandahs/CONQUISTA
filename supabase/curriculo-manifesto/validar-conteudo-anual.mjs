#!/usr/bin/env node
// Validador do manifesto de CONTEÚDO ANUAL (fase 9.1, item 8) — o "Curso de Leitura do ano" de
// cada classe. É a contraparte de validar.mjs para o valor que muda todo ano civil: o catálogo das
// classes diz QUE existe um requisito anual (tipo anual_dinamico); este manifesto diz QUAL é o
// conteúdo de um ano, com fonte. Nada entra no banco sem passar por aqui (o gerador,
// gerar-conteudo-anual.mjs, recusa manifesto com erro).
//
// Rejeita (exit != 0) qualquer arquivo supabase/curriculo-manifesto/conteudo-anual/*.json que:
//   1) não seja do formato conquista.conteudo_anual/1, ou traga chave que o formato não conhece;
//   2) não tenha "ano" inteiro de 4 dígitos, ou cujo nome (<ano>.json) não bata com o "ano";
//   3) tenha item sem vigência FECHADA (vigente_desde E vigente_ate), ou com vigência fora do ano;
//   4) tenha item sem valor, sem fonte_url https ou sem fonte_descricao;
//   5) cite uma chave que não é slot de conteúdo anual das Classes Regulares do manifesto
//      (curso_leitura_<classe> das classes com requisito anual_dinamico);
//   6) deixe LACUNA: algum slot sem conteúdo, ou um slot que não cobre o ano inteiro de 01/01 a
//      31/12, ou com períodos que se sobrepõem;
//   7) misture exemplo com conteúdo real: "exemplo": true só em exemplo.json (e com "[EXEMPLO]" no
//      valor); arquivo de ano não pode ser exemplo nem carregar "[EXEMPLO]" ou "[TESTE]".
// Avisa (não bloqueia) quando a fonte não é de um domínio reconhecido como oficial.
//
// validarConteudoAnual é PURA (recebe dados já carregados) — o autoteste
// (conteudo-anual.autoteste.mjs) prova cada rejeição com dados sintéticos.
//
// Uso:
//   node supabase/curriculo-manifesto/validar-conteudo-anual.mjs
//   npm run curriculo:conteudo-anual:validar
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { carregarClasses } from './validar.mjs'

export const FORMATO = 'conquista.conteudo_anual/1'
const CHAVES_ARQUIVO = ['formato', 'ano', 'exemplo', 'preparado_em', 'observacao', 'itens']
const CHAVES_ITEM = ['chave', 'valor', 'vigente_desde', 'vigente_ate', 'fonte_url', 'fonte_descricao']
// domínios que a auditoria curricular reconhece como fonte primária (DSA) ou editora oficial (CPB)
export const DOMINIOS_OFICIAIS = ['adventistas.org', 'cpb.com.br']
const MARCAS_DE_TESTE = /\[(EXEMPLO|TESTE|DADO DE TESTE|STAGING)\]/i

export const dirManifesto = dirname(fileURLToPath(import.meta.url))
export const dirConteudoAnual = join(dirManifesto, 'conteudo-anual')

// Os slots vêm do MESMO manifesto das classes (e da mesma regra do importador, migration 39):
// toda Classe Regular com requisito anual_dinamico tem o slot curso_leitura_<id da classe>.
export function slotsDoManifestoDeClasses(arquivosClasses) {
  const slots = new Set()
  for (const { dados } of arquivosClasses) {
    const c = dados.classe_regular
    if (!c) continue
    const temAnual = (c.secoes || []).some((s) => (s.requisitos || []).some((r) => r.tipo === 'anual_dinamico'))
    if (temAnual) slots.add('curso_leitura_' + c.id)
  }
  return [...slots].sort()
}

function dataValida(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
  const d = new Date(s + 'T00:00:00Z')
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s
}
const diaDoAno = (s) => Math.round((Date.parse(s + 'T00:00:00Z') - Date.parse(s.slice(0, 4) + '-01-01T00:00:00Z')) / 86400000)
const diasNoAno = (ano) => (Date.UTC(ano + 1, 0, 1) - Date.UTC(ano, 0, 1)) / 86400000

function dominioDe(url) {
  try { return new URL(url).hostname.toLowerCase() } catch { return null }
}

// validarConteudoAnual({ arquivo, dados, slotsEsperados }) -> { erros, avisos }
export function validarConteudoAnual({ arquivo, dados, slotsEsperados }) {
  const erros = []
  const avisos = []
  const onde = arquivo
  if (!dados || typeof dados !== 'object' || Array.isArray(dados)) return { erros: [`${onde}: não é um objeto JSON.`], avisos }

  const extras = Object.keys(dados).filter((k) => !CHAVES_ARQUIVO.includes(k))
  if (extras.length) erros.push(`${onde}: chave(s) que o formato não conhece: ${extras.join(', ')} — recusado, não aproximado.`)
  if (dados.formato !== FORMATO) erros.push(`${onde}: "formato" precisa ser "${FORMATO}".`)

  const ano = dados.ano
  if (!Number.isInteger(ano) || ano < 2000 || ano > 2999) {
    erros.push(`${onde}: "ano" precisa ser o ano civil, inteiro de 4 dígitos (recebido: ${JSON.stringify(ano)}).`)
  }
  const ehExemplo = dados.exemplo === true
  if (dados.exemplo !== undefined && typeof dados.exemplo !== 'boolean') erros.push(`${onde}: "exemplo" só aceita true/false.`)
  const nomeAno = /^(\d{4})\.json$/.exec(arquivo)
  if (arquivo === 'exemplo.json') {
    if (!ehExemplo) erros.push(`${onde}: o arquivo de exemplo precisa declarar "exemplo": true (ninguém pode confundi-lo com conteúdo real).`)
  } else if (nomeAno) {
    if (ehExemplo) erros.push(`${onde}: arquivo de ano não pode ser "exemplo": true — exemplo mora só em exemplo.json.`)
    if (Number.isInteger(ano) && Number(nomeAno[1]) !== ano) erros.push(`${onde}: o nome do arquivo diz ${nomeAno[1]}, o conteúdo diz ${ano}.`)
  } else {
    erros.push(`${onde}: nome inválido — use <ano>.json (ex.: 2027.json) ou exemplo.json.`)
  }
  if (dados.preparado_em !== undefined && !dataValida(dados.preparado_em)) erros.push(`${onde}: "preparado_em" inválida (AAAA-MM-DD).`)

  const itens = dados.itens
  if (!Array.isArray(itens) || itens.length === 0) {
    erros.push(`${onde}: "itens" vazio — nada a publicar.`)
    return { erros, avisos }
  }

  const porSlot = new Map()
  itens.forEach((it, i) => {
    const o = `${onde}#itens[${i}]${it && it.chave ? ` (${it.chave})` : ''}`
    if (!it || typeof it !== 'object' || Array.isArray(it)) { erros.push(`${o}: item não é objeto.`); return }
    const ex = Object.keys(it).filter((k) => !CHAVES_ITEM.includes(k))
    if (ex.length) erros.push(`${o}: chave(s) desconhecida(s): ${ex.join(', ')}.`)
    if (typeof it.chave !== 'string' || !slotsEsperados.includes(it.chave)) {
      erros.push(`${o}: "${it.chave}" não é slot de conteúdo anual das Classes Regulares (esperados: ${slotsEsperados.join(', ')}).`)
    }
    if (typeof it.valor !== 'string' || it.valor.trim() === '') erros.push(`${o}: sem "valor".`)
    else if (it.valor.length > 300) erros.push(`${o}: "valor" longo demais (${it.valor.length} > 300) — é o nome do livro/conteúdo, não o texto.`)
    else if (ehExemplo && !it.valor.startsWith('[EXEMPLO]')) erros.push(`${o}: no exemplo, todo valor começa com "[EXEMPLO]".`)
    else if (!ehExemplo && MARCAS_DE_TESTE.test(it.valor)) erros.push(`${o}: valor marcado como exemplo/teste num arquivo de ano real.`)

    const fechado = it.vigente_desde !== undefined && it.vigente_ate !== undefined && it.vigente_ate !== null
    if (!fechado) erros.push(`${o}: vigência ABERTA — vigente_desde e vigente_ate são obrigatórios (nenhum valor vale em outro ano).`)
    const desdeOk = dataValida(it.vigente_desde)
    const ateOk = dataValida(it.vigente_ate)
    if (fechado && (!desdeOk || !ateOk)) erros.push(`${o}: vigência com data inválida (AAAA-MM-DD).`)
    if (desdeOk && ateOk && Number.isInteger(ano)) {
      if (it.vigente_desde.slice(0, 4) !== String(ano) || it.vigente_ate.slice(0, 4) !== String(ano)) {
        erros.push(`${o}: vigência ${it.vigente_desde} a ${it.vigente_ate} fora do ano ${ano}.`)
      } else if (it.vigente_ate < it.vigente_desde) {
        erros.push(`${o}: vigente_ate antes de vigente_desde.`)
      } else if (typeof it.chave === 'string') {
        if (!porSlot.has(it.chave)) porSlot.set(it.chave, [])
        porSlot.get(it.chave).push([diaDoAno(it.vigente_desde), diaDoAno(it.vigente_ate), o])
      }
    }

    if (typeof it.fonte_url !== 'string' || !/^https:\/\/\S+$/.test(it.fonte_url) || !dominioDe(it.fonte_url)) {
      erros.push(`${o}: "fonte_url" https obrigatória — de onde veio o conteúdo.`)
    } else if (!ehExemplo) {
      const dom = dominioDe(it.fonte_url)
      if (!DOMINIOS_OFICIAIS.some((d) => dom === d || dom.endsWith('.' + d))) {
        avisos.push(`${o}: fonte em ${dom}, fora dos domínios reconhecidos (${DOMINIOS_OFICIAIS.join(', ')}) — confira se é fonte oficial antes de publicar.`)
      }
    }
    if (typeof it.fonte_descricao !== 'string' || it.fonte_descricao.trim() === '') erros.push(`${o}: sem "fonte_descricao".`)
  })

  // lacunas: todo slot presente, cobrindo o ano inteiro, sem sobreposição
  if (Number.isInteger(ano)) {
    const total = diasNoAno(ano)
    for (const slot of slotsEsperados) {
      const periodos = (porSlot.get(slot) || []).sort((a, b) => a[0] - b[0])
      if (periodos.length === 0) {
        // item do slot com vigência inválida já gerou erro acima; aqui é o slot que ficou de fora
        if (!itens.some((it) => it && it.chave === slot)) erros.push(`${onde}: LACUNA — ${slot} sem conteúdo em ${ano}.`)
        continue
      }
      let esperado = 0
      for (const [ini, fim, o] of periodos) {
        if (ini < esperado) erros.push(`${o}: período se sobrepõe a outro do mesmo slot.`)
        else if (ini > esperado) erros.push(`${onde}: LACUNA — ${slot} fica sem conteúdo do dia ${esperado + 1} ao dia ${ini} de ${ano}.`)
        esperado = Math.max(esperado, fim + 1)
      }
      if (esperado < total) erros.push(`${onde}: LACUNA — ${slot} fica sem conteúdo do dia ${esperado + 1} ao fim de ${ano}.`)
    }
  }
  return { erros, avisos }
}

export function carregarManifestosDeConteudo(dir = dirConteudoAnual) {
  if (!existsSync(dir)) return []
  return readdirSync(dir).filter((f) => f.endsWith('.json') && f !== 'esquema.json').sort()
    .map((arquivo) => {
      try { return { arquivo, dados: JSON.parse(readFileSync(join(dir, arquivo), 'utf8')) } }
      catch (e) { return { arquivo, dados: null, erroLeitura: e.message } }
    })
}

export function slotsEsperados() {
  return slotsDoManifestoDeClasses(carregarClasses(dirManifesto))
}

const ehCli = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]
if (ehCli) {
  const slots = slotsEsperados()
  const manifestos = carregarManifestosDeConteudo()
  console.log('=== Validação do manifesto de conteúdo anual ===\n')
  console.log(`slots de conteúdo anual das Classes Regulares (do manifesto das classes): ${slots.join(', ')}\n`)
  let erros = 0
  if (manifestos.length === 0) console.log('(nenhum arquivo em conteudo-anual/)')
  for (const { arquivo, dados, erroLeitura } of manifestos) {
    const r = erroLeitura ? { erros: [`${arquivo}: JSON inválido — ${erroLeitura}`], avisos: [] } : validarConteudoAnual({ arquivo, dados, slotsEsperados: slots })
    const rotulo = dados?.exemplo === true ? ' (EXEMPLO — nunca publicado)' : ''
    if (r.erros.length === 0) console.log(`  ok   ${arquivo}${rotulo}: ano ${dados.ano}, ${dados.itens.length} item(ns), ${slots.length} slot(s) cobertos de 01/01 a 31/12`)
    else {
      erros += r.erros.length
      console.log(`  FAIL ${arquivo}${rotulo}: ${r.erros.length} violação(ões)`)
      for (const e of r.erros) console.log('     ✗ ' + e)
    }
    for (const a of r.avisos) console.log('     ! ' + a)
  }
  const anos = manifestos.filter((m) => /^\d{4}\.json$/.test(m.arquivo)).map((m) => m.arquivo.slice(0, 4))
  console.log(`\nanos com manifesto real: ${anos.length ? anos.join(', ') : 'nenhum ainda (a publicação de cada ano segue PUBLICACAO-CONTEUDO-ANUAL.md)'}`)
  console.log(erros === 0 ? 'OK — nenhuma violação.' : `FALHOU — ${erros} violação(ões).`)
  process.exit(erros === 0 ? 0 : 1)
}
