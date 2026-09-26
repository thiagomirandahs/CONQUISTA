import { useEffect } from 'react'
import { Cabecalho, Rodape } from '../Landing.jsx'

// Moldura das páginas da vitrine do site (/clubes, /clubes/:slug, /parceiros): mesmo cabeçalho e rodapé da landing.
export const CONTAINER = 'mx-auto w-full max-w-5xl px-4 sm:px-6'
export const BOTAO_PRIMARIO = 'inline-flex items-center justify-center gap-2 min-h-[48px] px-5 rounded-xl bg-[#1d4ed8] hover:bg-[#1e40af] text-white font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#f5b012] focus-visible:ring-offset-2'
export const BOTAO_WHATSAPP = 'inline-flex items-center justify-center gap-2 min-h-[48px] px-5 rounded-xl bg-[#25D366] hover:brightness-95 text-[#07122f] font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1d4ed8] focus-visible:ring-offset-2'
export const BOTAO_SECUNDARIO = 'inline-flex items-center justify-center gap-2 min-h-[48px] px-5 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-[#0b1b46] font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1d4ed8] focus-visible:ring-offset-2'

function meta(atributo, chave, valor) {
  let el = document.head.querySelector(`meta[${atributo}="${chave}"]`)
  const criado = !el
  if (criado) { el = document.createElement('meta'); el.setAttribute(atributo, chave); document.head.appendChild(el) }
  const antes = el.getAttribute('content')
  el.setAttribute('content', valor)
  return () => { if (criado) el.remove(); else el.setAttribute('content', antes ?? '') }
}

// Título e descrição dinâmicos (inclui og:title/og:description para quem lê a página já renderizada).
// Obs.: o WhatsApp NÃO executa JS — a prévia dele lê só o index.html estático (ver relatório: OG por rota exige
// renderização no servidor/edge, fora do escopo deste SPA).
export function useMetaDaPagina(titulo, descricao) {
  useEffect(() => {
    const tituloAntes = document.title
    document.title = titulo
    const desfazer = [
      meta('name', 'description', descricao),
      meta('property', 'og:title', titulo),
      meta('property', 'og:description', descricao),
    ]
    return () => { document.title = tituloAntes; desfazer.forEach((f) => f()) }
  }, [titulo, descricao])
}

export default function SiteLayout({ children }) {
  return (
    <div className="min-h-full bg-slate-50 text-slate-800">
      <Cabecalho naLanding={false} />
      <main id="conteudo" className="pb-16">{children}</main>
      <Rodape naLanding={false} />
    </div>
  )
}

export function TopoDaPagina({ sobre, titulo, texto }) {
  return (
    <section className="bg-[#0b1b46] text-white">
      <div className={`${CONTAINER} py-10 sm:py-14`}>
        <p className="text-xs font-bold uppercase tracking-widest text-[#f5b012]">{sobre}</p>
        <h1 className="mt-2 text-3xl sm:text-4xl font-extrabold tracking-tight">{titulo}</h1>
        {texto && <p className="mt-3 max-w-2xl text-slate-300">{texto}</p>}
      </div>
    </section>
  )
}
