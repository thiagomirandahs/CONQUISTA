// Reduz uma imagem ANTES de enviar pro Storage: economiza espaço/tráfego do
// Supabase e deixa tudo rápido no 3G. Vídeos e arquivos não-imagem passam
// direto (sem mexer). GIF é preservado pra não perder a animação.
// Em qualquer erro, devolve o arquivo original — nunca atrapalha o envio.
export async function comprimirImagem(file, { maxLado = 1280, qualidade = 0.8 } = {}) {
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
    // Se não ficou menor (ex.: já era pequena), usa a original mesmo
    if (!blob || blob.size >= file.size) return file
    const nome = (file.name || 'foto').replace(/\.[^.]+$/, '') + '.jpg'
    return new File([blob], nome, { type: 'image/jpeg' })
  } catch {
    return file
  }
}
