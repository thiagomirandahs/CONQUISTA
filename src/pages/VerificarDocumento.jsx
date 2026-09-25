import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { verificarDocumento } from '../services/documentos.js'

// Página PÚBLICA de verificação (sem login). Mostra só o resumo mínimo que a RPC devolve — nunca
// requisitos, evidências, avaliadores ou histórico. Reflete substituição/revogação ao vivo e confere
// a integridade do snapshot. É pra cá que o QR do documento aponta.
const ESTADOS = {
  valido: { rotulo: 'Documento válido', classe: 'bg-green-50 text-green-800 border-green-200', icone: '✅' },
  acompanhamento: { rotulo: 'Caderno de acompanhamento', classe: 'bg-blue-50 text-blue-800 border-blue-200', icone: '📘' },
  substituido: { rotulo: 'Substituído por uma versão mais recente', classe: 'bg-amber-50 text-amber-900 border-amber-200', icone: '🔁' },
  revogado: { rotulo: 'Documento revogado', classe: 'bg-red-50 text-red-800 border-red-200', icone: '⛔' },
  desconhecido: { rotulo: 'Estado indeterminado', classe: 'bg-surface2 text-muted border-line', icone: '❓' },
}
const fmtData = (iso) => {
  if (!iso) return ''
  const so = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  return so ? `${so[3]}/${so[2]}/${so[1]}` : ''
}
const fmtConf = (c) => (c ? String(c).replace(/(.{4})(.{4})/, '$1-$2') : '')

export default function VerificarDocumento() {
  const { token } = useParams()
  const [estado, setEstado] = useState('carregando')
  const [dados, setDados] = useState(null)

  useEffect(() => {
    let vivo = true
    verificarDocumento(token)
      .then((d) => { if (vivo) { setDados(d); setEstado(d?.encontrado ? 'ok' : 'nao_encontrado') } })
      .catch(() => { if (vivo) setEstado('erro') })
    return () => { vivo = false }
  }, [token])

  return (
    <div className="min-h-screen bg-gradient-to-b from-brand/10 to-surface2 flex flex-col items-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="text-center mb-6">
          <div className="text-3xl" aria-hidden="true">📘</div>
          <h1 className="text-xl font-extrabold text-ink mt-1">Verificação de documento</h1>
          <p className="text-sm text-muted">Caderno Digital DesbravaClube</p>
        </div>

        {estado === 'carregando' && <p className="text-center text-muted text-sm" role="status">Verificando…</p>}
        {estado === 'erro' && <div role="alert" className="bg-amber-50 border border-amber-200 rounded-2xl p-5 text-sm text-amber-800 text-center">Não foi possível verificar agora. Tente novamente.</div>}

        {estado === 'nao_encontrado' && (
          <div className="bg-surface rounded-2xl p-6 shadow-soft text-center">
            <div className="text-4xl mb-2" aria-hidden="true">🔍</div>
            <p className="font-bold text-ink">Documento não encontrado</p>
            <p className="text-sm text-faint mt-1">O código de verificação não corresponde a nenhum documento emitido.</p>
          </div>
        )}

        {estado === 'ok' && dados && <Resultado d={dados} />}

        <p className="text-[11px] text-faint text-center mt-6 leading-snug">
          Registro interno do clube para acompanhamento curricular. Não substitui o cartão ou registro
          oficial da Igreja Adventista / do Ministério de Desbravadores.
        </p>
      </div>
    </div>
  )
}

function Resultado({ d }) {
  const e = ESTADOS[d.estado] || ESTADOS.desconhecido
  return (
    <div className="bg-surface rounded-2xl shadow-soft overflow-hidden">
      <div className={`border-b px-5 py-4 flex items-center gap-3 ${e.classe}`}>
        <span className="text-2xl" aria-hidden="true">{e.icone}</span>
        <div>
          <div className="font-extrabold">{e.rotulo}</div>
          <div className="text-xs opacity-80">{d.tipo === 'final' ? 'Documento final de conclusão' : 'Caderno de acompanhamento (não é comprovante de investidura)'}</div>
        </div>
      </div>

      {!d.integro && (
        <div role="alert" className="bg-red-50 border-b border-red-200 px-5 py-2.5 text-xs text-red-800">
          ⚠️ A integridade deste documento não pôde ser confirmada. Procure o clube emissor.
        </div>
      )}

      <dl className="px-5 py-4 text-sm divide-y divide-line">
        <Linha rotulo="Nome" valor={d.nome} destaque />
        <Linha rotulo="Classe" valor={d.classe} />
        <Linha rotulo="Clube emissor" valor={d.clube_emissor} />
        <Linha rotulo="Currículo" valor={d.versao_curricular} />
        {d.data_conclusao && <Linha rotulo="Conclusão" valor={fmtData(d.data_conclusao)} />}
        {d.data_investidura && <Linha rotulo="Investidura" valor={fmtData(d.data_investidura)} />}
        <Linha rotulo="Emitido em" valor={fmtData(d.emitido_em)} />
        <Linha rotulo="Código de conferência" valor={<code className="font-mono">{fmtConf(d.conferencia)}</code>} />
      </dl>

      {d.assinaturas?.length > 0 && (
        <div className="px-5 py-4 border-t border-line">
          <p className="text-xs font-extrabold text-ink mb-2">Assinaturas eletrônicas</p>
          <ul className="space-y-2">
            {d.assinaturas.map((a, i) => (
              <li key={i} className="text-sm">
                <p className="font-semibold text-ink">{a.nome} <span className="text-xs font-normal text-muted">({a.papel})</span></p>
                <p className="text-xs text-faint">Assinado eletronicamente em {fmtData(a.data)} — {a.status === 'registrada' ? 'registrada' : a.status}</p>
              </li>
            ))}
          </ul>
          <p className="text-[11px] text-faint mt-2">Assinatura eletrônica registrada pelo DesbravaClube.</p>
        </div>
      )}
    </div>
  )
}

function Linha({ rotulo, valor, destaque }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-2">
      <dt className="text-xs text-faint shrink-0">{rotulo}</dt>
      <dd className={`text-right ${destaque ? 'font-bold text-ink' : 'text-muted'}`}>{valor}</dd>
    </div>
  )
}
