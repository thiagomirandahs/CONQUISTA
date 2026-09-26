import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import SiteLayout, { CONTAINER, BOTAO_SECUNDARIO, useMetaDaPagina } from './SiteLayout.jsx'
import { CartaoDoClube } from './CartaoDoClube.jsx'
import { cartaoDoClube } from '../../services/vitrine.js'

// /clubes/:slug — cartão de visita digital do clube. Só o que a diretoria publicou; nunca dado de membro.

export default function SiteCartaoClube() {
  const { slug } = useParams()
  // resposta guardada junto com o slug que a pediu: trocar de clube volta a "carregando" sem setState no efeito
  const [resposta, setResposta] = useState({ slug: null, clube: null, erro: '' })
  const clube = resposta.slug === slug ? resposta.clube : null
  const erro = resposta.slug === slug ? resposta.erro : ''
  const titulo = clube?.encontrado ? `${clube.nome} — Clube de Desbravadores` : 'Clube — DesbravaClube'
  const descricao = clube?.encontrado
    ? (clube.apresentacao || clube.lema || `${clube.nome}${clube.cidade ? ` em ${clube.cidade}` : ''}: fale com a diretoria e venha participar.`).slice(0, 160)
    : 'Cartão de visita dos Clubes de Desbravadores no DesbravaClube.'
  useMetaDaPagina(titulo, descricao)

  useEffect(() => {
    let vivo = true
    cartaoDoClube(slug).then((c) => { if (vivo) setResposta({ slug, clube: c || { encontrado: false }, erro: '' }) })
      .catch((e) => { if (vivo) setResposta({ slug, clube: { encontrado: false }, erro: e?.message || 'Não foi possível carregar o clube.' }) })
    return () => { vivo = false }
  }, [slug])

  return (
    <SiteLayout>
      <div className={`${CONTAINER} max-w-xl py-8`}>
        <Link to="/clubes" className="inline-flex min-h-[44px] items-center text-sm font-bold text-[#1d4ed8]">← Todos os clubes</Link>
        {clube === null ? <p className="mt-4 text-slate-500" role="status">Carregando…</p>
          : clube.encontrado ? <div className="mt-2"><CartaoDoClube clube={clube} /></div>
          : (
            <div className="mt-4 rounded-2xl bg-white border border-slate-200 p-8 text-center" role={erro ? 'alert' : undefined}>
              <p className="font-bold text-[#0b1b46]">{erro || 'Este clube não está na vitrine.'}</p>
              <Link to="/clubes" className={`mt-5 ${BOTAO_SECUNDARIO}`}>Ver os clubes</Link>
            </div>
          )}
      </div>
    </SiteLayout>
  )
}
