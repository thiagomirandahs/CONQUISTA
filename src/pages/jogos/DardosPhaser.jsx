// ===================== 🎯 Dardos — jogo em PHASER (motor 2D) =====================
// A MIRA balança sozinha sobre o alvo (dança em oito, cada dardo mais rápido).
// TOQUE na hora certa: o dardo voa da sua mão até onde a mira estava. Anéis:
// borda 1pt, meio 2pts, mosca vermelha 3pts (máx 15 em 5 dardos). 12+ = 3
// estrelas, 7+ = 2, senão 1. Jogo normal (dá estrelas por onTerminar).
// Lazy — o Phaser só entra no bundle de quem abre um jogo do motor.
import { useEffect, useRef, useState } from 'react'
import Phaser from 'phaser'
import * as juice from '../../lib/juice.js'

const W = 360, H = 560
const ALVO_X = 180, ALVO_Y = 210
const R_FORA = 78, R_MEIO = 46, R_CENTRO = 17   // anéis: 1 / 2 / 3 pontos
const AMP_X = 78, AMP_Y = 66                     // amplitude do balanço da mira

export class DardosScene extends Phaser.Scene {
  constructor() { super('dardos') }

  create() {
    // parede de madeira acolhedora (faixas) + luminária em cima do alvo
    const fundo = this.add.graphics()
    const tons = [0x4a2f1c, 0x543722, 0x4a2f1c, 0x5c3d26]
    for (let i = 0; i < 10; i++) { fundo.fillStyle(tons[i % 4], 1); fundo.fillRect(0, i * 56, W, 56) }
    fundo.fillStyle(0x000000, 0.18); fundo.fillRect(0, 0, W, H) // escurece pro alvo saltar
    fundo.fillStyle(0xffe9b0, 0.07); fundo.fillTriangle(ALVO_X - 120, 0, ALVO_X + 120, 0, ALVO_X, ALVO_Y) // luz caindo
    fundo.fillStyle(0xf5c518, 1); fundo.fillRoundedRect(ALVO_X - 26, 6, 52, 8, 4) // luminária

    this.alvo = this.desenharAlvo()
    this.gChips = this.add.graphics().setDepth(9)
    this.mira = this.desenharMira()

    try {
      this.faisca = this.add.particles(0, 0, 'brilho-dardo', {
        lifespan: 420, speed: { min: 60, max: 190 }, gravityY: 220,
        scale: { start: 1.1, end: 0 }, tint: [0xfde047, 0xffffff, 0xef4444], emitting: false,
      }).setDepth(8)
    } catch { this.faisca = null }

    this.dardoTxt = this.add.text(12, 10, '', { fontFamily: 'system-ui', fontSize: '18px', fontStyle: 'bold', color: '#ffffff' }).setDepth(10).setShadow(0, 1, '#0006', 2)
    this.ptsTxt = this.add.text(W - 12, 10, '', { fontFamily: 'system-ui', fontSize: '18px', fontStyle: 'bold', color: '#ffffff' }).setOrigin(1, 0).setDepth(10).setShadow(0, 1, '#0006', 2)
    // banner com pastilha (mesmo sistema dos outros jogos do motor)
    this.banner = this.add.text(0, 0, '', { fontFamily: 'system-ui', fontSize: '36px', fontStyle: 'bold', color: '#ffffff' }).setOrigin(0.5).setShadow(0, 2, '#0008', 4)
    this.bannerBg = this.add.graphics()
    this.bannerBox = this.add.container(W / 2, 360, [this.bannerBg, this.banner]).setDepth(10).setAlpha(0)

    // TOQUE = joga o dardo (resposta imediata; a habilidade é a HORA do toque)
    this.input.on('pointerdown', () => this.jogar())

    this.game.events.on('dardos:start', this.iniciar, this)
    this.resetVars()
  }

  criarTexturas() {
    if (this.textures.exists('brilho-dardo')) return
    const g = this.add.graphics()
    g.fillStyle(0xffffff, 1); g.fillCircle(3, 3, 3); g.generateTexture('brilho-dardo', 6, 6); g.destroy()
  }

  desenharAlvo() {
    this.criarTexturas()
    const c = this.add.container(ALVO_X, ALVO_Y).setDepth(3)
    const g = this.add.graphics()
    g.fillStyle(0x000000, 0.3); g.fillCircle(4, 7, R_FORA + 12)          // sombra na parede
    g.fillStyle(0x2b1a0e, 1); g.fillCircle(0, 0, R_FORA + 12)            // moldura de madeira
    g.lineStyle(2, 0xf5c518, 0.5); g.strokeCircle(0, 0, R_FORA + 12)
    // gomos clássicos de dardos (20 fatias alternadas)
    for (let i = 0; i < 20; i++) {
      g.fillStyle(i % 2 ? 0x1f2937 : 0xf5efdc, 1)
      g.slice(0, 0, R_FORA, (i * Math.PI) / 10, ((i + 1) * Math.PI) / 10); g.fillPath()
    }
    // zona de 2 pontos marcada em verde translúcido + mosca vermelha (3)
    g.fillStyle(0x16a34a, 0.35); g.fillCircle(0, 0, R_MEIO)
    g.lineStyle(3, 0xf5c518, 0.9); g.strokeCircle(0, 0, R_MEIO)
    g.fillStyle(0xef4444, 1); g.fillCircle(0, 0, R_CENTRO)               // mosca = 3
    g.lineStyle(2, 0xffffff, 0.8); g.strokeCircle(0, 0, R_CENTRO)
    g.fillStyle(0xffffff, 0.9); g.fillCircle(0, 0, 3)
    g.lineStyle(2, 0x94a3b8, 0.7); g.strokeCircle(0, 0, R_FORA)
    c.add(g)
    return c
  }

  desenharMira() {
    const c = this.add.container(ALVO_X, ALVO_Y).setDepth(7)
    const g = this.add.graphics()
    g.lineStyle(3, 0xfde047, 0.95)
    g.strokeCircle(0, 0, 14)
    g.beginPath(); g.moveTo(-22, 0); g.lineTo(-8, 0); g.strokePath()
    g.beginPath(); g.moveTo(8, 0); g.lineTo(22, 0); g.strokePath()
    g.beginPath(); g.moveTo(0, -22); g.lineTo(0, -8); g.strokePath()
    g.beginPath(); g.moveTo(0, 8); g.lineTo(0, 22); g.strokePath()
    g.fillStyle(0xfde047, 1); g.fillCircle(0, 0, 2.5)
    c.add(g)
    // pulso sutil: a mira "respira" pra chamar o olho
    this.tweens.add({ targets: c, scale: { from: 1, to: 1.12 }, yoyo: true, repeat: -1, duration: 500, ease: 'Sine.inOut' })
    return c
  }

  // dardo desenhado (agulha + corpo + penas) apontando pra CIMA
  criarDardo() {
    const c = this.add.container(0, 0).setDepth(6)
    const g = this.add.graphics()
    g.lineStyle(3, 0xcbd5e1, 1); g.beginPath(); g.moveTo(0, -16); g.lineTo(0, -4); g.strokePath() // agulha
    g.fillStyle(0x2563eb, 1); g.fillRoundedRect(-3.5, -6, 7, 16, 3)                                // corpo
    g.fillStyle(0xef4444, 1); g.fillTriangle(0, 8, -8, 20, 0, 16); g.fillTriangle(0, 8, 8, 20, 0, 16) // penas
    g.fillStyle(0xffffff, 1); g.fillTriangle(0, 10, -4, 17, 0, 15); g.fillTriangle(0, 10, 4, 17, 0, 15)
    c.add(g)
    return c
  }

  resetVars() {
    this.estado = 'pronto'
    this.dardoN = 0; this.pontos = 0; this.t = 0
    this.cravados = []
    this.mira.setVisible(false)
    this.atualizarHud()
  }

  iniciar() {
    this.dardoN = 0; this.pontos = 0
    this.cravados.forEach((d) => d.destroy()); this.cravados = []
    // entradinha: alvo dá um pop
    this.alvo.setScale(0.92)
    this.tweens.add({ targets: this.alvo, scale: 1, duration: 260, ease: 'Back.out' })
    this.novoDardo()
  }

  atualizarHud() {
    this.dardoTxt.setText('🎯 ' + Math.min(this.dardoN + (this.estado === 'fim' ? 0 : 1), 5) + '/5')
    this.ptsTxt.setText('⭐ ' + this.pontos)
    const g = this.gChips; g.clear()
    g.fillStyle(0x0f172a, 0.35)
    ;[this.dardoTxt, this.ptsTxt].forEach((t) => {
      if (!t.text) return
      const b = t.getBounds()
      g.fillRoundedRect(b.x - 10, b.y - 5, b.width + 20, b.height + 10, 12)
    })
  }

  novoDardo() {
    // cada dardo a mira dança mais rápido (dificuldade sobe dentro da rodada)
    this.velMira = 1 + this.dardoN * 0.3
    this.faseMira = Math.random() * Math.PI * 2
    this.mira.setVisible(true).setAlpha(0)
    this.tweens.add({ targets: this.mira, alpha: 1, duration: 200 })
    this.estado = 'mirando'
    this.atualizarHud()
  }

  // a mira dança em "oito" (Lissajous): previsível o bastante pra criança LER
  // o ritmo, difícil o bastante pra mosca ser conquista
  update(_, delta) {
    if (this.estado !== 'mirando') return
    this.t += (delta / 1000) * this.velMira
    this.mira.x = ALVO_X + Math.sin(this.t * 2.1) * AMP_X
    this.mira.y = ALVO_Y + Math.sin(this.t * 3.4 + this.faseMira) * AMP_Y
  }

  jogar() {
    if (this.estado !== 'mirando') return
    this.estado = 'voando'
    // o dardo vai pra onde a mira ESTAVA no toque (+ um tiquinho de tremor de mão)
    const dx = this.mira.x + (Math.random() * 6 - 3)
    const dy = this.mira.y + (Math.random() * 6 - 3)
    this.tweens.add({ targets: this.mira, alpha: 0, duration: 120 })
    const dardo = this.criarDardo()
    dardo.setPosition(W / 2, H - 20).setScale(1.7)
    // voa "pra dentro da tela": sobe encolhendo até o ponto do impacto
    this.tweens.add({
      targets: dardo, x: dx, y: dy + 14, scale: 0.95, duration: 240, ease: 'Quad.in',
      onComplete: () => this.acertou(dardo, dx, dy),
    })
  }

  acertou(dardo, dx, dy) {
    const d = Phaser.Math.Distance.Between(dx, dy, this.alvo.x, this.alvo.y)
    if (d > R_FORA) {
      // fora do alvo: o dardo bate na parede e cai
      try { this.faisca?.explode(5, dx, dy) } catch { /* ok */ }
      this.cameras.main.shake(130, 0.005)
      this.tweens.add({ targets: dardo, y: dy + 90, angle: 120, alpha: 0, duration: 500, ease: 'Quad.in', onComplete: () => dardo.destroy() })
      this.resultado(0)
      return
    }
    const pts = d <= R_CENTRO ? 3 : d <= R_MEIO ? 2 : 1
    // crava: vira filho do alvo (balança junto), com uma incliniadinha aleatória
    const lx = dardo.x - this.alvo.x, ly = dardo.y - this.alvo.y
    this.alvo.add(dardo)
    dardo.setPosition(lx, ly).setAngle(Math.random() * 16 - 8)
    this.cravados.push(dardo)
    try { this.faisca?.explode(6 + pts * 6, dx, dy) } catch { /* ok */ }
    // impacto: alvo dá squash e balança (dardos cravados vão junto)
    this.alvo.setScale(1.1)
    this.tweens.add({ targets: this.alvo, scale: 1, duration: 200, ease: 'Back.out' })
    this.tweens.add({
      targets: this.alvo, angle: Phaser.Math.Between(2, 4) * (Math.random() < 0.5 ? -1 : 1),
      duration: 80, yoyo: true, repeat: 1, ease: 'Sine.inOut', onComplete: () => this.alvo.setAngle(0),
    })
    const cores = { 1: '#ffffff', 2: '#86efac', 3: '#fde047' }
    const t = this.add.text(dx, dy - 14, '+' + pts, { fontFamily: 'system-ui', fontSize: '26px', fontStyle: 'bold', color: cores[pts] }).setOrigin(0.5).setDepth(10).setShadow(0, 2, '#0008', 3)
    this.tweens.add({ targets: t, y: dy - 52, alpha: 0, duration: 700, ease: 'Quad.out', onComplete: () => t.destroy() })
    this.resultado(pts)
  }

  resultado(pts) {
    this.estado = 'resultado'
    this.pontos += pts
    this.game.events.emit('dardos:resultado', pts)
    this.atualizarHud()
    const txt = pts === 3 ? 'NA MOSCA! 🎯' : pts === 2 ? 'Boa! 👏' : pts === 1 ? 'Pegou! 🙂' : 'Errou! 😬'
    this.banner.setText(txt).setColor(pts === 3 ? '#fde047' : '#ffffff')
    const bw = this.banner.width + 36, bh = this.banner.height + 16
    this.bannerBg.clear(); this.bannerBg.fillStyle(0x0f172a, 0.4); this.bannerBg.fillRoundedRect(-bw / 2, -bh / 2, bw, bh, 14)
    this.bannerBox.setScale(0).setAlpha(1)
    this.tweens.add({ targets: this.bannerBox, scale: 1, duration: 280, ease: 'Back.out' })
    this.time.delayedCall(950, () => {
      this.tweens.add({ targets: this.bannerBox, alpha: 0, duration: 180 })
      this.dardoN++
      if (this.dardoN >= 5) { this.estado = 'fim'; this.mira.setVisible(false); this.game.events.emit('dardos:fim', this.pontos) }
      else this.novoDardo()
    })
  }
}

export default function DardosPhaser({ onTerminar, onCancelar }) {
  const hostRef = useRef(null)
  const gameRef = useRef(null)
  const termRef = useRef(onTerminar); termRef.current = onTerminar
  const [fase, setFase] = useState('pronto')
  const [pontos, setPontos] = useState(0)
  const estrelasDe = (p) => (p >= 12 ? 3 : p >= 7 ? 2 : 1)

  useEffect(() => {
    const game = new Phaser.Game({
      type: Phaser.AUTO, parent: hostRef.current, width: W, height: H,
      backgroundColor: '#4a2f1c', banner: false, fps: { target: 60 },
      scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH, width: W, height: H },
      scene: DardosScene,
    })
    gameRef.current = game
    const aoResultado = (pts) => { if (pts > 0) juice.acerto(pts); else juice.erro() }
    const aoFim = (p) => { setPontos(p); setFase('fim') }
    game.events.on('dardos:resultado', aoResultado)
    game.events.on('dardos:fim', aoFim)
    return () => { game.events.off('dardos:resultado', aoResultado); game.events.off('dardos:fim', aoFim); game.destroy(true) }
  }, [])

  function iniciar() { setFase('jogando'); setPontos(0); gameRef.current?.events.emit('dardos:start') }

  return (
    <div className="bg-surface rounded-3xl p-4 sm:p-5 shadow-md text-center">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-extrabold text-muted">🎯 Dardos</span>
        <button onClick={onCancelar} className="text-xs text-faint p-3 -m-3">Sair</button>
      </div>

      <div className="relative select-none mx-auto" style={{ maxWidth: 360 }}>
        <div ref={hostRef} className="w-full rounded-2xl overflow-hidden border border-line" style={{ aspectRatio: `${W} / ${H}`, touchAction: 'none' }} />

        {fase === 'pronto' && (
          <button onClick={iniciar} className="absolute inset-0 grid place-items-center bg-black/40 rounded-2xl">
            <span className="bg-brand text-white font-extrabold rounded-xl px-5 py-2.5 shadow-glow">🎯 Toque pra jogar</span>
          </button>
        )}

        {fase === 'fim' && (
          <div className="absolute inset-0 grid place-items-center bg-black/70 rounded-2xl p-4">
            <div>
              <div className="text-4xl mb-1">🏆</div>
              <p className="font-extrabold text-white text-lg">Você fez {pontos} de 15 pontos!</p>
              <p className="text-sm font-bold text-gold mt-1">{'⭐'.repeat(estrelasDe(pontos))}</p>
              <div className="flex gap-2 mt-4 max-w-[280px] mx-auto">
                <button onClick={onCancelar} className="flex-1 rounded-xl bg-surface2 text-ink font-semibold py-2.5">Sair</button>
                <button onClick={() => termRef.current(estrelasDe(pontos))} className="flex-1 rounded-xl bg-brand text-white font-extrabold py-2.5">Concluir 🎉</button>
              </div>
            </div>
          </div>
        )}
      </div>
      <p className="text-[11px] text-faint mt-3">A mira dança sozinha — toque na hora CERTA! Mosca vermelha = 3, verde = 2, resto = 1. Cada dardo ela acelera. 🎯</p>
    </div>
  )
}
