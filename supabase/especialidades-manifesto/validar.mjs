#!/usr/bin/env node
// Validador do manifesto de ESPECIALIDADES (fase 7) — o MANIFESTO é a fonte de verdade do catálogo.
// Formato: conquista.especialidades/2   →  supabase/especialidades-manifesto/areas/<AREA>.json
//   (e, SÓ para teste local, teste/<nome>.json com "teste": true — nunca vira migration).
//
// REGRA DE OURO: nenhum requisito é inventado. Todo requisito precisa de fonte verificável (https, domínio
// reconhecido) e de "status_fonte":"conferido". Especialidade sem requisito conferido existe só como
// "catalogo" (nome/área) e NÃO é publicada para os membros.
//
// Arquivo:   { formato, versao, area, area_nome, preparado_em, teste?, exemplo?, observacao?,
//              fonte: { nome, url, consultada_em, revisao?, status: "conferido"|"pendente" },   ← proveniência
//              especialidades: [ Especialidade ] }
// Especialidade: { codigo, nome, nivel?, fonte_url, estado: "catalogo"|"publicavel", grupos?, requisitos? }
// Grupo (N de M): { chave, rotulo, minimo }
// Requisito: { ordem, descricao, tipo_evidencia, evidencia_obrigatoria?, modelo?, grupo?, depende_de?: [ordem…],
//              prazo_dias?, fonte_url, status_fonte }
//   tipos: leitura · resposta · relatorio · foto · arquivo · atividade · validacao  (+ os legados do motor)
//   meta/quantidade = campo `numero` com `min` no modelo · escolha dentro do requisito = campo `escolha` do modelo
//   N de M ENTRE requisitos = `grupo` (+ minimo) · dependência = depende_de (ordens MENORES) · prazo_dias
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { validarModelo } from '../../src/lib/relatorio/modelo.js'

export const FORMATO = 'conquista.especialidades/2'
export const DOMINIOS_OFICIAIS = ['adventistas.org', 'cpb.com.br']
export const DOMINIOS_COMUNITARIOS = ['mda.wiki.br']    // só para conferência: nunca conta como fonte oficial
export const TIPOS_EVIDENCIA = ['leitura', 'resposta', 'relatorio', 'foto', 'arquivo', 'atividade', 'validacao']
const TIPOS_QUE_EXIGEM_MODELO = ['leitura', 'resposta', 'relatorio', 'foto', 'arquivo', 'atividade', 'validacao']
const CHAVES_ARQUIVO = ['formato', 'versao', 'area', 'area_nome', 'preparado_em', 'teste', 'exemplo', 'observacao', 'fonte', 'especialidades']
const CHAVES_FONTE = ['nome', 'url', 'consultada_em', 'revisao', 'status']
const CHAVES_ESPEC = ['codigo', 'nome', 'nivel', 'fonte_url', 'estado', 'grupos', 'requisitos']
const CHAVES_GRUPO = ['chave', 'rotulo', 'minimo']
const CHAVES_REQ = ['ordem', 'descricao', 'tipo_evidencia', 'evidencia_obrigatoria', 'modelo', 'grupo', 'depende_de', 'prazo_dias', 'fonte_url', 'status_fonte']
const PADRAO_CODIGO = /^([A-Z]{2})(?:-EB)?-\d{3}$/
const MARCAS_DE_TESTE = /\[(EXEMPLO|TESTE|DADO DE TESTE|STAGING)\]/i
const DATA = /^\d{4}-\d{2}-\d{2}$/

export const dirManifesto = dirname(fileURLToPath(import.meta.url))
export const dirAreas = join(dirManifesto, 'areas')
export const dirTeste = join(dirManifesto, 'teste')

function host(url) {
  try { const u = new URL(url); return u.protocol === 'https:' ? u.hostname : null } catch { return null }
}
const doDominio = (h, lista) => !!h && lista.some((d) => h === d || h.endsWith('.' + d))
export const fonteOficial = (url) => doDominio(host(url), DOMINIOS_OFICIAIS)
export const fonteReconhecida = (url) => doDominio(host(url), [...DOMINIOS_OFICIAIS, ...DOMINIOS_COMUNITARIOS])

// PURA: recebe [{arquivo, dados, teste?}] e devolve { erros, avisos }
export function validarEspecialidades(arquivos) {
  const erros = []
  const avisos = []
  const codigos = new Map()
  const falha = (arq, msg) => erros.push(`${arq}: ${msg}`)

  for (const { arquivo, dados, doDirTeste = false } of arquivos) {
    if (!dados || typeof dados !== 'object') { falha(arquivo, 'conteúdo não é um objeto JSON'); continue }
    if (dados.formato !== FORMATO) falha(arquivo, `formato deve ser "${FORMATO}"`)
    for (const k of Object.keys(dados)) if (!CHAVES_ARQUIVO.includes(k)) falha(arquivo, `chave desconhecida "${k}"`)
    if (!/^[A-Z]{2}$/.test(dados.area || '')) falha(arquivo, 'area deve ter 2 letras maiúsculas')
    if (!dados.area_nome) falha(arquivo, 'area_nome obrigatório')
    if (!Number.isInteger(dados.versao) || dados.versao < 1) falha(arquivo, 'versao inteira >= 1 (mudou conteúdo = versão nova)')
    if (dados.teste === true && !doDirTeste) falha(arquivo, '"teste": true só na pasta teste/')
    if (dados.teste !== true && doDirTeste) falha(arquivo, 'arquivo da pasta teste/ precisa de "teste": true')
    if (!doDirTeste && arquivo !== `${dados.area}.json` && arquivo !== 'exemplo.json') falha(arquivo, `o nome do arquivo deve ser ${dados.area}.json`)
    if (dados.exemplo === true && arquivo !== 'exemplo.json') falha(arquivo, '"exemplo": true só em exemplo.json')
    const ehReal = !doDirTeste && arquivo !== 'exemplo.json'
    if (ehReal && MARCAS_DE_TESTE.test(JSON.stringify(dados))) falha(arquivo, 'arquivo real carrega marca de teste/exemplo')
    if (doDirTeste && !MARCAS_DE_TESTE.test(JSON.stringify(dados))) falha(arquivo, 'arquivo de teste deve carregar a marca [TESTE] nos nomes')

    // ---- proveniência (data da consulta, revisão, status) ----
    const f = dados.fonte
    if (!f || typeof f !== 'object') falha(arquivo, 'fonte (proveniência) obrigatória: { nome, url, consultada_em, revisao?, status }')
    else {
      for (const k of Object.keys(f)) if (!CHAVES_FONTE.includes(k)) falha(arquivo, `fonte: chave desconhecida "${k}"`)
      if (!f.nome) falha(arquivo, 'fonte.nome obrigatório')
      if (!host(f.url)) falha(arquivo, 'fonte.url deve ser https')
      if (!DATA.test(f.consultada_em || '') || Number.isNaN(Date.parse(f.consultada_em))) falha(arquivo, 'fonte.consultada_em deve ser AAAA-MM-DD')
      if (!['conferido', 'pendente'].includes(f.status)) falha(arquivo, 'fonte.status deve ser "conferido" ou "pendente"')
      if (ehReal && f.status === 'conferido' && !fonteOficial(f.url)) falha(arquivo, 'fonte "conferido" precisa ser de domínio OFICIAL (a wiki comunitária só serve para conferência)')
      if (ehReal && !fonteReconhecida(f.url)) falha(arquivo, 'fonte.url de domínio não reconhecido')
    }
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
      if (!host(e.fonte_url)) falha(id, 'fonte_url deve ser https')
      else if (ehReal && !fonteReconhecida(e.fonte_url)) falha(id, 'fonte_url de domínio não reconhecido')
      if (!['catalogo', 'publicavel'].includes(e.estado)) { falha(id, 'estado deve ser "catalogo" ou "publicavel"'); continue }

      const reqs = e.requisitos || []
      if (e.estado === 'catalogo' && (reqs.length || (e.grupos || []).length)) falha(id, '"catalogo" não pode carregar requisitos/grupos (use "publicavel" só com requisitos conferidos)')
      if (e.estado === 'publicavel' && !reqs.length) falha(id, '"publicavel" exige requisitos — não se inventa requisito')
      if (e.estado === 'publicavel' && ehReal && f?.status !== 'conferido') falha(id, '"publicavel" exige fonte.status = "conferido"')

      const grupos = new Map()
      for (const g of e.grupos || []) {
        for (const k of Object.keys(g || {})) if (!CHAVES_GRUPO.includes(k)) falha(id, `grupo: chave desconhecida "${k}"`)
        if (!/^[a-z][a-z0-9_]{0,39}$/.test(g?.chave || '')) falha(id, `grupo com chave inválida (${g?.chave})`)
        if (grupos.has(g?.chave)) falha(id, `grupo repetido (${g?.chave})`)
        if (!g?.rotulo) falha(id, `grupo ${g?.chave}: rotulo obrigatório`)
        if (!Number.isInteger(g?.minimo) || g.minimo < 1) falha(id, `grupo ${g?.chave}: minimo inteiro >= 1`)
        grupos.set(g?.chave, g)
      }
      const contagemGrupo = new Map()
      const ordens = new Set()
      reqs.forEach((r, i) => {
        const rid = `${id} › req ${r?.ordem ?? i + 1}`
        for (const k of Object.keys(r || {})) if (!CHAVES_REQ.includes(k)) falha(rid, `chave desconhecida "${k}"`)
        if (r.ordem !== i + 1) falha(rid, `ordem deve ser sequencial (esperado ${i + 1})`)
        ordens.add(r.ordem)
        if (!r.descricao || String(r.descricao).trim().length < 5) falha(rid, 'descricao obrigatória')
        if (!TIPOS_EVIDENCIA.includes(r.tipo_evidencia)) falha(rid, `tipo_evidencia inválido (${r.tipo_evidencia})`)
        if (!host(r.fonte_url)) falha(rid, 'fonte_url deve ser https')
        else if (ehReal && !fonteReconhecida(r.fonte_url)) falha(rid, 'fonte_url de domínio não reconhecido')
        if (r.status_fonte !== 'conferido') falha(rid, 'status_fonte deve ser "conferido" (texto conferido na fonte)')
        if (r.modelo != null) for (const x of validarModelo(r.modelo)) falha(rid, x)
        else if (TIPOS_QUE_EXIGEM_MODELO.includes(r.tipo_evidencia)) falha(rid, `tipo "${r.tipo_evidencia}" exige "modelo" (campos do formulário)`)
        if (r.tipo_evidencia === 'relatorio' && !(r.modelo?.campos || []).some((c) => c.tipo !== 'anexos' && c.tipo !== 'confirmacao')) falha(rid, 'relatorio precisa de campos próprios (não só confirmação/anexos)')
        if (r.grupo != null) {
          if (!grupos.has(r.grupo)) falha(rid, `grupo "${r.grupo}" não declarado em "grupos"`)
          contagemGrupo.set(r.grupo, (contagemGrupo.get(r.grupo) || 0) + 1)
        }
        if (r.depende_de != null) {
          if (!Array.isArray(r.depende_de) || !r.depende_de.every((d) => Number.isInteger(d) && d >= 1 && d < r.ordem)) falha(rid, 'depende_de deve listar ordens MENORES que a do requisito')
          else if (r.depende_de.some((d) => reqs[d - 1]?.grupo)) falha(rid, 'depende_de não pode apontar para requisito de um grupo N de M')
        }
        if (r.prazo_dias != null && !(Number.isInteger(r.prazo_dias) && r.prazo_dias >= 1 && r.prazo_dias <= 730)) falha(rid, 'prazo_dias inteiro de 1 a 730')
        if (r.evidencia_obrigatoria != null && typeof r.evidencia_obrigatoria !== 'boolean') falha(rid, 'evidencia_obrigatoria deve ser booleano')
      })
      for (const [chave, g] of grupos) {
        const n = contagemGrupo.get(chave) || 0
        if (n === 0) falha(id, `grupo "${chave}" sem requisitos`)
        else if (g.minimo > n) falha(id, `grupo "${chave}": minimo ${g.minimo} maior que os ${n} requisitos do grupo`)
        else if (g.minimo === n) avisos.push(`${id}: grupo "${chave}" exige todos os requisitos (minimo = total); talvez não precise de grupo`)
      }
    }
  }
  if (!arquivos.length) avisos.push('nenhum arquivo de área ainda (estrutura pronta; conteúdo depende de fonte aprovada)')
  return { erros, avisos }
}

function lerPasta(dir, doDirTeste) {
  if (!existsSync(dir)) return []
  return readdirSync(dir).filter((f) => f.endsWith('.json')).sort().map((arquivo) => {
    try { return { arquivo, doDirTeste, dados: JSON.parse(readFileSync(join(dir, arquivo), 'utf8')) } }
    catch (e) { return { arquivo, doDirTeste, dados: null, erroLeitura: e.message } }
  })
}
export const carregarAreas = (dir = dirAreas) => lerPasta(dir, false)
export const carregarTeste = (dir = dirTeste) => lerPasta(dir, true)

const ehCli = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]
if (ehCli) {
  const arqs = [...carregarAreas(), ...carregarTeste()]
  const { erros, avisos } = validarEspecialidades(arqs.filter((a) => a.dados))
  arqs.filter((a) => a.erroLeitura).forEach((a) => erros.push(`${a.arquivo}: JSON inválido — ${a.erroLeitura}`))
  avisos.forEach((a) => console.log(`  aviso ${a}`))
  erros.forEach((e) => console.log(`  FAIL ${e}`))
  console.log(erros.length ? `\n${erros.length} erro(s).` : `\nOK — ${arqs.length} arquivo(s) válido(s) (${arqs.filter((a) => a.doDirTeste).length} de teste local).`)
  process.exit(erros.length ? 1 : 0)
}

