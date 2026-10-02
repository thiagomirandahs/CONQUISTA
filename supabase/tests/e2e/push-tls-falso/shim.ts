// SÓ PARA O E2E (nunca vai para produção; vive em supabase/tests/). O edge-runtime não deixa o worker ler arquivos de CA nem confiar numa CA extra
// (DENO_CERT/NODE_EXTRA_CA_CERTS são ignorados, `ca`/`rejectUnauthorized` do node:https também), então o provedor FALSO (certificado de uma CA
// descartável) só é alcançável se o TRANSPORTE confiar nela. Este módulo é importado ANTES da Edge Function real (push-erro-permanente.mjs monta
// a pasta e usa entrada.ts como entrypoint) e troca apenas o transporte:
//   * fetch (FCM/OAuth): ganha `client` (Deno.createHttpClient com a CA de teste) SÓ para os hosts do provedor falso;
//   * node:https.request (usado pela lib web-push): vira uma ponte sobre o mesmo fetch, preservando statusCode/headers/corpo/timeout/erros —
//     a lib web-push real continua gerando VAPID, criptografando e classificando o erro; só o socket TLS muda.
// Nada aqui altera a lógica de classificação/remoção da função.
import https from 'node:https'
import { EventEmitter } from 'node:events'

const PEM = Deno.env.get('E2E_CA_PEM') ?? ''
if (!PEM) throw new Error('E2E_CA_PEM ausente')
// @ts-ignore API instável do Deno, disponível no edge-runtime
const client = Deno.createHttpClient({ caCerts: [PEM] })
const HOSTS = new Set(['fcm.googleapis.com', 'oauth2.googleapis.com', 'push-fake.test', 'push-recusa.test'])

const fetchOriginal = globalThis.fetch.bind(globalThis)
globalThis.fetch = ((input: any, init: any = {}) => {
  const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  const host = new URL(href).hostname
  return fetchOriginal(input, HOSTS.has(host) ? { ...init, client } : init)
}) as typeof fetch

;(https as any).request = function (opts: any, cb?: (res: any) => void) {
  const req: any = new EventEmitter()
  const pedacos: Uint8Array[] = []
  const ac = new AbortController()
  let destruida = false
  req.write = (b: any) => { pedacos.push(typeof b === 'string' ? new TextEncoder().encode(b) : new Uint8Array(b)); return true }
  req.destroy = () => { destruida = true; ac.abort() }
  req.setTimeout = () => req
  req.end = (b?: any) => {
    if (b) req.write(b)
    ;(async () => {
      let relogio: ReturnType<typeof setTimeout> | undefined
      try {
        const total = pedacos.reduce((n, p) => n + p.length, 0)
        const corpo = new Uint8Array(total)
        let o = 0
        for (const p of pedacos) { corpo.set(p, o); o += p.length }
        const url = `https://${opts.hostname ?? opts.host}${opts.port ? ':' + opts.port : ''}${opts.path ?? '/'}`
        if (opts.timeout) relogio = setTimeout(() => req.emit('timeout'), opts.timeout)
        const r = await fetch(url, { method: opts.method ?? 'GET', headers: opts.headers, body: total ? corpo : undefined, signal: ac.signal, redirect: 'manual' })
        const res: any = new EventEmitter()
        res.statusCode = r.status
        res.headers = Object.fromEntries(r.headers)
        res.setEncoding = () => res
        res.resume = () => res
        if (cb) cb(res)
        const texto = await r.text()
        if (relogio) clearTimeout(relogio)
        if (texto) res.emit('data', texto)
        res.emit('end')
      } catch (e) {
        if (relogio) clearTimeout(relogio)
        if (!destruida) req.emit('error', e)
      }
    })()
  }
  return req
}
