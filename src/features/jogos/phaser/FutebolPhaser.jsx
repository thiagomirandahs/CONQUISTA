// ===================== ⚽ Pênaltis — jogo em PHASER (motor 2D) =====================
// Cobre 5 pênaltis: ARRASTE (flick) na direção do canto que quer acertar — pra
// cima-esquerda vai no ângulo esquerdo, etc. Quanto mais forte pra cima, mais
// alto (cuidado com o travessão). O goleiro se joga num dos lados. Gol quando a
// bola passa longe da mão dele (ou alto demais pra ele). Marque o maximo de 5:
// 5 gols = 3 estrelas, 3-4 = 2, senao 1. Jogo normal (da estrelas por onTerminar).
// Lazy — o Phaser so entra no bundle de quem abre um jogo do motor.
import { useState } from 'react'
import { usePhaserGame } from '../hooks/usePhaserGame.js'
import Phaser from 'phaser'
import * as juice from '../../../lib/juice.js'

const W = 360, H = 560
const GOL_L = 76, GOL_R = 284, GOL_TOP = 98, GOL_BOT = 176
const BALL_X = 180, BALL_Y = 470, KEEPER_Y = 150

class FutebolScene extends Phaser.Scene {
  constructor() { super('futebol') }

  create() {
    this.criarTexturas()
    // fundo: céu + arquibancada + gramado
    this.add.rectangle(W / 2, 70, W, 140, 0x8fd0f0)
    this.add.rectangle(W / 2, 60, W, 40, 0x334155)  // arquibancada
    this.add.rectangle(W / 2, 360, W, 400, 0x3fa34d) // gramado
    for (let i = 0; i < 7; i++) this.add.rectangle(W / 2, 190 + i * 56, W, 28, 0x37963f).setAlpha(i % 2 ? 0.5 : 0)

    // gol: rede + trave
    const net = this.add.graphics()
    net.fillStyle(0xffffff, 0.10); net.fillRect(GOL_L, GOL_TOP, GOL_R - GOL_L, GOL_BOT - GOL_TOP)
    net.lineStyle(1, 0xffffff, 0.4)
    for (let x = GOL_L; x <= GOL_R; x += 14) { net.beginPath(); net.moveTo(x, GOL_TOP); net.lineTo(x, GOL_BOT); net.strokePath() }
    for (let y = GOL_TOP; y <= GOL_BOT; y += 13) { net.beginPath(); net.moveTo(GOL_L, y); net.lineTo(GOL_R, y); net.strokePath() }
    this.net = net
    const trave = this.add.graphics()
    trave.fillStyle(0xffffff, 1)
    trave.fillRect(GOL_L - 6, GOL_TOP - 6, 6, GOL_BOT - GOL_TOP + 6)
    trave.fillRect(GOL_R, GOL_TOP - 6, 6, GOL_BOT - GOL_TOP + 6)
    trave.fillRect(GOL_L - 6, GOL_TOP - 6, GOL_R - GOL_L + 12, 6)

    // marca do pênalti + arco
    const linha = this.add.graphics()
    linha.fillStyle(0xffffff, 0.85); linha.fillCircle(BALL_X, BALL_Y - 6, 3)
    linha.lineStyle(3, 0xffffff, 0.5); linha.beginPath(); linha.arc(BALL_X, BALL_Y - 6, 46, Math.PI * 1.15, Math.PI * 1.85); linha.strokePath()

    this.keeper = this.desenharGoleiro()
    // goleiro "vivo" enquanto você mira: quica nas pontas dos pés
    this.bounce = this.tweens.add({ targets: this.keeper, scaleY: 0.93, yoyo: true, repeat: -1, duration: 420, ease: 'Sine.inOut' })
    this.ball = this.add.text(BALL_X, BALL_Y, '⚽', { fontSize: '34px' }).setOrigin(0.5)
    this.gAim = this.add.graphics().setDepth(5)

    try {
      this.festa = this.add.particles(0, 0, 'confete', {
        lifespan: 900, speed: { min: 120, max: 300 }, angle: { min: 200, max: 340 },
        gravityY: 500, scale: { start: 1, end: 0.4 }, rotate: { min: 0, max: 360 },
        tint: [0xf5c518, 0xffffff, 0x22c55e, 0x3b82f6, 0xef4444], emitting: false,
      }).setDepth(8)
    } catch { this.festa = null }

    this.chuteTxt = this.add.text(12, 10, '', { fontFamily: 'system-ui', fontSize: '18px', fontStyle: 'bold', color: '#ffffff' }).setDepth(9).setShadow(0, 1, '#0006', 2)
    this.golsTxt = this.add.text(W - 12, 10, '', { fontFamily: 'system-ui', fontSize: '18px', fontStyle: 'bold', color: '#ffffff' }).setOrigin(1, 0).setDepth(9).setShadow(0, 1, '#0006', 2)
    this.banner = this.add.text(W / 2, 250, '', { fontFamily: 'system-ui', fontSize: '40px', fontStyle: 'bold', color: '#ffffff' }).setOrigin(0.5).setDepth(9).setShadow(0, 2, '#0008', 4).setAlpha(0)

    // arrastar pra mirar (flick na direção do canto)
    this.input.on('pointerdown', (p) => { if (this.estado === 'mirando') this._aim = { x: p.x, y: p.y } })
    this.input.on('pointermove', (p) => { if (this.estado === 'mirando' && this._aim && p.isDown) this.previa(p) })
    this.input.on('pointerup', (p) => { if (this.estado === 'mirando' && this._aim) this.soltar(p) })

    this.game.events.on('futebol:start', this.iniciar, this)
    this.resetVars()
  }

  criarTexturas() {
    if (this.textures.exists('confete')) return
    const g = this.add.graphics()
    g.fillStyle(0xffffff, 1); g.fillRect(0, 0, 8, 5); g.generateTexture('confete', 8, 5); g.destroy()
  }

  desenharGoleiro() {
    const c = this.add.container(180, KEEPER_Y).setDepth(4)
    const g = this.add.graphics()
    g.fillStyle(0x111827, 1); g.fillRoundedRect(-10, 8, 7, 16, 2); g.fillRoundedRect(3, 8, 7, 16, 2) // pernas
    g.fillStyle(0x16a34a, 1); g.fillRoundedRect(-14, -14, 28, 24, 6)                                 // camisa
    g.fillStyle(0x16a34a, 1); g.fillRoundedRect(-24, -12, 12, 7, 3); g.fillRoundedRect(12, -12, 12, 7, 3) // braços
    g.fillStyle(0xffffff, 1); g.fillCircle(-24, -9, 5); g.fillCircle(24, -9, 5)                       // luvas
    g.fillStyle(0xf2c795, 1); g.fillCircle(0, -22, 7)                                                 // cabeça
    c.add(g)
    return c
  }

  resetVars() {
    this.estado = 'pronto'
    this.chute = 0; this.gols = 0
    this._aim = null
    this.atualizarHud()
  }
  iniciar() {
    this.chute = 0; this.gols = 0
    this.novoChute()
  }
  atualizarHud() {
    this.chuteTxt.setText('⚽ ' + Math.min(this.chute + (this.estado === 'fim' ? 0 : 1), 5) + '/5')
    this.golsTxt.setText('🥅 ' + this.gols)
  }
  novoChute() {
    this.ball.setPosition(BALL_X, BALL_Y).setScale(1)
    // levanta do mergulho: volta pro meio, em pé, sem inclinação
    this.tweens.add({ targets: this.keeper, x: 180, y: KEEPER_Y, rotation: 0, duration: 260, ease: 'Quad.out' })
    this.keeper.setScale(1)
    this.bounce?.resume()
    this._aim = null
    this.estado = 'mirando'
    this.atualizarHud()
  }

  // mapeia o arrasto (flick) pra um alvo dentro/fora do gol. Puxar pra cima =
  // chute mais alto (perto do travessão); pros lados = ângulos.
  alvoDoArrasto(p) {
    const dx = p.x - this._aim.x, dy = p.y - this._aim.y
    const forte = Math.hypot(dx, dy) >= 26 && dy < -14 // precisa puxar pra cima (em direção ao gol)
    const subida = -dy                                 // quanto puxou pra cima
    let tx = BALL_X + dx * 1.5
    let ty = GOL_BOT - (subida - 14) * 0.55            // mais subida => mais alto (ty menor)
    tx = Math.max(44, Math.min(316, tx))
    ty = Math.max(84, Math.min(GOL_BOT, ty))           // < GOL_TOP-2 vira "por cima" (fora)
    return { tx, ty, forte }
  }

  previa(p) {
    const { tx, ty, forte } = this.alvoDoArrasto(p)
    const g = this.gAim; g.clear()
    g.lineStyle(3, forte ? 0xffffff : 0xffffff, forte ? 0.85 : 0.3)
    g.beginPath(); g.moveTo(BALL_X, BALL_Y); g.lineTo(tx, ty); g.strokePath()
    g.fillStyle(forte ? 0xf5c518 : 0xffffff, forte ? 0.9 : 0.35); g.fillCircle(tx, ty, 6)
  }

  soltar(p) {
    const { tx, ty, forte } = this.alvoDoArrasto(p)
    this.gAim.clear()
    if (!forte) { this._aim = null; return } // flick fraco: não chuta, tenta de novo
    this._aim = null
    this.chutar(tx, ty)
  }

  chutar(tx, ty) {
    this.estado = 'chutando'
    this.bounce?.pause(); this.keeper.setScale(1)

    // Decisão do goleiro: 40% ele LÊ o canto (cai onde a bola vai, com errinho),
    // 38% cai no canto errado, 22% fica no meio. Ler não garante defesa: chute
    // bem no cantinho (ou alto) passa mesmo assim — precisão vence o goleiro.
    const r = Math.random()
    let diveX
    if (r < 0.40) diveX = tx + (Math.random() * 36 - 18)
    else if (r < 0.78) diveX = tx < 180 ? 210 + Math.random() * 34 : 150 - Math.random() * 34
    else diveX = 180 + (Math.random() * 20 - 10)
    diveX = Math.max(126, Math.min(234, diveX)) // alcance do mergulho (cantinho extremo é dele não chegar)
    const diveY = Math.max(116, Math.min(162, ty + (Math.random() * 20 - 10)))
    this.keeperDiveX = diveX; this.keeperDiveY = diveY

    // Mergulho de verdade: deita na direção do canto (ou agacha, se ficou no meio)
    const dx = diveX - 180
    if (Math.abs(dx) < 16) {
      this.tweens.add({ targets: this.keeper, x: diveX, y: diveY + 6, duration: 300, ease: 'Quad.out' })
    } else {
      const rot = (dx < 0 ? -1 : 1) * Math.min(1.15, 0.55 + Math.abs(dx) / 110)
      this.tweens.add({ targets: this.keeper, x: diveX, y: diveY, rotation: rot, duration: 360, ease: 'Quad.out' })
    }
    const bx0 = BALL_X, by0 = BALL_Y
    this.tweens.addCounter({
      from: 0, to: 1, duration: 440, ease: 'Sine.in',
      onUpdate: (tw) => {
        const t = tw.getValue()
        const arco = Math.sin(t * Math.PI) * 46
        this.ball.setPosition(bx0 + (tx - bx0) * t, by0 + (ty - by0) * t - arco).setScale(1 - 0.5 * t)
      },
      onComplete: () => this.avaliar(tx, ty),
    })
  }

  avaliar(tx, ty) {
    const foraX = tx < GOL_L - 2 || tx > GOL_R + 2
    const foraY = ty < GOL_TOP - 2
    let tipo
    if (foraX || foraY) tipo = 'fora'
    else {
      // defesa = a bola terminou no alcance das LUVAS (bola alta é mais difícil de pegar)
      const alcance = ty < 122 ? 24 : 34
      const dist = Math.hypot(tx - this.keeperDiveX, (ty - this.keeperDiveY) * 0.9)
      if (dist < alcance) tipo = 'defesa'
      else { tipo = 'gol'; this.gols++ }
    }
    this.resultado(tipo)
  }

  resultado(tipo) {
    this.estado = 'resultado'
    this.game.events.emit('futebol:resultado', tipo)
    this.atualizarHud()
    const txt = tipo === 'gol' ? 'GOL! ⚽' : tipo === 'defesa' ? 'Defendeu! 🧤' : 'Fora! 😬'
    const cor = tipo === 'gol' ? '#fde047' : '#ffffff'
    this.banner.setText(txt).setColor(cor).setScale(0).setAlpha(1)
    this.tweens.add({ targets: this.banner, scale: 1, duration: 300, ease: 'Back.out' })
    if (tipo === 'gol') {
      try { this.festa?.explode(30, W / 2, 150) } catch { /* ok */ }
      this.tweens.add({ targets: this.net, alpha: { from: 0.28, to: 0.1 }, duration: 300, yoyo: true })
    } else {
      if (tipo === 'defesa') {
        // AGARROU: a bola gruda nas luvas e o goleiro comemora com um "pump"
        this.tweens.add({ targets: this.ball, x: this.keeper.x, y: this.keeper.y - 4, scale: 0.5, duration: 130, ease: 'Quad.out' })
        this.tweens.add({ targets: this.keeper, scale: 1.12, yoyo: true, duration: 140 })
      }
      this.cameras.main.shake(160, 0.006)
    }
    this.time.delayedCall(1150, () => {
      this.tweens.add({ targets: this.banner, alpha: 0, duration: 200 })
      this.chute++
      if (this.chute >= 5) { this.estado = 'fim'; this.game.events.emit('futebol:fim', this.gols) }
      else this.novoChute()
    })
  }
}

export default function FutebolPhaser({ onTerminar, onCancelar }) {
  const [fase, setFase] = useState('pronto')
  const [gols, setGols] = useState(0)
  const estrelasDe = (g) => (g >= 5 ? 3 : g >= 3 ? 2 : 1)

  const { hostRef, emit } = usePhaserGame(
    { width: W, height: H, backgroundColor: '#3fa34d', banner: false, fps: { target: 60 }, scene: FutebolScene },
    {
      'futebol:resultado': (tipo) => { if (tipo === 'gol') juice.acerto(2); else juice.erro() },
      'futebol:fim': (g) => { setGols(g); setFase('fim') },
    },
  )

  function iniciar() { setFase('jogando'); setGols(0); emit('futebol:start') }

  return (
    <div className="bg-surface rounded-3xl p-4 sm:p-5 shadow-md text-center">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-extrabold text-muted">⚽ Pênaltis</span>
        <button onClick={onCancelar} className="text-xs text-faint p-3 -m-3">Sair</button>
      </div>

      <div className="relative select-none mx-auto" style={{ maxWidth: 360 }}>
        <div ref={hostRef} className="w-full rounded-2xl overflow-hidden border border-line" style={{ aspectRatio: `${W} / ${H}`, touchAction: 'none' }} />

        {fase === 'pronto' && (
          <button onClick={iniciar} className="absolute inset-0 grid place-items-center bg-green-900/40 rounded-2xl">
            <span className="bg-brand text-white font-extrabold rounded-xl px-5 py-2.5 shadow-glow">⚽ Toque pra bater</span>
          </button>
        )}

        {fase === 'fim' && (
          <div className="absolute inset-0 grid place-items-center bg-green-950/85 rounded-2xl p-4">
            <div>
              <div className="text-4xl mb-1">🏆</div>
              <p className="font-extrabold text-white text-lg">Você fez {gols} de 5 gols!</p>
              <p className="text-sm font-bold text-gold mt-1">{'⭐'.repeat(estrelasDe(gols))}</p>
              <div className="flex gap-2 mt-4 max-w-[280px] mx-auto">
                <button onClick={onCancelar} className="flex-1 rounded-xl bg-surface2 text-ink font-semibold py-2.5">Sair</button>
                <button onClick={() => onTerminar(estrelasDe(gols))} className="flex-1 rounded-xl bg-brand text-white font-extrabold py-2.5">Concluir 🎉</button>
              </div>
            </div>
          </div>
        )}
      </div>
      <p className="text-[11px] text-faint mt-3">Arraste na direção do canto que quer acertar. Mais forte pra cima = mais alto (cuidado com o travessão!). O goleiro se joga — engane ele! 🧤</p>
    </div>
  )
}
