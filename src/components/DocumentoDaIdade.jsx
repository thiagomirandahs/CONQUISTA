import { useEffect, useState } from 'react'
import Comprovacao from './Comprovacao.jsx'
import { enviarDocumento, apagarDocumentoConferido, documentoDoRequisito } from '../services/documentoIdade.js'
import { mensagemDeErro } from '../ui/index.jsx'

const dataBR = (iso) => (iso ? new Date(iso).toLocaleDateString('pt-BR') : '')

// Requisito de idade (migration 380), visto pelo DESBRAVADOR: envia a foto do documento. Aviso de
// privacidade sempre visível. Depois da aprovação a foto some e fica só "conferido por … em …".
export function DocumentoDaIdade({ info, requirementId, memberRequirementId, podeEditar, userId, onMudou }) {
  const doc = info?.documento
  const [ocupado, setOcupado] = useState(false)
  const [erro, setErro] = useState('')

  // reserva: se quem aprovou não conseguiu apagar o arquivo, o app do dono apaga ao abrir a classe
  useEffect(() => {
    if (doc?.status === 'conferido' && doc.evidencia_path && memberRequirementId) {
      apagarDocumentoConferido(memberRequirementId, doc.evidencia_path).then((ok) => { if (ok) onMudou?.() }).catch(() => {})
    }
  }, [doc?.status, doc?.evidencia_path, memberRequirementId, onMudou])

  async function escolher(file) {
    if (!file) return
    setOcupado(true); setErro('')
    try { await enviarDocumento({ requirementId, file, userId }); await onMudou?.() } catch (e) { setErro(mensagemDeErro(e, 'Não consegui enviar o documento.')) }
    setOcupado(false)
  }

  if (doc?.status === 'conferido') {
    return (
      <p className="mt-2 rounded-xl border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800" data-testid="documento-conferido">
        🪪 Idade conferida{doc.conferido_por_nome ? ` por ${doc.conferido_por_nome}` : ''}{doc.conferido_em ? ` em ${dataBR(doc.conferido_em)}` : ''}.
        {doc.evidencia_path ? '' : ' A foto do documento já foi apagada.'}
      </p>
    )
  }

  return (
    <div className="mt-2 space-y-2" data-testid="documento-idade">
      <div className="rounded-xl border-2 border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
        <p className="font-bold"><span aria-hidden="true">🪪 </span>Foto do documento (obrigatória)</p>
        <p className="mt-0.5 text-xs">{info?.orientacao}</p>
        <ul className="mt-1.5 list-disc pl-4 text-xs space-y-0.5">
          <li><strong>Cubra o número do documento</strong> (com o dedo ou um papel). Só precisamos do nome e da data de nascimento.</li>
          <li>Só a liderança que avalia a sua classe vê a foto.</li>
          <li>Depois que a liderança aprovar, a foto é <strong>apagada</strong>. Fica só o registro de que a idade foi conferida.</li>
        </ul>
      </div>
      {doc?.evidencia_path && (
        <div className="rounded-xl border border-line bg-surface2 p-2 text-center">
          <Comprovacao valor={doc.evidencia_path} alt="foto do documento enviada" classImg="mx-auto max-h-48 w-auto rounded-lg object-contain" />
          <p className="mt-1 text-xs text-muted">✅ Foto enviada — a liderança vai conferir.</p>
        </div>
      )}
      {podeEditar && (
        <label className={`flex min-h-[56px] cursor-pointer items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-amber-400 bg-surface px-4 text-base font-bold text-ink active:scale-[0.99] ${ocupado ? 'pointer-events-none opacity-60' : ''}`}>
          <input type="file" accept="image/*" className="sr-only" aria-label="Foto do documento" onChange={(e) => { escolher(e.target.files?.[0]); e.target.value = '' }} />
          <span aria-hidden="true">📷</span>{ocupado ? 'Enviando…' : doc?.evidencia_path ? 'Trocar a foto do documento' : 'Tirar foto do documento'}
        </label>
      )}
      {erro && <p role="alert" className="text-xs text-red-700">{erro}</p>}
    </div>
  )
}

// Na fila de avaliação: o avaliador vê o documento enviado para conferir a idade antes de aprovar.
export function DocumentoParaConferir({ memberRequirementId }) {
  const [d, setD] = useState(undefined)
  useEffect(() => {
    let vivo = true
    documentoDoRequisito(memberRequirementId).then((x) => { if (vivo) setD(x) }).catch(() => { if (vivo) setD(null) })
    return () => { vivo = false }
  }, [memberRequirementId])
  if (!d?.exige) return null
  const path = d.documento?.evidencia_path
  return (
    <div className="mb-2 rounded-xl border-2 border-amber-300 bg-amber-50 p-3" data-testid="documento-para-conferir">
      <p className="text-sm font-bold text-amber-900"><span aria-hidden="true">🪪 </span>Documento para conferir a idade</p>
      {path ? (
        <>
          <Comprovacao ampliavel valor={path} alt="documento enviado" classImg="mt-2 w-full max-h-72 object-contain rounded-lg bg-black/5" />
          <p className="mt-1 text-xs text-amber-900">Confira nome e data de nascimento. Ao aprovar, a foto é apagada e fica registrado que você conferiu.</p>
        </>
      ) : <p className="mt-1 text-xs text-amber-900">Nenhuma foto enviada.</p>}
    </div>
  )
}
