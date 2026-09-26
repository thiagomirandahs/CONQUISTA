import { useEffect, useState } from 'react'
import { carregarCartaoInvestidura, decidirCartaoInvestidura, urlEvidenciaCurta } from '../services/institucional.js'
import LinhaDoTempoInvestidura from './LinhaDoTempoInvestidura.jsx'

// Cartão de classe na etapa do DISTRITO/REGIÃO (portal da coordenação): o cartão completo para conferir
// (requisitos, status, quem aprovou no clube, resposta em texto e foto) + Aprovar / Devolver ao clube.
// Ao devolver, dá pra marcar QUAIS requisitos voltam para correção, com comentário em cada um.
// Tudo é conferido no servidor (investidura_cartao / coordenacao_investidura_decidir): esta tela só mostra.
const STATUS = {
  aprovado: { txt: 'Aprovado', cls: 'text-green-700' },
  aguardando_avaliacao: { txt: 'Aguardando avaliação', cls: 'text-amber-800' },
  correcao_solicitada: { txt: 'Correção solicitada', cls: 'text-red-700' },
  em_andamento: { txt: 'Em andamento', cls: 'text-muted' },
  nao_iniciado: { txt: 'Não iniciado', cls: 'text-faint' },
}
const fmt = (iso) => (iso ? new Date(iso).toLocaleDateString('pt-BR') : '')

function FotoEvidencia({ caminho }) {
  const [url, setUrl] = useState(null)
  const [erro, setErro] = useState(false)
  const [aberta, setAberta] = useState(false)
  useEffect(() => {
    let vivo = true
    urlEvidenciaCurta(caminho).then((u) => { if (vivo) setUrl(u) }).catch(() => { if (vivo) setErro(true) })
    return () => { vivo = false }
  }, [caminho])
  if (erro) return <p className="text-xs text-faint mt-1">🔒 Foto indisponível (sem acesso ou offline).</p>
  if (!url) return <p className="text-xs text-faint mt-1">Carregando foto…</p>
  if (/\.(mp4|mov|m4v|webm|3gp|3gpp)(\?|$)/i.test(caminho)) {
    return <video src={url} controls playsInline preload="metadata" className="mt-1 w-full max-h-64 rounded-lg bg-black/5" />
  }
  return (
    <>
      <button type="button" onClick={() => setAberta(true)} className="mt-1 block w-full" aria-label="Ampliar foto da comprovação">
        <img src={url} alt="comprovação" loading="lazy" className="w-full max-h-64 object-contain rounded-lg bg-black/5" />
      </button>
      {aberta && (
        <div role="dialog" aria-modal="true" aria-label="Foto da comprovação" onClick={() => setAberta(false)}
          className="fixed inset-0 z-[100] flex flex-col items-center justify-center gap-3 bg-black/90 p-3">
          <img src={url} alt="comprovação" className="max-h-[80vh] max-w-full rounded-lg object-contain" />
          <button type="button" onClick={() => setAberta(false)} className="min-h-[48px] rounded-xl bg-white px-5 py-3 text-sm font-bold text-ink">✕ Fechar</button>
        </div>
      )}
    </>
  )
}

export default function CartaoAprovacao({ memberClassId, aoDecidir, somenteLeitura = false }) {
  const [cartao, setCartao] = useState(null)
  const [erro, setErro] = useState('')
  const [modo, setModo] = useState(null)            // null | 'devolver'
  const [comentario, setComentario] = useState('')
  const [marcados, setMarcados] = useState({})      // member_requirement_id -> comentário
  const [ocupado, setOcupado] = useState(false)

  useEffect(() => {
    let vivo = true
    carregarCartaoInvestidura(memberClassId).then((c) => { if (vivo) setCartao(c) }).catch((e) => { if (vivo) setErro(e?.message || 'Erro') })
    return () => { vivo = false }
  }, [memberClassId])

  async function decidir(decisao) {
    setOcupado(true); setErro('')
    try {
      const correcoes = decisao === 'devolvido'
        ? Object.entries(marcados).map(([id, c]) => ({ member_requirement_id: id, comentario: c.trim() || null }))
        : []
      await decidirCartaoInvestidura(memberClassId, decisao, comentario.trim() || null, correcoes)
      aoDecidir?.(decisao)
    } catch (e) { setErro(e?.message || String(e)) } finally { setOcupado(false) }
  }
  const alternar = (id) => setMarcados((m) => { const n = { ...m }; if (id in n) delete n[id]; else n[id] = ''; return n })

  if (erro && !cartao) return <p role="alert" className="text-xs text-red-700 mt-2">{erro}</p>
  if (!cartao) return <p className="text-xs text-faint mt-2">Carregando o cartão…</p>

  const reqs = cartao.requisitos || []
  const nMarcados = Object.keys(marcados).length
  const devolvendo = modo === 'devolver'

  return (
    <div className="mt-2 space-y-2" data-testid="cartao-aprovacao">
      {!somenteLeitura && <LinhaDoTempoInvestidura linha={cartao.linha_do_tempo} />}
      <details className="rounded-xl border border-line bg-surface px-3 py-2" open={devolvendo || somenteLeitura}>
        <summary className="min-h-[40px] cursor-pointer text-sm font-semibold text-ink leading-[40px]">📋 Ver cartão completo ({reqs.length} requisitos)</summary>
        <ul className="mt-2 space-y-3">
          {reqs.map((r) => {
            const st = STATUS[r.status] || STATUS.em_andamento
            const marcado = r.member_requirement_id in marcados
            return (
              <li key={r.member_requirement_id} className={`rounded-lg p-2 ${marcado ? 'bg-red-50 border border-red-200' : 'bg-surface2'}`}>
                <div className="text-xs text-faint">{r.secao_codigo}{r.secao_nome ? ` · ${r.secao_nome}` : ''}</div>
                <div className="text-sm text-ink"><b>{r.codigo}</b> {r.descricao}</div>
                <div className={`text-xs mt-0.5 ${st.cls}`}>
                  {st.txt}{r.aprovacao ? ` em ${fmt(r.aprovacao.em)} por ${r.aprovacao.por_nome}` : ''}
                </div>
                {r.evidencia_texto && <p className="text-sm text-muted italic mt-1 whitespace-pre-wrap">“{r.evidencia_texto}”</p>}
                {r.evidencia_path && <FotoEvidencia key={r.evidencia_path} caminho={r.evidencia_path} />}
                {devolvendo && (
                  <div className="mt-2">
                    <label className="flex items-center gap-2 min-h-[44px] text-sm font-semibold text-red-700">
                      <input type="checkbox" className="w-5 h-5" checked={marcado} onChange={() => alternar(r.member_requirement_id)}
                        aria-label={`Pedir correção de ${r.codigo}`} />
                      Precisa de correção
                    </label>
                    {marcado && (
                      <input value={marcados[r.member_requirement_id]} placeholder="O que corrigir neste requisito (opcional)"
                        onChange={(e) => setMarcados((m) => ({ ...m, [r.member_requirement_id]: e.target.value }))}
                        aria-label={`Comentário da correção de ${r.codigo}`}
                        className="w-full min-h-[44px] text-sm rounded-lg border border-line px-3" />
                    )}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      </details>

      {!somenteLeitura && <>
      <label className="block">
        <span className="text-xs text-muted">{devolvendo ? 'Motivo da devolução (obrigatório)' : 'Comentário (opcional)'}</span>
        <textarea value={comentario} onChange={(e) => setComentario(e.target.value)} rows={2}
          className="mt-1 w-full text-sm rounded-lg border border-line px-3 py-2" />
      </label>
      {erro && <p role="alert" className="text-xs text-red-700">{erro}</p>}
      {devolvendo ? (
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => { setModo(null); setMarcados({}) }} disabled={ocupado}
            className="flex-1 min-h-[48px] rounded-xl border border-line text-sm font-semibold text-muted">Cancelar</button>
          <button type="button" onClick={() => decidir('devolvido')} disabled={ocupado || comentario.trim().length < 3}
            className="flex-1 min-h-[48px] rounded-xl border border-red-200 bg-red-50 text-sm font-bold text-red-700 disabled:opacity-40">
            ↩️ Devolver ao clube{nMarcados ? ` (${nMarcados})` : ''}
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => setModo('devolver')} disabled={ocupado}
            className="flex-1 min-h-[48px] rounded-xl border border-line text-sm font-semibold text-muted">↩️ Devolver ao clube</button>
          <button type="button" onClick={() => decidir('aprovado')} disabled={ocupado}
            className="flex-1 min-h-[48px] rounded-xl bg-green-600 hover:bg-green-700 text-white text-sm font-bold disabled:opacity-60">✅ Aprovar</button>
        </div>
      )}
      {devolvendo && <p className="text-xs text-faint">Marque os requisitos que o desbravador precisa refazer (ou nenhum, para só devolver à revisão do clube) e escreva o motivo.</p>}
      </>}
    </div>
  )
}
