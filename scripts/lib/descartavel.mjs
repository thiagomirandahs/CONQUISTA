// O AMBIENTE DESCARTÁVEL — um terceiro stack local (CONQUISTA-RESTORE, portas 56xxx, segredo e chave
// de assinatura próprios, SEM migrations e SEM seed), onde um backup é restaurado inteiro.
//
// Extraído de scripts/restaurar-staging.mjs (fase 9, item 8) para servir também ao ensaio de produção
// (fase 9.1, item 3). As duas regras que custaram caro continuam aqui, num lugar só:
//   · o banco recriado nasce com o DONO original (`postgres`) — sem isso tudo volta e a PRÓXIMA
//     migration falha com "permission denied for schema public" (achado do drill da fase 9);
//   · a conferência prova que uma migration ainda passa depois do restore.
import { execFileSync } from 'node:child_process'
import { createPrivateKey, randomBytes, randomUUID, generateKeyPairSync, sign } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { join, basename } from 'node:path'

const RAIZ = process.cwd()
const CLI = ['--yes', 'supabase@2.117.0']
export const R_DIR = 'restore'
export const R_NOME = 'CONQUISTA-RESTORE'
export const R_API = 'http://127.0.0.1:56321'
export const r = (servico) => `supabase_${servico}_${R_NOME}`

export const docker = (args, opts = {}) => execFileSync('docker', args, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 256 * 1024 * 1024, ...opts })
export const psql = (container, sql, db = 'postgres', usuario = 'supabase_admin') =>
  docker(['exec', '-i', container, 'psql', '-U', usuario, '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-d', db], { input: sql }).trim()
const supabase = (args, env = {}) => execFileSync('npx', [...CLI, ...args], {
  cwd: RAIZ, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], shell: process.platform === 'win32', env: { ...process.env, ...env },
})
export const seg = (ms) => `${(ms / 1000).toFixed(1)}s`
export const espera = (ms) => new Promise((res) => setTimeout(res, ms))

// Sobe o stack descartável, derivado da config do staging (mesma versão de imagens e de auth).
export function provisionar() {
  const base = readFileSync(join('staging', 'supabase', 'config.toml'), 'utf8')
  let cfg = base
    .replace('project_id = "CONQUISTA-STAGING"', `project_id = "${R_NOME}"`)
    .replace(/\b553(\d\d)\b/g, '563$1')
    .replace(/:4273\b/g, ':4373')
    .replace(/port = 8183\b/, 'port = 8283')
  cfg = cfg.replace(/(\[db\.seed\][^[]*?enabled = )true/, '$1false')
  if (cfg.includes('55321') || !cfg.includes('56321')) throw new Error('a config do descartável ainda aponta para o staging')
  rmSync(join(R_DIR, 'supabase', 'migrations'), { recursive: true, force: true })
  mkdirSync(join(R_DIR, 'supabase', 'migrations'), { recursive: true })
  writeFileSync(join(R_DIR, 'supabase', 'config.toml'), `# GERADO — ambiente DESCARTÁVEL de restore. Não versionar.\n${cfg}`)
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
  const jwk = { ...privateKey.export({ format: 'jwk' }), alg: 'ES256', kid: randomUUID(), use: 'sig', key_ops: ['sign', 'verify'], ext: true }
  writeFileSync(join(R_DIR, 'supabase', 'signing_keys.json'), JSON.stringify([jwk]))
  const segredo = randomBytes(30).toString('base64url')
  writeFileSync(join(R_DIR, '.jwt-secret'), segredo)
  supabase(['start', '--workdir', R_DIR, '-x', 'studio,mailpit,edge-runtime,imgproxy,vector,logflare,supavisor,postgres-meta,realtime'],
    { SUPABASE_AUTH_JWT_SECRET: segredo })
  const env = supabase(['status', '--workdir', R_DIR, '-o', 'env'], { SUPABASE_AUTH_JWT_SECRET: segredo })
  const pega = (k) => (env.match(new RegExp(`^${k}="?([^"\n]+)"?`, 'm')) || [])[1] || ''
  return { anon: pega('ANON_KEY'), service: pega('SERVICE_ROLE_KEY'), jwk }
}

export function descartar() {
  if (!existsSync(join(R_DIR, 'supabase', 'config.toml'))) return false
  try { supabase(['stop', '--workdir', R_DIR, '--no-backup']) } catch { /* já parado */ }
  rmSync(R_DIR, { recursive: true, force: true })
  return true
}

export async function esperarApi(anon, api = R_API) {
  for (let i = 0; i < 90; i++) {
    try {
      const a = await fetch(`${api}/auth/v1/health`, { headers: { apikey: anon } })
      const b = await fetch(`${api}/rest/v1/`, { headers: { apikey: anon } })
      const c = await fetch(`${api}/storage/v1/bucket`, { headers: { apikey: anon, Authorization: `Bearer ${anon}` } })
      if (a.ok && b.ok && c.status < 500) return true
    } catch { /* subindo */ }
    await espera(1000)
  }
  return false
}

// O formato do arquivo decide COMO restaurar:
//   · *.dump (pg_dump -Fc)              → pg_restore
//   · *.sql / *.backup (SQL puro)       → psql      (o "Download" de backup do painel do Supabase é
//   · *.gz (qualquer um dos de cima)    → gunzip     um db_cluster-*.backup.gz: SQL puro de pg_dumpall)
export function formatoDe(arquivo) {
  const nome = basename(arquivo).toLowerCase().replace(/\.gz$/, '')
  if (nome.endsWith('.dump')) return 'custom'
  if (nome.endsWith('.sql') || nome.endsWith('.backup')) return 'sql'
  throw new Error(`formato de backup não reconhecido: ${arquivo} (use .dump, .sql, .backup ou .gz)`)
}

// Troca o banco `postgres` do container INTEIRO pelo backup. Devolve as linhas de erro do restore,
// já separadas em benignas (papel/objeto da plataforma que o stack local já tem) e o resto.
export function trocarBanco(container, arquivo) {
  const formato = formatoDe(arquivo)
  const gz = arquivo.toLowerCase().endsWith('.gz')
  psql(container, 'drop database if exists postgres with (force);', 'template1')
  psql(container, 'create database postgres owner postgres;', 'template1')
  const destino = `/tmp/restore-entrada${gz ? '.gz' : ''}`
  docker(['cp', arquivo, `${container}:${destino}`])
  if (gz) docker(['exec', container, 'sh', '-c', `gunzip -f ${destino}`])
  let saida = ''
  try {
    saida = formato === 'custom'
      ? docker(['exec', container, 'pg_restore', '-U', 'supabase_admin', '-d', 'postgres', '/tmp/restore-entrada'])
      : docker(['exec', container, 'psql', '-U', 'supabase_admin', '-d', 'postgres', '-X', '-q', '-f', '/tmp/restore-entrada'])
  } catch (e) { saida = `${e.stdout || ''}${e.stderr || ''}` }
  docker(['exec', container, 'rm', '-f', '/tmp/restore-entrada'])
  const erros = saida.split('\n').filter((l) => /(^pg_restore: error|ERROR:)/.test(l))
  // Um backup do painel traz CREATE ROLE dos papéis da plataforma e objetos que o stack local já cria:
  // "already exists" nesses é esperado. Todo o resto é erro de verdade.
  const benigno = (l) => /already exists/.test(l) && /(role|extension|schema "(auth|storage|extensions|graphql|graphql_public|realtime|_realtime|vault|pgsodium|supabase_functions|cron|net|pgbouncer)")/.test(l)
  return { formato, benignos: erros.filter(benigno), erros: erros.filter((l) => !benigno(l)) }
}

export function restaurarArquivos(container, arquivoTgz) {
  docker(['cp', arquivoTgz, `${container}:/tmp/storage.tgz`])
  docker(['exec', container, 'sh', '-c', 'rm -rf /mnt/* && tar xzf /tmp/storage.tgz -C /mnt && rm -f /tmp/storage.tgz'])
}

// Não basta o banco voltar: o PRÓXIMO deploy tem de continuar possível.
export function conferirQueODeployContinua(container, ok) {
  const dono = psql(container, `select pg_get_userbyid(datdba) from pg_database where datname = 'postgres';`)
  ok('o banco restaurado tem o dono original (postgres)', dono === 'postgres', `dono=${dono}`)
  let criou = true
  try {
    docker(['exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-q', '-v', 'ON_ERROR_STOP=1'],
      { input: `begin; create function public.zz_sonda_do_restore() returns int language sql as 'select 1'; rollback;` })
  } catch { criou = false }
  ok('...e o papel do SQL Editor ainda CRIA no public: a próxima migration passa', criou)
}

// Um JWT ES256 assinado com a chave do descartável: é assim que o ensaio entra como uma pessoa REAL
// da cópia sem conhecer (nem trocar) a senha dela. Só vale no descartável — a chave nasce e morre com ele.
export function tokenPara(jwk, sub, horas = 2) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
  const agora = Math.floor(Date.now() / 1000)
  const cab = b64({ alg: 'ES256', typ: 'JWT', kid: jwk.kid })
  const corpo = b64({ aud: 'authenticated', role: 'authenticated', sub, iat: agora, exp: agora + horas * 3600, app_metadata: {}, user_metadata: {} })
  const assinatura = sign('sha256', Buffer.from(`${cab}.${corpo}`), { key: createPrivateKey({ key: jwk, format: 'jwk' }), dsaEncoding: 'ieee-p1363' }).toString('base64url')
  return `${cab}.${corpo}.${assinatura}`
}
