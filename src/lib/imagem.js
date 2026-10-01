// Reduz uma imagem ANTES de enviar pro Storage: economiza espaço/tráfego do
// Supabase e deixa tudo rápido no 3G. Vídeos e arquivos não-imagem passam
// direto (sem mexer). GIF é preservado pra não perder a animação.
// Em qualquer erro, devolve o arquivo original — nunca atrapalha o envio.
//
// EXCEÇÃO (Fase 9): com `semMetadados: true` a imagem NUNCA volta como o original. O original do celular carrega EXIF
// (GPS, modelo do aparelho, data); então a foto é SEMPRE redesenhada no canvas (que só tem pixels), mesmo quando o
// resultado não fica menor, e se não der para redesenhar o envio FALHA em vez de mandar o original. GIF (sem EXIF/GPS)
// e o que não é imagem seguem passando direto. Usado nos envios de comprovação, documento, mural e imagens públicas.
export async function comprimirImagem(file, { maxLado = 1080, qualidade = 0.72, semMetadados = false } = {}) {
  if (!file || !file.type || !file.type.startsWith('image/')) return file
  if (file.type === 'image/gif') return file
  try {
    const bitmap = await createImageBitmap(file)
    const escala = Math.min(1, maxLado / Math.max(bitmap.width, bitmap.height))
    const w = Math.max(1, Math.round(bitmap.width * escala))
    const h = Math.max(1, Math.round(bitmap.height * escala))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    ctx.drawImage(bitmap, 0, 0, w, h)
    bitmap.close?.()
    const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', qualidade))
    if (!blob) throw new Error('sem blob')
    // Se não ficou menor (ex.: já era pequena), usa a original mesmo — salvo no modo sem metadados (o original tem EXIF)
    if (!semMetadados && blob.size >= file.size) return file
    // no modo sem metadados o nome do aparelho (IMG_0001…) também não vai junto
    const nome = semMetadados ? 'foto.jpg' : (file.name || 'foto').replace(/\.[^.]+$/, '') + '.jpg'
    return new File([blob], nome, { type: 'image/jpeg' })
  } catch {
    if (semMetadados) throw new Error('Não consegui preparar essa foto. Tente outra (JPG ou PNG). 🙂')
    return file
  }
}

// Foto da COMUNIDADE / REDE DBV (migrations 432 e 472): aqui o "melhor esforço" de comprimirImagem NÃO serve.
// comprimirImagem devolve o ARQUIVO ORIGINAL quando a versão recomprimida não fica menor, quando é GIF
// ou quando dá qualquer erro — e o original do celular carrega EXIF (GPS, modelo do aparelho, data).
// Aqui a foto é SEMPRE redesenhada num canvas e exportada de novo: o canvas só tem pixels, então o
// arquivo exportado nasce sem EXIF/GPS. createImageBitmap já aplica a orientação do EXIF
// (imageOrientation 'from-image'), então a foto não fica deitada. Se não der para redesenhar, FALHA —
// nunca manda o original.
//
// ARMAZENAMENTO MÍNIMO (decisão do dono, 28/09): WebP (JPEG se o navegador não exportar WebP), lado
// maior até 1080 px, qualidade 0,70; se passar de 150 KB, baixa a qualidade em passos até 0,5 e depois
// o tamanho em passos até 720 px. Foto de celular de 3–5 MB vira ~100–150 KB. O bucket recusa > 300 KB.
export const FOTO_REDE = { maxLado: 1080, minLado: 720, alvoBytes: 150 * 1024, qualidade: 0.7, qualidadeMin: 0.5 }
export const FOTO_AVATAR = { maxLado: 256, minLado: 160, alvoBytes: 30 * 1024, qualidade: 0.7, qualidadeMin: 0.4 }
// Story (migration 480): retrato 9:16 até 1080×1920 (a caixa limita largura E altura), mesmo alvo de 150 KB.
export const FOTO_STORY = { ...FOTO_REDE, maxLado: 1920, minLado: 1280, caixa: { largura: 1080, altura: 1920 } }
export const LIMITE_BUCKET_REDE = 300 * 1024

const exportar = (canvas, tipo, q) => new Promise((res) => canvas.toBlob(res, tipo, q))

export async function otimizarFoto(file, opcoes = FOTO_REDE) {
  const { maxLado, minLado, alvoBytes, qualidade, qualidadeMin, caixa } = { ...FOTO_REDE, ...opcoes }
  if (!file || !file.type || !file.type.startsWith('image/')) throw new Error('Escolha uma foto. 🙂')
  let bitmap
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  } catch {
    throw new Error('Não consegui preparar essa foto. Tente outra (JPG ou PNG). 🙂')
  }
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  if (!ctx) { bitmap.close?.(); throw new Error('Não consegui preparar essa foto. 🙂') }
  const maior = Math.max(bitmap.width, bitmap.height)
  const desenhar = (lado) => {
    let escala = Math.min(1, lado / maior)
    if (caixa) escala = Math.min(escala, caixa.largura / bitmap.width, caixa.altura / bitmap.height)
    canvas.width = Math.max(1, Math.round(bitmap.width * escala))
    canvas.height = Math.max(1, Math.round(bitmap.height * escala))
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  }
  let lado = Math.min(maxLado, maior)
  let q = qualidade
  let tipo = 'image/webp'
  desenhar(lado)
  let blob = await exportar(canvas, tipo, q)
  // navegador que não exporta WebP devolve PNG: cai para JPEG (e fica nele)
  if (!blob || blob.type !== 'image/webp') {
    tipo = 'image/jpeg'
    blob = await exportar(canvas, tipo, q)
  }
  let passos = 0
  while (blob && blob.size > alvoBytes && passos < 12) {
    passos++
    if (q - qualidadeMin > 0.001) {
      q = Math.max(qualidadeMin, Math.round((q - 0.1) * 100) / 100)
    } else if (lado > minLado) {
      lado = Math.max(minLado, Math.round(lado * 0.85))
      desenhar(lado)
    } else break
    blob = await exportar(canvas, tipo, q)
  }
  bitmap.close?.()
  if (!blob) throw new Error('Não consegui preparar essa foto. 🙂')
  const ext = tipo === 'image/webp' ? 'webp' : 'jpg'
  return {
    arquivo: new File([blob], `foto.${ext}`, { type: tipo }),
    antes: file.size, depois: blob.size, tipo, largura: canvas.width, altura: canvas.height,
  }
}

export async function limparFotoParaComunidade(file, opcoes = FOTO_REDE) {
  const r = await otimizarFoto(file, opcoes)
  if (r.depois > LIMITE_BUCKET_REDE) throw new Error('Essa foto ficou grande demais mesmo depois de otimizar. Tente outra. 🙂')
  return r.arquivo
}

// "3,4 MB → 110 KB" (para o aviso discreto de foto otimizada)
export function tamanhoLegivel(bytes) {
  const n = Number(bytes) || 0
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`
  return `${Math.max(1, Math.round(n / 1024))} KB`
}
