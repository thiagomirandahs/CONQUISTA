// Edge Function: enviar-push
// Acionada por um Database Webhook quando entra uma linha em "notificacoes".
// Envia a notificação como PUSH para os aparelhos inscritos em push_subscriptions.
//
// SEGURANÇA: como o "Verify JWT" fica desligado (quem chama é o webhook do
// banco, não um usuário), a função tem a PRÓPRIA fechadura: o webhook precisa
// mandar o header `x-push-webhook-secret` com o valor do secret
// PUSH_WEBHOOK_SECRET. Sem ele (ou errado), respondemos 401 e NÃO tocamos no
// banco. O payload também é validado e o `link` só pode ser caminho interno.
//
// Secrets necessários (painel Supabase → Edge Functions → Secrets):
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, PUSH_WEBHOOK_SECRET
// (SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY já são injetados automaticamente.)

import webpush from 'npm:web-push@3.6.7'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const VAPID_PUBLIC = Deno.env.get('VAPID_PUBLIC_KEY') ?? ''
const VAPID_PRIVATE = Deno.env.get('VAPID_PRIVATE_KEY') ?? ''
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const WEBHOOK_SECRET = Deno.env.get('PUSH_WEBHOOK_SECRET') ?? ''

webpush.setVapidDetails('mailto:contato@filhosdaconquista.app', VAPID_PUBLIC, VAPID_PRIVATE)
const sb = createClient(SUPABASE_URL, SERVICE_ROLE)

// Comparação em tempo constante via digest SHA-256 (32 bytes fixos): não vaza
// nem o conteúdo nem o TAMANHO do segredo pelo tempo de resposta.
async function igualSeguro(a: string, b: string): Promise<boolean> {
  if (!b) return false // secret não cadastrado = falha fechada
  const enc = new TextEncoder()
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(a)),
    crypto.subtle.digest('SHA-256', enc.encode(b)),
  ])
  const va = new Uint8Array(ha), vb = new Uint8Array(hb)
  let dif = 0
  for (let i = 0; i < 32; i++) dif |= va[i] ^ vb[i]
  return dif === 0
}

// O link do push só pode ser um caminho INTERNO do app ("/alguma-coisa").
// Nunca http(s)://, javascript:, data: nem //dominio — se vier qualquer coisa
// estranha, cai no "/" (abre o app na tela inicial, sem risco).
function linkSeguro(l: unknown): string {
  if (typeof l !== 'string') return '/'
  const s = l.trim()
  if (!s.startsWith('/') || s.startsWith('//')) return '/'
  // bloqueia caracteres de controle, espaços, backslash e DEL (enganam parsers
  // de URL) — checagem por código de caractere, sem regex
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (c <= 32 || c === 92 || c === 127) return '/'
  }
  return s.slice(0, 200)
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

Deno.serve(async (req) => {
  // 1) FECHADURA: sem o segredo do webhook, nada acontece (falha fechada:
  //    se o secret nem foi cadastrado, também recusa tudo).
  const segredo = req.headers.get('x-push-webhook-secret') ?? ''
  if (!(await igualSeguro(segredo, WEBHOOK_SECRET))) {
    return new Response('não autorizado', { status: 401 })
  }

  try {
    const body = await req.json().catch(() => ({}))
    const notif = body.record ?? body // o webhook envia { type, table, record, ... }

    // 2) VALIDAÇÃO do payload (aceita só notificação com cara de notificação).
    //    Respondemos 200 nos inválidos pra o webhook não ficar re-tentando.
    const titulo = typeof notif?.titulo === 'string' ? notif.titulo.trim().slice(0, 120) : ''
    if (!titulo) return new Response('ok (sem notificacao valida)', { status: 200 })
    const corpo = typeof notif?.corpo === 'string' ? notif.corpo.slice(0, 500) : ''
    const paraUsuario = typeof notif?.para_usuario === 'string' && UUID_RE.test(notif.para_usuario)
      ? notif.para_usuario : null
    // 'pessoal' sem destinatário válido NÃO pode virar broadcast (vazaria um
    // recado direcionado pra todo mundo) — ignora.
    if (notif?.para === 'pessoal' && !paraUsuario) {
      return new Response('ok (pessoal sem destinatario valido)', { status: 200 })
    }

    // 3) Define quem recebe: pessoal (só 1 usuário) -> 'lideranca' -> todos
    let subs: any[] = []
    if (paraUsuario) {
      const { data } = await sb.from('push_subscriptions').select('*').eq('user_id', paraUsuario)
      subs = data ?? []
    } else if (notif.para === 'lideranca') {
      const { data: lideres } = await sb
        .from('profiles').select('id')
        .in('papel', ['instrutor', 'diretoria']).eq('status', 'ativo')
      const ids = (lideres ?? []).map((l: any) => l.id)
      if (ids.length) {
        const { data } = await sb.from('push_subscriptions').select('*').in('user_id', ids)
        subs = data ?? []
      }
    } else {
      const { data } = await sb.from('push_subscriptions').select('*')
      subs = data ?? []
    }

    const payload = JSON.stringify({
      titulo,
      corpo,
      link: linkSeguro(notif.link),
    })

    let enviados = 0
    await Promise.all(
      subs.map(async (s) => {
        try {
          await webpush.sendNotification(
            { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
            payload,
          )
          enviados++
        } catch (e: any) {
          // Inscrição expirada/cancelada -> remove do banco
          if (e?.statusCode === 404 || e?.statusCode === 410) {
            await sb.from('push_subscriptions').delete().eq('endpoint', s.endpoint)
          }
        }
      }),
    )

    return new Response(JSON.stringify({ enviados }), {
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (e: any) {
    return new Response('erro: ' + (e?.message ?? e), { status: 500 })
  }
})
