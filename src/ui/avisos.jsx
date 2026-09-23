import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Botao, Folha, mensagemDeErro } from './index.jsx'

// =============================================================================
//  Toast e confirmação (fase 7.1) — o que substitui os `alert()` e `confirm()` nativos.
//
//  Por que não trocar tudo por toast: `alert()` era usado para quatro coisas diferentes e cada uma
//  pede um componente diferente. A regra desta fase:
//    SUCESSO / INFO / COPIA  -> toast (some sozinho, não interrompe)
//    ERRO da operação inteira -> toast de erro, que NÃO some sozinho (a pessoa precisa ler e agir)
//    ERRO de campo            -> mensagem inline no formulário (fica junto do campo, não em toast)
//    DECISÃO destrutiva       -> modal de confirmação (bottom sheet no celular)
//
//  Acessibilidade: a região dos toasts é um `aria-live` polido (assertivo para erro), então leitor de
//  tela anuncia sem roubar o foco. O modal de confirmação leva foco e fecha no Esc.
// =============================================================================

const ToastContext = createContext({ mostrar: () => {}, sucesso: () => {}, erro: () => {}, info: () => {} })
export const useToast = () => useContext(ToastContext)

const TOM_TOAST = {
  sucesso: { classe: 'bg-emerald-600 text-white', icone: '✅', ms: 3500 },
  info: { classe: 'bg-slate-800 text-white', icone: 'ℹ️', ms: 3500 },
  // erro NÃO some sozinho: a pessoa precisa ler o que fazer em seguida
  erro: { classe: 'bg-amber-50 text-amber-900 border border-amber-300', icone: '⚠️', ms: 0 },
}

export function ToastProvider({ children }) {
  const [itens, setItens] = useState([])
  const seq = useRef(0)

  const fechar = useCallback((id) => setItens((l) => l.filter((t) => t.id !== id)), [])

  const mostrar = useCallback((texto, tom = 'info', opcoes = {}) => {
    if (!texto) return null
    const id = ++seq.current
    const conf = TOM_TOAST[tom] || TOM_TOAST.info
    setItens((l) => [...l.slice(-2), { id, texto, tom, acao: opcoes.acao }])
    if (conf.ms > 0) setTimeout(() => fechar(id), conf.ms)
    return id
  }, [fechar])

  const valor = useMemo(() => ({
    mostrar,
    sucesso: (t, o) => mostrar(t, 'sucesso', o),
    info: (t, o) => mostrar(t, 'info', o),
    // `erro(e, 'Não consegui aprovar a entrega.')` — o contexto é da tela, a tradução é do helper.
    // O texto cru do servidor nunca chega aqui.
    erro: (e, contexto, o) => mostrar(mensagemDeErro(e, contexto), 'erro', o),
  }), [mostrar])

  return (
    <ToastContext.Provider value={valor}>
      {children}
      <Toasts itens={itens} aoFechar={fechar} />
    </ToastContext.Provider>
  )
}

function Toasts({ itens, aoFechar }) {
  if (typeof document === 'undefined') return null
  return createPortal(
    <div className="fixed z-[60] left-3 right-3 flex flex-col items-center gap-2 pointer-events-none"
      style={{ bottom: 'calc(84px + env(safe-area-inset-bottom))' }}>
      {itens.map((t) => {
        const conf = TOM_TOAST[t.tom] || TOM_TOAST.info
        return (
          <div key={t.id} role={t.tom === 'erro' ? 'alert' : 'status'}
            aria-live={t.tom === 'erro' ? 'assertive' : 'polite'}
            className={`pointer-events-auto w-full max-w-md rounded-2xl shadow-soft px-4 py-3 flex items-start gap-2.5 text-sm ${conf.classe}`}>
            <span aria-hidden="true" className="shrink-0">{conf.icone}</span>
            <span className="flex-1 leading-snug">{t.texto}</span>
            {t.acao && (
              <button type="button" onClick={() => { t.acao.aoTocar(); aoFechar(t.id) }}
                className="shrink-0 font-extrabold underline min-h-[24px]">{t.acao.rotulo}</button>
            )}
            <button type="button" onClick={() => aoFechar(t.id)} aria-label="Fechar aviso"
              className="shrink-0 -my-1 -mr-1 w-11 h-11 grid place-items-center text-lg leading-none opacity-70">✕</button>
          </div>
        )
      })}
    </div>,
    document.body,
  )
}

// ---------------------------------------------------------------- confirmação
// Substitui `window.confirm()`. Diz o que vai acontecer e o que é irreversível, e o botão que
// confirma tem o rótulo da AÇÃO ("Apagar a foto"), não "OK".
const ConfirmacaoContext = createContext(async () => false)
export const useConfirmacao = () => useContext(ConfirmacaoContext)

export function ConfirmacaoProvider({ children }) {
  const [pedido, setPedido] = useState(null)
  const resolver = useRef(null)

  const confirmar = useCallback((opcoes) => {
    const o = typeof opcoes === 'string' ? { titulo: opcoes } : (opcoes || {})
    setPedido({ titulo: o.titulo || 'Tem certeza?', descricao: o.descricao, rotulo: o.rotulo || 'Confirmar', perigo: o.perigo !== false })
    return new Promise((res) => { resolver.current = res })
  }, [])

  const responder = useCallback((ok) => {
    setPedido(null)
    resolver.current?.(ok)
    resolver.current = null
  }, [])

  return (
    <ConfirmacaoContext.Provider value={confirmar}>
      {children}
      <Folha aberta={!!pedido} aoFechar={() => responder(false)} titulo={pedido?.titulo || ''}>
        {pedido?.descricao && <p className="text-sm text-muted leading-snug mb-4">{pedido.descricao}</p>}
        <div className="space-y-2">
          <Botao variacao={pedido?.perigo ? 'perigo' : 'primario'} className="w-full" aoTocar={() => responder(true)}>
            {pedido?.rotulo}
          </Botao>
          <Botao variacao="secundario" className="w-full" aoTocar={() => responder(false)}>Cancelar</Botao>
        </div>
      </Folha>
    </ConfirmacaoContext.Provider>
  )
}

// Um provedor só, para o main.jsx não virar uma pilha.
export function AvisosProvider({ children }) {
  return <ToastProvider><ConfirmacaoProvider><Ponte>{children}</Ponte></ConfirmacaoProvider></ToastProvider>
}

function Ponte({ children }) {
  const { mostrar } = useToast()
  const confirmar = useConfirmacao()
  return <><RegistrarPonte mostrar={mostrar} confirmar={confirmar} />{children}</>
}

// ---------------------------------------------------------------- ponte imperativa
// As telas legadas chamavam `alert()` de dentro de funções que não são componentes (handlers soltos,
// helpers). Trocar 70 call sites por hooks exigiria cirurgia em 20 arquivos e aumentaria o risco de
// regressão sem ganho nenhum. Então o provider registra aqui a sua API, e qualquer arquivo chama
// `avisar.erro(e, 'Não consegui aprovar.')` com um import só.
// O provider está na raiz do app, então isto está sempre montado; fora dele (testes) vira no-op.
const ponte = { mostrar: null, confirmar: null }

export const avisar = {
  sucesso: (texto) => ponte.mostrar?.(texto, 'sucesso'),
  info: (texto) => ponte.mostrar?.(texto, 'info'),
  erro: (erro, contexto) => ponte.mostrar?.(mensagemDeErro(erro, contexto), 'erro'),
  // devolve Promise<boolean>; sem provider (teste) responde `false` — falha fechada numa decisão
  // destrutiva é o comportamento certo.
  confirmar: (opcoes) => (ponte.confirmar ? ponte.confirmar(opcoes) : Promise.resolve(false)),
}

function RegistrarPonte({ mostrar, confirmar }) {
  useEffect(() => {
    ponte.mostrar = mostrar
    ponte.confirmar = confirmar
    return () => { ponte.mostrar = null; ponte.confirmar = null }
  }, [mostrar, confirmar])
  return null
}

// Atalho para telas que só precisam avisar e seguir a vida.
export function useAvisos() {
  const toast = useToast()
  const confirmar = useConfirmacao()
  return useMemo(() => ({ ...toast, confirmar }), [toast, confirmar])
}

// Foco visível consistente: um hook para telas que abrem conteúdo novo e precisam levar o leitor
// de tela até lá (ex.: resultado de busca, lista recarregada).
export function useAnuncio() {
  const [texto, setTexto] = useState('')
  useEffect(() => {
    if (!texto) return undefined
    const t = setTimeout(() => setTexto(''), 1200)
    return () => clearTimeout(t)
  }, [texto])
  const regiao = <span className="sr-only" role="status" aria-live="polite">{texto}</span>
  return [regiao, setTexto]
}
