import { useCallback, useState } from 'react'
import { useAuth } from '../context/Auth.jsx'
import { useClube } from '../context/Clube.jsx'
import { useEscopo } from '../context/Escopo.jsx'
import { Cabecalho } from '../ui/index.jsx'
import GuiaDeUso from '../components/tutorial/GuiaDeUso.jsx'
import TourPrimeiroAcesso from '../components/TourPrimeiroAcesso.jsx'
import { atalhoPermitido, secaoDoPapel } from '../lib/tutorial/tutorial.js'

// /ajuda no APP: o tutorial com a seção do papel da pessoa (no clube em uso) primeiro e o atalho
// "Abrir essa tela" só para as telas que esse papel abre. Conteúdo estático: funciona sem internet.
export default function Ajuda() {
  const { profile } = useAuth() || {}
  const { papel, temRecurso } = useClube()
  const { temEscopo } = useEscopo() || {}
  const [tour, setTour] = useState(false)

  const podeAbrir = useCallback((rota) => atalhoPermitido(rota, { papel, temRecurso, temEscopo }), [papel, temRecurso, temEscopo])

  return (
    <div className="mx-auto max-w-2xl">
      <Cabecalho icone="❓" titulo="Ajuda / Como usar" descricao="Passo a passo de cada parte do app, para desbravadores, pais e liderança." />
      <button type="button" onClick={() => setTour(true)} data-testid="rever-tour"
        className="mb-5 w-full min-h-[48px] rounded-2xl border border-line bg-surface text-sm font-bold text-ink active:bg-surface2">
        🧭 Ver o tour de novo
      </button>
      <GuiaDeUso modo="app" secaoDaPessoa={secaoDoPapel(papel, { temEscopo })} podeAbrir={podeAbrir} temRecurso={temRecurso} />
      {tour && <TourPrimeiroAcesso uid={profile?.id} forcar aoFechar={() => setTour(false)} />}
    </div>
  )
}
