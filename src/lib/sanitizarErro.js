// Sanitização e descrição segura de erros para a telemetria (observabilidade.js).
//
// Objetivo (auditoria de 02/10/2026): PRESERVAR o que ajuda a achar o bug — nome, mensagem, causa
// (`cause`) e onde nasceu (arquivo:linha:coluna do stack) — e MASCARAR por PADRÃO o que nunca pode
// ser gravado: JWT, Bearer/Basic, chaves do Supabase (sb_publishable_/sb_secret_/eyJ…), query de URL
// (?token=, ?apikey=, URL assinada), cookies, Authorization, senha, e-mail, telefone, CPF, uuid e
// valores citados (que costumam ser dado de pessoa). Antes, o que não era conhecido era DESCARTADO
// (virava hash) — seguro, mas cego. Agora a mensagem sai mascarada e curta; o hash continua só como
// agrupador no `codigo`.
//
// Tudo aqui é PURO e nunca lança: erro de telemetria não pode derrubar o produto, e o objeto lançado
// pode ser qualquer coisa (string, Proxy, objeto circular, getter que explode).

const MASC = '[mascarado]'

// Nomes de parâmetro/campo cujo VALOR nunca sai (query string, JSON, cabeçalho, corpo de formulário).
const CAMPOS_SECRETOS = [
  'access[_-]?token', 'refresh[_-]?token', 'id[_-]?token', 'provider[_-]?token', 'token', 'jwt',
  'api[_-]?key', 'apikey', 'anon[_-]?key', 'service[_-]?role[_-]?key', 'secret', 'client[_-]?secret',
  'password', 'passwd', 'pwd', 'senha', 'nova[_-]?senha', 'confirmar[_-]?senha',
  'authorization', 'auth', 'cookie', 'set-cookie', 'session', 'sid', 'signature', 'sig',
  'x-amz-[\\w-]+', 'credential', 'key', 'code', 'otp', 'codigo', 'cpf', 'telefone', 'phone', 'email', 'e-mail',
  'nome', 'name', 'cep',
].join('|')

const RE_PAR_SECRETO = new RegExp(
  `(^|[?&;,{\\s"'(])((?:${CAMPOS_SECRETOS}))(["']?\\s*[=:]\\s*)("[^"]*"|'[^']*'|[^&\\s"',;)}\\]]+)`, 'gi')

const RE_URL = /\b(?:https?|wss?|blob|file):\/\/[^\s"'<>)\]]+/gi

// Uma URL fica só com origem + caminho; query e fragmento somem (é onde moram tokens e URLs
// assinadas). Usuário:senha embutido (https://user:pass@host) também some.
export function sanitizarUrl(url) {
  try {
    let s = String(url)
    s = s.replace(/^([a-z]+:\/\/)[^/\s@]*@/i, '$1') // userinfo
    const temQuery = /[?#]/.test(s)
    s = s.replace(/[?#].*$/, '')
    // segmentos de caminho que parecem token/uuid (storage: /sign/<token>, /<uid>/...) não saem
    s = s.replace(/\/[A-Za-z0-9_-]{32,}(?=\/|$)/g, '/[segredo]')
      .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?=\/|$)/gi, '/[uuid]')
    return temQuery ? `${s}?[query]` : s
  } catch { return '[url]' }
}

// Valores entre aspas costumam ser dado do usuário ("Key (email)=(x@y)", 'Maria Silva'). Só passam
// identificadores curtos em minúsculas (nome de coluna/rota/etapa), que não identificam ninguém.
function mascararCitados(texto) {
  return texto
    .replace(/=\(([^)]*)\)/g, '=([valor])')                       // Key (col)=(valor) do Postgres
    .replace(/"([^"]{1,120})"/g, (m, i) => (/^[a-z_][a-z0-9_.:-]{0,19}$/.test(i) ? m : '"[valor]"'))
    .replace(/'([^']{1,120})'/g, (m, i) => (/^[a-z_][a-z0-9_.:-]{0,19}$/.test(i) ? m : "'[valor]'"))
}

/**
 * Mascara por padrão e corta no tamanho. `citados: true` também esconde valores entre aspas
 * (use em mensagens vindas do servidor/negócio; mensagens do motor JS citam só nome de propriedade).
 */
export function sanitizarTexto(entrada, max = 200, { citados = false } = {}) {
  try {
    let s = typeof entrada === 'string' ? entrada : String(entrada ?? '')
    if (!s) return ''
    // O teto vale ANTES do regex: mensagem gigante não pode custar CPU.
    s = s.slice(0, Math.max(max * 6, 2000))
    // 1) URLs inteiras (query/fragmento/userinfo/segmentos secretos)
    s = s.replace(RE_URL, (u) => sanitizarUrl(u))
    // 2) JWT (3 partes) e qualquer eyJ… solto
    s = s.replace(/\beyJ[\w-]{4,}\.[\w-]{4,}\.[\w-]*/g, '[jwt]').replace(/\beyJ[\w-]{16,}/g, '[jwt]')
    // 3) Bearer/Basic
    s = s.replace(/\b(Bearer|Basic)\s+[^\s"',;]+/gi, '$1 [token]')
    // 4) chaves do Supabase (sb_publishable_…, sb_secret_…, sbp_…)
    s = s.replace(/\bsb[a-z]{0,2}_[\w-]{6,}/gi, '[chave]')
    // 5) cabeçalhos: o valor INTEIRO de Authorization/Cookie/Set-Cookie (podem ter espaços e ';')
    s = s.replace(/\b(authorization|proxy-authorization|set-cookie|cookie)(["']?\s*[:=]\s*)[^\n\r]*/gi, `$1$2${MASC}`)
    // 6) pares nome=valor/nome:valor de campos secretos (query string sobrevivente, JSON, formulário)
    s = s.replace(RE_PAR_SECRETO, (m, ini, nome, sep) => `${ini}${nome}${sep}${MASC}`)
    // 7) dados pessoais por forma
    s = s.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[e-mail]')
    s = s.replace(/\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/g, '[cpf]').replace(/\b\d{11}\b/g, '[numero]')
    s = s.replace(/(?:\+?55[\s.-]?)?\(?\b\d{2}\)?[\s.-]?9?\d{4}[\s.-]\d{4}\b/g, '[telefone]')
    s = s.replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '[uuid]')
    // 8) sequências opacas longas (tokens, hashes, chaves) — não é texto de gente nem nome de arquivo
    s = s.replace(/\b[0-9A-Fa-f]{16,}\b/g, '[segredo]').replace(/\b[A-Za-z0-9_-]{32,}\b/g, '[segredo]')
      .replace(/\b[A-Z0-9]{16,}\b/g, '[segredo]')
    if (citados) s = mascararCitados(s)
    s = s.replace(/\s+/g, ' ').trim()
    return s.length > max ? `${s.slice(0, Math.max(0, max - 1))}…` : s
  } catch { return '' }
}

// ----------------------------------------------------------------------------------------------
// Leitura segura de qualquer coisa que tenha sido lançada

const NOMES_DO_MOTOR = new Set(['TypeError', 'ReferenceError', 'RangeError', 'SyntaxError', 'EvalError', 'URIError', 'AggregateError', 'DOMException'])

function ler(obj, chave) {
  try { return obj[chave] } catch { return undefined }
}

function nomeSeguro(erro) {
  const n = ler(erro, 'name')
  return typeof n === 'string' && /^[\w$.-]{1,40}$/.test(n) ? n : ''
}

function textoDe(v) {
  if (typeof v === 'string') return v
  if (v === null || v === undefined) return ''
  if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'bigint') return String(v)
  return ''
}

// `arquivo.js:linha:coluna` de cada quadro do stack (Chrome "at f (url:1:2)", Firefox/Safari "f@url:1:2").
// Só o nome do arquivo (sem host, sem query): nomes de bundle têm hash de build = identificam a VERSÃO.
export function framesDoStack(stack, max = 3) {
  try {
    if (typeof stack !== 'string' || !stack) return []
    const achados = []
    for (const m of stack.slice(0, 4000).matchAll(/([\w.$-]{1,60}\.(?:m?js|jsx|ts|tsx))(?:\?[^\s:)]{0,80})?:(\d{1,7}):(\d{1,7})/g)) {
      const f = `${m[1]}:${m[2]}:${m[3]}`
      if (!achados.includes(f)) achados.push(f)
      if (achados.length >= max) break
    }
    return achados
  } catch { return [] }
}

/**
 * Descreve o erro sem nunca lançar, sem recursão infinita (cause circular/aninhado) e sem vazar:
 * { nome, mensagem, frames, causas:[{nome, mensagem}], tipo }.  `mensagem` já sai SANITIZADA.
 */
export function descreverErro(erro, { maxMensagem = 160, profundidade = 3 } = {}) {
  const vazio = { tipo: 'nenhum', nome: '', mensagem: '', frames: [], causas: [] }
  try {
    if (erro === undefined || erro === null) return vazio
    if (typeof erro === 'string') {
      return { ...vazio, tipo: 'texto', mensagem: sanitizarTexto(erro, maxMensagem, { citados: true }) }
    }
    if (typeof erro !== 'object' && typeof erro !== 'function') {
      return { ...vazio, tipo: typeof erro, mensagem: sanitizarTexto(String(erro), maxMensagem) }
    }
    if (typeof Event !== 'undefined' && erro instanceof Event) {
      const alvo = ler(erro, 'target')
      const tag = alvo && typeof ler(alvo, 'tagName') === 'string' ? ler(alvo, 'tagName') : ''
      return { ...vazio, tipo: 'evento', nome: `Evento:${String(ler(erro, 'type') || '?').slice(0, 20)}${tag ? `:${String(tag).slice(0, 12)}` : ''}` }
    }
    const nome = nomeSeguro(erro)
    // Erro do motor JS cita só nome de propriedade (sem aspas de valor); o resto vem do servidor/negócio
    const citados = !NOMES_DO_MOTOR.has(nome)
    // Error padrão: message. Erro Supabase/PostgREST (objeto simples): message, senão details/hint/error_description
    const msg = textoDe(ler(erro, 'message')) || textoDe(ler(erro, 'error_description')) || textoDe(ler(erro, 'details')) || textoDe(ler(erro, 'hint')) || textoDe(ler(erro, 'error'))
    const causas = []
    const vistos = new Set([erro])
    let atual = ler(erro, 'cause')
    for (let i = 0; i < profundidade && atual !== undefined && atual !== null; i++) {
      if (typeof atual === 'object' || typeof atual === 'function') {
        if (vistos.has(atual)) { causas.push({ nome: 'ciclo', mensagem: '' }); break }
        vistos.add(atual)
        const m = textoDe(ler(atual, 'message')) || textoDe(ler(atual, 'details')) || textoDe(ler(atual, 'error'))
        causas.push({ nome: nomeSeguro(atual) || 'Objeto', mensagem: sanitizarTexto(m, 80, { citados: !NOMES_DO_MOTOR.has(nomeSeguro(atual)) }) })
        atual = ler(atual, 'cause')
      } else {
        causas.push({ nome: typeof atual === 'string' ? 'Texto' : typeof atual, mensagem: sanitizarTexto(textoDe(atual), 80, { citados: true }) })
        break
      }
    }
    return {
      tipo: 'objeto', nome,
      mensagem: sanitizarTexto(msg, maxMensagem, { citados }),
      frames: framesDoStack(ler(erro, 'stack')),
      causas,
    }
  } catch { return vazio }
}

/**
 * Contexto técnico (cabe nos 200 caracteres da coluna `contexto`, sem mudar a RPC):
 *   "<frase da tela> | Nome: mensagem <- causa: msg <- causa2 [a.js:1:2 < b.js:3:4]"
 * Prioridade quando falta espaço: onde nasceu > nome+mensagem > frase da tela > causas.
 */
export function montarContextoTecnico(frase, d, { max = 200 } = {}) {
  try {
    const f = sanitizarTexto(frase, 50, { citados: true })
    const local = d.frames.length ? ` [${d.frames.slice(0, 2).join(' < ')}]` : ''
    const causa = d.causas.length
      ? ` <- ${d.causas.map((c) => (c.mensagem ? `${c.nome}: ${c.mensagem}` : c.nome)).join(' <- ')}`.slice(0, 60)
      : ''
    const nomeMsg = d.nome && d.mensagem ? `${d.nome}: ${d.mensagem}` : (d.nome || d.mensagem)
    const base = f ? `${f}${nomeMsg ? ' | ' : ''}` : ''
    const corpo = nomeMsg || ''
    const disponivel = max - base.length - local.length
    if (corpo.length + causa.length <= disponivel) return `${base}${corpo}${causa}${local}`
    // sem espaço: some a causa primeiro; depois a mensagem encurta (o local nunca é cortado)
    if (corpo.length <= disponivel) return `${base}${corpo}${local}`
    const n = Math.max(20, disponivel)
    return `${base}${corpo.slice(0, n - 1)}…${local}`.slice(0, max)
  } catch { return sanitizarTexto(frase, max) }
}

// Rota do app: sem query/fragmento; tokens por nome de rota e por forma (o id de pessoa na rota é
// aceito de propósito — é o que permite reproduzir — e o servidor ainda passa a _sem_segredo).
export function sanitizarRota(caminho) {
  try {
    let r = String(caminho || '').replace(/[?#].*$/, '')
    r = r.replace(/^\/(verificar|documento)\/[^/]+/, '/$1/:token')
    r = r.replace(/\/[A-Za-z0-9_-]{32,}(?=\/|$)/g, '/[segredo]').replace(/\/[A-Z0-9]{16,}(?=\/|$)/g, '/[segredo]')
    return r.slice(0, 120)
  } catch { return '' }
}
