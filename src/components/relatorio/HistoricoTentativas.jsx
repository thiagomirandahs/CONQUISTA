// Histórico do requisito com relatório estruturado: cada tentativa fica preservada, na ordem
// (conteúdo enviado → anexos → data → avaliador → decisão → comentário). A tela SÓ LÊ — nada aqui
// sobrescreve tentativa anterior. Tentativa sem `conteudo` (requisito antigo) mostra texto/foto de antes.
import RelatorioLeitura from './RelatorioLeitura.jsx'
import RelatoDoMembro from './RelatoDoMembro.jsx'
import { rotuloDaDecisao } from '../HistoricoDeTentativas.jsx'
import { fmtDataBR, schemaDoModelo } from '../../lib/relatorio/conteudo.js'

export default function HistoricoTentativas({ tentativas = [], modelo = null, mostrarAvaliador = false, className = '' }) {
  if (!tentativas.length) return <p className="text-xs text-muted">Nenhuma tentativa registrada.</p>
  const schema = schemaDoModelo(modelo)
  return (
    <ol className={`space-y-2 ${className}`} data-testid="historico-tentativas">
      {tentativas.map((tt) => (
        <li key={tt.submission_id ?? tt.tentativa_numero} data-testid="tentativa"
          className="rounded-lg border-l-2 border-line bg-surface2 px-3 py-2 text-xs">
          <div className="mb-1 font-semibold text-ink">
            Tentativa {tt.tentativa_numero}{tt.enviado_em ? ` · enviada em ${fmtDataBR(tt.enviado_em)}` : ''}
          </div>
          <RelatorioLeitura schema={tt.conteudo ? schema : null} conteudo={tt.conteudo} anexos={tt.anexos || []}
            evidenciaTexto={tt.evidencia_texto} evidenciaPath={tt.evidencia_path} className="mb-1.5" />
          <RelatoDoMembro relato={tt.relato} className="mb-1.5" />
          <div className="font-semibold text-ink">
            {rotuloDaDecisao(tt.decisao)}
            {mostrarAvaliador && tt.decisao && tt.avaliado_por_nome && (
              <span className="font-normal text-muted">
                {' '}por {tt.avaliado_por_nome}{tt.avaliado_papel ? ` (${tt.avaliado_papel})` : ''}{tt.avaliado_em ? ` em ${fmtDataBR(tt.avaliado_em)}` : ''}
              </span>
            )}
          </div>
          {tt.comentario && <div className="mt-0.5 italic text-muted">orientação: <span>"{tt.comentario}"</span></div>}
        </li>
      ))}
    </ol>
  )
}
