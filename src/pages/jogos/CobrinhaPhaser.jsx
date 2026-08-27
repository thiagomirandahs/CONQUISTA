// ===================== 🐍 Cobrinha — versão PHASER (motor 2D) =====================
// Mesma regra da Cobrinha antiga (atravessa as paredes, morre só em si mesma,
// +1 por maçã, estrelas: 15→3, 8→2, senão 1), mas com visual neon, MOVIMENTO
// LISO (posições interpoladas entre os passos), partículas ao comer e tremida
// de câmera ao bater. Controles: arrastar (swipe), setas/WASD e um direcional.
// Mesmo contrato do jogo antigo: recebe { onTerminar, onCancelar }. Fica num
// arquivo próprio, carregado sob demanda (lazy) — o Phaser só entra no bundle
// de quem abre um jogo do motor.
import { useEffect, useRef, useState } from 'react'
import Phaser from 'phaser'

const N = 12, CELL = 38, PAD = 14
const W = N * CELL + PAD * 2, H = W
const STEP = 210 // ms por passo (o "liso" vem da interpolação, não do passo)

class CobraScene extends Phaser.Scene {
  constructor() { super('cobra') }

  create() {
    this.estado = 'pronto' // 'pronto' | 'jogando' | 'fim'
    this.criarTexturas()

    this.add.rectangle(W / 2, H / 2, W, H, 0x04220f)
    const dots = this.add.graphics(); dots.fillStyle(0xffffff, 0.05)
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) dots.fillCircle(PAD + (x + 0.5) * CELL, PAD + (y + 0.5) * CELL, 1.5)

    // comida (maçã com brilho pulsante)
    this.foodGlow = this.add.circle(0, 0, 17, 0xff5d5d, 0.28)
    this.foodTxt = this.add.text(0, 0, '🍎', { fontSize: '26px' }).setOrigin(0.5)
    this.food = this.add.container(0, 0, [this.foodGlow, this.foodTxt])
    this.tweens.add({ targets: this.food, scale: { from: 0.9, to: 1.12 }, yoyo: true, repeat: -1, duration: 600, ease: 'Sine.inOut' })

    this.gSnake = this.add.graphics()
    try {
      this.sparks = this.add.particles(0, 0, 'spark', {
        lifespan: 520, speed: { min: 60, max: 190 }, scale: { start: 0.6, end: 0 },
        alpha: { start: 1, end: 0 }, tint: [0xff5d5d, 0xffd166, 0x84cc16], emitting: false,
      })
    } catch { this.sparks = null }

    // teclado
    this.input.keyboard?.on('keydown', (e) => {
      const m = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0], KeyW: [0, -1], KeyS: [0, 1], KeyA: [-1, 0], KeyD: [1, 0] }[e.code]
      if (m) { e.preventDefault?.(); this.virar(m[0], m[1]) }
    })
    // arrastar (swipe)
    this.input.on('pointerdown', (p) => { this._sw = { x: p.x, y: p.y } })
    this.input.on('pointerup', (p) => {
      if (!this._sw) return
      const dx = p.x - this._sw.x, dy = p.y - this._sw.y
      if (Math.max(Math.abs(dx), Math.abs(dy)) >= 16) {
        if (Math.abs(dx) > Math.abs(dy)) this.virar(dx > 0 ? 1 : -1, 0)
        else this.virar(0, dy > 0 ? 1 : -1)
      }
      this._sw = null
    })

    this.game.events.on('cobra:start', this.iniciar, this)
    this.game.events.on('cobra:virar', (d) => this.virar(d.x, d.y), this)

    this.resetVars()
    this.drawSnake()
  }

  criarTexturas() {
    if (this.textures.exists('spark')) return
    const g = this.add.graphics()
    g.fillStyle(0xffffff, 1); g.fillCircle(6, 6, 6); g.generateTexture('spark', 12, 12); g.destroy()
  }

  resetVars() {
    this.corpo = [{ x: 6, y: 6 }]
    this.corpoAnt = [{ x: 6, y: 6 }]
    this.dir = { x: 0, y: -1 }; this.dirProx = { x: 0, y: -1 }
    this.comida = { x: 3, y: 3 }; this.pontos = 0; this.acc = 0
    this.setFoodPos()
  }
  iniciar() { this.resetVars(); this.estado = 'jogando' }

  virar(x, y) {
    if (this.estado !== 'jogando') return
    if (this.dir.x === -x && this.dir.y === -y) return // não volta em cima de si
    if (this.dir.x === x && this.dir.y === y) return
    this.dirProx = { x, y }
  }
  novaComida() {
    const livres = []
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      if (!this.corpo.some((s) => s.x === x && s.y === y)) livres.push({ x, y })
    }
    return livres.length ? livres[Math.floor(Math.random() * livres.length)] : this.comida
  }
  setFoodPos() { this.food.setPosition(PAD + (this.comida.x + 0.5) * CELL, PAD + (this.comida.y + 0.5) * CELL) }

  step() {
    this.dir = this.dirProx
    const cab = { x: (this.corpo[0].x + this.dir.x + N) % N, y: (this.corpo[0].y + this.dir.y + N) % N }
    const comeu = cab.x === this.comida.x && cab.y === this.comida.y
    const risco = comeu ? this.corpo : this.corpo.slice(0, -1)
    if (risco.some((s) => s.x === cab.x && s.y === cab.y)) { this.morrer(); return }

    this.corpoAnt = this.corpo.map((s) => ({ ...s }))
    const novo = [cab, ...this.corpo]
    if (!comeu) novo.pop()
    this.corpo = novo

    if (comeu) {
      this.pontos++
      this.comida = this.novaComida(); this.setFoodPos()
      this.game.events.emit('cobra:pontos', this.pontos)
      try { this.sparks?.explode(14, this.food.x, this.food.y) } catch { /* ok */ }
      this.tweens.add({ targets: this.food, scale: 1.5, yoyo: true, duration: 130 })
    }
  }
  morrer() {
    this.estado = 'fim'
    this.cameras.main.shake(240, 0.013)
    this.cameras.main.flash(150, 255, 80, 80)
    this.game.events.emit('cobra:fim', this.pontos)
  }

  drawSnake() {
    const g = this.gSnake; g.clear()
    const alpha = this.estado === 'jogando' ? Math.min(1, this.acc / STEP) : 0
    const morto = this.estado === 'fim'
    for (let i = this.corpo.length - 1; i >= 0; i--) {
      const to = this.corpo[i]
      let from = this.corpoAnt[i] || to
      if (Math.abs(to.x - from.x) > 1 || Math.abs(to.y - from.y) > 1) from = to // atravessou a parede → não desliza
      const gx = from.x + (to.x - from.x) * alpha
      const gy = from.y + (to.y - from.y) * alpha
      const cx = PAD + (gx + 0.5) * CELL, cy = PAD + (gy + 0.5) * CELL
      const cor = morto ? 0xef4444 : (i === 0 ? 0xbef264 : 0x84cc16)
      g.fillStyle(morto ? 0xef4444 : 0xa3e635, 0.22); g.fillRoundedRect(cx - CELL / 2, cy - CELL / 2, CELL, CELL, 10)
      const s = CELL - 6; g.fillStyle(cor, 1); g.fillRoundedRect(cx - s / 2, cy - s / 2, s, s, 8)
      if (i === 0) {
        const ex = this.dir.x, ey = this.dir.y, px = -ey, py = ex
        g.fillStyle(0x14532d, 1)
        g.fillCircle(cx + ex * 4 + px * 5, cy + ey * 4 + py * 5, 2.6)
        g.fillCircle(cx + ex * 4 - px * 5, cy + ey * 4 - py * 5, 2.6)
      }
    }
  }

  update(time, delta) {
    if (this.estado === 'jogando') {
      this.acc += delta
      let n = 0
      while (this.acc >= STEP && n < 4) { this.acc -= STEP; this.step(); n++; if (this.estado !== 'jogando') break }
    }
    this.drawSnake()
  }
}

export default function CobrinhaPhaser({ onTerminar, onCancelar }) {
  const hostRef = useRef(null)
  const gameRef = useRef(null)
  const termRef = useRef(onTerminar); termRef.current = onTerminar
  const [fase, setFase] = useState('pronto') // pronto | jogando | fim
  const [pontos, setPontos] = useState(0)

  useEffect(() => {
    const game = new Phaser.Game({
      type: Phaser.AUTO, parent: hostRef.current, width: W, height: H,
      backgroundColor: '#04220f', banner: false, fps: { target: 60 },
      scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH, width: W, height: H },
      scene: CobraScene,
    })
    gameRef.current = game
    const aoPontos = (n) => setPontos(n)
    const aoFim = (n) => { setPontos(n); setFase('fim'); setTimeout(() => termRef.current(n >= 15 ? 3 : n >= 8 ? 2 : 1), 1100) }
    game.events.on('cobra:pontos', aoPontos)
    game.events.on('cobra:fim', aoFim)
    return () => { game.events.off('cobra:pontos', aoPontos); game.events.off('cobra:fim', aoFim); game.destroy(true) }
  }, [])

  function iniciar() { setFase('jogando'); setPontos(0); gameRef.current?.events.emit('cobra:start') }
  const virar = (x, y) => gameRef.current?.events.emit('cobra:virar', { x, y })

  return (
    <div className="bg-surface rounded-3xl p-4 sm:p-5 shadow-md text-center">
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-extrabold text-green-600">🍎 {pontos}</span>
        <button onClick={onCancelar} className="text-xs text-faint p-3 -m-3">Cancelar</button>
      </div>

      <div className="relative select-none mx-auto max-w-[340px]">
        <div ref={hostRef} className="w-full rounded-2xl overflow-hidden border border-line"
          style={{ aspectRatio: '1 / 1', touchAction: 'none' }} />

        {fase === 'pronto' && (
          <button onClick={iniciar} className="absolute inset-0 grid place-items-center bg-emerald-950/50 rounded-2xl">
            <span className="bg-brand text-white font-extrabold rounded-xl px-5 py-2.5 shadow-glow">▶️ Toque pra começar</span>
          </button>
        )}
        {fase === 'fim' && (
          <div className="absolute inset-0 grid place-items-center bg-emerald-950/80 rounded-2xl">
            <div>
              <div className="text-5xl mb-1">🐍</div>
              <p className="font-extrabold text-white">Fim! Você comeu {pontos}.</p>
            </div>
          </div>
        )}
      </div>

      {/* Direcional (além do arrastar e das setas) */}
      <div className="grid grid-cols-3 gap-2 max-w-[220px] mx-auto mt-3 select-none">
        <div />
        <button onClick={() => virar(0, -1)} className="rounded-2xl bg-surface2 active:bg-brand active:text-white py-3.5 text-2xl font-bold shadow-sm">↑</button>
        <div />
        <button onClick={() => virar(-1, 0)} className="rounded-2xl bg-surface2 active:bg-brand active:text-white py-3.5 text-2xl font-bold shadow-sm">←</button>
        <button onClick={() => virar(0, 1)} className="rounded-2xl bg-surface2 active:bg-brand active:text-white py-3.5 text-2xl font-bold shadow-sm">↓</button>
        <button onClick={() => virar(1, 0)} className="rounded-2xl bg-surface2 active:bg-brand active:text-white py-3.5 text-2xl font-bold shadow-sm">→</button>
      </div>

      <p className="text-[11px] text-faint mt-3">Arraste na tela (ou setas / direcional). Atravessa as paredes — só não bata em você mesmo! 🐍</p>
    </div>
  )
}
