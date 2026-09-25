import { useState, useRef, useCallback } from 'react'
import { Folha, Botao, Aviso } from '../ui/index.jsx'
import { assinarDocumento, subirDesenhoAssinatura } from '../services/documentos.js'
import { avisar } from '../ui/avisos.jsx'

const DECLARACAO = 'Declaro que revisei este documento e confirmo sua assinatura eletrônica.'

// Modal de assinatura — UM documento por vez (o lote usa outro fluxo, sem desenho individual).
// IMPORTANTE (mesmo texto que a Fase 4 pediu explicitamente): o desenho abaixo é só REPRESENTAÇÃO
// VISUAL. Quem autentica a assinatura é sessão + autorização no servidor + consentimento + hash do
// PDF + auditoria — nunca o traço em si. Por isso o desenho é OPCIONAL: assinar sem desenhar nada
// já é uma assinatura eletrônica válida e completa.
export default function AssinarDocumentoModal({ aberta, aoFechar, documento, clubId, aoAssinado }) {
  const [aceito, setAceito] = useState(false)
  const [ocupado, setOcupado] = useState(false)
  const [desenhou, setDesenhou] = useState(false)
  const canvasRef = useRef(null)
  const desenhando = useRef(false)

  const limparCanvas = useCallback(() => {
    const c = canvasRef.current
    if (!c) return
    c.getContext('2d').clearRect(0, 0, c.width, c.height)
    setDesenhou(false)
  }, [])

  function coordenadas(e, c) {
    const r = c.getBoundingClientRect()
    const p = e.touches ? e.touches[0] : e
    return { x: (p.clientX - r.left) * (c.width / r.width), y: (p.clientY - r.top) * (c.height / r.height) }
  }
  function iniciarTraco(e) {
    e.preventDefault()
    desenhando.current = true
    const c = canvasRef.current; const ctx = c.getContext('2d')
    const { x, y } = coordenadas(e, c)
    ctx.beginPath(); ctx.moveTo(x, y)
  }
  function continuarTraco(e) {
    if (!desenhando.current) return
    e.preventDefault()
    const c = canvasRef.current; const ctx = c.getContext('2d')
    const { x, y } = coordenadas(e, c)
    ctx.lineWidth = 2.5; ctx.lineCap = 'round'; ctx.strokeStyle = '#1a1a2e'
    ctx.lineTo(x, y); ctx.stroke()
    setDesenhou(true)
  }
  function pararTraco() { desenhando.current = false }

  async function confirmar() {
    setOcupado(true)
    try {
      const r = await assinarDocumento(documento.token, DECLARACAO)
      if (desenhou && canvasRef.current) {
        const blob = await new Promise((resolve) => canvasRef.current.toBlob(resolve, 'image/png'))
        if (blob) {
          try { await subirDesenhoAssinatura(clubId, documento.documento_id, r.signature_id, blob) }
          catch { avisar.erro(null, 'Assinatura registrada, mas o desenho não pôde ser salvo.') }
        }
      }
      avisar.sucesso('Documento assinado.')
      aoAssinado?.()
      aoFechar()
    } catch (e) { avisar.erro(e) }
    setOcupado(false)
  }

  return (
    <Folha aberta={aberta} aoFechar={aoFechar} titulo="Assinar documento">
      {documento && (
        <div className="space-y-3">
          <div className="text-sm">
            <p><strong>Titular:</strong> {documento.titular_nome}</p>
            <p><strong>Classe:</strong> {documento.classe_nome}</p>
            <p><strong>Documento:</strong> {documento.tipo === 'final' ? 'Documento final' : 'Acompanhamento'}</p>
            <p><strong>Código de conferência:</strong> {documento.conferencia}</p>
          </div>

          <Aviso tom="info">
            A assinatura desenhada abaixo é só representação visual — quem autentica é sua sessão,
            a autorização conferida pelo servidor, este consentimento e o hash do PDF. É opcional.
          </Aviso>

          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" checked={aceito} onChange={(e) => setAceito(e.target.checked)}
              className="mt-1 w-5 h-5 shrink-0" data-testid="consentimento-checkbox" />
            <span>{DECLARACAO}</span>
          </label>

          <div>
            <p className="text-xs font-semibold text-muted mb-1">Assinatura desenhada (opcional)</p>
            <canvas ref={canvasRef} width={400} height={140} data-testid="canvas-assinatura"
              className="w-full h-[140px] rounded-xl border border-line bg-white touch-none"
              onMouseDown={iniciarTraco} onMouseMove={continuarTraco} onMouseUp={pararTraco} onMouseLeave={pararTraco}
              onTouchStart={iniciarTraco} onTouchMove={continuarTraco} onTouchEnd={pararTraco} />
            <button type="button" onClick={limparCanvas} className="mt-1 text-xs font-semibold text-muted underline min-h-[44px]">
              Limpar
            </button>
          </div>

          <div className="flex gap-2">
            <Botao variacao="secundario" aoTocar={aoFechar} desabilitado={ocupado}>Cancelar</Botao>
            <Botao aoTocar={confirmar} carregando={ocupado} desabilitado={!aceito} data-testid="confirmar-assinatura">
              Assinar documento
            </Botao>
          </div>
        </div>
      )}
    </Folha>
  )
}
