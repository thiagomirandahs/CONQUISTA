import { useEffect, useState } from 'react'
import SiteLayout, { CONTAINER, BOTAO_PRIMARIO, BOTAO_WHATSAPP, TopoDaPagina, useMetaDaPagina } from './SiteLayout.jsx'
import { parceirosDoSite, linkWhatsApp, urlSegura } from '../../services/vitrine.js'

// /parceiros — anunciantes/patrocinadores (só no site). Links externos marcados como patrocinados;
// nada de script de terceiros: só logo (bucket público próprio), texto e link.

export function CartaoParceiro({ p }) {
  const link = urlSegura(p.link)
  const zap = linkWhatsApp(p.whatsapp, `Olá! Vi a ${p.nome} no site do DesbravaClube.`)
  const logo = urlSegura(p.logo_url)
  return (
    <article className={`flex h-full flex-col rounded-2xl border bg-white p-5 shadow-sm ${p.destaque ? 'border-[#f5b012] ring-1 ring-[#f5b012]' : 'border-slate-200'}`}
      aria-label={p.nome} data-testid="cartao-parceiro">
      <div className="flex items-center gap-4">
        {logo ? <img src={logo} alt={`Logo de ${p.nome}`} loading="lazy" className="w-16 h-16 rounded-xl object-contain bg-white border border-slate-100 shrink-0" />
          : <span aria-hidden="true" className="w-16 h-16 rounded-xl grid place-items-center bg-[#0b1b46] text-xl font-extrabold text-[#f5b012] shrink-0">{p.nome.slice(0, 1)}</span>}
        <div className="min-w-0">
          <h2 className="font-extrabold text-[#0b1b46] leading-snug">{p.nome}</h2>
          {p.categoria && <p className="text-xs font-bold uppercase tracking-wider text-slate-500">{p.categoria}</p>}
          {p.destaque && <p className="text-xs font-bold text-[#b27d00]">Parceiro destaque</p>}
        </div>
      </div>
      {p.descricao && <p className="mt-3 text-sm text-slate-600">{p.descricao}</p>}
      <div className="mt-auto grid gap-2 pt-4">
        {link && <a href={link} target="_blank" rel="noopener noreferrer sponsored" className={BOTAO_PRIMARIO}>Conhecer</a>}
        {zap && <a href={zap} target="_blank" rel="noopener noreferrer sponsored" className={BOTAO_WHATSAPP}><span aria-hidden="true">💬</span> WhatsApp</a>}
      </div>
    </article>
  )
}

export default function SiteParceiros() {
  const [parceiros, setParceiros] = useState(null)
  const [erro, setErro] = useState('')
  useMetaDaPagina('Nossos parceiros — DesbravaClube', 'Empresas e serviços que apoiam o DesbravaClube e os Clubes de Desbravadores.')

  useEffect(() => {
    let vivo = true
    parceirosDoSite().then((p) => { if (vivo) setParceiros(p) })
      .catch((e) => { if (vivo) { setErro(e?.message || 'Não foi possível carregar os parceiros.'); setParceiros([]) } })
    return () => { vivo = false }
  }, [])

  const contato = 'https://wa.me/5581989499469?text=' + encodeURIComponent('Olá! Quero anunciar no site do DesbravaClube.')
  return (
    <SiteLayout>
      <TopoDaPagina sobre="Parceiros" titulo="Nossos parceiros" texto="Quem apoia o DesbravaClube e os clubes que usam a plataforma." />
      <div className={`${CONTAINER} py-8`}>
        {parceiros === null ? <p className="text-slate-500" role="status">Carregando parceiros…</p>
          : erro ? <p className="rounded-xl border border-red-200 bg-red-50 p-4 text-red-700" role="alert">{erro}</p>
          : parceiros.length === 0 ? <p className="rounded-2xl bg-white border border-slate-200 p-8 text-center font-bold text-[#0b1b46]">Em breve, nossos primeiros parceiros aparecem aqui.</p>
          : (
            <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-label="Parceiros">
              {parceiros.map((p) => <li key={p.id}><CartaoParceiro p={p} /></li>)}
            </ul>
          )}
        <div className="mt-10 rounded-2xl bg-[#0b1b46] p-6 text-white">
          <h2 className="text-lg font-extrabold">Quer anunciar para os clubes?</h2>
          <p className="mt-1 text-sm text-slate-300">Fale com a gente para aparecer nesta página.</p>
          <a href={contato} target="_blank" rel="noopener noreferrer" className={`mt-4 ${BOTAO_WHATSAPP}`}>Falar no WhatsApp</a>
        </div>
      </div>
    </SiteLayout>
  )
}
