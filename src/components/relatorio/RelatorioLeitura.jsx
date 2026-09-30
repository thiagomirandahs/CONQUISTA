// Mostra um relatório JÁ ENVIADO (avaliador e histórico), em rótulos legíveis, a partir de
// schema + conteudo + anexos. Sem modelo (requisito antigo): cai no texto/foto de sempre.
import Comprovacao from '../Comprovacao.jsx'
import { fmtDataBR } from '../../lib/relatorio/conteudo.js'

const temValor = (c, v) => {
  if (v == null) return false
  switch (c.tipo) {
    case 'texto_curto': case 'texto_longo': case 'data': case 'selecao': return String(v).trim() !== ''
    case 'lista': return Array.isArray(v) && v.some((x) => String(x ?? '').trim() !== '')
    case 'entradas': return Array.isArray(v) && v.length > 0
    default: return true
  }
}

function Valor({ c, v }) {
  switch (c.tipo) {
    case 'texto_curto': case 'texto_longo': return <p className="whitespace-pre-wrap break-words text-sm text-ink">{v}</p>
    case 'numero': return <p className="text-sm text-ink">{v}{c.unidade ? ` ${c.unidade}` : ''}</p>
    case 'data': return <p className="text-sm text-ink">{fmtDataBR(v)}</p>
    case 'selecao': return <p className="text-sm text-ink">{c.opcoes.find((o) => o.chave === v)?.rotulo || v}</p>
    case 'confirmacao': return <p className="text-sm font-semibold text-ink">{v === true ? '✅ Sim, fez' : '⚪ Não marcou'}</p>
    case 'checklist': {
      const marcados = c.itens.filter((i) => v?.[i.chave] === true)
      return marcados.length
        ? <ul className="list-disc space-y-0.5 pl-5 text-sm text-ink">{marcados.map((i) => <li key={i.chave}>{i.rotulo}</li>)}</ul>
        : <p className="text-sm text-muted">Nenhum item marcado.</p>
    }
    case 'lista': return (
      <ol className="list-decimal space-y-0.5 pl-5 text-sm text-ink">
        {v.filter((x) => String(x ?? '').trim() !== '').map((x, i) => <li key={i} className="whitespace-pre-wrap break-words">{x}</li>)}
      </ol>
    )
    case 'entradas': return (
      <ul className="space-y-2">
        {v.map((e, i) => (
          <li key={i} className="rounded-xl border border-line bg-surface p-2.5">
            <p className="text-xs font-extrabold uppercase tracking-wide text-muted">{c.rotulo_item || 'Item'} {i + 1}</p>
            <Campos campos={c.campos} conteudo={e} />
          </li>
        ))}
      </ul>
    )
    case 'escolha': {
      const op = c.opcoes.find((o) => o.chave === v?.opcao)
      if (!op) return null
      return (
        <div>
          <p className="text-sm font-semibold text-ink">{op.rotulo}</p>
          <div className="mt-1 border-l-2 border-line pl-3"><Campos campos={op.campos || []} conteudo={v.dados || {}} /></div>
        </div>
      )
    }
    default: return null
  }
}

function Campos({ campos, conteudo }) {
  const visiveis = campos.filter((c) => c.tipo !== 'anexos' && temValor(c, conteudo?.[c.chave]))
  if (!visiveis.length) return <p className="text-sm text-muted">Nada preenchido.</p>
  return (
    <dl className="space-y-2">
      {visiveis.map((c) => (
        <div key={c.chave}>
          <dt className="text-xs font-bold text-muted">{c.rotulo}</dt>
          <dd><Valor c={c} v={conteudo[c.chave]} /></dd>
        </div>
      ))}
    </dl>
  )
}

export default function RelatorioLeitura({ schema, conteudo, anexos = [], evidenciaTexto = null, evidenciaPath = null, className = '' }) {
  if (!schema || !Array.isArray(schema.campos)) {
    return (
      <div className={className} data-testid="relatorio-leitura-legado">
        {evidenciaTexto && <p className="mb-2 text-sm italic text-muted">"{evidenciaTexto}"</p>}
        {evidenciaPath && <Comprovacao ampliavel valor={evidenciaPath} alt="evidência" classImg="mb-2 max-h-72 w-full rounded-lg bg-black/5 object-contain" />}
      </div>
    )
  }
  return (
    <div className={`space-y-2 rounded-xl bg-surface2 p-3 ${className}`} data-testid="relatorio-leitura">
      <Campos campos={schema.campos.filter((c) => c.tipo !== 'anexos')} conteudo={conteudo || {}} />
      {(anexos || []).length > 0 && (
        <ul className="grid grid-cols-2 gap-2" data-testid="relatorio-anexos">
          {anexos.map((a, i) => (
            <li key={a.path}>
              <Comprovacao ampliavel valor={a.path} alt={`Foto ${i + 1}`} classImg="h-32 w-full rounded-lg bg-black/5 object-cover" classVideo="h-32 w-full rounded-lg" />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
