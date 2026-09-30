// Ajudantes PUROS da tela do relatório estruturado (não mudam a semântica de modelo.js).

// `modelo` chega em dois formatos: { versao, schema, familia } (classes) ou o schema direto (especialidades).
export function schemaDoModelo(modelo) {
  if (!modelo || typeof modelo !== 'object') return null
  if (modelo.schema && Array.isArray(modelo.schema.campos)) return modelo.schema
  if (Array.isArray(modelo.campos)) return modelo
  return null
}

const vazio = (v) => v == null || (typeof v === 'string' && v.trim() === '')

// Tira o que a pessoa não preencheu (texto vazio, número em branco, lista sem itens preenchidos),
// para o rascunho/envio ficarem enxutos. As ENTRADAS (Dia 1…7) mantêm a posição, mesmo vazias.
export function limparConteudo(campos, dados) {
  const saida = {}
  for (const c of campos) {
    if (c.tipo === 'anexos') continue
    const v = dados?.[c.chave]
    if (v == null) continue
    switch (c.tipo) {
      case 'texto_curto': case 'texto_longo': case 'data': case 'selecao':
        if (!vazio(v)) saida[c.chave] = v
        break
      case 'numero':
        if (typeof v === 'number' && Number.isFinite(v)) saida[c.chave] = v
        break
      case 'lista': {
        const itens = (Array.isArray(v) ? v : []).filter((x) => !vazio(x))
        if (itens.length) saida[c.chave] = itens
        break
      }
      case 'entradas':
        if (Array.isArray(v)) saida[c.chave] = v.map((e) => limparConteudo(c.campos, e))
        break
      case 'escolha': {
        const op = c.opcoes.find((o) => o.chave === v.opcao)
        if (op) saida[c.chave] = { opcao: v.opcao, dados: limparConteudo(op.campos || [], v.dados) }
        break
      }
      default:
        saida[c.chave] = v // checklist, confirmacao (booleanos)
    }
  }
  return saida
}

// Garante as N entradas mínimas (Dia 1…N) antes de enviar/salvar.
export function completarEntradas(campos, dados) {
  const saida = { ...(dados || {}) }
  for (const c of campos) {
    if (c.tipo === 'entradas' && c.min > 0) {
      const atual = Array.isArray(saida[c.chave]) ? saida[c.chave] : []
      saida[c.chave] = Array.from({ length: Math.max(atual.length, c.min) }, (_, i) => atual[i] || {})
    }
  }
  return saida
}

// "2026-09-30" → "30/09/2026"; timestamp → data local.
export function fmtDataBR(v) {
  if (!v) return ''
  const so = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v)
  if (so) return `${so[3]}/${so[2]}/${so[1]}`
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('pt-BR')
}
