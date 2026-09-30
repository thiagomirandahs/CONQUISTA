// Adaptador PURO do player do YouTube por postMessage (sem carregar script externo: a CSP só libera o
// iframe do youtube-nocookie). Só conversa com o iframe que NÓS montamos e só aceita mensagem que vem
// dele (origem + source). Ouvir até o fim nunca aprova nada: isto só move a barra de progresso.

export const ORIGEM_YT = 'https://www.youtube-nocookie.com'
export const VELOCIDADES = [0.75, 1, 1.25, 1.5, 2]
export const INTERVALO_SALVAR_MS = 15000

export function urlDoPlayerComApi(videoId, origem, { autoplay = true } = {}) {
  const q = new URLSearchParams({
    enablejsapi: '1', origin: origem || '', rel: '0', modestbranding: '1', playsinline: '1',
    ...(autoplay ? { autoplay: '1' } : {}),
  })
  return `${ORIGEM_YT}/embed/${encodeURIComponent(videoId)}?${q.toString()}`
}

export const montarComando = (func, args = []) => JSON.stringify({ event: 'command', func, args })

export function enviarComando(iframe, func, args = []) {
  const alvo = iframe?.contentWindow
  if (!alvo) return false
  try { alvo.postMessage(montarComando(func, args), ORIGEM_YT); return true } catch { return false }
}

// "1:05" / "1:02:03". Valores inválidos viram "0:00".
export function formatarTempo(seg) {
  const t = Math.max(0, Math.floor(Number(seg) || 0))
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60
  const ss = String(s).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}

// Texto falado para leitor de tela: "1 minuto e 20 de 40 minutos".
export function tempoPorExtenso(seg) {
  const t = Math.max(0, Math.floor(Number(seg) || 0))
  const m = Math.floor(t / 60), s = t % 60
  const min = `${m} ${m === 1 ? 'minuto' : 'minutos'}`
  return s ? `${min} e ${s}` : min
}
export const valorFalado = (atual, total) => `${tempoPorExtenso(atual)} de ${tempoPorExtenso(total)}`

function lerMensagem(data) {
  if (data && typeof data === 'object') return data
  try { const o = JSON.parse(data); return o && typeof o === 'object' ? o : null } catch { return null }
}

// Cria a ponte. Nada roda até `iniciar()`. Devolve comandos prontos.
export function criarAdaptador(iframe, { aoPronto, aoInfo, aoTerminar, janela = globalThis.window, intervaloHandshake = 500 } = {}) {
  let timer = null, ouviu = false, pronto = false, fim = false
  const cmd = (f, a) => enviarComando(iframe, f, a)
  const handshake = () => {
    const alvo = iframe?.contentWindow
    if (!alvo) return
    try { alvo.postMessage(JSON.stringify({ event: 'listening', id: 1, channel: 'widget' }), ORIGEM_YT) } catch { /* iframe sumiu */ }
  }
  function marcarOuviu() { if (!ouviu) { ouviu = true; if (timer) { clearInterval(timer); timer = null } } }
  function tratar(info) {
    aoInfo?.({
      currentTime: Number.isFinite(info.currentTime) ? info.currentTime : undefined,
      duration: Number.isFinite(info.duration) ? info.duration : undefined,
      playerState: info.playerState, playbackRate: info.playbackRate,
    })
    if (info.playerState === 0 && !fim) { fim = true; aoTerminar?.() }
    if (info.playerState !== undefined && info.playerState !== 0) fim = false
  }
  function aoMensagem(ev) {
    if (ev.origin !== ORIGEM_YT || !iframe || ev.source !== iframe.contentWindow) return
    const m = lerMensagem(ev.data)
    if (!m) return
    if (m.event === 'onReady') { marcarOuviu(); if (!pronto) { pronto = true; aoPronto?.() } return }
    if (m.event === 'onStateChange' && typeof m.info === 'number') { marcarOuviu(); tratar({ playerState: m.info }); return }
    if (m.event === 'infoDelivery' && m.info && typeof m.info === 'object') {
      marcarOuviu()
      if (!pronto) { pronto = true; aoPronto?.() }
      tratar(m.info)
    }
  }
  return {
    iniciar() {
      janela?.addEventListener?.('message', aoMensagem)
      handshake()
      timer = setInterval(handshake, intervaloHandshake)
    },
    parar() {
      if (timer) { clearInterval(timer); timer = null }
      janela?.removeEventListener?.('message', aoMensagem)
    },
    tocar: () => cmd('playVideo'),
    pausar: () => cmd('pauseVideo'),
    buscar: (seg) => cmd('seekTo', [Math.max(0, Number(seg) || 0), true]),
    velocidade: (v) => cmd('setPlaybackRate', [v]),
  }
}

// Salva no máximo a cada `intervalo` ms. `agora()` força (pausar/terminar/sair da tela).
export function limitarSalvamento(salvar, intervalo = INTERVALO_SALVAR_MS, relogio = () => Date.now()) {
  let ultimo = -Infinity, pendente = null
  const f = (dados) => {
    pendente = dados
    if (relogio() - ultimo >= intervalo) { ultimo = relogio(); pendente = null; return salvar(dados) }
    return undefined
  }
  f.agora = (dados) => {
    const d = dados ?? pendente
    if (d == null) return undefined
    ultimo = relogio(); pendente = null
    return salvar(d)
  }
  f.pendente = () => pendente
  return f
}

// Cópia local (por usuário + material): não perde a posição sem rede. Só conveniência.
const chaveLocal = (userId, materialId) => `leitura:${userId || 'anon'}:${materialId}`
export function lerProgressoLocal(userId, materialId) {
  try {
    const p = JSON.parse(localStorage.getItem(chaveLocal(userId, materialId)) || 'null')
    if (!p || typeof p !== 'object') return null
    return {
      capitulo: Number(p.capitulo) || 1, posicao_seg: Number(p.posicao_seg) || 0, duracao_seg: Number(p.duracao_seg) || null,
      concluido: !!p.concluido, ouvidos: Array.isArray(p.ouvidos) ? p.ouvidos.map(Number) : [], em: Number(p.em) || 0,
    }
  } catch { return null }
}
export function salvarProgressoLocal(userId, materialId, p) {
  try { localStorage.setItem(chaveLocal(userId, materialId), JSON.stringify({ ...p, em: Date.now() })) } catch { /* modo privado */ }
}
