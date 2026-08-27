// ===================== 🚗 Carrinho na Estrada — versão PHASER (motor 2D) =====================
// Mesma regra da versão antiga (arraste o dedo, pegue os itens bons e desvie
// dos perigos, 3 vidas, estrelas: 25→3 / 12→2 / senão 1), mas com carro
// desenhado por código, estrada rolando, faíscas ao pegar item bom e
// fumaça + tremida de câmera ao bater. Portrait 360×520 (feito pra celular).
// Contrato igual ao antigo: { onTerminar, onCancelar }. Lazy (Phaser sob demanda).
import { useEffect, useRef, useState } from 'react'
import Phaser from 'phaser'

const W = 360, H = 520, CARRO_Y = H - 78
const BONS = ['⭐', '⛽', '🍎', '💧', '🪙']
const RUINS = ['🪨', '🚧', '🛢️', '🐄', '🌵']

class CarroScene extends Phaser.Scene {
  constructor() { super('carro') }

  create() {
    this.estado = 'pronto'
    this.criarTexturas()

    this.add.rectangle(W / 2, H / 2, W, H, 0x334155) // asfalto
    this.add.rectangle(4, H / 2, 8, H, 0x22c55e)     // acostamentos
    this.add.rectangle(W - 4, H / 2, 8, H, 0x22c55e)
    this.faixaA = this.add.tileSprite(W / 3, H / 2, 6, H, 'faixa')
    this.faixaB = this.add.tileSprite((2 * W) / 3, H / 2, 6, H, 'faixa')

    try {
      this.spark = this.add.particles(0, 0, 'spark', { lifespan: 480, speed: { min: 60, max: 180 }, scale: { start: 0.6, end: 0 }, alpha: { start: 1, end: 0 }, tint: [0xffd166, 0xfff3b0, 0x84cc16], emitting: false }).setDepth(15)
      this.fumaca = this.add.particles(0, 0, 'smoke', { lifespan: 620, speed: { min: 30, max: 90 }, scale: { start: 0.5, end: 1.3 }, alpha: { start: 0.5, end: 0 }, tint: 0x9aa3ad, emitting: false }).setDepth(15)
    } catch { this.spark = null; this.fumaca = null }

    this.carro = this.desenharCarro().setDepth(10)
    this.hudVidas = this.add.text(10, 8, '', { fontFamily: 'system-ui, sans-serif', fontSize: '18px' }).setDepth(20)
    this.hudScore = this.add.text(W - 10, 9, '⭐ 0', { fontFamily: 'system-ui, sans-serif', fontSize: '20px', fontStyle: 'bold', color: '#ffffff' }).setOrigin(1, 0).setShadow(0, 2, '#00000066', 3).setDepth(20)

    // arrastar o dedo → carro segue (pointer.x já vem em coordenadas do jogo)
    this.input.on('pointerdown', (p) => { this.alvoX = p.x })
    this.input.on('pointermove', (p) => { if (p.isDown) this.alvoX = p.x })
    this.input.keyboard?.on('keydown-LEFT', () => { this.alvoX = Math.max(24, (this.alvoX ?? this.carX) - 34) })
    this.input.keyboard?.on('keydown-RIGHT', () => { this.alvoX = Math.min(W - 24, (this.alvoX ?? this.carX) + 34) })

    this.game.events.on('carro:start', this.iniciar, this)
    this.resetVars()
  }

  criarTexturas() {
    if (this.textures.exists('faixa')) return
    let g = this.add.graphics(); g.fillStyle(0xe2e8f0, 1); g.fillRect(0, 0, 6, 34); g.generateTexture('faixa', 6, 60); g.destroy()
    g = this.add.graphics(); g.fillStyle(0xffffff, 1); g.fillCircle(6, 6, 6); g.generateTexture('spark', 12, 12); g.destroy()
    g = this.add.graphics(); g.fillStyle(0xffffff, 1); g.fillCircle(8, 8, 8); g.generateTexture('smoke', 16, 16); g.destroy()
  }

  desenharCarro() {
    const c = this.add.container(W / 2, CARRO_Y)
    const g = this.add.graphics()
    g.fillStyle(0x1f2937, 1)              // pneus
    g.fillRoundedRect(-24, -24, 8, 20, 3); g.fillRoundedRect(16, -24, 8, 20, 3)
    g.fillRoundedRect(-24, 6, 8, 20, 3); g.fillRoundedRect(16, 6, 8, 20, 3)
    g.fillStyle(0xef4444, 1); g.fillRoundedRect(-20, -32, 40, 64, 12) // carroceria
    g.fillStyle(0xb91c1c, 1); g.fillRoundedRect(-20, 18, 40, 14, 10)  // traseira mais escura
    g.fillStyle(0x1e293b, 1); g.fillRoundedRect(-14, -20, 28, 16, 6)  // para-brisa
    g.fillStyle(0x334155, 1); g.fillRoundedRect(-14, 2, 28, 12, 6)    // vidro traseiro
    g.fillStyle(0xfde68a, 1); g.fillCircle(-13, -30, 3); g.fillCircle(13, -30, 3) // faróis
    g.fillStyle(0x7f1d1d, 1); g.fillCircle(-13, 30, 2.5); g.fillCircle(13, 30, 2.5) // lanternas
    c.add(g)
    return c
  }

  resetVars() {
    this.carX = W / 2; this.alvoX = W / 2
    this.itens?.forEach((it) => it.destroy()); this.itens = []
    this.vel = 190; this.score = 0; this.vidas = 3; this.distSpawn = 0; this.gap = 150; this.faixaOff = 0
    this.carro.setPosition(this.carX, CARRO_Y).setAngle(0)
    this.atualizarHud()
  }
  iniciar() { this.resetVars(); this.estado = 'jogando' }
  atualizarHud() { this.hudVidas.setText('❤️'.repeat(Math.max(0, this.vidas))); this.hudScore.setText('⭐ ' + this.score) }

  spawnItem() {
    const bom = Math.random() < 0.58
    const arr = bom ? BONS : RUINS
    const t = this.add.text(30 + Math.random() * (W - 60), -24, arr[Math.floor(Math.random() * arr.length)], { fontSize: '30px' }).setOrigin(0.5).setDepth(5)
    t.bom = bom; t.pego = false
    this.itens.push(t)
  }
  bateu() {
    this.vidas--
    this.cameras.main.shake(200, 0.01); this.cameras.main.flash(130, 239, 68, 68)
    try { this.fumaca?.explode(10, this.carX, CARRO_Y - 10) } catch { /* ok */ }
    this.atualizarHud()
    if (this.vidas <= 0) this.morrer()
  }
  pegou() {
    this.score = Math.min(999, this.score + 1)
    try { this.spark?.explode(12, this.carX, CARRO_Y - 6) } catch { /* ok */ }
    const mais = this.add.text(this.carX, CARRO_Y - 30, '+1', { fontFamily: 'system-ui', fontSize: '18px', fontStyle: 'bold', color: '#fde68a' }).setOrigin(0.5).setDepth(18)
    this.tweens.add({ targets: mais, y: CARRO_Y - 60, alpha: 0, duration: 600, onComplete: () => mais.destroy() })
    this.atualizarHud()
  }
  morrer() {
    this.estado = 'fim'
    this.game.events.emit('carro:fim', this.score)
  }

  update(time, delta) {
    const dt = Math.min(delta, 50) / 1000
    // faixas rolando (sempre; no 'pronto' devagar)
    const vroll = this.estado === 'jogando' ? this.vel : 90
    this.faixaA.tilePositionY -= vroll * dt; this.faixaB.tilePositionY -= vroll * dt
    if (this.estado !== 'jogando') return

    this.vel = Math.min(470, this.vel + 12 * dt)
    // carro segue o dedo (suave) + inclina pro lado que vai
    const d = this.alvoX - this.carX
    this.carX += d * Math.min(1, dt * 14)
    this.carX = Math.max(24, Math.min(W - 24, this.carX))
    this.carro.setPosition(this.carX, CARRO_Y).setAngle(Math.max(-12, Math.min(12, d * 0.5)))

    // spawn por distância
    this.distSpawn += this.vel * dt
    if (this.distSpawn >= this.gap) { this.spawnItem(); this.distSpawn = 0; this.gap = 130 + Math.random() * 90 }

    for (const it of this.itens) {
      it.y += this.vel * dt
      if (!it.pego && Math.abs(it.x - this.carX) < 32 && Math.abs(it.y - CARRO_Y) < 34) {
        it.pego = true
        if (it.bom) this.pegou(); else this.bateu()
        if (this.estado !== 'jogando') break
      }
    }
    this.itens = this.itens.filter((it) => { if (it.y > H + 30 || it.pego) { it.destroy(); return false } return true })
  }
}

export default function CarrinhoPhaser({ onTerminar, onCancelar }) {
  const hostRef = useRef(null)
  const gameRef = useRef(null)
  const termRef = useRef(onTerminar); termRef.current = onTerminar
  const [fase, setFase] = useState('pronto')
  const [placar, setPlacar] = useState(0)
  const estrelasDe = (s) => (s >= 25 ? 3 : s >= 12 ? 2 : 1)

  useEffect(() => {
    const game = new Phaser.Game({
      type: Phaser.AUTO, parent: hostRef.current, width: W, height: H,
      backgroundColor: '#334155', banner: false, fps: { target: 60 },
      scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH, width: W, height: H },
      scene: CarroScene,
    })
    gameRef.current = game
    const aoFim = (n) => { setPlacar(n); setFase('fim') }
    game.events.on('carro:fim', aoFim)
    return () => { game.events.off('carro:fim', aoFim); game.destroy(true) }
  }, [])

  function iniciar() { setFase('jogando'); setPlacar(0); gameRef.current?.events.emit('carro:start') }

  return (
    <div className="bg-surface rounded-3xl p-4 sm:p-5 shadow-md text-center">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-extrabold text-muted">🚗 Carrinho na Estrada</span>
        <button onClick={onCancelar} className="text-xs text-faint p-3 -m-3">Sair</button>
      </div>

      <div className="relative select-none mx-auto" style={{ maxWidth: 360 }}>
        <div ref={hostRef} className="w-full rounded-2xl overflow-hidden" style={{ aspectRatio: `${W} / ${H}`, touchAction: 'none' }} />

        {fase === 'pronto' && (
          <button onClick={iniciar} className="absolute inset-0 grid place-items-center bg-black/30 rounded-2xl">
            <span className="bg-brand text-white font-extrabold rounded-xl px-5 py-2.5 shadow-glow">▶️ Toque e arraste pra jogar</span>
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
                <button onClick={() => termRef.current(estrelasDe(placar))} className="flex-1 rounded-xl bg-brand text-white font-extrabold py-2.5">Concluir 🎉</button>
              </div>
            </div>
          </div>
        )}
      </div>
      <p className="text-[11px] text-faint mt-3">Arraste o dedo pra guiar o carrinho. Pegue ⭐⛽🍎 e desvie de 🪨🚧🐄. 3 vidas!</p>
    </div>
  )
}
