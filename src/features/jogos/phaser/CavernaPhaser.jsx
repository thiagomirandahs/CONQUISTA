// ===================== 🔦 Caverna — jogo em PHASER (motor 2D) =====================
// Um vagalume atravessa uma caverna escura: SEGURE o dedo na tela pra ele subir,
// solte pra descer (física suave, sem teleporte). Desvie das pedras (estalactites
// e estalagmites) passando pelo vão entre elas — cada par passado vale +1. A luz
// do próprio vagalume é a "lanterna" que revela o caminho. São 3 tentativas e
// vale a MELHOR: >=15 vãos = 3 estrelas, >=8 = 2, senão 1 (dá estrelas por onTerminar).
// Lazy — o Phaser só entra no bundle de quem abre um jogo do motor.
import { useState } from 'react'
import { usePhaserGame } from '../hooks/usePhaserGame.js'
import Phaser from 'phaser'
import * as juice from '../../../lib/juice.js'

const W = 360, H = 560
const VAGA_X = 96                 // x fixo do vagalume (ele só sobe/desce)
const RAIO = 9, FOLGA = 4         // hitbox menor que o desenho + tolerância: justo pra criança
const GRAV = 1050, SOBE = -1700   // soltar cai, segurar acelera pra cima (suave)
const SUBIDA_MAX = 320, QUEDA_MAX = 430
const LARG = 58                   // largura das colunas de pedra
const GAP_INI = 190, GAP_MIN = 128 // vão generoso no começo, aperta aos poucos
const VEL0 = 118, VEL_TOPO = 215  // velocidade das pedras sobe devagar
const ESPACO = 232                // distância horizontal entre pares

export class CavernaScene extends Phaser.Scene {
  constructor() { super('caverna') }

  create() {
    this.criarTexturas()

    // fundo: gradiente bem escuro (caverna) + volumes de rocha ao longe
    const fundo = this.add.graphics().setDepth(0)
    fundo.fillGradientStyle(0x121a30, 0x121a30, 0x05070f, 0x05070f, 1)
    fundo.fillRect(0, 0, W, H)
    fundo.fillStyle(0x0d1426, 1)
    fundo.fillEllipse(40, 120, 160, 300); fundo.fillEllipse(330, 420, 180, 340)

    // PARALAXE: estalactites/estalagmites ao longe andando a ~40% das pedras — profundidade
    this.paralaxe = this.add.tileSprite(W / 2, H / 2, W, H, 'parede').setDepth(1).setAlpha(0.8)

    // cristaizinhos que piscam: dão vida sem clarear a caverna
    for (let i = 0; i < 12; i++) {
      const c = this.add.circle(Phaser.Math.Between(10, W - 10), Phaser.Math.Between(30, H - 30), Phaser.Math.Between(1, 2), 0x8fd0f0, 0.18).setDepth(1)
      this.tweens.add({ targets: c, alpha: 0.04, yoyo: true, repeat: -1, duration: Phaser.Math.Between(700, 1600), delay: Phaser.Math.Between(0, 900) })
    }

    // teto e chão com dentes de pedra: mostram onde é perigoso encostar
    const rocha = this.add.graphics().setDepth(2)
    rocha.fillStyle(0x1a2238, 1)
    rocha.fillRect(0, 0, W, 8); rocha.fillRect(0, H - 8, W, 8)
    for (let x = 0; x < W; x += 24) {
      rocha.fillTriangle(x, 8, x + 24, 8, x + 12, 8 + Phaser.Math.Between(8, 16))
      rocha.fillTriangle(x, H - 8, x + 24, H - 8, x + 12, H - 8 - Phaser.Math.Between(8, 16))
    }

    // GOTAS do teto: pinguinho reusado (nada nasce por gota) que cai de vez em quando
    this.gota = this.add.circle(0, 0, 2, 0x9fd8ff, 0).setDepth(2)
    this.plim = this.add.circle(0, 0, 3, 0x9fd8ff, 0).setDepth(2)
    this.agendarGota()

    // EFEITO LANTERNA: dois círculos de luz (um grande fraco + um perto mais forte)
    // seguindo o vagalume — com ADD parece luz de verdade sobre as pedras
    this.luzFora = this.add.circle(VAGA_X, H / 2, 110, 0xffe58a, 0.07).setDepth(6).setBlendMode(Phaser.BlendModes.ADD)
    this.luzPerto = this.add.circle(VAGA_X, H / 2, 56, 0xffd84d, 0.12).setDepth(6).setBlendMode(Phaser.BlendModes.ADD)

    this.vaga = this.desenharVagalume()
    // flutua enquanto espera o começo: parece vivo
    this.flutua = this.tweens.add({ targets: this.vaga, y: H / 2 + 14, yoyo: true, repeat: -1, duration: 900, ease: 'Sine.inOut' })

    // vinheta escura nas bordas: reforça a sensação de túnel sem máscara de verdade
    const vin = this.add.graphics().setDepth(8)
    vin.fillGradientStyle(0x000000, 0x000000, 0x000000, 0x000000, 0.5, 0.5, 0, 0); vin.fillRect(0, 0, W, 130)
    vin.fillGradientStyle(0x000000, 0x000000, 0x000000, 0x000000, 0, 0, 0.5, 0.5); vin.fillRect(0, H - 130, W, 130)
    vin.fillGradientStyle(0x000000, 0x000000, 0x000000, 0x000000, 0.4, 0, 0.4, 0); vin.fillRect(0, 0, 70, H)
    vin.fillGradientStyle(0x000000, 0x000000, 0x000000, 0x000000, 0, 0.4, 0, 0.4); vin.fillRect(W - 70, 0, 70, H)

    try {
      // rastro de fagulhas de luz atrás do vagalume
      this.faiscas = this.add.particles(0, 0, 'fagulha', {
        lifespan: 700, speed: { min: 10, max: 40 }, scale: { start: 0.7, end: 0 },
        alpha: { start: 0.8, end: 0 }, tint: [0xffe58a, 0xfff3c4], frequency: 90,
      }).setDepth(6)
      this.faiscas.startFollow(this.vaga, -6, 8)
    } catch { this.faiscas = null }

    // chips do HUD: pastilha escura atrás de cada texto (criado ANTES pra ficar por baixo)
    this.chips = this.add.graphics().setDepth(9)
    this.tentTxt = this.add.text(12, 10, '', { fontFamily: 'system-ui', fontSize: '18px', fontStyle: 'bold', color: '#ffffff' }).setDepth(9).setShadow(0, 1, '#000a', 3)
    this.ptsTxt = this.add.text(W / 2, 8, '', { fontFamily: 'system-ui', fontSize: '24px', fontStyle: 'bold', color: '#ffe58a' }).setOrigin(0.5, 0).setDepth(9).setShadow(0, 1, '#000a', 3)
    this.melhorTxt = this.add.text(W - 12, 10, '', { fontFamily: 'system-ui', fontSize: '18px', fontStyle: 'bold', color: '#ffffff' }).setOrigin(1, 0).setDepth(9).setShadow(0, 1, '#000a', 3)
    this.bannerBg = this.add.graphics().setDepth(9).setAlpha(0) // pastilha do banner: faz pop junto com ele
    this.banner = this.add.text(W / 2, 220, '', { fontFamily: 'system-ui', fontSize: '30px', fontStyle: 'bold', color: '#ffffff' }).setOrigin(0.5).setDepth(9).setShadow(0, 2, '#0008', 4).setAlpha(0)

    // controle: dedo NA TELA = sobe, soltou = desce. Resposta imediata (zero atraso).
    this.input.on('pointerdown', () => {
      this.segurando = true
      if (this.estado === 'voando') {
        this.velY -= 60 // empurrãozinho instantâneo: o toque responde NA HORA
        this.tweens.add({ targets: this.vaga, scaleY: 0.86, scaleX: 1.1, yoyo: true, duration: 90 })
        // segurou = subindo: a lanterninha dá uma piscada mais forte (camada extra, sem brigar com o pulso ambiente)
        this.tweens.killTweensOf(this.brilhoForte)
        this.tweens.add({ targets: this.brilhoForte, alpha: 0.45, scale: 1.2, duration: 120 })
      }
    })
    const soltar = () => {
      this.segurando = false
      this.tweens.killTweensOf(this.brilhoForte)
      this.tweens.add({ targets: this.brilhoForte, alpha: 0, scale: 1, duration: 220 }) // brilho volta ao normal
    }
    this.input.on('pointerup', soltar)
    this.input.on('pointerupoutside', soltar) // dedo saiu do canvas: solta também

    this.game.events.on('caverna:start', this.iniciar, this)
    this.resetVars()
  }

  criarTexturas() {
    if (!this.textures.exists('fagulha')) {
      const g = this.add.graphics()
      g.fillStyle(0xffe58a, 1); g.fillCircle(4, 4, 4); g.generateTexture('fagulha', 8, 8); g.destroy()
    }
    if (!this.textures.exists('parede')) {
      // paredão ao longe pro paralaxe: espinhos bem escuros, nenhum cruza a emenda (tile sem costura)
      const p = this.add.graphics()
      p.fillStyle(0x0e1626, 1)
      for (let x = 0; x < W - 40; x += Phaser.Math.Between(34, 58)) {
        p.fillTriangle(x, 0, x + 30, 0, x + 15, Phaser.Math.Between(50, 120))
        p.fillTriangle(x + 8, H, x + 38, H, x + 23, H - Phaser.Math.Between(50, 120))
      }
      p.generateTexture('parede', W, H); p.destroy()
    }
  }

  desenharVagalume() {
    const c = this.add.container(VAGA_X, H / 2).setDepth(7)
    // brilho extra que só acende quando o jogador segura (piscada forte da subida)
    this.brilhoForte = this.add.circle(0, 5, 20, 0xfff3c4, 0).setBlendMode(Phaser.BlendModes.ADD)
    // brilho pulsante: a "lanterninha" do bumbum dele
    this.brilho = this.add.circle(0, 5, 15, 0xffe58a, 0.35)
    // asinhas que batem rápido
    this.asaE = this.add.ellipse(-7, -8, 14, 8, 0xcfe8ff, 0.75).setRotation(-0.5)
    this.asaD = this.add.ellipse(7, -8, 14, 8, 0xcfe8ff, 0.75).setRotation(0.5)
    const corpo = this.add.graphics()
    corpo.fillStyle(0xffd84d, 1); corpo.fillCircle(0, 6, 7)   // bumbum que acende
    corpo.fillStyle(0x4a3f63, 1); corpo.fillCircle(0, -3, 6)  // corpinho
    corpo.fillStyle(0xffffff, 1); corpo.fillCircle(-2.5, -5, 1.6); corpo.fillCircle(2.5, -5, 1.6) // olhos
    corpo.lineStyle(1.5, 0x4a3f63, 1)
    corpo.beginPath(); corpo.moveTo(-2, -9); corpo.lineTo(-5, -14); corpo.strokePath() // antenas
    corpo.beginPath(); corpo.moveTo(2, -9); corpo.lineTo(5, -14); corpo.strokePath()
    c.add([this.brilhoForte, this.brilho, this.asaE, this.asaD, corpo])
    this.tweens.add({ targets: [this.asaE, this.asaD], scaleY: 0.35, yoyo: true, repeat: -1, duration: 90, ease: 'Sine.inOut' })
    this.tweens.add({ targets: this.brilho, scale: 1.35, alpha: 0.5, yoyo: true, repeat: -1, duration: 600, ease: 'Sine.inOut' })
    return c
  }

  resetVars() {
    this.estado = 'pronto'
    this.tentativa = 1; this.score = 0; this.melhor = 0
    this.velY = 0; this.velObst = VEL0; this.segurando = false
    this.pares = []; this.distSpawn = 40
    this.atualizarHud()
  }

  iniciar() {
    this.tentativa = 1; this.melhor = 0
    this.novaTentativa()
  }

  atualizarHud() {
    this.tentTxt.setText('🔦 ' + Math.min(this.tentativa, 3) + '/3')
    this.ptsTxt.setText('✨ ' + this.score)
    this.melhorTxt.setText('🏆 ' + this.melhor)
    // chips: redesenha só quando o placar muda (nunca por frame)
    const g = this.chips
    g.clear(); g.fillStyle(0x0f172a, 0.35)
    for (const t of [this.tentTxt, this.ptsTxt, this.melhorTxt]) {
      const b = t.getBounds()
      g.fillRoundedRect(b.x - 10, b.y - 5, b.width + 20, b.height + 10, 12)
    }
  }

  // gota do teto: timer aleatório encadeado — ambiente vivo sem pesar
  agendarGota() {
    this.time.delayedCall(Phaser.Math.Between(1400, 3600), () => { this.soltarGota(); this.agendarGota() })
  }

  soltarGota() {
    const x = Phaser.Math.Between(20, W - 20)
    this.tweens.killTweensOf([this.gota, this.plim])
    this.gota.setPosition(x, 26).setAlpha(0.3).setScale(1)
    this.tweens.add({
      targets: this.gota, y: H - 14, alpha: 0.22, duration: Phaser.Math.Between(650, 950), ease: 'Quad.in',
      onComplete: () => {
        this.gota.setAlpha(0)
        // plim minúsculo: anelzinho abre e some onde a gota bateu
        this.plim.setPosition(x, H - 14).setAlpha(0.35).setScale(0.4)
        this.tweens.add({ targets: this.plim, scale: 2, alpha: 0, duration: 260 })
      },
    })
  }

  novaTentativa() {
    for (const p of this.pares) p.g.destroy()
    this.pares = []
    this.score = 0; this.velY = 0; this.velObst = VEL0
    this.distSpawn = 40 // primeira pedra chega rapidinho, mas dá tempo de sentir o controle
    this.segurando = false
    this.tweens.killTweensOf(this.vaga) // corta a queda da morte / flutuação do "pronto"
    this.tweens.killTweensOf([this.luzFora, this.luzPerto, this.brilhoForte])
    this.brilhoForte.setAlpha(0).setScale(1)
    // ENTRADA: o vagalume "acorda" com um pop curtinho — sensação de rodada nova
    this.vaga.setPosition(VAGA_X, H / 2).setRotation(0).setAlpha(1).setScale(0.92)
    this.tweens.add({ targets: this.vaga, scale: 1, duration: 240, ease: 'Back.out' })
    // a lanterninha acende suave em vez de já nascer ligada
    this.luzFora.setAlpha(0).setScale(1); this.luzPerto.setAlpha(0).setScale(1)
    this.tweens.add({ targets: this.luzFora, alpha: 0.07, duration: 300 })
    this.tweens.add({ targets: this.luzPerto, alpha: 0.12, duration: 300 })
    this.atualizarHud()
    this.banner.setText(this.tentativa === 1 ? 'Voa, vagalume! 🔦' : 'Tentativa ' + this.tentativa + '/3').setAlpha(1).setScale(0.6)
    // pastilha atrás do banner: mesmo estilo dos chips, faz pop e some junto
    const bg = this.bannerBg
    bg.clear(); bg.fillStyle(0x0f172a, 0.35)
    const bw = this.banner.width + 28, bh = this.banner.height + 14
    bg.fillRoundedRect(-bw / 2, -bh / 2, bw, bh, 14)
    bg.setPosition(this.banner.x, this.banner.y).setAlpha(1).setScale(0.6)
    this.tweens.add({ targets: [this.banner, this.bannerBg], scale: 1, duration: 250, ease: 'Back.out' })
    this.tweens.add({ targets: [this.banner, this.bannerBg], alpha: 0, delay: 800, duration: 250 })
    this.estado = 'voando' // já pode voar: o aviso não trava o controle
  }

  // par de pedras: estalactite (teto) + estalagmite (chão) com um VÃO no meio
  novoPar() {
    const gapH = Math.max(GAP_MIN, GAP_INI - this.score * 4)
    const gapY = Phaser.Math.Between(Math.round(gapH / 2 + 56), Math.round(H - gapH / 2 - 56))
    const topH = gapY - gapH / 2, baseY = gapY + gapH / 2
    const g = this.add.graphics().setDepth(3)
    this.desenharColuna(g, topH, true)
    this.desenharColuna(g, baseY, false)
    g.x = W + 30
    this.pares.push({ g, topH, baseY, passou: false })
  }

  // pedra em tom escuro de propósito: fora da luz do vagalume ela some na caverna
  desenharColuna(g, borda, ehTopo) {
    g.fillStyle(0x232c42, 1)
    if (ehTopo) {
      g.fillRect(0, 0, LARG, borda - 16)
      g.fillTriangle(0, borda - 16, LARG * 0.38, borda - 16, LARG * 0.19, borda)
      g.fillTriangle(LARG * 0.3, borda - 16, LARG * 0.72, borda - 16, LARG * 0.5, borda + 5) // dente maior no meio
      g.fillTriangle(LARG * 0.62, borda - 16, LARG, borda - 16, LARG * 0.81, borda)
      g.fillStyle(0x33405e, 1); g.fillRect(0, 0, 5, borda - 18) // borda "iluminada" discreta
      // cara de pedra: flanco na sombra + facetas em tom claro quebram o "paredão liso"
      g.fillStyle(0x1b2336, 1); g.fillRect(LARG - 7, 0, 7, borda - 18)
      g.fillStyle(0x2c3752, 1)
      for (let i = 0; i < 3; i++) {
        const fx = Phaser.Math.Between(8, LARG - 22), fy = Phaser.Math.Between(10, borda - 30)
        g.fillTriangle(fx, fy, fx + 12, fy + 3, fx + 4, fy + 12)
      }
      if (Phaser.Math.Between(0, 2) > 0) { // ~2/3 das colunas ganham um cristalzinho incrustado
        const cx = Phaser.Math.Between(10, LARG - 10), cy = Phaser.Math.Between(14, borda - 32)
        g.fillStyle(0x8fd0f0, 0.25)
        g.fillTriangle(cx - 3, cy, cx + 3, cy, cx, cy - 6); g.fillTriangle(cx - 3, cy, cx + 3, cy, cx, cy + 6)
      }
    } else {
      g.fillRect(0, borda + 16, LARG, H - borda - 16)
      g.fillTriangle(0, borda + 16, LARG * 0.38, borda + 16, LARG * 0.19, borda)
      g.fillTriangle(LARG * 0.3, borda + 16, LARG * 0.72, borda + 16, LARG * 0.5, borda - 5)
      g.fillTriangle(LARG * 0.62, borda + 16, LARG, borda + 16, LARG * 0.81, borda)
      g.fillStyle(0x33405e, 1); g.fillRect(0, borda + 18, 5, H - borda - 18)
      // mesma textura de pedra da estalactite, espelhada pro chão
      g.fillStyle(0x1b2336, 1); g.fillRect(LARG - 7, borda + 18, 7, H - borda - 18)
      g.fillStyle(0x2c3752, 1)
      for (let i = 0; i < 3; i++) {
        const fx = Phaser.Math.Between(8, LARG - 22), fy = Phaser.Math.Between(borda + 30, H - 22)
        g.fillTriangle(fx, fy, fx + 12, fy - 3, fx + 4, fy - 12)
      }
      if (Phaser.Math.Between(0, 2) > 0) {
        const cx = Phaser.Math.Between(10, LARG - 10), cy = Phaser.Math.Between(borda + 32, H - 24)
        g.fillStyle(0x8fd0f0, 0.25)
        g.fillTriangle(cx - 3, cy, cx + 3, cy, cx, cy - 6); g.fillTriangle(cx - 3, cy, cx + 3, cy, cx, cy + 6)
      }
    }
  }

  pontuar() {
    this.score++
    this.velObst = Math.min(VEL_TOPO, VEL0 + this.score * 3.5) // acelera devagarzinho
    this.game.events.emit('caverna:ponto', this.score)
    this.atualizarHud()
    // +1 flutuante + a lanterninha dá um pulso de alegria
    const t = this.add.text(this.vaga.x + 20, this.vaga.y - 14, '+1', { fontFamily: 'system-ui', fontSize: '16px', fontStyle: 'bold', color: '#ffe58a' }).setDepth(9).setShadow(0, 1, '#0008', 2)
    this.tweens.add({ targets: t, y: t.y - 26, alpha: 0, duration: 550, onComplete: () => t.destroy() })
    this.tweens.add({ targets: this.luzPerto, alpha: 0.22, scale: 1.25, yoyo: true, duration: 140 })
    this.tweens.add({ targets: this.luzFora, alpha: 0.13, scale: 1.12, yoyo: true, duration: 140 }) // o clarão inteiro pulsa junto
  }

  morrer() {
    if (this.estado !== 'voando') return
    this.estado = 'bateu'
    this.game.events.emit('caverna:bateu')
    this.cameras.main.shake(220, 0.012)
    this.cameras.main.flash(150, 255, 220, 140)
    try { this.faiscas?.explode(18, this.vaga.x, this.vaga.y) } catch { /* ok */ }
    this.melhor = Math.max(this.melhor, this.score)
    this.atualizarHud()
    // o vagalume cai girando e a luz apaga junto: "apagou!"
    this.tweens.add({ targets: this.vaga, y: this.vaga.y + 60, angle: 120, alpha: 0.3, duration: 500, ease: 'Quad.in' })
    this.tweens.add({ targets: [this.luzFora, this.luzPerto], alpha: 0.02, duration: 400 })
    this.time.delayedCall(1000, () => {
      if (this.tentativa >= 3) { this.estado = 'fim'; this.game.events.emit('caverna:fim', this.melhor) }
      else { this.tentativa++; this.novaTentativa() }
    })
  }

  update(_, delta) {
    const dt = Math.min(delta, 50) / 1000 // trava o dt: aba minimizada não teleporta nada
    // a luz sempre acompanha o vagalume (até na queda, fica bonito)
    this.luzFora.setPosition(this.vaga.x, this.vaga.y)
    this.luzPerto.setPosition(this.vaga.x, this.vaga.y)
    if (this.estado !== 'voando') return

    // paralaxe: o fundo anda a 40% da velocidade das pedras (para junto com elas na batida)
    this.paralaxe.tilePositionX += this.velObst * 0.4 * dt

    // física suave: segurar acelera pra cima, soltar deixa a gravidade agir
    this.velY = Phaser.Math.Clamp(this.velY + (this.segurando ? SOBE : GRAV) * dt, -SUBIDA_MAX, QUEDA_MAX)
    this.vaga.y += this.velY * dt
    this.vaga.rotation = Phaser.Math.Clamp(this.velY * 0.0016, -0.45, 0.55) // inclina pra onde vai

    // encostou no teto ou no chão da caverna: fim da tentativa
    if (this.vaga.y < 12 || this.vaga.y > H - 12) { this.morrer(); return }

    // nascem pedras num espaçamento constante mesmo com a velocidade subindo
    this.distSpawn -= this.velObst * dt
    if (this.distSpawn <= 0) { this.novoPar(); this.distSpawn = ESPACO }

    for (let i = this.pares.length - 1; i >= 0; i--) {
      const p = this.pares[i]
      p.g.x -= this.velObst * dt
      if (p.g.x + LARG < -10) { p.g.destroy(); this.pares.splice(i, 1); continue }
      if (!p.passou && p.g.x + LARG < VAGA_X - 10) { p.passou = true; this.pontuar() }
      // colisão por retângulos com folga: encostar de raspão nos dentes não mata
      if (VAGA_X + RAIO > p.g.x && VAGA_X - RAIO < p.g.x + LARG) {
        if (this.vaga.y - RAIO < p.topH - FOLGA || this.vaga.y + RAIO > p.baseY + FOLGA) { this.morrer(); return }
      }
    }
  }
}

export default function CavernaPhaser({ onTerminar, onCancelar }) {
  const [fase, setFase] = useState('pronto')
  const [melhor, setMelhor] = useState(0)
  const estrelasDe = (m) => (m >= 15 ? 3 : m >= 8 ? 2 : 1)

  const { hostRef, emit } = usePhaserGame(
    { width: W, height: H, backgroundColor: '#0a0f1e', banner: false, fps: { target: 60 }, scene: CavernaScene },
    {
      'caverna:ponto': (s) => juice.acerto(Math.min(s, 6)), // combo sobe o tom conforme avança
      'caverna:bateu': () => juice.erro(),
      'caverna:fim': (m) => { setMelhor(m); setFase('fim') },
    },
  )

  function iniciar() { setFase('jogando'); setMelhor(0); emit('caverna:start') }

  return (
    <div className="bg-surface rounded-3xl p-4 sm:p-5 shadow-md text-center">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-extrabold text-muted">🔦 Caverna</span>
        <button onClick={onCancelar} className="text-xs text-faint p-3 -m-3">Sair</button>
      </div>

      <div className="relative select-none mx-auto" style={{ maxWidth: 360 }}>
        <div ref={hostRef} className="w-full rounded-2xl overflow-hidden border border-line" style={{ aspectRatio: `${W} / ${H}`, touchAction: 'none' }} />

        {fase === 'pronto' && (
          <button onClick={iniciar} className="absolute inset-0 grid place-items-center bg-slate-950/50 rounded-2xl">
            <span className="bg-brand text-white font-extrabold rounded-xl px-5 py-2.5 shadow-glow">🔦 Toque pra voar</span>
          </button>
        )}

        {fase === 'fim' && (
          <div className="absolute inset-0 grid place-items-center bg-slate-950/85 rounded-2xl p-4">
            <div>
              <div className="text-4xl mb-1">🔦</div>
              <p className="font-extrabold text-white text-lg">Melhor voo: {melhor} {melhor === 1 ? 'vão' : 'vãos'}!</p>
              <p className="text-sm font-bold text-gold mt-1">{'⭐'.repeat(estrelasDe(melhor))}</p>
              <div className="flex gap-2 mt-4 max-w-[280px] mx-auto">
                <button onClick={onCancelar} className="flex-1 rounded-xl bg-surface2 text-ink font-semibold py-2.5">Sair</button>
                <button onClick={() => onTerminar(estrelasDe(melhor))} className="flex-1 rounded-xl bg-brand text-white font-extrabold py-2.5">Concluir 🎉</button>
              </div>
            </div>
          </div>
        )}
      </div>
      <p className="text-[11px] text-faint mt-3">Segure o dedo na tela pro vagalume subir e solte pra ele descer. Passe pelos vãos entre as pedras — são 3 tentativas e vale a melhor! 🔦</p>
    </div>
  )
}
