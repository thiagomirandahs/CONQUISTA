// Overlay único que dá o "feedback visual" dos jogos: escuta o evento 'juicefx'
// (disparado por juice.acerto()/erro()/vitoria()) e mostra faíscas no acerto ou
// um flash vermelho no erro. Fica montado UMA vez na página de Jogos, cobre a
// tela sem capturar toque (pointer-events:none) e some sozinho.
import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

export default function FeedbackJogo() {
  const [fx, setFx] = useState(null)
  useEffect(() => {
    const aoSinal = (e) => {
      const id = Date.now() + Math.random()
      const tipo = e.detail?.tipo || 'acerto'
      setFx({ tipo, id })
      setTimeout(() => setFx((f) => (f && f.id === id ? null : f)), tipo === 'erro' ? 520 : 820)
    }
    window.addEventListener('juicefx', aoSinal)
    return () => window.removeEventListener('juicefx', aoSinal)
  }, [])

  return (
    <div className="fixed inset-0 pointer-events-none z-[70] overflow-hidden">
      <AnimatePresence>
        {fx && fx.tipo === 'erro' && (
          <motion.div key={fx.id} initial={{ opacity: 0 }} animate={{ opacity: [0, 0.5, 0] }} exit={{ opacity: 0 }}
            transition={{ duration: 0.5, times: [0, 0.18, 1] }} className="absolute inset-0"
            style={{ boxShadow: 'inset 0 0 120px 32px rgba(239,68,68,0.5)', background: 'rgba(239,68,68,0.05)' }} />
        )}
        {fx && (fx.tipo === 'acerto' || fx.tipo === 'vitoria') && (
          <Faiscas key={fx.id} forte={fx.tipo === 'vitoria'} />
        )}
      </AnimatePresence>
    </div>
  )
}

function Faiscas({ forte }) {
  const n = forte ? 12 : 7
  const emojis = ['✨', '⭐', '💫', '🌟']
  const pecas = Array.from({ length: n }, (_, i) => {
    const ang = (Math.PI * 2 * i) / n + Math.random() * 0.6
    const dist = 60 + Math.random() * 70
    return { i, x: Math.cos(ang) * dist, y: Math.sin(ang) * dist - 26, e: emojis[i % emojis.length] }
  })
  return (
    <div className="absolute left-1/2 top-[38%] -translate-x-1/2 -translate-y-1/2">
      <motion.div initial={{ opacity: 0.55, scale: 0 }} animate={{ opacity: 0, scale: 2.6 }} transition={{ duration: 0.6, ease: 'easeOut' }}
        className="absolute left-0 top-0 w-16 h-16 rounded-full -translate-x-1/2 -translate-y-1/2"
        style={{ border: '3px solid rgba(34,197,94,0.7)' }} />
      {pecas.map((p) => (
        <motion.span key={p.i} initial={{ opacity: 0, x: 0, y: 0, scale: 0.4 }}
          animate={{ opacity: [0, 1, 0], x: p.x, y: p.y, scale: [0.4, 1.15, 0.7] }}
          transition={{ duration: 0.75, ease: 'easeOut' }} className="absolute left-0 top-0 text-2xl">{p.e}</motion.span>
      ))}
    </div>
  )
}
