import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { Folha } from './index.jsx'

// =============================================================================
//  Menu de ações "⋯" (fase 6.3).
//
//  No celular (a regra do app) as ações sobem numa Folha — o polegar alcança e não tem menu
//  minúsculo escondido no canto. Em tela ≥ md vira um popover ancorado ao botão, com navegação
//  pelas setas do teclado. Nos dois casos: Esc fecha e o foco volta para o botão "⋯".
//
//  Ação de perigo (`tom: 'perigo'`) é sempre vermelha e fica por último, separada por uma linha.
// =============================================================================

const juntar = (...c) => c.filter(Boolean).join(' ')

/** `true` quando a tela é ≥ md (768px). Sem matchMedia (jsdom, WebView antiga) assume celular. */
function useTelaLarga() {
  const ler = () => typeof window !== 'undefined' && !!window.matchMedia?.('(min-width: 768px)')?.matches
  const [larga, setLarga] = useState(ler)
  useEffect(() => {
    const mq = window.matchMedia?.('(min-width: 768px)')
    if (!mq?.addEventListener) return undefined
    const f = (e) => setLarga(e.matches)
    mq.addEventListener('change', f)
    return () => mq.removeEventListener('change', f)
  }, [])
  return larga
}

/**
 * Botão "⋯" que abre a lista de ações.
 *
 * @param {object} p
 * @param {Array<{rotulo: string, onClick: Function, icone?: any, tom?: 'perigo', desabilitada?: boolean}>} p.acoes
 * @param {string} [p.rotulo='Mais ações']  aria-label do botão e título da folha
 * @param {string} [p.className]           classes extras do botão
 *
 * @example
 * <MenuAcoes rotulo="Ações da foto" acoes={[
 *   { rotulo: 'Editar legenda', icone: '✏️', onClick: editar },
 *   { rotulo: 'Apagar', icone: '🗑️', tom: 'perigo', onClick: apagar },
 * ]} />
 */
export function MenuAcoes({ acoes = [], rotulo = 'Mais ações', className }) {
  const [aberto, setAberto] = useState(false)
  const botao = useRef(null)
  const larga = useTelaLarga()
  const idMenu = useId()

  // Fecha e devolve o foco ao "⋯" (a Folha já faz isso sozinha; o popover precisa disto).
  const fechar = useCallback(() => {
    setAberto(false)
    // Depois do React tirar o popover: no fechamento pela Folha ela mesma restaura.
    setTimeout(() => botao.current?.focus?.(), 0)
  }, [])

  const normais = acoes.filter((a) => a.tom !== 'perigo')
  const perigosas = acoes.filter((a) => a.tom === 'perigo')
  const ordenadas = [...normais, ...perigosas]

  function executar(a) {
    if (a.desabilitada) return
    fechar()
    a.onClick?.()
  }

  return (
    <div className="relative inline-block">
      <button ref={botao} type="button" onClick={() => setAberto((v) => !v)} aria-label={rotulo}
        aria-haspopup={larga ? 'menu' : 'dialog'} aria-expanded={aberto} aria-controls={larga && aberto ? idMenu : undefined}
        className={juntar('grid h-11 w-11 place-items-center rounded-full text-xl font-black leading-none text-ink',
          'hover:bg-surface2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand', className)}>
        <span aria-hidden="true">⋯</span>
      </button>

      {larga ? (
        aberto && <Popover id={idMenu} acoes={ordenadas} separador={normais.length > 0 && perigosas.length > 0}
          aoFechar={fechar} executar={executar} ancora={botao} />
      ) : (
        <Folha aberta={aberto} aoFechar={() => setAberto(false)} titulo={rotulo}>
          <ul className="space-y-1" data-testid="menu-acoes-folha">
            {ordenadas.map((a, i) => (
              <li key={a.rotulo}>
                {normais.length > 0 && i === normais.length && <hr className="my-2 border-line" />}
                <button type="button" onClick={() => executar(a)} disabled={a.desabilitada}
                  className={classeItem(a)}>
                  {a.icone && <span aria-hidden="true">{a.icone}</span>}<span>{a.rotulo}</span>
                </button>
              </li>
            ))}
          </ul>
        </Folha>
      )}
    </div>
  )
}

function classeItem(a) {
  return juntar('flex w-full min-h-[44px] items-center gap-3 rounded-xl px-3 text-left text-sm font-semibold',
    'disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand',
    a.tom === 'perigo' ? 'text-rose-600 hover:bg-rose-50' : 'text-ink hover:bg-surface2')
}

// Popover para tela larga: role=menu, setas movem o foco, Home/End, Esc fecha, clique fora fecha.
function Popover({ id, acoes, separador, aoFechar, executar, ancora }) {
  const caixa = useRef(null)

  useEffect(() => {
    const itens = () => Array.from(caixa.current?.querySelectorAll('[role="menuitem"]:not([disabled])') || [])
    itens()[0]?.focus()
    const tecla = (e) => {
      const lista = itens()
      const i = lista.indexOf(document.activeElement)
      if (e.key === 'Escape') { e.preventDefault(); aoFechar(); return }
      if (e.key === 'ArrowDown') { e.preventDefault(); lista[(i + 1) % lista.length]?.focus() }
      if (e.key === 'ArrowUp') { e.preventDefault(); lista[(i - 1 + lista.length) % lista.length]?.focus() }
      if (e.key === 'Home') { e.preventDefault(); lista[0]?.focus() }
      if (e.key === 'End') { e.preventDefault(); lista[lista.length - 1]?.focus() }
      if (e.key === 'Tab') aoFechar()
    }
    const fora = (e) => {
      if (caixa.current?.contains(e.target) || ancora.current?.contains(e.target)) return
      aoFechar()
    }
    document.addEventListener('keydown', tecla)
    document.addEventListener('mousedown', fora)
    return () => { document.removeEventListener('keydown', tecla); document.removeEventListener('mousedown', fora) }
  }, [aoFechar, ancora])

  const nNormais = acoes.filter((a) => a.tom !== 'perigo').length
  return (
    <div ref={caixa} id={id} role="menu" data-testid="menu-acoes-popover"
      className="absolute right-0 top-full z-40 mt-1 min-w-[12rem] rounded-2xl border border-line bg-surface p-1.5 shadow-soft">
      {acoes.map((a, i) => (
        <div key={a.rotulo}>
          {separador && i === nNormais && <hr className="my-1.5 border-line" role="separator" />}
          <button type="button" role="menuitem" tabIndex={-1} onClick={() => executar(a)} disabled={a.desabilitada}
            className={classeItem(a)}>
            {a.icone && <span aria-hidden="true">{a.icone}</span>}<span>{a.rotulo}</span>
          </button>
        </div>
      ))}
    </div>
  )
}
