import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { useAuth } from '../context/Auth.jsx'
import { carregarUnidadesCompetidoras, lancarColocacaoAcampamento, carregarHistoricoAcampamento } from '../lib/dados.js'
import { vitoria as festa } from '../lib/juice.js'

const PODE_GERIR = ['instrutor', 'diretoria']
const inputClass =
  'w-full rounded-lg border border-line bg-surface2 px-3 py-2 text-ink outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/30 placeholder:text-faint'
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

  // Ajuste avulso: tirar (penalidade) ou dar pontos direto pra uma unidade
  const [ajusteUni, setAjusteUni] = useState('')
  const [ajusteVal, setAjusteVal] = useState('')
  const [ajusteMotivo, setAjusteMotivo] = useState('')
  const [ajusteSinal, setAjusteSinal] = useState('tirar') // 'tirar' | 'dar'
  const [enviandoAjuste, setEnviandoAjuste] = useState(false)
  const [msgAjuste, setMsgAjuste] = useState('')

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
      <div className="bg-surface rounded-2xl p-8 text-center shadow-soft">
        <div className="text-4xl mb-2">🔒</div>
        <p className="font-semibold text-ink">Só a liderança</p>
        <p className="text-sm text-faint">Lançar pontuação do acampamento é uma ação da diretoria/instrutor.</p>
      </div>
    )
  }

  if (carregando) return <p className="text-faint text-sm">Carregando...</p>

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

  // Tira (penalidade) ou dá pontos avulsos direto pra uma unidade. Reusa a
  // função do acampamento (item com posicao nula aceita valor negativo) — assim
  // o lançamento aparece no mesmo histórico e conta no ranking geral.
  async function enviarAjuste() {
    setMsgAjuste('')
    if (!ajusteUni) { setMsgAjuste('Escolha a unidade.'); return }
    const n = Math.abs(parseInt(ajusteVal, 10))
    if (!n) { setMsgAjuste('Digite quantos pontos.'); return }
    const pontos = ajusteSinal === 'tirar' ? -n : n
    const motivo = ajusteMotivo.trim() || (ajusteSinal === 'tirar' ? 'Penalidade' : 'Bônus')
    setEnviandoAjuste(true)
    try {
      await lancarColocacaoAcampamento(motivo, [{ unidade_id: ajusteUni, posicao: null, pontos }])
      festa(2)
      const nomeU = unidades.find((u) => u.id === ajusteUni)?.nome || 'a unidade'
      setMsgAjuste(`✅ ${ajusteSinal === 'tirar' ? 'Tirados' : 'Dados'} ${n} pts ${ajusteSinal === 'tirar' ? 'de' : 'pra'} ${nomeU}.`)
      setAjusteUni(''); setAjusteVal(''); setAjusteMotivo('')
      carregar()
    } catch (e) { setMsgAjuste('❌ ' + (e?.message || String(e))) }
    setEnviandoAjuste(false)
  }

  return (
    <div>
      <div className="mb-4">
        <h2 className="text-2xl font-extrabold text-ink">🏕️ Modo Acampamento</h2>
        <p className="text-sm text-muted">Lance a colocação das unidades em cada prova/atividade — pode usar quantas vezes quiser.</p>
      </div>

      <div className="bg-surface rounded-2xl p-4 shadow-soft mb-4">
        <label className="block text-sm font-semibold text-ink mb-1">Atividade (opcional)</label>
        <input value={atividade} onChange={(e) => setAtividade(e.target.value)} placeholder="ex.: Corrida de saco, prova de nó..." className={inputClass} />

        <p className="text-sm font-semibold text-ink mb-2 mt-4">Pontos por colocação</p>
        <div className="grid grid-cols-4 gap-2">
          {COLOCACOES.map((pos) => (
            <div key={pos}>
              <label className="text-[11px] text-faint">{pos}º lugar</label>
              <input type="number" min={0} value={pontosPorColocacao[pos]}
                onChange={(e) => setPontosPorColocacao((m) => ({ ...m, [pos]: Number(e.target.value) || 0 }))}
                className={inputClass} />
            </div>
          ))}
        </div>

        <p className="text-sm font-semibold text-ink mb-2 mt-5">Quem ficou em cada colocação?</p>
        {unidades.length === 0 ? (
          <p className="text-sm text-faint">Nenhuma unidade com desbravador/conselheiro cadastrado.</p>
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
                          escolhida(u.id, pos) ? 'bg-gold text-white' : ocupadaPorOutro ? 'bg-surface2 text-faint' : 'bg-surface2 text-muted'
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
          className="mt-4 w-full bg-gradient-to-r from-brand to-brand2 shadow-glow text-white font-extrabold rounded-xl py-3 disabled:opacity-60">
          {enviando ? '...' : '🏆 Lançar colocação'}
        </motion.button>
      </div>

      {/* Tirar / dar pontos avulsos (penalidade ou bônus) direto pra uma unidade */}
      <div className="bg-surface rounded-2xl p-4 shadow-soft mb-4">
        <p className="text-sm font-extrabold text-ink mb-1">⚖️ Tirar / dar pontos de uma unidade</p>
        <p className="text-xs text-faint mb-3">Penalidade ou bônus direto pra uma unidade, fora da colocação (ex.: tirar por bagunça).</p>

        <div className="flex gap-1.5 mb-3">
          <button type="button" onClick={() => setAjusteSinal('tirar')}
            className={`flex-1 rounded-lg py-2 text-sm font-bold transition ${ajusteSinal === 'tirar' ? 'bg-red-500 text-white' : 'bg-surface2 text-muted'}`}>
            ➖ Tirar
          </button>
          <button type="button" onClick={() => setAjusteSinal('dar')}
            className={`flex-1 rounded-lg py-2 text-sm font-bold transition ${ajusteSinal === 'dar' ? 'bg-green-600 text-white' : 'bg-surface2 text-muted'}`}>
            ➕ Dar
          </button>
        </div>

        <label className="block text-[11px] text-faint mb-1">Unidade</label>
        <select value={ajusteUni} onChange={(e) => setAjusteUni(e.target.value)} className={`${inputClass} mb-2`}>
          <option value="">Escolha a unidade…</option>
          {unidades.map((u) => <option key={u.id} value={u.id}>{u.nome}</option>)}
        </select>

        <label className="block text-[11px] text-faint mb-1">Pontos {ajusteSinal === 'tirar' ? 'a tirar' : 'a dar'}</label>
        <input type="number" min={1} value={ajusteVal} onChange={(e) => setAjusteVal(e.target.value)} placeholder="ex.: 50" className={`${inputClass} mb-2`} />

        <label className="block text-[11px] text-faint mb-1">Motivo (opcional)</label>
        <input value={ajusteMotivo} onChange={(e) => setAjusteMotivo(e.target.value)}
          placeholder={ajusteSinal === 'tirar' ? 'ex.: bagunça no alojamento' : 'ex.: ajuda extra'} className={inputClass} />

        {msgAjuste && <p className="text-sm mt-3 font-semibold">{msgAjuste}</p>}

        <motion.button whileTap={{ scale: 0.97 }} disabled={enviandoAjuste} onClick={enviarAjuste}
          className={`mt-3 w-full text-white font-extrabold rounded-xl py-3 disabled:opacity-60 ${ajusteSinal === 'tirar' ? 'bg-red-500' : 'bg-green-600'}`}>
          {enviandoAjuste ? '...' : ajusteSinal === 'tirar' ? '➖ Tirar pontos' : '➕ Dar pontos'}
        </motion.button>
      </div>

      {historico.length > 0 && (
        <div>
          <h3 className="font-extrabold text-ink mb-2 text-sm">📋 Últimos lançamentos</h3>
          <div className="bg-surface rounded-2xl shadow-soft divide-y divide-line">
            {historico.map((h) => (
              <div key={h.id} className="flex items-center gap-3 px-3 py-2.5">
                <span className="text-xs font-bold px-2 py-1 rounded text-white shrink-0" style={{ background: h.unidade.cor || '#1e3a8a' }}>
                  {h.unidade.nome}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-ink truncate">{h.motivo}</div>
                  <div className="text-[11px] text-faint">{fmtData(h.data)}</div>
                </div>
                <span className={`font-extrabold shrink-0 ${h.pontos < 0 ? 'text-red-600' : 'text-brand'}`}>
                  {h.pontos > 0 ? '+' : ''}{h.pontos}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
