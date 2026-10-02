// PROVEDOR DE PUSH FALSO para o E2E supabase/tests/e2e/push-erro-permanente.mjs — roda num container edge-runtime LOCAL (TLS, certificado de uma
// CA descartável) com aliases de rede para fcm.googleapis.com / oauth2.googleapis.com / push-fake.test. Nunca contata ninguém: só RESPONDE.
// O cenário vem do 1º segmento do caminho (Web Push: /<cenario>/<id>) ou do início do token (FCM: message.token = "<cenario>-<id>").
//   GET /__hits   -> JSON com cada requisição recebida ({ tipo, cenario, caminho, n })      POST /__reset -> zera
const hits: Array<{ tipo: string; cenario: string; caminho: string; n: number }> = []
const contagem = new Map<string, number>()
const dorme = (ms: number) => new Promise((r) => setTimeout(r, ms))

const resp = (status: number, corpo = '', headers: Record<string, string> = {}) => new Response(corpo, { status, headers })
const json = (status: number, obj: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json', ...headers } })

function registrar(tipo: string, cenario: string, caminho: string) {
  const k = `${tipo}:${caminho}`
  const n = (contagem.get(k) ?? 0) + 1
  contagem.set(k, n)
  hits.push({ tipo, cenario, caminho, n })
}

const fcmErro = (code: number, status: string, errorCode: string | null, mensagem: string, extra: unknown[] = []) => json(code, {
  error: {
    code, message: mensagem, status,
    details: [...(errorCode ? [{ '@type': 'type.googleapis.com/google.firebase.fcm.v1.FcmError', errorCode }] : []), ...extra],
  },
})

Deno.serve(async (req) => {
  const u = new URL(req.url)
  if (u.pathname === '/__hits') return json(200, hits)
  if (u.pathname === '/__reset') { hits.length = 0; contagem.clear(); return resp(200, 'ok') }

  // ---- OAuth do Google (a Edge Function troca o JWT da conta de serviço por um access token)
  if (u.pathname === '/token') {
    const form = new URLSearchParams(await req.text())
    const jwt = form.get('assertion') ?? ''
    let iss = ''
    try { iss = JSON.parse(atob(jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).iss ?? '' } catch { /* sem iss */ }
    registrar('oauth', iss.split('@')[0], '/token')
    if (iss.startsWith('oauth503')) return json(503, { error: 'unavailable' })
    if (iss.startsWith('oauth401')) return json(401, { error: 'invalid_grant' })
    return json(200, { access_token: 'token-falso-e2e', expires_in: 3600, token_type: 'Bearer' })
  }

  // ---- FCM HTTP v1
  if (/^\/v1\/projects\/[^/]+\/messages:send$/.test(u.pathname)) {
    const corpo = await req.json().catch(() => ({}))
    const token: string = corpo?.message?.token ?? ''
    const cen = token.split('-')[0]
    registrar('fcm', cen, token)
    switch (cen) {
      case 'ok': return json(200, { name: 'projects/e2e/messages/1' })
      case 'unreg': return fcmErro(404, 'NOT_FOUND', 'UNREGISTERED', 'Requested entity was not found.')
      case 'notfound': return fcmErro(404, 'NOT_FOUND', null, 'Requested entity was not found.')
      case 'invtoken': return fcmErro(400, 'INVALID_ARGUMENT', 'INVALID_ARGUMENT', 'The registration token is not a valid FCM registration token',
        [{ '@type': 'type.googleapis.com/google.rpc.BadRequest', fieldViolations: [{ field: 'message.token', description: 'Invalid registration token' }] }])
      case 'invpayload': return fcmErro(400, 'INVALID_ARGUMENT', 'INVALID_ARGUMENT', 'Android message is too big',
        [{ '@type': 'type.googleapis.com/google.rpc.BadRequest', fieldViolations: [{ field: 'message.data', description: 'too big' }] }])
      case 'vazio400': return resp(400)
      case 's401': return fcmErro(401, 'UNAUTHENTICATED', 'THIRD_PARTY_AUTH_ERROR', 'Request had invalid authentication credentials.')
      case 's403': return fcmErro(403, 'PERMISSION_DENIED', 'SENDER_ID_MISMATCH', 'SenderId mismatch')
      case 's408': return resp(408)
      case 's429': return fcmErro(429, 'RESOURCE_EXHAUSTED', 'QUOTA_EXCEEDED', 'Quota exceeded', []) && json(429, { error: { code: 429, status: 'RESOURCE_EXHAUSTED' } }, { 'retry-after': '90' })
      case 's500': return fcmErro(500, 'INTERNAL', 'INTERNAL', 'Internal error')
      case 's502': return resp(502, '<html>bad gateway</html>')
      case 's503': return json(503, { error: { code: 503, status: 'UNAVAILABLE' } }, { 'retry-after': '100' })
      case 's504': return resp(504)
      case 's418': return resp(418, 'chaleira')
      case 'vazio': return resp(599)
      case 'lento': await dorme(20_000); return json(200, { name: 'x' })
      default: return resp(500, 'cenario fcm desconhecido')
    }
  }

  // ---- Web Push: POST /<cenario>/<id>
  const partes = u.pathname.split('/').filter(Boolean)
  const cen = partes[0] ?? ''
  await req.arrayBuffer().catch(() => null)
  registrar('web', cen, u.pathname)
  switch (cen) {
    case 'ok': return resp(201)
    case 's404': return resp(404, 'Not Found')
    case 's410': return resp(410, 'push subscription has unsubscribed or expired.')
    case 's400inv': return resp(400, 'InvalidRegistration')
    case 's400gen': return resp(400, 'bad request: invalid TTL header')
    case 's400vazio': return resp(400)
    case 's401': return resp(401, 'unauthorized')
    case 's403': return resp(403, 'the VAPID credentials in the authorization header do not correspond to the credentials used to create the subscriptions')
    case 's408': return resp(408)
    case 's413': return resp(413, 'payload too large')
    case 's429': return resp(429, 'too many requests', { 'retry-after': '120' })
    case 's500': return resp(500, 'oops')
    case 's502': return resp(502)
    case 's503': return resp(503, 'unavailable', { 'retry-after': '100' })
    case 's504': return resp(504)
    case 's418': return resp(418, 'chaleira')
    case 's301': return resp(301, '', { location: 'https://push-fake.test/ok/redirecionado' })
    case 'vazio': return resp(599)
    case 'lento410': await dorme(4_000); return resp(410, 'gone')
    case 'lento': await dorme(20_000); return resp(201)
    default: return resp(500, 'cenario web desconhecido')
  }
})
