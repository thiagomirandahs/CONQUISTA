// Teste CONTROLADO da recuperação de senha em PRODUÇÃO, depois que o SMTP próprio estiver gravado.
// Usa uma conta SUA (existente e que você controla): defina TESTE_EMAIL_CONTA no arquivo de ambiente (~/.desbravaclube-prod.env).
// Só pede o e-mail de recuperação (nada é alterado na conta até VOCÊ abrir o link e trocar a senha). Não imprime tokens.
//   node scripts/auth/testar-recuperacao-producao.mjs
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

const RAIZ = resolve(import.meta.dirname, '..', '..')
const linhas = readFileSync(join(homedir(), '.desbravaclube-prod.env'), 'utf8').replace(/^FEFF/, '').split(/\r?\n/)
const env = Object.fromEntries(linhas.map((l) => l.replace(/^export\s+/, '')).filter((l) => /^[A-Z_0-9]+=/.test(l))
  .map((l) => [l.split('=')[0], l.slice(l.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '')]))
const email = env.TESTE_EMAIL_CONTA
if (!email) { console.error('Defina TESTE_EMAIL_CONTA (uma conta SUA já existente) no arquivo de ambiente.'); process.exit(2) }
const REF = readFileSync(join(RAIZ, 'supabase', '.temp', 'project-ref'), 'utf8').trim()
const resp = await fetch(`https://api.supabase.com/v1/projects/${REF}/api-keys`, { headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}` } })
const keys = await resp.json()
const anon = (Array.isArray(keys) ? keys : []).find((k) => k.name === 'anon')?.api_key
if (!anon) { console.error('Não consegui obter a chave pública (anon).'); process.exit(2) }
const destino = encodeURIComponent('https://app.desbravaclube.com.br/nova-senha')
const r = await fetch(`https://${REF}.supabase.co/auth/v1/recover?redirect_to=${destino}`, {
  method: 'POST', headers: { apikey: anon, 'content-type': 'application/json' }, body: JSON.stringify({ email }),
})
console.log(`pedido de recuperação: http ${r.status} (${r.ok ? 'aceito' : 'RECUSADO'}) — o corpo não é impresso`)
console.log(`
AGORA, NA SUA CAIXA DE ENTRADA (${email.replace(/(.).+(@.+)/, '$1***$2')}), confira:
 [ ] chegou em poucos minutos (veja também spam)?            Se não: SMTP/DNS (SPF/DKIM) ainda não estão certos.
 [ ] remetente = "DesbravaClube <...@desbravaclube.com.br>"?
 [ ] texto em português e botão "Criar nova senha"?
 [ ] o botão leva a https://<projeto>.supabase.co/auth/v1/verify... e redireciona para https://app.desbravaclube.com.br/nova-senha ?
 [ ] NÃO existe localhost/127.0.0.1 em nenhum ponto?
 [ ] abrir o link: aparece a tela de nova senha e a troca funciona?
 [ ] abrir o MESMO link de novo: NÃO funciona (uso único)?
 [ ] (opcional) esperar o prazo (mailer_otp_exp = 3600 s) e tentar: expirado?`)
