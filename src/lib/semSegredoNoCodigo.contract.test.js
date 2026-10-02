// @vitest-environment node
// CONTRATO: nenhum segredo literal em arquivo VERSIONADO (Git é para sempre; uma chave que entra no histórico tem de ser rotacionada).
//
// Escopo (só arquivos rastreados pelo Git): supabase/functions, scripts, src, .github, supabase/config.toml, vercel.json, package.json
// e também supabase/tests e supabase/e2e (onde moram as chaves DEMO do Supabase local).
//
// REGRAS (cada uma com o motivo; o relatório de falha mostra caminho, linha e regra — NUNCA o valor do segredo):
//   jwt          qualquer JWT literal (eyJ….eyJ….assinatura) é falha, EXCETO a chave DEMO do Supabase local: payload com
//                iss='supabase-demo' + exp=1983812996 + role anon|service_role, e SÓ nos caminhos de teste/staging local
//                (EXCECOES_DEMO). Um JWT com role service_role sem ser a DEMO é falha sempre. Payload ilegível = falha.
//   sb_secret    `sb_secret_` seguido de 16+ caracteres de chave (o prefixo sozinho, em código/comentário/regex, não conta).
//   sbp          token pessoal da Management API: `sbp_` + 20+ hex/alfanuméricos.
//   service_role como VALOR de chave: `apikey: 'service_role'`, `SUPABASE_SERVICE_ROLE_KEY = '…literal…'` etc. NÃO conta como achado:
//                a palavra como role de SQL (grant … to service_role), em comentário, ou como NOME na busca da chave
//                (`k.name === 'service_role'`), pois aí ela é um rótulo, não a credencial.
//   bearer       `Authorization: Bearer <literal de 16+ caracteres>` fixo no código (template com ${…} e placeholders curtos não contam).
//   querystring  segredo em URL: `?apikey=<literal>`, `&token=<literal>`, `&secret=…`, `&key=…` com valor literal de 20+ caracteres.
//   dburl        URL de banco com senha literal: `postgres://usuario:SENHA@host`. Passam só placeholders (usuario:senha, x:y, ${VAR},
//                <senha>, ***) e a senha padrão do banco LOCAL (`postgres`) em host local (localhost/127.0.0.1/supabase_db_*/db).
//
// EXCEÇÕES (lista fechada, cada uma com motivo, e testada abaixo para não virar porta aberta):
//   * EXCECOES_DEMO   caminhos onde a chave DEMO pública do Supabase local pode aparecer (testes/E2E/staging locais).
//   * EXCECOES_LITERAIS  literais exatos plantados DE PROPÓSITO (controle negativo de um detector).
import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '../..')

const ESCOPO = ['supabase/functions', 'scripts', 'src', '.github', 'supabase/config.toml', 'vercel.json', 'package.json', 'supabase/tests', 'supabase/e2e', 'index.html', 'vite.config.js', 'vite-plugin-csp.js', 'capacitor.config.json']
const EXTENSOES = /\.(js|jsx|mjs|cjs|ts|tsx|json|toml|ya?ml|sh|sql|html|md|env|example)$/i

// A chave DEMO do Supabase local é pública (vem no código-fonte do Supabase CLI) e só abre o banco de DESENVOLVIMENTO local.
const DEMO_EXP = 1983812996
const EXCECOES_DEMO = [
  { pasta: 'supabase/tests/', motivo: 'E2E/SQL contra o Supabase LOCAL (chave demo do CLI)' },
  { pasta: 'supabase/e2e/', motivo: 'E2E multi-clube contra o Supabase LOCAL' },
  { arquivo: 'scripts/staging.mjs', motivo: 'staging LOCAL em Docker (chave demo do CLI como padrão)' },
]
const EXCECOES_LITERAIS = [
  { caminho: 'supabase/tests/136_sem_segredo_em_definicoes.sql', contem: 'assinatura_falsa_para_teste', motivo: 'controle negativo: segredo plantado de propósito para provar que o detector SQL acha' },
]

const ARQUIVO_DO_DETECTOR = 'src/lib/semSegredoNoCodigo.contract.test.js'
const REGRAS_DURAS = ['jwt', 'sb_secret', 'sbp']

const b64uJson = (s) => { try { return JSON.parse(Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')) } catch { return null } }
// NENHUM caractere do valor entra no relatório (nem o começo): só o tamanho. A regra já diz o tipo do segredo.
const mascara = (s) => `‹${s.length} car.›`

const RE_JWT = /eyJ[A-Za-z0-9_-]{6,}\.eyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}/g
const RE_SB_SECRET = /sb_secret_[A-Za-z0-9_-]{16,}/g
const RE_SBP = /\bsbp_[A-Za-z0-9]{20,}/g
const RE_SERVICE_ROLE_VALOR = /(?:apikey|api_key|SERVICE_ROLE_KEY|service_role_key|serviceRoleKey)['"`]?\s*[:=]\s*['"`]service_role['"`]/gi
const RE_SERVICE_ROLE_LITERAL = /(?:SERVICE_ROLE_KEY|service_role_key|serviceRoleKey)['"`]?\s*[:=]\s*['"`]([A-Za-z0-9._~+/=-]{24,})['"`]/g
const RE_BEARER = /[Aa]uthorization['"`]?\s*[:=,]\s*['"`]Bearer\s+([A-Za-z0-9._~+/-]{16,}=*)['"`]/g
const RE_QUERY = /https?:\/\/[^\s'"`]*[?&](?:apikey|api_key|access_token|token|secret|key|password)=([A-Za-z0-9._~%-]{20,})/gi
const RE_DBURL = /postgres(?:ql)?:\/\/([^:@/\s'"`]+):([^@\s'"`]+)@([^/\s'"`:?]+)/gi
const HOST_LOCAL = /^(localhost|127\.0\.0\.1|\[::1\]|host\.docker\.internal|db|supabase_db_[A-Za-z0-9_-]+)$/i
const SENHA_PLACEHOLDER = /^(senha|password|usuario|user|x|y|postgres|test|\*+|x{3,}|\$\{?[A-Za-z_][A-Za-z0-9_]*\}?|<[^>]*>|\[[^\]]*\]|\{[^}]*\}|%s|%[A-Za-z]|\$[A-Za-z_]+|SENHA|SUA_SENHA|YOUR-PASSWORD)$/i

/** Varre um texto e devolve os achados (sem nunca incluir o valor completo do segredo). */
export function varrer(texto, caminho) {
  const out = []
  const linhaDe = (idx) => texto.slice(0, idx).split('\n').length
  const colunaDe = (idx) => idx - (texto.lastIndexOf('\n', idx - 1) + 1) + 1
  // `vao` = tamanho do casamento inteiro a partir de idx (o valor pode ser só um grupo dele): é o que o diagnóstico apaga da linha
  const add = (regra, idx, valor, vao = valor.length) => out.push({ regra, caminho, linha: linhaDe(idx), coluna: colunaDe(idx), tamanho: valor.length, vao, trecho: mascara(valor) })
  const literalPermitido = (valor) => EXCECOES_LITERAIS.some((e) => e.caminho === caminho && valor.endsWith(e.contem))

  for (const m of texto.matchAll(RE_JWT)) {
    if (literalPermitido(m[0])) continue
    const payload = b64uJson(m[0].split('.')[1])
    const ehDemo = !!payload && payload.iss === 'supabase-demo' && payload.exp === DEMO_EXP && ['anon', 'service_role'].includes(payload.role)
    const lugarPermitido = EXCECOES_DEMO.some((e) => (e.arquivo ? caminho === e.arquivo : caminho.startsWith(e.pasta)))
    if (ehDemo && lugarPermitido) continue
    add(payload ? (payload.role === 'service_role' ? 'jwt:service_role' : 'jwt') : 'jwt:payload-ilegivel', m.index, m[0])
  }
  for (const m of texto.matchAll(RE_SB_SECRET)) add('sb_secret', m.index, m[0])
  for (const m of texto.matchAll(RE_SBP)) add('sbp', m.index, m[0])
  for (const m of texto.matchAll(RE_SERVICE_ROLE_VALOR)) add('service_role-como-valor', m.index, m[0])
  for (const m of texto.matchAll(RE_SERVICE_ROLE_LITERAL)) add('service_role-literal', m.index, m[1], m[0].length)
  for (const m of texto.matchAll(RE_BEARER)) { if (!literalPermitido(m[1])) add('bearer', m.index, m[1], m[0].length) }
  for (const m of texto.matchAll(RE_QUERY)) add('querystring', m.index, m[1], m[0].length)
  for (const m of texto.matchAll(RE_DBURL)) {
    const [, , senha, host] = m
    const placeholder = SENHA_PLACEHOLDER.test(senha) && (senha.toLowerCase() !== 'postgres' || HOST_LOCAL.test(host))
    if (!placeholder) add('dburl', m.index, senha, m[0].length)
  }
  return out
}

// ---------------------------------------------------------------- DIAGNÓSTICO (só quando a varredura FALHA)
// Em 01/10/2026 este teste falhou UMA vez e a saída foi perdida (NÃO EXPLICADO; não reproduziu em 60+ execuções). Para a próxima
// falha não se perder, o teste grava um arquivo em node_modules/.cache/sem-segredo-diagnostico/ (fora do Git) com: quando, PID,
// worker do Vitest, diretório, HEAD, e por achado: arquivo, linha/coluna, regra, tamanho do casamento, sha256/tamanho/mtime do
// arquivo lido, se o conteúdo difere do HEAD, se o achado PERSISTE numa releitura 150 ms depois (arquivo sendo escrito?) e a
// linha com TODO trecho longo trocado por ‹n› — o valor encontrado NUNCA é gravado nem impresso.
const PASTA_DIAGNOSTICO = join(RAIZ, 'node_modules', '.cache', 'sem-segredo-diagnostico')
const sha256 = (b) => createHash('sha256').update(b).digest('hex')
const dormir = (ms) => { try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms) } catch { /* sem espera */ } }
const git = (...args) => { try { return execFileSync('git', args, { cwd: RAIZ, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim() } catch (e) { return `erro:${e?.status ?? e?.code ?? '?'}` } }

/** Linha do achado sem nenhum valor: primeiro apaga o casamento inteiro (coluna + vão); depois todo trecho de 8+ caracteres
 *  "de chave" que sobrar vira ‹n›; corta em 240. */
export function contextoSemValor(texto, { linha, coluna, vao }) {
  let l = (texto.split('\n')[linha - 1] ?? '').replace(/\r$/, '')
  if (coluna && vao) l = l.slice(0, coluna - 1) + `‹${vao}›` + l.slice(coluna - 1 + vao)
  return l.replace(/[A-Za-z0-9._~+/=%_-]{8,}/g, (m) => `‹${m.length}›`).slice(0, 240)
}

/** Monta o registro de diagnóstico (objeto serializável, sem valores). `ler` devolve o Buffer do arquivo (injetável no teste). */
export function montarDiagnostico(achados, { ler, extra = {} } = {}) {
  const porArquivo = new Map()
  for (const a of achados) { if (!porArquivo.has(a.caminho)) porArquivo.set(a.caminho, []); porArquivo.get(a.caminho).push(a) }
  const arquivos = []
  for (const [caminho, lista] of porArquivo) {
    let buf = null, erroLeitura = null
    try { buf = ler(caminho) } catch (e) { erroLeitura = String(e?.code ?? e?.name ?? 'erro') }
    const texto = buf ? buf.toString('utf8') : ''
    arquivos.push({
      caminho, erroLeitura, bytes: buf?.length ?? null, sha256: buf ? sha256(buf) : null,
      temCRLF: /\r\n/.test(texto), temBOM: texto.charCodeAt(0) === 0xfeff,
      achados: lista.map((a) => ({ regra: a.regra, linha: a.linha, coluna: a.coluna, tamanho: a.tamanho, contexto: contextoSemValor(texto, a) })),
    })
  }
  return { quando: new Date().toISOString(), pid: process.pid, ppid: process.ppid, node: process.version, plataforma: process.platform,
    worker: process.env.VITEST_WORKER_ID ?? null, pool: process.env.VITEST_POOL_ID ?? null, cwd: process.cwd(), totalAchados: achados.length, ...extra, arquivos }
}

function gravarDiagnostico(achados, arquivosLidos, ilegiveis) {
  const ler = (c) => readFileSync(join(RAIZ, c))
  const d = montarDiagnostico(achados, { ler, extra: { raiz: RAIZ, head: git('rev-parse', 'HEAD'), ramo: git('rev-parse', '--abbrev-ref', 'HEAD'), arquivosVarridos: arquivosLidos, ilegiveis } })
  for (const a of d.arquivos) {
    let mtime = null; try { mtime = statSync(join(RAIZ, a.caminho)).mtime.toISOString() } catch { /* sumiu */ }
    a.mtime = mtime
    a.statusGit = git('status', '--porcelain', '--', a.caminho) || 'limpo'
    a.sha256NoHead = (() => { try { return sha256(execFileSync('git', ['show', `HEAD:${a.caminho}`], { cwd: RAIZ, maxBuffer: 64 * 1024 * 1024 })) } catch { return null } })()
  }
  // releitura: o achado continua lá 150 ms depois? (arquivo pela metade, escrita concorrente, antivírus, checkout em andamento)
  dormir(150)
  for (const a of d.arquivos) {
    try {
      const b = readFileSync(join(RAIZ, a.caminho)); const de = varrer(b.toString('utf8'), a.caminho)
      a.releitura = { sha256: sha256(b), mudou: sha256(b) !== a.sha256, achados: de.length, regras: [...new Set(de.map((x) => x.regra))] }
    } catch (e) { a.releitura = { erro: String(e?.code ?? 'erro') } }
  }
  let destino = null
  try {
    mkdirSync(PASTA_DIAGNOSTICO, { recursive: true })
    destino = join(PASTA_DIAGNOSTICO, `${d.quando.replace(/[:.]/g, '-')}-pid${process.pid}.json`)
    writeFileSync(destino, JSON.stringify(d, null, 2))
  } catch (e) { destino = `(não gravou: ${e?.code ?? 'erro'})` }
  // stdout e stderr também recebem o resumo (sem valores), para sobrar em qualquer log que capture só um dos dois
  const resumo = `[sem-segredo] FALHA ${d.quando} pid=${d.pid} worker=${d.worker} achados=${d.totalAchados} diagnostico=${destino}`
  console.error(resumo); console.log(resumo)
  for (const a of d.arquivos) for (const x of a.achados) console.error(`[sem-segredo] ${a.caminho}:${x.linha}:${x.coluna} [${x.regra}] ‹${x.tamanho} car.› sha256=${a.sha256?.slice(0, 16)} status=${a.statusGit} persiste=${a.releitura?.achados ?? '?'} :: ${x.contexto}`)
  return destino
}

const PRAZO_VARREDURA_MS = 120_000
const LIMIAR_LENTO_MS = 2_000
/** Varredura lenta não é falha, mas é o sinal que antecede o estouro de prazo: fica registrada (só tempos, nenhum conteúdo). */
function registrarLentidao(tempos) {
  if (tempos.listarMs + tempos.lerEVarrerMs < LIMIAR_LENTO_MS) return
  const reg = { quando: new Date().toISOString(), pid: process.pid, worker: process.env.VITEST_WORKER_ID ?? null, cwd: process.cwd(), raiz: RAIZ, ...tempos }
  try {
    mkdirSync(PASTA_DIAGNOSTICO, { recursive: true })
    writeFileSync(join(PASTA_DIAGNOSTICO, `lento-${reg.quando.replace(/[:.]/g, '-')}-pid${process.pid}.json`), JSON.stringify(reg, null, 2))
  } catch { /* diagnóstico nunca derruba o teste */ }
  console.warn(`[sem-segredo] varredura LENTA: listar=${tempos.listarMs} ms, ler+varrer=${tempos.lerEVarrerMs} ms, ${tempos.arquivos} arquivos (disco frio/antivírus?)`)
}

function arquivosDoEscopo() {
  const lista = execFileSync('git', ['ls-files', '-z', '--', ...ESCOPO], { cwd: RAIZ, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).split('\0').filter(Boolean)
  return lista.filter((f) => EXTENSOES.test(f) || /(^|\/)(Dockerfile|\.env[^/]*)$/.test(f))
}

describe('varredura contra segredo no código versionado', () => {
  // PRAZO: esta varredura LÊ ~900 arquivos. Com o disco "frio" (checkout/merge recém-feito, primeira leitura do dia, antivírus
  // conferindo cada arquivo na 1ª abertura) ela leva 6–7 s em vez de ~0,1 s e estourava o prazo padrão de 5 s do Vitest — a falha
  // intermitente de 01/10/2026 (reproduzida em 02/10 num worktree recém-criado: "Test timed out in 5000ms"). O prazo maior não
  // afrouxa nada: a asserção é a mesma. Varredura lenta (> 2 s) deixa registro em PASTA_DIAGNOSTICO (lento-*.json).
  it('nenhum arquivo versionado do escopo contém segredo literal (relatório sem o valor)', { timeout: PRAZO_VARREDURA_MS }, () => {
    const achados = [], ilegiveis = []
    const t0 = performance.now()
    const arquivos = arquivosDoEscopo()
    const tListou = performance.now()
    expect(arquivos.length).toBeGreaterThan(200)   // a varredura realmente leu o repositório
    for (const f of arquivos) {
      let texto
      try { texto = readFileSync(join(RAIZ, f), 'utf8') } catch (e) { ilegiveis.push(`${f}:${e?.code ?? 'erro'}`); continue }
      let a = varrer(texto, f)
      // ESTE arquivo guarda, como fixture do detector, exemplos de service_role/Bearer/URL/query montados em texto: só as regras DURAS
      // (jwt, sb_secret, sbp) valem para ele — e valem de verdade (nada de chave real aqui).
      if (f === ARQUIVO_DO_DETECTOR) a = a.filter((x) => REGRAS_DURAS.includes(x.regra.split(':')[0]))
      achados.push(...a)
    }
    registrarLentidao({ listarMs: Math.round(tListou - t0), lerEVarrerMs: Math.round(performance.now() - tListou), arquivos: arquivos.length })
    const relatorio = achados.map((a) => `${a.caminho}:${a.linha} [${a.regra}] ${a.trecho}`)
    const diagnostico = achados.length ? gravarDiagnostico(achados, arquivos.length, ilegiveis) : null
    expect(relatorio, diagnostico ? `diagnóstico (sem valores) gravado em ${diagnostico}` : undefined).toEqual([])
  })

  it('o escopo cobre os diretórios que importam (functions, scripts, src, workflows, config.toml, vercel.json, package.json)', { timeout: PRAZO_VARREDURA_MS }, () => {
    const f = arquivosDoEscopo()
    for (const p of ['supabase/functions/_compartilhado/chaves.ts', 'scripts/lib/hospedado.mjs', 'src/lib/supabase.js', 'supabase/config.toml', 'vercel.json', 'package.json']) expect(f).toContain(p)
    expect(f.some((x) => x.startsWith('.github/workflows/'))).toBe(true)
  })
})

// ---------------------------------------------------------------- o detector em si (entradas montadas em tempo de execução: este arquivo também é varrido)
const b64u = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
const jwt = (payload) => `${b64u({ alg: 'HS256', typ: 'JWT' })}.${b64u(payload)}.${'a'.repeat(20)}`
const DEMO = { iss: 'supabase-demo', role: 'anon', exp: DEMO_EXP }

describe('o detector acha o que deve (controles negativos) e não acusa o que não deve', () => {
  it('JWT comum/service_role fora da exceção é achado; o achado não carrega o valor inteiro', () => {
    const j = jwt({ role: 'service_role', iss: 'supabase', ref: 'abcdefghijklmnopqrst' })
    const r = varrer(`const k = '${j}'`, 'scripts/x.mjs')
    expect(r.map((a) => a.regra)).toEqual(['jwt:service_role'])
    expect(JSON.stringify(r)).not.toContain(j)
    expect(varrer(`'${jwt({ role: 'authenticated', sub: 'x' })}'`, 'src/a.js')[0].regra).toBe('jwt')
    expect(varrer(`'${'eyJ' + 'hbGciOi'}.${'eyJ' + 'zZXJ2aWNl'}.xxxxxxxx'`, 'src/a.js')[0].regra).toBe('jwt:payload-ilegivel')
  })

  it('o relatório e o DIAGNÓSTICO nunca carregam o valor achado (nem um pedaço): só regra, posição, tamanho e hash do arquivo', () => {
    const sec = 'sb_' + 'secret_' + 'A1b2C3d4E5f6G7h8I9j0K1'
    const j = jwt({ role: 'service_role', iss: 'supabase', ref: 'abcdefghijklmnopqrst' })
    const senha = 'S3nh4' + 'Real9xyz'
    const texto = `// cabecalho\r\nconst a = '${sec}'\r\n  const b = "${j}" // fim\r\nconst u = 'postgresql://postgres:${senha}@db.abcdefg.supabase.co:5432/postgres'\r\n`
    const achados = varrer(texto, 'scripts/x.mjs')
    expect(achados.map((a) => a.regra).sort()).toEqual(['dburl', 'jwt:service_role', 'sb_secret'])
    expect(achados.find((a) => a.regra === 'sb_secret')).toMatchObject({ linha: 2, coluna: 12, tamanho: sec.length, trecho: `‹${sec.length} car.›` })
    const d = montarDiagnostico(achados, { ler: () => Buffer.from(texto, 'utf8') })
    const s = JSON.stringify(d) + JSON.stringify(achados)
    expect(s).not.toContain(sec)
    // (o nome da regra 'sb_secret' é público; o que não pode aparecer é a parte SECRETA da chave)
    for (const valor of [sec.slice('sb_secret_'.length), j, senha]) {
      expect(s).not.toContain(valor)
      for (let i = 0; i + 8 <= valor.length; i++) expect(s, 'pedaço do valor no diagnóstico').not.toContain(valor.slice(i, i + 8))
    }
    expect(d.arquivos).toHaveLength(1)
    expect(d.arquivos[0]).toMatchObject({ caminho: 'scripts/x.mjs', bytes: Buffer.byteLength(texto), temCRLF: true, temBOM: false })
    expect(d.arquivos[0].sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(d.arquivos[0].achados.find((x) => x.regra === 'sb_secret').contexto).toBe(`const a = '‹${sec.length}›'`)
    expect(d).toMatchObject({ pid: process.pid, totalAchados: 3 })
    expect(d.quando).toMatch(/^\d{4}-\d\d-\d\dT/)
    // arquivo que some entre a varredura e o diagnóstico não derruba o diagnóstico
    const sumiu = montarDiagnostico(achados, { ler: () => { const e = new Error('x'); e.code = 'ENOENT'; throw e } })
    expect(sumiu.arquivos[0]).toMatchObject({ erroLeitura: 'ENOENT', sha256: null })
  })

  it('a chave DEMO só passa nos caminhos de teste/staging locais, com iss, exp e role exatos', () => {
    const demoAnon = jwt(DEMO), demoServ = jwt({ ...DEMO, role: 'service_role' })
    expect(varrer(`'${demoAnon}'`, 'supabase/tests/e2e/x.mjs')).toEqual([])
    expect(varrer(`'${demoServ}'`, 'supabase/e2e/montar.mjs')).toEqual([])
    expect(varrer(`'${demoAnon}'`, 'scripts/staging.mjs')).toEqual([])
    // a MESMA chave demo fora desses caminhos NÃO passa (a exceção é por lugar)
    expect(varrer(`'${demoAnon}'`, 'supabase/functions/x/index.ts').length).toBe(1)
    expect(varrer(`'${demoServ}'`, 'src/lib/x.js').length).toBe(1)
    expect(varrer(`'${demoAnon}'`, 'scripts/outro.mjs').length).toBe(1)
    // e um arquivo parecido com o permitido (prefixo errado) também não
    expect(varrer(`'${demoAnon}'`, 'scripts/staging.mjs.bak').length).toBe(1)
    expect(varrer(`'${demoAnon}'`, 'supabase/testsx/a.mjs').length).toBe(1)
  })

  it('a exceção NÃO vira porta aberta: iss demo com outro exp, com ref de projeto, ou role diferente continua falhando', () => {
    for (const p of [{ ...DEMO, exp: DEMO_EXP + 1 }, { ...DEMO, exp: undefined }, { ...DEMO, role: 'authenticated' }, { ...DEMO, role: 'supabase_admin' }, { iss: 'supabase', role: 'anon', exp: DEMO_EXP }, { ...DEMO, ref: 'abcdefghijklmnopqrst', iss: 'supabase' }]) {
      expect(varrer(`'${jwt(p)}'`, 'supabase/tests/e2e/x.mjs').length).toBe(1)
    }
    // service_role com iss demo MAS exp errado = produção disfarçada: falha mesmo em supabase/tests
    expect(varrer(`'${jwt({ iss: 'supabase-demo', role: 'service_role', exp: 2000000000 })}'`, 'supabase/tests/x.mjs')[0].regra).toBe('jwt:service_role')
  })

  it('a exceção do literal plantado vale só para aquele arquivo e aquele literal', () => {
    const plantado = `Bearer ${b64u({ alg: 'HS256' })}.${b64u({ role: 'service_role' })}.assinatura_falsa_para_teste`
    expect(varrer(plantado, 'supabase/tests/136_sem_segredo_em_definicoes.sql')).toEqual([])
    expect(varrer(plantado, 'supabase/tests/137_outro.sql').length).toBeGreaterThan(0)
    expect(varrer(plantado.replace('assinatura_falsa_para_teste', 'assinatura_real_aaaaaaaa'), 'supabase/tests/136_sem_segredo_em_definicoes.sql').length).toBeGreaterThan(0)
  })

  it('sb_secret_ e sbp_ literais são achados; o prefixo sozinho (código, regex, comentário) não', () => {
    const sec = 'sb_' + 'secret_' + 'A1b2C3d4E5f6G7h8I9j0K1'
    expect(varrer(`const k = '${sec}'`, 'scripts/a.mjs')[0].regra).toBe('sb_secret')
    expect(varrer(`const k = 'sbp_${'0123456789abcdef'.repeat(2)}'`, 'scripts/a.mjs')[0].regra).toBe('sbp')
    expect(varrer(`if (k.startsWith('sb_' + 'secret_')) {}  // chave sb_secret_… (nova)`, 'scripts/a.mjs')).toEqual([])
    expect(varrer('const re = /^sb_secret_/', 'scripts/a.mjs')).toEqual([])
    expect(varrer("const PREFIXO = 'sb_secret_'", 'supabase/functions/_compartilhado/chaves.ts')).toEqual([])
  })

  it('service_role como VALOR de chave é achado; como role de SQL, comentário ou nome na busca da chave não é', () => {
    expect(varrer("headers: { apikey: 'service_role' }", 'scripts/a.mjs')[0].regra).toBe('service_role-como-valor')
    expect(varrer("const SUPABASE_SERVICE_ROLE_KEY = 'service_role'", 'scripts/a.mjs')[0].regra).toBe('service_role-como-valor')
    expect(varrer(`const SERVICE_ROLE_KEY = '${'x'.repeat(40)}'`, 'scripts/a.mjs')[0].regra).toBe('service_role-literal')
    expect(varrer('grant execute on function f() to service_role;', 'scripts/a.sql')).toEqual([])
    expect(varrer("const k = chaves.find((x) => x.name === 'service_role')?.api_key", 'scripts/a.mjs')).toEqual([])
    expect(varrer('// só o service_role executa', 'supabase/functions/a.ts')).toEqual([])
    expect(varrer("const SERVICE_ROLE = chaveServico().valor", 'supabase/functions/a.ts')).toEqual([])
    expect(varrer("const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY", 'scripts/a.mjs')).toEqual([])
  })

  it('Bearer literal fixo é achado; template, variável e placeholder curto não', () => {
    expect(varrer(`headers: { Authorization: 'Bearer ${'Ab1'.repeat(10)}' }`, 'src/a.js')[0].regra).toBe('bearer')
    expect(varrer('headers: { Authorization: `Bearer ${token}` }', 'src/a.js')).toEqual([])
    expect(varrer("headers: { authorization: 'Bearer lixo' }", 'src/a.js')).toEqual([])
    expect(varrer("Authorization: 'Bearer ' + token", 'src/a.js')).toEqual([])
  })

  it('segredo em query string de URL é achado; valor por variável não', () => {
    expect(varrer(`fetch('https://x.supabase.co/rest/v1/a?apikey=${'Zz9'.repeat(10)}')`, 'scripts/a.mjs')[0].regra).toBe('querystring')
    expect(varrer('fetch(`https://x.supabase.co/rest/v1/a?apikey=${chave}`)', 'scripts/a.mjs')).toEqual([])
    expect(varrer("const u = 'https://x.com/a?token=abc'", 'scripts/a.mjs')).toEqual([])
  })

  it('URL de banco com senha literal é achado; placeholder e a senha padrão do banco LOCAL não', () => {
    expect(varrer('postgresql://postgres:' + 'S3nh4Real9' + '@db.abcdefg.supabase.co:5432/postgres', 'scripts/a.mjs')[0].regra).toBe('dburl')
    expect(varrer('postgresql://usuario:senha@host:5432/postgres', 'scripts/a.mjs')).toEqual([])
    expect(varrer('postgresql://USUARIO:SENHA@HOST:5432/postgres', 'scripts/a.mjs')).toEqual([])
    expect(varrer('postgresql://x:y@localhost:1/z', 'src/a.js')).toEqual([])
    expect(varrer('postgresql://postgres:postgres@127.0.0.1:54322/postgres', 'scripts/a.mjs')).toEqual([])
    expect(varrer('postgresql://supabase_storage_admin:postgres@supabase_db_CONQUISTA:5432/postgres', 'x.sh')).toEqual([])
    expect(varrer('postgres://u:${SENHA}@h/db', 'scripts/a.sh')).toEqual([])
    // a senha "postgres" num host que NÃO é local é achado
    expect(varrer('postgresql://postgres:postgres@db.abcdefg.supabase.co:5432/postgres', 'scripts/a.mjs')[0].regra).toBe('dburl')
  })
})
