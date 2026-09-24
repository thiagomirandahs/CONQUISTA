// =============================================================================
//  Fase 9.1 — o que as ferramentas de conferência do projeto HOSPEDADO têm em comum.
//
//  Usado por scripts/verificar-auth-hospedado.mjs, scripts/verificar-backup-hospedado.mjs e
//  supabase/carga/rampa-hospedada.mjs. Três regras que valem para todas, num lugar só:
//
//   1. A GUARDA DE PRODUÇÃO vem antes de qualquer requisição. Uma conferência que dá PASS no
//      projeto errado é pior do que nenhuma: o dono marca o piloto como verde olhando para a
//      produção (ou o contrário). E o teste de carga contra a produção seria um incidente.
//      A produção é lida do .env/.env.production do repositório — e, num worktree, também do
//      checkout principal, que é onde o .env de verdade mora — mais a lista AUTH_VERIFICAR_BLOQUEAR.
//      Alvo remoto sem NENHUMA URL de produção conhecida é recusado: sem saber o que é produção,
//      a guarda não guarda nada (falha fechada, como o build de produção sem endpoint).
//
//   2. SÓ GET. Nada aqui escreve em projeto nenhum. O token da Management API tem poder de
//      escrita sobre todos os projetos da organização; por isso o código só tem um verbo.
//
//   3. SEGREDO NÃO SAI. Nenhum valor de chave, token, senha de SMTP ou segredo de captcha é
//      impresso nem gravado — as ferramentas escolhem os campos que registram (lista branca),
//      em vez de tentar apagar os perigosos de uma resposta inteira (lista negra esquece campo novo).
// =============================================================================
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

// A Management API é fixa de propósito: deixar a URL configurável por variável seria um jeito de
// mandar o token pessoal do dono para um host qualquer.
export const API_GESTAO = 'https://api.supabase.com'

export class Recusa extends Error {}

// -----------------------------------------------------------------------------
//  .env
// -----------------------------------------------------------------------------
export function lerEnv(arquivo) {
  const vars = {}
  if (!existsSync(arquivo)) return vars
  for (const bruta of readFileSync(arquivo, 'utf8').split(/\r?\n/)) {
    const linha = bruta.trim()
    if (!linha || linha.startsWith('#')) continue
    const m = linha.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/)
    if (!m) continue
    let v = m[2].trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    vars[m[1]] = v
  }
  return vars
}

// A raiz do repositório e, se estivermos num worktree, a do checkout principal (o .git comum).
export function raizesDoRepositorio() {
  const raizes = [process.cwd()]
  const git = (args) => {
    try { return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() } catch { return '' }
  }
  const topo = git(['rev-parse', '--show-toplevel'])
  if (topo) raizes.push(topo)
  const comum = git(['rev-parse', '--path-format=absolute', '--git-common-dir'])
  if (comum) raizes.push(dirname(comum))
  return [...new Set(raizes.map((r) => resolve(r)))]
}

// -----------------------------------------------------------------------------
//  Identidade de um alvo: origem, host e "ref" do projeto (os 20 caracteres de <ref>.supabase.co)
// -----------------------------------------------------------------------------
const RE_REF = /^[a-z]{20}$/
export function normalizar(valor) {
  const v = String(valor || '').trim()
  if (!v) return null
  if (RE_REF.test(v)) return { ref: v, origin: null, host: null }
  let u
  try { u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(v) ? v : `https://${v}`) } catch { return null }
  const host = u.hostname.toLowerCase()
  const m = host.match(/(?:^|\.)([a-z]{20})\.supabase\.(?:co|in|net)$/)
  return { origin: `${u.protocol}//${u.host}`.toLowerCase(), host, ref: m ? m[1] : null }
}

export const ehLocal = (host) => ['127.0.0.1', 'localhost', '::1', '[::1]', 'host.docker.internal', '0.0.0.0'].includes(String(host || '').toLowerCase())

// Para aparecer em tela sem virar um "endereço da produção" colado em log de terceiros.
export const mascarar = (s) => (s ? `${String(s).slice(0, 4)}…` : '?')

// Tudo o que é PRODUÇÃO, e de onde veio.
export function alvosBloqueados() {
  const lista = []
  for (const raiz of raizesDoRepositorio()) {
    for (const nome of ['.env', '.env.production', '.env.production.local']) {
      const arq = join(raiz, nome)
      const vars = lerEnv(arq)
      for (const chave of ['VITE_SUPABASE_URL', 'SUPABASE_URL']) {
        const n = normalizar(vars[chave])
        // um .env que aponta para o Docker local não é produção (o .env.local do dev faz isso)
        if (n && !ehLocal(n.host)) lista.push({ ...n, origem: `${arq} (${chave})` })
      }
    }
  }
  for (const item of String(process.env.AUTH_VERIFICAR_BLOQUEAR || '').split(/[\s,;]+/).filter(Boolean)) {
    const n = normalizar(item)
    // "produção" sem ponto no host e sem cara de ref é erro de digitação — e uma guarda que aceita
    // lixo em silêncio dá a impressão de proteger sem proteger
    if (n && (n.ref || (n.host && n.host.includes('.')))) lista.push({ ...n, origem: 'AUTH_VERIFICAR_BLOQUEAR' })
    else throw new Recusa(`AUTH_VERIFICAR_BLOQUEAR tem um item que não é URL nem ref de projeto: "${mascarar(item)}"`)
  }
  return lista
}

// A guarda. Devolve { local, alvo, bloqueios } ou lança Recusa — ANTES de qualquer rede.
export function conferirAlvo(url, { ref = '' } = {}) {
  const alvo = normalizar(url)
  if (!alvo || !alvo.host) throw new Recusa(`URL do alvo inválida: "${mascarar(url)}"`)
  if (ref && !RE_REF.test(ref)) throw new Recusa('PROJECT_REF precisa ter 20 letras minúsculas (o <ref> de <ref>.supabase.co)')
  const bloqueios = alvosBloqueados()
  const igual = (b) => (b.origin && b.origin === alvo.origin) || (b.host && b.host === alvo.host)
    || (b.ref && (b.ref === alvo.ref || b.ref === ref))
  const achou = bloqueios.find(igual)
  if (achou) {
    const qual = achou.ref && achou.ref === ref && achou.ref !== alvo.ref ? `o PROJECT_REF (${mascarar(ref)})` : `o alvo (${mascarar(alvo.ref || alvo.host)})`
    throw new Recusa(`RECUSADO: ${qual} é a PRODUÇÃO — veio de ${achou.origem}. `
      + 'Estas ferramentas são para o projeto do PILOTO/staging hospedado; um PASS na produção seria atribuído ao projeto errado.')
  }
  if (ehLocal(alvo.host)) return { local: true, alvo, bloqueios }
  if (!bloqueios.length) {
    throw new Recusa('RECUSADO: não encontrei a URL da produção (.env/.env.production aqui nem no checkout principal) — '
      + 'sem ela a guarda não sabe o que recusar. Defina AUTH_VERIFICAR_BLOQUEAR=<url-ou-ref-da-producao> e rode de novo.')
  }
  // URL de *.supabase.co e PROJECT_REF de projetos diferentes = duas conferências misturadas
  if (ref && alvo.ref && ref !== alvo.ref) {
    throw new Recusa(`RECUSADO: PROJECT_REF (${mascarar(ref)}) não é o projeto de SUPABASE_URL (${mascarar(alvo.ref)}).`)
  }
  return { local: false, alvo, bloqueios }
}

// -----------------------------------------------------------------------------
//  Rede: só GET
// -----------------------------------------------------------------------------
export async function obterJson(url, headers = {}, ms = 15000) {
  try {
    const r = await fetch(url, { method: 'GET', headers, signal: AbortSignal.timeout(ms) })
    const texto = await r.text()
    let json = null
    try { json = JSON.parse(texto) } catch { /* resposta que não é JSON: fica em erro */ }
    const erro = r.ok ? null : String(json?.message || json?.msg || json?.error || texto || '').slice(0, 160)
    return { status: r.status, json: r.ok ? json : null, erro }
  } catch (e) {
    return { status: 0, json: null, erro: e?.name === 'TimeoutError' ? `sem resposta em ${ms / 1000} s` : String(e?.message || e) }
  }
}

export const gestao = (ref, caminho, token) =>
  obterJson(`${API_GESTAO}/v1/projects/${ref}${caminho}`, { Authorization: `Bearer ${token}`, Accept: 'application/json' })

// -----------------------------------------------------------------------------
//  Critérios: PASS / FAIL / NAO-VERIFICAVEL
// -----------------------------------------------------------------------------
export const PASS = 'PASS'
export const FAIL = 'FAIL'
export const NV = 'NAO-VERIFICAVEL'

export function novoRelatorio() {
  const criterios = []
  const add = ({ id, titulo, obrigatorio = true, resultado, valor = null, esperado = '', nota = '' }) => {
    criterios.push({ id, titulo, obrigatorio, resultado, valor, esperado, nota })
  }
  return { criterios, add }
}

export function resumir(criterios) {
  const obrig = criterios.filter((c) => c.obrigatorio)
  const conta = (lista, r) => lista.filter((c) => c.resultado === r).length
  const r = {
    obrigatorios: { PASS: conta(obrig, PASS), FAIL: conta(obrig, FAIL), [NV]: conta(obrig, NV) },
    complementares: { PASS: conta(criterios.filter((c) => !c.obrigatorio), PASS), FAIL: conta(criterios.filter((c) => !c.obrigatorio), FAIL),
      [NV]: conta(criterios.filter((c) => !c.obrigatorio), NV) },
  }
  // VERDE só com todos os obrigatórios em PASS. NÃO-VERIFICÁVEL não é "quase verde": é não sabido.
  r.veredito = r.obrigatorios.FAIL ? 'VERMELHO' : r.obrigatorios[NV] ? 'INCOMPLETO' : 'VERDE'
  r.codigo_saida = r.obrigatorios.FAIL ? 1 : r.obrigatorios[NV] ? 2 : 0
  return r
}

export function imprimirCriterios(criterios) {
  const larg = Math.max(...criterios.map((c) => c.id.length), 10)
  for (const c of criterios) {
    const marca = c.resultado === PASS ? 'PASS           ' : c.resultado === FAIL ? 'FAIL           ' : 'NAO-VERIFICAVEL'
    const tipo = c.obrigatorio ? ' ' : '·'
    const valor = c.valor === null || c.valor === undefined ? '' : ` = ${typeof c.valor === 'object' ? JSON.stringify(c.valor) : c.valor}`
    console.log(`${marca} ${tipo} ${c.id.padEnd(larg)}  ${c.titulo}${valor}`)
    if (c.resultado !== PASS && c.esperado) console.log(`${' '.repeat(18 + larg)}  esperado: ${c.esperado}`)
    if (c.nota) console.log(`${' '.repeat(18 + larg)}  ${c.nota}`)
  }
  console.log(`\n(· = complementar: registrado, mas não decide o veredito)`)
}

// argumentos --chave valor, --chave=valor e --flag (as flags sem valor são declaradas, para que
// `--json arquivo` não engula um argumento posicional)
export function lerArgs(argv, flags = []) {
  const a = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    const s = argv[i]
    if (s.startsWith('--')) {
      const [k, ...resto] = s.slice(2).split('=')
      const v = resto.length ? resto.join('=') : undefined
      if (v !== undefined) a[k] = v
      else if (flags.includes(k)) a[k] = true
      else if (argv[i + 1] !== undefined && !argv[i + 1].startsWith('--')) a[k] = argv[++i]
      else a[k] = true
    } else a._.push(s)
  }
  return a
}
