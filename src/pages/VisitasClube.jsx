import { useState, useEffect, useCallback } from 'react'
import { useClube } from '../context/Clube.jsx'
import { Cabecalho, Botao, Campo, Selo, Carregando, Vazio, Aviso, mensagemDeErro } from '../ui/index.jsx'
import { avisar } from '../ui/avisos.jsx'
import { carregarVisitasDoClube, responderVisita } from '../services/institucional.js'
import { fmtQuando, localParaIso } from './PainelDoEscopo.jsx'

// Visitas da coordenação (migration 141), lado da DIRETORIA do clube: ver o que foi agendado,
// confirmar ou sugerir outra data, e ler o relatório depois. O servidor confere a diretoria.
const STATUS = { agendada: ['atencao', 'Aguardando você'], confirmada: ['ok', 'Confirmada'], realizada: ['info', 'Realizada'], cancelada: ['neutro', 'Cancelada'] }

export default function VisitasClube() {
  const { clubeId } = useClube()
  const [lista, setLista] = useState(null)
  const [erro, setErro] = useState('')
  const recarregar = useCallback(() => {
    if (!clubeId) return
    setErro('')
    carregarVisitasDoClube(clubeId).then(setLista).catch((e) => setErro(mensagemDeErro(e)))
  }, [clubeId])
  useEffect(() => { recarregar() }, [recarregar])

  return (
    <div className="max-w-2xl mx-auto">
      <Cabecalho icone="📅" titulo="Visitas da coordenação" descricao="Visitas do distrito, da região ou da associação ao clube" />
      {erro ? <Aviso tom="erro" titulo="Não deu pra carregar">{erro}</Aviso>
        : lista === null ? <Carregando />
          : lista.length === 0 ? <Vazio icone="📅" titulo="Nenhuma visita agendada">Quando a coordenação agendar uma visita, ela aparece aqui.</Vazio>
            : <ul className="space-y-2">{lista.map((v) => <Visita key={v.id} v={v} depois={recarregar} />)}</ul>}
    </div>
  )
}

function Visita({ v, depois }) {
  const [sugerindo, setSugerindo] = useState(false)
  const [quando, setQuando] = useState('')
  const [obs, setObs] = useState('')
  const [salvando, setSalvando] = useState(null)
  const [tom, rot] = STATUS[v.status] || ['neutro', v.status]
  const aberta = v.status === 'agendada' || v.status === 'confirmada'

  const responder = async (confirmar) => {
    setSalvando(confirmar ? 'sim' : 'sug')
    try {
      await responderVisita(v.id, confirmar, { sugestao: confirmar ? null : localParaIso(quando), obs: obs || null })
      avisar.sucesso(confirmar ? 'Visita confirmada.' : 'Sugestão enviada à coordenação.')
      setSugerindo(false); setObs(''); setQuando('')
      depois()
    } catch (e) { avisar.erro(e) } finally { setSalvando(null) }
  }

  return (
    <li className="bg-surface rounded-2xl p-4 shadow-soft" data-testid="visita-clube">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-bold text-ink">{fmtQuando(v.agendada_para)}</div>
          <div className="text-sm text-ink">{v.objetivo}</div>
        </div>
        <Selo tom={tom}>{rot}</Selo>
      </div>
      <p className="text-xs text-muted mt-1">
        {v.agendada_por?.unidade?.nome}{v.agendada_por?.nome ? ` · ${v.agendada_por.nome}` : ''}
      </p>
      {v.observacao && <p className="text-xs text-ink mt-1">{v.observacao}</p>}
      {v.sugestao && aberta && <p className="text-xs text-muted mt-1">Você sugeriu {fmtQuando(v.sugestao.para)} — aguardando a coordenação.</p>}
      {v.motivo_cancelamento && <p className="text-xs text-muted mt-1">Motivo: {v.motivo_cancelamento}</p>}
      {v.relatorio && (
        <div className="mt-2 rounded-xl bg-surface2 p-2">
          <p className="text-xs font-semibold text-muted">Relatório da visita</p>
          <p className="text-sm text-ink whitespace-pre-wrap">{v.relatorio}</p>
        </div>
      )}
      {aberta && !sugerindo && (
        <div className="grid grid-cols-2 gap-2 mt-3">
          <Botao variacao="contorno" carregando={salvando === 'sim'} desabilitado={!!salvando || v.status === 'confirmada'}
            aoTocar={() => responder(true)}>{v.status === 'confirmada' ? 'Confirmada' : 'Confirmar'}</Botao>
          <Botao variacao="secundario" desabilitado={!!salvando} aoTocar={() => setSugerindo(true)}>Sugerir outra data</Botao>
        </div>
      )}
      {sugerindo && (
        <div className="mt-3">
          <Campo id={`sug-${v.id}`} rotulo="Data e hora que funcionam para o clube" tipo="datetime-local" value={quando} onChange={(e) => setQuando(e.target.value)} />
          <Campo id={`obs-${v.id}`} rotulo="Observação (opcional)" linhas={2} maxLength={500} value={obs} onChange={(e) => setObs(e.target.value)} />
          <div className="grid grid-cols-2 gap-2">
            <Botao variacao="secundario" desabilitado={!!salvando} aoTocar={() => setSugerindo(false)}>Voltar</Botao>
            <Botao variacao="contorno" carregando={salvando === 'sug'} desabilitado={!quando || !!salvando} aoTocar={() => responder(false)}>Enviar</Botao>
          </div>
        </div>
      )}
    </li>
  )
}
