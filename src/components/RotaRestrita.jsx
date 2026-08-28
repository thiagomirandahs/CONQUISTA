// Trava de rota por papel (defesa em profundidade — hardening 28/08).
// O RLS e as funções do banco continuam sendo a segurança DE VERDADE; isto só
// impede que um papel sem permissão sequer ABRA a tela digitando a URL.
// A regra vem da MESMA matriz da Gestão (src/lib/permissoes.js) — nada duplicado.
import { Link, useLocation } from 'react-router-dom'
import { useAuth } from '../context/Auth.jsx'
import { PAPEIS_POR_ROTA } from '../lib/permissoes.js'

export default function RotaRestrita({ children }) {
  const { profile, session, carregando, perfilPronto } = useAuth()
  const { pathname } = useLocation()

  // Espera a BUSCA do perfil terminar antes de decidir (senão bloquearia
  // liderança legítima no primeiro paint). perfilPronto=true com profile null
  // = busca terminou sem perfil → cai no bloqueio (falha fechada), sem
  // spinner eterno.
  if (carregando || (session && !perfilPronto)) {
    return <p className="text-faint text-sm text-center mt-10">Carregando…</p>
  }

  // Normaliza a URL ('/pontos/' e '/Pontos' casam com '/pontos' no Router,
  // mas o lookup na matriz é exato) — sem isso, barra final bloquearia à toa.
  const rota = pathname.replace(/\/+$/, '').toLowerCase() || '/'
  // Rota embrulhada mas fora da matriz = bloqueia (falha fechada)
  const papeis = PAPEIS_POR_ROTA[rota] || []
  if (!papeis.includes(profile?.papel)) {
    return (
      <div className="bg-surface rounded-2xl p-8 text-center shadow-soft max-w-md mx-auto mt-6">
        <div className="text-4xl mb-2">🔒</div>
        <p className="font-semibold text-ink">Área restrita</p>
        <p className="text-sm text-faint mt-1 mb-4">Essa tela é só pra liderança autorizada.</p>
        <Link to="/" className="inline-block bg-gradient-to-r from-brand to-brand2 shadow-glow text-white font-bold rounded-xl px-6 py-2.5">Voltar pro início</Link>
      </div>
    )
  }
  return children
}
