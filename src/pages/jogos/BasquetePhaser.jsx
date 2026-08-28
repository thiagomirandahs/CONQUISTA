// ===================== 🏀 Arremesso — jogo em PHASER (motor 2D) =====================
// 5 arremessos: ARRASTE (flick) pra cima e solte — a direção e a força do arrasto
// viram a velocidade da bola, que voa em parábola de verdade (gravidade). Pontinhos
// durante o arrasto mostram a trajetória prevista, pra criança "ler" o arco antes
// de soltar. A cesta MUDA de lugar a cada arremesso. Cesta = a bola cruza a linha
// do aro de cima pra baixo dentro do vão. 5 cestas = 3 estrelas, 3-4 = 2, senão 1.
// Lazy — o Phaser só entra no bundle de quem abre um jogo do motor.
import { useEffect, useRef, useState } from 'react'
import Phaser from 'phaser'
import * as juice from '../../lib/juice.js'

const W = 360, H = 560
const BALL_X = 180, BALL_Y = 470          // bola parada embaixo, no centro
const ARO_Y = 150                          // altura da linha do aro
const ARO_MEIO = 26                        // meio-vão: |x - aroX| menor que isso = cesta (folgado pra criança)
const ARO_RAIO = 34                        // raio visual do aro
const TAB_TOP = 56, TAB_BOT = 128          // tabela (retângulo atrás do aro)
const GRAV = 980                           // gravidade em px/s² (parábola de verdade)

export class BasqueteScene extends Phaser.Scene {
  constructor() { super('basquete') }

  create() {
    this.criarTexturas()
    // fundo: ginásio — parede em degradê + arquibancada + quadra de madeira
    const fundo = this.add.graphics()
    fundo.fillGradientStyle(0x0f172a, 0x0f172a, 0x1e293b, 0x1e293b, 1)
    fundo.fillRect(0, 0, W, 380)
    fundo.fillStyle(0x334155, 1); fundo.fillRect(0, 300, W, 34) // arquibancada
    // torcida: bolinhas coloridas (sem asset, só graphics)
    for (let i = 0; i < 22; i++) {
      const cor = [0xf5c518, 0x60a5fa, 0xf87171, 0x4ade80][i % 4]
      fundo.fillStyle(cor, 0.5); fundo.fillCircle(10 + i * 16.5, 310 + (i % 2) * 12, 5)
    }
    fundo.fillGradientStyle(0xb45309, 0xb45309, 0x92400e, 0x92400e, 1)
    fundo.fillRect(0, 334, W, H - 334)                          // quadra de madeira
    fundo.lineStyle(3, 0xffffff, 0.35)
    fundo.beginPath(); fundo.arc(W / 2, H + 30, 150, Math.PI * 1.1, Math.PI * 1.9); fundo.strokePath() // garrafão

    this.aroX = 180
    this.montarCesta()

    this.ball = this.add.text(BALL_X, BALL_Y, '🏀', { fontSize: '34px' }).setOrigin(0.5).setDepth(5)
    this.gAim = this.add.graphics().setDepth(7)

    try {
      this.festa = this.add.particles(0, 0, 'confete', {
        lifespan: 900, speed: { min: 120, max: 300 }, angle: { min: 200, max: 340 },
        gravityY: 500, scale: { start: 1, end: 0.4 }, rotate: { min: 0, max: 360 },
        tint: [0xf5c518, 0xffffff, 0xf97316, 0x3b82f6, 0x22c55e], emitting: false,
      }).setDepth(8)
    } catch { this.festa = null }

    this.arremessoTxt = this.add.text(12, 10, '', { fontFamily: 'system-ui', fontSize: '18px', fontStyle: 'bold', color: '#ffffff' }).setDepth(9).setShadow(0, 1, '#0006', 2)
    this.cestasTxt = this.add.text(W - 12, 10, '', { fontFamily: 'system-ui', fontSize: '18px', fontStyle: 'bold', color: '#ffffff' }).setOrigin(1, 0).setDepth(9).setShadow(0, 1, '#0006', 2)
    this.banner = this.add.text(W / 2, 290, '', { fontFamily: 'system-ui', fontSize: '40px', fontStyle: 'bold', color: '#ffffff' }).setOrigin(0.5).setDepth(9).setShadow(0, 2, '#0008', 4).setAlpha(0)

    // arrastar pra mirar (flick): começa em QUALQUER lugar da tela — alvo é a tela toda
    this.input.on('pointerdown', (p) => { if (this.estado === 'mirando') this._aim = { x: p.x, y: p.y } })
    this.input.on('pointermove', (p) => { if (this.estado === 'mirando' && this._aim && p.isDown) this.previa(p) })
    this.input.on('pointerup', (p) => { if (this.estado === 'mirando' && this._aim) this.soltar(p) })

    this.game.events.on('basquete:start', this.iniciar, this)
    this.resetVars()
  }

  criarTexturas() {
    if (this.textures.exists('confete')) return
    const g = this.add.graphics()
    g.fillStyle(0xffffff, 1); g.fillRect(0, 0, 8, 5); g.generateTexture('confete', 8, 5); g.destroy()
  }

  // cesta em DOIS containers: o corpo (tabela + rede) fica ATRÁS da bola e o aro
  // na FRENTE — assim a bola "entra" visualmente no vão quando faz cesta
  montarCesta() {
    const corpo = this.add.container(this.aroX, 0).setDepth(3)
    const g = this.add.graphics()
    g.fillStyle(0xffffff, 0.06); g.fillCircle(0, ARO_Y - 24, 70)                   // brilho de holofote
    g.fillStyle(0x475569, 1); g.fillRect(-5, 0, 10, TAB_TOP)                       // suporte no teto
    g.fillStyle(0xffffff, 0.92); g.fillRoundedRect(-46, TAB_TOP, 92, TAB_BOT - TAB_TOP, 8) // tabela
    g.lineStyle(3, 0x94a3b8, 1); g.strokeRoundedRect(-46, TAB_TOP, 92, TAB_BOT - TAB_TOP, 8)
    g.lineStyle(3, 0xf97316, 0.9); g.strokeRect(-16, TAB_BOT - 34, 32, 28)         // quadradinho-alvo
    g.fillStyle(0xea580c, 1); g.fillRect(-6, TAB_BOT, 12, ARO_Y - TAB_BOT - 6)     // haste do aro
    corpo.add(g)
    const rede = this.add.graphics()
    rede.lineStyle(2, 0xffffff, 0.6)
    for (let i = -2; i <= 2; i++) { // fios em "V" afunilando (rede clássica)
      rede.beginPath(); rede.moveTo(i * 14, ARO_Y + 5); rede.lineTo(i * 8, ARO_Y + 46); rede.strokePath()
    }
    for (let j = 0; j < 3; j++) {
      const y = ARO_Y + 12 + j * 13, meia = 28 - j * 5
      rede.beginPath(); rede.moveTo(-meia, y); rede.lineTo(meia, y); rede.strokePath()
    }
    corpo.add(rede)
    this.rede = rede
    this.cesta = corpo

    const frente = this.add.container(this.aroX, 0).setDepth(6)
    const aro = this.add.graphics()
    aro.lineStyle(6, 0xf97316, 1); aro.strokeEllipse(0, ARO_Y, ARO_RAIO * 2, 16)   // aro laranja
    aro.lineStyle(2, 0xfdba74, 0.8); aro.strokeEllipse(0, ARO_Y - 2, ARO_RAIO * 2 - 8, 10) // brilho interno
    frente.add(aro)
    this.aroFrente = frente
  }

  resetVars() {
    this.estado = 'pronto'
    this.arremesso = 0; this.cestas = 0
    this._aim = null
    this.vx = 0; this.vy = 0; this.prevY = BALL_Y
    this.atualizarHud()
  }
  iniciar() {
    this.arremesso = 0; this.cestas = 0
    this.novoArremesso()
  }
  atualizarHud() {
    this.arremessoTxt.setText('🏀 ' + Math.min(this.arremesso + (this.estado === 'fim' ? 0 : 1), 5) + '/5')
    this.cestasTxt.setText('🎯 ' + this.cestas)
  }

  novoArremesso() {
    // a cesta muda de lugar: sorteia longe da posição atual pra mudança ser visível
    let nx
    do { nx = Phaser.Math.Between(84, 276) } while (Math.abs(nx - this.aroX) < 70)
    this.aroX = nx
    this.tweens.add({ targets: [this.cesta, this.aroFrente], x: nx, duration: 420, ease: 'Back.out' })

    // bola "nasce" com um pop (squash de chegada) pra chamar o olho pro lugar certo
    this.ball.setPosition(BALL_X, BALL_Y).setRotation(0).setAlpha(1).setScale(0)
    this.tweens.add({ targets: this.ball, scaleX: 1, scaleY: 1, duration: 260, ease: 'Back.out' })
    this._aim = null
    this.estado = 'mirando'
    this.atualizarHud()
  }

  // o flick vira velocidade inicial: arrastar mais longe = mais força; pra cima = sobe
  velocidadeDoArrasto(p) {
    const dx = p.x - this._aim.x, dy = p.y - this._aim.y
    const forte = Math.hypot(dx, dy) >= 24 && dy < -12 // precisa puxar pra CIMA
    const vx = Phaser.Math.Clamp(dx * 3.1, -520, 520)
    const vy = Phaser.Math.Clamp(dy * 3.4, -1080, -430) // teto e piso: nem foguete, nem parado
    return { vx, vy, forte }
  }

  // pontinhos de mira: simula a MESMA física do voo, então a prévia nunca mente
  previa(p) {
    const { vx, vy, forte } = this.velocidadeDoArrasto(p)
    const g = this.gAim; g.clear()
    let x = BALL_X, y = BALL_Y, sx = vx, sy = vy
    const dt = 0.09
    for (let i = 0; i < 10; i++) {
      sy += GRAV * dt; x += sx * dt; y += sy * dt
      g.fillStyle(forte ? 0xf5c518 : 0xffffff, (forte ? 0.9 : 0.3) * (1 - i * 0.07))
      g.fillCircle(x, y, 5 - i * 0.25)
    }
  }

  soltar(p) {
    const { vx, vy, forte } = this.velocidadeDoArrasto(p)
    this.gAim.clear()
    if (!forte) { this._aim = null; return } // flick fraco: não gasta arremesso, tenta de novo
    this._aim = null
    this.vx = vx; this.vy = vy
    this.prevY = this.ball.y
    // squash de saída: a bola "estica" pra cima no impulso
    this.tweens.add({ targets: this.ball, scaleX: 0.8, scaleY: 1.2, yoyo: true, duration: 90 })
    this.estado = 'voando'
  }

  update(_, delta) {
    if (this.estado !== 'voando') return
    const dt = Math.min(delta, 33) / 1000 // trava o passo: aba minimizada não teleporta a bola
    this.prevY = this.ball.y
    this.vy += GRAV * dt
    let x = this.ball.x + this.vx * dt
    let y = this.ball.y + this.vy * dt
    this.ball.setPosition(x, y)
    this.ball.rotation += this.vx * dt * 0.01 // giro acompanha a direção (game feel)

    // tabela: subindo por trás do aro, rebate pra baixo de leve (dá segunda chance)
    if (this.vy < 0 && Math.abs(x - this.aroX) < 46 && y > TAB_TOP && y < TAB_BOT) {
      this.vy = -this.vy * 0.45
      this.tweens.add({ targets: this.ball, scaleX: 1.15, scaleY: 0.85, yoyo: true, duration: 80 })
    }

    // linha do aro, DE CIMA PRA BAIXO: dentro do vão = cesta; na beirada = ferro (quica)
    if (this.prevY < ARO_Y && y >= ARO_Y && this.vy > 0) {
      const dx = x - this.aroX
      if (Math.abs(dx) < ARO_MEIO) { this.cestou(); return }
      if (Math.abs(dx) < ARO_MEIO + 14) {
        this.vy = -this.vy * 0.5
        this.vx += (dx > 0 ? 1 : -1) * 70 // ferro empurra pra fora
        this.cameras.main.shake(80, 0.004)
        this.tweens.add({ targets: this.ball, scaleX: 1.2, scaleY: 0.8, yoyo: true, duration: 80 })
      }
    }

    // saiu da tela (embaixo ou pelos lados) = errou
    if (y > H + 30 || x < -30 || x > W + 30) this.resultado('erro')
  }

  cestou() {
    this.estado = 'resultado'
    this.cestas++
    // a bola desliza pelo vão e desce pela rede (squash de "swish")
    this.tweens.add({ targets: this.ball, x: this.aroX, y: ARO_Y + 54, scaleX: 0.8, scaleY: 1.15, alpha: 0.9, duration: 260, ease: 'Quad.in' })
    this.tweens.add({ targets: this.rede, x: 3, yoyo: true, repeat: 3, duration: 60 }) // rede balança
    this.resultado('cesta')
  }

  resultado(tipo) {
    this.estado = 'resultado'
    this.game.events.emit('basquete:resultado', tipo)
    this.atualizarHud()
    this.banner.setText(tipo === 'cesta' ? 'CESTA! 🏀' : 'Errou! 😬')
      .setColor(tipo === 'cesta' ? '#fde047' : '#ffffff').setScale(0).setAlpha(1)
    this.tweens.add({ targets: this.banner, scale: 1, duration: 300, ease: 'Back.out' })
    if (tipo === 'cesta') {
      try { this.festa?.explode(30, this.aroX, ARO_Y) } catch { /* ok */ }
    } else {
      this.cameras.main.shake(160, 0.006)
    }
    this.time.delayedCall(1100, () => {
      this.tweens.add({ targets: this.banner, alpha: 0, duration: 200 })
      this.arremesso++
      if (this.arremesso >= 5) { this.estado = 'fim'; this.game.events.emit('basquete:fim', this.cestas) }
      else this.novoArremesso()
    })
  }
}

export default function BasquetePhaser({ onTerminar, onCancelar }) {
  const hostRef = useRef(null)
  const gameRef = useRef(null)
  const termRef = useRef(onTerminar); termRef.current = onTerminar
  const [fase, setFase] = useState('pronto')
  const [cestas, setCestas] = useState(0)
  const estrelasDe = (c) => (c >= 5 ? 3 : c >= 3 ? 2 : 1)

  useEffect(() => {
    const game = new Phaser.Game({
      type: Phaser.AUTO, parent: hostRef.current, width: W, height: H,
      backgroundColor: '#0f172a', banner: false, fps: { target: 60 },
      scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH, width: W, height: H },
      scene: BasqueteScene,
    })
    gameRef.current = game
    const aoResultado = (tipo) => { if (tipo === 'cesta') juice.acerto(2); else juice.erro() }
    const aoFim = (c) => { setCestas(c); setFase('fim') }
    game.events.on('basquete:resultado', aoResultado)
    game.events.on('basquete:fim', aoFim)
    return () => { game.events.off('basquete:resultado', aoResultado); game.events.off('basquete:fim', aoFim); game.destroy(true) }
  }, [])

  function iniciar() { setFase('jogando'); setCestas(0); gameRef.current?.events.emit('basquete:start') }

  return (
    <div className="bg-surface rounded-3xl p-4 sm:p-5 shadow-md text-center">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-extrabold text-muted">🏀 Arremesso</span>
        <button onClick={onCancelar} className="text-xs text-faint p-3 -m-3">Sair</button>
      </div>

      <div className="relative select-none mx-auto" style={{ maxWidth: 360 }}>
        <div ref={hostRef} className="w-full rounded-2xl overflow-hidden border border-line" style={{ aspectRatio: `${W} / ${H}`, touchAction: 'none' }} />

        {fase === 'pronto' && (
          <button onClick={iniciar} className="absolute inset-0 grid place-items-center bg-slate-900/40 rounded-2xl">
            <span className="bg-brand text-white font-extrabold rounded-xl px-5 py-2.5 shadow-glow">🏀 Toque pra arremessar</span>
          </button>
        )}

        {fase === 'fim' && (
          <div className="absolute inset-0 grid place-items-center bg-slate-950/85 rounded-2xl p-4">
            <div>
              <div className="text-4xl mb-1">🏆</div>
              <p className="font-extrabold text-white text-lg">Você acertou {cestas} de 5 cestas!</p>
              <p className="text-sm font-bold text-gold mt-1">{'⭐'.repeat(estrelasDe(cestas))}</p>
              <div className="flex gap-2 mt-4 max-w-[280px] mx-auto">
                <button onClick={onCancelar} className="flex-1 rounded-xl bg-surface2 text-ink font-semibold py-2.5">Sair</button>
                <button onClick={() => termRef.current(estrelasDe(cestas))} className="flex-1 rounded-xl bg-brand text-white font-extrabold py-2.5">Concluir 🎉</button>
              </div>
            </div>
          </div>
        )}
      </div>
      <p className="text-[11px] text-faint mt-3">Arraste pra cima e solte pra arremessar — os pontinhos mostram a curva da bola. A cesta muda de lugar a cada arremesso: capriche no arco! 🏀</p>
    </div>
  )
}
