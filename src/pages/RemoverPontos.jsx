import { useState, useEffect } from 'react'
import { useAuth } from '../context/Auth.jsx'
import { carregarLancamentos, removerLancamento } from '../lib/dados.js'

const PODE_GERIR = ['instrutor', 'diretoria']
const iconeOrigem = { apontamento: '✍️', atividade: '📋', unidade: '🛡️', devocional: '📖', missao: '🎯', trilha: '🗺️' }
const fmtData = (iso) => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '')

export default function RemoverPontos() {
  const { profile } = useAuth()
  const ehAdmin = PODE_GERIR.includes(profile?.papel)
  const [lista, setLista] = useState([])
  const [carregando, setCarregando] = useState(true)
  const [busca, setBusca] = useState('')
  const [tipo, setTipo] = useState('todos') // todos | individual | unidade
  const [removendo, setRemovendo] = useState(null)

  useEffect(() => {
    if (!ehAdmin) { setCarregando(false); return }
    carregarLancamentos().then((d) => { setLista(d); setCarregando(false) })
  }, [ehAdmin])

  if (!ehAdmin) {
    return (
      <div className="bg-white rounded-2xl p-8 text-center shadow-sm">
        <div className="text-4xl mb-2">🔒</div>
        <p className="font-semibold text-slate-700">Área da diretoria</p>
        <p className="text-sm text-slate-400">Apenas diretoria/instrutor podem remover pontos.</p>
      </div>
    )
  }

  const nomeDe = (p) => (p.unidade_id ? (p.unidade?.nome || 'Unidade') : (p.pessoa?.nome || 'Desbravador'))
  const filtrada = lista.filter((p) => {
    if (tipo === 'individual' && p.unidade_id) return false
    if (tipo === 'unidade' && !p.unidade_id) return false
    return nomeDe(p).toLowerCase().includes(busca.toLowerCase())
  })

  async function remover(p) {
    if (!window.confirm(`Remover ${p.pontos} pts de ${nomeDe(p)}${p.motivo ? ` (${p.motivo})` : ''}?`)) return
    setRemovendo(p.id)
    try {
      await removerLancamento(p.id)
      setLista((l) => l.filter((x) => x.id !== p.id))
    } catch (e) {
      alert('Não foi possível remover: ' + (e?.message || e))
    }
    setRemovendo(null)
  }

  return (
    <div>
      <div className="mb-4">
        <h2 className="text-2xl font-extrabold text-slate-800">➖ Remover pontos</h2>
        <p className="text-sm text-slate-500">Apague lançamentos errados (individual ou de unidade)</p>
      </div>

      <div className="flex gap-2 mb-3">
        {[['todos', 'Todos'], ['individual', '🧒 Individual'], ['unidade', '🛡️ Unidade']].map(([k, lbl]) => (
          <button key={k} onClick={() => setTipo(k)}
            className={`text-sm rounded-full px-3 py-1.5 font-semibold border transition ${tipo === k ? 'bg-azul text-white border-azul' : 'bg-white text-slate-600 border-slate-200'}`}>{lbl}</button>
        ))}
      </div>
      <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="🔎 Buscar por nome..."
        className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm mb-3 outline-none focus:border-azul-claro focus:ring-2 focus:ring-azul-claro/30" />

      {carregando ? (
        <p className="text-slate-400 text-sm">Carregando...</p>
      ) : filtrada.length === 0 ? (
        <p className="text-slate-400 text-sm">Nenhum lançamento encontrado.</p>
      ) : (
        <div className="bg-white rounded-2xl shadow-sm divide-y divide-slate-100">
          {filtrada.map((p) => (
            <div key={p.id} className="flex items-center gap-3 px-3 py-2.5">
              <span className="text-xl shrink-0">{iconeOrigem[p.origem] || '⭐'}</span>
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-slate-800 text-sm truncate">
                  {p.unidade_id ? '🛡️ ' : ''}{nomeDe(p)}
                </div>
                <div className="text-[11px] text-slate-400 truncate">{p.motivo || p.origem} · {fmtData(p.data)}</div>
              </div>
              <span className={`font-extrabold shrink-0 ${p.pontos < 0 ? 'text-red-500' : 'text-azul'}`}>{p.pontos > 0 ? '+' : ''}{p.pontos}</span>
              <button onClick={() => remover(p)} disabled={removendo === p.id}
                className="text-red-600 bg-red-50 hover:bg-red-100 rounded-lg px-3 py-2 font-semibold shrink-0 disabled:opacity-50" aria-label="Remover">
                🗑️
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
