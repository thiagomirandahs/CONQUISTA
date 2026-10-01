// Adaptador IndexedDB da fila de anexos (mesma interface do adaptador em memória).
//
// Por que ArrayBuffer e não Blob dentro do IndexedDB: WebViews antigas do Android (e o iOS) têm histórico
// de bugs com Blob guardado em IndexedDB (arquivo some, leitura falha após reiniciar). ArrayBuffer é
// clonado por valor e sempre funciona. O custo é memória temporária — o anexo já vem comprimido
// (<= ~1,2 MB), então é irrelevante.
//
// Duas lojas: `meta` (leve, listável) e `blobs` (pesado, lido só na hora de enviar/pré-visualizar).
// Toda alteração é UMA transação (meta + blob juntos), e `inserir`/`atualizar` leem-e-gravam na mesma
// transação: duas abas/execuções não passam uma na frente da outra.
import { ErroFila, ehQuotaExcedida } from './erros.js'

const LOJA_META = 'meta'
const LOJA_BLOBS = 'blobs'

export async function paraBuffer(blob) {
  if (typeof blob.arrayBuffer === 'function') return blob.arrayBuffer()
  return new Promise((res, rej) => { // jsdom/WebView sem Blob.arrayBuffer
    const r = new FileReader()
    r.onload = () => res(r.result)
    r.onerror = () => rej(r.error)
    r.readAsArrayBuffer(blob)
  })
}

const traduzir = (e) => {
  if (e instanceof ErroFila) return e
  if (ehQuotaExcedida(e)) return new ErroFila('COTA', 'Sem espaço para gravar o anexo.', e?.name)
  return e instanceof Error ? e : new Error(String(e))
}

export function criarArmazenamentoIdb({ indexedDB: idb = globalThis.indexedDB, nome = 'dbv-fila-anexos' } = {}) {
  if (!idb) throw new ErroFila('ENTRADA', 'IndexedDB indisponível neste ambiente.')
  let dbPromessa = null

  const abrir = () => {
    if (dbPromessa) return dbPromessa
    dbPromessa = new Promise((res, rej) => {
      let req
      try { req = idb.open(nome, 1) } catch (e) { rej(traduzir(e)); return }
      req.onupgradeneeded = () => {
        const db = req.result
        if (!db.objectStoreNames.contains(LOJA_META)) db.createObjectStore(LOJA_META, { keyPath: 'id' })
        if (!db.objectStoreNames.contains(LOJA_BLOBS)) db.createObjectStore(LOJA_BLOBS, { keyPath: 'id' })
      }
      req.onsuccess = () => {
        const db = req.result
        db.onversionchange = () => { db.close(); dbPromessa = null }
        res(db)
      }
      req.onerror = () => rej(traduzir(req.error))
      req.onblocked = () => rej(new Error('Banco de anexos bloqueado por outra aba.'))
    }).catch((e) => { dbPromessa = null; throw e })
    return dbPromessa
  }

  // Roda `corpo(lojaMeta, lojaBlobs, definir)` numa transação e resolve com o que `definir` guardou.
  const transacao = async (modo, corpo) => {
    const db = await abrir()
    return new Promise((res, rej) => {
      let resultado = null
      let tx
      try { tx = db.transaction([LOJA_META, LOJA_BLOBS], modo) } catch (e) { rej(traduzir(e)); return }
      tx.oncomplete = () => res(resultado)
      tx.onabort = () => rej(traduzir(tx.error))
      tx.onerror = () => { /* o abort logo em seguida rejeita */ }
      try {
        corpo(tx.objectStore(LOJA_META), tx.objectStore(LOJA_BLOBS), (v) => { resultado = v })
      } catch (e) {
        try { tx.abort() } catch { /* ok */ }
        rej(traduzir(e))
      }
    })
  }
  const pedido = (req, aoLer) => { req.onsuccess = () => aoLer(req.result) }

  return {
    nome: 'indexeddb',
    listar: () => transacao('readonly', (m, _b, def) => pedido(m.getAll(), (v) => def(v || []))),
    obter: (id) => transacao('readonly', (m, _b, def) => pedido(m.get(id), (v) => def(v || null))),
    lerBlob: (id) => transacao('readonly', (_m, b, def) => pedido(b.get(id), (v) => def(v ? new Blob([v.buffer], { type: v.mime }) : null))),
    async inserir(meta, blob) {
      const buffer = blob ? await paraBuffer(blob) : null // antes da transação (ela não espera código async)
      return transacao('readwrite', (m, b, def) => {
        pedido(m.get(meta.id), (existe) => {
          if (existe) { def(false); return }
          m.put(meta)
          if (buffer) b.put({ id: meta.id, buffer, mime: blob.type || meta.mime })
          def(true)
        })
      })
    },
    atualizar: (id, fn) => transacao('readwrite', (m, b, def) => {
      pedido(m.get(id), (atual) => {
        if (!atual) return
        const r = fn(atual)
        if (!r) return
        m.put(r.meta)
        if (r.apagarBlob) b.delete(id)
        def(r.meta)
      })
    }),
    apagar: (id) => transacao('readwrite', (m, b) => { m.delete(id); b.delete(id) }).then(() => undefined),
    limparTudo: () => transacao('readwrite', (m, b) => { m.clear(); b.clear() }).then(() => undefined),
    fechar() {
      const p = dbPromessa
      dbPromessa = null
      return p ? p.then((db) => db.close()).catch(() => {}) : Promise.resolve()
    },
  }
}
