// Classificação das respostas dos provedores de push (Web Push e FCM HTTP v1) — função PURA, sem Deno nem rede, para ser testada
// em vitest (src/lib/pushClassificacao.test.js) e usada pela Edge Function enviar-push.
//
// REGRA DE OURO: só erro comprovadamente PERMANENTE da INSCRIÇÃO (`remover: true`) apaga a inscrição/o token. Tudo o mais — temporário,
// problema de credencial do SERVIDOR, payload, resposta desconhecida — só é REGISTRADO (código curto, vocabulário fechado de
// push_tentativas.codigo) e a inscrição fica. Nada daqui devolve texto do provedor, endpoint ou token.
//
// Fontes:
//  * Web Push (RFC 8030 §8.3 / web.dev "Web Push Protocol"): 201 aceito; 429 limite (Retry-After); 400 pedido inválido; 404 e 410 = inscrição
//    expirada/cancelada -> apagar do banco; 413 payload grande (>= 4096 B deve ser aceito).
//  * FCM HTTP v1 (https://firebase.google.com/docs/cloud-messaging/error-codes): UNREGISTERED (404) = token inválido, "remover imediatamente";
//    INVALID_ARGUMENT (400) = parâmetros inválidos — token malformado OU payload/tamanho/chave reservada (só o primeiro é do token);
//    SENDER_ID_MISMATCH (403) = remetente diferente do do token; THIRD_PARTY_AUTH_ERROR (401) = credencial; QUOTA_EXCEEDED (429) = backoff;
//    UNAVAILABLE (503) / INTERNAL (500) = temporários.

export type Canal = 'web' | 'fcm'

export interface Classificacao {
  /** código curto gravado em push_tentativas.codigo (vocabulário fechado; ver migration 534) */
  codigo: string
  /** true = erro PERMANENTE comprovado da inscrição/do token: apagar SÓ esta credencial */
  remover: boolean
  /** Retry-After do provedor em segundos (1..86400) quando houver; senão null */
  retryS: number | null
  /** true = 400/401/403/413: vale registrar em infra_falhas quando atinge TODOS os aparelhos do lote (sinal de credencial do servidor) */
  credencial: boolean
}

const VOCABULARIO = new Set(['400', '401', '403', '404', '408', '410', '413', '429', '500', '502', '503', '504'])

/** Retry-After: segundos inteiros ou data HTTP. Limita a [1 s, 24 h]; ilegível/ausente = null. */
export function lerRetryAfter(valor: unknown, agoraMs: number = Date.now()): number | null {
  if (valor == null) return null
  const v = String(Array.isArray(valor) ? valor[0] : valor).trim()
  if (!v) return null
  let seg: number
  if (/^\d{1,9}$/.test(v)) seg = Number(v)
  else {
    if (!/[A-Za-z]/.test(v)) return null   // data HTTP sempre tem letras (dia/mês/GMT); evita Date.parse('1.5') virar data
    const t = Date.parse(v)
    if (Number.isNaN(t)) return null
    seg = Math.ceil((t - agoraMs) / 1000)
  }
  if (!Number.isFinite(seg)) return null
  return Math.min(Math.max(seg, 1), 86400)
}

// 400 do Web Push que COMPROVA inscrição inválida (endpoint/registro inválido, não "pedido malformado do servidor").
// Os serviços não padronizam: FCM-web antigo responde "InvalidRegistration"/"invalid registration", o autopush do Mozilla traz
// "invalid token"/"invalid endpoint". Lista CONSERVADORA — qualquer outro 400 (cabeçalho VAPID, TTL, payload, criptografia) NÃO remove.
const SUB_INVALIDA_WEB = /(invalid|bad|malformed)[\s_-]*(registration|subscription|endpoint|push[\s_-]*token)|unregistered|not[\s_-]*registered/i

interface DetalhesFcm { errorCode: string | null; mensagem: string; campos: string[] }
function lerCorpoFcm(corpo: string): DetalhesFcm {
  const out: DetalhesFcm = { errorCode: null, mensagem: '', campos: [] }
  try {
    const j = JSON.parse(corpo)
    const e = j?.error
    out.mensagem = typeof e?.message === 'string' ? e.message : ''
    for (const d of Array.isArray(e?.details) ? e.details : []) {
      if (typeof d?.errorCode === 'string') out.errorCode = d.errorCode
      for (const v of Array.isArray(d?.fieldViolations) ? d.fieldViolations : []) {
        if (typeof v?.field === 'string') out.campos.push(v.field)
      }
    }
  } catch { /* corpo vazio/ilegível: sem prova */ }
  return out
}

/**
 * @param status    status HTTP do provedor; null quando não houve resposta (rede/timeout)
 * @param corpo     corpo da resposta (texto, pode ser '')
 * @param retryAfter valor bruto do cabeçalho Retry-After (ou null)
 * @param falhaSemResposta 'timeout' | 'rede' quando status é null
 */
export function classificarFalha(
  canal: Canal, status: number | null, corpo: string, retryAfter: unknown,
  falhaSemResposta: 'timeout' | 'rede' = 'rede', agoraMs: number = Date.now(),
): Classificacao {
  if (status == null || !Number.isFinite(status)) {
    return { codigo: falhaSemResposta, remover: false, retryS: null, credencial: false }
  }
  const txt = String(corpo ?? '').slice(0, 2000)
  let codigo = VOCABULARIO.has(String(status)) ? String(status) : 'desconhecido'
  let remover = false

  if (canal === 'web') {
    if (status === 404 || status === 410) remover = true
    else if (status === 400 && SUB_INVALIDA_WEB.test(txt)) { codigo = 'sub_invalida'; remover = true }
  } else {
    const f = lerCorpoFcm(txt)
    if (status === 404) {
      // UNREGISTERED é o único 404 que prova token morto. Um 404 SEM esse detalhe (projeto errado, rota) pode atingir TODOS os tokens.
      remover = f.errorCode === 'UNREGISTERED'
    } else if (status === 400) {
      const tokenInvalido = f.campos.some((c) => /(^|\.)token$/i.test(c)) || /registration token is not a valid|invalid.*registration token/i.test(f.mensagem)
      if (tokenInvalido) { codigo = 'sub_invalida'; remover = true }
      // INVALID_ARGUMENT de payload/tamanho/chave reservada: NÃO remove (o token pode estar perfeito)
    }
    // 410 não existe no FCM v1: se vier, é 'desconhecido' e nunca remove
    if (status === 410) codigo = 'desconhecido'
  }
  const temporarioComEspera = status === 408 || status === 429 || (status >= 500 && status <= 599)
  return {
    codigo, remover,
    retryS: temporarioComEspera ? lerRetryAfter(retryAfter, agoraMs) : null,
    credencial: [400, 401, 403, 413].includes(status) && !remover,
  }
}

/** Mensagem de erro do FCM/OAuth SEM vazar conteúdo: só `oauth <status>` passa; o resto vira um rótulo fixo. */
export function rotuloErroFcm(msg: unknown): string {
  const m = String(msg ?? '')
  return /^oauth \d{3}$/.test(m) ? m : (m === 'timeout' ? 'timeout' : 'configuração/credencial')
}
