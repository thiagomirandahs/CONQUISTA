import { Carregando as Esqueleto } from '../ui/index.jsx'
import { useState, useEffect, useMemo } from 'react'
import { Cabecalho, Aviso } from '../ui/index.jsx'
import {
  carregarFilaDeAvaliacao, avaliarRequisito, carregarHistoricoRequisito,
  avaliarRequisitoEspecialidade,
} from '../lib/dados.js'
import Comprovacao from '../components/Comprovacao.jsx'
import { avisar } from '../ui/avisos.jsx'
import { fmtData } from './MinhaClasse.jsx'

// Central de trabalho da liderança: Classes + Especialidades numa fila só (RPC
// fila_avaliacao_unificada, migration 87). Experiências/Atividades/Missões continuam com telas
// próprias — elas ainda não têm o mesmo conceito de "tentativa" (ver ETAPA-2, regra 2.4), forçá-las
// aqui seria fingir uma semântica que elas não têm.
export default function GestaoAvaliacoes() {
  const [lista, setLista] = useState(null)
  const [erro, setErro] = useState('')
  const [filtroTipo, setFiltroTipo] = useState('')
  const [filtroUnidade, setFiltroUnidade] = useState('')
  const [ordem, setOrdem] = useState('antigo') // 'antigo' | 'recente'

  useEffect(() => {
    let vivo = true
    carregarFilaDeAvaliacao(filtroTipo || null, null)
      .then((d) => { if (vivo) setLista(d) })
      .catch((e) => { if (vivo) { setErro(e?.message || 'Não consegui carregar a fila.'); setLista([]) } })
    return () => { vivo = false }
  }, [filtroTipo])

  const unidades = useMemo(() => {
    const nomes = new Set((lista || []).map((x) => x.unidade_nome).filter(Boolean))
    return [...nomes].sort()
  }, [lista])

  const filtrada = useMemo(() => {
    let l = (lista || []).filter((x) => !filtroUnidade || x.unidade_nome === filtroUnidade)
    l = [...l].sort((a, b) => (ordem === 'antigo' ? 1 : -1) * (new Date(a.enviado_em) - new Date(b.enviado_em)))
    return l
  }, [lista, filtroUnidade, ordem])

  function remover(tipo, itemId) {
    setLista((l) => (l || []).filter((x) => !(x.tipo === tipo && x.item_id === itemId)))
  }

  return (
    <div className="max-w-2xl mx-auto">
      <Cabecalho icone="🔎" titulo="Avaliações" descricao="Classes e Especialidades aguardando avaliação, num lugar só" />

      <div className="flex flex-wrap gap-2 mb-4">
        <select value={filtroTipo} onChange={(e) => setFiltroTipo(e.target.value)} className="text-sm rounded-lg border border-line px-2 py-1.5">
          <option value="">Todos os tipos</option>
          <option value="classe">Classes</option>
          <option value="especialidade">Especialidades</option>
        </select>
        <select value={filtroUnidade} onChange={(e) => setFiltroUnidade(e.target.value)} className="text-sm rounded-lg border border-line px-2 py-1.5">
          <option value="">Todas as unidades</option>
          {unidades.map((u) => <option key={u} value={u}>{u}</option>)}
        </select>
        <select value={ordem} onChange={(e) => setOrdem(e.target.value)} className="text-sm rounded-lg border border-line px-2 py-1.5">
          <option value="antigo">Mais antigo primeiro</option>
          <option value="recente">Mais recente primeiro</option>
        </select>
      </div>

      {erro && <Aviso tom="erro" titulo="Não deu pra ver a fila">{erro}</Aviso>}
      {lista === null ? (
        <Esqueleto />
      ) : filtrada.length === 0 ? (
        <div className="bg-surface rounded-2xl p-8 text-center shadow-soft">
          <div className="text-4xl mb-2">🎉</div>
          <p className="font-semibold text-ink">Nada pra avaliar!</p>
        </div>
      ) : (
        <ul className="space-y-3">
          {filtrada.map((it) => (
            <ItemFila key={`${it.tipo}-${it.item_id}`} it={it} onFeito={() => remover(it.tipo, it.item_id)} />
          ))}
        </ul>
      )}
    </div>
  )
}

function ItemFila({ it, onFeito }) {
  const [comentario, setComentario] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const [historico, setHistorico] = useState(null)
  const ehClasse = it.tipo === 'classe'

  async function avaliar(decisao) {
    if (decisao === 'correcao_solicitada' && !comentario.trim()) {
      avisar.erro(new Error('Explique o que precisa ser corrigido antes de enviar.'))
      return
    }
    setOcupado(true)
    try {
      if (ehClasse) {
        // it.submission_id trava a concorrência: se outra pessoa decidiu essa mesma tentativa, ou
        // o membro já reenviou, o servidor recusa (nunca sobrescreve silenciosamente).
        await avaliarRequisito(it.item_id, decisao, comentario.trim() || null, it.submission_id)
      } else {
        await avaliarRequisitoEspecialidade(it.item_id, decisao, comentario.trim() || null)
      }
      onFeito()
    } catch (e) {
      avisar.erro(e)
      setOcupado(false)
    }
  }

  async function verHistorico() {
    if (historico) { setHistorico(null); return }
    if (!ehClasse) return // histórico por tentativa só existe pra Classes por ora
    try { setHistorico(await carregarHistoricoRequisito(it.item_id)) } catch (e) { avisar.erro(e) }
  }

  return (
    <li className="bg-surface rounded-2xl p-4 shadow-soft" aria-label={`${it.usuario_nome}: ${it.titulo}`}>
      <div className="flex items-center justify-between gap-2 mb-1">
        <span className="text-xs font-bold uppercase tracking-wide text-brand">{ehClasse ? '🎖️ Classe' : '🏅 Especialidade'}</span>
        {it.tentativa_numero > 1 && (
          <span className="text-xs font-semibold text-amber-800 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5">
            Tentativa {it.tentativa_numero}
          </span>
        )}
      </div>
      <div className="font-bold text-ink">{it.usuario_nome}</div>
      <p className="text-sm text-ink mb-1">{it.titulo} — {it.subtitulo}</p>
      <p className="text-xs text-faint mb-2">{it.unidade_nome || 'sem unidade'} · enviado em {fmtData(it.enviado_em)}</p>

      {ehClasse && it.tentativa_numero > 1 && (
        <button type="button" onClick={verHistorico} className="text-xs font-semibold text-brand mb-2 underline">
          {historico ? 'Ocultar histórico' : 'Ver histórico'}
        </button>
      )}
      {historico && (
        <ol className="text-xs bg-surface2 rounded-lg p-2 mb-2 space-y-1.5">
          {(historico.tentativas || []).map((h) => (
            <li key={h.submission_id} className="border-l-2 border-line pl-2">
              <div className="font-semibold text-ink">Tentativa {h.tentativa_numero} — {h.decisao === 'aprovado' ? '✅ aprovada' : h.decisao === 'correcao_solicitada' ? '✏️ correção solicitada' : '⏳ aguardando'}</div>
              {h.evidencia_texto && <div className="italic text-muted">"{h.evidencia_texto}"</div>}
              {h.comentario && <div className="text-muted italic">orientação: "{h.comentario}"</div>}
            </li>
          ))}
        </ol>
      )}

      <label className="block mb-2">
        <span className="sr-only">Orientação (obrigatória para pedir correção)</span>
        <input value={comentario} onChange={(e) => setComentario(e.target.value)} placeholder="O que precisa corrigir? (obrigatório para pedir correção)"
          className="w-full text-sm rounded-lg border border-line px-3 py-1.5" />
      </label>
      <div className="flex gap-2">
        <button onClick={() => avaliar('correcao_solicitada')} disabled={ocupado}
          className="flex-1 min-h-[44px] rounded-lg border border-line py-2 text-sm font-semibold text-muted hover:bg-surface2 disabled:opacity-60">
          Pedir correção
        </button>
        <button onClick={() => avaliar('aprovado')} disabled={ocupado}
          className="flex-1 min-h-[44px] rounded-lg bg-green-600 hover:bg-green-700 text-white py-2 text-sm font-semibold disabled:opacity-40">
          ✅ Aprovar
        </button>
      </div>
    </li>
  )
}
