import { useClube } from '../context/Clube.jsx'
import { Link } from 'react-router-dom'
import SolicitacoesPendentes from '../components/SolicitacoesPendentes.jsx'

const ADMIN = ['diretoria', 'instrutor']

export default function Aprovacoes() {
  const { papel: meuPapel } = useClube()
  const ehAdmin = ADMIN.includes(meuPapel)

  if (!ehAdmin) {
    return (
      <div className="bg-surface rounded-2xl p-8 text-center shadow-soft">
        <div className="text-4xl mb-2">🔒</div>
        <p className="font-semibold text-ink">Área restrita</p>
        <p className="text-sm text-faint">Apenas a diretoria e instrutores podem aprovar cadastros.</p>
      </div>
    )
  }

  return (
    <div>
      <div className="mb-5">
        <h2 className="text-2xl font-extrabold text-ink">✅ Aprovações</h2>
        <p className="text-sm text-muted">Quem pediu para entrar neste clube</p>
      </div>

      {/* Inscrições traz as pessoas (link/QR); Aprovações decide quem entra. Duas telas, duas funções. */}
      <Link to="/gestao/inscricoes" data-testid="atalho-inscricoes"
        className="mb-5 flex items-center justify-between gap-3 bg-surface rounded-2xl shadow-soft p-4 min-h-[44px]">
        <span className="text-sm text-ink"><strong>🔗 Link e QR Code de inscrição</strong><span className="block text-xs text-muted">ficam em Gestão → Inscrições</span></span>
        <span aria-hidden="true" className="text-faint">›</span>
      </Link>

      <SolicitacoesPendentes />
    </div>
  )
}
