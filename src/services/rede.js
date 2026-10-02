// REDE DBV (migrations 470–472): a Comunidade como "outro mundo" dentro do app.
// Toda regra continua no SERVIDOR (triagem, autorização dos pais, autorização de imagem, limites,
// suspensão, denúncia, foto só depois da diretoria). Aqui: chamadas às RPCs e a foto, que é SEMPRE
// redesenhada e comprimida no aparelho (WebP/JPEG, ≤ 1080 px, alvo 150 KB, sem EXIF/GPS).
import { supabase } from '../lib/supabase.js'
import { solicitarSaneamento } from '../lib/saneamentoImagem.js'
import { validarImagem } from '../lib/upload.js'
import { validarImagem as validarImagemReal } from '../lib/imagens/validar.js'
import { PERFIS } from '../lib/imagens/perfis.js'
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

// Feed em duas abas (515): 'meu_clube' (padrão) e 'comunidade' ('todos' é apelido antigo de comunidade).
export const FILTROS_FEED = Object.freeze(['meu_clube', 'comunidade'])
export const carregarFeed = (filtro = 'meu_clube', cursor = null, limite = 10) =>
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
  titulo: 'Tem certeza que quer publicar?', descricao: 'Fica visível só para o seu clube.',
  rotulo: 'Publicar', cancelar: 'Voltar', perigo: false,
}
// Alcance "Comunidade" (515): só diretoria/instrutor; a confirmação é explícita porque todos os clubes veem.
export const CONFIRMAR_POST_COMUNIDADE = {
  titulo: 'Publicar na Comunidade?',
  descricao: 'Todos os clubes da Rede DBV vão ver esta publicação, não só o seu clube. Confira o texto e a foto antes de continuar.',
  rotulo: 'Publicar para todos os clubes', cancelar: 'Voltar', perigo: false,
}
export const confirmacaoDePublicar = (alcance) => (alcance === 'comunidade' ? CONFIRMAR_POST_COMUNIDADE : CONFIRMAR_POST)
export const ALCANCES = Object.freeze(['clube', 'comunidade'])
export const TIPOS_NOVOS = Object.freeze(['atividade', 'evento', 'aviso', 'foto_clube'])
export const CONFIRMAR_STORY = {
  titulo: 'Tem certeza que quer publicar este story?',
  descricao: 'Ele fica visível só para o seu clube por 24 horas.',
  rotulo: 'Publicar', cancelar: 'Voltar', perigo: false,
}
// Stories para todos na Comunidade (migration 535, decisão do dono de 02/10/2026): qualquer participante publica um
// story para todos os clubes da Rede; sem amigos/seguir e sem aprovação prévia (moderação por denúncia).
export const CONFIRMAR_STORY_COMUNIDADE = {
  titulo: 'Publicar este story na Comunidade?',
  descricao: 'Todos os clubes da Rede vão ver por 24 horas.',
  rotulo: 'Publicar para todos os clubes', cancelar: 'Voltar', perigo: false,
}
export const confirmacaoDeStory = (alcance) => (alcance === 'comunidade' ? CONFIRMAR_STORY_COMUNIDADE : CONFIRMAR_STORY)
export const QUEM_VE_STORY = Object.freeze({ clube: 'Só o seu clube vê por 24 horas', comunidade: 'Todos os clubes da Rede vão ver por 24 horas' })
export const STORY_COMUNIDADE_INDISPONIVEL = 'Os stories da Comunidade ainda não estão disponíveis. Por enquanto, publique no Meu Clube 🙂'

// O banco ainda sem a 535 não conhece o parâmetro p_alcance: o PostgREST responde "função não encontrada".
const semAlcanceNoBanco = (error) => error?.code === 'PGRST202' || /could not find the function/i.test(error?.message || '')

// Faixa de stories, UMA chamada por aba (o servidor limita a 60 pessoas e devolve só caminhos; a foto de cada story é
// assinada sob demanda pelo viewer). 'clube' chama sem argumento — idêntico ao app antigo e compatível com o banco sem
// a 535. 'comunidade' devolve null quando o banco ainda não tem a 535 (a tela só não mostra a faixa).
export async function carregarStories(alcance = 'clube') {
  if (!ALCANCES.includes(alcance)) throw new Error('Alcance inválido.')
  if (alcance === 'clube') return rpc('rede_stories')
  const { data, error } = await supabase.rpc('rede_stories', { p_alcance: alcance })
  if (error) {
    if (semAlcanceNoBanco(error)) return null
    throw new Error(error.message)
  }
  return data
}
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
// `alcance`: 'clube' (padrão; a chamada vai SEM p_alcance, como sempre foi) ou 'comunidade' (todos os clubes da Rede).
export async function publicarStory({ foto, texto, clubeId, userId, alcance = 'clube' }) {
  if (!ALCANCES.includes(alcance)) throw new Error('Alcance inválido.')
  exigirDono(clubeId, userId)
  const ext = foto.arquivo.type === 'image/webp' ? 'webp' : 'jpg'
  const path = `${clubeId}/${userId}/${novoId()}.${ext}`
  const { error } = await supabase.storage.from(BUCKET).upload(path, foto.arquivo, { upsert: false, contentType: foto.arquivo.type })
  if (error) throw new Error('Não foi possível enviar a foto: ' + error.message)
  solicitarSaneamento(BUCKET, path)
  let r
  try {
    const args = { p_foto_path: path, p_texto: texto || null }
    if (alcance === 'comunidade') args.p_alcance = 'comunidade'
    const { data, error } = await supabase.rpc('rede_story_publicar', args)
    if (error) throw new Error(alcance === 'comunidade' && semAlcanceNoBanco(error) ? STORY_COMUNIDADE_INDISPONIVEL : error.message)
    r = data
  } catch (e) {
    await apagarArquivo(path)
    throw e
  }
  if (!r?.ok) await apagarArquivo(path)
  return r
}

// Sem clube/perfil o caminho viraria "undefined/undefined/…" e o Storage recusaria com erro cru: falha ANTES, com texto humano.
const exigirDono = (clubeId, userId) => {
  if (!clubeId || !userId) throw new Error('Não consegui identificar seu clube ou seu perfil agora. Volte ao início e tente de novo. 🙂')
}

// Prepara a foto antes de publicar (a tela mostra "foto otimizada: 3,4 MB → 110 KB").
export async function prepararFoto(file) {
  // MIME real por assinatura (só JPEG/PNG/WebP; recusa SVG/GIF/HEIC/disfarçados) + dimensões; perfil 'feed' = FOTO_REDE.
  await validarImagemReal(file)
  const { maxLado, minLado, alvoBytes, qualidade, qualidadeMin } = PERFIS.feed
  const r = await otimizarFoto(file, { maxLado, minLado, alvoBytes, qualidade, qualidadeMin })
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
export async function publicarNaRede({ tipo, legenda, foto, alt, desafioId, alcance = 'clube', clubeId, userId }) {
  if (!ALCANCES.includes(alcance)) throw new Error('Alcance inválido.')
  let path = null
  if (foto?.arquivo) {
    exigirDono(clubeId, userId)
    const ext = foto.arquivo.type === 'image/webp' ? 'webp' : 'jpg'
    path = `${clubeId}/${userId}/${novoId()}.${ext}`
    const { error } = await supabase.storage.from(BUCKET).upload(path, foto.arquivo, { upsert: false, contentType: foto.arquivo.type })
    if (error) throw new Error('Não foi possível enviar a foto: ' + error.message)
    solicitarSaneamento(BUCKET, path)
  }
  let r
  try {
    r = await rpc('rede_publicar', {
      p_tipo: tipo, p_legenda: legenda || null, p_foto_path: path, p_foto_alt: path ? (alt || null) : null,
      p_desafio: tipo === 'desafio' ? desafioId : null, p_alcance: alcance,
    })
  } catch (e) {
    await apagarArquivo(path)
    throw e
  }
  if (!r?.ok) await apagarArquivo(path)
  return r
}

// Conquista NÃO é texto livre (515, D6): o servidor monta o texto a partir do registro real (classe investida /
// especialidade concluída) do PRÓPRIO clube. Só diretoria/instrutor.
export const ORIGENS_CONQUISTA = Object.freeze(['classe', 'especialidade'])
// Lista das conquistas que a liderança pode compartilhar (517): o servidor devolve só o que é real e já traz a
// `previa` com o texto exatamente como será publicado. Vazio se a pessoa não é diretoria|instrutor.
export async function listarConquistasPublicaveis(alcance = 'clube') {
  if (!ALCANCES.includes(alcance)) throw new Error('Alcance inválido.')
  const r = await rpc('rede_conquistas_publicaveis', { p_alcance: alcance })
  return (Array.isArray(r) ? r : []).filter((c) => ORIGENS_CONQUISTA.includes(c?.origem_tipo) && c?.origem_id)
}
export function publicarConquista({ origemTipo, origemId, alcance = 'clube' }) {
  if (!ORIGENS_CONQUISTA.includes(origemTipo) || !origemId) throw new Error('Não encontramos essa conquista concluída no seu clube.')
  if (!ALCANCES.includes(alcance)) throw new Error('Alcance inválido.')
  return rpc('rede_publicar_conquista', { p_origem_tipo: origemTipo, p_origem_id: origemId, p_alcance: alcance })
}

// Iniciais para o avatar genérico ("Ana Souza" -> "AS")
export function iniciais(nome) {
  const p = String(nome || '?').trim().split(/\s+/)
  return ((p[0]?.[0] || '?') + (p[1]?.[0] || '')).toUpperCase()
}
