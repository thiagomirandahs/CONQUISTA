import { useClube } from '../context/Clube.jsx'
import CodigoDeEntrada from '../components/CodigoDeEntrada.jsx'
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

      {/* O código fica AQUI, junto da fila que ele alimenta: é a mesma conversa — como as pessoas
          chegam, e quem deixa entrar. (Também disponível em Gestão → Inscrições, com QR e link.) */}
      <div className="mb-5"><CodigoDeEntrada /></div>

      <SolicitacoesPendentes />
    </div>
  )
}
