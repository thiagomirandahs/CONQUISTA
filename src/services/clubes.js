// Serviço: contexto do clube, marca (branding) e recursos (feature flags) — falam com o banco; a lógica pura está em lib/clube.js e lib/marca.js.
import { supabase } from '../lib/supabase.js'
import { normalizarContexto, contextoLegado } from '../lib/clube.js'
import { recursosDaResposta } from '../lib/recursos.js'
import { validarImagem } from '../lib/upload.js'
import { comprimirImagem } from '../lib/imagem.js'

// O banco ainda não recebeu o SQL da migration 33 (front publicado antes do SQL — regra do rollout): a função não existe.
export function rpcAusente(error) {
  const code = String(error?.code || '')
  const msg = String(error?.message || '')
  return code === 'PGRST202' || code === '42883' || /could not find the function|function .* does not exist/i.test(msg)
}

// Modo antigo: o clube único, o papel e a unidade do PERFIL e os recursos como o app sempre leu.
async function carregarContextoLegado(userId) {
  const [perfil, recursos] = await Promise.all([
    supabase.from('profiles').select('id,papel,unidade_id,status').eq('id', userId).maybeSingle(),
    supabase.from('club_features').select('feature, enabled'),
  ])
  if (perfil.error) throw new Error(perfil.error.message)
  return contextoLegado({ perfil: perfil.data, recursos: recursosDaResposta(recursos) })
}

// Uma chamada: os vínculos DA PRÓPRIA pessoa (clube, papel no clube, status, unidade, marca, recursos).
// Falha de rede/servidor NÃO cai no modo antigo (que assumiria papel global): sobe o erro e o app fica sem privilégio (falha fechada).
export async function carregarContexto(userId) {
  const { data, error } = await supabase.rpc('meu_contexto')
  if (!error) return normalizarContexto(data)
  if (!rpcAusente(error)) throw new Error(error.message)
  return carregarContextoLegado(userId)
}

const AVISO_SEM_SQL = 'O banco ainda não recebeu a atualização do multi-clube (SQL 20260921000033). Peça para aplicarem e tente de novo.'

// Grava a marca do PRÓPRIO clube (liderança). Devolve a marca efetiva (snake_case).
export async function gravarMarca(campos) {
  const { data, error } = await supabase.rpc('clube_marca_gravar', { p_marca: campos })
  if (error) throw new Error(rpcAusente(error) ? AVISO_SEM_SQL : error.message)
  return data
}

// Liga/desliga um recurso do PRÓPRIO clube (liderança). Devolve o mapa efetivo.
export async function definirRecurso(feature, enabled) {
  const { data, error } = await supabase.rpc('recurso_definir', { p_feature: feature, p_enabled: enabled })
  if (error) throw new Error(rpcAusente(error) ? AVISO_SEM_SQL : error.message)
  return data
}

// Catálogo da plataforma (rótulo, ícone, padrão) — a tela de recursos lista a partir dele.
export async function carregarCatalogoRecursos() {
  const { data, error } = await supabase.from('recursos_catalogo').select('chave,nome,descricao,icone,padrao,ordem').order('ordem')
  if (error) throw new Error(error.message)
  return data || []
}

const TIPOS_DA_LOGO = ['jpg', 'png', 'webp', 'gif']

// Envia a logo para o bucket PÚBLICO `publico`, na pasta do clube (é o único lugar onde a policy deixa a liderança gravar).
// Devolve a URL pública para guardar em `logo_url`.
export async function subirLogoDoClube({ clubeId, file }) {
  if (!clubeId) throw new Error('Clube não identificado.')
  const tipo = await validarImagem(file, { maxMB: 5 })
  if (!TIPOS_DA_LOGO.includes(tipo.ext)) throw new Error('Para a logo use JPG, PNG, WebP ou GIF.')
  const pronta = await comprimirImagem(file, { maxLado: 512 })
  const ext = pronta !== file ? 'jpg' : tipo.ext
  const caminho = `${clubeId}/logo-${Date.now()}.${ext}`
  const { error } = await supabase.storage.from('publico').upload(caminho, pronta, { upsert: true })
  if (error) throw new Error('Não foi possível enviar a logo: ' + error.message)
  return supabase.storage.from('publico').getPublicUrl(caminho).data.publicUrl
}
