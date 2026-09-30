// Caminho de Storage seguro: <clubId>/<usuarioId>/<finalidade>/<uuid>.<ext>
// Nunca usa o nome original do arquivo. clubId é OBRIGATÓRIO (isolamento por clube).
// ATENÇÃO: o bucket 'comunidade' (Rede DBV) usa <clube>/<usuario>/<uuid>.<ext> SEM a pasta de finalidade
// (as RPCs validam por regex) — não use este formato lá sem migration nova.
import { FINALIDADES } from './perfis.js'

const SEGURO = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/
const EXTS = ['jpg', 'jpeg', 'png', 'webp']

export const novoUuid = () => {
  const c = globalThis.crypto
  if (c?.randomUUID) return c.randomUUID()
  const b = new Uint8Array(16)
  if (c?.getRandomValues) c.getRandomValues(b); else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256)
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

const exigir = (valor, nome) => {
  if (typeof valor !== 'string' || !valor) throw new Error(`Caminho inseguro: ${nome} é obrigatório.`)
  if (!SEGURO.test(valor)) throw new Error(`Caminho inseguro: ${nome} inválido.`)
  return valor
}

export function caminhoSeguro({ clubId, usuarioId, finalidade, extensao, id } = {}) {
  exigir(clubId, 'clubId')
  exigir(usuarioId, 'usuarioId')
  if (!FINALIDADES.includes(finalidade)) throw new Error('Caminho inseguro: finalidade inválida.')
  const ext = String(extensao || '').toLowerCase().replace(/^\./, '')
  if (!EXTS.includes(ext)) throw new Error('Caminho inseguro: extensão inválida.')
  const nome = id ? exigir(id, 'id') : novoUuid()
  return `${clubId}/${usuarioId}/${finalidade}/${nome}.${ext}`
}

// true se o caminho é bem formado e pertence ao clube (1º segmento)
export function caminhoDoClube(path, clubId) {
  if (typeof path !== 'string' || !clubId || !SEGURO.test(clubId)) return false
  if (path.includes('..') || path.includes('\\') || path.startsWith('/') || path.includes('//') || /[?#%]/.test(path) || [...path].some((c) => c.charCodeAt(0) < 32)) return false
  const partes = path.split('/')
  return partes.length >= 2 && partes[0] === clubId && partes.every((p) => p && p !== '.')
}
