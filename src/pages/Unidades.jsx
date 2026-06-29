import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { supabase } from '../lib/supabase.js'
import { carregarRanking } from '../lib/dados.js'
import { useAuth } from '../context/Auth.jsx'
import Avatar from '../components/Avatar.jsx'

const medalhas = ['🥇', '🥈', '🥉']
const PODE_GERIR = ['instrutor', 'diretoria']

export default function Unidades() {
  const { profile } = useAuth()
  const ehAdmin = PODE_GERIR.includes(profile?.papel)
  const [unidades, setUnidades] = useState([])
  const [carregando, setCarregando] = useState(true)
  const [sel, setSel] = useState(null)

  async function carregar() {
    const { unidades } = await carregarRanking()
    setUnidades(unidades)
    setCarregando(false)
  }
  useEffect(() => { carregar() }, [])

  async function novaUnidade() {
    const nome = window.prompt('Nome da nova unidade:')
    if (!nome?.trim()) return
    const { error } = await supabase.from('unidades').insert({ nome: nome.trim() })
    if (error) alert('Não foi possível criar: ' + error.message)
    else carregar()
  }

  return (
    <div>
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-extrabold text-slate-800">Unidades</h2>
          <p className="text-sm text-slate-500">Toque numa unidade para ver os membros</p>
        </div>
        {ehAdmin && (
          <motion.button whileTap={{ scale: 0.94 }} whileHover={{ scale: 1.04 }} onClick={novaUnidade}
            className="text-sm bg-azul text-white rounded-xl px-4 py-2 font-medium shadow-sm">
            + Nova
          </motion.button>
        )}
      </div>

      {carregando ? (
        <p className="text-slate-400 text-sm">Carregando...</p>
      ) : unidades.length === 0 ? (
        <div className="bg-white rounded-2xl p-8 text-center shadow-sm">
          <div className="text-4xl mb-2">🏠</div>
          <p className="font-semibold text-slate-700">Nenhuma unidade ainda</p>
          <p className="text-sm text-slate-400">{ehAdmin ? 'Toque em "+ Nova" para criar a primeira.' : 'A diretoria ainda vai cadastrar as unidades.'}</p>
        </div>
      ) : (
        <motion.div className="grid grid-cols-2 lg:grid-cols-4 gap-3"
          initial="hide" animate="show" variants={{ show: { transition: { staggerChildren: 0.08 } } }}>
          {unidades.map((u) => (
            <motion.button key={u.id} onClick={() => setSel(u)}
              variants={{ hide: { opacity: 0, y: 24, scale: 0.92 }, show: { opacity: 1, y: 0, scale: 1 } }}
              transition={{ type: 'spring', stiffness: 300, damping: 22 }}
              whileHover={{ y: -6 }} whileTap={{ scale: 0.97 }}
              className="bg-white rounded-2xl shadow-sm overflow-hidden text-left">
              <div className="h-2" style={{ backgroundColor: u.cor }} />
              <div className="p-4">
                <div className="w-11 h-11 rounded-full grid place-items-center text-white font-bold text-lg mb-2 shadow"
                  style={{ backgroundColor: u.cor }}>
                  {u.nome?.[0]?.toUpperCase()}
                </div>
                <div className="font-bold text-slate-800">{u.nome}</div>
                <div className="text-xs text-slate-400 mb-3">{u.membros.length} membros</div>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-slate-400">Média</span>
                  <span className="text-dourado font-extrabold">{u.media} pts</span>
                </div>
                <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                  <motion.div className="h-full rounded-full" style={{ backgroundColor: u.cor }}
                    initial={{ width: 0 }} animate={{ width: `${Math.min(u.media, 100)}%` }}
                    transition={{ duration: 0.8, ease: 'easeOut', delay: 0.2 }} />
                </div>
              </div>
            </motion.button>
          ))}
        </motion.div>
      )}

      <AnimatePresence>
        {sel && (
          <motion.div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-0 sm:p-6"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setSel(null)}>
            <motion.div onClick={(e) => e.stopPropagation()}
              initial={{ y: 60, opacity: 0, scale: 0.98 }} animate={{ y: 0, opacity: 1, scale: 1 }} exit={{ y: 60, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 320, damping: 30 }}
              className="bg-white w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl shadow-2xl overflow-hidden max-h-[85vh] flex flex-col">
              <div className="p-5 text-white relative" style={{ backgroundColor: sel.cor }}>
                <button onClick={() => setSel(null)} className="absolute top-4 right-4 w-8 h-8 rounded-full bg-white/20 grid place-items-center">✕</button>
                <div className="w-14 h-14 rounded-full bg-white/20 grid place-items-center text-2xl font-extrabold mb-2">{sel.nome?.[0]?.toUpperCase()}</div>
                <h3 className="text-2xl font-extrabold">{sel.nome}</h3>
                <div className="flex gap-4 mt-2 text-sm">
                  <span>👥 {sel.membros.length} membros</span>
                  <span>⭐ {sel.media} pts (média)</span>
                </div>
              </div>
              <div className="p-3 overflow-y-auto">
                <p className="text-xs font-semibold text-slate-400 px-2 mb-1">MEMBROS</p>
                {sel.membros.length === 0 ? (
                  <p className="text-sm text-slate-400 px-2 py-4 text-center">Nenhum membro aprovado nesta unidade ainda.</p>
                ) : sel.membros.map((m, i) => (
                  <div key={m.id} className="flex items-center gap-3 px-2 py-2.5 rounded-xl hover:bg-slate-50">
                    <Avatar foto={m.foto} nome={m.nome} cor={sel.cor} size="w-9 h-9" textSize="text-sm" />
                    <span className="flex-1 font-medium text-slate-800">{m.nome}</span>
                    <span className="text-lg">{medalhas[i] || ''}</span>
                    <span className="font-extrabold text-azul">{m.pts}</span>
                  </div>
                ))}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
