import { useCallback, useEffect, useMemo, useState } from 'react'
import { FOCO } from './AdminUI.jsx'

// =============================================================================
//  Tabela responsiva do /admin (Fase 6, 5.4/5.6).
//
//  A partir de `md` (768px) desenha uma <table> de verdade — cabeçalho ordenável (aria-sort), linha
//  clicável e paginação. Abaixo disso o admin está no celular: a mesma lista vira cartões (o
//  `cartao(linha)` que a tela já tinha), porque tabela larga em 360px vira rolagem lateral.
//  Ordenação, filtro e paginação são SÓ no cliente: as RPCs admin devolvem a lista inteira.
// =============================================================================

const juntar = (...c) => c.filter(Boolean).join(' ')
const PONTOS = { md: '(min-width: 768px)', lg: '(min-width: 1024px)' }

/** `true` quando a tela é ≥ ponto (md 768px / lg 1024px). Sem matchMedia (jsdom, WebView antiga) assume celular. */
export function useTelaLarga(ponto = 'md') {
  const consulta = PONTOS[ponto] || PONTOS.md
  const ler = () => typeof window !== 'undefined' && !!window.matchMedia?.(consulta)?.matches
  const [larga, setLarga] = useState(ler)
  useEffect(() => {
    const mq = window.matchMedia?.(consulta)
    if (!mq?.addEventListener) return undefined
    const f = (e) => setLarga(e.matches)
    mq.addEventListener('change', f)
    return () => mq.removeEventListener('change', f)
  }, [consulta])
  return larga
}

/** Compara dois valores para ordenar: números por valor, texto por ordem pt-BR, vazio sempre por último. */
export function comparar(a, b) {
  const va = a == null || a === '' ? null : a
  const vb = b == null || b === '' ? null : b
  if (va === null && vb === null) return 0
  if (va === null) return 1
  if (vb === null) return -1
  if (typeof va === 'number' && typeof vb === 'number') return va - vb
  if (typeof va === 'boolean' && typeof vb === 'boolean') return Number(va) - Number(vb)
  return String(va).localeCompare(String(vb), 'pt-BR', { numeric: true, sensitivity: 'base' })
}

/**
 * Ordenação no cliente. `colunas[i].valor(linha)` diz o que comparar (senão `linha[chave]`).
 * Tocar na mesma coluna inverte; tocar em outra começa crescente.
 */
export function useOrdenacao(lista, colunas, inicial = null) {
  const [ordem, setOrdem] = useState(inicial ? { chave: inicial.chave, direcao: inicial.direcao || 'asc' } : null)
  const ordenarPor = useCallback((chave) => {
    setOrdem((o) => (o?.chave === chave ? { chave, direcao: o.direcao === 'asc' ? 'desc' : 'asc' } : { chave, direcao: 'asc' }))
  }, [])
  const ordenada = useMemo(() => {
    if (!ordem) return lista || []
    const col = (colunas || []).find((c) => c.chave === ordem.chave)
    const valor = col?.valor || ((l) => l?.[ordem.chave])
    const sinal = ordem.direcao === 'asc' ? 1 : -1
    return [...(lista || [])].sort((a, b) => sinal * comparar(valor(a), valor(b)))
  }, [lista, colunas, ordem])
  return { ordenada, ordem, ordenarPor }
}

/** Paginação no cliente (25 por página). Volta para a página 1 quando a lista muda de tamanho. */
export function usePaginacao(lista, porPagina = 25) {
  const [pagina, setPagina] = useState(1)
  const total = (lista || []).length
  const paginas = Math.max(1, Math.ceil(total / porPagina))
  useEffect(() => { setPagina(1) }, [total])
  const atual = Math.min(pagina, paginas)
  const inicio = (atual - 1) * porPagina
  const fatia = useMemo(() => (lista || []).slice(inicio, inicio + porPagina), [lista, inicio, porPagina])
  return { fatia, pagina: atual, paginas, total, inicio: total ? inicio + 1 : 0, fim: Math.min(inicio + porPagina, total), setPagina }
}

export function Paginacao({ pagina, paginas, total, inicio, fim, setPagina, rotulo = 'item(ns)' }) {
  if (total === 0) return null
  const botao = `inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl border border-line bg-surface px-3 text-sm font-semibold text-ink disabled:opacity-40 hover:bg-surface2 ${FOCO}`
  return (
    <nav aria-label="Paginação" className="flex flex-wrap items-center justify-between gap-2" data-testid="paginacao">
      <p className="text-xs font-medium text-muted" role="status">{inicio}–{fim} de {total} {rotulo}</p>
      {paginas > 1 && (
        <div className="flex items-center gap-1.5">
          <button type="button" className={botao} onClick={() => setPagina(pagina - 1)} disabled={pagina <= 1} aria-label="Página anterior">‹</button>
          <span className="px-1 text-sm text-ink tabular-nums" aria-current="page">{pagina} / {paginas}</span>
          <button type="button" className={botao} onClick={() => setPagina(pagina + 1)} disabled={pagina >= paginas} aria-label="Próxima página">›</button>
        </div>
      )}
    </nav>
  )
}

/**
 * Tabela ≥ md, cartões < md.
 * @param {object} p
 * @param {Array<{chave:string, rotulo:string, ordenavel?:boolean, valor?:Function, render?:Function, alinhar?:'direita', classe?:string, largura?:string}>} p.colunas
 * @param {Array} p.linhas          já ordenadas/paginadas
 * @param {Function} p.id           linha → chave estável
 * @param {Function} [p.cartao]     linha → JSX do cartão (celular). Sem `cartao`, a tabela vale nos dois.
 * @param {Function} [p.aoTocarLinha] linha → abre o detalhe (linha inteira clicável, com Enter/Espaço)
 * @param {{chave:string, direcao:string}|null} [p.ordem]  vindo de useOrdenacao
 * @param {Function} [p.ordenarPor]
 * @param {string} p.legenda       caption (leitor de tela)
 * @param {string} [p.testidLinha]
 * @param {boolean} [p.larga]      força o modo (senão usa a largura da tela)
 */
export function Tabela({ colunas, linhas, id, cartao, aoTocarLinha, ordem, ordenarPor, legenda, testidLinha, larga, className }) {
  const telaLarga = useTelaLarga('md')
  const modoTabela = larga ?? (telaLarga || !cartao)
  if (!modoTabela) {
    return (
      <ul className={juntar('grid gap-2', className)} aria-label={legenda}>
        {linhas.map((l) => <li key={id(l)} data-testid={testidLinha}>{cartao(l)}</li>)}
      </ul>
    )
  }
  const teclado = (e, l) => {
    if (!aoTocarLinha) return
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); aoTocarLinha(l) }
  }
  return (
    <div className={juntar('overflow-x-auto rounded-2xl border border-line bg-surface', className)}>
      <table className="w-full border-collapse text-sm" data-testid="tabela">
        <caption className="sr-only">{legenda}</caption>
        <thead className="bg-surface2/70 text-left text-xs uppercase tracking-wide text-muted">
          <tr>
            {colunas.map((c) => {
              const ativa = ordem?.chave === c.chave
              const sort = ativa ? (ordem.direcao === 'asc' ? 'ascending' : 'descending') : c.ordenavel ? 'none' : undefined
              return (
                <th key={c.chave} scope="col" aria-sort={sort} className={juntar('px-3 py-2 font-semibold', c.alinhar === 'direita' && 'text-right', c.classe)} style={c.largura ? { width: c.largura } : undefined}>
                  {c.ordenavel && ordenarPor ? (
                    <button type="button" onClick={() => ordenarPor(c.chave)}
                      className={juntar('inline-flex min-h-[44px] items-center gap-1 rounded-lg px-1 -mx-1 uppercase hover:text-ink', ativa && 'text-ink', FOCO)}>
                      {c.rotulo}
                      <span aria-hidden="true" className={juntar('text-[10px]', !ativa && 'opacity-40')}>{ativa ? (ordem.direcao === 'asc' ? '▲' : '▼') : '⇅'}</span>
                      <span className="sr-only">{ativa ? (ordem.direcao === 'asc' ? ', crescente' : ', decrescente') : ', ordenar'}</span>
                    </button>
                  ) : c.rotulo}
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {linhas.map((l) => (
            <tr key={id(l)} data-testid={testidLinha}
              onClick={aoTocarLinha ? () => aoTocarLinha(l) : undefined}
              onKeyDown={aoTocarLinha ? (e) => teclado(e, l) : undefined}
              tabIndex={aoTocarLinha ? 0 : undefined}
              role={aoTocarLinha ? 'button' : undefined}
              className={juntar('align-middle', aoTocarLinha && `cursor-pointer hover:bg-surface2/60 ${FOCO} focus-visible:-outline-offset-2`)}>
              {colunas.map((c) => (
                <td key={c.chave} className={juntar('px-3 py-2 min-h-[44px] h-11 text-ink', c.alinhar === 'direita' && 'text-right tabular-nums', c.classe)}>
                  {c.render ? c.render(l) : l[c.chave] ?? '—'}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// Chips de filtro (segmentado): um grupo com aria-pressed, alvo ≥ 44px.
export function Filtros({ rotulo, opcoes, valor, aoMudar, contagens }) {
  return (
    <div role="group" aria-label={rotulo} className="flex flex-wrap gap-1.5">
      {opcoes.map(([k, r]) => {
        const n = contagens?.[k]
        return (
          <button key={k} type="button" onClick={() => aoMudar(k)} aria-pressed={valor === k}
            className={`inline-flex min-h-[44px] items-center gap-1.5 rounded-full px-3.5 text-sm font-semibold ${FOCO} ${valor === k
              ? 'bg-[#0b1f4d] text-white dark:bg-white dark:text-[#07122f]' : 'border border-line bg-surface text-ink hover:bg-surface2'}`}>
            {r}{n != null && <span className={`rounded-full px-1.5 text-[11px] tabular-nums ${valor === k ? 'bg-white/20' : 'bg-surface2 text-muted'}`}>{n}</span>}
          </button>
        )
      })}
    </div>
  )
}

/** Busca simples: acha `termo` em qualquer dos campos (sem acento/maiúscula). */
export function normalizar(s) {
  return String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}
export function contem(termo, ...campos) {
  const t = normalizar(termo).trim()
  if (!t) return true
  return campos.some((c) => normalizar(c).includes(t))
}
