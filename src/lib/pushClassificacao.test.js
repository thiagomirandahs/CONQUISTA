// Classificação das respostas dos provedores de push (função pura da Edge Function enviar-push).
// REGRA: só erro comprovadamente PERMANENTE da inscrição remove; todo o resto só é registrado.
import { describe, it, expect } from 'vitest'
import { classificarFalha, lerRetryAfter, rotuloErroFcm } from '../../supabase/functions/_compartilhado/push-erro.ts'

const fcmErro = (code, status, errorCode, extra = []) => JSON.stringify({
  error: { code, message: 'x', status, details: [{ '@type': 'type.googleapis.com/google.firebase.fcm.v1.FcmError', errorCode }, ...extra] },
})
const campoToken = { '@type': 'type.googleapis.com/google.rpc.BadRequest', fieldViolations: [{ field: 'message.token', description: 'x' }] }
const campoPayload = { '@type': 'type.googleapis.com/google.rpc.BadRequest', fieldViolations: [{ field: 'message.data', description: 'x' }] }

describe('Web Push: o que remove', () => {
  it.each([[404, '404'], [410, '410']])('%i -> remove (permanente)', (st, cod) => {
    const c = classificarFalha('web', st, '', null)
    expect(c).toMatchObject({ codigo: cod, remover: true })
  })
  it('400 com prova de inscrição inválida -> remove, código sub_invalida', () => {
    for (const corpo of ['InvalidRegistration', 'invalid registration token', 'Invalid endpoint', 'bad subscription', 'UnRegistered', 'NotRegistered']) {
      expect(classificarFalha('web', 400, corpo, null), corpo).toMatchObject({ codigo: 'sub_invalida', remover: true })
    }
  })
  it('400 genérico (VAPID/TTL/payload/corpo vazio) NÃO remove', () => {
    for (const corpo of ['', 'bad request', 'invalid TTL header', 'Invalid encryption header', 'payload too large']) {
      expect(classificarFalha('web', 400, corpo, null), corpo).toMatchObject({ codigo: '400', remover: false })
    }
  })
  it.each([401, 403, 413, 408, 429, 500, 502, 503, 504, 418, 422, 301, 307, 599])('%i NUNCA remove', (st) => {
    expect(classificarFalha('web', st, 'unauthorized registration invalid endpoint', null).remover).toBe(false)
  })
})

describe('Web Push: códigos gravados (vocabulário fechado)', () => {
  it('status conhecidos mantêm o próprio código; desconhecidos viram "desconhecido"', () => {
    for (const st of [400, 401, 403, 408, 413, 429, 500, 502, 503, 504]) expect(classificarFalha('web', st, '', null).codigo).toBe(String(st))
    for (const st of [301, 405, 418, 422, 507, 599]) expect(classificarFalha('web', st, '', null).codigo).toBe('desconhecido')
  })
  it('sem resposta: timeout e rede (nunca removem)', () => {
    expect(classificarFalha('web', null, '', null, 'timeout')).toMatchObject({ codigo: 'timeout', remover: false })
    expect(classificarFalha('web', null, '', null, 'rede')).toMatchObject({ codigo: 'rede', remover: false })
    expect(classificarFalha('web', null, '', null)).toMatchObject({ codigo: 'rede', remover: false })
  })
  it('corpo vazio/ilegível não quebra', () => {
    for (const st of [400, 404, 500]) expect(() => classificarFalha('fcm', st, '', null)).not.toThrow()
    expect(() => classificarFalha('fcm', 400, '{não é json', null)).not.toThrow()
  })
  it('401/403/400/413 que não removem são marcados como "credencial" (observabilidade)', () => {
    for (const st of [401, 403, 413, 400]) expect(classificarFalha('web', st, '', null).credencial).toBe(true)
    expect(classificarFalha('web', 404, '', null).credencial).toBe(false)
    expect(classificarFalha('web', 503, '', null).credencial).toBe(false)
  })
})

describe('FCM v1', () => {
  it('404 UNREGISTERED -> remove', () => {
    expect(classificarFalha('fcm', 404, fcmErro(404, 'NOT_FOUND', 'UNREGISTERED'), null)).toMatchObject({ codigo: '404', remover: true })
  })
  it('404 SEM o detalhe UNREGISTERED (projeto/rota errados: atingiria TODOS os tokens) NÃO remove', () => {
    expect(classificarFalha('fcm', 404, '', null).remover).toBe(false)
    expect(classificarFalha('fcm', 404, JSON.stringify({ error: { code: 404, message: 'Requested entity was not found.', status: 'NOT_FOUND' } }), null).remover).toBe(false)
  })
  it('400 INVALID_ARGUMENT de TOKEN (campo message.token ou mensagem de token inválido) -> remove', () => {
    expect(classificarFalha('fcm', 400, fcmErro(400, 'INVALID_ARGUMENT', 'INVALID_ARGUMENT', [campoToken]), null)).toMatchObject({ codigo: 'sub_invalida', remover: true })
    const msg = JSON.stringify({ error: { code: 400, message: 'The registration token is not a valid FCM registration token', status: 'INVALID_ARGUMENT' } })
    expect(classificarFalha('fcm', 400, msg, null)).toMatchObject({ codigo: 'sub_invalida', remover: true })
  })
  it('400 INVALID_ARGUMENT de PAYLOAD (campo data, tamanho, chave reservada) NÃO remove', () => {
    expect(classificarFalha('fcm', 400, fcmErro(400, 'INVALID_ARGUMENT', 'INVALID_ARGUMENT', [campoPayload]), null)).toMatchObject({ codigo: '400', remover: false })
    expect(classificarFalha('fcm', 400, '', null)).toMatchObject({ codigo: '400', remover: false })
  })
  it('401 (credencial) e 403 (SENDER_ID_MISMATCH/PERMISSION_DENIED) NÃO removem', () => {
    expect(classificarFalha('fcm', 401, fcmErro(401, 'UNAUTHENTICATED', 'THIRD_PARTY_AUTH_ERROR'), null)).toMatchObject({ codigo: '401', remover: false })
    expect(classificarFalha('fcm', 403, fcmErro(403, 'PERMISSION_DENIED', 'SENDER_ID_MISMATCH'), null)).toMatchObject({ codigo: '403', remover: false })
  })
  it('429/500/503/504/408 e 410 NÃO removem', () => {
    for (const st of [408, 429, 500, 503, 504, 410]) expect(classificarFalha('fcm', st, fcmErro(st, 'X', 'UNREGISTERED'), null).remover).toBe(false)
    expect(classificarFalha('fcm', 410, '', null).codigo).toBe('desconhecido')
  })
})

describe('Retry-After', () => {
  it('segundos e data HTTP, limitados a [1 s, 24 h]', () => {
    const t0 = Date.parse('2026-10-02T12:00:00Z')
    expect(lerRetryAfter('120', t0)).toBe(120)
    expect(lerRetryAfter('0', t0)).toBe(1)
    expect(lerRetryAfter('999999999', t0)).toBe(86400)
    expect(lerRetryAfter('Fri, 02 Oct 2026 12:01:00 GMT', t0)).toBe(60)
    expect(lerRetryAfter('Fri, 02 Oct 2026 11:00:00 GMT', t0)).toBe(1)
    for (const lixo of ['', 'abc', null, undefined, '-5', '1.5']) expect(lerRetryAfter(lixo, t0)).toBeNull()
  })
  it('só entra em 408/429/5xx', () => {
    expect(classificarFalha('web', 429, '', '30').retryS).toBe(30)
    expect(classificarFalha('web', 503, '', '45').retryS).toBe(45)
    expect(classificarFalha('fcm', 429, '', '60').retryS).toBe(60)
    expect(classificarFalha('web', 403, '', '30').retryS).toBeNull()
    expect(classificarFalha('web', 404, '', '30').retryS).toBeNull()
  })
})

describe('mensagens sem vazamento', () => {
  it('só "oauth NNN" e "timeout" passam; o resto vira rótulo fixo', () => {
    expect(rotuloErroFcm('oauth 401')).toBe('oauth 401')
    expect(rotuloErroFcm('timeout')).toBe('timeout')
    expect(rotuloErroFcm('Unexpected token \'x\' in {"private_key":"-----BEGIN"')).toBe('configuração/credencial')
    expect(rotuloErroFcm('oauth 401 https://x/y?token=abc')).toBe('configuração/credencial')
  })
})
