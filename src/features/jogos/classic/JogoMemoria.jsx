import { useState } from 'react'
import { motion } from 'framer-motion'
import { embaralhar } from '../utils/comum.js'
import * as juice from '../../../lib/juice.js'

const PARES = ['🧭', '🧣', '🪢', '🔥', '📖', '⛺']

export default function JogoMemoria({ onTerminar, onCancelar }) {
  const [cartas] = useState(() => embaralhar(PARES.flatMap((e, i) => [{ id: i + '-a', emoji: e }, { id: i + '-b', emoji: e }])))
  const [viradas, setViradas] = useState([])
  const [achadas, setAchadas] = useState([])
  const [jogadas, setJogadas] = useState(0)
  const [bloqueado, setBloqueado] = useState(false)

  function clicar(i) {
    if (bloqueado || viradas.includes(i) || achadas.includes(cartas[i].emoji)) return
    const novas = [...viradas, i]
    setViradas(novas)
    if (novas.length === 2) {
      const total = jogadas + 1
      setJogadas(total)
      setBloqueado(true)
      const [a, b] = novas
      if (cartas[a].emoji === cartas[b].emoji) {
        const novoAchadas = [...achadas, cartas[a].emoji]
        juice.acerto(achadas.length)
        setTimeout(() => {
          setAchadas(novoAchadas)
          setViradas([])
          setBloqueado(false)
          if (novoAchadas.length === PARES.length) {
            const estrelas = total <= 8 ? 3 : total <= 11 ? 2 : 1
            setTimeout(() => onTerminar(estrelas), 400)
          }
        }, 500)
      } else {
        juice.erro()
        setTimeout(() => { setViradas([]); setBloqueado(false) }, 800)
      }
    }
  }

  return (
    <div className="bg-surface rounded-3xl p-4 sm:p-5 shadow-md">
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-semibold text-muted">Tentativas: {jogadas}</span>
        <button onClick={onCancelar} className="text-xs text-faint p-3 -m-3">Cancelar</button>
      </div>
      <div className="grid grid-cols-4 gap-2 select-none">
        {cartas.map((c, i) => {
          const achada = achadas.includes(c.emoji)
          const aberta = viradas.includes(i) || achada
          return (
            <motion.button key={c.id} onClick={() => clicar(i)} whileTap={{ scale: 0.92 }}
              animate={achada ? { scale: [1, 1.12, 1] } : {}}
              className={`aspect-square rounded-xl text-3xl grid place-items-center border-2 transition-colors shadow-sm ${
                achada ? 'bg-green-50 border-green-400'
                : aberta ? 'bg-surface border-brand'
                : 'bg-gradient-to-br from-brand to-brand2 border-transparent'
              }`}>
              {aberta ? c.emoji : <span className="text-white/80 text-xl font-extrabold">?</span>}
            </motion.button>
          )
        })}
      </div>
    </div>
  )
}
