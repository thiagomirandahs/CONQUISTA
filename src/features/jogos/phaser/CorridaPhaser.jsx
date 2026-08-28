// ===================== 🏕️ Corrida do Acampamento — versão PHASER =====================
// Endless runner de verdade num motor 2D (Phaser 4): céu ao entardecer, paralaxe
// de pinheiros + chão, mascote desenhado por código (pernas correndo, agacha ao
// pular), poeirinha nas patas e tremida de câmera na batida. Mesmo contrato do
// jogo antigo: recebe só onCancelar e reporta o placar por registrarRecorde('corrida').
// Fica num arquivo próprio e é carregado sob demanda (lazy) — o Phaser só entra no
// bundle quando a criança abre ESTE jogo.
import { useEffect, useState } from 'react'
import { usePhaserGame } from '../hooks/usePhaserGame.js'
import Phaser from 'phaser'
import { registrarRecorde } from '../../../lib/dados.js'

const W = 800, H = 300, GROUND_Y = 250, RUNNER_X = 150
const OBST = ['🔥', '🪵', '⛺', '🪨', '🌵', '🎒']

class CorridaScene extends Phaser.Scene {
  constructor() { super('corrida') }

  create() {
    this.estado = 'pronto'            // 'pronto' | 'correndo' | 'fim'
    this.criarTexturas()

    // Céu (gradiente entardecer) + sol + nuvens
    this.add.graphics().fillGradientStyle(0x2b3a67, 0x37477e, 0xf7b267, 0xf6a15c, 1).fillRect(0, 0, W, H)
    this.add.circle(620, 96, 40, 0xffe1a8, 1).setAlpha(0.9)
    this.nuvens = [this.nuvem(180, 70), this.nuvem(430, 50), this.nuvem(700, 90)]

    // Paralaxe: serra de pinheiros (lenta) + chão (rápido = velocidade do jogo)
    this.ridge = this.add.tileSprite(0, GROUND_Y - 120, W, 120, 'ridge').setOrigin(0, 0)
    this.chao = this.add.tileSprite(0, GROUND_Y, W, H - GROUND_Y, 'chao').setOrigin(0, 0)

    // Sombra do mascote (encolhe quando pula)
    this.sombra = this.add.ellipse(RUNNER_X, GROUND_Y + 8, 62, 14, 0x000000, 0.18)

    // Mascote (container com pernas + corpo desenhados por código)
    this.runner = this.add.container(RUNNER_X, GROUND_Y)
    this.perna1 = this.add.rectangle(-8, -16, 9, 17, 0xb9763b).setOrigin(0.5, 0)
    this.perna2 = this.add.rectangle(8, -16, 9, 17, 0xb9763b).setOrigin(0.5, 0)
    const g = this.add.graphics()
    g.fillStyle(0xc98a4b, 1); g.fillTriangle(-20, -46, -8, -66, -2, -48) // orelha esq
    g.fillStyle(0xc98a4b, 1); g.fillTriangle(20, -46, 8, -66, 2, -48)    // orelha dir
    g.fillStyle(0xd99a5b, 1); g.fillCircle(0, -40, 25)                    // corpo
    g.fillStyle(0xf2c795, 1); g.fillEllipse(0, -32, 30, 24)              // barriga clara
    g.fillStyle(0xffffff, 1); g.fillCircle(7, -46, 5); g.fillCircle(-7, -46, 5) // olhos
    g.fillStyle(0x2b2b2b, 1); g.fillCircle(9, -46, 2.4); g.fillCircle(-5, -46, 2.4)
    g.fillStyle(0x2b2b2b, 1); g.fillCircle(0, -36, 2.6)                   // narizinho
    g.fillStyle(0xf5c518, 1); g.fillTriangle(-13, -22, 13, -22, 0, -6)   // lenço amarelo (desbravador)
    this.corpo = g
    this.runner.add([this.perna1, this.perna2, g])

    // Poeirinha nas patas (só correndo)
    try {
      this.dust = this.add.particles(0, 0, 'dust', {
        x: RUNNER_X - 14, y: GROUND_Y - 2, lifespan: 420,
        speedX: { min: -170, max: -70 }, speedY: { min: -50, max: 0 },
        scale: { start: 0.55, end: 0 }, alpha: { start: 0.5, end: 0 },
        tint: 0xd9c3a0, frequency: 80, quantity: 1,
      })
      this.dust.stop()
    } catch { this.dust = null }

    // Placar (dentro do canvas, canto)
    this.placar = this.add.text(W - 18, 14, '0', { fontFamily: 'system-ui, sans-serif', fontSize: '32px', fontStyle: 'bold', color: '#ffffff' })
      .setOrigin(1, 0).setShadow(0, 2, '#00000066', 4)

    // Entradas: tocar no canvas / espaço → pula (só quando está correndo)
    this.input.on('pointerdown', () => this.pular())
    this.input.keyboard?.on('keydown-SPACE', (e) => { e.preventDefault?.(); this.pular() })
    this.input.keyboard?.on('keydown-UP', (e) => { e.preventDefault?.(); this.pular() })

    // Respira parado (idle) e reage aos comandos do React
    this.breath = this.tweens.add({ targets: this.runner, scaleX: 1.03, scaleY: 0.97, yoyo: true, repeat: -1, duration: 900, ease: 'Sine.inOut' })
    this.game.events.on('corrida:start', this.iniciar, this)
    this.game.events.on('corrida:pular', this.pular, this) // toque em qualquer lugar (via React)

    this.resetVars()
  }

  // --- helpers de desenho ---
  nuvem(x, y) {
    const c = this.add.container(x, y)
    const g = this.add.graphics()
    g.fillStyle(0xffffff, 0.85); g.fillCircle(0, 0, 14); g.fillCircle(16, 4, 11); g.fillCircle(-16, 4, 11)
    c.add(g); return c
  }
  criarTexturas() {
    if (this.textures.exists('dust')) return
    let g = this.add.graphics()
    g.fillStyle(0xffffff, 1); g.fillCircle(8, 8, 8); g.generateTexture('dust', 16, 16); g.destroy()

    g = this.add.graphics()
    g.fillStyle(0x6b4a2b, 1); g.fillRect(0, 0, 64, 50)
    g.fillStyle(0x5aa15a, 1); g.fillRect(0, 0, 64, 12)
    g.fillStyle(0x4c8c4c, 1); for (let i = 0; i < 64; i += 10) g.fillTriangle(i, 12, i + 5, 4, i + 10, 12)
    g.fillStyle(0x7a5636, 1); g.fillCircle(20, 34, 3); g.fillCircle(48, 40, 2.5)
    g.generateTexture('chao', 64, 50); g.destroy()

    g = this.add.graphics()
    g.fillStyle(0x33506a, 1)
    for (let x = 25; x < 200; x += 50) { g.fillTriangle(x - 18, 120, x + 18, 120, x, 64); g.fillTriangle(x - 14, 92, x + 14, 92, x, 48); g.fillRect(x - 3, 118, 6, 6) }
    g.generateTexture('ridge', 200, 120); g.destroy()
  }

  resetVars() {
    this.runnerY = 0; this.vy = 0; this.noChao = true
    this.speed = 0; this.score = 0; this.passo = 0
    this.obstaculos = []; this.distSpawn = 0; this.gap = 340
    this.jumpBufferedAt = 0
    this.placar.setText('0')
  }
  iniciar() {
    this.obstaculos.forEach((o) => o.destroy());
    this.resetVars()
    this.speed = 300
    this.estado = 'correndo'
    this.breath?.pause(); this.runner.setScale(1)
  }
  pular() {
    if (this.estado !== 'correndo') return
    if (!this.noChao) { this.jumpBufferedAt = this.time.now; return } // segura o toque no ar
    this.executarPulo()
  }
  executarPulo() {
    this.vy = -840; this.noChao = false; this.jumpBufferedAt = 0
    this.tweens.add({ targets: this.runner, scaleX: 0.86, scaleY: 1.16, yoyo: true, duration: 130, ease: 'Quad.out' })
  }
  aterrissar() {
    this.tweens.add({ targets: this.runner, scaleX: 1.16, scaleY: 0.84, yoyo: true, duration: 130, ease: 'Quad.out' })
    try { if (this.dust) { this.dust.explode(6, RUNNER_X - 10, GROUND_Y - 2) } } catch { /* ok */ }
  }
  morrer() {
    if (this.estado !== 'correndo') return
    this.estado = 'fim'
    this.dust?.stop()
    this.cameras.main.shake(230, 0.014)
    this.cameras.main.flash(160, 255, 120, 120)
    this.game.events.emit('corrida:fim', this.score)
  }
  spawnObst() {
    const t = this.add.text(W + 30, GROUND_Y + 4, OBST[Math.floor(Math.random() * OBST.length)], { fontSize: '40px' }).setOrigin(0.5, 1)
    t.passou = false
    this.obstaculos.push(t)
  }

  update(time, delta) {
    const dt = Math.min(delta, 50) / 1000

    // nuvens flutuam sempre
    for (const n of this.nuvens) { n.x -= 8 * dt; if (n.x < -50) n.x = W + 50 }

    if (this.estado === 'pronto') { this.ridge.tilePositionX += 18 * dt; this.chao.tilePositionX += 40 * dt; return }
    if (this.estado === 'fim') return

    // acelera com o tempo (sempre jogável: o gap cresce junto)
    this.speed = Math.min(760, this.speed + 9 * dt)

    // física do pulo (passo em segundos → independe do FPS)
    this.vy += 2400 * dt
    this.runnerY += this.vy * dt
    if (this.runnerY >= 0) {
      if (!this.noChao && this.vy > 250) this.aterrissar()
      this.runnerY = 0; this.vy = 0; this.noChao = true
      if (this.jumpBufferedAt && this.time.now - this.jumpBufferedAt <= 140) this.executarPulo()
      else this.jumpBufferedAt = 0
    } else this.noChao = false
    this.runner.y = GROUND_Y + this.runnerY

    // sombra encolhe conforme sobe
    const alto = Math.min(1, -this.runnerY / 150)
    this.sombra.setScale(1 - alto * 0.5).setAlpha(0.18 - alto * 0.1)

    // pernas correndo (no chão) / recolhidas (no ar)
    if (this.noChao) {
      this.passo += dt * 15
      this.perna1.angle = Math.sin(this.passo) * 26
      this.perna2.angle = -Math.sin(this.passo) * 26
    } else { this.perna1.angle = -18; this.perna2.angle = 22 }

    // poeirinha só correndo no chão
    if (this.dust) { if (this.noChao) this.dust.start(); else this.dust.stop() }

    // paralaxe
    this.ridge.tilePositionX += this.speed * 0.28 * dt
    this.chao.tilePositionX += this.speed * dt

    // obstáculos: gera por distância (gap escala com a velocidade)
    this.distSpawn += this.speed * dt
    if (this.distSpawn >= this.gap) {
      this.spawnObst()
      this.distSpawn = 0
      this.gap = Math.max(300, this.speed * 0.95) + Math.random() * 170
    }
    for (const o of this.obstaculos) {
      o.x -= this.speed * dt
      if (!o.passou && o.x < RUNNER_X - 26) { o.passou = true; this.score = Math.min(500, this.score + 1); this.placar.setText(String(this.score)) }
      if (Math.abs(o.x - RUNNER_X) < 27 && this.runnerY > -34) { this.morrer(); break }
    }
    this.obstaculos = this.obstaculos.filter((o) => { if (o.x < -60) { o.destroy(); return false } return true })
  }
}

export default function CorridaPhaser({ onCancelar }) {
  const [fase, setFase] = useState('pronto') // pronto | jogando | fim
  const [pontos, setPontos] = useState(0)
  const [resultado, setResultado] = useState(null)

  const { hostRef, emit } = usePhaserGame(
    { width: W, height: H, backgroundColor: '#2b3a67', banner: false, fps: { target: 60 }, scene: CorridaScene },
    {
      'corrida:fim': async (score) => {
        setPontos(score); setFase('fim'); setResultado(null)
        try { setResultado(await registrarRecorde('corrida', score)) } catch { setResultado('erro') }
      },
    },
  )

  function iniciar() {
    setFase('jogando'); setPontos(0); setResultado(null)
    emit('corrida:start')
  }

  // Espaço/Enter começa (parado) ou joga de novo (fim) — só quando não está jogando
  useEffect(() => {
    const tecla = (e) => {
      if ((e.code === 'Space' || e.code === 'Enter') && fase !== 'jogando') { e.preventDefault(); iniciar() }
    }
    window.addEventListener('keydown', tecla)
    return () => window.removeEventListener('keydown', tecla)
  }, [fase])

  // Enquanto está jogando, tocar em QUALQUER lugar da tela faz pular (mais fácil
  // no celular do que acertar o canvas). A cena ignora o comando se ele já estiver
  // no ar, então não tem pulo duplo.
  useEffect(() => {
    if (fase !== 'jogando') return
    const pular = () => emit('corrida:pular')
    window.addEventListener('pointerdown', pular)
    return () => window.removeEventListener('pointerdown', pular)
  }, [fase])

  return (
    <div className="bg-surface rounded-3xl p-4 sm:p-5 shadow-md text-center">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-extrabold text-muted">🏕️ Corrida do Acampamento</span>
        <button onClick={onCancelar} className="text-xs text-faint p-3 -m-3">Sair</button>
      </div>

      <div className="relative select-none">
        <div ref={hostRef} className="w-full rounded-2xl overflow-hidden border border-line"
          style={{ aspectRatio: `${W} / ${H}`, touchAction: 'none' }} />

        {fase === 'pronto' && (
          <button onClick={iniciar} className="absolute inset-0 grid place-items-center bg-surface/50 rounded-2xl">
            <span className="bg-brand text-white font-extrabold rounded-xl px-5 py-2.5 shadow-glow">▶️ Toque pra correr</span>
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
                <button onClick={iniciar} className="flex-1 rounded-xl bg-brand text-white font-extrabold py-2.5">🔁 De novo</button>
              </div>
            </div>
          </div>
        )}
      </div>
      <p className="text-[11px] text-faint mt-3">Toque em qualquer lugar da tela (ou espaço) pra pular os obstáculos. Sem limite — cada corrida pode virar seu recorde da semana. 🏆</p>
    </div>
  )
}
