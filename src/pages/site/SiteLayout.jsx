import { Cabecalho, Rodape } from '../Landing.jsx'

// Moldura das páginas da vitrine do site (/clubes, /clubes/:slug, /parceiros): mesmo cabeçalho e rodapé da landing.
export const CONTAINER = 'mx-auto w-full max-w-5xl px-4 sm:px-6'
export const BOTAO_PRIMARIO = 'inline-flex items-center justify-center gap-2 min-h-[48px] px-5 rounded-xl bg-gradient-to-r from-brand via-brand to-brand2 shadow-glow text-white font-bold transition-opacity hover:opacity-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2'
export const BOTAO_WHATSAPP = 'inline-flex items-center justify-center gap-2 min-h-[48px] px-5 rounded-xl bg-[#25D366] hover:brightness-95 text-[#07122f] font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1d4ed8] focus-visible:ring-offset-2'
export const BOTAO_SECUNDARIO = 'inline-flex items-center justify-center gap-2 min-h-[48px] px-5 rounded-xl border border-line bg-surface shadow-soft hover:bg-surface2 text-ink font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2'

// Hook de título/descrição/canonical/OG: mora em src/lib/metaDaPagina.js (a landing o usa sem importar este layout).
export { useMetaDaPagina } from '../../lib/metaDaPagina.js'

export default function SiteLayout({ children }) {
  return (
    <div className="min-h-full text-ink">
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
