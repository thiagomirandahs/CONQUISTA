import { useAuth } from '../context/Auth.jsx'

/** O requisito é da própria pessoa que está na fila de avaliação? (a regra "ninguém avalia o próprio requisito"
 *  é imposta pelo servidor; aqui só se explica e se evita o botão inútil). */
export function useEhMeuRequisito(usuarioId) {
  const auth = useAuth()   // pode vir vazio em telas montadas fora do provedor (testes)
  return !!usuarioId && !!auth?.profile?.id && auth.profile.id === usuarioId
}

export default function AvisoAvaliadorUnico() {
  return (
    <p role="note" className="rounded-lg border border-line bg-surface2 px-3 py-2 text-sm text-ink">
      🔒 Este requisito precisa ser avaliado por outra pessoa autorizada. Ninguém avalia o próprio requisito.
    </p>
  )
}
