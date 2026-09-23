// Gera JWTs HS256 para os usuários sintéticos, assinados com o segredo do Supabase LOCAL.
// Os usuários de carga têm hash de senha inválido de propósito (ninguém loga como eles);
// para medir capacidade precisamos do token, não do fluxo de login — que já tem rate limit próprio
// no GoTrue e não é o que estamos medindo aqui.
import crypto from 'node:crypto'
import fs from 'node:fs'

const SEGREDO = process.env.JWT_SECRET || 'super-secret-jwt-token-with-at-least-32-characters-long'
const N_CLUBES = Number(process.env.CLUBES || 100)
const POR_CLUBE = Number(process.env.POR_CLUBE || 30)

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
const md5 = (s) => crypto.createHash('md5').update(s).digest('hex')
const uuid = (s) => { const h = md5(s); return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}` }

const agora = Math.floor(Date.now() / 1000)
const usuarios = []
for (let c = 1; c <= N_CLUBES; c++) {
  for (let m = 1; m <= POR_CLUBE; m++) {
    const sub = uuid(`carga:user:${c}:${m}`)
    const payload = { aud: 'authenticated', role: 'authenticated', sub, iat: agora, exp: agora + 7200,
                      email: `carga-${c}-${m}@carga.local`, app_metadata: {}, user_metadata: {} }
    const cabecalho = b64({ alg: 'HS256', typ: 'JWT' })
    const corpo = b64(payload)
    const assinatura = crypto.createHmac('sha256', SEGREDO).update(`${cabecalho}.${corpo}`).digest('base64url')
    usuarios.push({ token: `${cabecalho}.${corpo}.${assinatura}`, clube: uuid(`carga:clube:${c}`),
                    papel: m <= 2 ? 'diretoria' : m <= 6 ? 'instrutor' : 'desbravador' })
  }
}
fs.writeFileSync(process.argv[2] || 'supabase/carga/usuarios.json', JSON.stringify(usuarios))
console.log(`${usuarios.length} tokens gerados`)
