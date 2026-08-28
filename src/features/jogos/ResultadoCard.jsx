import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'

// Conta de 0 até o alvo com desaceleração — dá vida ao número de pontos no resultado.
function useContagem(alvo, duracao = 650) {
  const [valor, setValor] = useState(0)
  useEffect(() => {
    let frame
    const t0 = performance.now()
    const passo = (t) => {
      const p = Math.min(1, (t - t0) / duracao)
      setValor(Math.round(alvo * (1 - Math.pow(1 - p, 3))))
      if (p < 1) frame = requestAnimationFrame(passo)
    }
    frame = requestAnimationFrame(passo)
    return () => cancelAnimationFrame(frame)
  }, [alvo, duracao])
  return valor
}

export default function ResultadoCard({ resultado }) {
  const pontos = useContagem(resultado.pontos)
  return (
    <motion.div initial={{ opacity: 0, scale: 0.85, y: 12 }} animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 300, damping: 18 }}
      className="relative overflow-hidden bg-green-50 border border-green-200 rounded-2xl p-4 text-center mb-3">
      <motion.div initial={{ scale: 0, rotate: -30 }} animate={{ scale: [0, 1.3, 1], rotate: 0 }}
        transition={{ duration: 0.5, delay: 0.05, times: [0, 0.6, 1] }} className="text-5xl mb-1">🎉</motion.div>
      <p className="font-extrabold text-ink text-lg">+{pontos} pontos</p>
      <div className="flex justify-center gap-1 mt-1">
        {Array.from({ length: resultado.estrelas }).map((_, i) => (
          <motion.span key={i} initial={{ scale: 0, rotate: -70 }} animate={{ scale: 1, rotate: 0 }}
            transition={{ delay: 0.2 + i * 0.14, type: 'spring', stiffness: 420, damping: 11 }}
            className="text-3xl inline-block" style={{ filter: 'drop-shadow(0 2px 6px rgba(245,197,24,0.55))' }}>⭐</motion.span>
        ))}
      </div>
      <p className="text-xs text-muted mt-1">Cada ⭐ vale 5 pontos — mande bem pra ganhar mais! 🌟</p>
    </motion.div>
  )
}
