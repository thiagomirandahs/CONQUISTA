import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../context/Auth.jsx'

// Valores dos pontos (fácil de ajustar aqui)
const PT = { naHora: 10, atrasado: 5, faltou: 0, biblia: 20, uniforme: 10, igreja: 10, atividade: 10 }
const ADMIN = ['instrutor', 'diretoria']
const fmtData = (iso) => (iso ? iso.split('-').reverse().join('/') : '')
const marcaInicial = () => ({ presenca: 'naHora', biblia: false, uniforme: false, igreja: false, atividade: false })

function calcTotal(m) {
  if (!m || m.presenca === 'faltou') return 0
  let t = PT[m.presenca] || 0
  if (m.biblia) t += PT.biblia
  if (m.uniforme) t += PT.uniforme
  if (m.igreja) t += PT.igreja
  if (m.atividade) t += PT.atividade
  return t
}

export default function Apontamentos() {
  const { profile } = useAuth()
  const ehAdmin = ADMIN.includes(profile?.papel)
  const ehConselheiro = profile?.papel === 'conselheiro'
  const podeApontar = ehAdmin || ehConselheiro

  const [unidades, setUnidades] = useState([])
  const [unidadeId, setUnidadeId] = useState(ehConselheiro ? profile?.unidade_id || '' : '')
  const [desbravadores, setDesbravadores] = useState([])
  const [marcas, setMarcas] = useState({})
  const [data, setData] = useState(new Date().toISOString().slice(0, 10))
  const [carregando, setCarregando] = useState(false)
  const [salvando, setSalvando] = useState(false)

  useEffect(() => {
    if (ehAdmin) supabase.from('unidades').select('id,nome').order('nome').then(({ data }) => setUnidades(data || []))
  }, [ehAdmin])

  useEffect(() => {
    if (!unidadeId) { setDesbravadores([]); return }
    setCarregando(true)
    supabase.from('profiles').select('id,nome,foto').eq('unidade_id', unidadeId).eq('status', 'ativo').eq('papel', 'desbravador').order('nome')
      .then(({ data }) => {
        setDesbravadores(data || [])
        const m = {}
        ;(data || []).forEach((d) => { m[d.id] = marcaInicial() })
        setMarcas(m)
        setCarregando(false)
      })
  }, [unidadeId])

  const setMarca = (id, campo, v) => setMarcas((prev) => ({ ...prev, [id]: { ...prev[id], [campo]: v } }))

  async function salvar() {
    setSalvando(true)
    const motivo = `Reunião ${fmtData(data)}`
    for (const d of desbravadores) {
      const total = calcTotal(marcas[d.id])
      await supabase.from('pontos').delete().eq('usuario_id', d.id).eq('origem', 'apontamento').eq('motivo', motivo)
      if (total > 0) {
        await supabase.from('pontos').insert({ usuario_id: d.id, origem: 'apontamento', pontos: total, motivo, data, lancado_por: profile?.id })
      }
    }
    setSalvando(false)
    alert('Apontamentos salvos! ✅ Os pontos já entram no ranking.')
  }

  if (!podeApontar) {
    return (
      <div className="bg-white rounded-2xl p-8 text-center shadow-sm">
        <div className="text-4xl mb-2">🔒</div>
        <p className="font-semibold text-slate-700">Área dos conselheiros e liderança</p>
        <p className="text-sm text-slate-400">Aqui se lançam os pontos de presença, uniforme, Bíblia, etc.</p>
      </div>
    )
  }

  return (
    <div className="pb-4">
      <div className="mb-4">
        <h2 className="text-2xl font-extrabold text-slate-800">✍️ Apontamentos</h2>
        <p className="text-sm text-slate-500">Pontos da reunião, por desbravador</p>
      </div>

      <div className="bg-white rounded-2xl p-4 shadow-sm mb-3 grid gap-3" style={{ gridTemplateColumns: ehAdmin ? '1fr 1fr' : '1fr' }}>
        <div>
          <label className="block text-xs font-semibold text-slate-500 mb-1">Data da reunião</label>
          <input type="date" value={data} onChange={(e) => setData(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        </div>
        {ehAdmin && (
          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1">Unidade</label>
            <select value={unidadeId} onChange={(e) => setUnidadeId(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
              <option value="">Escolha...</option>
              {unidades.map((u) => <option key={u.id} value={u.id}>{u.nome}</option>)}
            </select>
          </div>
        )}
      </div>

      <div className="text-[11px] text-slate-400 mb-3 leading-relaxed">
        Na hora +{PT.naHora} · Atrasado +{PT.atrasado} · 📖 Bíblia +{PT.biblia} · 👕 Uniforme +{PT.uniforme} · ⛪ Igreja +{PT.igreja} · ⭐ Atividade +{PT.atividade} · Faltou: 0
      </div>

      {!unidadeId ? (
        <p className="text-slate-400 text-sm">{ehConselheiro ? 'Você ainda não tem uma unidade definida.' : 'Escolha uma unidade acima.'}</p>
      ) : carregando ? (
        <p className="text-slate-400 text-sm">Carregando...</p>
      ) : desbravadores.length === 0 ? (
        <p className="text-slate-400 text-sm">Nenhum desbravador aprovado nesta unidade ainda.</p>
      ) : (
        <div className="space-y-3">
          {desbravadores.map((d) => {
            const m = marcas[d.id] || marcaInicial()
            const faltou = m.presenca === 'faltou'
            return (
              <div key={d.id} className="bg-white rounded-2xl p-4 shadow-sm">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-bold text-slate-800">{d.nome}</span>
                  <span className="text-azul font-extrabold">{calcTotal(m)} pts</span>
                </div>
                <div className="flex gap-1.5 mb-2">
                  {[['naHora', 'Na hora'], ['atrasado', 'Atrasado'], ['faltou', 'Faltou']].map(([k, lbl]) => (
                    <button key={k} onClick={() => setMarca(d.id, 'presenca', k)}
                      className={`flex-1 rounded-lg py-1.5 text-xs font-semibold border ${m.presenca === k ? (k === 'faltou' ? 'bg-red-500 text-white border-red-500' : 'bg-azul text-white border-azul') : 'bg-white text-slate-500 border-slate-200'}`}>
                      {lbl}
                    </button>
                  ))}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {[['biblia', '📖 Bíblia'], ['uniforme', '👕 Uniforme'], ['igreja', '⛪ Igreja'], ['atividade', '⭐ Atividade']].map(([k, lbl]) => (
                    <button key={k} disabled={faltou} onClick={() => setMarca(d.id, k, !m[k])}
                      className={`rounded-full px-3 py-1.5 text-xs font-medium border transition ${m[k] && !faltou ? 'bg-green-500 text-white border-green-500' : 'bg-white text-slate-500 border-slate-200'} ${faltou ? 'opacity-40' : ''}`}>
                      {lbl}
                    </button>
                  ))}
                </div>
              </div>
            )
          })}

          <motion.button whileTap={{ scale: 0.97 }} onClick={salvar} disabled={salvando}
            className="w-full bg-azul text-white font-bold rounded-xl py-3 shadow disabled:opacity-60">
            {salvando ? 'Salvando...' : '💾 Salvar apontamentos'}
          </motion.button>
        </div>
      )}
    </div>
  )
}
