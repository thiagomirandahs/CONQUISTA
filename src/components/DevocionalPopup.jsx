import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import confetti from 'canvas-confetti'
import { useAuth } from '../context/Auth.jsx'
import { carregarDevocionalPopup, fazerDevocional } from '../lib/dados.js'

export default function DevocionalPopup() {
  const { profile } = useAuth()
  const [aberto, setAberto] = useState(false)
  const [versiculo, setVersiculo] = useState(null)
  const [resposta, setResposta] = useState(null)
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState('')

  useEffect(() => {
    if (!profile?.id) return
    carregarDevocionalPopup()
      .then(({ feito, versiculo }) => {
        if (!feito && versiculo) { setVersiculo(versiculo); setAberto(true) }
      })
      .catch(() => {})
  }, [profile?.id])

  async function concluir() {
    const opcoes = versiculo?.opcoes || []
    if (opcoes.length && resposta === null) { setErro('Responda a perguntinha 🙂'); return }
    setEnviando(true)
    setErro('')
    try {
      await fazerDevocional(resposta)
      confetti({ particleCount: 120, spread: 75, origin: { y: 0.4 }, colors: ['#1e3a8a', '#f5c518', '#ffffff'] })
      setAberto(false)
    } catch (e) {
      setErro(e?.message || String(e))
      setEnviando(false)
    }
  }

  return (
    <AnimatePresence>
      {aberto && versiculo && (
        <motion.div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[60] flex items-center justify-center p-4"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <motion.div initial={{ y: 40, opacity: 0, scale: 0.97 }} animate={{ y: 0, opacity: 1, scale: 1 }} exit={{ y: 40, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 320, damping: 28 }}
            className="bg-white w-full max-w-sm rounded-3xl shadow-2xl overflow-hidden">
            <div className="p-5 text-white" style={{ background: 'linear-gradient(135deg,#1e3a8a,#4338ca)' }}>
              <div className="text-xs font-semibold opacity-90 mb-1">📖 Devocional do dia</div>
              <p className="text-[15px] leading-snug">"{versiculo.texto}"</p>
              <p className="text-[11px] opacity-80 mt-1">Leia com atenção e responda de qual livro é 👇</p>
            </div>
            <div className="p-5 space-y-4">
              {(versiculo.opcoes || []).length > 0 && (
                <div>
                  <p className="text-sm font-semibold text-slate-700 mb-2">❓ {versiculo.pergunta}</p>
                  <div className="grid grid-cols-2 gap-2">
                    {versiculo.opcoes.map((op, i) => (
                      <button key={i} type="button" onClick={() => setResposta(i)}
                        className={`rounded-xl py-2 px-2 text-sm font-semibold border transition ${resposta === i ? 'bg-azul text-white border-azul' : 'bg-white text-slate-600 border-slate-200'}`}>
                        {op}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {erro && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3">{erro}</div>}
              <div className="flex gap-2">
                <button onClick={() => setAberto(false)} className="flex-1 rounded-xl bg-slate-100 text-slate-700 font-semibold py-2.5">Depois</button>
                <motion.button onClick={concluir} disabled={enviando} whileTap={{ scale: 0.97 }}
                  className="flex-1 rounded-xl bg-azul text-white font-extrabold py-2.5 disabled:opacity-60">
                  {enviando ? '...' : '🙏 Fiz meu devocional (+5)'}
                </motion.button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
