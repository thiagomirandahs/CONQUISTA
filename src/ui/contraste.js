// Contraste — a cor que o clube escolhe NUNCA pode quebrar a legibilidade (fase 7).
//
// O clube personaliza a cor da marca. Uma cor clara (amarelo, lima, bege) com texto branco em cima
// vira um botão ilegível — e não dá para pedir a cada clube que entenda de contraste. Então o app
// calcula: dado o fundo da marca, qual cor de texto passa no contraste? E, quando a própria marca é
// usada como TEXTO sobre fundo claro, devolve uma versão escurecida o bastante para ser lida.
//
// Referência: luminância relativa e razão de contraste da WCAG 2.1 (mesma fórmula, sem dependência).

const BRANCO = '#ffffff'
const TINTA = '#111a3d'          // o --c-ink do tema claro

function hexParaRgb(cor) {
  if (typeof cor !== 'string') return null
  let h = cor.trim().replace('#', '')
  if (h.length === 3) h = h.split('').map((c) => c + c).join('')
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return null
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}

const canal = (v) => {
  const s = v / 255
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
}

export function luminancia(cor) {
  const rgb = hexParaRgb(cor)
  if (!rgb) return null
  const [r, g, b] = rgb.map(canal)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export function razaoDeContraste(corA, corB) {
  const a = luminancia(corA)
  const b = luminancia(corB)
  if (a === null || b === null) return null
  const claro = Math.max(a, b)
  const escuro = Math.min(a, b)
  return (claro + 0.05) / (escuro + 0.05)
}

// Qual texto colocar EM CIMA da cor do clube: branco ou tinta escura — o que tiver mais contraste.
// O texto sobre a marca é sempre grande e em negrito (botão, aba, destino ativo), cujo limiar da
// WCAG é 3:1. Há cores — vermelho puro, por exemplo — que não alcançam 4.5:1 com NENHUM texto; para
// elas o app entrega a melhor das duas, e a tela de identidade do clube avisa quem escolheu.
export function corDeTextoSobre(corFundo) {
  const comBranco = razaoDeContraste(corFundo, BRANCO)
  if (comBranco === null) return BRANCO           // cor que não sei ler: mantém o de sempre
  const comTinta = razaoDeContraste(corFundo, TINTA)
  return comBranco >= comTinta ? BRANCO : TINTA
}

// A cor do clube usada como TEXTO sobre um fundo claro. Se não alcança 4.5:1, escurece em passos
// até alcançar — assim um clube "amarelo" continua tendo identidade sem texto ilegível.
export function corDeMarcaLegivel(corMarca, corFundo = BRANCO, alvo = 4.5) {
  const rgb = hexParaRgb(corMarca)
  if (!rgb) return corMarca
  let [r, g, b] = rgb
  const hex = () => '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')
  for (let i = 0; i < 24; i += 1) {
    const razao = razaoDeContraste(hex(), corFundo)
    if (razao === null || razao >= alvo) break
    r *= 0.9; g *= 0.9; b *= 0.9
  }
  return hex()
}

// Devolve as variáveis de contraste derivadas da cor do clube, prontas para escrever no :root.
// Sem cor definida (clube usando o tema padrão), devolve {} — nada é sobrescrito.
export function variaveisDeContraste(corPrimaria) {
  if (!hexParaRgb(corPrimaria)) return {}
  return {
    '--marca-1-texto': corDeTextoSobre(corPrimaria),        // texto EM CIMA da marca
    '--marca-1-legivel': corDeMarcaLegivel(corPrimaria),    // a marca usada COMO texto
  }
}
