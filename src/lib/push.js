import { supabase } from './supabase.js'

// Chave pública VAPID (não é segredo). Vem do .env: VITE_VAPID_PUBLIC_KEY
const VAPID_PUBLIC = import.meta.env.VITE_VAPID_PUBLIC_KEY

function base64UrlParaUint8(base64) {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(b64)
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)))
}

export function pushSuportado() {
  return typeof navigator !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
}

// Já existe inscrição ativa neste aparelho?
export async function pushAtivo() {
  if (!pushSuportado() || Notification.permission !== 'granted') return false
  const reg = await navigator.serviceWorker.getRegistration()
  const sub = reg && (await reg.pushManager.getSubscription())
  return !!sub
}

// Pede permissão, inscreve o aparelho e salva a inscrição no Supabase.
export async function ativarPush(userId) {
  if (!pushSuportado()) throw new Error('SEM_SUPORTE')
  if (!VAPID_PUBLIC) throw new Error('SEM_VAPID')

  const permissao = await Notification.requestPermission()
  if (permissao !== 'granted') throw new Error('PERMISSAO_NEGADA')

  const reg = await navigator.serviceWorker.ready
  let sub = await reg.pushManager.getSubscription()
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: base64UrlParaUint8(VAPID_PUBLIC),
    })
  }
  const json = sub.toJSON()
  const { error } = await supabase.from('push_subscriptions').upsert(
    { user_id: userId, endpoint: sub.endpoint, p256dh: json.keys.p256dh, auth: json.keys.auth },
    { onConflict: 'endpoint' }
  )
  if (error) throw error
  return true
}

// Cancela a inscrição neste aparelho.
export async function desativarPush() {
  if (!pushSuportado()) return
  const reg = await navigator.serviceWorker.getRegistration()
  const sub = reg && (await reg.pushManager.getSubscription())
  if (sub) {
    await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint)
    await sub.unsubscribe()
  }
}
