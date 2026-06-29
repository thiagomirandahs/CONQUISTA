import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../context/Auth.jsx'
import { CARGOS_LIDERANCA } from '../lib/cargos.js'

const ADMIN = ['diretoria', 'instrutor']
const fmtData = (iso) => (iso ? iso.split('-').reverse().join('/') : '—')
const ehLideranca = (cargo) => CARGOS_LIDERANCA.includes(cargo)

export default function Aprovacoes() {
  const { profile } = useAuth()
  const ehAdmin = ADMIN.includes(profile?.papel)
  const [pendentes, setPendentes] = useState([])
  const [carregando, setCarregando] = useState(true)

  async function carregar() {
    setCarregando(true)
    const { data } = await supabase
      .from('profiles')
      .select('id,nome,nascimento,unidade_id,cargo,unidades(nome)')
      .eq('status', 'pendente')
      .order('created_at', { ascending: true })
    setPendentes(data || [])
    setCarregando(false)
  }

  useEffect(() => {
    if (ehAdmin) carregar()
    else setCarregando(false)
  }, [ehAdmin])

  async function decidir(id, novoStatus) {
    setPendentes((p) => p.filter((x) => x.id !== id)) // some da lista na hora
    await supabase.from('profiles').update({ status: novoStatus }).eq('id', id)
  }

  if (!ehAdmin) {
    return (
      <div className="bg-white rounded-2xl p-8 text-center shadow-sm">
        <div className="text-4xl mb-2">🔒</div>
        <p className="font-semibold text-slate-700">Área restrita</p>
        <p className="text-sm text-slate-400">Apenas a diretoria e instrutores podem aprovar cadastros.</p>
      </div>
    )
  }

  return (
    <div>
      <div className="mb-5">
        <h2 className="text-2xl font-extrabold text-slate-800">✅ Aprovações</h2>
        <p className="text-sm text-slate-500">Novos cadastros aguardando liberação</p>
      </div>

      {carregando ? (
        <p className="text-slate-400 text-sm">Carregando...</p>
      ) : pendentes.length === 0 ? (
        <div className="bg-white rounded-2xl p-8 text-center shadow-sm">
          <div className="text-4xl mb-2">🎉</div>
          <p className="font-semibold text-slate-700">Tudo em dia!</p>
          <p className="text-sm text-slate-400">Nenhum cadastro pendente no momento.</p>
        </div>
      ) : (
        <div className="space-y-3">
          <AnimatePresence>
            {pendentes.map((p) => (
              <motion.div key={p.id} layout
                initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, x: -50 }}
                className="bg-white rounded-2xl p-4 shadow-sm flex items-center gap-3">
                <div className="w-11 h-11 rounded-full bg-azul/10 text-azul grid place-items-center font-extrabold shrink-0">
                  {p.nome?.[0]?.toUpperCase() || '?'}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-bold text-slate-800 truncate">{p.nome || 'Sem nome'}</div>
                  <div className="text-xs text-slate-400">
                    {p.unidades?.nome ? `🏠 ${p.unidades.nome}` : 'Sem unidade'} · 🎂 {fmtData(p.nascimento)}
                  </div>
                  {p.cargo && (
                    <span className={`inline-block mt-1 text-[11px] font-semibold rounded-full px-2 py-0.5 ${ehLideranca(p.cargo) ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-500'}`}>
                      {ehLideranca(p.cargo) ? '⭐ ' : ''}{p.cargo}
                    </span>
                  )}
                </div>
                <motion.button whileTap={{ scale: 0.9 }} onClick={() => decidir(p.id, 'rejeitado')}
                  className="text-xs rounded-lg px-3 py-2 border border-slate-200 text-slate-500 hover:bg-slate-50 shrink-0">Recusar</motion.button>
                <motion.button whileTap={{ scale: 0.9 }} onClick={() => decidir(p.id, 'ativo')}
                  className="text-xs rounded-lg px-3 py-2 bg-azul text-white font-semibold hover:bg-azul-claro shrink-0">Aprovar</motion.button>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}
    </div>
  )
}
