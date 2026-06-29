// Edge Function: enviar-push
// Acionada por um Database Webhook quando entra uma linha em "notificacoes".
// Envia a notificação como PUSH para os aparelhos inscritos em push_subscriptions.
//
// Secrets necessários (supabase secrets set ...):
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY
// (SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY já são injetados automaticamente.)

import webpush from 'npm:web-push@3.6.7'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const VAPID_PUBLIC = Deno.env.get('VAPID_PUBLIC_KEY') ?? ''
const VAPID_PRIVATE = Deno.env.get('VAPID_PRIVATE_KEY') ?? ''
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

webpush.setVapidDetails('mailto:contato@filhosdaconquista.app', VAPID_PUBLIC, VAPID_PRIVATE)
const sb = createClient(SUPABASE_URL, SERVICE_ROLE)

Deno.serve(async (req) => {
  try {
    const body = await req.json().catch(() => ({}))
    const notif = body.record ?? body // o webhook envia { type, table, record, ... }
    if (!notif?.titulo) return new Response('ok (sem notificacao)', { status: 200 })

    // Define quem recebe: 'lideranca' -> só instrutor/diretoria; senão -> todos os inscritos
    let subs: any[] = []
    if (notif.para === 'lideranca') {
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
      titulo: notif.titulo,
      corpo: notif.corpo ?? '',
      link: notif.link ?? '/',
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
