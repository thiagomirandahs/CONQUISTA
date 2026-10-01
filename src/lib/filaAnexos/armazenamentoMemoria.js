// Adaptador EM MEMÓRIA da fila de anexos (testes e fallback quando IndexedDB não existe/está bloqueado:
// a fila então vale só enquanto o app estiver aberto — a tela deve avisar). Mesma interface do IndexedDB.
//
// Interface (tudo assíncrono):
//   listar()                 -> meta[]
//   obter(id)                -> meta | null
//   lerBlob(id)              -> Blob | null
//   inserir(meta, blob)      -> true | false (false = o id já existia; nada foi gravado) — ATÔMICO
//   atualizar(id, fn)        -> meta novo | null. fn(meta) devolve { meta, apagarBlob? } ou null (sem mudança) — ATÔMICO
//   apagar(id)               -> void
//   limparTudo()             -> void
import { ErroFila } from './erros.js'

const copia = (m) => (m ? JSON.parse(JSON.stringify(m)) : null)

export function criarArmazenamentoMemoria({ limiteBytes = Infinity } = {}) {
  const metas = new Map()
  const blobs = new Map()
  const usados = () => [...blobs.values()].reduce((s, b) => s + (b.size || 0), 0)

  return {
    nome: 'memoria',
    async listar() { return [...metas.values()].map(copia) },
    async obter(id) { return copia(metas.get(id)) },
    async lerBlob(id) { return blobs.get(id) ?? null },
    async inserir(meta, blob) {
      if (metas.has(meta.id)) return false
      if (blob && usados() + blob.size > limiteBytes) throw new ErroFila('COTA', 'Sem espaço para gravar o anexo.')
      metas.set(meta.id, copia(meta))
      if (blob) blobs.set(meta.id, blob)
      return true
    },
    async atualizar(id, fn) {
      const atual = copia(metas.get(id))
      if (!atual) return null
      const r = fn(atual)
      if (!r) return null
      metas.set(id, copia(r.meta))
      if (r.apagarBlob) blobs.delete(id)
      return copia(r.meta)
    },
    async apagar(id) { metas.delete(id); blobs.delete(id) },
    async limparTudo() { metas.clear(); blobs.clear() },
  }
}
