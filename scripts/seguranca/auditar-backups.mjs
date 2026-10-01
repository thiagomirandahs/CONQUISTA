#!/usr/bin/env node
// AUDITORIA DE BACKUPS LOCAIS (somente leitura). Para cada pasta informa: arquivos, tamanho, data, e a PRESENÇA (sim/não, com contagens) de:
//   imagens com GPS / com outros metadados (JPEG/PNG/WebP) · HEIC e vídeos (não analisáveis como limpos: podem ter GPS) · JWT service_role/anon legacy ·
//   tabela auth.users (hashes de senha) em dump · token sbp_ / sb_secret_ / senha em URL de banco em texto.
// NUNCA imprime coordenadas, JWT, senha, token, hash nem caminhos. Uso:  node scripts/seguranca/auditar-backups.mjs <pasta> [<pasta> ...]
import { readdirSync, statSync, readFileSync, openSync, readSync, closeSync } from 'node:fs'
import { join, basename } from 'node:path'
import { spawnSync } from 'node:child_process'
import { classificar } from '../lib/analisarImagem.mjs'

const pastas = process.argv.slice(2)
if (!pastas.length) { console.error('uso: auditar-backups.mjs <pasta> [...]'); process.exit(2) }
const arquivos = (d) => { let es; try { es = readdirSync(d, { withFileTypes: true }) } catch { return [] } return es.flatMap((e) => (e.isDirectory() ? arquivos(join(d, e.name)) : [join(d, e.name)])) }
const mb = (n) => (n / 1048576).toFixed(0)
const JWT = /eyJ[A-Za-z0-9_-]{15,}\.([A-Za-z0-9_-]{15,})\.[A-Za-z0-9_-]{15,}/g

for (const d of pastas) {
  const fs_ = arquivos(d); if (!fs_.length) { console.log(`${basename(d)}: (vazia/inexistente)`); continue }
  let bytes = 0, mt = 0; const r = { gps: 0, meta: 0, limpas: 0, heic: 0, video: 0, imgs_invalidas: 0, jwt: {}, authUsers: 0, sbp: 0, sbsecret: 0, urlSenha: 0, dumps: 0 }
  for (const f of fs_) {
    const st = statSync(f); bytes += st.size; mt = Math.max(mt, st.mtimeMs)
    const nome = f.toLowerCase()
    if (/\.(jpe?g|png|webp|heic|heif|mp4|mov|m4v|webm|gif)$/.test(nome)) {
      if (/\.(mp4|mov|m4v|webm)$/.test(nome)) { r.video++; continue }
      if (st.size > 60 * 1048576) continue
      const b = readFileSync(f); const c = classificar(b)
      if (c.formato === 'heic') r.heic++; else if (c.formato === 'video') r.video++
      else if (c.situacao === 'com_gps') r.gps++; else if (c.situacao === 'com_metadados') r.meta++; else if (c.situacao === 'limpo') r.limpas++; else if (c.situacao === 'invalido') r.imgs_invalidas++
      continue
    }
    if (st.size > 400 * 1048576) continue
    const txt = readFileSync(f, 'latin1')
    for (const m of txt.matchAll(JWT)) { try { const p = JSON.parse(Buffer.from(m[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString()); if (p.iss === 'supabase-demo') continue; r.jwt[p.role || '?'] = (r.jwt[p.role || '?'] || 0) + 1 } catch { /* */ } }
    if (/sbp_[A-Za-z0-9]{30,}/.test(txt)) r.sbp++
    if (/sb_secret_[A-Za-z0-9_-]{15,}/.test(txt)) r.sbsecret++
    if (/postgres(ql)?:\/\/[^:/\s]+:[^@\s<>*]{6,}@[a-z0-9.-]+\.supabase\.(com|co)/i.test(txt)) r.urlSenha++
    if (/\.(dump|backup)$/.test(nome)) {
      r.dumps++
      const lst = spawnSync('pg_restore', ['--list', f], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
      if (/TABLE DATA auth users /.test(lst.stdout || '')) r.authUsers++
    } else if (/auth\.users/.test(txt) && /encrypted_password/.test(txt)) r.authUsers++
  }
  const sec = Object.keys(r.jwt).length ? JSON.stringify(r.jwt) : 'NAO'
  console.log([basename(d).padEnd(40), new Date(mt).toISOString().slice(0, 10), `${mb(bytes)} MB`.padStart(8), `${fs_.length} arq`,
    `imagens: GPS=${r.gps} metadados=${r.meta} limpas=${r.limpas}`, `HEIC=${r.heic} video=${r.video}`, `JWT=${sec}`, `auth.users(hashes)=${r.authUsers ? 'SIM' : 'NAO'}`,
    `token_sbp=${r.sbp ? 'SIM' : 'NAO'} url_com_senha=${r.urlSenha ? 'SIM' : 'NAO'}`].join(' | '))
}
