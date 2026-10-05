// Erro de carga padrão: aviso claro + "Tentar de novo". Substitui os blocos que mandavam a liderança "rodar o SQL" (resíduo de
// desenvolvimento) e os que viravam "vazio" quando a rede falhava (auditoria de 05/10/2026). `detalhe` é opcional (mensagem técnica curta).
export function ErroDeCarga({ titulo = 'Não consegui carregar.', detalhe = '', aoTentar, className = '' }) {
  return (
    <div role="alert" className={`bg-amber-50 border border-amber-200 rounded-2xl p-5 text-center ${className}`}>
      <p className="font-semibold text-amber-900">{titulo}</p>
      <p className="text-sm text-amber-800 mt-1">Confira a conexão e tente de novo.</p>
      {detalhe ? <p className="text-xs text-amber-700 mt-1 break-words">{detalhe}</p> : null}
      {aoTentar && (
        <button type="button" onClick={aoTentar} className="mt-3 min-h-[44px] rounded-xl bg-brand px-5 font-bold text-white">Tentar de novo</button>
      )}
    </div>
  )
}
