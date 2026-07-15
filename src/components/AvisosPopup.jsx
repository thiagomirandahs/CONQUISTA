import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useAuth } from '../context/Auth.jsx'
import { minhaMensalidadePendente } from '../lib/dados.js'

const MESES = ['', 'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']
// Hoje no fuso de Brasília (yyyy-mm-dd) — pra "não repetir hoje" bater com o dia certo
const hojeISO = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })

// Popup de avisos ao abrir o app. Hoje avisa MENSALIDADE pendente (cobrança);
// mostra 1x por dia (após dispensar) e volta amanhã enquanto estiver pendente.
// Some sozinho quando a tesouraria marca como paga. Fica com z-index abaixo do
// popup do devocional, então se os dois abrirem, o devocional aparece na frente.
export default function AvisosPopup() {
  const { profile } = useAuth()
  const [mens, setMens] = useState(null)
  const [aberto, setAberto] = useState(false)

  useEffect(() => {
    if (!profile?.id) return
    let visto = null
    try { visto = localStorage.getItem('popupMensalidadeVisto') } catch { /* storage bloqueado */ }
    if (visto === hojeISO()) return // já vi hoje
    let vivo = true
    minhaMensalidadePendente(profile.id)
      .then((m) => { if (vivo && m) { setMens(m); setAberto(true) } })
      .catch(() => {})
    return () => { vivo = false }
  }, [profile?.id])

  function fechar() {
    try { localStorage.setItem('popupMensalidadeVisto', hojeISO()) } catch { /* modo anônimo */ }
    setAberto(false)
  }

  return (
    <AnimatePresence>
      {aberto && mens && (
        <motion.div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[55] flex items-center justify-center p-4"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <motion.div initial={{ y: 40, opacity: 0, scale: 0.97 }} animate={{ y: 0, opacity: 1, scale: 1 }} exit={{ y: 40, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 320, damping: 28 }}
            className="bg-white w-full max-w-sm rounded-3xl shadow-2xl overflow-hidden">
            <div className="p-5 text-white" style={{ background: 'linear-gradient(135deg,#b45309,#f59e0b)' }}>
              <div className="text-xs font-semibold opacity-90 mb-1">💰 Lembrete de mensalidade</div>
              <p className="text-lg font-extrabold leading-tight">
                {mens.quantas > 1
                  ? `Você tem ${mens.quantas} mensalidades pendentes`
                  : `Mensalidade de ${MESES[mens.mes] || ('mês ' + mens.mes)} pendente`}
              </p>
              {mens.valor > 0 && (
                <p className="text-sm text-white/90 mt-0.5">Valor: R$ {Number(mens.valor).toFixed(2)}</p>
              )}
            </div>
            <div className="p-5">
              <p className="text-sm text-slate-600">Avise seus pais/responsável pra acertar com a tesouraria do clube. 🙂</p>
              <div className="flex gap-2 mt-4">
                <button onClick={fechar} className="flex-1 rounded-xl bg-slate-100 text-slate-700 font-semibold py-2.5">Depois</button>
                <button onClick={fechar} className="flex-1 rounded-xl bg-azul text-white font-extrabold py-2.5">Ok, vou avisar</button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
