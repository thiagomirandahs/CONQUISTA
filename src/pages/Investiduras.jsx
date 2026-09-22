import { useState, useEffect, useCallback } from 'react'
import { useClube } from '../context/Clube.jsx'
import { carregarRevisoesPendentes, solicitarRevisaoFinal, decidirRevisaoFinal, registrarInvestidura } from '../lib/dados.js'

// Revisão final e investidura (fase 4) — só a liderança do clube em uso. Tudo vem do servidor:
// estados, snapshot (hash), bloqueios atuais e a lista de requisitos. A tela não decide regra: o
// servidor recusa investidura com qualquer bloqueio, e "apto" ainda não é "investido".
const PODE_GERIR = ['instrutor', 'diretoria']
const ESTADOS = {
  requisitos_concluidos: { label: 'Requisitos concluídos — conclusão ainda não validada', icon: '🧩', badge: 'bg-amber-50 text-amber-800 border border-amber-200' },
  aguardando_revisao: { label: 'Aguardando revisão final', icon: '🔎', badge: 'bg-blue-50 text-blue-700 border border-blue-200' },
  apto_investidura: { label: 'Apto para investidura', icon: '✅', badge: 'bg-green-50 text-green-700 border border-green-200' },
}
const fmtData = (iso) => {
  if (!iso) return ''
  const so = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  return so ? `${so[3]}/${so[2]}/${so[1]}` : new Date(iso).toLocaleDateString('pt-BR')
}
const hoje = () => new Date().toISOString().slice(0, 10)

export default function Investiduras() {
  const { papel: meuPapel } = useClube()
  const ehAdmin = PODE_GERIR.includes(meuPapel)
  const [lista, setLista] = useState([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState('')

  const recarregar = useCallback(async () => {
    if (!ehAdmin) { setCarregando(false); return }
    setErro('')
    try { setLista(await carregarRevisoesPendentes()) } catch (e) { setErro(e?.message || 'Erro') } finally { setCarregando(false) }
  }, [ehAdmin])
  useEffect(() => { recarregar() }, [recarregar])

  if (!ehAdmin) {
    return (
      <div className="bg-surface rounded-2xl p-8 text-center shadow-soft">
        <div className="text-4xl mb-2" aria-hidden="true">🔒</div>
        <p className="font-semibold text-ink">Área da diretoria</p>
        <p className="text-sm text-faint">Apenas diretoria/instrutor revisam conclusões e registram investiduras — no clube em uso.</p>
      </div>
    )
  }

  return (
    <div>
      <div className="mb-4">
        <h2 className="text-2xl font-extrabold text-ink">🏅 Revisão final e investidura</h2>
        <p className="text-sm text-muted">Conclusões de classe deste clube: revisar, pedir correção ou registrar a investidura</p>
      </div>
      {carregando ? (
        <p className="text-faint text-sm" role="status">Carregando...</p>
      ) : erro ? (
        <div role="alert" className="bg-amber-50 border border-amber-200 rounded-2xl p-5 text-sm text-amber-800">{erro}</div>
      ) : lista.length === 0 ? (
        <div className="bg-surface rounded-2xl p-8 text-center shadow-soft">
          <div className="text-4xl mb-2" aria-hidden="true">🎉</div>
          <p className="font-semibold text-ink">Nenhuma conclusão pendente</p>
          <p className="text-sm text-faint">Quando alguém concluir todos os requisitos de uma classe, aparece aqui.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {lista.map((it) => <Conclusao key={it.member_class_id} it={it} onMudou={recarregar} />)}
        </div>
      )}
    </div>
  )
}

function Conclusao({ it, onMudou }) {
  const estado = ESTADOS[it.status] || ESTADOS.requisitos_concluidos
  const [observacao, setObservacao] = useState('')
  const [dataInv, setDataInv] = useState(hoje())
  const [corrigindo, setCorrigindo] = useState(false)
  const [marcados, setMarcados] = useState(new Set())
  const [ocupado, setOcupado] = useState(false)
  const [erro, setErro] = useState('')
  const [resultado, setResultado] = useState('')
  const bloqueios = it.bloqueios || []
  const idBloq = `bloq-${it.member_class_id}`

  async function agir(fn) {
    setOcupado(true); setErro(''); setResultado('')
    try {
      const r = await fn()
      if (r && r.ok === false) setResultado('Ainda não deu pra selar a conclusão — veja os bloqueios abaixo.')
      await onMudou()
    } catch (e) { setErro(e?.message || String(e)) } finally { setOcupado(false) }
  }
  const alternar = (id) => setMarcados((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })

  return (
    <article className="bg-surface rounded-2xl p-4 shadow-soft" aria-label={`${it.usuario_nome}: ${it.classe_nome}`}>
      <div className="flex items-start justify-between gap-2 mb-1">
        <div className="min-w-0">
          <h3 className="font-bold text-ink truncate text-base">{it.usuario_nome}</h3>
          <div className="text-xs text-faint">{it.classe_nome} · {it.percentual}% · iniciada em {fmtData(it.iniciada_em)}{it.concluida_em ? ` · concluída em ${fmtData(it.concluida_em)}` : ''}</div>
        </div>
        <span className={`shrink-0 text-[11px] font-bold rounded-full px-2 py-0.5 ${estado.badge}`} data-testid="estado" data-estado={it.status}>
          <span aria-hidden="true">{estado.icon}</span> {estado.label}
        </span>
      </div>

      {it.snapshot && (
        <p className="text-xs text-muted bg-surface2 rounded-lg px-3 py-1.5 mb-2">
          🔏 Snapshot v{it.snapshot.versao} selado em {fmtData(it.snapshot.selado_em)} · currículo {it.snapshot.manifesto_versao || '—'} · hash <code className="break-all">{String(it.snapshot.hash).slice(0, 12)}…</code>
        </p>
      )}
      {it.revisao?.status === 'correcao_solicitada' && it.revisao.comentario && (
        <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-1.5 mb-2">↺ Última revisão pediu correção: "{it.revisao.comentario}"</p>
      )}
      {bloqueios.length > 0 && (
        <ul id={idBloq} className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-1.5 mb-2 space-y-0.5">
          <li className="font-semibold">Bloqueios atuais (o servidor não sela nem investe com isso):</li>
          {bloqueios.map((b, i) => <li key={i}>🔒 {b.codigo}: {(b.bloqueios || []).join(' ')}</li>)}
        </ul>
      )}
      {resultado && <p className="text-xs text-amber-800 mb-2" role="status">{resultado}</p>}
      {erro && <p className="text-xs text-red-700 mb-2" role="alert">{erro}</p>}

      {it.status === 'requisitos_concluidos' && (
        <button onClick={() => agir(() => solicitarRevisaoFinal(it.member_class_id))} disabled={ocupado}
          className="w-full min-h-[44px] rounded-lg border border-line py-2 text-sm font-semibold text-muted hover:bg-surface2 disabled:opacity-60">
          Tentar selar a conclusão de novo
        </button>
      )}

      {it.status === 'aguardando_revisao' && (
        <div className="space-y-2">
          <label className="block">
            <span className="text-xs text-muted">Observação da revisão (obrigatória ao pedir correção)</span>
            <textarea value={observacao} onChange={(e) => setObservacao(e.target.value)} rows={2} className="mt-1 w-full text-sm rounded-lg border border-line px-3 py-2" />
          </label>
          {corrigindo && (
            <fieldset className="text-xs bg-surface2 rounded-lg px-3 py-2">
              <legend className="font-semibold text-ink">Quais requisitos precisam de correção?</legend>
              <ul className="mt-1 space-y-1 max-h-60 overflow-y-auto">
                {(it.requisitos || []).map((r) => (
                  <li key={r.member_requirement_id}>
                    <label className="flex items-start gap-2 min-h-[32px]">
                      <input type="checkbox" className="mt-0.5 w-5 h-5" aria-label={`${r.secao}.${r.codigo} ${r.descricao}`} checked={marcados.has(r.member_requirement_id)} onChange={() => alternar(r.member_requirement_id)} />
                      <span>{r.secao}.{r.codigo} {r.descricao}{r.aprovado_por ? <span className="text-faint"> · aprovado por {r.aprovado_por}</span> : null}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </fieldset>
          )}
          <div className="flex flex-wrap gap-2">
            {!corrigindo ? (
              <button onClick={() => setCorrigindo(true)} disabled={ocupado}
                className="flex-1 min-h-[44px] rounded-lg border border-line py-2 text-sm font-semibold text-muted hover:bg-surface2 disabled:opacity-60">
                ↺ Pedir correção
              </button>
            ) : (
              <button onClick={() => agir(() => decidirRevisaoFinal(it.member_class_id, 'correcao_solicitada', observacao.trim() || null, [...marcados]))}
                disabled={ocupado || marcados.size === 0 || !observacao.trim()} aria-describedby={`dica-corr-${it.member_class_id}`}
                className="flex-1 min-h-[44px] rounded-lg border border-red-200 bg-red-50 py-2 text-sm font-semibold text-red-700 disabled:opacity-40">
                ↺ Confirmar correção ({marcados.size})
              </button>
            )}
            <button onClick={() => agir(() => decidirRevisaoFinal(it.member_class_id, 'aprovado', observacao.trim() || null))} disabled={ocupado}
              className="flex-1 min-h-[44px] rounded-lg bg-green-600 hover:bg-green-700 text-white py-2 text-sm font-semibold disabled:opacity-60">
              ✅ Aprovar revisão final
            </button>
          </div>
          {corrigindo && <p id={`dica-corr-${it.member_class_id}`} className="text-[11px] text-faint">Marque pelo menos um requisito e escreva a observação.</p>}
        </div>
      )}

      {it.status === 'apto_investidura' && (
        <div className="space-y-2">
          <p className="text-xs text-green-700">Revisão final aprovada{it.revisao?.revisado_em ? ` em ${fmtData(it.revisao.revisado_em)}` : ''}. Apto ainda não é investido — registre a investidura quando ela acontecer.</p>
          <div className="flex flex-wrap gap-2 items-end">
            <label className="block">
              <span className="text-xs text-muted">Data da investidura</span>
              <input type="date" value={dataInv} max={hoje()} onChange={(e) => setDataInv(e.target.value)} className="mt-1 block text-sm rounded-lg border border-line px-3 py-1.5" />
            </label>
            <label className="block flex-1 min-w-[10rem]">
              <span className="text-xs text-muted">Observação (opcional)</span>
              <input value={observacao} onChange={(e) => setObservacao(e.target.value)} className="mt-1 w-full text-sm rounded-lg border border-line px-3 py-1.5" />
            </label>
          </div>
          <button onClick={() => agir(() => registrarInvestidura(it.member_class_id, dataInv, observacao.trim() || null))}
            disabled={ocupado || bloqueios.length > 0 || !dataInv} aria-describedby={bloqueios.length > 0 ? idBloq : undefined}
            className="w-full min-h-[44px] rounded-lg bg-gradient-to-r from-brand to-brand2 text-white py-2 text-sm font-bold shadow-glow disabled:opacity-40 disabled:shadow-none">
            {bloqueios.length > 0 ? '🔒 Registrar investidura' : '🏅 Registrar investidura'}
          </button>
        </div>
      )}
    </article>
  )
}
