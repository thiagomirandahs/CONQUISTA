// Situação de um requisito: SEMPRE ícone + texto (nunca só cor). Reutilizável (Minha Classe, Especialidades).
//
// Props:
//   status  'nao_iniciado' | 'rascunho' | 'enviado' | 'aguardando' | 'correcao' | 'aprovado' | 'bloqueado'
//           (na Minha Classe use `statusDaJornada()` de src/lib/requisitos/jornada.js; 'enviado' só existe
//            quando o chamador sabe que acabou de enviar — o servidor devolve "aguardando")
//   rotulo  texto alternativo (ex.: "Cumprido pelo seu histórico"); o ícone continua o do status
//   compacto  esconde o texto na tela (continua acessível por leitor de tela) — só para espaços mínimos
//
// <StatusRequisito status="correcao" />   →  ⚠ Correção solicitada
export const STATUS = {
  nao_iniciado: { icone: '○', texto: 'Não iniciado', classes: 'bg-surface2 text-muted' },
  rascunho: { icone: '✎', texto: 'Rascunho', classes: 'bg-sky-50 text-sky-900' },
  enviado: { icone: '↑', texto: 'Enviado', classes: 'bg-sky-50 text-sky-900' },
  aguardando: { icone: '⏳', texto: 'Aguardando avaliação', classes: 'bg-amber-50 text-amber-900' },
  correcao: { icone: '⚠', texto: 'Correção solicitada', classes: 'bg-rose-50 text-rose-900' },
  aprovado: { icone: '✓', texto: 'Aprovado', classes: 'bg-emerald-50 text-emerald-900' },
  bloqueado: { icone: '🔒', texto: 'Bloqueado', classes: 'bg-amber-50 text-amber-900' },
}

export default function StatusRequisito({ status, rotulo, compacto = false, className = '' }) {
  const s = STATUS[status] || STATUS.nao_iniciado
  const texto = rotulo || s.texto
  return (
    <span data-status={status} className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-bold ${s.classes} ${className}`}>
      <span aria-hidden="true">{s.icone}</span>
      <span className={compacto ? 'sr-only' : undefined}>{texto}</span>
    </span>
  )
}
