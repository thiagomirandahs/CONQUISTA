#!/usr/bin/env node
// =============================================================================
//  Fase 9.1, item 10 — a rampa de carga no staging HOSPEDADO, com a guarda de produção.
//
//  A rampa da fase 9 (rampa-fase9.sh) mediu ESTA máquina: o teto foi a rede do Docker no Windows,
//  não o Supabase. Isto aqui roda o MESMO k6 (k6-rampa-fase9.js, ALVO=hospedado) contra um projeto
//  hospedado de staging, em degraus pequenos com pausa entre eles, e decide "margem confortável"
//  por um critério escrito antes: o pico esperado do piloto × 3 sem violar o SLO.
//  Plano, números e limites: supabase/carga/CAPACIDADE-HOSPEDADA.md.
//
//  Três comandos:
//    node supabase/carga/rampa-hospedada.mjs plano                      # o que vai rodar, sem carga
//    node supabase/carga/rampa-hospedada.mjs tokens <contas.json>       # login das contas sintéticas
//    node supabase/carga/rampa-hospedada.mjs rodar [familias] [--escrever] [--rotulo nome]
//
//  Variáveis: BASE_HOSPEDADO e ANON_HOSPEDADO (o staging hospedado); USERS_HOSPEDADO (tokens; padrão
//  fora do repositório, em <tmp>/conquista-carga-hospedada/usuarios.json); DEGRAUS (10,25,50,100,200),
//  SUBIDA_S (30), PATAMAR_S (120), RESFRIAR_S (60), PAUSA_FAMILIAS_S (120); SLO_FALHA_PCT (1),
//  SLO_P95_MS (1000), SLO_P99_MS (3000); PICO_ESPERADO (padrão CLUBES_PILOTO 3 × MEMBROS_POR_CLUBE 40
//  × FRACAO_SIMULTANEA 0,5 = 60) e MARGEM (3); PULAR (operações da família piloto a não fazer).
//
//  GUARDAS, todas antes de qualquer requisição:
//    · a produção (scripts/lib/hospedado.mjs: .env/.env.production daqui e do checkout principal,
//      mais AUTH_VERIFICAR_BLOQUEAR) — recusa; e CARGA_BLOQUEAR, para o projeto do PILOTO depois
//      que ele tiver criança de verdade: carga nunca roda onde há dado real;
//    · o k6 repete a guarda no init (PRODUCAO_BLOQUEADA) e recusa token de outro projeto ou que
//      expire antes do fim da rampa;
//    · famílias que ESCREVEM (escrita, upload) só com --escrever;
//    · contas e tokens nunca dentro do repositório, a não ser em caminho que o .gitignore cubra.
// =============================================================================
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Recusa, conferirAlvo, normalizar, lerArgs } from '../../scripts/lib/hospedado.mjs'

const AQUI = dirname(fileURLToPath(import.meta.url))
const RAIZ = resolve(AQUI, '..', '..')
const args = lerArgs(process.argv.slice(2), ['escrever'])
const comando = args._[0] || 'plano'

const BASE = (process.env.BASE_HOSPEDADO || process.env.SUPABASE_URL || '').replace(/\/+$/, '')
const ANON = process.env.ANON_HOSPEDADO || process.env.SUPABASE_ANON_KEY || ''
const USERS_PADRAO = join(tmpdir(), 'conquista-carga-hospedada', 'usuarios.json')
const USERS = resolve(process.env.USERS_HOSPEDADO || USERS_PADRAO)
const num = (k, padrao) => Number(process.env[k] || padrao)
const DEGRAUS = String(process.env.DEGRAUS || '10,25,50,100,200').split(',').map(Number)
const SUBIDA = num('SUBIDA_S', 30); const PATAMAR = num('PATAMAR_S', 120); const RESFRIAR = num('RESFRIAR_S', 60)
const PAUSA = num('PAUSA_FAMILIAS_S', 120)
const SLO = { falha: num('SLO_FALHA_PCT', 1), p95: num('SLO_P95_MS', 1000), p99: num('SLO_P99_MS', 3000) }
const PICO = process.env.PICO_ESPERADO ? Number(process.env.PICO_ESPERADO)
  : Math.ceil(num('CLUBES_PILOTO', 3) * num('MEMBROS_POR_CLUBE', 40) * num('FRACAO_SIMULTANEA', 0.5))
const MARGEM = num('MARGEM', 3)
const LEITURA = ['piloto', 'rajada', 'leitura']
const ESCRITA = ['escrita', 'upload']

const duracaoFamilia = () => DEGRAUS.length * (SUBIDA + PATAMAR + (RESFRIAR > 0 ? 5 + RESFRIAR : 0)) + 10
const alvoDeMargem = () => PICO * MARGEM
const degrauDeMargem = () => DEGRAUS.filter((d) => d >= alvoDeMargem()).sort((a, b) => a - b)[0] ?? null

// -----------------------------------------------------------------------------
//  guardas
// -----------------------------------------------------------------------------
function guarda() {
  if (!BASE || !ANON) throw new Recusa('Faltou BASE_HOSPEDADO e ANON_HOSPEDADO (URL e chave anon do staging HOSPEDADO).')
  const g = conferirAlvo(BASE)
  for (const item of String(process.env.CARGA_BLOQUEAR || '').split(/[\s,;]+/).filter(Boolean)) {
    const n = normalizar(item)
    const igual = n && ((n.origin && n.origin === g.alvo.origin) || (n.host && n.host === g.alvo.host) || (n.ref && n.ref === g.alvo.ref))
    if (igual) throw new Recusa('RECUSADO: o alvo está em CARGA_BLOQUEAR (projeto com dado real). Carga só no staging hospedado.')
  }
  return g
}
// o k6 recebe a lista pronta (hosts e refs), e repete a checagem no init
const listaProducao = (g) => [...new Set(g.bloqueios.flatMap((b) => [b.host, b.ref]).filter(Boolean))].join(',') || 'nenhuma-producao-conhecida.invalid'

// Contas e tokens são credenciais: dentro do repositório, só se o .gitignore cobrir o caminho.
function foraDoGit(caminho, oque) {
  const rel = relative(RAIZ, resolve(caminho))
  if (rel.startsWith('..') || isAbsolute(rel)) return
  try { execFileSync('git', ['check-ignore', '-q', rel], { cwd: RAIZ, stdio: 'ignore' }); return } catch { /* não ignorado */ }
  throw new Recusa(`RECUSADO: ${oque} (${rel}) está dentro do repositório e o .gitignore não o cobre. Guarde fora (padrão: ${dirname(USERS_PADRAO)}).`)
}

function lerTokens() {
  if (!existsSync(USERS)) return null
  const lista = JSON.parse(readFileSync(USERS, 'utf8'))
  if (!Array.isArray(lista) || !lista.length) throw new Recusa(`${USERS}: esperado um array de { token, clube }`)
  return lista
}
function conferirTokens(g, lista, segundos) {
  const agora = Math.floor(Date.now() / 1000)
  const subs = new Set(); const clubes = new Set(); let expira = Infinity; let deOutro = 0
  for (const u of lista) {
    const p = JSON.parse(Buffer.from(String(u.token).split('.')[1] || '', 'base64url').toString() || '{}')
    subs.add(p.sub); clubes.add(u.clube); expira = Math.min(expira, Number(p.exp) || 0)
    if (!g.local && normalizar(p.iss || '')?.host !== g.alvo.host) deOutro++
  }
  const problemas = []
  if (deOutro) problemas.push(`${deOutro} token(s) de outro projeto`)
  if (expira - agora < segundos + 60) problemas.push(`o primeiro token expira em ${Math.max(0, expira - agora)} s e a próxima família leva ${segundos} s — rode "tokens" de novo`)
  return { tokens: lista.length, contas: subs.size, clubes: clubes.size, expira_em_s: expira - agora, problemas,
    aviso: clubes.size < 2 ? 'o plano pede 2 a 3 clubes (o isolamento por aba custa diferente com mais de um)' : '' }
}

// -----------------------------------------------------------------------------
//  plano
// -----------------------------------------------------------------------------
function plano() {
  const g = guarda()
  const d = duracaoFamilia()
  console.log(`\n== Plano de carga hospedada — ${g.alvo.origin}${g.local ? '  (LOCAL: só para provar a ferramenta)' : ''}`)
  console.log(`   guarda: ${g.bloqueios.length} endereço(s) de produção conhecido(s) — alvo não é nenhum deles`)
  console.log(`   degraus: ${DEGRAUS.join(' → ')} usuários · subida ${SUBIDA} s · patamar ${PATAMAR} s · resfriamento ${RESFRIAR} s`)
  console.log(`   por família: ${Math.round(d / 60)} min · pausa entre famílias ${PAUSA} s`)
  console.log(`   SLO por degrau (só o patamar): falha ≤ ${SLO.falha}% · p95 ≤ ${SLO.p95} ms · p99 ≤ ${SLO.p99} ms`)
  console.log(`   parada: falha > 5% · p95 > 3 s · p99 > 8 s (acumulado, depois de 20 s)`)
  const m = degrauDeMargem()
  console.log(`   margem confortável: pico esperado ${PICO} × ${MARGEM} = ${alvoDeMargem()} → o degrau ${m ?? '(NENHUM: aumente DEGRAUS)'} tem de passar o SLO em todas as famílias`)
  const lista = lerTokens()
  if (!lista) console.log(`   tokens: ainda não gerados (${USERS}) — rode "tokens <contas.json>"`)
  else {
    const t = conferirTokens(g, lista, d)
    console.log(`   tokens: ${t.tokens} (contas ${t.contas}, clubes ${t.clubes}), o primeiro expira em ${Math.round(t.expira_em_s / 60)} min`)
    for (const p of t.problemas) console.log(`   PROBLEMA: ${p}`)
    if (t.aviso) console.log(`   aviso: ${t.aviso}`)
  }
  return m ? 0 : 1
}

// -----------------------------------------------------------------------------
//  tokens — login de verdade das contas sintéticas, no ritmo do limite por IP
// -----------------------------------------------------------------------------
const esperar = (ms) => new Promise((r) => setTimeout(r, ms))
async function tokens(arquivo) {
  const g = guarda()
  if (!arquivo || !existsSync(arquivo)) throw new Recusa('Uso: tokens <contas.json>  (array de { email, senha, clube }, contas SINTÉTICAS do staging hospedado)')
  foraDoGit(arquivo, 'o arquivo de contas'); foraDoGit(USERS, 'o arquivo de tokens')
  const contas = JSON.parse(readFileSync(arquivo, 'utf8'))
  // O limite de cadastro+login por IP (sign_in_sign_ups) vale para este computador também: um login
  // a cada 11 s fica abaixo de 30 por 5 min. O ritmo é o preço de não mexer no Auth para testar.
  const intervalo = Number(args['intervalo-s'] || 11) * 1000
  const saida = []; const lat = []; let n429 = 0; let falhas = 0
  console.log(`\n== Login de ${contas.length} conta(s) em ${g.alvo.origin}, uma a cada ${intervalo / 1000} s (≈ ${Math.ceil(contas.length * intervalo / 60000)} min)`)
  for (let i = 0; i < contas.length; i++) {
    const c = contas[i]
    for (let tentativa = 0; tentativa < 2; tentativa++) {
      const t0 = performance.now()
      let r
      try {
        r = await fetch(`${BASE}/auth/v1/token?grant_type=password`, {
          method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: c.email, password: c.senha }), signal: AbortSignal.timeout(15000),
        })
      } catch { falhas++; break }
      lat.push(performance.now() - t0)
      if (r.status === 429) { n429++; if (tentativa === 0) { await esperar(60000); continue } falhas++; break }
      if (!r.ok) { falhas++; break }
      const j = await r.json()
      saida.push({ token: j.access_token, clube: c.clube })
      break
    }
    process.stdout.write(`\r   ${i + 1}/${contas.length}  ok ${saida.length}  429 ${n429}  falha ${falhas}   `)
    if (i < contas.length - 1) await esperar(intervalo)
  }
  mkdirSync(dirname(USERS), { recursive: true })
  writeFileSync(USERS, JSON.stringify(saida), { mode: 0o600 })
  const ord = [...lat].sort((a, b) => a - b); const pct = (q) => (ord.length ? Math.round(ord[Math.min(ord.length - 1, Math.floor(q * ord.length))]) : null)
  const resumo = { quando: new Date().toISOString(), alvo: g.alvo.host, contas: contas.length, ok: saida.length, respostas_429: n429, falhas,
    login_ms: { p50: pct(0.5), p95: pct(0.95), max: ord.length ? Math.round(ord[ord.length - 1]) : null }, intervalo_s: intervalo / 1000 }
  const dir = join(RAIZ, 'supabase', 'e2e', 'evidencias-fase9_1', 'carga-hospedada', String(args.rotulo || new Date().toISOString().slice(0, 10)))
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'login.json'), `${JSON.stringify(resumo, null, 2)}\n`)
  console.log(`\n   tokens em ${USERS} (fora do git) · login p50 ${resumo.login_ms.p50} ms, p95 ${resumo.login_ms.p95} ms · 429: ${n429}`)
  if (n429) console.log('   429 no ritmo de 1 login a cada 11 s: o limite por IP do projeto está abaixo de 30/5 min — anote no AUTH-HOSPEDADO.')
  return falhas ? 1 : 0
}

// -----------------------------------------------------------------------------
//  rodar
// -----------------------------------------------------------------------------
function lerTabela(texto) {
  const r = {}
  for (const l of texto.split(/\r?\n/)) {
    const m = l.match(/^\s*(\d+)\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|\s*([\d.]+)\s*\|\s*(sim|NÃO)\s*$/)
    if (m) r[m[1]] = { reqs: +m[2], rps: +m[3], p50: +m[4], p95: +m[5], p99: +m[6], falha_pct: +m[7], aguenta: m[8] === 'sim' }
  }
  return r
}

async function rodar(familias) {
  const g = guarda()
  const desconhecidas = familias.filter((f) => ![...LEITURA, ...ESCRITA].includes(f))
  if (desconhecidas.length) throw new Recusa(`família desconhecida: ${desconhecidas.join(', ')}`)
  const escreve = familias.filter((f) => ESCRITA.includes(f))
  if (escreve.length && !args.escrever) {
    throw new Recusa(`RECUSADO: ${escreve.join(', ')} ESCREVE(M) no staging hospedado (mensagens, fotos, arquivos). Rode com --escrever, e limpe depois (CAPACIDADE-HOSPEDADA.md §6).`)
  }
  foraDoGit(USERS, 'o arquivo de tokens')
  const lista = lerTokens()
  if (!lista) throw new Recusa(`sem tokens em ${USERS}: rode "tokens <contas.json>" antes`)
  const rotulo = String(args.rotulo || new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-'))
  const dir = join(RAIZ, 'supabase', 'e2e', 'evidencias-fase9_1', 'carga-hospedada', rotulo)
  mkdirSync(dir, { recursive: true })
  // o container não enxerga o 127.0.0.1 do Windows: para a prova contra o staging local, o k6 usa host.docker.internal
  const baseK6 = g.local ? BASE.replace(/\/\/(127\.0\.0\.1|localhost)/, '//host.docker.internal') : BASE
  const resultados = {}
  for (let i = 0; i < familias.length; i++) {
    const f = familias[i]
    const t = conferirTokens(g, lista, duracaoFamilia())
    if (t.problemas.length) { console.log(`\n   PAROU antes de ${f}: ${t.problemas.join('; ')}`); break }
    console.log(`\n=== família ${f} (${Math.round(duracaoFamilia() / 60)} min) ===`)
    const env = { BASE: baseK6, ANON, FAMILIA: f, ALVO: 'hospedado', PRODUCAO_BLOQUEADA: listaProducao(g), USERS: '/tokens/usuarios.json',
      DEGRAUS: DEGRAUS.join(','), SUBIDA_S: SUBIDA, PATAMAR_S: PATAMAR, RESFRIAR_S: RESFRIAR,
      SLO_FALHA_PCT: SLO.falha, SLO_P95_MS: SLO.p95, SLO_P99_MS: SLO.p99, PULAR: process.env.PULAR || '',
      RESULTADO: `/carga/resultado-hospedado-${f}.json` }   // coberto pelo .gitignore (resultado-*.json) e sem apagar o da rodada local
    const r = spawnSync('docker', ['run', '--rm', '-v', `${AQUI}:/carga`, '-v', `${dirname(USERS)}:/tokens:ro`, '-w', '/carga',
      ...Object.entries(env).flatMap(([k, v]) => ['-e', `${k}=${v}`]), 'grafana/k6', 'run', '--no-color', '--quiet', '/carga/k6-rampa-fase9.js'],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    const texto = `${r.stdout || ''}${r.stderr || ''}`
    writeFileSync(join(dir, `${f}-k6.txt`), texto)
    const bloco = texto.slice(texto.indexOf('família:'))
    console.log(texto.includes('família:') ? bloco.trim() : texto.split(/\r?\n/).filter((l) => /error|RECUS/i.test(l)).slice(0, 5).join('\n'))
    resultados[f] = lerTabela(texto)
    if (i < familias.length - 1) { console.log(`   (pausa de ${PAUSA} s entre famílias)`); await esperar(PAUSA * 1000) }
  }
  // veredito de margem: o degrau ≥ pico × margem passou o SLO em TODAS as famílias rodadas?
  const alvo = degrauDeMargem()
  const porFamilia = Object.fromEntries(Object.entries(resultados).map(([f, t]) => [f, alvo && t[alvo] ? t[alvo].aguenta : false]))
  const todas = familias.every((f) => porFamilia[f] === true)
  const veredito = { quando: new Date().toISOString(), alvo: g.alvo.host, local: g.local, pico_esperado: PICO, margem: MARGEM,
    degrau_de_margem: alvo, slo: SLO, familias, aguenta_no_degrau_de_margem: porFamilia,
    margem_confortavel: g.local ? 'NAO-SE-APLICA (alvo local: prova da ferramenta, não do projeto)' : todas ? 'SIM' : 'NAO', resultados }
  writeFileSync(join(dir, 'veredito.json'), `${JSON.stringify(veredito, null, 2)}\n`)
  console.log(`\nMARGEM CONFORTÁVEL: ${veredito.margem_confortavel}  (degrau ${alvo} = pico ${PICO} × ${MARGEM}; evidência em ${relative(RAIZ, dir)})`)
  return g.local || todas ? 0 : 1
}

// -----------------------------------------------------------------------------
try {
  let codigo
  if (comando === 'plano') codigo = plano()
  else if (comando === 'tokens') codigo = await tokens(args._[1])
  else if (comando === 'rodar') codigo = await rodar(args._.slice(1).length ? args._.slice(1) : ['piloto', 'rajada'])
  else throw new Recusa(`comando desconhecido: ${comando} (plano | tokens | rodar)`)
  process.exit(codigo)
} catch (e) {
  if (e instanceof Recusa) { console.error(e.message); process.exit(3) }
  throw e
}
