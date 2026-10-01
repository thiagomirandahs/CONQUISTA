// Leitura do RELATO complementar (migration 520) de UMA tentativa/requisito. Só apresenta: não decide nada e não
// altera permissões (quem recebe o relato já é quem pode ver a tentativa). Sem relato → não renderiza nada.
export default function RelatoDoMembro({ relato, titulo = 'Relato do membro', className = '' }) {
  const texto = typeof relato === 'string' ? relato.trim() : ''
  if (!texto) return null
  return (
    <div data-testid="relato-do-membro" className={`rounded-xl border border-line bg-surface p-2.5 ${className}`}>
      <p className="text-xs font-extrabold uppercase tracking-wide text-muted">{titulo}</p>
      <p className="mt-0.5 whitespace-pre-wrap break-words text-sm text-ink">{texto}</p>
    </div>
  )
}
