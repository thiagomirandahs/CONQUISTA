import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { useAuth } from '../context/Auth.jsx'
import { carregarUnidadesCompetidoras, lancarColocacaoAcampamento, carregarHistoricoAcampamento } from '../lib/dados.js'
import { vitoria as festa } from '../lib/juice.js'

const PODE_GERIR = ['instrutor', 'diretoria']
const inputClass =
  'w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 outline-none transition focus:border-azul-claro focus:ring-2 focus:ring-azul-claro/30'
const COLOCACOES = [1, 2, 3, 4]
const PONTOS_PADRAO = { 1: 300, 2: 200, 3: 100, 4: 50 }
const fmtData = (iso) => {
  const d = new Date(iso)
  return d.toLocaleDateString('pt-BR') + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}

export default function ModoAcampamento() {
  const { profile } = useAuth()
  const ehAdmin = PODE_GERIR.includes(profile?.papel)

  const [unidades, setUnidades] = useState([])
  const [historico, setHistorico] = useState([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState('')

  const [atividade, setAtividade] = useState('')
  const [pontosPorColocacao, setPontosPorColocacao] = useState(PONTOS_PADRAO)
  const [colocacaoDe, setColocacaoDe] = useState({}) // { unidade_id: posicao }
  const [enviando, setEnviando] = useState(false)
  const [msg, setMsg] = useState('')

  async function carregar() {
    setCarregando(true); setErro('')
    try {
      const [us, hist] = await Promise.all([carregarUnidadesCompetidoras(), carregarHistoricoAcampamento()])
      setUnidades(us)
      setHistorico(hist)
    } catch (e) { setErro(e?.message || 'Erro') }
    setCarregando(false)
  }
  useEffect(() => { if (ehAdmin) carregar() }, [ehAdmin]) // eslint-disable-line

  if (!ehAdmin) {
    return (
      <div className="bg-white rounded-2xl p-8 text-center shadow-sm">
        <div className="text-4xl mb-2">🔒</div>
        <p className="font-semibold text-slate-700">Só a liderança</p>
        <p className="text-sm text-slate-400">Lançar pontuação do acampamento é uma ação da diretoria/instrutor.</p>
      </div>
    )
  }

  if (carregando) return <p className="text-slate-400 text-sm">Carregando...</p>

  if (erro) {
    const faltaSQL = /does not exist|schema cache|could not find the (table|relation)/i.test(erro)
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 text-sm text-amber-800">
        {faltaSQL ? (
          <>
            <p className="font-semibold mb-1">Modo Acampamento ainda não configurado</p>
            <p className="text-xs">Rode <code className="bg-amber-100 rounded px-1">supabase/2026-08-24-modo-acampamento.sql</code> no Supabase.</p>
          </>
        ) : (
          <>
            <p className="font-semibold mb-1">Não deu pra carregar</p>
            <p className="text-xs mb-3">{erro}</p>
            <button onClick={carregar} className="bg-amber-600 text-white font-bold rounded-xl px-4 py-2 text-xs">Tentar de novo</button>
          </>
        )}
      </div>
    )
  }

  // Quem já está em qual colocação (pra impedir 2 unidades na mesma)
  const colocacoesUsadas = Object.values(colocacaoDe).filter(Boolean)
  const escolhida = (unidadeId, posicao) => colocacaoDe[unidadeId] === posicao

  function escolher(unidadeId, posicao) {
    setColocacaoDe((m) => {
      const atual = { ...m }
      if (atual[unidadeId] === posicao) { delete atual[unidadeId]; return atual } // toca de novo = desmarca
      // Ninguém mais pode ficar nessa colocação
      for (const uid of Object.keys(atual)) if (atual[uid] === posicao) delete atual[uid]
      atual[unidadeId] = posicao
      return atual
    })
  }

  async function lancar() {
    setMsg('')
    const itens = unidades
      .map((u) => ({ unidade_id: u.id, posicao: colocacaoDe[u.id] || null, pontos: colocacaoDe[u.id] ? (pontosPorColocacao[colocacaoDe[u.id]] || 0) : 0 }))
      .filter((i) => i.posicao)
    if (itens.length === 0) { setMsg('Marque ao menos uma colocação.'); return }
    setEnviando(true)
    try {
      await lancarColocacaoAcampamento(atividade, itens)
      festa(3)
      setMsg(`✅ Lançado! ${itens.length} unidade${itens.length > 1 ? 's' : ''} pontuou${itens.length > 1 ? 'ram' : ''}.`)
      setColocacaoDe({})
      setAtividade('')
      carregar()
    } catch (e) { setMsg('❌ ' + (e?.message || String(e))) }
    setEnviando(false)
  }

  return (
    <div>
      <div className="mb-4">
        <h2 className="text-2xl font-extrabold text-slate-800">🏕️ Modo Acampamento</h2>
        <p className="text-sm text-slate-500">Lance a colocação das unidades em cada prova/atividade — pode usar quantas vezes quiser.</p>
      </div>

      <div className="bg-white rounded-2xl p-4 shadow-sm mb-4">
        <label className="block text-sm font-semibold text-slate-700 mb-1">Atividade (opcional)</label>
        <input value={atividade} onChange={(e) => setAtividade(e.target.value)} placeholder="ex.: Corrida de saco, prova de nó..." className={inputClass} />

        <p className="text-sm font-semibold text-slate-700 mb-2 mt-4">Pontos por colocação</p>
        <div className="grid grid-cols-4 gap-2">
          {COLOCACOES.map((pos) => (
            <div key={pos}>
              <label className="text-[11px] text-slate-400">{pos}º lugar</label>
              <input type="number" min={0} value={pontosPorColocacao[pos]}
                onChange={(e) => setPontosPorColocacao((m) => ({ ...m, [pos]: Number(e.target.value) || 0 }))}
                className={inputClass} />
            </div>
          ))}
        </div>

        <p className="text-sm font-semibold text-slate-700 mb-2 mt-5">Quem ficou em cada colocação?</p>
        {unidades.length === 0 ? (
          <p className="text-sm text-slate-400">Nenhuma unidade com desbravador/conselheiro cadastrado.</p>
        ) : (
          <div className="space-y-2">
            {unidades.map((u) => (
              <div key={u.id} className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-bold px-2.5 py-1.5 rounded-lg text-white shrink-0" style={{ background: u.cor || '#1e3a8a' }}>
                  {u.nome}
                </span>
                <div className="flex gap-1.5">
                  {COLOCACOES.map((pos) => {
                    const ocupadaPorOutro = colocacoesUsadas.includes(pos) && !escolhida(u.id, pos)
                    return (
                      <motion.button key={pos} type="button" whileTap={{ scale: 0.95 }}
                        disabled={ocupadaPorOutro}
                        onClick={() => escolher(u.id, pos)}
                        className={`w-9 h-9 rounded-lg text-sm font-extrabold transition ${
                          escolhida(u.id, pos) ? 'bg-dourado text-white' : ocupadaPorOutro ? 'bg-slate-100 text-slate-300' : 'bg-slate-100 text-slate-500'
                        }`}>
                        {pos}º
                      </motion.button>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        )}

        {msg && <p className="text-sm mt-4 font-semibold">{msg}</p>}

        <motion.button whileTap={{ scale: 0.97 }} disabled={enviando} onClick={lancar}
          className="mt-4 w-full bg-azul text-white font-extrabold rounded-xl py-3 disabled:opacity-60">
          {enviando ? '...' : '🏆 Lançar colocação'}
        </motion.button>
      </div>

      {historico.length > 0 && (
        <div>
          <h3 className="font-extrabold text-slate-800 mb-2 text-sm">📋 Últimos lançamentos</h3>
          <div className="bg-white rounded-2xl shadow-sm divide-y divide-slate-100">
            {historico.map((h) => (
              <div key={h.id} className="flex items-center gap-3 px-3 py-2.5">
                <span className="text-xs font-bold px-2 py-1 rounded text-white shrink-0" style={{ background: h.unidade.cor || '#1e3a8a' }}>
                  {h.unidade.nome}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-slate-700 truncate">{h.motivo}</div>
                  <div className="text-[11px] text-slate-400">{fmtData(h.data)}</div>
                </div>
                <span className="font-extrabold text-azul shrink-0">+{h.pontos}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
