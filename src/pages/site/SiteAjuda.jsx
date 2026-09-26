import { Link } from 'react-router-dom'
import SiteLayout, { BOTAO_PRIMARIO, CONTAINER, TopoDaPagina, useMetaDaPagina } from './SiteLayout.jsx'
import GuiaDeUso from '../../components/tutorial/GuiaDeUso.jsx'

// /ajuda no SITE: o mesmo conteúdo do app em modo "conhecer" — sem atalho para tela logada, sem
// recursos que ainda estão fora do piloto; o convite é criar o clube.
export default function SiteAjuda() {
  useMetaDaPagina('Como usar o DesbravaClube', 'Tutorial do DesbravaClube: passo a passo para desbravadores, pais, conselheiros, instrutores, diretoria e coordenação.')
  return (
    <SiteLayout>
      <TopoDaPagina sobre="Ajuda" titulo="Como usar o DesbravaClube"
        texto="O passo a passo de cada parte do aplicativo, explicado para desbravadores, pais e liderança." />
      <div className={`${CONTAINER} max-w-3xl py-8`}>
        <GuiaDeUso modo="site" tons="site" />
        <div className="mt-10 rounded-2xl bg-[#0b1b46] p-6 text-center text-white">
          <p className="text-lg font-extrabold">Pronto para organizar o seu clube?</p>
          <p className="mt-1 text-slate-300">Crie o clube, convide a equipe e comece pelo celular.</p>
          <Link to="/adquirir" className={`mt-4 ${BOTAO_PRIMARIO} bg-[#f5b012] hover:bg-[#ffc23a] text-[#0b1b46]`}>Criar meu clube</Link>
        </div>
      </div>
    </SiteLayout>
  )
}
