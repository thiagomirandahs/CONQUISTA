import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { parceirosDoSite, urlSegura } from '../../services/vitrine.js'

// Faixa DISCRETA de parceiros no fim da landing. Sem parceiros no ar (ou erro), não ocupa espaço nenhum.
export default function FaixaParceiros() {
  const [parceiros, setParceiros] = useState([])
  useEffect(() => {
    let vivo = true
    parceirosDoSite().then((p) => { if (vivo) setParceiros(Array.isArray(p) ? p.slice(0, 8) : []) }).catch(() => {})
    return () => { vivo = false }
  }, [])
  if (!parceiros.length) return null
  return (
    <section aria-label="Parceiros" className="border-t border-slate-200 bg-white py-8">
      <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-xs font-bold uppercase tracking-widest text-slate-500">Parceiros</h2>
          <Link to="/parceiros" className="inline-flex min-h-[44px] items-center text-sm font-bold text-[#1d4ed8]">Ver todos</Link>
        </div>
        <ul className="mt-2 flex flex-wrap items-center gap-3">
          {parceiros.map((p) => (
            <li key={p.id}>
              <Link to="/parceiros" className="flex min-h-[44px] items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-600 hover:border-[#1d4ed8]">
                {urlSegura(p.logo_url) && <img src={p.logo_url} alt="" loading="lazy" className="w-8 h-8 rounded object-contain" />}
                {p.nome}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}
