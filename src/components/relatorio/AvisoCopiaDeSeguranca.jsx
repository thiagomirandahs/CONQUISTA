// Requisito que já foi enviado/aprovado, mas ainda tinha texto NÃO sincronizado neste aparelho:
// o texto vira cópia de segurança (não se perde) e a pessoa é avisada.
import { useEffect, useState } from 'react'
import { lerLocal, descartarLocalComBackup } from '../../lib/relatorio/rascunhoLocal.js'

export default function AvisoCopiaDeSeguranca({ chaveLocal }) {
  const [pendente] = useState(() => !!chaveLocal && lerLocal(chaveLocal)?.sincronizado === false)
  useEffect(() => { if (pendente) descartarLocalComBackup(chaveLocal) }, [pendente, chaveLocal])
  if (!pendente) return null
  return (
    <p data-testid="aviso-copia-seguranca" role="status" className="mt-2 rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-900">
      Este requisito já foi enviado/aprovado; guardamos uma cópia do seu texto neste aparelho.
    </p>
  )
}
