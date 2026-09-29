import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { MARCA_PRODUTO } from '../../lib/marca.js'
import { FOCO } from './AdminUI.jsx'

// =============================================================================
//  Navegação do /admin (Fase 6, 5.2).
//
//  ≥ lg: barra lateral fixa (w-64, azul-marinho, marca DesbravaClube) com as 14 seções; a ativa leva
//  o filete dourado. < lg: a mesma lista vira uma GAVETA que o botão ☰ abre (diálogo com foco preso,
//  Esc fecha, foco volta ao botão). Nunca um <select> de 18 itens no desktop.
//  Só apresentação: quem decide a seção ativa e a URL é o Admin.jsx.
// =============================================================================

const juntar = (...c) => c.filter(Boolean).join(' ')
const somar = (contadores, secao) => (secao.abas || [secao.chave]).reduce((t, a) => t + (Number(contadores?.[a]) || 0), 0)

function ItensDaNavegacao({ secoes, ativa, aoTrocar, contadores, escuro = false }) {
  return (
    <ul role="tablist" aria-orientation="vertical" className="space-y-0.5">
      {secoes.map((s) => {
        const sel = s.chave === ativa
        const n = somar(contadores, s)
        return (
          <li key={s.chave}>
            <button type="button" role="tab" aria-selected={sel} onClick={() => aoTrocar(s.chave)} data-testid={`nav-${s.chave}`}
              className={juntar('relative flex w-full min-h-[44px] items-center gap-3 rounded-xl px-3 text-left text-[15px] transition-colors', FOCO,
                escuro
                  ? (sel ? 'bg-white/10 font-bold text-white' : 'font-medium text-white/75 hover:bg-white/5 hover:text-white')
                  : (sel ? 'bg-[#0b1f4d] font-bold text-white dark:bg-white dark:text-[#07122f]' : 'font-semibold text-ink hover:bg-surface2 active:bg-surface2'))}>
              {/* filete dourado = seção ativa (nunca só pela cor: aria-selected + ✓) */}
              {sel && <span aria-hidden="true" className="absolute left-0 top-2 bottom-2 w-1 rounded-full bg-[#f5c518]" />}
              <span aria-hidden="true" className="w-6 text-center text-lg">{s.icone}</span>
              <span className="flex-1 truncate">{s.rotulo}</span>
              {n > 0 && <span className="rounded-full bg-amber-500 px-1.5 text-[11px] font-bold leading-5 text-white">{n}</span>}
              {sel && <span aria-hidden="true" className={escuro ? 'text-[#f5c518]' : ''}>✓</span>}
            </button>
          </li>
        )
      })}
    </ul>
  )
}

/** Barra lateral fixa (só ≥ lg — quem renderiza decide pela largura). */
export function SidebarAdmin({ secoes, ativa, aoTrocar, contadores, rodape }) {
  return (
    <aside data-testid="admin-sidebar" aria-label="Seções da administração"
      className="fixed inset-y-0 left-0 z-30 flex w-64 flex-col border-r border-white/10 bg-[#07122f] text-white"
      style={{ paddingTop: 'var(--seguro-topo)', paddingLeft: 'var(--seguro-esq)', paddingBottom: 'var(--seguro-baixo)' }}>
      <div className="flex items-center gap-3 px-4 py-4">
        <img src={MARCA_PRODUTO.logoUrl} alt="" width="40" height="40" className="h-10 w-10 shrink-0 rounded-xl ring-1 ring-white/15" />
        <div className="min-w-0">
          <p className="truncate text-sm font-extrabold leading-tight tracking-tight">DesbravaClube</p>
          <p className="truncate text-[11px] text-[#f5c518]">Administração da Plataforma</p>
        </div>
      </div>
      <nav className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        <ItensDaNavegacao secoes={secoes} ativa={ativa} aoTrocar={aoTrocar} contadores={contadores} escuro />
      </nav>
      {rodape && <div className="border-t border-white/10 p-2">{rodape}</div>}
    </aside>
  )
}

/** Botão ☰ (celular) que mostra a seção atual e o total de pendências. */
export function BotaoMenuAdmin({ atual, aberto, aoTocar, totalPendencias = 0, refBotao }) {
  return (
    <button ref={refBotao} type="button" onClick={aoTocar} aria-expanded={aberto} aria-controls="admin-gaveta" aria-haspopup="dialog"
      data-testid="admin-menu" className={`flex w-full min-h-[48px] items-center gap-3 rounded-xl border border-line bg-surface px-3.5 text-left ${FOCO}`}>
      <span aria-hidden="true" className="grid h-9 w-9 place-items-center rounded-lg bg-surface2 text-lg">{atual.icone}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-[11px] font-semibold uppercase tracking-wide text-faint">Seção</span>
        <span className="block truncate text-[15px] font-bold text-ink">{atual.rotulo}</span>
      </span>
      {totalPendencias > 0 && !aberto && <span className="rounded-full bg-amber-500 px-2 text-xs font-bold leading-6 text-white">{totalPendencias}</span>}
      <span aria-hidden="true" className="text-xl text-muted">☰</span>
      <span className="sr-only">Abrir menu de seções</span>
    </button>
  )
}

/** Gaveta lateral (< lg): diálogo modal com foco preso; Esc e o fundo fecham; o foco volta ao ☰. */
export function GavetaAdmin({ aberta, aoFechar, secoes, ativa, aoTrocar, contadores, refBotao }) {
  const caixa = useRef(null)
  useEffect(() => {
    if (!aberta) return undefined
    const painel = caixa.current
    const focaveis = () => Array.from(painel?.querySelectorAll('button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])') || [])
    ;(painel?.querySelector('[aria-selected="true"]') || focaveis()[0] || painel)?.focus?.()
    const tecla = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); aoFechar(); return }
      if (e.key !== 'Tab') return
      const f = focaveis()
      if (f.length === 0) return
      const primeiro = f[0]; const ultimo = f[f.length - 1]
      if (e.shiftKey && document.activeElement === primeiro) { e.preventDefault(); ultimo.focus() }
      else if (!e.shiftKey && document.activeElement === ultimo) { e.preventDefault(); primeiro.focus() }
    }
    document.addEventListener('keydown', tecla)
    const antes = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', tecla)
      document.body.style.overflow = antes
      refBotao?.current?.focus?.()
    }
  }, [aberta, aoFechar, refBotao])
  if (!aberta) return null
  return createPortal(
    <div className="fixed inset-0 z-[80] flex" data-testid="admin-gaveta-fundo">
      <button type="button" aria-label="Fechar menu" tabIndex={-1} onClick={aoFechar} className="absolute inset-0 cursor-default bg-black/40 backdrop-blur-[2px]" />
      <div ref={caixa} id="admin-gaveta" role="dialog" aria-modal="true" aria-label="Seções da administração" tabIndex={-1}
        className="relative flex h-full w-[min(20rem,85vw)] flex-col bg-surface text-ink shadow-2xl"
        style={{ paddingTop: 'var(--seguro-topo)', paddingLeft: 'var(--seguro-esq)', paddingBottom: 'var(--seguro-baixo)' }}>
        <div className="flex items-center gap-3 border-b border-line px-4 py-3">
          <img src={MARCA_PRODUTO.logoUrl} alt="" width="36" height="36" className="h-9 w-9 shrink-0 rounded-xl ring-1 ring-line" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-extrabold leading-tight">DesbravaClube</p>
            <p className="truncate text-[11px] text-muted">Administração da Plataforma</p>
          </div>
          <button type="button" onClick={aoFechar} aria-label="Fechar menu" className={`grid h-11 w-11 place-items-center rounded-full text-ink hover:bg-surface2 ${FOCO}`}>✕</button>
        </div>
        <nav className="min-h-0 flex-1 overflow-y-auto p-2">
          <ItensDaNavegacao secoes={secoes} ativa={ativa} aoTrocar={(c) => { aoTrocar(c); aoFechar() }} contadores={contadores} />
        </nav>
      </div>
    </div>,
    document.body,
  )
}
