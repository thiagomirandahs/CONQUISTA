import { caminhoSeguro, caminhoDoClube, novoUuid } from './caminho.js'
import { extensaoDoMime } from './validar.js'

// sha256 opcional (hex) — só se o ambiente tiver crypto.subtle
export async function sha256Hex(blob) {
  const s = globalThis.crypto?.subtle
  if (!s || typeof blob?.arrayBuffer !== 'function') return null
  const h = new Uint8Array(await s.digest('SHA-256', await blob.arrayBuffer()))
  return [...h].map((x) => x.toString(16).padStart(2, '0')).join('')
}

// Metadata serializável (JSON puro) para guardar junto do registro, se a tabela tiver onde.
export async function montarMetadata(res, { comHash = false } = {}) {
  const m = { finalidade: res.finalidade, bytes: res.bytes, largura: res.largura, altura: res.altura, mime: res.mime }
  if (comHash) m.sha256 = await sha256Hex(res.principal)
  return m
}

// Devolve { uploads: [{path, blob, contentType}] (principal, miniatura), metadata }. NÃO sobe nada.
export async function montarUpload(res, { clubId, usuarioId, comHash = false } = {}) {
  const ext = extensaoDoMime(res.mime)
  if (!ext) throw new Error('Tipo de imagem processada inesperado.')
  const extMin = extensaoDoMime(res.miniatura?.type) || ext
  const id = novoUuid()
  const base = { clubId, usuarioId, finalidade: res.finalidade }
  const principal = caminhoSeguro({ ...base, extensao: ext, id })
  const miniatura = caminhoSeguro({ ...base, extensao: extMin, id: `${id}-min` })
  return {
    uploads: [
      { path: principal, blob: res.principal, contentType: res.mime },
      { path: miniatura, blob: res.miniatura, contentType: res.miniatura.type || res.mime },
    ],
    metadata: await montarMetadata(res, { comHash }),
  }
}

// Remoção EXPLÍCITA e limitada ao clube. NÃO é GC: nada chama isto automaticamente.
export async function removerComSeguranca(bucket, paths, { supabase, clubId } = {}) {
  if (!supabase?.storage) throw new Error('Cliente de storage ausente.')
  if (!clubId) throw new Error('Remoção recusada: clubId é obrigatório.')
  if (!bucket) throw new Error('Remoção recusada: bucket é obrigatório.')
  const lista = Array.isArray(paths) ? paths : [paths]
  if (!lista.length) return { removidos: [] }
  if (lista.some((p) => !caminhoDoClube(p, clubId))) {
    throw new Error('Remoção recusada: há caminhos que não pertencem ao clube informado.')
  }
  const { error } = await supabase.storage.from(bucket).remove(lista)
  if (error) throw new Error('Não foi possível remover: ' + error.message)
  return { removidos: lista }
}
