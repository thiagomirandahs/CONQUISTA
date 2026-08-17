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

// Já existe inscrição ativa (e com a chave VAPID ATUAL) neste aparelho?
export async function pushAtivo() {
  if (!pushSuportado() || Notification.permission !== 'granted') return false
  const reg = await navigator.serviceWorker.getRegistration()
  const sub = reg && (await reg.pushManager.getSubscription())
  if (!sub) return false
  // Se a inscrição foi feita com uma chave VAPID DIFERENTE da atual (chave trocada),
  // ela não recebe mais push → trata como INATIVA pra o app oferecer "Ativar" e migrar.
  const bruta = sub.options?.applicationServerKey
  if (bruta && VAPID_PUBLIC) {
    const atual = new Uint8Array(bruta)
    const nova = base64UrlParaUint8(VAPID_PUBLIC)
    const mesma = atual.length === nova.length && atual.every((b, i) => b === nova[i])
    if (!mesma) return false
  }
  return true
}

// Pede permissão, inscreve o aparelho e salva a inscrição no Supabase.
export async function ativarPush(userId) {
  if (!pushSuportado()) throw new Error('SEM_SUPORTE')
  if (!VAPID_PUBLIC) throw new Error('SEM_VAPID')

  const permissao = await Notification.requestPermission()
  if (permissao !== 'granted') throw new Error('PERMISSAO_NEGADA')

  const reg = await navigator.serviceWorker.ready
  const chaveNova = base64UrlParaUint8(VAPID_PUBLIC)
  let sub = await reg.pushManager.getSubscription()

  // Se já existe inscrição, mas foi feita com uma chave VAPID DIFERENTE da atual
  // (ex.: as chaves foram trocadas), a inscrição antiga nunca recebe push.
  // Nesse caso: apaga a antiga do banco, cancela no navegador e recria com a chave nova.
  if (sub) {
    const chaveAtual = new Uint8Array(sub.options?.applicationServerKey || [])
    const mesmaChave =
      chaveAtual.length === chaveNova.length &&
      chaveAtual.every((b, i) => b === chaveNova[i])
    if (!mesmaChave) {
      try {
        await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint)
      } catch (_) {
        // se falhar a limpeza, segue mesmo assim — a nova inscrição substitui pelo endpoint
      }
      await sub.unsubscribe()
      sub = null
    }
  }

  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: chaveNova,
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
