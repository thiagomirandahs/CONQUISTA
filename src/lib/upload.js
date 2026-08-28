// Central de upload SEGURO (hardening etapa 2 — Parte B).
// O accept="image/*" do navegador é só conveniência — segurança é AQUI:
//  * o tipo REAL do arquivo é lido dos primeiros bytes (assinatura mágica),
//    nunca só do file.type que o navegador declara;
//  * SVG/HTML/qualquer coisa que não seja mídia de verdade é rejeitado
//    (SVG pode carregar script — nunca aceitamos);
//  * tamanho máximo antes de subir; a extensão gravada vem do tipo DETECTADO
//    (sempre coerente, mesmo que o arquivo venha com nome mentiroso);
//  * vídeo só onde o app realmente aceita vídeo (comprovação de atividade).
// Usado por: Cadastro, Perfil, Mural, Unidades (bucket público 'imagens') e
// Missões/Atividades (bucket PRIVADO 'comprovacoes' — Parte A).
import { supabase } from './supabase.js'
import { comprimirImagem } from './imagem.js'

// ---- Detecção por assinatura mágica (primeiros bytes do arquivo) ----
async function lerCabecalho(file, n = 16) {
  const buf = await file.slice(0, n).arrayBuffer()
  return new Uint8Array(buf)
}

const asciiEm = (b, i, n) => String.fromCharCode(...b.slice(i, i + n))

// Devolve { midia: 'imagem'|'video', ext } ou null se não for mídia conhecida.
function tipoReal(b) {
  if (b.length < 12) return null
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { midia: 'imagem', ext: 'jpg' }
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return { midia: 'imagem', ext: 'png' }
  if (asciiEm(b, 0, 4) === 'GIF8') return { midia: 'imagem', ext: 'gif' }
  if (asciiEm(b, 0, 4) === 'RIFF' && asciiEm(b, 8, 4) === 'WEBP') return { midia: 'imagem', ext: 'webp' }
  if (asciiEm(b, 4, 4) === 'ftyp') {
    // família ISO-BMFF: pode ser foto do iPhone (HEIC) ou vídeo (MP4/MOV)
    const brand = asciiEm(b, 8, 4).toLowerCase()
    if (['heic', 'heix', 'heif', 'hevc', 'mif1', 'msf1'].includes(brand)) return { midia: 'imagem', ext: 'heic' }
    return { midia: 'video', ext: brand.startsWith('qt') ? 'mov' : 'mp4' }
  }
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return { midia: 'video', ext: 'webm' }
  return null // svg, html, pdf, zip... = fora
}

// ---- Validações (lançam Error com mensagem amigável) ----
export async function validarImagem(file, { maxMB = 15 } = {}) {
  if (!file) throw new Error('Escolha uma foto primeiro. 🙂')
  if (file.size > maxMB * 1024 * 1024) {
    throw new Error(`Essa foto é muito pesada (máx. ${maxMB} MB). Tire de novo em qualidade normal. 🙂`)
  }
  const t = tipoReal(await lerCabecalho(file))
  if (!t || t.midia !== 'imagem') {
    throw new Error('Esse arquivo não é uma foto válida (aceitamos JPG, PNG, WebP, GIF e HEIC).')
  }
  return t // { midia: 'imagem', ext }
}

export async function validarMidia(file, { maxImagemMB = 15, maxVideoMB = 60 } = {}) {
  if (!file) throw new Error('Escolha um arquivo primeiro. 🙂')
  const t = tipoReal(await lerCabecalho(file))
  if (!t) throw new Error('Esse arquivo não é uma foto ou vídeo válido.')
  const maxMB = t.midia === 'video' ? maxVideoMB : maxImagemMB
  if (file.size > maxMB * 1024 * 1024) {
    throw new Error(`Arquivo muito pesado (máx. ${maxMB} MB pra ${t.midia === 'video' ? 'vídeo' : 'foto'}).`)
  }
  return t // { midia, ext }
}

// ---- Uploads ----
// Bucket PÚBLICO 'imagens' (avatar, mural, emblema...): valida + comprime e
// devolve a URL pública (comportamento igual ao de antes, agora validado).
export async function subirImagemPublica({ file, pasta, nomeBase }) {
  const tipo = await validarImagem(file)
  const pronta = await comprimirImagem(file)
  // extensão SEMPRE do tipo detectado (jpg se o compressor converteu)
  const ext = pronta !== file ? 'jpg' : tipo.ext
  const path = `${pasta}/${nomeBase}.${ext}`
  const { error } = await supabase.storage.from('imagens').upload(path, pronta, { upsert: true })
  if (error) throw new Error('Não foi possível enviar: ' + error.message)
  return { path, url: supabase.storage.from('imagens').getPublicUrl(path).data.publicUrl }
}

// Bucket PRIVADO 'comprovacoes' (missões e entregas de atividade — Parte A):
// valida, comprime imagem e devolve o CAMINHO (não URL) pra guardar no banco.
// Quem for ver gera uma signed URL temporária (urlComprovacao em dados.js).
export async function subirComprovacao({ file, tipo, userId, permitirVideo = false }) {
  const t = permitirVideo ? await validarMidia(file) : await validarImagem(file)
  if (t.midia === 'video' && !permitirVideo) {
    throw new Error('Aqui só aceitamos foto. 🙂')
  }
  let pronta = file
  let ext = t.ext
  if (t.midia === 'imagem') {
    pronta = await comprimirImagem(file)
    if (pronta !== file) ext = 'jpg'
  }
  // caminho começa com o auth.uid(): é isso que a política do Storage confere
  const path = `${userId}/${tipo}/${Date.now()}.${ext}`
  const { error } = await supabase.storage.from('comprovacoes').upload(path, pronta, { upsert: false })
  if (!error) return path
  // TRANSIÇÃO: se o bucket privado ainda não existe (o SQL storage-comprovacoes
  // não rodou), cai no bucket público antigo — o envio nunca quebra por causa da
  // janela de deploy. Assim que o SQL rodar, os novos envios já vão pro privado.
  // Comprovacao.jsx/urlComprovacao tratam tanto o CAMINHO privado quanto a URL pública.
  const legacyPath = `${tipo}/${userId}-${Date.now()}.${ext}`
  const up2 = await supabase.storage.from('imagens').upload(legacyPath, pronta, { upsert: true })
  if (up2.error) throw new Error('Não foi possível enviar: ' + error.message)
  return supabase.storage.from('imagens').getPublicUrl(legacyPath).data.publicUrl
}
