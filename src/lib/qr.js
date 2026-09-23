// QR como SVG inline (sem <canvas>, sem imagem externa) — imprime nítido em qualquer tamanho e não
// depende de rede. Usa qrcode-generator (MIT, zero-dep) só pra montar a matriz; o desenho é nosso.
import qrcode from 'qrcode-generator'

// Devolve uma string SVG (viewBox em módulos) que codifica `texto`. `margin` em módulos (quiet zone).
export function qrSvg(texto, { margin = 4 } = {}) {
  const qr = qrcode(0, 'M') // tipo 0 = auto, correção M
  qr.addData(texto)
  qr.make()
  const n = qr.getModuleCount()
  const tam = n + margin * 2
  let caminho = ''
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (qr.isDark(r, c)) caminho += `M${c + margin},${r + margin}h1v1h-1z`
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${tam} ${tam}" shape-rendering="crispEdges" role="img" aria-label="QR code de verificação">` +
    `<rect width="${tam}" height="${tam}" fill="#ffffff"/><path d="${caminho}" fill="#000000"/></svg>`
}
