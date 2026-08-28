import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import * as juice from '../../../lib/juice.js'

// Siga a Sequência (Gênius): os itens piscam numa ordem que cresce; repita.
export default function JogoSequencia({ onTerminar, onCancelar }) {
  const SIMBOLOS = [
    { e: '🔥', cor: '#ef4444' },
    { e: '🧭', cor: '#3b82f6' },
    { e: '🧣', cor: '#10b981' },
    { e: '🪢', cor: '#f59e0b' },
    { e: '📖', cor: '#8b5cf6' },
    { e: '⛺', cor: '#06b6d4' },
  ]
  const [seq, setSeq] = useState([])
  const [mostrando, setMostrando] = useState(false)
  const [aceso, setAceso] = useState(-1)
  const [pos, setPos] = useState(0)
  const [rodada, setRodada] = useState(0)
  const [fim, setFim] = useState(false)

  useEffect(() => { proximaRodada([]) }, []) // eslint-disable-line

  const rand = () => Math.floor(Math.random() * SIMBOLOS.length)

  function proximaRodada(atual) {
    const nova = [...atual, rand()]
    setSeq(nova)
    setRodada(nova.length)
    setPos(0)
    demonstrar(nova)
  }

  function demonstrar(s) {
    setMostrando(true)
    let i = 0
    const passo = () => {
      if (i >= s.length) { setAceso(-1); setMostrando(false); return }
      setAceso(s[i])
      setTimeout(() => {
        setAceso(-1)
        i++
        setTimeout(passo, 220)
      }, 520)
    }
    setTimeout(passo, 600)
  }

  function encerrar(rodadasCompletas) {
    setFim(true)
    const estrelas = rodadasCompletas >= 7 ? 3 : rodadasCompletas >= 4 ? 2 : 1
    setTimeout(() => onTerminar(estrelas), 500)
  }

  function tocar(idx) {
    if (mostrando || fim) return
    setAceso(idx)
    setTimeout(() => setAceso((a) => (a === idx ? -1 : a)), 180)
    if (idx !== seq[pos]) { juice.erro(); encerrar(seq.length - 1); return } // errou
    juice.acerto(pos)
    const novaPos = pos + 1
    if (novaPos === seq.length) {
      if (seq.length >= 15) { encerrar(15); return } // venceu
      setMostrando(true) // trava toques durante a pausa até a próxima demonstração
      setTimeout(() => proximaRodada(seq), 650)
    } else {
      setPos(novaPos)
    }
  }

  return (
    <div className="bg-surface rounded-3xl p-4 sm:p-5 shadow-md text-center">
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-semibold text-muted">Rodada {rodada}</span>
        <button onClick={onCancelar} className="text-xs text-faint p-3 -m-3">Cancelar</button>
      </div>
      <p className="text-xs text-faint mb-3 h-4">{mostrando ? 'Observe a sequência…' : fim ? 'Fim! 🎉' : 'Sua vez — repita!'}</p>
      <div className="grid grid-cols-3 gap-3 max-w-[300px] mx-auto">
        {SIMBOLOS.map((s, i) => (
          <motion.button key={i} onClick={() => tocar(i)} disabled={mostrando || fim}
            animate={{ scale: aceso === i ? 1.08 : 1, opacity: aceso === i ? 1 : 0.75 }}
            transition={{ duration: 0.12 }}
            className="aspect-square rounded-2xl text-4xl grid place-items-center border-2 border-white shadow select-none"
            style={{
              backgroundColor: aceso === i ? s.cor : s.cor + '33',
              boxShadow: aceso === i ? `0 0 24px ${s.cor}` : undefined,
            }}>
            {s.e}
          </motion.button>
        ))}
      </div>
    </div>
  )
}
