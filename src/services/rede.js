// REDE DBV (migrations 470–472): a Comunidade como "outro mundo" dentro do app.
// Toda regra continua no SERVIDOR (triagem, autorização dos pais, autorização de imagem, limites,
// suspensão, denúncia, foto só depois da diretoria). Aqui: chamadas às RPCs e a foto, que é SEMPRE
// redesenhada e comprimida no aparelho (WebP/JPEG, ≤ 1080 px, alvo 150 KB, sem EXIF/GPS).
import { supabase } from '../lib/supabase.js'
import { validarImagem } from '../lib/upload.js'
import { otimizarFoto, LIMITE_BUCKET_REDE, FOTO_STORY } from '../lib/imagem.js'

export {
  meuStatus, carregarComentarios, comentar, compartilhar, denunciar, apagar, curtir, urlDaFoto, tempoRelativo,
  MOTIVOS_DENUNCIA, filaModeracao, moderar, encerrarSuspensao,
} from './comunidade.js'

const BUCKET = 'comunidade'

async function rpc(nome, args) {
  const { data, error } = await supabase.rpc(nome, args)
  if (error) throw new Error(error.message)
  return data
}

export const CATEGORIAS_CONQUISTA = [
  ['classe', 'Classe', '🎖️'],
  ['especialidade', 'Especialidade', '🏅'],
  ['investidura', 'Investidura', '⭐'],
  ['acampamento', 'Acampamento', '⛺'],
  ['outra', 'Outra conquista', '🎉'],
]

export const carregarFeed = (filtro = 'todos', cursor = null, limite = 10) =>
  rpc('rede_feed', { p_filtro: filtro, p_antes: cursor?.antes ?? null, p_antes_id: cursor?.antes_id ?? null, p_limite: limite })

export const salvar = (postId, salvarOuNao = true) => rpc('rede_salvar', { p_post: postId, p_salvar: salvarOuNao })
export const carregarDesafios = () => rpc('rede_desafios')
export const carregarPerfil = (usuarioId = null) => rpc('rede_perfil', { p_usuario: usuarioId })
export const carregarPostsDoPerfil = (usuarioId = null, aba = 'publicacoes', cursor = null) =>
  rpc('rede_perfil_posts', { p_usuario: usuarioId, p_aba: aba, p_antes: cursor?.antes ?? null, p_antes_id: cursor?.antes_id ?? null, p_limite: 12 })

// ---- diretoria ----
export const membrosAutorizacaoImagem = () => rpc('rede_membros_autorizacao_imagem')
export const marcarAutorizacaoImagem = (usuarioId, arquivada) =>
  rpc('rede_marcar_autorizacao_imagem', { p_usuario: usuarioId, p_arquivada: arquivada })

// ---- plataforma ----
export const adminDesafios = () => rpc('admin_rede_desafios')
export const adminSalvarDesafio = ({ id = null, titulo, descricao = '', pontos = 10, inicio, fim, ativo = true }) =>
  rpc('admin_rede_desafio_salvar', { p_id: id, p_titulo: titulo, p_descricao: descricao, p_pontos: Number(pontos) || 0,
    p_inicio: inicio, p_fim: fim, p_ativo: ativo })
export const adminArmazenamento = () => rpc('admin_rede_armazenamento')

const novoId = () => (globalThis.crypto?.randomUUID?.() ||
  'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
  }))

// ---- stories (migration 480) ----
// Hoje (decisão do dono, 29/09/2026) foto publica DIRETO, depois de uma confirmação clara na tela.
// O servidor decide (rede_foto_exige_aprovacao); estes textos são só o que a tela pergunta antes.
export const CONFIRMAR_POST = {
  titulo: 'Tem certeza que quer publicar?', descricao: 'Fica visível para todos os clubes da Rede DBV.',
  rotulo: 'Publicar', cancelar: 'Voltar', perigo: false,
}
export const CONFIRMAR_STORY = {
  titulo: 'Tem certeza que quer publicar este story?',
  descricao: 'Ele fica visível para todos os clubes da Rede DBV por 24 horas.',
  rotulo: 'Publicar', cancelar: 'Voltar', perigo: false,
}
export const carregarStories = () => rpc('rede_stories')
export const marcarStoryVisto = (id) => rpc('rede_story_visto', { p_story: id })
export const apagarStory = (id) => rpc('rede_story_apagar', { p_story: id })
export const buscarNaRede = (termo, clubeId = null) => rpc('rede_buscar', { p_termo: termo || null, p_clube: clubeId })

export async function prepararFotoStory(file) {
  await validarImagem(file)
  const r = await otimizarFoto(file, FOTO_STORY)
  if (r.depois > LIMITE_BUCKET_REDE) throw new Error('Essa foto ficou grande demais mesmo depois de otimizar. Tente outra. 🙂')
  return r
}

// Sobe a foto do story e publica; se o servidor recusar, apaga o arquivo que subiu.
export async function publicarStory({ foto, texto, clubeId, userId }) {
  const ext = foto.arquivo.type === 'image/webp' ? 'webp' : 'jpg'
  const path = `${clubeId}/${userId}/${novoId()}.${ext}`
  const { error } = await supabase.storage.from(BUCKET).upload(path, foto.arquivo, { upsert: false, contentType: foto.arquivo.type })
  if (error) throw new Error('Não foi possível enviar a foto: ' + error.message)
  let r
  try {
    r = await rpc('rede_story_publicar', { p_foto_path: path, p_texto: texto || null })
  } catch (e) {
    await apagarArquivo(path)
    throw e
  }
  if (!r?.ok) await apagarArquivo(path)
  return r
}

// Prepara a foto antes de publicar (a tela mostra "foto otimizada: 3,4 MB → 110 KB").
export async function prepararFoto(file) {
  await validarImagem(file)
  const r = await otimizarFoto(file)
  if (r.depois > LIMITE_BUCKET_REDE) throw new Error('Essa foto ficou grande demais mesmo depois de otimizar. Tente outra. 🙂')
  return r
}

const apagarArquivo = async (path) => {
  if (!path) return
  await supabase.storage.from(BUCKET).remove([path]).catch(() => {})
}

// Publica na rede. `foto` é o resultado de prepararFoto (arquivo já limpo e comprimido).
// Sobe em <clube>/<eu>/<uuid>.webp|jpg e só então pede a publicação. Se o servidor recusar
// (triagem, limite, desafio), a foto que subiu é apagada.
export async function publicarNaRede({ tipo, legenda, foto, alt, desafioId, conquista, clubeId, userId }) {
  let path = null
  if (foto?.arquivo) {
    const ext = foto.arquivo.type === 'image/webp' ? 'webp' : 'jpg'
    path = `${clubeId}/${userId}/${novoId()}.${ext}`
    const { error } = await supabase.storage.from(BUCKET).upload(path, foto.arquivo, { upsert: false, contentType: foto.arquivo.type })
    if (error) throw new Error('Não foi possível enviar a foto: ' + error.message)
  }
  let r
  try {
    r = await rpc('rede_publicar', {
      p_tipo: tipo, p_legenda: legenda || null, p_foto_path: path, p_foto_alt: path ? (alt || null) : null,
      p_desafio: tipo === 'desafio' ? desafioId : null, p_conquista: tipo === 'conquista' ? conquista : null,
    })
  } catch (e) {
    await apagarArquivo(path)
    throw e
  }
  if (!r?.ok) await apagarArquivo(path)
  return r
}

// Iniciais para o avatar genérico ("Ana Souza" -> "AS")
export function iniciais(nome) {
  const p = String(nome || '?').trim().split(/\s+/)
  return ((p[0]?.[0] || '?') + (p[1]?.[0] || '')).toUpperCase()
}
