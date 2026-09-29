import { useCallback, useState } from 'react'
import { useAuth } from '../context/Auth.jsx'
import { useClube } from '../context/Clube.jsx'
import { useEscopo } from '../context/Escopo.jsx'
import { Cabecalho } from '../ui/index.jsx'
import GuiaDeUso from '../components/tutorial/GuiaDeUso.jsx'
import TourDaArea from '../components/TourDaArea.jsx'
import { atalhoPermitido, secaoDoPapel } from '../lib/tutorial/tutorial.js'
import { toursDoPapel } from '../lib/tutorial/tours.js'

// /ajuda no APP: o tutorial com a seção do papel da pessoa (no clube em uso) logo depois de "Primeiros passos" e o
// atalho "Abrir essa tela" só para as telas que esse papel abre. Conteúdo estático: funciona sem internet.
// "Rever tour": um botão por mini-tour (Gestão só para diretoria/instrutor).
export default function Ajuda() {
  const { profile } = useAuth() || {}
  const { papel, temRecurso } = useClube()
  const { temEscopo } = useEscopo() || {}
  const [tour, setTour] = useState(null)

  const podeAbrir = useCallback((rota) => atalhoPermitido(rota, { papel, temRecurso, temEscopo }), [papel, temRecurso, temEscopo])
  const fecharTour = useCallback(() => setTour(null), [])
  const tours = toursDoPapel(papel)

  return (
    <div className="mx-auto max-w-2xl">
      <Cabecalho icone="❓" titulo="Ajuda / Como usar" descricao="Passo a passo de cada parte do app, para desbravadores, pais e liderança." />
      <nav aria-labelledby="rever-tour-titulo" className="mb-5">
        <h2 id="rever-tour-titulo" className="mb-2 text-sm font-bold text-ink">🧭 Rever tour</h2>
        <ul className="flex flex-wrap gap-2">
          {tours.map((t, i) => (
            <li key={t.id}>
              <button type="button" onClick={() => setTour(t.id)} data-testid={i === 0 ? 'rever-tour' : `rever-tour-${t.id}`}
                className="min-h-[44px] rounded-2xl border border-line bg-surface px-4 text-sm font-bold text-ink active:bg-surface2">
                {t.titulo}
              </button>
            </li>
          ))}
        </ul>
      </nav>
      <GuiaDeUso modo="app" secaoDaPessoa={secaoDoPapel(papel, { temEscopo })} podeAbrir={podeAbrir} temRecurso={temRecurso} />
      {tour && <TourDaArea key={tour} id={tour} uid={profile?.id} papel={papel} forcar aoFechar={fecharTour} />}
    </div>
  )
}
