import Comprovacao from './Comprovacao.jsx'

// Lista das TENTATIVAS de um requisito (requisito_historico, migration 87), usada pela criança
// (MinhaClasse) e pela liderança (AvaliarClasse, GestaoAvaliacoes). Cada tentativa mostra a foto
// enviada NAQUELE momento, ampliável — a 360 liberou para a liderança do clube abrir a foto de
// tentativas anteriores; antes, depois de um "pedir correção → reenviar", só a atual aparecia.
// Status nunca só por cor: símbolo + palavra.

const fmtData = (iso) => {
  if (!iso) return ''
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('pt-BR')
}

export function rotuloDaDecisao(decisao) {
  // os mesmos selos que o tutorial ensina (lib/tutorial/conteudo.js)
  if (decisao === 'aprovado') return '✅ Aprovado'
  if (decisao === 'correcao_solicitada') return '↺ Correção solicitada'
  return '⏳ Aguardando avaliação'
}

export default function HistoricoDeTentativas({ tentativas = [], mostrarAvaliador = false, className = '' }) {
  if (!tentativas.length) return <p className="text-xs text-muted">Nenhuma tentativa registrada.</p>
  return (
    <ol className={`space-y-2 ${className}`} data-testid="historico-tentativas">
      {tentativas.map((tt) => (
        <li key={tt.submission_id ?? tt.tentativa_numero} className="text-xs bg-surface2 rounded-lg px-3 py-2 border-l-2 border-line">
          <div className="font-semibold text-ink mb-1">
            Tentativa {tt.tentativa_numero}{tt.enviado_em ? ` · enviada em ${fmtData(tt.enviado_em)}` : ''}
          </div>
          {tt.evidencia_texto && <p className="text-muted italic mb-1">"{tt.evidencia_texto}"</p>}
          {tt.evidencia_path && (
            <div className="mb-1.5 max-w-xs">
              <Comprovacao ampliavel valor={tt.evidencia_path} alt={`foto da tentativa ${tt.tentativa_numero}`}
                classImg="w-full max-h-48 object-contain bg-black/5 rounded-lg" classVideo="w-full max-h-48 rounded-lg" />
            </div>
          )}
          <div className="font-semibold text-ink">
            {rotuloDaDecisao(tt.decisao)}
            {mostrarAvaliador && tt.decisao && tt.avaliado_por_nome && (
              <span className="font-normal text-muted">
                {' '}por {tt.avaliado_por_nome}{tt.avaliado_papel ? ` (${tt.avaliado_papel})` : ''}{tt.avaliado_em ? ` em ${fmtData(tt.avaliado_em)}` : ''}
              </span>
            )}
          </div>
          {tt.comentario && <div className="italic mt-0.5 text-muted">orientação: <span>"{tt.comentario}"</span></div>}
        </li>
      ))}
    </ol>
  )
}
