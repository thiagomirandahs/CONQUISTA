// COMUNIDADE entre clubes (migrations 430–432). Toda regra vive no SERVIDOR:
//  * triagem de texto (palavras proibidas com disfarces, telefone, @, links, "me chama no zap");
//  * recurso 'comunidade' (somente da plataforma), autorização dos pais, suspensão, limites;
//  * denúncia esconde na hora; moderação da diretoria; foto só aparece depois de aprovada.
// Aqui só chamamos as RPCs e cuidamos da foto: ela é SEMPRE redesenhada em canvas antes de subir
// (limparFotoParaComunidade), o que descarta EXIF/GPS, e vai para o bucket PRIVADO 'comunidade'.
import { supabase } from '../lib/supabase.js'
import { solicitarSaneamento } from '../lib/saneamentoImagem.js'
import { validarImagem } from '../lib/upload.js'
import { limparFotoParaComunidade } from '../lib/imagem.js'

const BUCKET = 'comunidade'

async function rpc(nome, args) {
  const { data, error } = await supabase.rpc(nome, args)
  if (error) throw new Error(error.message)
  return data
}

export const MOTIVOS_DENUNCIA = [
  ['ofensivo', 'Ofensivo ou desrespeitoso'],
  ['perigoso', 'Perigoso ou me deixou com medo'],
  ['contato', 'Pede contato, telefone ou rede social'],
  ['imagem', 'Foto inadequada'],
  ['outro', 'Outro motivo'],
]

export const meuStatus = () => rpc('comunidade_meu_status')

export const carregarFeed = (cursor = null, limite = 10) =>
  rpc('comunidade_feed', { p_antes: cursor?.antes ?? null, p_antes_id: cursor?.antes_id ?? null, p_limite: limite })

export const carregarPost = (id) => rpc('comunidade_post', { p_id: id })

export const curtir = (postId, curtirOuNao = true) => rpc('comunidade_curtir', { p_post: postId, p_curtir: curtirOuNao })

export const carregarComentarios = (postId, antes = null) =>
  rpc('comunidade_comentarios', { p_post: postId, p_antes: antes, p_limite: 20 })

export const comentar = (postId, texto) => rpc('comunidade_comentar', { p_post: postId, p_texto: texto })

export const compartilhar = (postId, legenda = null) =>
  rpc('comunidade_publicar', { p_legenda: legenda, p_foto_path: null, p_repost_de: postId })

export const denunciar = (tipo, id, motivo) => rpc('comunidade_denunciar', { p_tipo: tipo, p_id: id, p_motivo: motivo })

const apagarArquivo = async (path) => {
  if (!path) return
  await supabase.storage.from(BUCKET).remove([path]).catch(() => {})
}

export async function apagar(tipo, id) {
  const r = await rpc('comunidade_apagar', { p_tipo: tipo, p_id: id })
  if (r?.foto) await apagarArquivo(r.foto)   // melhor esforço: o post já saiu do ar
  return r
}

const novoId = () => (globalThis.crypto?.randomUUID?.() ||
  'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
  }))

// Publica texto e/ou foto. Com foto: valida pelos bytes, redesenha sem EXIF, sobe em
// <clube>/<eu>/<uuid>.jpg e só então pede a publicação (que entra "em análise").
// Se o servidor recusar (triagem, limite), a foto que subiu é apagada.
export async function publicar({ legenda, file, clubeId, userId }) {
  let path = null
  if (file) {
    await validarImagem(file)
    const limpa = await limparFotoParaComunidade(file)
    path = `${clubeId}/${userId}/${novoId()}.${limpa.type === 'image/webp' ? 'webp' : 'jpg'}`
    const { error } = await supabase.storage.from(BUCKET).upload(path, limpa, { upsert: false, contentType: limpa.type })
    if (error) throw new Error('Não foi possível enviar a foto: ' + error.message)
    solicitarSaneamento(BUCKET, path)
  }
  let r
  try {
    r = await rpc('comunidade_publicar', { p_legenda: legenda || null, p_foto_path: path, p_repost_de: null })
  } catch (e) {
    await apagarArquivo(path)
    throw e
  }
  if (!r?.ok) await apagarArquivo(path)
  return r
}

// URL assinada curta (bucket privado): só abre se a policy do servidor deixar
export async function urlDaFoto(path) {
  if (!path) return null
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 600)
  if (error) return null
  return data?.signedUrl || null
}

// ---- diretoria ----
export const filaModeracao = () => rpc('comunidade_fila_moderacao')
export const moderar = (tipo, id, acao, motivo = null) => rpc('comunidade_moderar', { p_tipo: tipo, p_id: id, p_acao: acao, p_motivo: motivo })
export const encerrarSuspensao = (usuarioId) => rpc('comunidade_encerrar_suspensao', { p_usuario: usuarioId })

// ---- responsável ----
export const autorizacoesDosFilhos = () => rpc('comunidade_autorizacoes_dos_filhos')
export const autorizar = (desbravadorId, autorizado) => rpc('comunidade_autorizar', { p_desbravador: desbravadorId, p_autorizar: autorizado })
// autorização de USO DE IMAGEM (migration 470): o responsável DESLIGA (ou religa o que ele desligou)
export const responsavelImagem = (desbravadorId, desligar) =>
  rpc('rede_responsavel_imagem', { p_desbravador: desbravadorId, p_desligar: desligar })

// ---- plataforma ----
export const adminPainel = () => rpc('admin_comunidade_painel')
export const adminModerar = (tipo, id, acao, motivo = null) => rpc('admin_comunidade_moderar', { p_tipo: tipo, p_id: id, p_acao: acao, p_motivo: motivo })
export const adminTermos = () => rpc('admin_comunidade_termos')
export const adminSalvarTermo = ({ termo, modo = 'exata', categoria = 'ofensa', ativo = true }) =>
  rpc('admin_comunidade_termo_salvar', { p_termo: termo, p_modo: modo, p_categoria: categoria, p_ativo: ativo })
export const adminRemoverTermo = (id) => rpc('admin_comunidade_termo_remover', { p_id: id })

// "há 5 min", "ontem" — curto, para caber no celular
export function tempoRelativo(iso, agora = Date.now()) {
  const s = Math.max(0, Math.round((agora - new Date(iso).getTime()) / 1000))
  if (s < 60) return 'agora'
  if (s < 3600) return `há ${Math.floor(s / 60)} min`
  if (s < 86400) return `há ${Math.floor(s / 3600)} h`
  const d = Math.floor(s / 86400)
  return d === 1 ? 'ontem' : `há ${d} dias`
}
