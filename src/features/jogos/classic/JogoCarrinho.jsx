import { useState, useEffect, useRef } from 'react'

// ===================== 🚗 Carrinho na Estrada =====================
// Arraste o dedo: o carrinho acompanha. Pegue os itens BONS e desvie dos
// perigos. 3 vidas; bater num perigo tira 1. Passo de tempo FIXO (igual em
// 60/90/120Hz). Dá estrelas como os jogos normais (1x por dia).
const CARRO_BONS = ['⭐', '⛽', '🍎', '💧', '🪙']
const CARRO_RUINS = ['🪨', '🚧', '🛢️', '🐄', '🌵']

export default function JogoCarrinho({ onTerminar, onCancelar }) {
  const canvasRef = useRef(null)
  const jogoRef = useRef(null)
  const rafRef = useRef(0)
  const faseRef = useRef('pronto')
  const pressRef = useRef(false)
  const [fase, setFase] = useState('pronto') // 'pronto' | 'jogando' | 'fim'
  const [placar, setPlacar] = useState(0)

  const W = 360, H = 520, CARRO_Y = H - 74
  const estrelasDe = (s) => (s >= 25 ? 3 : s >= 12 ? 2 : 1)

  function novoJogo() {
    return { carX: W / 2, itens: [], vel: 3.0, prox: 36, score: 0, vidas: 3, morto: false, faixa: 0, flash: 0, ultimo: 0, acc: 0 }
  }

  function desenhar(c, j) {
    c.fillStyle = '#334155'; c.fillRect(0, 0, W, H) // asfalto
    c.fillStyle = '#e2e8f0' // faixas divisórias rolando
    for (const fx of [W / 3, (2 * W) / 3]) {
      for (let y = -40 + (j.faixa % 60); y < H; y += 60) c.fillRect(fx - 3, y, 6, 34)
    }
    c.fillStyle = '#22c55e'; c.fillRect(0, 0, 8, H); c.fillRect(W - 8, 0, 8, H) // acostamento
    c.textAlign = 'center'; c.textBaseline = 'middle'
    c.font = '30px serif'
    for (const it of j.itens) c.fillText(it.tipo, it.x, it.y)
    c.font = '46px serif'; c.fillText('🚗', j.carX, CARRO_Y)
    // HUD
    c.textAlign = 'left'; c.font = 'bold 18px sans-serif'
    c.fillText('❤️'.repeat(Math.max(0, j.vidas)), 12, 24)
    c.textAlign = 'right'; c.fillStyle = '#fff'; c.font = 'bold 22px sans-serif'
    c.fillText('⭐ ' + j.score, W - 12, 26)
    if (j.flash > 0) { c.fillStyle = `rgba(239,68,68,${Math.min(0.5, j.flash / 12)})`; c.fillRect(0, 0, W, H) }
  }

  function atualizar(j) {
    j.faixa += j.vel
    j.vel = Math.min(8, j.vel + 0.0016) // acelera devagar
    if (j.flash > 0) j.flash--
    j.prox -= j.vel
    if (j.prox <= 0) {
      const bom = Math.random() < 0.58
      const arr = bom ? CARRO_BONS : CARRO_RUINS
      j.itens.push({ x: 30 + Math.random() * (W - 60), y: -20, tipo: arr[Math.floor(Math.random() * arr.length)], bom, pego: false })
      j.prox = Math.max(72 - j.vel * 3, 34) + Math.random() * 44
    }
    for (const it of j.itens) {
      it.y += j.vel
      if (!it.pego && Math.abs(it.x - j.carX) < 34 && Math.abs(it.y - CARRO_Y) < 34) {
        it.pego = true
        if (it.bom) j.score = Math.min(999, j.score + 1)
        else { j.vidas -= 1; j.flash = 12; if (j.vidas <= 0) j.morto = true }
      }
    }
    j.itens = j.itens.filter((it) => it.y < H + 30 && !it.pego)
  }

  const PASSO_MS = 1000 / 60
  function passo(agora) {
    const j = jogoRef.current, cv = canvasRef.current
    if (!j || !cv) return
    const c = cv.getContext('2d')
    if (!j.ultimo) j.ultimo = agora
    let dt = agora - j.ultimo; j.ultimo = agora
    if (dt > 100) dt = 100
    j.acc += dt
    let n = 0
    while (j.acc >= PASSO_MS && n < 6) { atualizar(j); j.acc -= PASSO_MS; n++; if (j.morto) break }
    desenhar(c, j)
    if (j.morto) { terminar(j.score); return }
    rafRef.current = requestAnimationFrame(passo)
  }

  function moverPara(e) {
    const j = jogoRef.current, cv = canvasRef.current
    if (!j || !cv) return
    const r = cv.getBoundingClientRect()
    const x = (e.clientX - r.left - cv.clientLeft) * (W / cv.clientWidth) // exato em qualquer tamanho/zoom
    j.carX = Math.max(24, Math.min(W - 24, x))
  }
  function comecar() {
    jogoRef.current = novoJogo()
    faseRef.current = 'jogando'; setFase('jogando'); setPlacar(0)
    cancelAnimationFrame(rafRef.current)
    rafRef.current = requestAnimationFrame(passo)
  }
  async function terminar(score) {
    cancelAnimationFrame(rafRef.current)
    faseRef.current = 'fim'; setFase('fim'); setPlacar(score)
  }

  // teclado (PC): setas movem, espaço começa
  useEffect(() => {
    const tecla = (e) => {
      const j = jogoRef.current
      if ((e.code === 'Space' || e.code === 'ArrowUp') && faseRef.current === 'pronto') { e.preventDefault(); comecar() }
      else if (j && faseRef.current === 'jogando') {
        if (e.code === 'ArrowLeft') j.carX = Math.max(24, j.carX - 30)
        if (e.code === 'ArrowRight') j.carX = Math.min(W - 24, j.carX + 30)
      }
    }
    window.addEventListener('keydown', tecla)
    return () => { window.removeEventListener('keydown', tecla); cancelAnimationFrame(rafRef.current) }
  }, []) // eslint-disable-line
  useEffect(() => {
    const cv = canvasRef.current
    if (cv && fase === 'pronto') desenhar(cv.getContext('2d'), novoJogo())
  }, [fase]) // eslint-disable-line

  return (
    <div className="bg-surface rounded-3xl p-4 sm:p-5 shadow-md text-center">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-extrabold text-muted">🚗 Carrinho na Estrada</span>
        <button onClick={onCancelar} className="text-xs text-faint p-3 -m-3">Sair</button>
      </div>

      <div className="relative select-none mx-auto" style={{ maxWidth: 360 }}>
        <canvas ref={canvasRef} width={W} height={H}
          onPointerDown={(e) => { e.preventDefault(); e.currentTarget.setPointerCapture?.(e.pointerId); if (faseRef.current === 'pronto') comecar(); pressRef.current = true; moverPara(e) }}
          onPointerMove={(e) => { if (pressRef.current) moverPara(e) }}
          onPointerUp={() => { pressRef.current = false }}
          onPointerCancel={() => { pressRef.current = false }}
          className="w-full rounded-2xl bg-slate-700"
          style={{ touchAction: 'none', aspectRatio: `${W} / ${H}` }} />

        {fase === 'pronto' && (
          <button onClick={comecar} className="absolute inset-0 grid place-items-center bg-black/30 rounded-2xl">
            <span className="bg-brand text-white font-extrabold rounded-xl px-5 py-2.5 shadow">▶️ Toque e arraste pra jogar</span>
          </button>
        )}

        {fase === 'fim' && (
          <div className="absolute inset-0 grid place-items-center bg-surface/90 rounded-2xl p-4">
            <div>
              <div className="text-4xl mb-1">🏁</div>
              <p className="font-extrabold text-ink text-lg">Você pegou {placar} {placar === 1 ? 'item' : 'itens'}!</p>
              <p className="text-sm font-bold text-gold mt-1">{'⭐'.repeat(estrelasDe(placar))}</p>
              <div className="flex gap-2 mt-4 max-w-[280px] mx-auto">
                <button onClick={onCancelar} className="flex-1 rounded-xl bg-surface2 text-ink font-semibold py-2.5">Sair</button>
                <button onClick={() => onTerminar(estrelasDe(placar))} className="flex-1 rounded-xl bg-brand text-white font-extrabold py-2.5">Concluir 🎉</button>
              </div>
            </div>
          </div>
        )}
      </div>
      <p className="text-[11px] text-faint mt-3">Arraste o dedo pra guiar o carrinho. Pegue ⭐⛽🍎 e desvie de 🪨🚧🐄. 3 vidas!</p>
    </div>
  )
}
