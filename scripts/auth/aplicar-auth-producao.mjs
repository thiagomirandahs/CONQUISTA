// Aplica (com cuidado) a configuração de E-MAIL do Supabase Auth de PRODUÇÃO: templates em português, assuntos, SMTP próprio e, por último,
// a confirmação de e-mail. NÃO RODA SOZINHO: o padrão é DRY-RUN (só mostra o que mudaria, sem segredos). Nada é gravado sem a flag explícita.
//
//   node scripts/auth/aplicar-auth-producao.mjs                          # dry-run: situação atual + o que mudaria
//   node scripts/auth/aplicar-auth-producao.mjs --aplicar-templates      # só templates + assuntos (pt-BR)
//   node scripts/auth/aplicar-auth-producao.mjs --aplicar-smtp           # SMTP próprio (variáveis SMTP_* do arquivo de ambiente)
//   node scripts/auth/aplicar-auth-producao.mjs --ativar-confirmacao     # mailer_autoconfirm=false — SÓ se o SMTP próprio já estiver gravado
//
// Credenciais: lidas de ~/.desbravaclube-prod.env (nunca impressas): SUPABASE_ACCESS_TOKEN e, para --aplicar-smtp,
//   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_ADMIN_EMAIL (remetente), SMTP_SENDER_NAME (opcional; padrão "DesbravaClube").
// Antes de qualquer gravação salva um instantâneo da configuração ATUAL (sem campos secretos) em ~/.desbravaclube-backups/.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

const RAIZ = resolve(import.meta.dirname, '..', '..')
const args = new Set(process.argv.slice(2))
const linhas = readFileSync(join(homedir(), '.desbravaclube-prod.env'), 'utf8').replace(/^FEFF/, '').split(/\r?\n/)
const env = Object.fromEntries(linhas.map((l) => l.replace(/^export\s+/, '')).filter((l) => /^[A-Z_0-9]+=/.test(l))
  .map((l) => [l.split('=')[0], l.slice(l.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '')]))
const TOKEN = env.SUPABASE_ACCESS_TOKEN
const REF = readFileSync(join(RAIZ, 'supabase', '.temp', 'project-ref'), 'utf8').trim()
if (!TOKEN) { console.error('SUPABASE_ACCESS_TOKEN ausente no arquivo de ambiente.'); process.exit(2) }
const API = `https://api.supabase.com/v1/projects/${REF}/config/auth`
const h = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }
const SEGREDO = /(pass|secret|key|token|jwt|hook)/i
const atual = await (await fetch(API, { headers: h })).json()
if (!atual || typeof atual.site_url !== 'string') { console.error('Resposta inesperada do Supabase.'); process.exit(2) }

const T = join(RAIZ, 'supabase', 'auth-templates')
const ler = (n) => readFileSync(join(T, n), 'utf8')
const planejado = {
  mailer_templates_confirmation_content: ler('confirmacao.html'),
  mailer_templates_recovery_content: ler('recuperacao.html'),
  mailer_templates_email_change_content: ler('troca-email.html'),
  mailer_templates_invite_content: ler('convite.html'),
  mailer_templates_password_changed_notification_content: ler('senha-alterada.html'),
  ...JSON.parse(ler('assuntos.json')),
}
const smtp = () => {
  const falta = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'SMTP_ADMIN_EMAIL'].filter((k) => !env[k])
  if (falta.length) return { falta }
  return { patch: { smtp_host: env.SMTP_HOST, smtp_port: String(env.SMTP_PORT), smtp_user: env.SMTP_USER, smtp_pass: env.SMTP_PASS, smtp_admin_email: env.SMTP_ADMIN_EMAIL, smtp_sender_name: env.SMTP_SENDER_NAME || 'DesbravaClube' } }
}

console.log('== SITUAÇÃO ATUAL (sem segredos) ==')
console.log('site_url                =', atual.site_url)
console.log('uri_allow_list          =', atual.uri_allow_list)
console.log('mailer_autoconfirm      =', atual.mailer_autoconfirm, '(true = SEM confirmação de e-mail)')
console.log('smtp_host / admin_email =', atual.smtp_host || '(não configurado)', '/', atual.smtp_admin_email || '(nenhum)')
console.log('rate_limit_email_sent   =', atual.rate_limit_email_sent)
for (const k of Object.keys(planejado)) {
  const igual = atual[k] === planejado[k]
  console.log(`${k.padEnd(60)} ${igual ? 'já está igual' : 'MUDARIA (hoje: ' + String(atual[k]).replace(/\s+/g, ' ').slice(0, 40) + '…)'}`)
}
const s = smtp()
console.log('SMTP (variáveis do arquivo de ambiente):', s.falta ? `FALTAM ${s.falta.join(', ')}` : 'completas (valores NÃO impressos)')

async function gravar(patch, rotulo) {
  const dir = join(homedir(), '.desbravaclube-backups')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const snap = Object.fromEntries(Object.entries(atual).filter(([k]) => !SEGREDO.test(k)))
  const arq = join(dir, `auth-config-antes-${rotulo}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
  writeFileSync(arq, JSON.stringify(snap, null, 2))
  console.log(`instantâneo (sem segredos) salvo em ${arq}`)
  const r = await fetch(API, { method: 'PATCH', headers: h, body: JSON.stringify(patch) })
  console.log(`PATCH ${rotulo}: http ${r.status}`)
  if (!r.ok) process.exit(1)
  const depois = await (await fetch(API, { headers: h })).json()
  const mudou = Object.keys(patch).filter((k) => !SEGREDO.test(k) && depois[k] !== atual[k])
  console.log('campos conferidos depois (sem segredos):', mudou.join(', ') || '(nenhum diferente)')
}
if (args.has('--aplicar-templates')) await gravar(planejado, 'templates')
if (args.has('--aplicar-smtp')) {
  if (s.falta) { console.error('Recusado: faltam variáveis SMTP_*.'); process.exit(3) }
  await gravar(s.patch, 'smtp')
}
if (args.has('--ativar-confirmacao')) {
  const agora = await (await fetch(API, { headers: h })).json()
  if (!agora.smtp_host || !agora.smtp_admin_email) {
    console.error('Recusado: SMTP próprio não está configurado. Configure e teste o SMTP ANTES de ligar a confirmação de e-mail.')
    process.exit(3)
  }
  await gravar({ mailer_autoconfirm: false }, 'confirmacao')
}
if (![...args].some((a) => a.startsWith('--aplicar') || a === '--ativar-confirmacao')) console.log('\n(dry-run: nada foi gravado)')
