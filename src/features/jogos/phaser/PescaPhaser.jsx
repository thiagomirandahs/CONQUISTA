// ===================== 🎣 Pescaria — jogo em PHASER (motor 2D) =====================
// O barquinho navega sozinho de um lado pro outro no topo. TOQUE solta o anzol
// reto pra baixo a partir de onde o barco está — a graça é acertar a HORA do
// toque. Peixes (🐟🐠🐡) nadam em profundidades e velocidades diferentes; a
// bota (🥾) é lixo e tira ponto. Rodada de 45s: >=10 peixes = 3 estrelas,
// >=6 = 2, senão 1. Jogo normal (dá estrelas por onTerminar).
// Lazy — o Phaser só entra no bundle de quem abre um jogo do motor.
import { useState } from 'react'
import { usePhaserGame } from '../hooks/usePhaserGame.js'
import Phaser from 'phaser'
import * as juice from '../../../lib/juice.js'

const W = 360, H = 560
const SUPERFICIE = 112               // linha d'água
const FUNDO = 518                    // areia — o anzol volta vazio daqui
const BARCO_Y = 92
const PONTA_X = 24, PONTA_Y = -26    // ponta da vara (relativa ao barco)
const VEL_DESCE = 430, VEL_SOBE = 540
const RAIO_FISGADA = 28              // alvo generoso: é jogo de criança
const DURACAO = 45                   // segundos de rodada

export class PescaScene extends Phaser.Scene {
  constructor() { super('pesca') }

  create() {
    this.criarTexturas()
    // céu + sol + nuvens
    this.add.rectangle(W / 2, 56, W, SUPERFICIE, 0xbfe6f7)
    this.add.circle(312, 34, 30, 0xfde047, 0.25) // halo do sol
    this.add.circle(312, 34, 19, 0xfde047)
    const nuvem = this.add.graphics()
    nuvem.fillStyle(0xffffff, 0.85)
    nuvem.fillEllipse(70, 32, 62, 20); nuvem.fillEllipse(98, 26, 42, 16)
    nuvem.fillEllipse(200, 48, 52, 16)

    // água em faixas: quanto mais fundo, mais escuro (dá noção de profundidade)
    const tons = [0x38bdf8, 0x2ea5e6, 0x2490d6, 0x1b7cc4, 0x1468b1, 0x0e569e, 0x0a468c]
    tons.forEach((cor, i) => this.add.rectangle(W / 2, SUPERFICIE + 32 + i * 64, W, 64, cor))
    // raios de sol atravessando a água: 2 feixes diagonais em ADD (clima de fundo do mar)
    ;[{ x: 128, a: 16 }, { x: 240, a: 24 }].forEach((r, i) => {
      const feixe = this.add.rectangle(r.x, (SUPERFICIE + FUNDO) / 2, 46, FUNDO - SUPERFICIE + 60, 0xffffff, 0.05)
        .setAngle(r.a).setBlendMode(Phaser.BlendModes.ADD)
      this.tweens.add({ targets: feixe, alpha: { from: 0.03, to: 0.07 }, yoyo: true, repeat: -1, duration: 2600 + i * 800, ease: 'Sine.inOut' })
    })
    // espuma da superfície "respirando"
    const espuma = this.add.rectangle(W / 2, SUPERFICIE, W, 5, 0xffffff, 0.5)
    this.tweens.add({ targets: espuma, alpha: { from: 0.25, to: 0.6 }, yoyo: true, repeat: -1, duration: 900, ease: 'Sine.inOut' })
    // brilhos que piscam na água (vida sem custo de CPU)
    for (let i = 0; i < 3; i++) {
      const brilho = this.add.rectangle(60 + i * 110, 180 + i * 96, 70, 4, 0xffffff, 0.15)
      this.tweens.add({ targets: brilho, alpha: { from: 0.05, to: 0.25 }, yoyo: true, repeat: -1, duration: 1200 + i * 300, ease: 'Sine.inOut' })
    }
    // areia + plantinhas no fundo
    this.add.rectangle(W / 2, 548, W, 26, 0xd8c07c)
    ;[46, 150, 262, 330].forEach((x, i) => {
      const alga = this.add.text(x, 534, '🌿', { fontSize: '20px' }).setOrigin(0.5, 1).setAlpha(0.9).setAngle(i % 2 ? 8 : -8)
      // corrente do fundo: cada alga ginga fora de sincronia (origem na base = pivô certo)
      this.tweens.add({ targets: alga, angle: { from: i % 2 ? 8 : -8, to: i % 2 ? -8 : 8 }, yoyo: true, repeat: -1, duration: 2200 + i * 350, ease: 'Sine.inOut' })
    })

    // barquinho: anda sozinho de ponta a ponta — o jogo é o TIMING do toque
    this.barco = this.desenharBarco()
    this.balanco = this.tweens.add({ targets: this.barco, x: { from: 58, to: 302 }, yoyo: true, repeat: -1, duration: 1600, ease: 'Sine.inOut' })
    // gingado do casco pra parecer que tá na água de verdade
    this.tweens.add({ targets: this.barco, rotation: { from: -0.05, to: 0.05 }, yoyo: true, repeat: -1, duration: 900, ease: 'Sine.inOut' })
    // espuminha na linha d'água: 2 arquinhos desenhados UMA vez; só o x acompanha o casco
    this.espumaBarco = this.add.graphics().setDepth(4)
    this.espumaBarco.lineStyle(2, 0xffffff, 0.3)
    this.espumaBarco.beginPath(); this.espumaBarco.arc(-27, 0, 7, 0, Math.PI, false); this.espumaBarco.strokePath()
    this.espumaBarco.beginPath(); this.espumaBarco.arc(28, 0, 5, 0, Math.PI, false); this.espumaBarco.strokePath()
    this.espumaBarco.setPosition(this.barco.x, SUPERFICIE - 2)
    this.tweens.add({ targets: this.espumaBarco, alpha: { from: 0.5, to: 1 }, yoyo: true, repeat: -1, duration: 700, ease: 'Sine.inOut' })

    // linha + anzol (desenhados na mão — sem asset externo)
    this.gLinha = this.add.graphics().setDepth(5)
    this.hook = this.add.container(0, 0).setDepth(6).setVisible(false)
    const hg = this.add.graphics()
    hg.lineStyle(3, 0xe2e8f0, 1)
    hg.beginPath(); hg.moveTo(0, -4); hg.lineTo(0, 6); hg.strokePath()
    hg.beginPath(); hg.arc(-4, 6, 4, 0, Math.PI * 0.9, false); hg.strokePath() // curva do "J"
    hg.fillStyle(0xef4444, 1); hg.fillCircle(0, -6, 4)                         // isquinha vermelha
    this.hook.add(hg)

    try {
      this.bolhas = this.add.particles(0, 0, 'bolha', {
        lifespan: 700, speed: { min: 30, max: 90 }, angle: { min: 240, max: 300 },
        scale: { start: 0.9, end: 0.2 }, alpha: { start: 0.9, end: 0 }, emitting: false,
      }).setDepth(7)
    } catch { this.bolhas = null }
    // anel do splash: UM só, reutilizado a cada mergulho (nada de criar/destruir por lance)
    this.anelSplash = this.add.circle(0, 0, 12).setStrokeStyle(2, 0xffffff, 0.9).setDepth(7).setVisible(false)

    // HUD dentro do canvas (padrão dos jogos do motor)
    this.gChips = this.add.graphics().setDepth(8) // pastilhas escuras atrás dos textos
    this.pontosTxt = this.add.text(12, 12, '', { fontFamily: 'system-ui', fontSize: '18px', fontStyle: 'bold', color: '#ffffff' }).setDepth(9).setShadow(0, 1, '#0006', 2)
    this.tempoTxt = this.add.text(W - 12, 12, '⏱ ' + DURACAO + 's', { fontFamily: 'system-ui', fontSize: '18px', fontStyle: 'bold', color: '#ffffff' }).setOrigin(1, 0).setDepth(9).setShadow(0, 1, '#0006', 2)
    this.gTempo = this.add.graphics().setDepth(9) // barra de tempo no topo

    // resposta IMEDIATA: o anzol sai NO toque, sem animação antes
    this.input.on('pointerdown', () => this.lancar())

    this.game.events.on('pesca:start', this.iniciar, this)
    this.resetVars()
  }

  criarTexturas() {
    if (this.textures.exists('bolha')) return
    const g = this.add.graphics()
    g.fillStyle(0xffffff, 1); g.fillCircle(4, 4, 4); g.generateTexture('bolha', 8, 8); g.destroy()
  }

  desenharBarco() {
    const c = this.add.container(W / 2, BARCO_Y).setDepth(4)
    const g = this.add.graphics()
    g.fillStyle(0x92400e, 1); g.fillRoundedRect(-36, -2, 72, 18, { tl: 4, tr: 4, bl: 12, br: 12 }) // casco
    g.fillStyle(0xb45309, 1); g.fillRoundedRect(-36, -2, 72, 6, 3)                                 // borda do casco
    g.fillStyle(0xef4444, 1); g.fillRoundedRect(-16, -22, 16, 20, 5)                               // camisa
    g.fillStyle(0xf2c795, 1); g.fillCircle(-8, -28, 6)                                             // cabeça
    g.fillStyle(0xf5c518, 1); g.fillRoundedRect(-17, -35, 18, 5, 2)                                // chapéu
    g.lineStyle(3, 0x713f12, 1); g.beginPath(); g.moveTo(-4, -20); g.lineTo(PONTA_X, PONTA_Y); g.strokePath() // vara
    c.add(g)
    return c
  }

  resetVars() {
    this.estado = 'pronto'
    this.pontos = 0; this.combo = 0
    this.nadadores = []
    this.pego = null
    this.anzol = { estado: 'guardado', x: 0, y: 0 }
    this.ultimoSeg = DURACAO
    this.atualizarHud()
  }

  iniciar() {
    // limpa restos (caso raro de reinício na mesma montagem)
    this.nadadores.forEach((n) => n.destroy()); this.nadadores = []
    if (this.pego) { this.pego.destroy(); this.pego = null }
    this.pontos = 0; this.combo = 0
    this.anzol = { estado: 'guardado', x: 0, y: 0 }
    this.hook.setVisible(false); this.gLinha.clear()
    this.estado = 'jogando'
    this.fimEm = this.time.now + DURACAO * 1000
    this.ultimoSeg = DURACAO + 1
    this.spawner?.remove()
    this.spawner = this.time.addEvent({ delay: 650, loop: true, callback: this.spawnNadador, callbackScope: this })
    // já começa com peixe na água — os primeiros segundos não podem ser vazios
    for (let i = 0; i < 5; i++) this.spawnNadador(true)
    this.balanco?.resume()
    this.atualizarHud()
    // entrada da rodada: barco dá um "pop" e o HUD surge — sensação de vivo
    this.barco.setScale(0.92)
    this.tweens.add({ targets: this.barco, scale: 1, duration: 260, ease: 'Back.out' })
    ;[this.pontosTxt, this.tempoTxt, this.gChips].forEach((el) => el.setAlpha(0))
    this.tweens.add({ targets: [this.pontosTxt, this.tempoTxt, this.gChips], alpha: 1, duration: 280 })
  }

  atualizarHud() { this.pontosTxt.setText('🐟 ' + this.pontos); this.desenharChips() }

  // chips do HUD: pastilha translúcida atrás de cada texto — legível em qualquer fundo.
  // Redesenha só quando um texto MUDA (1x/seg ou na fisgada), nunca por frame.
  desenharChips() {
    if (!this.gChips) return
    this.gChips.clear()
    this.gChips.fillStyle(0x0f172a, 0.35)
    ;[this.pontosTxt, this.tempoTxt].forEach((t) => {
      const b = t.getBounds()
      this.gChips.fillRoundedRect(b.x - 10, b.y - 5, b.width + 20, b.height + 10, 12)
    })
  }

  // splash: o anzol FURA a superfície — bolhinhas brancas + anelzinho que expande e some
  splash(x) {
    try { this.bolhas?.explode(5, x, SUPERFICIE) } catch { /* ok */ }
    this.anelSplash.setPosition(x, SUPERFICIE).setScale(0.3).setAlpha(0.8).setVisible(true)
    this.tweens.add({ targets: this.anelSplash, scale: 1.6, alpha: 0, duration: 320, ease: 'Quad.out', onComplete: () => this.anelSplash.setVisible(false) })
  }

  // peixes (e às vezes uma bota) entram pelos dois lados, em profundidades
  // e velocidades diferentes — cada mergulho do anzol é uma escolha
  spawnNadador(jaNaTela) {
    if (this.estado !== 'jogando' && !jaNaTela) return
    const daEsq = Math.random() < 0.5
    const ehBota = Math.random() < 0.2 // ~1 em 5 é lixo: o suficiente pra dar medo
    const emoji = ehBota ? '🥾' : ['🐟', '🐠', '🐡'][Phaser.Math.Between(0, 2)]
    const x = jaNaTela ? Phaser.Math.Between(40, 320) : (daEsq ? -34 : W + 34)
    const t = this.add.text(x, 0, emoji, { fontSize: Phaser.Math.Between(26, 34) + 'px' }).setOrigin(0.5).setDepth(3)
    t.baseY = Phaser.Math.Between(175, 505)
    t.y = t.baseY
    t.fase = Math.random() * Math.PI * 2 // cada um ondula fora de sincronia
    t.vx = (daEsq ? 1 : -1) * Phaser.Math.Between(55, 130)
    // emoji de peixe olha pra ESQUERDA na maioria das fontes; indo pra direita, espelha
    t.setFlipX(t.vx > 0)
    t.tipo = ehBota ? 'bota' : 'peixe'
    // nado de verdade: rabanada sutil oscilando (o bob no y já acontece no update)
    this.tweens.add({ targets: t, angle: { from: -5, to: 5 }, yoyo: true, repeat: -1, duration: Phaser.Math.Between(420, 640), ease: 'Sine.inOut' })
    // entra suave, sem "pipocar" na tela
    t.setAlpha(0); this.tweens.add({ targets: t, alpha: 1, duration: 220 })
    this.nadadores.push(t)
  }

  lancar() {
    if (this.estado !== 'jogando' || this.anzol.estado !== 'guardado') return // um lançamento por vez
    this.balanco?.pause() // o pescador para o barco enquanto pesca (linha fica reta)
    this.anzol.x = this.barco.x + PONTA_X
    this.anzol.y = this.barco.y + PONTA_Y + 8
    this.anzol.estado = 'descendo'
    this.anzol.molhou = false // splash sai na hora EXATA em que furar a água (no update)
    this.hook.setPosition(this.anzol.x, this.anzol.y).setVisible(true)
    // pop curtinho no anzol: resposta viva ao toque, sem atrasar nada
    this.hook.setScale(0.7); this.tweens.add({ targets: this.hook, scale: 1, duration: 140, ease: 'Back.out' })
  }

  checarFisgada() {
    for (const n of this.nadadores) {
      if (Math.hypot(n.x - this.anzol.x, n.y - this.anzol.y) < RAIO_FISGADA) { this.fisgar(n); return }
    }
  }

  fisgar(n) {
    this.pego = n
    this.nadadores.splice(this.nadadores.indexOf(n), 1) // para de nadar: agora é do anzol
    this.tweens.killTweensOf(n); n.setAlpha(1) // corta o nado (angle/alpha) pra assumir o balanço
    this.anzol.estado = 'subindo'
    // squash: o bicho "pula" fisgado
    this.tweens.add({ targets: n, scaleX: 1.25, scaleY: 0.75, yoyo: true, duration: 110 })
    // pendurado no anzol: balança enquanto sobe (pendulozinho)
    n.setAngle(-14)
    this.tweens.add({ targets: n, angle: 14, yoyo: true, repeat: -1, duration: 170, ease: 'Sine.inOut' })
    try { this.bolhas?.explode(8, this.anzol.x, this.anzol.y) } catch { /* ok */ }
    // pontua NA fisgada (feedback imediato); a subida é só a comemoração
    if (n.tipo === 'peixe') {
      this.pontos++; this.combo++
      this.flutuante('+1', '#fde047')
      this.game.events.emit('pesca:resultado', 'peixe', this.combo)
    } else {
      this.pontos = Math.max(0, this.pontos - 1); this.combo = 0
      this.flutuante('-1', '#fca5a5')
      this.cameras.main.shake(180, 0.008)
      this.game.events.emit('pesca:resultado', 'bota', 0)
    }
    this.atualizarHud()
  }

  flutuante(txt, cor) {
    const t = this.add.text(this.anzol.x, this.anzol.y - 14, txt, { fontFamily: 'system-ui', fontSize: '22px', fontStyle: 'bold', color: cor }).setOrigin(0.5).setDepth(8).setShadow(0, 1, '#0008', 3)
    this.tweens.add({ targets: t, y: t.y - 44, alpha: 0, duration: 700, ease: 'Quad.out', onComplete: () => t.destroy() })
  }

  recolher() {
    const p = this.pego
    if (p) {
      this.tweens.killTweensOf(p) // para o balanço do pêndulo antes de voar
      // o que veio no anzol voa pro barco e some (foi pro balde!)
      this.tweens.add({ targets: p, x: this.barco.x, y: this.barco.y - 18, scale: 0, alpha: 0, duration: 220, ease: 'Quad.in', onComplete: () => p.destroy() })
      this.tweens.add({ targets: this.barco, scaleX: 1.1, scaleY: 0.88, yoyo: true, duration: 120 })
    }
    this.pego = null
    this.anzol.estado = 'guardado'
    this.hook.setVisible(false)
    this.gLinha.clear()
    this.balanco?.resume() // barco volta a navegar
  }

  terminar() {
    this.estado = 'fim'
    this.spawner?.remove()
    this.gLinha.clear(); this.hook.setVisible(false)
    if (this.pego) { this.pego.destroy(); this.pego = null }
    this.game.events.emit('pesca:fim', this.pontos)
  }

  update(time, delta) {
    // espuminha acompanha o casco SEMPRE (o barco navega até fora da rodada)
    if (this.espumaBarco) this.espumaBarco.x = this.barco.x
    if (this.estado !== 'jogando') return
    const dt = delta / 1000

    // relógio + barra de tempo (verde -> amarelo -> vermelho)
    const restante = Math.max(0, this.fimEm - this.time.now)
    const seg = Math.ceil(restante / 1000)
    if (seg !== this.ultimoSeg) {
      this.ultimoSeg = seg
      this.tempoTxt.setText('⏱ ' + seg + 's')
      this.desenharChips() // pastilha acompanha o texto novo (1x/seg, custo zero)
      if (seg <= 5 && seg > 0) this.tweens.add({ targets: this.tempoTxt, scale: { from: 1.3, to: 1 }, duration: 200 }) // reta final pulsa
    }
    this.gTempo.clear()
    this.gTempo.fillStyle(0x000000, 0.25); this.gTempo.fillRect(0, 0, W, 5)
    this.gTempo.fillStyle(restante > 15000 ? 0x22c55e : restante > 7000 ? 0xf5c518 : 0xef4444, 1)
    this.gTempo.fillRect(0, 0, W * (restante / (DURACAO * 1000)), 5)
    if (restante <= 0) { this.terminar(); return }

    // cardume: nada na horizontal + ondinha vertical pra parecer vivo
    for (let i = this.nadadores.length - 1; i >= 0; i--) {
      const n = this.nadadores[i]
      n.x += n.vx * dt
      n.y = n.baseY + Math.sin(time / 400 + n.fase) * 4
      if (n.x < -50 || n.x > W + 50) { n.destroy(); this.nadadores.splice(i, 1) }
    }

    // anzol: desce reto; ao encostar em algo (ou no fundo) sobe puxando
    if (this.anzol.estado === 'descendo') {
      this.anzol.y += VEL_DESCE * dt
      // furou a superfície AGORA: splash (partículas + anel), uma vez por lance
      if (!this.anzol.molhou && this.anzol.y >= SUPERFICIE) { this.anzol.molhou = true; this.splash(this.anzol.x) }
      if (this.anzol.y >= FUNDO) { this.anzol.y = FUNDO; this.anzol.estado = 'subindo' }
      else this.checarFisgada()
    } else if (this.anzol.estado === 'subindo') {
      this.anzol.y -= VEL_SOBE * dt
      if (this.pego) { this.pego.x = this.anzol.x; this.pego.y = this.anzol.y + 12 } // a presa vem junto
      if (this.anzol.y <= SUPERFICIE - 24) { this.recolher() }
    }
    if (this.anzol.estado !== 'guardado') {
      this.hook.setPosition(this.anzol.x, this.anzol.y)
      this.gLinha.clear()
      this.gLinha.lineStyle(2, 0xf8fafc, 0.9)
      this.gLinha.beginPath()
      this.gLinha.moveTo(this.barco.x + PONTA_X, this.barco.y + PONTA_Y)
      this.gLinha.lineTo(this.anzol.x, this.anzol.y - 6)
      this.gLinha.strokePath()
    }
  }
}

export default function PescaPhaser({ onTerminar, onCancelar }) {
  const [fase, setFase] = useState('pronto')
  const [peixes, setPeixes] = useState(0)
  const estrelasDe = (n) => (n >= 10 ? 3 : n >= 6 ? 2 : 1)

  const { hostRef, emit } = usePhaserGame(
    { width: W, height: H, backgroundColor: '#0a468c', banner: false, fps: { target: 60 }, scene: PescaScene },
    {
      'pesca:resultado': (tipo, combo) => { if (tipo === 'peixe') juice.acerto(combo); else juice.erro() },
      'pesca:fim': (n) => { setPeixes(n); setFase('fim') },
    },
  )

  function iniciar() { setFase('jogando'); setPeixes(0); emit('pesca:start') }

  return (
    <div className="bg-surface rounded-3xl p-4 sm:p-5 shadow-md text-center">
      {/* pop do banner de resultado (efeito Back.out em CSS) */}
      <style>{'@keyframes pescaPop{from{transform:scale(.92);opacity:0}to{transform:scale(1);opacity:1}}'}</style>
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-extrabold text-muted">🎣 Pescaria</span>
        <button onClick={onCancelar} className="text-xs text-faint p-3 -m-3">Sair</button>
      </div>

      <div className="relative select-none mx-auto" style={{ maxWidth: 360 }}>
        <div ref={hostRef} className="w-full rounded-2xl overflow-hidden border border-line" style={{ aspectRatio: `${W} / ${H}`, touchAction: 'none' }} />

        {fase === 'pronto' && (
          <button onClick={iniciar} className="absolute inset-0 grid place-items-center bg-blue-900/40 rounded-2xl">
            <span className="bg-brand text-white font-extrabold rounded-xl px-5 py-2.5 shadow-glow">🎣 Toque pra pescar</span>
          </button>
        )}

        {fase === 'fim' && (
          <div className="absolute inset-0 grid place-items-center bg-blue-950/85 rounded-2xl p-4">
            {/* pastilha translúcida atrás do resultado — faz pop junto (e some junto no unmount) */}
            <div className="rounded-2xl px-5 py-4" style={{ background: 'rgba(15,23,42,0.55)', animation: 'pescaPop .28s cubic-bezier(.34,1.56,.64,1) both' }}>
              <div className="text-4xl mb-1">🪣</div>
              <p className="font-extrabold text-white text-lg">Você pescou {peixes} {peixes === 1 ? 'peixe' : 'peixes'}!</p>
              <p className="text-sm font-bold text-gold mt-1">{'⭐'.repeat(estrelasDe(peixes))}</p>
              <div className="flex gap-2 mt-4 max-w-[280px] mx-auto">
                <button onClick={onCancelar} className="flex-1 rounded-xl bg-surface2 text-ink font-semibold py-2.5">Sair</button>
                <button onClick={() => onTerminar(estrelasDe(peixes))} className="flex-1 rounded-xl bg-brand text-white font-extrabold py-2.5">Concluir 🎉</button>
              </div>
            </div>
          </div>
        )}
      </div>
      <p className="text-[11px] text-faint mt-3">O barquinho anda sozinho — toque na hora certa pra soltar o anzol! Pegue os peixes 🐟🐠🐡 e fuja das botas 🥾. Quantos você pesca em 45 segundos?</p>
    </div>
  )
}
