#!/usr/bin/env node
// Validador do manifesto de ESPECIALIDADES (fase 7). Contraparte do validar.mjs das Classes.
// REGRA DE OURO: nenhum requisito é inventado. Todo requisito precisa de fonte verificável (URL https de
// domínio reconhecido) e de "status_fonte":"conferido" (alguém conferiu o texto na fonte). Especialidade
// sem requisito conferido pode existir só como "catalogo" (nome/área) e NÃO é publicada para os membros.
//
// Formato: conquista.especialidades/1  →  supabase/especialidades-manifesto/areas/<AREA>.json
//   { formato, area: "AA", area_nome, preparado_em, especialidades: [ { codigo, nome, nivel?, fonte_url,
//       estado: "catalogo" | "publicavel", requisitos?: [ { ordem, descricao, tipo_evidencia, fonte_url, status_fonte } ] } ] }
//
// Rejeita: formato/chave desconhecida; código fora do padrão ou repetido; código de outra área; fonte sem https
// ou de domínio não reconhecido; "publicavel" sem requisitos; requisito sem ordem sequencial, descrição,
// tipo_evidencia válido, fonte ou com status_fonte != "conferido"; "catalogo" carregando requisitos;
// marcas de teste ([EXEMPLO]/[TESTE]) em arquivo real.
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

export const FORMATO = 'conquista.especialidades/1'
export const DOMINIOS_RECONHECIDOS = ['mda.wiki.br', 'adventistas.org', 'cpb.com.br']
export const TIPOS_EVIDENCIA = ['nenhuma', 'texto', 'foto', 'arquivo', 'presenca', 'atividade', 'biblia', 'evento', 'especialidade', 'externo']
const CHAVES_ARQUIVO = ['formato', 'area', 'area_nome', 'exemplo', 'preparado_em', 'observacao', 'especialidades']
const CHAVES_ESPEC = ['codigo', 'nome', 'nivel', 'fonte_url', 'estado', 'requisitos']
const CHAVES_REQ = ['ordem', 'descricao', 'tipo_evidencia', 'fonte_url', 'status_fonte']
const PADRAO_CODIGO = /^([A-Z]{2})(?:-EB)?-\d{3}$/
const MARCAS_DE_TESTE = /\[(EXEMPLO|TESTE|DADO DE TESTE|STAGING)\]/i

export const dirManifesto = dirname(fileURLToPath(import.meta.url))
export const dirAreas = join(dirManifesto, 'areas')

function dominioReconhecido(url) {
  try {
    const u = new URL(url)
    return u.protocol === 'https:' && DOMINIOS_RECONHECIDOS.some((d) => u.hostname === d || u.hostname.endsWith('.' + d))
  } catch { return false }
}

// PURA: recebe [{arquivo, dados}] e devolve { erros:[], avisos:[] }
export function validarEspecialidades(arquivos) {
  const erros = []
  const avisos = []
  const codigos = new Map()
  const falha = (arq, msg) => erros.push(`${arq}: ${msg}`)

  for (const { arquivo, dados } of arquivos) {
    if (!dados || typeof dados !== 'object') { falha(arquivo, 'conteúdo não é um objeto JSON'); continue }
    if (dados.formato !== FORMATO) falha(arquivo, `formato deve ser "${FORMATO}"`)
    for (const k of Object.keys(dados)) if (!CHAVES_ARQUIVO.includes(k)) falha(arquivo, `chave desconhecida "${k}"`)
    if (!/^[A-Z]{2}$/.test(dados.area || '')) falha(arquivo, 'area deve ter 2 letras maiúsculas')
    if (!dados.area_nome) falha(arquivo, 'area_nome obrigatório')
    if (arquivo !== `${dados.area}.json` && arquivo !== 'exemplo.json') falha(arquivo, `o nome do arquivo deve ser ${dados.area}.json`)
    if (dados.exemplo === true && arquivo !== 'exemplo.json') falha(arquivo, '"exemplo": true só em exemplo.json')
    if (arquivo !== 'exemplo.json' && MARCAS_DE_TESTE.test(JSON.stringify(dados))) falha(arquivo, 'arquivo real carrega marca de teste/exemplo')
    if (!Array.isArray(dados.especialidades)) { falha(arquivo, 'especialidades deve ser uma lista'); continue }

    for (const e of dados.especialidades) {
      const id = `${arquivo} › ${e?.codigo || '?'}`
      for (const k of Object.keys(e || {})) if (!CHAVES_ESPEC.includes(k)) falha(id, `chave desconhecida "${k}"`)
      const m = PADRAO_CODIGO.exec(e?.codigo || '')
      if (!m) { falha(id, 'código fora do padrão AA-000 / AA-EB-000'); continue }
      if (m[1] !== dados.area) falha(id, `código de outra área (${m[1]} ≠ ${dados.area})`)
      if (codigos.has(e.codigo)) falha(id, `código repetido (também em ${codigos.get(e.codigo)})`)
      codigos.set(e.codigo, arquivo)
      if (!e.nome) falha(id, 'nome obrigatório')
      if (e.nivel != null && !(Number.isInteger(e.nivel) && e.nivel >= 1 && e.nivel <= 5)) falha(id, 'nivel deve ser inteiro de 1 a 5')
      if (!dominioReconhecido(e.fonte_url)) falha(id, 'fonte_url deve ser https de domínio reconhecido')
      if (!['catalogo', 'publicavel'].includes(e.estado)) { falha(id, 'estado deve ser "catalogo" ou "publicavel"'); continue }

      const reqs = e.requisitos || []
      if (e.estado === 'catalogo' && reqs.length) falha(id, '"catalogo" não pode carregar requisitos (use "publicavel" só com requisitos conferidos)')
      if (e.estado === 'publicavel' && !reqs.length) falha(id, '"publicavel" exige requisitos — não se inventa requisito')
      reqs.forEach((r, i) => {
        const rid = `${id} › req ${r?.ordem ?? i + 1}`
        for (const k of Object.keys(r || {})) if (!CHAVES_REQ.includes(k)) falha(rid, `chave desconhecida "${k}"`)
        if (r.ordem !== i + 1) falha(rid, `ordem deve ser sequencial (esperado ${i + 1})`)
        if (!r.descricao || String(r.descricao).trim().length < 5) falha(rid, 'descricao obrigatória')
        if (!TIPOS_EVIDENCIA.includes(r.tipo_evidencia)) falha(rid, `tipo_evidencia inválido (${r.tipo_evidencia})`)
        if (!dominioReconhecido(r.fonte_url)) falha(rid, 'fonte_url deve ser https de domínio reconhecido')
        if (r.status_fonte !== 'conferido') falha(rid, 'status_fonte deve ser "conferido" (texto conferido na fonte)')
      })
    }
  }
  if (!arquivos.length) avisos.push('nenhum arquivo de área ainda (estrutura pronta; conteúdo depende de fonte aprovada)')
  return { erros, avisos }
}

export function carregarAreas(dir = dirAreas) {
  if (!existsSync(dir)) return []
  return readdirSync(dir).filter((f) => f.endsWith('.json')).sort().map((arquivo) => {
    try { return { arquivo, dados: JSON.parse(readFileSync(join(dir, arquivo), 'utf8')) } }
    catch (e) { return { arquivo, dados: null, erroLeitura: e.message } }
  })
}

const ehCli = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]
if (ehCli) {
  const arqs = carregarAreas()
  const { erros, avisos } = validarEspecialidades(arqs.filter((a) => a.dados))
  arqs.filter((a) => a.erroLeitura).forEach((a) => erros.push(`${a.arquivo}: JSON inválido — ${a.erroLeitura}`))
  avisos.forEach((a) => console.log(`  aviso ${a}`))
  erros.forEach((e) => console.log(`  FAIL ${e}`))
  console.log(erros.length ? `\n${erros.length} erro(s).` : `\nOK — ${arqs.length} arquivo(s) de área válido(s).`)
  process.exit(erros.length ? 1 : 0)
}
