// Observabilidade mínima do cliente (fase 8.1, blocker B7).
//
// Até aqui o build de produção rodava com `drop_console: true` e nenhum rastreio: um clube pagante
// ligava dizendo "não consigo lançar pontos" e não havia nada para investigar.
//
// O que torna isto barato de fazer: a fase 7.1 já tinha transformado `avisar.erro` no funil único
// por onde passa TODO erro que chega à pessoa. Instrumentando esse ponto (mais o error boundary e
// os dois handlers globais), cobre-se o produto inteiro sem espalhar try/catch por 35 telas.
//
// O QUE É ENVIADO, e só isto:
//   origem, rota (sem querystring), a frase humana da tela + nome/mensagem/causa/local (arquivo:linha:coluna
//   do stack) do erro JÁ SANITIZADOS por padrão (lib/sanitizarErro.js) nos 200 caracteres do `contexto`,
//   um CÓDIGO técnico curto, um id de correlação aleatório por aba e o agente (com a versão do front).
//
// O QUE NUNCA É ENVIADO:
//   a mensagem CRUA (passa pelo mascaramento: JWT, Bearer, sb_*, ?token=, cookies, e-mail, telefone,
//   CPF, uuid e valores citados somem), token, senha,
//   conteúdo de chat, evidência, foto, nome ou qualquer dado de pessoa. O público é
//   majoritariamente menor de idade — telemetria que grava demais é vazamento esperando acontecer.
//   O `user_id` e o clube são preenchidos pelo SERVIDOR a partir do JWT e do header, nunca pelo
//   cliente: assim ninguém consegue registrar erro em nome de outra pessoa.
import { supabase } from './supabase.js'
import { descreverErro, montarContextoTecnico, sanitizarRota, sanitizarTexto } from './sanitizarErro.js'

// Id de correlação: aleatório, por aba, sem relação com a identidade. Serve para juntar os erros
// de uma mesma sessão de uso ("tentou três vezes seguidas") sem precisar saber quem é.
// sessionStorage e não localStorage: some ao fechar a aba, que é o escopo certo.
function correlacaoDaAba() {
  const CHAVE = 'cq-correlacao'
  try {
    const guardada = sessionStorage.getItem(CHAVE)
    if (guardada) return guardada
    const nova = (crypto.randomUUID?.() || String(Math.random()).slice(2)).replace(/-/g, '').slice(0, 24)
    sessionStorage.setItem(CHAVE, nova)
    return nova
  } catch {
    // aba anônima / storage bloqueado: um id só para esta carga da página já serve
    return (crypto.randomUUID?.() || String(Math.random()).slice(2)).replace(/-/g, '').slice(0, 24)
  }
}
const CORRELACAO = correlacaoDaAba()

// Expõe o id para quem precisa CITAR ("informe o código X ao suporte"). Só isso.
export const idDeCorrelacao = () => CORRELACAO

// Extrai um CÓDIGO curto e sem dado de ninguém a partir do erro. É a peça que decide o que sai
// daqui: nada de texto livre — só código, nome de tipo, status HTTP, rótulo de uma lista fechada ou
// uma impressão digital (hash) da mensagem.
//
// Por que existe tanta regra (investigação de 01/10/2026): 7 de 8 erros do dia chegaram como
// "Desconhecido". Causas: (1) o erro de regra de negócio do servidor (RAISE EXCEPTION) vem com
// SQLSTATE `P0001`, que NENHUM padrão antigo reconhecia (só 2xxxx/4xxxx/5xxxx); (2) `new Error('...')`
// gerado na própria tela tem name 'Error'; (3) rejeições com valor que não é Error (string, objeto,
// Event, undefined) e "Script error." de origem cruzada não têm nem name nem code.
const PADROES = [
  /\b(PGRST\d{3})\b/,          // PostgREST
  /\b(2[0-9A-Z]{4})\b/,        // SQLSTATE (42501 = permissão negada, 23505 = duplicado...)
  /\b(4[0-9A-Z]{4})\b/,
  /\b(5[0-9A-Z]{4})\b/,
]
// SQLSTATE completo: 5 caracteres [0-9A-Z]. Inclui P0001 (RAISE EXCEPTION), 22P02, 23505, 42501, 57014...
const SQLSTATE = /^[0-9A-Z]{5}$/
const PGRST = /^PGRST\d{3}$/

// Rótulos de uma lista FECHADA para mensagens conhecidas e sem dado de pessoa.
const ROTULOS = [
  [/^Script error\.?$/i, 'ScriptErrorCrossOrigin'],
  [/ResizeObserver loop/i, 'ResizeObserver'],
  [/dynamically imported module|module script failed|ChunkLoadError|Loading chunk|CSS chunk|Importing a module script failed|error loading dynamically/i, 'ChunkLoad'],
  [/failed to fetch|network ?error|load failed|network request failed|ERR_INTERNET_DISCONNECTED|ERR_NETWORK/i, 'RedeIndisponivel'],
  [/timed? ?out|timeout/i, 'Timeout'],
  [/aborted|AbortError/i, 'Abortado'],
  [/QuotaExceeded/i, 'ArmazenamentoCheio'],
  [/JWT|refresh token|not authenticated|session (expired|missing)/i, 'SessaoInvalida'],
  [/permission denied|NotAllowedError|SecurityError/i, 'PermissaoNegada'],
  [/Non-Error promise rejection/i, 'RejeicaoNaoError'],
]
// TypeError/ReferenceError do MOTOR JS: o texto cita nome de variável/propriedade, nunca valor. Só
// formas conhecidas passam, e com o identificador limitado — o resto cai no hash.
const MOTOR = [
  [/Cannot read propert(?:y|ies) of (undefined|null) \(reading '([\w$]{1,30})'\)/, (m) => `leitura:${m[1]}.${m[2]}`],
  [/Cannot set propert(?:y|ies) of (undefined|null) \(setting '([\w$]{1,30})'\)/, (m) => `escrita:${m[1]}.${m[2]}`],
  [/(?:^|\s)([\w$.]{1,40}) is not a function/, (m) => `naofuncao:${m[1]}`],
  [/(?:^|\s)([\w$.]{1,40}) is not defined/, (m) => `naodefinido:${m[1]}`],
  [/(?:^|\s)([\w$.]{1,40}) is not iterable/, (m) => `naoiteravel:${m[1]}`],
]

// Impressão digital da mensagem (djb2, 6 hex): agrupa erros iguais e permite conferir contra uma
// mensagem conhecida (quem tem o texto calcula o hash), sem gravar o texto. Dígitos e uuids
// são normalizados antes: "linha 3" e "linha 7" são o mesmo erro.
export function impressaoDaMensagem(texto) {
  const norm = String(texto || '')
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '#')
    .replace(/\d+/g, '#')
    .slice(0, 300)
  let h = 5381
  for (let i = 0; i < norm.length; i++) h = ((h * 33) ^ norm.charCodeAt(i)) >>> 0
  return h.toString(16).padStart(8, '0').slice(0, 6)
}

function rotuloDaMensagem(msg) {
  for (const [re, rotulo] of ROTULOS) if (re.test(msg)) return rotulo
  return ''
}

export function codigoDoErro(erro) {
  // o valor lançado pode ser qualquer coisa (Proxy, getter que explode): telemetria nunca lança
  try { return codigoDoErroBruto(erro) } catch { return 'Desconhecido' }
}

function codigoDoErroBruto(erro) {
  if (erro === undefined || erro === null || erro === '') return 'SemDetalhe'
  // 1) texto puro (ex.: `message` do window.onerror quando não há objeto de erro)
  if (typeof erro === 'string') {
    return rotuloDaMensagem(erro) || `Texto#${impressaoDaMensagem(erro)}`
  }
  // 2) valor que não é objeto (número, boolean, símbolo...): só o TIPO
  if (typeof erro !== 'object' && typeof erro !== 'function') return `Rejeicao:${typeof erro}`
  // 3) Event do DOM (falha de recurso, CloseEvent, ProgressEvent...): só o tipo do evento
  if (typeof Event !== 'undefined' && erro instanceof Event) {
    const alvo = erro.target?.tagName ? `:${String(erro.target.tagName).slice(0, 12)}` : ''
    return `Evento:${String(erro.type || '?').slice(0, 20)}${alvo}`
  }
  // 4) código explícito do servidor (PostgREST / SQLSTATE) ou status HTTP
  const code = typeof erro.code === 'string' ? erro.code.trim() : ''
  if (PGRST.test(code) || SQLSTATE.test(code)) return code
  const status = Number(erro.status ?? erro.statusCode ?? erro.context?.status)
  const http = Number.isInteger(status) && status >= 100 && status <= 599 ? `HTTP${status}` : ''
  // `name` é livre (quem lança escolhe): só entra se tiver a forma de um identificador. Truncar sem validar
  // deixaria o começo de um segredo escapar (achado da auditoria de 02/10).
  const nome = typeof erro.name === 'string' && /^[\w$.-]{1,40}$/.test(erro.name) ? erro.name : ''
  if (http) return nome && nome !== 'Error' ? `${nome}:${http}`.slice(0, 80) : http
  const msg = typeof erro.message === 'string' ? erro.message : ''
  // 5) o que o texto da mensagem entrega por FORMA
  for (const p of PADROES) {
    const m = (code || msg).match(p)
    if (m) return m[1]
  }
  const rotulo = rotuloDaMensagem(msg)
  if (rotulo) return nome && nome !== 'Error' && !rotulo.startsWith(nome) ? `${nome}:${rotulo}`.slice(0, 80) : rotulo
  // 6) erro do motor JS, só em formas conhecidas
  if (nome === 'TypeError' || nome === 'ReferenceError' || nome === 'RangeError') {
    for (const [re, fmt] of MOTOR) {
      const m = msg.match(re)
      if (m) return `${nome}:${fmt(m)}`.slice(0, 80)
    }
    return msg ? `${nome}#${impressaoDaMensagem(msg)}` : nome
  }
  // 7) nome do tipo (NetworkError, StorageApiError...) — nunca a mensagem
  if (nome && nome !== 'Error') return msg ? `${nome}#${impressaoDaMensagem(msg)}`.slice(0, 80) : nome
  // 8) Error genérico (ex.: validação feita pela própria tela): impressão digital, não o texto
  if (msg) return `Erro#${impressaoDaMensagem(msg)}`
  return 'Desconhecido'
}

// Onde o erro nasceu: `arquivo.js:linha:coluna` do primeiro quadro do stack (nomes de bundle têm hash
// de build, o que de quebra identifica a VERSÃO). Sem URL, sem querystring, sem dado de pessoa.
export function localDoErro(erro) {
  let stack = ''
  try { stack = typeof erro?.stack === 'string' ? erro.stack : '' } catch { /* getter que explode */ }
  const m = stack.match(/([\w.-]{1,60}\.(?:m?js|jsx)):(\d+):(\d+)/)
  return m ? `${m[1]}:${m[2]}:${m[3]}` : ''
}

// Versão do front que enviou o erro (data+sha do commit, a mesma do OTA). Vai junto do agente.
function versaoDoFront() {
  try { return typeof __OTA_VERSAO__ === 'string' ? __OTA_VERSAO__.slice(0, 20) : '' } catch { return '' } // eslint-disable-line no-undef
}
export function agenteComVersao(ua = '', versao = versaoDoFront()) {
  const v = versao ? ` v${versao}` : ''
  return `${String(ua || '').slice(0, 120 - v.length)}${v}`
}

// Contexto técnico do registro: frase da tela + Nome: mensagem (sanitizados) + causa + onde nasceu.
// `local` (arquivo:linha:coluna do evento `error` da janela) cobre erro sem stack (script de outra origem).
export function contextoDoErro(erro, contexto, local = '') {
  const d = descreverErro(erro)
  if (local && !d.frames.length) d.frames = [sanitizarTexto(local, 80)]
  return montarContextoTecnico(contexto, d)
}

// A rota sem querystring nem fragmento: `/avaliar/uuid-de-alguem?foo=1` vira `/avaliar/uuid...`.
// O id na rota é aceitável (é o que permite reproduzir); a query não, porque é onde tokens andam.
function rotaAtual() {
  try { return sanitizarRota(window.location.pathname || '') } catch { return '' }
}

let ligado = false
let enviando = 0
const TETO_POR_CARGA = 20 // espelha o teto do servidor: um laço quebrado não vira mil chamadas

// Envia sem nunca atrapalhar (erro com `esperado: true` — validação da própria tela — não é registrado): falha de telemetria é engolida de propósito. O produto não pode
// quebrar porque o registro de erro não foi.
export async function reportarErro(erro, { origem = 'ui', contexto = '', local = '' } = {}) {
  try { if (erro && typeof erro === 'object' && erro.esperado === true) return } catch { /* getter que explode: registra */ } // validação da própria tela: não é falha
  if (enviando >= TETO_POR_CARGA) return
  enviando++
  try {
    const { data: sessao } = await supabase.auth.getSession()
    if (!sessao?.session) return // sem login não há o que correlacionar, e a RPC exigiria auth
    await supabase.rpc('registrar_erro', {
      p_origem: origem,
      p_correlacao: CORRELACAO,
      p_rota: rotaAtual(),
      p_contexto: contextoDoErro(erro, contexto, local),
      p_codigo: codigoDoErro(erro),
      p_agente: agenteComVersao(navigator.userAgent),
    })
  } catch { /* telemetria nunca atrapalha o produto */ }
}

// Abertura lenta (fase 7): `item` vem da fila local de lib/arranque.js ({ codigo, contexto }) — só etapa,
// tempos e flags, NUNCA dado de pessoa. DIFERENTE de reportarErro: aqui a falha é PROPAGADA, para o item
// continuar na fila e ser reenviado na próxima abertura (sem login não há como enviar: fica guardado).
export async function reportarArranque({ codigo, contexto }) {
  const { data: sessao } = await supabase.auth.getSession()
  if (!sessao?.session) throw new Error('sem sessão para enviar')
  const { error } = await supabase.rpc('registrar_erro', {
    p_origem: 'ui',
    p_correlacao: CORRELACAO,
    p_rota: '/abertura',
    p_contexto: String(contexto || '').slice(0, 200),
    p_codigo: String(codigo || '').slice(0, 80),
    p_agente: agenteComVersao(navigator.userAgent),
  })
  if (error) throw error
}

// Handlers globais: pegam o que escapou de todo try/catch. Instalados uma vez só.
export function ligarObservabilidade() {
  if (ligado || typeof window === 'undefined') return
  ligado = true
  window.addEventListener('error', (e) => {
    // sem objeto de erro (script de outra origem, falha de recurso) o `message` é o que sobra; o
    // arquivo:linha:coluna do próprio evento diz onde foi.
    const local = e?.filename ? `${String(e.filename).split('?')[0].split('/').pop().slice(0, 60)}:${e.lineno || 0}:${e.colno || 0}` : ''
    reportarErro(e?.error || e?.message || e, { origem: 'janela', contexto: 'Erro não tratado na tela.', local })
  })
  window.addEventListener('unhandledrejection', (e) => {
    reportarErro(e?.reason, { origem: 'promessa', contexto: 'Operação falhou sem tratamento.' })
  })
}
