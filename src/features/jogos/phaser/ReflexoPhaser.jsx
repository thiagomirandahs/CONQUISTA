// ===================== ⚡ Reflexo — versão PHASER (motor 2D) =====================
// Mesma regra da versão antiga (toque no alvo certo antes do tempo acabar;
// acerto = +1 nível, mais itens e tempo menor; errou/estourou = fim). MESMA
// calibragem: tempo = max(2000, 4000 - nível*25); itens = min(12, 1+nível).
// É "recorde": reporta o nível por registrarRecorde('reflexo', nível). Modernizado
// com tabuleiro escuro, anel de tempo, partículas ao acertar e tremida ao errar.
// Contrato igual ao antigo: { onTerminar, onCancelar }. Lazy (Phaser sob demanda).
import { useEffect, useRef, useState } from 'react'
import Phaser from 'phaser'
import { registrarRecorde } from '../../lib/dados.js'

const W = 340, H = 520
const EMOJIS = ['🔥', '⛺', '🧭', '📖', '⭐', '🍎', '🐍', '🦅', '🥾', '🪢', '💧', '🌙']
const qtdDe = (nv) => Math.min(EMOJIS.length, 1 + nv)

function embaralhar(arr) {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1));[a[i], a[j]] = [a[j], a[i]] }
  return a
}

class ReflexoScene extends Phaser.Scene {
  constructor() { super('reflexo') }

  create() {
    this.estado = 'pronto'
    this.criarTexturas()
    this.add.rectangle(W / 2, H / 2, W, H, 0x0f172a)
    this.add.text(W / 2, 40, 'Toque no:', { fontFamily: 'system-ui, sans-serif', fontSize: '18px', color: '#cbd5e1' }).setOrigin(0.5)
    this.alvoTxt = this.add.text(W / 2, 100, '', { fontSize: '46px' }).setOrigin(0.5)
    this.gRing = this.add.graphics()
    this.gTiles = this.add.graphics()
    this.tiles = []
    try {
      this.spark = this.add.particles(0, 0, 'spark', { lifespan: 520, speed: { min: 70, max: 210 }, scale: { start: 0.7, end: 0 }, alpha: { start: 1, end: 0 }, tint: [0x22c55e, 0xbef264, 0xffffff], emitting: false }).setDepth(20)
    } catch { this.spark = null }

    this.game.events.on('reflexo:start', this.iniciar, this)
    this.nivel = 0
    this.novaRodada() // prévia; o timer só corre quando estado === 'jogando'
  }

  criarTexturas() {
    if (this.textures.exists('spark')) return
    const g = this.add.graphics(); g.fillStyle(0xffffff, 1); g.fillCircle(6, 6, 6); g.generateTexture('spark', 12, 12); g.destroy()
  }

  iniciar() {
    this.nivel = 0
    this.estado = 'jogando'
    this.game.events.emit('reflexo:nivel', 0)
    this.novaRodada()
  }

  limparTiles() {
    this.tiles.forEach((t) => { t.txt.destroy(); t.zone.destroy() })
    this.tiles = []
    this.gTiles.clear()
  }

  novaRodada() {
    this.limparTiles()
    const n = qtdDe(this.nivel)
    const itens = embaralhar(EMOJIS).slice(0, n)
    this.alvo = itens[Math.floor(Math.random() * itens.length)]
    this.alvoTxt.setText(this.alvo).setScale(1)
    this.tweens.killTweensOf(this.alvoTxt)
    this.tweens.add({ targets: this.alvoTxt, scale: { from: 0.88, to: 1 }, duration: 110, ease: 'Quad.out' })

    this.tempoTotal = Math.max(2000, 4000 - this.nivel * 25)
    this.tempoRestante = this.tempoTotal

    // grid que sempre cabe (calcula o tamanho pra encaixar em qualquer nível)
    const cols = n === 1 ? 1 : n <= 4 ? 2 : 3
    const rows = Math.ceil(n / cols)
    const gap = 10, availW = 300, availH = H - 200
    const size = Math.min((availW - (cols - 1) * gap) / cols, (availH - (rows - 1) * gap) / rows, 150)
    const gridW = cols * size + (cols - 1) * gap
    const x0 = W / 2 - gridW / 2 + size / 2
    const y0 = 180 + size / 2

    for (let i = 0; i < n; i++) {
      const col = i % cols, row = Math.floor(i / cols)
      const x = x0 + col * (size + gap), y = y0 + row * (size + gap)
      this.gTiles.fillStyle(0x1e293b, 1); this.gTiles.fillRoundedRect(x - size / 2, y - size / 2, size, size, 14)
      this.gTiles.lineStyle(1.5, 0x334155, 1); this.gTiles.strokeRoundedRect(x - size / 2, y - size / 2, size, size, 14)
      const txt = this.add.text(x, y, itens[i], { fontSize: Math.round(size * 0.5) + 'px' }).setOrigin(0.5)
      const zone = this.add.zone(x, y, size, size).setInteractive()
      zone.emoji = itens[i]
      zone.on('pointerdown', () => this.tocar(itens[i], x, y))
      this.tiles.push({ txt, zone })
    }
  }

  tocar(emoji, x, y) {
    if (this.estado !== 'jogando') return
    if (emoji === this.alvo) {
      try { this.spark?.explode(16, x, y) } catch { /* ok */ }
      this.cameras.main.flash(90, 40, 160, 80)
      this.nivel++
      this.game.events.emit('reflexo:nivel', this.nivel)
      this.novaRodada()
    } else {
      this.cameras.main.shake(230, 0.014); this.cameras.main.flash(150, 239, 68, 68)
      this.fim()
    }
  }
  fim() {
    if (this.estado !== 'jogando') return
    this.estado = 'fim'
    this.game.events.emit('reflexo:fim', this.nivel)
  }

  update(time, delta) {
    // anel de tempo
    const g = this.gRing; g.clear()
    const cx = W / 2, cy = 100, r = 42
    g.lineStyle(6, 0x334155, 1); g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.strokePath()
    if (this.estado === 'jogando') {
      this.tempoRestante -= delta
      if (this.tempoRestante <= 0) { this.cameras.main.flash(150, 239, 68, 68); this.fim(); return }
      const frac = Phaser.Math.Clamp(this.tempoRestante / this.tempoTotal, 0, 1)
      const cor = frac > 0.5 ? 0x22c55e : frac > 0.25 ? 0xf5b012 : 0xef4444
      g.lineStyle(6, cor, 1); g.beginPath(); g.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2); g.strokePath()
    }
  }
}

export default function ReflexoPhaser({ onCancelar }) {
  const hostRef = useRef(null)
  const gameRef = useRef(null)
  const [fase, setFase] = useState('pronto') // pronto | jogando | fim
  const [nivel, setNivel] = useState(0)
  const [resultado, setResultado] = useState(null)

  useEffect(() => {
    const game = new Phaser.Game({
      type: Phaser.AUTO, parent: hostRef.current, width: W, height: H,
      backgroundColor: '#0f172a', banner: false, fps: { target: 60 },
      scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH, width: W, height: H },
      scene: ReflexoScene,
    })
    gameRef.current = game
    const aoNivel = (n) => setNivel(n)
    const aoFim = async (n) => {
      setNivel(n); setFase('fim'); setResultado(null)
      try { setResultado(await registrarRecorde('reflexo', n)) } catch { setResultado('erro') }
    }
    game.events.on('reflexo:nivel', aoNivel)
    game.events.on('reflexo:fim', aoFim)
    return () => { game.events.off('reflexo:nivel', aoNivel); game.events.off('reflexo:fim', aoFim); game.destroy(true) }
  }, [])

  function iniciar() { setFase('jogando'); setNivel(0); setResultado(null); gameRef.current?.events.emit('reflexo:start') }

  return (
    <div className="bg-surface rounded-3xl p-4 sm:p-5 shadow-md text-center">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-extrabold text-muted">⚡ Nível {nivel}</span>
        <button onClick={onCancelar} className="text-xs text-faint p-3 -m-3">Sair</button>
      </div>

      <div className="relative select-none mx-auto" style={{ maxWidth: 340 }}>
        <div ref={hostRef} className="w-full rounded-2xl overflow-hidden" style={{ aspectRatio: `${W} / ${H}`, touchAction: 'none' }} />

        {fase === 'pronto' && (
          <button onClick={iniciar} className="absolute inset-0 grid place-items-center bg-slate-900/50 rounded-2xl">
            <span className="bg-brand text-white font-extrabold rounded-xl px-5 py-2.5 shadow-glow">⚡ Toque pra começar</span>
          </button>
        )}

        {fase === 'fim' && (
          <div className="absolute inset-0 grid place-items-center bg-slate-900/85 rounded-2xl p-4">
            <div>
              <div className="text-5xl mb-2">🏁</div>
              <p className="font-extrabold text-white text-lg">Você chegou ao nível {nivel}!</p>
              {resultado === 'erro' ? (
                <p className="text-xs text-slate-300 mt-1">Não deu pra salvar o recorde (sem internet?).</p>
              ) : resultado?.fora ? (
                <p className="text-sm font-bold text-slate-200 mt-1">Boa! 🙂 (a liderança joga, mas fica fora do ranking)</p>
              ) : resultado ? (
                <p className={`text-sm font-bold mt-1 ${resultado.melhorou ? 'text-green-400' : 'text-slate-200'}`}>
                  {resultado.melhorou ? '🚀 NOVO recorde seu da semana!' : `Seu recorde da semana: ${resultado.recorde}`}
                </p>
              ) : (
                <p className="text-xs text-slate-300 mt-1">Salvando recorde…</p>
              )}
              {!resultado?.fora && <p className="text-[11px] text-slate-400 mt-2">O maior recorde da semana ganha <b>+20 pontos</b> no domingo!</p>}
              <div className="flex gap-2 mt-4 max-w-[280px] mx-auto">
                <button onClick={onCancelar} className="flex-1 rounded-xl bg-surface2 text-ink font-semibold py-2.5">Sair</button>
                <button onClick={iniciar} className="flex-1 rounded-xl bg-brand text-white font-extrabold py-2.5">🔁 De novo</button>
              </div>
            </div>
          </div>
        )}
      </div>
      <p className="text-[11px] text-faint mt-3">Toque no item certo antes do anel zerar. Sem limite — cada corrida pode virar seu recorde da semana. 🚀</p>
    </div>
  )
}
