import { situacaoDaEtapa } from '../lib/fluxoInvestidura.js'

// Linha do tempo do cartão de classe: revisão do clube → distrito → região → investidura.
// Recebe { etapa_atual_ordem, etapas: [{ ordem, chave, nome, escopo_tipo, decisao: { decisao, observacao,
// decidido_em, decisor_nome, escopo_nome } }] } — mesmo formato de investidura_cartao/classe_revisoes_pendentes.
const VISUAL = {
  aprovada: { icone: '✅', cor: 'text-green-700', texto: 'Aprovado' },
  investida: { icone: '🏅', cor: 'text-green-700', texto: 'Investidura registrada' },
  pulada: { icone: '⤼', cor: 'text-faint', texto: 'Não se aplica (o clube não tem esse nível)' },
  devolvida: { icone: '↩️', cor: 'text-red-700', texto: 'Devolvido ao clube' },
  atual: { icone: '⏳', cor: 'text-amber-800', texto: 'Aguardando' },
  futura: { icone: '○', cor: 'text-faint', texto: '' },
}
const fmt = (iso) => (iso ? new Date(iso).toLocaleDateString('pt-BR') : '')

export default function LinhaDoTempoInvestidura({ linha, titulo = 'Caminho do cartão' }) {
  const etapas = linha?.etapas || []
  if (etapas.length === 0) return null
  return (
    <section aria-label={titulo} className="mt-2 rounded-xl bg-surface2 px-3 py-2">
      <p className="text-xs font-semibold text-ink mb-1">{titulo}</p>
      <ol className="space-y-1.5">
        {etapas.map((e) => {
          const sit = situacaoDaEtapa(e, linha)
          const v = VISUAL[sit]
          const d = e.decisao
          const nome = e.chave === 'investidura' && sit !== 'investida' ? 'Apto à investidura' : e.nome
          return (
            <li key={e.ordem} data-testid="etapa-linha" data-situacao={sit} className="flex gap-2 text-xs leading-snug">
              <span aria-hidden="true" className={`w-5 shrink-0 text-center ${v.cor}`}>{v.icone}</span>
              <div className="min-w-0">
                <span className={`font-semibold ${sit === 'futura' ? 'text-faint' : 'text-ink'}`}>{nome}</span>
                {v.texto && sit !== 'futura' && <span className={`ml-1 ${v.cor}`}>· {v.texto}</span>}
                {d && d.decisao !== 'pulada_nivel_ausente' && (d.decisor_nome || d.decidido_em) && (
                  <div className="text-faint">
                    {d.decisor_nome ? `por ${d.decisor_nome}` : ''}{d.escopo_nome && e.escopo_tipo !== 'clube' ? ` (${d.escopo_nome})` : ''}{d.decidido_em ? ` em ${fmt(d.decidido_em)}` : ''}
                  </div>
                )}
                {d?.observacao && d.decisao !== 'pulada_nivel_ausente' && <div className="text-muted italic">“{d.observacao}”</div>}
              </div>
            </li>
          )
        })}
      </ol>
    </section>
  )
}
