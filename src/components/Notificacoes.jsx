import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { useAuth } from '../context/Auth.jsx'
import { carregarNotificacoes, marcarNotificacoesVistas } from '../lib/dados.js'

const iconePorTipo = { pontos: '🏆', atividade: '📋', cadastro: '👤', foto: '📸', geral: '📣' }

function tempoRel(iso) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000
  if (s < 60) return 'agora'
  if (s < 3600) return Math.floor(s / 60) + ' min'
  if (s < 86400) return Math.floor(s / 3600) + ' h'
  return Math.floor(s / 86400) + ' d'
}

export default function Notificacoes() {
  const { profile } = useAuth()
  const navigate = useNavigate()
  const [aberto, setAberto] = useState(false)
  const [lista, setLista] = useState([])
  const [vistoEm, setVistoEm] = useState(null)

  useEffect(() => {
    if (!profile?.id) return
    setVistoEm(profile.notif_visto_em || null)
    carregarNotificacoes().then(setLista)
  }, [profile?.id, profile?.notif_visto_em])

  const naoLidas = lista.filter((n) => !vistoEm || n.created_at > vistoEm).length

  async function abrir() {
    const fresh = await carregarNotificacoes()
    setLista(fresh)
    setAberto(true)
    if (profile?.id && fresh.some((n) => !vistoEm || n.created_at > vistoEm)) {
      await marcarNotificacoesVistas(profile.id)
      setVistoEm(new Date().toISOString())
    }
  }

  function abrirItem(n) {
    setAberto(false)
    if (n.link) navigate(n.link)
  }

  return (
    <>
      <button onClick={abrir} aria-label="Notificações" className="relative grid place-items-center">
        <span className="text-xl">🔔</span>
        {naoLidas > 0 && (
          <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold grid place-items-center ring-2 ring-azul">
            {naoLidas > 9 ? '9+' : naoLidas}
          </span>
        )}
      </button>

      <AnimatePresence>
        {aberto && (
          <motion.div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-start justify-center p-4 pt-16 sm:pt-20"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setAberto(false)}>
            <motion.div onClick={(e) => e.stopPropagation()}
              initial={{ y: -20, opacity: 0, scale: 0.98 }} animate={{ y: 0, opacity: 1, scale: 1 }} exit={{ y: -20, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 320, damping: 28 }}
              className="bg-white w-full max-w-sm rounded-2xl shadow-2xl overflow-hidden max-h-[75vh] flex flex-col">
              <div className="px-4 py-3 bg-azul text-white flex items-center justify-between">
                <span className="font-extrabold">🔔 Notificações</span>
                <button onClick={() => setAberto(false)} className="w-7 h-7 rounded-full bg-white/20 grid place-items-center text-sm">✕</button>
              </div>
              <div className="overflow-y-auto">
                {lista.length === 0 ? (
                  <div className="p-8 text-center text-slate-400 text-sm">
                    <div className="text-3xl mb-2">🔕</div>
                    Nenhuma notificação ainda.
                  </div>
                ) : lista.map((n) => {
                  const nova = !vistoEm || n.created_at > vistoEm
                  return (
                    <button key={n.id} onClick={() => abrirItem(n)}
                      className={`w-full flex gap-3 px-4 py-3 text-left border-b border-slate-100 last:border-0 hover:bg-slate-50 ${nova ? 'bg-azul/5' : ''}`}>
                      <span className="text-xl shrink-0">{iconePorTipo[n.tipo] || '🔔'}</span>
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold text-slate-800 text-sm">{n.titulo}</div>
                        {n.corpo && <div className="text-xs text-slate-500 line-clamp-2">{n.corpo}</div>}
                        <div className="text-[10px] text-slate-400 mt-0.5">{tempoRel(n.created_at)}</div>
                      </div>
                      {nova && <span className="w-2 h-2 rounded-full bg-red-500 shrink-0 mt-1.5" />}
                    </button>
                  )
                })}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
