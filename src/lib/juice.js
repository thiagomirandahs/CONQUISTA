// Feedback sensorial compartilhado pelos jogos e telas de comemoração:
// som (WebAudio, sem arquivo de áudio — funciona offline no PWA), vibração
// e confete escalonado pelo desempenho. Tudo respeita o mudo (localStorage)
// e falha em silêncio onde o aparelho não suporta.
import confetti from 'canvas-confetti'

const CORES_FESTA = ['#1e3a8a', '#f5c518', '#ffffff', '#10b981', '#d97706']
const CHAVE_MUDO = 'juiceOff'

let ctx = null
function audioCtx() {
  if (typeof window === 'undefined') return null
  const AC = window.AudioContext || window.webkitAudioContext
  if (!AC) return null
  if (!ctx) ctx = new AC()
  return ctx
}

export function somLigado() {
  if (typeof localStorage === 'undefined') return true
  return localStorage.getItem(CHAVE_MUDO) !== '1'
}

export function alternarSom() {
  const ligado = somLigado()
  try { localStorage.setItem(CHAVE_MUDO, ligado ? '1' : '0') } catch { /* sem storage */ }
  return !ligado
}

function tom({ freq = 660, duracao = 0.09, tipo = 'sine', volume = 0.16, atraso = 0 }) {
  if (!somLigado()) return
  const c = audioCtx()
  if (!c) return
  try {
    if (c.state === 'suspended') c.resume()
    const osc = c.createOscillator()
    const gain = c.createGain()
    osc.type = tipo
    osc.frequency.value = freq
    const inicio = c.currentTime + atraso
    gain.gain.setValueAtTime(0, inicio)
    gain.gain.linearRampToValueAtTime(volume, inicio + 0.012)
    gain.gain.exponentialRampToValueAtTime(0.0001, inicio + duracao)
    osc.connect(gain).connect(c.destination)
    osc.start(inicio)
    osc.stop(inicio + duracao + 0.02)
  } catch { /* autoplay bloqueado ou sem suporte — segue sem som */ }
}

export function vibrar(padrao) {
  if (!somLigado()) return
  try { navigator.vibrate?.(padrao) } catch { /* iOS ignora sozinho */ }
}

// Confete escalonado: 1⭐ discreto, 3⭐ com uma 2ª rajada.
export function festa(estrelas = 3) {
  const n = Math.max(1, Math.min(3, Math.round(estrelas) || 3))
  const conf = { 1: [40, 55], 2: [90, 70], 3: [160, 90] }[n]
  confetti({ particleCount: conf[0], spread: conf[1], origin: { y: 0.4 }, colors: CORES_FESTA })
  if (n === 3) {
    setTimeout(() => confetti({ particleCount: 80, spread: 100, origin: { y: 0.3 }, colors: CORES_FESTA }), 200)
  }
}

// Acerto simples (quiz). combo = acertos seguidos, sobe o tom pra dar sensação de embalo.
export function acerto(combo = 0) {
  tom({ freq: 660 + Math.min(combo, 8) * 40, duracao: 0.09 })
  vibrar(12)
}

export function erro() {
  tom({ freq: 160, duracao: 0.14, tipo: 'square', volume: 0.12 })
  vibrar([30, 25, 30])
}

// Fim de jogo (vence a rodada): confete + arpejo animado pelas estrelas + vibração.
export function vitoria(estrelas = 3) {
  const n = Math.max(1, Math.min(3, Math.round(estrelas) || 1))
  festa(n)
  const notas = [523, 659, 784, 1047] // dó, mi, sol, dó agudo
  const tocar = n === 1 ? 2 : n === 2 ? 3 : 4
  notas.slice(0, tocar).forEach((freq, i) => tom({ freq, duracao: 0.15, tipo: 'triangle', atraso: i * 0.09 }))
  const padroes = { 1: [15], 2: [15, 30, 15], 3: [15, 40, 15, 40, 60] }
  vibrar(padroes[n])
}

export function colisao() {
  tom({ freq: 110, duracao: 0.18, tipo: 'sawtooth', volume: 0.14 })
  vibrar([40, 30, 40])
}
