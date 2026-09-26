// Edge Function: enviar-push
// Acionada pelo gatilho `trg_notificacao_push` (migration 52) quando entra uma linha em
// "notificacoes". Entrega o aviso por DUAS rotas, para o mesmo público:
//   - Web Push  (navegador / PWA)  -> public.push_subscriptions, via VAPID
//   - FCM       (APK Android)      -> public.push_tokens,        via FCM HTTP v1
//
// Fase 8.1 — o que mudou e por quê:
//   * O APK gravava o token do FCM em push_tokens desde sempre e NINGUÉM lia essa tabela.
//     O push nativo no Android simplesmente não funcionava. Agora funciona.
//   * O envio era um `Promise.all` sobre TODOS os destinatários, sem teto: um clube de 500
//     membros abria 500 conexões HTTP de saída ao mesmo tempo, e agora seriam 1.000 com as duas
//     rotas. Passou a ser em lotes com concorrência limitada.
//   * O público das duas rotas vem da MESMA regra no banco (_push_publico), então não há como
//     Web e Android divergirem sobre quem pode receber o quê.
//
// SEGURANÇA: como o "Verify JWT" fica desligado (quem chama é o gatilho do banco, não um
// usuário), a função tem a PRÓPRIA fechadura: o chamador precisa mandar o header
// `x-push-webhook-secret` com o valor do secret PUSH_WEBHOOK_SECRET. Sem ele (ou errado),
// respondemos 401 e NÃO tocamos no banco. O payload também é validado e o `link` só pode ser
// caminho interno.
//
// MULTI-TENANT: os destinatários vêm de public.push_destinatarios(...) e
// public.push_destinatarios_nativos(...), ambas restritas ao service_role e testadas no banco
// (supabase/tests/07_push_por_clube.sql e 47_push_nativo_e_infra.sql).
//
// Secrets necessários (painel Supabase → Edge Functions → Secrets):
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, PUSH_WEBHOOK_SECRET
//   FCM_SERVICE_ACCOUNT  (JSON da conta de serviço do Firebase; SEM ele o envio nativo é
//                         simplesmente pulado, e isso é registrado — a rota web continua)
// (SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY já são injetados automaticamente.)

// Versões EXATAS de propósito (a função é colada no painel, não há lockfile): o supabase-js é o mesmo
// do package-lock do app (src/lib/pushEdgeContrato.test.js confere). Para atualizar: mude aqui, teste, e cole de novo.
import webpush from 'npm:web-push@3.6.7'
import { createClient } from 'npm:@supabase/supabase-js@2.108.2'

const VAPID_PUBLIC = Deno.env.get('VAPID_PUBLIC_KEY') ?? ''
const VAPID_PRIVATE = Deno.env.get('VAPID_PRIVATE_KEY') ?? ''
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const WEBHOOK_SECRET = Deno.env.get('PUSH_WEBHOOK_SECRET') ?? ''
const FCM_SERVICE_ACCOUNT = Deno.env.get('FCM_SERVICE_ACCOUNT') ?? ''

// Teto de envios simultâneos. Um clube grande tem centenas de aparelhos; sem teto, um único
// invoke abria uma conexão de saída por aparelho. 25 mantém o paralelismo útil sem transformar
// um aviso do clube numa rajada.
const LOTE = 25
// Toda chamada de saída tem prazo. Sem isto, um provedor lento segurava o invoke até o timeout
// da plataforma e nenhum aviso saía.
const TIMEOUT_MS = 10_000

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

// Registra uma falha de infraestrutura sem derrubar o envio. Nunca grava token, texto da
// notificação nem nada de quem recebe — só o que serve para investigar depois.
async function registrarFalha(detalhe: string, clubId: string | null) {
  try {
    await sb.from('infra_falhas').insert({ origem: 'push/edge', detalhe: detalhe.slice(0, 500), club_id: clubId })
  } catch { /* se nem isso der, não há o que fazer aqui */ }
}

// Executa `tarefa` sobre `itens` em lotes de `tamanho`, esperando cada lote terminar.
// É o teto de concorrência: o número de chamadas de saída simultâneas nunca passa de `tamanho`.
async function emLotes<T>(itens: T[], tamanho: number, tarefa: (item: T) => Promise<boolean>): Promise<number> {
  let ok = 0
  for (let i = 0; i < itens.length; i += tamanho) {
    const resultados = await Promise.all(itens.slice(i, i + tamanho).map(tarefa))
    ok += resultados.filter(Boolean).length
  }
  return ok
}

function comPrazo<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))])
}

// ---------------------------------------------------------------------------
// FCM HTTP v1: a rota do APK.
//
// A API v1 exige um access token OAuth2 obtido assinando um JWT com a chave privada da conta de
// serviço. O token vale 1 hora; guardamos em memória para não refazer a troca a cada invoke —
// numa instância quente isso economiza uma ida ao Google por notificação.
// ---------------------------------------------------------------------------
let tokenFcm: { valor: string; expira: number } | null = null

function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function pemParaDer(pem: string): Uint8Array {
  const corpo = pem.replace(/-----(BEGIN|END) PRIVATE KEY-----/g, '').replace(/\s+/g, '')
  const bin = atob(corpo)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

async function acessoFcm(conta: { client_email: string; private_key: string }): Promise<string> {
  const agora = Math.floor(Date.now() / 1000)
  if (tokenFcm && tokenFcm.expira > agora + 60) return tokenFcm.valor

  const cabecalho = base64url(new TextEncoder().encode(JSON.stringify({ alg: 'RS256', typ: 'JWT' })))
  const corpo = base64url(new TextEncoder().encode(JSON.stringify({
    iss: conta.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token',
    iat: agora,
    exp: agora + 3600,
  })))
  const chave = await crypto.subtle.importKey(
    'pkcs8', pemParaDer(conta.private_key),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign'])
  const assinatura = new Uint8Array(await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5', chave, new TextEncoder().encode(`${cabecalho}.${corpo}`)))
  const jwt = `${cabecalho}.${corpo}.${base64url(assinatura)}`

  const resp = await comPrazo(fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt }),
  }), TIMEOUT_MS)
  if (!resp.ok) throw new Error('oauth ' + resp.status)
  const dados = await resp.json()
  tokenFcm = { valor: dados.access_token, expira: agora + 3500 }
  return tokenFcm.valor
}

Deno.serve(async (req) => {
  // 1) FECHADURA: sem o segredo do webhook, nada acontece (falha fechada:
  //    se o secret nem foi cadastrado, também recusa tudo).
  const segredo = req.headers.get('x-push-webhook-secret') ?? ''
  if (!(await igualSeguro(segredo, WEBHOOK_SECRET))) {
    return new Response('não autorizado', { status: 401 })
  }

  try {
    const body = await req.json().catch(() => ({}))
    const notif = body.record ?? body // o gatilho envia { type, table, record, ... }

    // 2) VALIDAÇÃO do payload (aceita só notificação com cara de notificação).
    //    Respondemos 200 nos inválidos pra o chamador não ficar re-tentando.
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

    // 3) Define quem recebe — SEMPRE dentro do CLUBE da notificação (multi-tenant).
    //    A escolha é uma função SQL (só o service_role executa), testada no banco. Notificação
    //    sem clube válido, ou com destino desconhecido, NUNCA vira broadcast (falha fechada).
    const clubeId = typeof notif?.club_id === 'string' && UUID_RE.test(notif.club_id) ? notif.club_id : null
    if (!clubeId) return new Response('ok (notificacao sem clube)', { status: 200 })
    const para = typeof notif?.para === 'string' ? notif.para : ''
    if (!paraUsuario && para !== 'todos' && para !== 'lideranca') {
      return new Response('ok (destino desconhecido)', { status: 200 })
    }
    // ------------------------------------------------------------------
    // RESERVA (fase 8.2) — a idempotência acontece aqui, ANTES de qualquer envio.
    //
    // Antes, a função recalculava o público a cada invoke e mandava para todo mundo. Um retry,
    // um timeout do pg_net ou um reprocessamento manual reenviavam tudo: o celular tocava de
    // novo. Agora o banco decide o que ESTE invoke tem direito de enviar, e devolve só isso.
    //
    // Um segundo invoke do mesmo evento recebe lista VAZIA — não por tentar e falhar, mas porque
    // as linhas de entrega já estão reservadas por índice único. A garantia não depende desta
    // função ser correta, o que é o ponto: código de entrega é onde retry mora.
    // ------------------------------------------------------------------
    const eventoId = typeof notif?.push_evento_id === 'string' && UUID_RE.test(notif.push_evento_id)
      ? notif.push_evento_id : null
    if (!eventoId) {
      // Sem evento não há intenção de despacho. É assim que seed, fixture, backfill e RESTORE
      // DE BACKUP deixam de acordar o clube inteiro — a linha existe, o push não sai.
      return new Response('ok (sem evento de push)', { status: 200 })
    }

    const { data: reservadas, error: erroReserva } = await sb.rpc('push_reservar', { p_evento_id: eventoId })
    if (erroReserva) { console.error('push_reservar', erroReserva.message); return new Response('erro interno', { status: 500 }) }
    const entregas: any[] = reservadas ?? []
    if (entregas.length === 0) {
      // Caminho normal de um retry. Não é erro, e é exatamente o que se queria.
      return new Response(JSON.stringify({ enviados: 0, jaEntregue: true }), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const link = linkSeguro(notif.link)
    const payload = JSON.stringify({ titulo, corpo, link })
    // Última linha de defesa, no aparelho: duas notificações com a mesma `tag` se SUBSTITUEM em
    // vez de empilhar. Não substitui a idempotência do servidor — protege contra a rajada de
    // eventos legítimos e distintos (dois lances seguidos) virar duas tarjas idênticas na mão
    // de quem está olhando.
    const tag = `cq-${eventoId.slice(0, 8)}`
    const resultados: Array<{ id: number; ok: boolean; codigo: string; ms: number }> = []

    const subs = entregas.filter((e) => e.canal === 'web')
    const tokens = entregas.filter((e) => e.canal === 'fcm')

    // ---- rota 1: Web Push ----
    const enviadosWeb = await emLotes(subs, LOTE, async (s) => {
      const t0 = Date.now()
      try {
        await comPrazo(webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          JSON.stringify({ titulo, corpo, link, tag })), TIMEOUT_MS)
        resultados.push({ id: s.tentativa_id, ok: true, codigo: '200', ms: Date.now() - t0 })
        return true
      } catch (e: any) {
        // Inscrição expirada/cancelada -> remove do banco
        if (e?.statusCode === 404 || e?.statusCode === 410) {
          await sb.from('push_subscriptions').delete().eq('endpoint', s.endpoint)
        }
        resultados.push({
          id: s.tentativa_id, ok: false,
          codigo: String(e?.statusCode ?? (e?.message === 'timeout' ? 'timeout' : 'rede')),
          ms: Date.now() - t0,
        })
        return false
      }
    })

    // ---- rota 2: FCM (APK) ----
    let enviadosApp = 0
    if (tokens.length > 0) {
      if (!FCM_SERVICE_ACCOUNT) {
        // Falha declarada, não silenciosa: há aparelho Android esperando e falta configuração.
        await registrarFalha(`FCM_SERVICE_ACCOUNT ausente; ${tokens.length} aparelho(s) sem aviso`, clubeId)
        for (const k of tokens) resultados.push({ id: k.tentativa_id, ok: false, codigo: 'oauth', ms: 0 })
      } else {
        try {
          const conta = JSON.parse(FCM_SERVICE_ACCOUNT)
          const acesso = await acessoFcm(conta)
          const urlFcm = `https://fcm.googleapis.com/v1/projects/${conta.project_id}/messages:send`
          enviadosApp = await emLotes(tokens, LOTE, async (k) => {
            const t0 = Date.now()
            try {
              const resp = await comPrazo(fetch(urlFcm, {
                method: 'POST',
                headers: { Authorization: `Bearer ${acesso}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  message: {
                    token: k.token,
                    notification: { title: titulo, body: corpo },
                    // o app usa isto para abrir na tela certa ao tocar no aviso
                    data: { link },
                    android: {
                      priority: 'high',
                      // `collapse_key` é o equivalente FCM da `tag` do Web Push
                      collapse_key: tag,
                      notification: { tag, click_action: 'FLUTTER_NOTIFICATION_CLICK' },
                    },
                  },
                }),
              }), TIMEOUT_MS)
              resultados.push({ id: k.tentativa_id, ok: resp.ok, codigo: String(resp.status), ms: Date.now() - t0 })
              if (resp.ok) return true
              // 404 = token não existe mais (app desinstalado); 403 = projeto errado.
              // Só o 404 significa "limpe este aparelho".
              if (resp.status === 404) await sb.from('push_tokens').delete().eq('token', k.token)
              return false
            } catch (e: any) {
              resultados.push({
                id: k.tentativa_id, ok: false,
                codigo: e?.message === 'timeout' ? 'timeout' : 'rede', ms: Date.now() - t0,
              })
              return false
            }
          })
        } catch (e: any) {
          await registrarFalha('FCM: ' + (e?.message ?? e), clubeId)
          for (const k of tokens) resultados.push({ id: k.tentativa_id, ok: false, codigo: 'oauth', ms: 0 })
        }
      }
    }

    // Fecha o ciclo. Toda tentativa reservada precisa terminar com um estado: o que ficar em
    // 'enviando' é um invoke que morreu no meio, e a reserva seguinte o libera por tempo.
    // O que vai daqui é só id, sucesso, CÓDIGO e duração — nada do conteúdo.
    if (resultados.length > 0) {
      const { error: erroConcluir } = await sb.rpc('push_concluir', { p_resultados: resultados })
      if (erroConcluir) await registrarFalha('push_concluir: ' + erroConcluir.message, clubeId)
    }

    return new Response(JSON.stringify({ enviados: enviadosWeb, enviadosApp, reservadas: entregas.length }), {
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (e: any) {
    console.error('enviar-push', e?.message ?? e)   // detalhe só no log da função, nunca na resposta
    return new Response('erro interno', { status: 500 })
  }
})
