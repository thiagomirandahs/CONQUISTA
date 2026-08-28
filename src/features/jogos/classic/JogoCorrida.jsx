import { useState, useEffect, useRef } from 'react'
import { registrarRecorde } from '../../../lib/dados.js'

// ===================== 🏕️ Corrida do Acampamento (SEM FIM) =====================
// Corre e PULA os obstáculos do acampamento (fogueira, tronco, barraca...). Cada
// obstáculo passado = +1. Bateu = fim. Estilo "dinossauro". SEM limite de jogadas
// (não dá +10/+5) — a corrida vira RECORDE da semana; o maior ganha +20 no domingo.
const OBST_CORRIDA = ['🔥', '🪵', '⛺', '🎒', '🪨']

export default function JogoCorrida({ onCancelar }) {
  const canvasRef = useRef(null)
  const jogoRef = useRef(null)      // estado do jogo (fora do React = 60fps fluido)
  const rafRef = useRef(0)
  const faseRef = useRef('pronto')  // espelho de 'fase' pro teclado (listener fixo)
  const [fase, setFase] = useState('pronto') // 'pronto' | 'jogando' | 'fim'
  const [pontos, setPontos] = useState(0)
  const [resultado, setResultado] = useState(null)

  const W = 760, H = 240, CHAO = H - 30, PX = 72

  function novoJogo() {
    return { y: CHAO, vy: 0, obst: [], vel: 4.6, prox: 60, score: 0, morto: false, ultimo: 0, acc: 0 }
  }

  function desenhar(c, j) {
    c.fillStyle = '#eff6ff'; c.fillRect(0, 0, W, H)
    c.strokeStyle = '#94a3b8'; c.lineWidth = 2
    c.beginPath(); c.moveTo(0, CHAO + 6); c.lineTo(W, CHAO + 6); c.stroke()
    c.textAlign = 'center'; c.textBaseline = 'alphabetic'
    c.font = '34px serif'
    for (const o of j.obst) c.fillText(o.tipo, o.x, CHAO)
    c.fillText('🏃', PX, j.y)
    c.fillStyle = '#1e293b'; c.font = 'bold 22px sans-serif'; c.textAlign = 'right'
    c.fillText(String(j.score), W - 14, 32)
  }

  // UM passo fixo de física (1/60s). Fica igual em qualquer tela (60/90/120Hz).
  function atualizar(j) {
    j.vy += 0.75; j.y += j.vy
    if (j.y > CHAO) { j.y = CHAO; j.vy = 0 }
    j.vel = Math.min(11, j.vel + 0.0018)
    j.prox -= j.vel
    if (j.prox <= 0) {
      j.obst.push({ x: W + 24, tipo: OBST_CORRIDA[Math.floor(Math.random() * OBST_CORRIDA.length)], passou: false })
      j.prox = Math.max(j.vel * 34, 96) + Math.random() * 80 // gap escala com a velocidade (sempre dá pra pular)
    }
    for (const o of j.obst) {
      o.x -= j.vel
      if (!o.passou && o.x < PX - 22) { o.passou = true; j.score = Math.min(500, j.score + 1) }
      if (Math.abs(o.x - PX) < 20 && j.y > CHAO - 18) j.morto = true // perto no x E não pulou alto
    }
    j.obst = j.obst.filter((o) => o.x > -40)
  }

  // Loop: acumula o tempo REAL e roda a física em passos fixos de 1/60s — assim
  // o pulo e a velocidade não dependem do FPS do celular (antes 120Hz corria 2x).
  const PASSO_MS = 1000 / 60
  function passo(agora) {
    const j = jogoRef.current, cv = canvasRef.current
    if (!j || !cv) return
    const c = cv.getContext('2d')
    if (!j.ultimo) j.ultimo = agora
    let dt = agora - j.ultimo
    j.ultimo = agora
    if (dt > 100) dt = 100 // aba pausou: não dá salto gigante
    j.acc += dt
    let n = 0
    while (j.acc >= PASSO_MS && n < 6) { atualizar(j); j.acc -= PASSO_MS; n++; if (j.morto) break }
    desenhar(c, j)
    if (j.morto) { terminar(j.score); return }
    rafRef.current = requestAnimationFrame(passo)
  }

  function comecar() {
    jogoRef.current = novoJogo()
    faseRef.current = 'jogando'; setFase('jogando'); setResultado(null)
    cancelAnimationFrame(rafRef.current)
    rafRef.current = requestAnimationFrame(passo)
  }
  function pular() {
    const j = jogoRef.current
    if (j && !j.morto && j.y >= CHAO - 1) j.vy = -13.2 // só pula quando está no chão
  }
  async function terminar(score) {
    cancelAnimationFrame(rafRef.current)
    faseRef.current = 'fim'; setFase('fim'); setPontos(score)
    try { setResultado(await registrarRecorde('corrida', score)) }
    catch { setResultado('erro') }
  }
  function aoTocar() {
    if (faseRef.current === 'pronto') comecar()
    else if (faseRef.current === 'jogando') pular()
  }

  // teclado (PC): espaço / seta pra cima
  useEffect(() => {
    const tecla = (e) => { if (e.code === 'Space' || e.code === 'ArrowUp') { e.preventDefault(); aoTocar() } }
    window.addEventListener('keydown', tecla)
    return () => { window.removeEventListener('keydown', tecla); cancelAnimationFrame(rafRef.current) }
  }, []) // eslint-disable-line
  // desenha a tela inicial parada
  useEffect(() => {
    const cv = canvasRef.current
    if (cv && fase === 'pronto') desenhar(cv.getContext('2d'), novoJogo())
  }, [fase]) // eslint-disable-line

  return (
    <div className="bg-surface rounded-3xl p-4 sm:p-5 shadow-md text-center">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-extrabold text-muted">🏕️ Corrida do Acampamento</span>
        <button onClick={onCancelar} className="text-xs text-faint p-3 -m-3">Sair</button>
      </div>

      <div className="relative select-none">
        <canvas ref={canvasRef} width={W} height={H}
          onPointerDown={(e) => { e.preventDefault(); aoTocar() }}
          className="w-full rounded-2xl border border-line bg-sky-50"
          style={{ touchAction: 'none', aspectRatio: `${W} / ${H}` }} />

        {fase === 'pronto' && (
          <button onClick={aoTocar} className="absolute inset-0 grid place-items-center bg-surface/60 rounded-2xl">
            <span className="bg-brand text-white font-extrabold rounded-xl px-5 py-2.5 shadow">▶️ Toque pra correr</span>
          </button>
        )}

        {fase === 'fim' && (
          <div className="absolute inset-0 grid place-items-center bg-surface/85 rounded-2xl p-4">
            <div>
              <div className="text-4xl mb-1">🏁</div>
              <p className="font-extrabold text-ink text-lg">Você passou {pontos} obstáculo{pontos === 1 ? '' : 's'}!</p>
              {resultado === 'erro' ? (
                <p className="text-xs text-faint mt-1">Não deu pra salvar o recorde (sem internet?).</p>
              ) : resultado?.fora ? (
                <p className="text-sm font-bold text-muted mt-1">Boa! 🙂 (a liderança joga, mas fica fora do ranking)</p>
              ) : resultado ? (
                <p className={`text-sm font-bold mt-1 ${resultado.melhorou ? 'text-green-600' : 'text-muted'}`}>
                  {resultado.melhorou ? '🚀 NOVO recorde seu da semana!' : `Seu recorde da semana: ${resultado.recorde}`}
                </p>
              ) : (
                <p className="text-xs text-faint mt-1">Salvando recorde…</p>
              )}
              <div className="flex gap-2 mt-4 max-w-[280px] mx-auto">
                <button onClick={onCancelar} className="flex-1 rounded-xl bg-surface2 text-ink font-semibold py-2.5">Sair</button>
                <button onClick={comecar} className="flex-1 rounded-xl bg-brand text-white font-extrabold py-2.5">🔁 De novo</button>
              </div>
            </div>
          </div>
        )}
      </div>
      <p className="text-[11px] text-faint mt-3">Toque (ou espaço) pra pular a fogueira e os obstáculos. Sem limite — cada corrida pode virar seu recorde da semana. 🏆</p>
    </div>
  )
}
