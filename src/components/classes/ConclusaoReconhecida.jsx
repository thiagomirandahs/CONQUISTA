import { useEffect, useState } from 'react'
import { carregarConclusaoReconhecida } from '../../services/classes.js'

// Proveniência da conclusão (migration 525): quando a pessoa já tinha a conquista curricular (registro anterior ou conclusão em
// outro clube), esta matrícula RECONHECE essa conquista em vez de criar outra. Só apresenta o texto montado pelo servidor.
// Tolerante a banco sem a 525 (RPC inexistente ou erro → não mostra nada).
export default function ConclusaoReconhecida({ memberClassId, ativo = true }) {
  const [info, setInfo] = useState(null)
  useEffect(() => {
    if (!ativo || !memberClassId) return undefined
    let vivo = true
    ;(async () => {
      try {
        const r = await carregarConclusaoReconhecida(memberClassId)
        if (vivo) setInfo(r?.reconhecida ? r : null)
      } catch { if (vivo) setInfo(null) }
    })()
    return () => { vivo = false }
  }, [memberClassId, ativo])
  if (!info?.texto) return null
  return (
    <p data-testid="conclusao-reconhecida" className="mt-2 rounded-xl border border-line bg-surface2 px-3 py-2 text-sm text-ink">
      <span aria-hidden="true">🔗</span> {info.texto}
    </p>
  )
}
