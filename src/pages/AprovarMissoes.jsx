import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useAuth } from '../context/Auth.jsx'
import { carregarMissoesPendentes, avaliarMissao } from '../lib/dados.js'

const PODE_GERIR = ['instrutor', 'diretoria']
const fmtData = (iso) => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '')

export default function AprovarMissoes() {
  const { profile } = useAuth()
  const ehAdmin = PODE_GERIR.includes(profile?.papel)
  const [lista, setLista] = useState([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState('')
  const [ampliar, setAmpliar] = useState(null)

  useEffect(() => {
    if (!ehAdmin) { setCarregando(false); return }
    carregarMissoesPendentes()
      .then((d) => { setLista(d); setCarregando(false) })
      .catch((e) => { setErro(e?.message || 'Erro'); setCarregando(false) })
  }, [ehAdmin])

  if (!ehAdmin) {
    return (
      <div className="bg-white rounded-2xl p-8 text-center shadow-sm">
        <div className="text-4xl mb-2">🔒</div>
        <p className="font-semibold text-slate-700">Área da diretoria</p>
        <p className="text-sm text-slate-400">Apenas diretoria/instrutor aprovam missões.</p>
      </div>
    )
  }

  async function avaliar(m, aprovar) {
    try {
      await avaliarMissao(m.id, aprovar)
      setLista((l) => l.filter((x) => x.id !== m.id))
    } catch (e) {
      alert('Erro: ' + (e?.message || e))
    }
  }

  return (
    <div>
      <div className="mb-4">
        <h2 className="text-2xl font-extrabold text-slate-800">🎯 Aprovar missões</h2>
        <p className="text-sm text-slate-500">Missões de foto aguardando sua aprovação</p>
      </div>

      {carregando ? (
        <p className="text-slate-400 text-sm">Carregando...</p>
      ) : erro ? (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5 text-sm text-amber-800">
          <p className="font-semibold mb-1">Não consegui carregar</p>
          <p className="text-xs mb-1">{erro}</p>
          <p className="text-xs">Se a página é nova, rode <code className="bg-amber-100 rounded px-1">supabase/2026-06-30-devocional-popup.sql</code> no Supabase (é ele que cria a tabela missoes_feitas e a função de aprovação).</p>
        </div>
      ) : lista.length === 0 ? (
        <div className="bg-white rounded-2xl p-8 text-center shadow-sm">
          <div className="text-4xl mb-2">🎉</div>
          <p className="font-semibold text-slate-700">Nada pra aprovar!</p>
          <p className="text-sm text-slate-400">As missões de foto pendentes aparecem aqui.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {lista.map((m) => (
            <div key={m.id} className="bg-white rounded-2xl p-4 shadow-sm">
              <div className="flex items-center justify-between gap-2 mb-2">
                <div className="font-bold text-slate-800 truncate">{m.nome || 'Desbravador'}</div>
                <span className="text-xs text-slate-400 shrink-0">{fmtData(m.data)}</span>
              </div>
              {m.foto_url && (
                <button onClick={() => setAmpliar(m.foto_url)} className="block w-full">
                  <img src={m.foto_url} alt="missão" loading="lazy" className="w-full max-h-64 object-cover rounded-lg" />
                </button>
              )}
              <div className="flex gap-2 mt-3">
                <button onClick={() => avaliar(m, false)} className="flex-1 rounded-lg border border-slate-300 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50">Reprovar</button>
                <button onClick={() => avaliar(m, true)} className="flex-1 rounded-lg bg-green-600 hover:bg-green-700 text-white py-2 text-sm font-semibold">✅ Aprovar (+10)</button>
              </div>
            </div>
          ))}
        </div>
      )}

      <AnimatePresence>
        {ampliar && (
          <motion.div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setAmpliar(null)}>
            <img src={ampliar} alt="missão" className="max-w-full max-h-[85vh] rounded-xl object-contain shadow-2xl" />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
