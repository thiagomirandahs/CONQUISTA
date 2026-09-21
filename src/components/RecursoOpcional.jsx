import { Link } from 'react-router-dom'
import { useClube } from '../context/Clube.jsx'

// Tela de um recurso que o clube pode ligar/desligar (catálogo `recursos_catalogo`, escolha em `club_features`).
// Clube que não usa o recurso vê o aviso, não a tela — mesmo digitando a URL. (Dados/RPCs seguem protegidos por clube e papel no banco.)
export default function RecursoOpcional({ recurso, children }) {
  const { carregando, temRecurso } = useClube()
  if (carregando) return <p className="text-faint text-sm text-center mt-10">Carregando…</p>
  if (temRecurso(recurso)) return children
  return (
    <div className="bg-surface rounded-2xl p-8 text-center shadow-soft max-w-md mx-auto mt-6">
      <div className="text-4xl mb-2">🧩</div>
      <p className="font-semibold text-ink">Recurso não habilitado</p>
      <p className="text-sm text-faint mt-1 mb-4">Este clube não utiliza este recurso.</p>
      <Link to="/" className="inline-block bg-gradient-to-r from-brand to-brand2 shadow-glow text-white font-bold rounded-xl px-6 py-2.5">Voltar ao início</Link>
    </div>
  )
}
