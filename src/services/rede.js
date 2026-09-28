// REDE DBV (migrations 470–472): a Comunidade como "outro mundo" dentro do app.
// Toda regra continua no SERVIDOR (triagem, autorização dos pais, autorização de imagem, limites,
// suspensão, denúncia, foto só depois da diretoria). Aqui: chamadas às RPCs e a foto, que é SEMPRE
// redesenhada e comprimida no aparelho (WebP/JPEG, ≤ 1080 px, alvo 150 KB, sem EXIF/GPS).
import { supabase } from '../lib/supabase.js'
import { validarImagem } from '../lib/upload.js'
import { otimizarFoto, LIMITE_BUCKET_REDE } from '../lib/imagem.js'

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
