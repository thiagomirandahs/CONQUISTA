import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useAuth } from '../context/Auth.jsx'
import { lerConfigPopup, minhaMensalidadePendente } from '../lib/dados.js'

// Hoje no fuso de Brasília (yyyy-mm-dd) — pra "não repetir hoje" bater com o dia certo
const hojeISO = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
// Assinatura curta da mensagem: se a liderança MUDAR o texto, o popup reaparece
// mesmo pra quem já tinha dispensado hoje.
const assinatura = (s) => {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return String(h)
}

// Popup de aviso ao abrir o app. A MENSAGEM é escrita pela liderança em
// Gestão → 📣 Enviar aviso. Pode ir pra todo mundo ou só pra quem está com
// mensalidade pendente. Aparece 1x por dia (e de novo se o texto mudar).
export default function AvisosPopup() {
  const { profile } = useAuth()
  const [aviso, setAviso] = useState(null)
  const [aberto, setAberto] = useState(false)

  useEffect(() => {
    if (!profile?.id) return
    let vivo = true
    ;(async () => {
      try {
        const cfg = await lerConfigPopup()
        if (!vivo || !cfg.ativo || !cfg.texto) return
        // "Só quem está devendo": confere a mensalidade da própria pessoa
        if (cfg.alvo === 'devendo') {
          const m = await minhaMensalidadePendente(profile.id)
          if (!vivo || !m) return
        }
        const chave = 'popupAviso:' + assinatura(cfg.titulo + '|' + cfg.texto)
        let visto = null
        try { visto = localStorage.getItem(chave) } catch { /* storage bloqueado */ }
        if (visto === hojeISO()) return
        setAviso({ ...cfg, chave })
        setAberto(true)
      } catch { /* sem config = sem popup */ }
    })()
    return () => { vivo = false }
  }, [profile?.id])

  function fechar() {
    try { if (aviso?.chave) localStorage.setItem(aviso.chave, hojeISO()) } catch { /* ignora */ }
    setAberto(false)
  }

  return (
    <AnimatePresence>
      {aberto && aviso && (
        <motion.div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[55] flex items-center justify-center p-4"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <motion.div initial={{ y: 40, opacity: 0, scale: 0.97 }} animate={{ y: 0, opacity: 1, scale: 1 }} exit={{ y: 40, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 320, damping: 28 }}
            className="bg-white w-full max-w-sm rounded-3xl shadow-2xl overflow-hidden">
            <div className="p-5 text-white" style={{ background: 'linear-gradient(135deg,#b45309,#f59e0b)' }}>
              <div className="text-xs font-semibold opacity-90 mb-1">📣 Aviso do clube</div>
              <p className="text-lg font-extrabold leading-tight">{aviso.titulo || 'Atenção!'}</p>
            </div>
            <div className="p-5">
              <p className="text-sm text-slate-600 whitespace-pre-line">{aviso.texto}</p>
              <button onClick={fechar} className="w-full mt-4 rounded-xl bg-azul text-white font-extrabold py-2.5">
                Entendi
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
