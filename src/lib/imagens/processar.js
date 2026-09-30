// Re-renderiza a imagem num canvas (só pixels: remove EXIF/GPS/miniatura embutida) e exporta WebP/JPEG.
// `deps` existe para teste (jsdom não tem canvas): { createImageBitmap, criarCanvas }.
import { validarImagem } from './validar.js'
import { perfilDe } from './perfis.js'

const padrao = () => ({
  createImageBitmap: (f, o) => globalThis.createImageBitmap(f, o),
  criarCanvas: () => document.createElement('canvas'),
})
const exportar = (canvas, tipo, q) => new Promise((res) => canvas.toBlob(res, tipo, q))
const FALHA = 'Não consegui preparar essa foto. Tente outra (JPG ou PNG). 🙂'

async function renderizar(bitmap, lado, perfil, deps) {
  const canvas = deps.criarCanvas()
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error(FALHA)
  const maior = Math.max(bitmap.width, bitmap.height)
  const desenhar = (l) => {
    const esc = Math.min(1, l / maior)
    canvas.width = Math.max(1, Math.round(bitmap.width * esc))
    canvas.height = Math.max(1, Math.round(bitmap.height * esc))
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  }
  desenhar(lado)
  let tipo = perfil.saida === 'webp' ? 'image/webp' : 'image/jpeg'
  let q = perfil.qualidade
  let blob = await exportar(canvas, tipo, q)
  // navegador sem WebP devolve PNG: cai para JPEG
  if (tipo === 'image/webp' && (!blob || blob.type !== 'image/webp')) { tipo = 'image/jpeg'; blob = await exportar(canvas, tipo, q) }
  let atual = lado
  let passos = 0
  // evidência/documento: qualidade só cai até o piso alto e o lado até minLado (sem compressão social)
  while (blob && blob.size > perfil.alvoBytes && passos < 12) {
    passos++
    if (q - perfil.qualidadeMin > 0.001) q = Math.max(perfil.qualidadeMin, Math.round((q - 0.1) * 100) / 100)
    else if (atual > perfil.minLado) { atual = Math.max(perfil.minLado, Math.round(atual * 0.85)); desenhar(atual) }
    else break
    blob = await exportar(canvas, tipo, q)
  }
  if (!blob) throw new Error(FALHA)
  return { blob, largura: canvas.width, altura: canvas.height, mime: blob.type || tipo }
}

// -> { principal, miniatura, largura, altura, bytes, mime, finalidade, bytesOriginal }
export async function processarImagem(file, perfilNome, { deps = padrao(), validacao } = {}) {
  const perfil = perfilDe(perfilNome)
  await validarImagem(file, validacao)
  let bitmap
  try { bitmap = await deps.createImageBitmap(file, { imageOrientation: 'from-image' }) } catch { throw new Error(FALHA) }
  try {
    const maior = Math.max(bitmap.width, bitmap.height)
    const p = await renderizar(bitmap, Math.min(perfil.maxLado, maior), perfil, deps)
    const pm = { ...perfil, alvoBytes: 25 * 1024, qualidade: 0.6, qualidadeMin: 0.4, minLado: 96, saida: 'webp' }
    const m = await renderizar(bitmap, Math.min(perfil.miniatura, maior), pm, deps)
    return {
      principal: p.blob, miniatura: m.blob, largura: p.largura, altura: p.altura,
      bytes: p.blob.size, mime: p.mime, finalidade: perfil.nome, bytesOriginal: file.size,
    }
  } finally { bitmap.close?.() }
}
