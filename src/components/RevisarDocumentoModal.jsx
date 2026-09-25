import { useState } from 'react'
import { Folha, Botao, Campo, Aviso } from '../ui/index.jsx'
import { revisarDocumento } from '../services/documentos.js'
import { avisar } from '../ui/avisos.jsx'

// Revisão DOCUMENTAL — diferente de avaliação curricular. Só aponta problema do DOCUMENTO/PDF
// (dado ausente, documento incompleto, inconsistência, apresentação); nunca reabre requisito,
// evidência ou aprovação — isso continua em Avaliar Classes/Especialidades, fora desta tela.
export default function RevisarDocumentoModal({ aberta, aoFechar, documento, aoDecidido }) {
  const [decisao, setDecisao] = useState('aprovado')
  const [motivo, setMotivo] = useState('')
  const [orientacao, setOrientacao] = useState('')
  const [ocupado, setOcupado] = useState(false)

  async function confirmar() {
    if (decisao === 'correcao_solicitada' && motivo.trim().length < 5) {
      avisar.erro(null, 'Explique o que está errado no documento (motivo obrigatório).')
      return
    }
    setOcupado(true)
    try {
      await revisarDocumento(documento.token, decisao, motivo.trim() || null, orientacao.trim() || null)
      avisar.sucesso(decisao === 'aprovado' ? 'Documento aprovado para assinatura.' : 'Correção solicitada.')
      aoDecidido?.()
      aoFechar()
      setDecisao('aprovado'); setMotivo(''); setOrientacao('')
    } catch (e) { avisar.erro(e) }
    setOcupado(false)
  }

  return (
    <Folha aberta={aberta} aoFechar={aoFechar} titulo="Revisar documento">
      {documento && (
        <div className="space-y-3">
          <div className="text-sm">
            <p><strong>Titular:</strong> {documento.titular_nome}</p>
            <p><strong>Classe:</strong> {documento.classe_nome}</p>
          </div>

          <Aviso tom="info">
            Isto é revisão do DOCUMENTO (dado ausente, inconsistência, apresentação) — não é
            avaliação de requisito. Corrigir requisito/evidência continua em Avaliar Classes.
          </Aviso>

          <div className="flex gap-2" role="radiogroup" aria-label="Decisão da revisão">
            <button type="button" onClick={() => setDecisao('aprovado')} aria-pressed={decisao === 'aprovado'}
              className={`flex-1 min-h-[44px] rounded-xl text-sm font-bold border ${decisao === 'aprovado' ? 'bg-emerald-50 border-emerald-400 text-emerald-800' : 'border-line text-muted'}`}>
              ✅ Aprovar
            </button>
            <button type="button" onClick={() => setDecisao('correcao_solicitada')} aria-pressed={decisao === 'correcao_solicitada'}
              className={`flex-1 min-h-[44px] rounded-xl text-sm font-bold border ${decisao === 'correcao_solicitada' ? 'bg-amber-50 border-amber-400 text-amber-800' : 'border-line text-muted'}`}>
              ↺ Pedir correção
            </button>
          </div>

          {decisao === 'correcao_solicitada' && (
            <>
              <Campo id="revisao-motivo" rotulo="O que está errado? (obrigatório)" linhas={2}
                value={motivo} onChange={(e) => setMotivo(e.target.value)} data-testid="revisao-motivo" />
              <Campo id="revisao-orientacao" rotulo="O que fazer para corrigir (opcional)" linhas={2}
                value={orientacao} onChange={(e) => setOrientacao(e.target.value)} data-testid="revisao-orientacao" />
            </>
          )}

          <div className="flex gap-2">
            <Botao variacao="secundario" aoTocar={aoFechar} desabilitado={ocupado}>Cancelar</Botao>
            <Botao aoTocar={confirmar} carregando={ocupado} data-testid="confirmar-revisao">Confirmar</Botao>
          </div>
        </div>
      )}
    </Folha>
  )
}
