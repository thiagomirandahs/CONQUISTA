import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useClube } from '../context/Clube.jsx'
import { verificarOperacao } from '../services/comercial.js'
import { Carregando as Esqueleto } from '../ui/index.jsx'

// Tela de um recurso opcional. A partir da fase 5 existem TRÊS camadas e elas não se confundem:
//   1. o PLANO da assinatura inclui o recurso?      (comercial — a diretoria não resolve sozinha)
//   2. o CLUBE ligou o recurso?                     (escolha da diretoria, em Gestão → Recursos)
//   3. o USUÁRIO tem permissão?                     (papel no clube)
// `temRecurso` já é o efetivo (1 E 2). Quando barra, perguntamos ao servidor QUAL camada barrou —
// dizer "o clube não usa" quando na verdade é o plano manda a pessoa mexer no lugar errado.
// (Dados e RPCs seguem protegidos no banco por clube, papel e plano: isto aqui é só a explicação.)
export default function RecursoOpcional({ recurso, children }) {
  const { carregando, temRecurso } = useClube()
  const bloqueado = !carregando && !temRecurso(recurso)
  const [motivo, setMotivo] = useState(null)

  useEffect(() => {
    if (!bloqueado) return undefined
    let vivo = true
    verificarOperacao(recurso, 'ver').then((r) => { if (vivo) setMotivo(r) }).catch(() => {})
    return () => { vivo = false }
  }, [bloqueado, recurso])

  if (carregando) return <div className="mt-4"><Esqueleto /></div>
  if (!bloqueado) return children

  const noPlano = motivo?.bloqueio === 'plano'
  return (
    <div className="bg-surface rounded-2xl p-8 text-center shadow-soft max-w-md mx-auto mt-6">
      <div className="text-4xl mb-2">{noPlano ? '💳' : '🧩'}</div>
      <p className="font-semibold text-ink">{noPlano ? 'Fora do plano deste clube' : 'Recurso não habilitado'}</p>
      <p className="text-sm text-faint mt-1 mb-4">
        {noPlano
          ? 'Este recurso não está incluído no plano do clube. Quem responde pela conta pode ampliar o plano.'
          : 'Este clube não utiliza este recurso.'}
      </p>
      <Link to={noPlano ? '/planos' : '/'} className="inline-block bg-gradient-to-r from-brand to-brand2 shadow-glow text-white font-bold rounded-xl px-6 py-2.5">
        {noPlano ? 'Ver o plano' : 'Voltar ao início'}
      </Link>
    </div>
  )
}
