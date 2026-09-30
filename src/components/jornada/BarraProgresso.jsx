// Barra de progresso reutilizável (Minha Classe, Especialidades…). Acessível: role="progressbar" com
// aria-valuenow/min/max e nome; o percentual também aparece em TEXTO (nunca só a barra/cor).
//
// Props:
//   valor    número 0–100 (já calculado pelo SERVIDOR, quando for o progresso oficial) — ou use `feitos`/`total`
//   feitos, total   alternativa: a barra calcula só a largura (não decide "concluído")
//   rotulo   nome acessível da barra (obrigatório para leitor de tela), ex.: "Progresso na classe"
//   mostrarRotulo  mostra o rótulo em texto acima da barra (padrão false)
//   texto    texto opcional à direita (padrão: "78%")
//   tamanho  'normal' | 'fina' (mini-barra de seção)
//   cor      cor CSS da parte preenchida (padrão: dourado); segue a regra "sem neon"
//
// <BarraProgresso valor={78} rotulo="Progresso na classe" />
// <BarraProgresso feitos={8} total={10} rotulo="Progresso da seção I" tamanho="fina" texto="8/10" />
const limitar = (n) => Math.max(0, Math.min(100, Math.round(Number.isFinite(n) ? n : 0)))

export default function BarraProgresso({ valor, feitos, total, rotulo, mostrarRotulo = false, texto, tamanho = 'normal', cor, className = '' }) {
  const pct = limitar(valor != null ? valor : (total > 0 ? (feitos / total) * 100 : 0))
  const alto = tamanho === 'fina' ? 'h-2' : 'h-3.5'
  return (
    <div className={className}>
      {(mostrarRotulo || texto !== undefined) && (
        <div className="mb-1 flex items-center justify-between gap-2 text-xs text-muted">
          <span>{mostrarRotulo ? rotulo : ''}</span>
          <span className="font-bold text-ink">{texto ?? `${pct}%`}</span>
        </div>
      )}
      <div role="progressbar" aria-label={rotulo} aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}
        className={`${alto} w-full overflow-hidden rounded-full bg-surface2`}>
        <div className="h-full rounded-full transition-[width] duration-300 motion-reduce:transition-none"
          style={{ width: `${pct}%`, background: cor || '#c9a227' }} />
      </div>
    </div>
  )
}
