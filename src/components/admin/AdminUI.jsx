import { useState } from 'react'
import { corDeTextoSobre } from '../../ui/contraste.js'

// =============================================================================
//  Peças visuais do /admin (Administração da Plataforma). Só apresentação — nenhuma regra de
//  negócio mora aqui. Tudo usa os tokens do app (bg-surface, text-ink, border-line…) e tem
//  variante `dark:` para os tons de status, então o modo escuro do app funciona.
//  Toque ≥ 44px em tudo que é clicável; animação só com motion-safe.
// =============================================================================

const juntar = (...c) => c.filter(Boolean).join(' ')

// ---------------------------------------------------------------- Chip de status
const TONS = {
  neutro: 'bg-surface2 text-muted ring-line',
  ok: 'bg-emerald-50 text-emerald-800 ring-emerald-600/20 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-400/25',
  atencao: 'bg-amber-50 text-amber-800 ring-amber-600/25 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-400/25',
  perigo: 'bg-rose-50 text-rose-800 ring-rose-600/20 dark:bg-rose-500/10 dark:text-rose-300 dark:ring-rose-400/25',
  info: 'bg-sky-50 text-sky-800 ring-sky-600/20 dark:bg-sky-500/10 dark:text-sky-300 dark:ring-sky-400/25',
  marca: 'bg-indigo-50 text-indigo-800 ring-indigo-600/20 dark:bg-indigo-500/10 dark:text-indigo-300 dark:ring-indigo-400/25',
  dourado: 'bg-yellow-50 text-yellow-900 ring-yellow-600/25 dark:bg-yellow-500/10 dark:text-yellow-200 dark:ring-yellow-400/25',
}
const PONTOS = {
  neutro: 'bg-faint', ok: 'bg-emerald-500', atencao: 'bg-amber-500', perigo: 'bg-rose-500',
  info: 'bg-sky-500', marca: 'bg-indigo-500', dourado: 'bg-yellow-500',
}

export function Chip({ tom = 'neutro', ponto = false, children, className, ...resto }) {
  return (
    <span className={juntar('inline-flex max-w-full items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset',
      TONS[tom] || TONS.neutro, className)} {...resto}>
      {ponto && <span aria-hidden="true" className={juntar('h-1.5 w-1.5 shrink-0 rounded-full', PONTOS[tom] || PONTOS.neutro)} />}
      <span className="truncate">{children}</span>
    </span>
  )
}

// Status da assinatura → tom + rótulo curto. Cortesia é uma ativa de preço zero (quem chama sinaliza).
export const TOM_STATUS_ASSINATURA = {
  trial: 'info', ativa: 'ok', pagamento_pendente: 'atencao', inadimplente: 'perigo',
  suspensa: 'perigo', cancelada: 'neutro', cortesia: 'dourado',
}
export function StatusChip({ status, rotulo, sufixo, cortesia = false, ...resto }) {
  if (!status) return <Chip tom="neutro" ponto {...resto}>Sem assinatura</Chip>
  const tom = cortesia ? 'dourado' : TOM_STATUS_ASSINATURA[status] || 'neutro'
  return <Chip tom={tom} ponto {...resto}>{cortesia ? 'Cortesia' : rotulo || status}{sufixo}</Chip>
}

// ---------------------------------------------------------------- Avatar do clube
// Logo do clube (metadata.marca.logo_url). Sem logo (ou se a imagem falhar): sigla/iniciais na cor
// do clube, com o texto escolhido por contraste — uma cor clara não fica ilegível.
const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i
export function iniciais(nome = '', sigla) {
  if (sigla && sigla.trim()) return sigla.trim().slice(0, 3).toUpperCase()
  const partes = String(nome).split(/\s+/).filter((p) => p.length > 2 || /^[A-ZÀ-Ú]/.test(p))
  const letras = (partes.length ? partes : [String(nome)]).slice(0, 2).map((p) => p[0] || '').join('')
  return (letras || '?').toUpperCase()
}

const TAMANHOS = { sm: 'h-10 w-10 text-xs rounded-xl', md: 'h-12 w-12 text-sm rounded-xl', lg: 'h-16 w-16 text-lg rounded-2xl' }

export function ClubeAvatar({ nome, logoUrl, cor, sigla, tamanho = 'md', className }) {
  const [falhou, setFalhou] = useState(false)
  const base = juntar('relative shrink-0 overflow-hidden ring-1 ring-line', TAMANHOS[tamanho] || TAMANHOS.md, className)
  if (logoUrl && !falhou) {
    return (
      <span className={juntar(base, 'bg-white')}>
        <img src={logoUrl} alt={`Logo do ${nome}`} loading="lazy" decoding="async" onError={() => setFalhou(true)}
          className="h-full w-full object-contain p-1" />
      </span>
    )
  }
  const fundo = HEX.test(cor || '') ? cor : '#0b1f4d'
  return (
    <span className={juntar(base, 'grid place-items-center font-extrabold tracking-wide')}
      style={{ background: fundo, color: corDeTextoSobre(fundo) }} role="img" aria-label={`Clube ${nome}`}>
      <span aria-hidden="true">{iniciais(nome, sigla)}</span>
    </span>
  )
}

// ---------------------------------------------------------------- KPI
export function Kpi({ icone, valor, rotulo, detalhe, tom = 'marca', testid, aoTocar }) {
  const conteudo = (
    <>
      <div className="flex items-center justify-between gap-2">
        <span aria-hidden="true" className={juntar('grid h-8 w-8 place-items-center rounded-full text-sm ring-1 ring-inset', TONS[tom] || TONS.marca)}>{icone}</span>
        {aoTocar && <span aria-hidden="true" className="text-faint text-sm">→</span>}
      </div>
      <span className="mt-2 block text-2xl font-extrabold tracking-tight text-ink tabular-nums leading-none" data-testid={testid}>{valor}</span>
      <span className="mt-1 block text-xs font-medium text-muted leading-snug">{rotulo}</span>
      {detalhe && <span className="mt-0.5 block text-[11px] text-faint leading-snug">{detalhe}</span>}
    </>
  )
  const base = 'flex flex-col rounded-2xl border border-line bg-surface p-3 text-left min-h-[44px]'
  return aoTocar
    ? <button type="button" onClick={aoTocar} className={juntar(base, 'transition-colors hover:bg-surface2 active:bg-surface2', FOCO)}>{conteudo}<span className="sr-only"> — abrir</span></button>
    : <div className={base}>{conteudo}</div>
}

export const FOCO = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand'

// ---------------------------------------------------------------- Seção em cartão
export function Painel({ titulo, icone, acao, descricao, children, className, ...resto }) {
  return (
    <section className={juntar('rounded-2xl border border-line bg-surface p-4', className)} {...resto}>
      {(titulo || acao) && (
        <header className="mb-3 flex items-start justify-between gap-2">
          <div className="min-w-0">
            {titulo && (
              <h3 className="flex items-center gap-2 text-sm font-bold text-ink">
                {icone && <span aria-hidden="true" className="text-base leading-none">{icone}</span>}{titulo}
              </h3>
            )}
            {descricao && <p className="mt-0.5 text-xs text-muted">{descricao}</p>}
          </div>
          {acao && <div className="shrink-0">{acao}</div>}
        </header>
      )}
      {children}
    </section>
  )
}

// Rótulo à esquerda, valor à direita, separadores finos.
export function Linha({ rotulo, children }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-line py-2 text-sm last:border-0">
      <span className="shrink-0 text-muted">{rotulo}</span>
      <span className="min-w-0 text-right font-semibold text-ink break-words">{children}</span>
    </div>
  )
}

// ---------------------------------------------------------------- Barra de uso
export function BarraUso({ pct, situacao, rotulo }) {
  const p = Math.max(0, Math.min(100, Number(pct) || 0))
  const cor = situacao === 'atingido' || p >= 100 ? 'bg-rose-500' : situacao === 'proximo' || p >= 80 ? 'bg-amber-500' : 'bg-emerald-500'
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface2" role="progressbar"
      aria-valuenow={Math.round(p)} aria-valuemin={0} aria-valuemax={100} aria-label={rotulo}>
      <div className={juntar('h-full rounded-full motion-safe:transition-[width] motion-safe:duration-500', cor)} style={{ width: `${p}%` }} />
    </div>
  )
}

// ---------------------------------------------------------------- Estados
export function EstadoVazio({ icone = '✨', titulo, children, acao }) {
  return (
    <div className="rounded-2xl border border-dashed border-line bg-surface px-6 py-10 text-center">
      <div aria-hidden="true" className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-full bg-surface2 text-2xl">{icone}</div>
      <p className="font-bold text-ink">{titulo}</p>
      {children && <p className="mx-auto mt-1 max-w-xs text-sm text-muted leading-snug">{children}</p>}
      {acao && <div className="mt-4">{acao}</div>}
    </div>
  )
}

export function Esqueleto({ linhas = 4, texto = 'Carregando', avatar = true }) {
  return (
    <div role="status" aria-live="polite" className="space-y-2">
      <span className="sr-only">{texto}…</span>
      {Array.from({ length: linhas }).map((_, i) => (
        <div key={i} aria-hidden="true" className="flex items-center gap-3 rounded-2xl border border-line bg-surface p-3">
          {avatar && <div className="h-12 w-12 shrink-0 rounded-xl bg-surface2 motion-safe:animate-pulse" />}
          <div className="flex-1 space-y-2">
            <div className="h-3.5 w-2/5 rounded-full bg-surface2 motion-safe:animate-pulse" />
            <div className="h-3 w-4/5 rounded-full bg-surface2 motion-safe:animate-pulse" />
          </div>
        </div>
      ))}
    </div>
  )
}

// Nota informativa discreta (substitui a caixa azul grande nas abas do admin).
export function Nota({ icone = 'ℹ️', children }) {
  return (
    <p role="note" className="flex items-start gap-2 rounded-xl bg-surface2 px-3 py-2.5 text-xs text-muted leading-snug">
      <span aria-hidden="true">{icone}</span><span>{children}</span>
    </p>
  )
}

// Botão-link pequeno ("Abrir clube →") com 44px de alvo.
export function LinkAcao({ aoTocar, children, className }) {
  return (
    <button type="button" onClick={aoTocar}
      className={juntar('inline-flex min-h-[44px] items-center gap-1 text-sm font-semibold text-brand hover:underline', FOCO, className)}>
      {children} <span aria-hidden="true">→</span>
    </button>
  )
}

// Datas pt-BR
export const dataBR = (iso) => (iso ? new Date(iso).toLocaleDateString('pt-BR') : '—')
export const dataHoraBR = (iso) => (iso ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—')
export const dataCurtaBR = (iso) => (iso ? new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }).replace('.', '') : '—')
