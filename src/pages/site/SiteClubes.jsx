import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import SiteLayout, { CONTAINER, BOTAO_PRIMARIO, TopoDaPagina, useMetaDaPagina } from './SiteLayout.jsx'
import { clubesDaVitrine, corSegura } from '../../services/vitrine.js'
import { Emblema } from './CartaoDoClube.jsx'

// /clubes — "Clubes que estão com a gente". Só aparece clube cuja diretoria LIGOU a vitrine (opt-in);
// o servidor devolve apenas o que foi publicado (nome, emblema, cor, lema, cidade/UF).
export default function SiteClubes() {
  const [clubes, setClubes] = useState(null)
  const [erro, setErro] = useState('')
  const [busca, setBusca] = useState('')
  useMetaDaPagina('Clubes que estão com a gente — DesbravaClube',
    'Conheça os Clubes de Desbravadores que usam o DesbravaClube e fale com a diretoria para participar.')

  useEffect(() => {
    let vivo = true
    clubesDaVitrine().then((c) => { if (vivo) setClubes(c) })
      .catch((e) => { if (vivo) { setErro(e?.message || 'Não foi possível carregar os clubes.'); setClubes([]) } })
    return () => { vivo = false }
  }, [])

  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase()
    if (!clubes || !q) return clubes || []
    return clubes.filter((c) => [c.nome, c.cidade, c.estado, c.sigla].some((v) => String(v || '').toLowerCase().includes(q)))
  }, [clubes, busca])

  return (
    <SiteLayout>
      <TopoDaPagina sobre="Clubes" titulo="Clubes que estão com a gente"
        texto="Procure um clube perto de você e fale direto com a diretoria. Cada clube escolhe se quer aparecer aqui." />
      <div className={`${CONTAINER} py-8`}>
        {clubes && clubes.length > 3 && (
          <label className="block mb-5">
            <span className="block text-sm font-semibold text-[#0b1b46] mb-1">Buscar por nome ou cidade</span>
            <input type="search" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Ex.: Recife"
              className="w-full min-h-[48px] rounded-xl border border-slate-300 bg-white px-4 text-base outline-none focus:border-[#1d4ed8] focus:ring-2 focus:ring-[#1d4ed8]/30" />
          </label>
        )}
        {clubes === null ? <p className="text-slate-500" role="status">Carregando clubes…</p>
          : erro ? <p className="rounded-xl border border-red-200 bg-red-50 p-4 text-red-700" role="alert">{erro}</p>
          : filtrados.length === 0 ? (
            <div className="rounded-2xl bg-white border border-slate-200 p-8 text-center">
              <p className="font-bold text-[#0b1b46]">{clubes.length === 0 ? 'Em breve, os primeiros clubes aparecem aqui.' : 'Nenhum clube encontrado.'}</p>
              <p className="mt-1 text-sm text-slate-500">Sua diretoria usa o DesbravaClube? Ative o cartão do clube em Configurações do clube.</p>
              <Link to="/adquirir" className={`mt-5 ${BOTAO_PRIMARIO}`}>Quero o DesbravaClube no meu clube</Link>
            </div>
          ) : (
            <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-label="Clubes">
              {filtrados.map((c) => (
                <li key={c.slug}>
                  <Link to={`/clubes/${c.slug}`} data-testid="cartao-clube"
                    className="flex h-full items-center gap-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm hover:border-[#1d4ed8] hover:shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1d4ed8]"
                    style={{ borderTop: `4px solid ${corSegura(c.cor) || '#f5b012'}` }}>
                    <Emblema clube={c} />
                    <span className="min-w-0">
                      <span className="block font-extrabold text-[#0b1b46] leading-snug">{c.nome}</span>
                      {(c.cidade || c.estado) && <span className="block text-sm text-slate-500">{[c.cidade, c.estado].filter(Boolean).join(' · ')}</span>}
                      {c.lema && <span className="block text-xs text-slate-400 truncate">{c.lema}</span>}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
      </div>
    </SiteLayout>
  )
}
