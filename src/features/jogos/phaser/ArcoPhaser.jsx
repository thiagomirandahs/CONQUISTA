// ===================== 🏹 Arco e Flecha — jogo em PHASER (motor 2D) =====================
// Atira 5 flechas no alvo: ARRASTE pra trás (de qualquer lugar) pra puxar a
// corda — quanto mais puxa, mais forte; solte pra atirar. A mira mostra o voo
// SEM o vento — o vento 💨 (mostrado no topo) empurra a flecha no ar e é o
// desafio da vez. Anéis: branco 1pt, azul 2pts, centro vermelho 3pts (máx 15).
// 12+ = 3 estrelas, 7+ = 2, senão 1. Jogo normal (dá estrelas por onTerminar).
// Lazy — o Phaser só entra no bundle de quem abre um jogo do motor.
import { useState } from 'react'
import { usePhaserGame } from '../hooks/usePhaserGame.js'
import Phaser from 'phaser'
import * as juice from '../../../lib/juice.js'

const W = 360, H = 520
const CHAO = 468                 // linha do chão (grama começa aqui)
const ARQ_X = 58, ARQ_Y = 410    // mão do arqueiro = âncora do arco
const GRAV = 620                 // gravidade da flecha (px/s²)
const PUXAO_MIN = 24             // arrasto menor que isso não atira (evita toque acidental)
const PUXAO_MAX = 130            // puxada máxima (força máxima)
const R_FORA = 44, R_MEIO = 29, R_CENTRO = 14 // anéis do alvo (1, 2 e 3 pontos)

export class ArcoScene extends Phaser.Scene {
  constructor() { super('arco') }

  create() {
    this.criarTexturas()
    this.desenharCenario()
    this.desenharArqueiro()
    this.desenharBraco()
    this.alvo = this.desenharAlvo()
    this.gAim = this.add.graphics().setDepth(5)

    // poeira (errou no chão) e faísca (acertou o alvo) — com fallback se o
    // aparelho não aguentar partículas (padrão do projeto)
    try {
      this.poeira = this.add.particles(0, 0, 'graozinho', {
        lifespan: 500, speed: { min: 40, max: 120 }, angle: { min: 230, max: 310 },
        gravityY: 320, scale: { start: 1, end: 0 }, tint: [0xd6c9a8, 0xbfae8a, 0xffffff], emitting: false,
      }).setDepth(8)
    } catch { this.poeira = null }
    try {
      this.faisca = this.add.particles(0, 0, 'graozinho', {
        lifespan: 420, speed: { min: 60, max: 190 }, gravityY: 200,
        scale: { start: 1.2, end: 0 }, tint: [0xfde047, 0xffffff, 0xef4444], emitting: false,
      }).setDepth(8)
    } catch { this.faisca = null }

    // HUD dentro do canvas (flechas, vento e pontos) — chips escuros atrás
    // dão leitura garantida sobre o céu claro
    this.hudBg = this.add.graphics().setDepth(8)
    this.flechaTxt = this.add.text(12, 10, '', { fontFamily: 'system-ui', fontSize: '18px', fontStyle: 'bold', color: '#ffffff' }).setDepth(9).setShadow(0, 1, '#0006', 2)
    this.ventoTxt = this.add.text(W / 2, 10, '', { fontFamily: 'system-ui', fontSize: '16px', fontStyle: 'bold', color: '#ffffff' }).setOrigin(0.5, 0).setDepth(9).setShadow(0, 1, '#0006', 2)
    this.ptsTxt = this.add.text(W - 12, 10, '', { fontFamily: 'system-ui', fontSize: '18px', fontStyle: 'bold', color: '#ffffff' }).setOrigin(1, 0).setDepth(9).setShadow(0, 1, '#0006', 2)
    // banner de resultado num container com pastilha atrás — pop e fade JUNTOS
    this.bannerBg = this.add.graphics()
    this.banner = this.add.text(0, 0, '', { fontFamily: 'system-ui', fontSize: '38px', fontStyle: 'bold', color: '#ffffff' }).setOrigin(0.5).setShadow(0, 2, '#0008', 4)
    this.bannerBox = this.add.container(W / 2, 270, [this.bannerBg, this.banner]).setDepth(9).setAlpha(0)

    // arrastar pra trás = puxar a corda (começa de qualquer lugar da tela)
    this.input.on('pointerdown', (p) => { if (this.estado === 'mirando') this._aim = { x: p.x, y: p.y } })
    this.input.on('pointermove', (p) => { if (this.estado === 'mirando' && this._aim && p.isDown) this.previa(p) })
    this.input.on('pointerup', (p) => { if (this.estado === 'mirando' && this._aim) this.soltar(p) })

    this.game.events.on('arco:start', this.iniciar, this)
    this.resetVars()
  }

  criarTexturas() {
    if (!this.textures.exists('graozinho')) {
      const g = this.add.graphics()
      g.fillStyle(0xffffff, 1); g.fillCircle(3, 3, 3); g.generateTexture('graozinho', 6, 6); g.destroy()
    }
    if (!this.textures.exists('folhinha')) {
      // oval branca: vira folha/pétala com o tint do emissor de vento
      const f = this.add.graphics()
      f.fillStyle(0xffffff, 1); f.fillEllipse(4, 3, 7, 4); f.generateTexture('folhinha', 8, 6); f.destroy()
    }
  }

  desenharCenario() {
    // céu em faixas = gradiente "na unha" (funciona igual em WebGL e Canvas)
    const tons = [0x7dc4ea, 0x8fd0f0, 0xa5daf5, 0xbde4f9]
    tons.forEach((cor, i) => this.add.rectangle(W / 2, 40 + i * 80, W, 80, cor))
    const sol = this.add.graphics()
    sol.fillStyle(0xfde047, 0.25); sol.fillCircle(46, 92, 32) // halo
    sol.fillStyle(0xfde047, 1); sol.fillCircle(46, 92, 18)
    const nuvem = this.add.graphics()
    nuvem.fillStyle(0xffffff, 0.85)
    nuvem.fillEllipse(150, 62, 78, 26); nuvem.fillEllipse(178, 54, 54, 20)
    nuvem.fillEllipse(268, 240, 88, 26); nuvem.fillEllipse(240, 232, 50, 18)
    // morros no horizonte dão profundidade sem custar nada
    const morro = this.add.graphics()
    morro.fillStyle(0x2f7a3b, 0.55); morro.fillEllipse(80, CHAO, 300, 110)
    morro.fillStyle(0x2f7a3b, 0.35); morro.fillEllipse(310, CHAO, 340, 80)
    // grama
    this.add.rectangle(W / 2, (CHAO + H) / 2, W, H - CHAO, 0x3fa34d)
    const detalhe = this.add.graphics()
    detalhe.fillStyle(0x37963f, 0.6); detalhe.fillRect(0, CHAO, W, 6)
    detalhe.fillStyle(0xf5c518, 0.8) // florzinhas
    ;[40, 130, 210, 300].forEach((x, i) => detalhe.fillCircle(x, CHAO + 18 + (i % 2) * 16, 3))
  }

  desenharArqueiro() {
    // desenhado RELATIVO aos pés (pivô): assim o corpo pode inclinar de leve
    // junto com a puxada sem redesenhar nada
    const g = this.add.graphics().setDepth(3)
    g.setPosition(ARQ_X, ARQ_Y + 52)
    g.fillStyle(0x1f2937, 1); g.fillRoundedRect(-20, -26, 8, 26, 3); g.fillRoundedRect(-8, -26, 8, 26, 3) // pernas
    g.fillStyle(0x2563eb, 1); g.fillRoundedRect(-24, -58, 26, 36, 8)   // túnica
    g.fillStyle(0x2563eb, 1); g.fillRoundedRect(-12, -54, 16, 7, 3)    // braço esticado segurando o arco
    g.fillStyle(0xf2c795, 1); g.fillCircle(-10, -70, 9)                // cabeça
    g.fillStyle(0xef4444, 1); g.fillRoundedRect(-19, -77, 18, 5, 2)    // faixa de campeão
    this.corpo = g
  }

  // arco + corda ficam num container que GIRA pro ângulo da mira — o arqueiro
  // "acompanha" o dedo da criança
  desenharBraco() {
    this.braco = this.add.container(ARQ_X, ARQ_Y).setDepth(4)
    const arco = this.add.graphics()
    arco.lineStyle(5, 0x7c3e10, 1)
    arco.beginPath(); arco.arc(0, 0, 26, -1.2, 1.2); arco.strokePath()
    arco.fillStyle(0x5b2f0d, 1); arco.fillCircle(26, 0, 4) // empunhadura
    this.corda = this.add.graphics()
    this.braco.add([arco, this.corda])
    this.braco.rotation = -0.6 // repouso: apontando pro alto, na direção do alvo
  }

  // corda com vértice puxado + flecha encaixada (só enquanto mira)
  desenharCorda(puxada, comFlecha) {
    const tx = Math.cos(1.2) * 26, ty = Math.sin(1.2) * 26 // pontas do arco
    const vx = tx - puxada
    const g = this.corda; g.clear()
    g.lineStyle(2, 0xf8fafc, 0.9)
    g.beginPath(); g.moveTo(tx, -ty); g.lineTo(vx, 0); g.lineTo(tx, ty); g.strokePath()
    if (comFlecha) {
      g.lineStyle(3, 0x8b5a2b, 1); g.beginPath(); g.moveTo(vx, 0); g.lineTo(vx + 30, 0); g.strokePath()
      g.fillStyle(0x94a3b8, 1); g.fillTriangle(vx + 35, 0, vx + 27, -4, vx + 27, 4)
      g.fillStyle(0xe2e8f0, 1); g.fillTriangle(vx + 35, 0, vx + 27, -4, vx + 27, 0) // brilho metálico da ponta
      g.fillStyle(0xef4444, 1); g.fillTriangle(vx, 0, vx - 6, -5, vx + 2, -5); g.fillTriangle(vx, 0, vx - 6, 5, vx + 2, 5)
      g.fillStyle(0xffffff, 1); g.fillTriangle(vx + 4, 0, vx - 1, -4, vx + 5, -4); g.fillTriangle(vx + 4, 0, vx - 1, 4, vx + 5, 4) // pena branca
    }
  }

  desenharAlvo() {
    const c = this.add.container(285, 160).setDepth(4)
    // cavalete de madeira (2 pernas em A + travessa) — o alvo deixa de "flutuar"
    // e balança junto no impacto, porque está no mesmo container
    const sup = this.add.graphics()
    sup.lineStyle(6, 0x7c3e10, 1)
    sup.beginPath(); sup.moveTo(-16, 8); sup.lineTo(-30, R_FORA + 34); sup.strokePath()
    sup.beginPath(); sup.moveTo(16, 8); sup.lineTo(30, R_FORA + 34); sup.strokePath()
    sup.lineStyle(5, 0x5b2f0d, 1)
    sup.beginPath(); sup.moveTo(-24, R_FORA + 14); sup.lineTo(24, R_FORA + 14); sup.strokePath()
    c.add(sup)
    const g = this.add.graphics()
    g.fillStyle(0x000000, 0.15); g.fillCircle(3, 5, R_FORA + 2)      // sombra
    g.fillStyle(0xffffff, 1); g.fillCircle(0, 0, R_FORA)             // branco = 1pt
    g.lineStyle(2, 0x94a3b8, 1); g.strokeCircle(0, 0, R_FORA)
    g.fillStyle(0x3b82f6, 1); g.fillCircle(0, 0, R_MEIO)             // azul = 2pts
    g.fillStyle(0xef4444, 1); g.fillCircle(0, 0, R_CENTRO)           // vermelho = 3pts
    g.fillStyle(0xffffff, 0.9); g.fillCircle(0, 0, 3)                // mosca
    c.add(g)
    return c
  }

  criarFlecha() {
    const c = this.add.container(0, 0).setDepth(6)
    const g = this.add.graphics()
    g.lineStyle(3, 0x8b5a2b, 1); g.beginPath(); g.moveTo(-15, 0); g.lineTo(13, 0); g.strokePath() // haste
    g.fillStyle(0x94a3b8, 1); g.fillTriangle(17, 0, 9, -4, 9, 4)                                  // ponta
    g.fillStyle(0xe2e8f0, 1); g.fillTriangle(17, 0, 9, -4, 9, 0)                                  // brilho metálico
    g.fillStyle(0xef4444, 1); g.fillTriangle(-15, 0, -21, -5, -13, -5); g.fillTriangle(-15, 0, -21, 5, -13, 5) // penas
    g.fillStyle(0xffffff, 1); g.fillTriangle(-11, 0, -16, -4, -10, -4); g.fillTriangle(-11, 0, -16, 4, -10, 4) // pena branca
    c.add(g)
    return c
  }

  resetVars() {
    this.estado = 'pronto'
    this.flechaN = 0; this.pontos = 0; this.vento = 0
    this._aim = null; this.flecha = null; this.cravadas = []
    this.desenharCorda(0, false)
    this.atualizarHud()
  }

  iniciar() {
    this.flechaN = 0; this.pontos = 0
    this.cravadas.forEach((f) => f.destroy()); this.cravadas = [] // limpa flechas da rodada passada
    this.novaFlecha()
  }

  atualizarHud() {
    this.flechaTxt.setText('🏹 ' + Math.min(this.flechaN + (this.estado === 'fim' ? 0 : 1), 5) + '/5')
    this.ptsTxt.setText('🎯 ' + this.pontos)
    this.desenharChips()
  }

  novaFlecha() {
    this.flecha = null; this._aim = null
    // alvo muda de lugar/distância a cada flecha — nunca fica decoreba
    const tx = Phaser.Math.Between(238, 310), ty = Phaser.Math.Between(118, 208)
    this.tweens.add({ targets: this.alvo, x: tx, y: ty, duration: 320, ease: 'Quad.out' })
    this.sortearVento()
    this.vibra?.remove(); this.vibra = null // corda para de vibrar antes de encaixar a próxima
    this.braco.rotation = -0.6
    this.corpo.rotation = 0
    this.desenharCorda(0, true)
    // entradinha da rodada: braço e alvo dão um "pop" curtinho — sensação de vivo
    this.braco.setScale(0.92)
    this.tweens.add({ targets: this.braco, scale: 1, duration: 240, ease: 'Back.out' })
    this.alvo.setScale(0.92)
    this.tweens.add({ targets: this.alvo, scale: 1, duration: 260, ease: 'Back.out' })
    this.estado = 'mirando'
    this.atualizarHud()
  }

  sortearVento() {
    // força 0–3 com mais chance de vento fraco; o número do HUD é EXATAMENTE
    // o que a física usa — criança aprende a compensar olhando a setinha
    const forca = [0, 1, 1, 2, 2, 3][Math.floor(Math.random() * 6)]
    const dir = Math.random() < 0.5 ? -1 : 1
    this.vento = forca * 45 * dir // empurrão horizontal (px/s²)
    const seta = forca === 0 ? '·' : (dir > 0 ? '→' : '←').repeat(forca)
    this.ventoTxt.setText('💨 ' + seta + ' ' + forca)
    this.desenharChips()
    this.atualizarVentoFx()
  }

  // chips escuros translúcidos atrás dos textos do HUD (redesenha só quando o
  // texto muda — nunca por frame)
  desenharChips() {
    const g = this.hudBg; g.clear()
    g.fillStyle(0x0f172a, 0.35)
    ;[this.flechaTxt, this.ventoTxt, this.ptsTxt].forEach((t) => {
      if (!t.text) return
      const b = t.getBounds()
      g.fillRoundedRect(b.x - 10, b.y - 5, b.width + 20, b.height + 10, 12)
    })
  }

  // folhinhas flutuando na direção/força do vento — a criança VÊ o vento, não
  // só a setinha; recriado 1x por flecha (nunca por frame)
  atualizarVentoFx() {
    try {
      this.folhas?.destroy(); this.folhas = null
      if (!this.vento) return // sem vento = ar parado
      const forca = Math.abs(this.vento) / 45
      const a = this.vento * 0.8, b = this.vento * 1.5
      this.folhas = this.add.particles(0, 0, 'folhinha', {
        x: this.vento > 0 ? -12 : W + 12, y: { min: 24, max: CHAO - 40 },
        lifespan: { min: 4500, max: 8000 }, frequency: 520 - forca * 120, quantity: 1,
        speedX: { min: Math.min(a, b), max: Math.max(a, b) }, speedY: { min: -10, max: 22 },
        alpha: { start: 0.35, end: 0 }, scale: { min: 0.7, max: 1.3 },
        rotate: { min: 0, max: 360 }, tint: [0x86efac, 0x4ade80, 0xfda4af],
      }).setDepth(2)
    } catch { this.folhas = null }
  }

  // arrasto -> mira: puxar pra trás atira pro lado OPOSTO (estilingue)
  miraDoArrasto(p) {
    const dx = this._aim.x - p.x, dy = this._aim.y - p.y
    const dist = Math.hypot(dx, dy)
    const forte = dist >= PUXAO_MIN
    const ang = Math.atan2(dy, dx)
    const vel = 180 + Math.min(dist, PUXAO_MAX) * 4.2 // mais puxada = mais rápido
    const puxada = Math.min(dist, PUXAO_MAX) / PUXAO_MAX
    return { ang, vel, forte, puxada }
  }

  previa(p) {
    const { ang, vel, forte, puxada } = this.miraDoArrasto(p)
    this.braco.rotation = ang
    this.corpo.rotation = -0.05 - puxada * 0.12 // corpo inclina pra trás junto com a força da puxada
    this.desenharCorda(puxada * 16, true)
    // pontinhos de previsão SEM vento (de propósito — o vento é o desafio)
    const g = this.gAim; g.clear()
    const x0 = ARQ_X + Math.cos(ang) * 14, y0 = ARQ_Y + Math.sin(ang) * 14
    const vx = Math.cos(ang) * vel, vy = Math.sin(ang) * vel
    for (let i = 1; i <= 9; i++) {
      const t = i * 0.07
      const x = x0 + vx * t
      const y = y0 + vy * t + 0.5 * GRAV * t * t
      if (y > CHAO) break
      g.fillStyle(forte ? 0xf5c518 : 0xffffff, (forte ? 0.9 : 0.35) * (1 - i * 0.08))
      g.fillCircle(x, y, forte ? 4 - i * 0.25 : 3)
    }
  }

  soltar(p) {
    const { ang, vel, forte } = this.miraDoArrasto(p)
    this._aim = null
    this.gAim.clear()
    if (!forte) { this.corpo.rotation = 0; this.desenharCorda(0, true); return } // puxou de leve: não gasta flecha
    this.atirar(ang, vel)
  }

  atirar(ang, vel) {
    this.estado = 'voando'
    this.desenharCorda(0, false) // corda estala de volta já neste frame…
    // …e VIBRA: amplitude decai até parar (~250ms, 1 tween leve)
    this.vibra?.remove()
    const v = { t: 0 }
    this.vibra = this.tweens.add({
      targets: v, t: 1, duration: 250,
      onUpdate: () => this.desenharCorda(Math.sin(v.t * Math.PI * 6) * 6 * (1 - v.t), false),
      onComplete: () => { this.vibra = null; this.desenharCorda(0, false) },
    })
    this.tweens.add({ targets: this.braco, scaleX: 0.88, scaleY: 1.1, yoyo: true, duration: 90 }) // recuo do arco
    this.tweens.add({ targets: this.corpo, rotation: 0, duration: 120, ease: 'Quad.out' })        // corpo volta ao prumo
    this.flecha = this.criarFlecha()
    this.flecha.setPosition(ARQ_X + Math.cos(ang) * 18, ARQ_Y + Math.sin(ang) * 18)
    this.flecha.rotation = ang
    this.fvx = Math.cos(ang) * vel
    this.fvy = Math.sin(ang) * vel
    this._px = null; this._py = null // posição da ponta no frame anterior (pro cruze do alvo)
  }

  // física da flecha frame a frame (gravidade + vento), girando com a velocidade
  update(_, delta) {
    if (this.estado !== 'voando' || !this.flecha) return
    const dt = Math.min(delta, 33) / 1000 // trava o dt: aba em 2º plano não teleporta a flecha
    this.fvx += this.vento * dt
    this.fvy += GRAV * dt
    this.flecha.x += this.fvx * dt
    this.flecha.y += this.fvy * dt
    this.flecha.rotation = Math.atan2(this.fvy, this.fvx)
    // a PONTA (17px à frente do centro) é o que conta pra acertar
    const px = this.flecha.x + Math.cos(this.flecha.rotation) * 17
    const py = this.flecha.y + Math.sin(this.flecha.rotation) * 17
    // O acerto é medido quando a ponta CRUZA a linha vertical do alvo: o anel
    // vem da distância em ALTURA até o centro (alvo de verdade, visto de lado).
    // Antes cravava no 1º toque na borda de FORA → era impossível passar do
    // anel branco (bug apontado pelo dono). Interpola o ponto exato do cruze.
    if (this.fvx > 0 && this._px != null && this._px < this.alvo.x && px >= this.alvo.x) {
      const t = (this.alvo.x - this._px) / (px - this._px)
      const pyCross = this._py + (py - this._py) * t
      const dy = Math.abs(pyCross - this.alvo.y)
      if (dy <= R_FORA) {
        // encaixa a flecha com a ponta exatamente no ponto do impacto
        this.flecha.x = this.alvo.x - Math.cos(this.flecha.rotation) * 17
        this.flecha.y = pyCross - Math.sin(this.flecha.rotation) * 17
        this._px = this._py = null
        this.cravar(this.alvo.x, pyCross, dy)
        return
      }
    }
    this._px = px; this._py = py
    if (py >= CHAO) { this.espetarChao(px); return }
    if (this.flecha.x > W + 40 || this.flecha.x < -40 || this.flecha.y > H + 40) {
      const f = this.flecha; this.flecha = null; f.destroy()
      this.cameras.main.shake(140, 0.005)
      this.resultado(0)
    }
  }

  cravar(px, py, d) {
    const pts = d <= R_CENTRO ? 3 : d <= R_MEIO ? 2 : 1
    // afunda um tiquinho pra parecer cravada de verdade
    this.flecha.x += Math.cos(this.flecha.rotation) * 4
    this.flecha.y += Math.sin(this.flecha.rotation) * 4
    // vira "filha" do alvo: quando o alvo se mexer, a flecha vai junto (tá espetada!)
    const lx = this.flecha.x - this.alvo.x, ly = this.flecha.y - this.alvo.y
    this.alvo.add(this.flecha)
    this.flecha.setPosition(lx, ly)
    this.cravadas.push(this.flecha)
    this.flecha = null
    try { this.faisca?.explode(6 + pts * 6, px, py) } catch { /* ok */ }
    // squash do alvo = sentir o impacto
    this.alvo.setScale(1.12)
    this.tweens.add({ targets: this.alvo, scale: 1, duration: 220, ease: 'Back.out' })
    // e balança no cavalete — as flechas espetadas vão junto (são filhas)
    this.tweens.add({
      targets: this.alvo, angle: Phaser.Math.Between(3, 5) * (Math.random() < 0.5 ? -1 : 1),
      duration: 90, yoyo: true, repeat: 1, ease: 'Sine.inOut', onComplete: () => this.alvo.setAngle(0),
    })
    // '+N' flutuando na cor do anel
    const cores = { 1: '#ffffff', 2: '#93c5fd', 3: '#fde047' }
    const t = this.add.text(px, py - 12, '+' + pts, { fontFamily: 'system-ui', fontSize: '26px', fontStyle: 'bold', color: cores[pts] }).setOrigin(0.5).setDepth(9).setShadow(0, 2, '#0008', 3)
    this.tweens.add({ targets: t, y: py - 48, alpha: 0, duration: 700, ease: 'Quad.out', onComplete: () => t.destroy() })
    this.resultado(pts)
  }

  espetarChao(px) {
    // flecha fica espetada na grama um instante — a criança VÊ onde errou
    this.flecha.y = CHAO - Math.sin(this.flecha.rotation) * 17
    try { this.poeira?.explode(12, px, CHAO) } catch { /* ok */ }
    const f = this.flecha; this.flecha = null
    this.tweens.add({ targets: f, alpha: 0, delay: 500, duration: 300, onComplete: () => f.destroy() })
    this.cameras.main.shake(140, 0.005)
    this.resultado(0)
  }

  resultado(pts) {
    this.estado = 'resultado'
    this.pontos += pts
    this.game.events.emit('arco:resultado', pts)
    this.atualizarHud()
    const txt = pts === 3 ? 'Na mosca! 🎯' : pts === 2 ? 'Boa! 👏' : pts === 1 ? 'Pegou! 🏹' : 'Errou! 😬'
    const cor = pts === 3 ? '#fde047' : '#ffffff'
    this.banner.setText(txt).setColor(cor)
    // pastilha sob medida pro texto da vez — mesmo estilo dos chips do HUD
    const bw = this.banner.width + 36, bh = this.banner.height + 16
    this.bannerBg.clear(); this.bannerBg.fillStyle(0x0f172a, 0.35); this.bannerBg.fillRoundedRect(-bw / 2, -bh / 2, bw, bh, 14)
    this.bannerBox.setScale(0).setAlpha(1)
    this.tweens.add({ targets: this.bannerBox, scale: 1, duration: 300, ease: 'Back.out' })
    this.time.delayedCall(1050, () => {
      this.tweens.add({ targets: this.bannerBox, alpha: 0, duration: 200 })
      this.flechaN++
      if (this.flechaN >= 5) { this.estado = 'fim'; this.game.events.emit('arco:fim', this.pontos) }
      else this.novaFlecha()
    })
  }
}

export default function ArcoPhaser({ onTerminar, onCancelar }) {
  const [fase, setFase] = useState('pronto')
  const [pontos, setPontos] = useState(0)
  const estrelasDe = (p) => (p >= 12 ? 3 : p >= 7 ? 2 : 1)

  const { hostRef, emit } = usePhaserGame(
    { width: W, height: H, backgroundColor: '#7dc4ea', banner: false, fps: { target: 60 }, scene: ArcoScene },
    {
      'arco:resultado': (pts) => { if (pts > 0) juice.acerto(pts); else juice.erro() },
      'arco:fim': (p) => { setPontos(p); setFase('fim') },
    },
  )

  function iniciar() { setFase('jogando'); setPontos(0); emit('arco:start') }

  return (
    <div className="bg-surface rounded-3xl p-4 sm:p-5 shadow-md text-center">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-extrabold text-muted">🏹 Arco e Flecha</span>
        <button onClick={onCancelar} className="text-xs text-faint p-3 -m-3">Sair</button>
      </div>

      <div className="relative select-none mx-auto" style={{ maxWidth: 360 }}>
        <div ref={hostRef} className="w-full rounded-2xl overflow-hidden border border-line" style={{ aspectRatio: `${W} / ${H}`, touchAction: 'none' }} />

        {fase === 'pronto' && (
          <button onClick={iniciar} className="absolute inset-0 grid place-items-center bg-sky-900/40 rounded-2xl">
            <span className="bg-brand text-white font-extrabold rounded-xl px-5 py-2.5 shadow-glow">🏹 Toque pra atirar</span>
          </button>
        )}

        {fase === 'fim' && (
          <div className="absolute inset-0 grid place-items-center bg-sky-950/85 rounded-2xl p-4">
            <div>
              <div className="text-4xl mb-1">🏅</div>
              <p className="font-extrabold text-white text-lg">Você fez {pontos} de 15 pontos!</p>
              <p className="text-sm font-bold text-gold mt-1">{'⭐'.repeat(estrelasDe(pontos))}</p>
              <div className="flex gap-2 mt-4 max-w-[280px] mx-auto">
                <button onClick={onCancelar} className="flex-1 rounded-xl bg-surface2 text-ink font-semibold py-2.5">Sair</button>
                <button onClick={() => onTerminar(estrelasDe(pontos))} className="flex-1 rounded-xl bg-brand text-white font-extrabold py-2.5">Concluir 🎉</button>
              </div>
            </div>
          </div>
        )}
      </div>
      <p className="text-[11px] text-faint mt-3">Arraste pra trás pra puxar a corda e solte pra atirar — quanto mais puxar, mais forte! Fique de olho no vento 💨: ele empurra a flecha no ar. Centro vermelho vale 3! 🎯</p>
    </div>
  )
}
