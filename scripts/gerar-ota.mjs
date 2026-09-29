// =============================================================================
//  Pacote de telas do APK (OTA auto-hospedado). Ver android/OTA.md.
//
//  Roda DEPOIS do `vite build` normal (o do site/PWA, que vai para dist/):
//    1. monta as telas no modo APK (CAP_BUILD=1: sem service worker, sem legado) em .ota-build/;
//    2. compacta em dist/ota/bundle-<versao>.zip;
//    3. escreve dist/ota/versao.json = { versao, url, sha256, minimoNativo }.
//  A Vercel serve os dois em https://app.desbravaclube.com.br/ota/… (sem cache: ver vercel.json).
//
//  Uso: npm run build:ota          (a Vercel roda isso no deploy: buildCommand do vercel.json)
//  Variáveis opcionais: OTA_URL_BASE (padrão https://app.desbravaclube.com.br/ota), OTA_VERSAO.
// =============================================================================
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync, existsSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { zipSync } from 'fflate'
import { versaoOta } from './versaoOta.mjs'

const RAIZ = process.cwd()
const TEMP = '.ota-build' // relativo: o caminho do projeto no Windows tem espaço
const DIST_OTA = join(RAIZ, 'dist', 'ota')
const BASE = (process.env.OTA_URL_BASE || 'https://app.desbravaclube.com.br/ota').replace(/\/+$/, '')
const pkg = JSON.parse(readFileSync(join(RAIZ, 'package.json'), 'utf8'))
const minimoNativo = pkg.desbravaclube?.otaMinimoNativo
if (!minimoNativo) throw new Error('[ota] package.json sem desbravaclube.otaMinimoNativo')

const versao = versaoOta()
if (!/^[\w.-]+$/.test(versao)) throw new Error(`[ota] versão inválida: ${versao}`)

// 1. build no modo APK (mesma versão embutida via OTA_VERSAO)
rmSync(join(RAIZ, TEMP), { recursive: true, force: true })
execFileSync(process.execPath, [join(RAIZ, 'node_modules', 'vite', 'bin', 'vite.js'), 'build', '--outDir', TEMP, '--emptyOutDir'], {
  stdio: 'inherit',
  env: { ...process.env, CAP_BUILD: '1', OTA_VERSAO: versao },
})

// 2. zip (index.html na raiz do zip, como o plugin exige)
function listar(dir) {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n)
    return statSync(p).isDirectory() ? listar(p) : [p]
  })
}
const origem = join(RAIZ, TEMP)
if (!existsSync(join(origem, 'index.html'))) throw new Error('[ota] build sem index.html')
const arquivos = {}
for (const p of listar(origem)) {
  const rel = relative(origem, p).split(sep).join('/')
  if (rel.startsWith('ota/')) continue
  arquivos[rel] = [readFileSync(p), { mtime: new Date('2020-01-01T00:00:00Z') }]
}
const zip = zipSync(arquivos, { level: 9 })
const sha256 = createHash('sha256').update(zip).digest('hex')

// 3. publicar em dist/ota
rmSync(DIST_OTA, { recursive: true, force: true })
mkdirSync(DIST_OTA, { recursive: true })
const nomeZip = `bundle-${versao}.zip`
writeFileSync(join(DIST_OTA, nomeZip), zip)
const manifesto = { versao, url: `${BASE}/${nomeZip}`, sha256, minimoNativo }
writeFileSync(join(DIST_OTA, 'versao.json'), JSON.stringify(manifesto, null, 2) + '\n')
rmSync(origem, { recursive: true, force: true })
console.log(`[ota] ${nomeZip} (${(zip.length / 1024).toFixed(0)} KB) sha256=${sha256.slice(0, 12)}… minimoNativo=${minimoNativo}`)
