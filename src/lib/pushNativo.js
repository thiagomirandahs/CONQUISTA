// Push NATIVO (Android via Capacitor + FCM). Só roda dentro do app; no web/
// iPhone é no-op (o import do plugin só acontece quando é nativo). Guarda o
// token do aparelho na tabela push_tokens; o servidor (edge function enviar-push)
// manda o aviso pra esses tokens quando entra uma notificação.
import { ehNativo } from './nativo.js'
import { supabase } from './supabase.js'

let _uid = null
let _listenersOn = false

export async function registrarPushNativo(userId) {
  if (!ehNativo() || !userId) return
  _uid = userId
  try {
    const { PushNotifications } = await import('@capacitor/push-notifications')

    // Android 13+ pede permissão de notificação; <13 já vem concedida.
    let perm = await PushNotifications.checkPermissions()
    if (perm.receive === 'prompt' || perm.receive === 'prompt-with-rationale') {
      perm = await PushNotifications.requestPermissions()
    }
    if (perm.receive !== 'granted') return

    if (!_listenersOn) {
      _listenersOn = true
      // Chega o token do FCM → guarda no banco (token é a chave; se já existir,
      // atualiza de quem é o aparelho).
      PushNotifications.addListener('registration', async (token) => {
        if (!_uid || !token?.value) return
        try {
          await supabase.from('push_tokens').upsert(
            { user_id: _uid, token: token.value, plataforma: 'android' },
            { onConflict: 'token' },
          )
        } catch { /* tabela ainda não criada / sem rede — tenta de novo no próximo abrir */ }
      })
      PushNotifications.addListener('registrationError', () => { /* ignora */ })
    }

    await PushNotifications.register()
  } catch { /* rodando no web ou sem google-services.json: sem push nativo */ }
}
