// Central de chamados (migration 290). Tudo passa por RPC security definer: o servidor decide quem vê
// o quê (só o autor e a equipe da plataforma). Anexo: bucket PRIVADO 'suporte-anexos', pasta = uid.
import { supabase } from '../lib/supabase.js'

export const CATEGORIAS = [
  ['duvida', 'Dúvida'], ['problema', 'Problema/erro'], ['pagamento', 'Pagamento/plano'],
  ['sugestao', 'Sugestão'], ['privacidade', 'Privacidade/dados'], ['outro', 'Outro'],
]
export const ROTULO_CATEGORIA = Object.fromEntries(CATEGORIAS)
export const ROTULO_STATUS_CHAMADO = {
  aberto: 'Aberto', em_andamento: 'Em andamento', aguardando_usuario: 'Aguardando você',
  resolvido: 'Resolvido', fechado: 'Fechado',
}
export const PRIORIDADES = [['baixa', 'Baixa'], ['normal', 'Normal'], ['alta', 'Alta'], ['urgente', 'Urgente']]
export const ROTULO_PRIORIDADE = Object.fromEntries(PRIORIDADES)
export const TAMANHO_MAX_ANEXO = 3 * 1024 * 1024
const TIPOS = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }
const BUCKET = 'suporte-anexos'

async function rpc(nome, args) {
  const { data, error } = await supabase.rpc(nome, args)
  if (error) throw new Error(error.message)
  return data
}

// Contexto técnico NÃO sensível: nunca lê storage/cookies/tokens — só versão, rota, clube, papel e aparelho resumido.
export function resumirAparelho(ua = '') {
  const so = /Android\s([\d.]+)/.exec(ua)?.[0] || (/iPhone|iPad/.test(ua) ? `iOS ${(/OS (\d+)/.exec(ua) || [])[1] || ''}`.trim()
    : /Windows/.test(ua) ? 'Windows' : /Mac OS/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : 'Outro')
  const nav = /Edg\//.test(ua) ? 'Edge' : /SamsungBrowser/.test(ua) ? 'Samsung Internet' : /Chrome\//.test(ua) ? 'Chrome'
    : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Outro'
  return { sistema: so, navegador: nav }
}

export function contextoTecnico({ clube, papel, rota } = {}) {
  const w = typeof window !== 'undefined' ? window : {}
  const { sistema, navegador } = resumirAparelho(w.navigator?.userAgent || '')
  return {
    versao: import.meta.env?.VITE_APP_VERSION || import.meta.env?.MODE || 'web',
    rota: rota || w.location?.pathname || '',
    clube: clube || '',
    papel: papel || '',
    sistema, navegador,
    app: w.Capacitor?.isNativePlatform?.() ? 'android-apk' : 'web',
    tela: w.screen ? `${w.screen.width}x${w.screen.height}` : '',
  }
}

export function validarAnexo(arquivo) {
  if (!arquivo) return null
  if (!TIPOS[arquivo.type]) return 'Envie uma imagem JPG, PNG ou WEBP.'
  if (arquivo.size > TAMANHO_MAX_ANEXO) return 'A imagem passa de 3 MB.'
  return null
}

export async function enviarAnexo(arquivo) {
  const erro = validarAnexo(arquivo)
  if (erro) throw new Error(erro)
  const { data: s } = await supabase.auth.getUser()
  const uid = s?.user?.id
  if (!uid) throw new Error('Entre na sua conta.')
  const caminho = `${uid}/${crypto.randomUUID()}.${TIPOS[arquivo.type]}`
  const { error } = await supabase.storage.from(BUCKET).upload(caminho, arquivo, { contentType: arquivo.type, upsert: false })
  if (error) throw new Error(error.message)
  return caminho
}

export async function urlDoAnexo(caminho) {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(caminho, 600)
  if (error) throw new Error(error.message)
  return data?.signedUrl
}

// ---- usuário
export const chamadoAbrir = ({ categoria, assunto, descricao, anexo = null, prioridadeSugerida = null, contexto = {} }) =>
  rpc('suporte_chamado_abrir', {
    p_categoria: categoria, p_assunto: assunto, p_descricao: descricao, p_anexo_path: anexo,
    p_prioridade_sugerida: prioridadeSugerida, p_contexto: contexto,
  })
export const meusChamados = async () => (await rpc('suporte_meus_chamados')) || []
export const chamadoVer = (id) => rpc('suporte_chamado_ver', { p_id: id })
export const chamadoResponder = (id, texto, anexo = null) => rpc('suporte_chamado_responder', { p_id: id, p_texto: texto, p_anexo_path: anexo })

// ---- plataforma
export const adminChamadosContagem = async () => Number(await rpc('admin_chamados_contagem')) || 0
export const adminChamadosListar = async (filtro = 'abertos') => (await rpc('admin_chamados_listar', { p_filtro: filtro })) || []
export const adminChamadoVer = (id) => rpc('admin_chamado_ver', { p_id: id })
export const adminChamadoResponder = (id, { texto, interna = false, anexo = null, status = null }) =>
  rpc('admin_chamado_responder', { p_id: id, p_texto: texto, p_interna: interna, p_anexo_path: anexo, p_novo_status: status })
export const adminChamadoAtualizar = (id, { status = null, prioridade = null, assumir = null } = {}) =>
  rpc('admin_chamado_atualizar', { p_id: id, p_status: status, p_prioridade: prioridade, p_assumir: assumir })

export function tempoDesde(iso, agora = Date.now()) {
  if (!iso) return ''
  const min = Math.max(0, Math.round((agora - new Date(iso).getTime()) / 60000))
  if (min < 60) return `${min} min`
  const h = Math.round(min / 60)
  if (h < 48) return `${h} h`
  return `${Math.round(h / 24)} d`
}
