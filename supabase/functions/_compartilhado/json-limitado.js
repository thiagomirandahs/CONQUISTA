// Limite no fluxo de bytes: Content-Length é só uma antecipação, nunca a defesa única.
export async function lerJsonLimitado(req, maxBytes = 16384, prazoMs = 5000) {
  const declarado = req.headers.get('content-length')
  if (declarado !== null && Number(declarado) > maxBytes) throw new Error('Pedido muito grande.')
  if (!req.body) throw new Error('Pedido inválido.')
  const leitor = req.body.getReader()
  const partes = []
  let total = 0
  let timer
  const prazo = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Tempo de leitura excedido.')), prazoMs) })
  try {
    while (true) {
      const { done, value } = await Promise.race([leitor.read(), prazo])
      if (done) break
      total += value.byteLength
      if (total > maxBytes) throw new Error('Pedido muito grande.')
      partes.push(value)
    }
    const bytes = new Uint8Array(total)
    let posicao = 0
    for (const parte of partes) { bytes.set(parte, posicao); posicao += parte.byteLength }
    let dado
    try { dado = JSON.parse(new TextDecoder().decode(bytes)) }
    catch { throw new Error('Pedido inválido.') }
    if (!dado || Array.isArray(dado) || typeof dado !== 'object') throw new Error('Pedido inválido.')
    return dado
  } finally {
    clearTimeout(timer)
    leitor.cancel().catch(() => {})
    leitor.releaseLock()
  }
}
