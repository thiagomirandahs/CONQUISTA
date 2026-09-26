// Serviço da VITRINE do site (migration 190): cartão de visita dos clubes (opt-in) e parceiros.
// Leitura pública = só RPCs anônimas que devolvem os campos publicados. Escrita = diretoria do clube / admin da plataforma.
import { supabase } from '../lib/supabase.js'
import { validarImagem } from '../lib/upload.js'
import { comprimirImagem } from '../lib/imagem.js'

async function rpc(nome, args) {
  const { data, error } = await supabase.rpc(nome, args)
  if (error) throw new Error(error.message)
  return data
}

// ---- público (site) ----
export const clubesDaVitrine = async () => (await rpc('vitrine_clubes_publico')) || []
export const cartaoDoClube = (slug) => rpc('vitrine_clube_publico', { p_slug: slug })
export const parceirosDoSite = async () => (await rpc('parceiros_publico')) || []

// ---- diretoria (Configurações do clube) ----
export const lerCartaoDoClube = (clubeId) => rpc('vitrine_clube_ler', { p_club_id: clubeId })
export const salvarCartaoDoClube = (clubeId, dados) => rpc('vitrine_clube_salvar', { p_club_id: clubeId, p_dados: dados })

// ---- admin da plataforma ----
export const adminCartoesListar = async () => (await rpc('admin_vitrine_clubes_listar')) || []
export const adminCartaoModerar = (clubeId, ocultar, motivo) =>
  rpc('admin_vitrine_clube_moderar', { p_club_id: clubeId, p_ocultar: ocultar, p_motivo: motivo || null })
export const adminParceirosListar = async () => (await rpc('admin_parceiros_listar')) || []
export const adminParceiroSalvar = (id, dados) => rpc('admin_parceiro_salvar', { p_id: id || null, p_dados: dados })
export const adminParceiroApagar = (id) => rpc('admin_parceiro_apagar', { p_id: id })

// logo do parceiro: bucket PÚBLICO 'parceiros' (só o admin grava; JPG/PNG/WebP até 2 MB — sem SVG)
export async function subirLogoDoParceiro(file) {
  const tipo = await validarImagem(file, { maxMB: 2 })
  if (!['jpg', 'png', 'webp'].includes(tipo.ext)) throw new Error('Para a logo use JPG, PNG ou WebP.')
  const pronta = await comprimirImagem(file, { maxLado: 512 })
  const ext = pronta !== file ? 'jpg' : tipo.ext
  const caminho = `logo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
  const { error } = await supabase.storage.from('parceiros').upload(caminho, pronta, { upsert: false })
  if (error) throw new Error('Não foi possível enviar a logo: ' + error.message)
  return supabase.storage.from('parceiros').getPublicUrl(caminho).data.publicUrl
}

// ---- utilitários puros ----
// Só http(s): nada de javascript:/data: no href mesmo que algo passe pelo banco.
// http(s) absoluto OU caminho do próprio site ("/clubes/x.png" — brasão do clube fundador); nunca "//host" nem javascript:
export const urlSegura = (u) => (typeof u === 'string' && /^(https?:\/\/[^\s]+|\/(?!\/)[^\s]*)$/i.test(u.trim()) ? u.trim() : null)
export const linkWhatsApp = (numero, texto) => {
  const d = String(numero || '').replace(/\D/g, '')
  if (d.length < 12 || d.length > 13) return null
  return `https://wa.me/${d}${texto ? `?text=${encodeURIComponent(texto)}` : ''}`
}
export const corSegura = (c) => (typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c) ? c : null)
