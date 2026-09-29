// Push NATIVO (Android via Capacitor + FCM). Só roda dentro do app; no web/
// iPhone é no-op (o import do plugin só acontece quando é nativo). Guarda o
// token do aparelho na tabela push_tokens; o servidor (edge function enviar-push)
// manda o aviso pra esses tokens quando entra uma notificação.
// 29/09: o registro falhava em SILÊNCIO (Android 13+ sem POST_NOTIFICATIONS no manifesto) e o sino
// dizia "não disponível". Agora há estado e ativação explícitos, com o motivo escrito (ver Notificacoes).
import { ehNativo } from './nativo.js'
import { supabase } from './supabase.js'
import { rpcInexistente } from '../services/config.js'

let _uid = null
let _token = null
let _listenersOn = false
let _aguardando = null // { resolve } do registro em andamento

export const MSG_NEGADO = 'O Android bloqueou os avisos do DesbravaClube. Abra Configurações do celular › Apps › DesbravaClube › Notificações e ative.'

async function salvarToken(valor) {
  const { error } = await supabase.rpc('push_token_registrar', { p_token: valor, p_plataforma: 'android' })
  if (error && rpcInexistente(error)) {
    const r = await supabase.from('push_tokens').upsert({ user_id: _uid, token: valor, plataforma: 'android' }, { onConflict: 'token' })
    if (r.error) throw new Error(r.error.message)
  } else if (error) throw new Error(error.message)
}

// Pede a permissão (se `pedir`), registra no FCM e grava o token. Resolve com { ok, motivo }.
async function registrar(userId, pedir) {
  if (!ehNativo() || !userId) return { ok: false, motivo: 'indisponivel' }
  _uid = userId
  try {
    const { PushNotifications } = await import('@capacitor/push-notifications')
    let perm = await PushNotifications.checkPermissions()
    if (pedir && (perm.receive === 'prompt' || perm.receive === 'prompt-with-rationale')) {
      perm = await PushNotifications.requestPermissions()
    }
    if (perm.receive !== 'granted') return { ok: false, motivo: perm.receive === 'denied' ? 'negado' : 'desligado' }

    if (!_listenersOn) {
      _listenersOn = true
      // Chega o token do FCM → guarda no banco (token é a chave; se já existir, reatribui o aparelho).
      PushNotifications.addListener('registration', async (token) => {
        if (!_uid || !token?.value) return
        _token = token.value
        try { await salvarToken(token.value); _aguardando?.resolve({ ok: true }) }
        catch (e) { _aguardando?.resolve({ ok: false, motivo: 'erro', detalhe: e?.message }) }
        _aguardando = null
      })
      PushNotifications.addListener('registrationError', (e) => {
        _aguardando?.resolve({ ok: false, motivo: 'erro', detalhe: e?.error || 'registro no Firebase falhou' })
        _aguardando = null
      })
    }
    const resultado = new Promise((resolve) => { _aguardando = { resolve } })
    await PushNotifications.register()
    return await Promise.race([resultado, new Promise((r) => setTimeout(() => r({ ok: false, motivo: 'erro', detalhe: 'sem resposta do Firebase (internet?)' }), 15000))])
  } catch (e) { return { ok: false, motivo: 'erro', detalhe: e?.message || String(e) } }
}

// No login (Auth): tenta sem incomodar — só pede a permissão se o Android ainda não perguntou.
export async function registrarPushNativo(userId) { return registrar(userId, true) }

// Botão "Ativar avisos no celular" do sino (APK).
export async function ativarPushNativo(userId) { return registrar(userId, true) }

// Estado para o sino: 'ativo' | 'negado' | 'desligado' | 'indisponivel'.
export async function estadoPushNativo() {
  if (!ehNativo()) return 'indisponivel'
  try {
    const { PushNotifications } = await import('@capacitor/push-notifications')
    const p = await PushNotifications.checkPermissions()
    if (p.receive === 'granted') return _token ? 'ativo' : 'desligado'
    return p.receive === 'denied' ? 'negado' : 'desligado'
  } catch { return 'indisponivel' }
}

// Ao SAIR: o aparelho (APK) deixa de receber os avisos de quem saiu; o próximo login registra de novo.
export async function desassociarPushNativo() {
  if (!ehNativo() || !_token) return
  try { await supabase.from('push_tokens').delete().eq('token', _token) } catch { /* sem rede: o próximo login reatribui */ }
}
