import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { embaralhar } from '../utils/comum.js'
import * as juice from '../../../lib/juice.js'

const POOL_MUDOU = ['🔥', '⛺', '🧭', '🪢', '📖', '🥾', '🎒', '🔦', '🍎', '🌲', '🐍', '🦅', '⭐', '🌙', '☀️', '🚩', '🛶', '🪓', '🧣', '💧']
const TAMANHOS_MUDOU = [4, 6, 6, 8, 9]
const COLS_MUDOU = { 4: 2, 6: 3, 8: 4, 9: 3 }

function rodadaMudou(n) {
  const itens = embaralhar(POOL_MUDOU).slice(0, n)
  const alvo = Math.floor(Math.random() * n)
  const fora = embaralhar(POOL_MUDOU.filter((e) => !itens.includes(e))).slice(0, 3)
  return { itens, alvo, opcoes: embaralhar([itens[alvo], ...fora]) }
}

export default function JogoMudou({ onTerminar, onCancelar }) {
  const [n, setN] = useState(0)
  const [rod, setRod] = useState(() => rodadaMudou(TAMANHOS_MUDOU[0]))
  const [fase, setFase] = useState('olhar') // olhar | responder
  const [acertos, setAcertos] = useState(0)
  const [aviso, setAviso] = useState('')

  // Tempo de memorizar cresce um pouco com o tamanho da grade
  useEffect(() => {
    if (fase !== 'olhar') return
    const t = setTimeout(() => setFase('responder'), 2500 + rod.itens.length * 250)
    return () => clearTimeout(t)
  }, [fase, rod])

  function responder(op) {
    if (fase !== 'responder' || aviso) return
    const certo = rod.itens[rod.alvo]
    const ok = op === certo
    const tot = acertos + (ok ? 1 : 0)
    if (ok) { setAcertos(tot); juice.acerto(acertos) } else juice.erro()
    setAviso(ok ? 'Boa memória! ✅' : `Era ${certo}`)
    setTimeout(() => {
      setAviso('')
      if (n + 1 >= TAMANHOS_MUDOU.length) {
        onTerminar(tot >= 5 ? 3 : tot >= 3 ? 2 : 1)
      } else {
        const nx = n + 1
        setN(nx)
        setRod(rodadaMudou(TAMANHOS_MUDOU[nx]))
        setFase('olhar')
      }
    }, 1200)
  }

  const cols = COLS_MUDOU[rod.itens.length] || 3
  return (
    <div className="bg-surface rounded-3xl p-4 sm:p-5 shadow-md text-center">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-semibold text-muted">Rodada {n + 1} de {TAMANHOS_MUDOU.length}</span>
        <button onClick={onCancelar} className="text-xs text-faint p-3 -m-3">Cancelar</button>
      </div>
      <p className="text-xs text-faint mb-3 h-4">
        {fase === 'olhar' ? '👀 Memorize os itens…' : aviso || 'Qual item estava na casa ❓?'}
      </p>

      <div className="grid gap-2 mx-auto max-w-[260px] mb-4 select-none" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
        {rod.itens.map((e, i) => (
          <div key={i} className={`aspect-square rounded-xl grid place-items-center text-3xl ${
            fase === 'responder' && i === rod.alvo ? 'bg-brand/10 border-2 border-brand text-brand font-extrabold' : 'bg-surface2'
          }`}>
            {fase === 'olhar' ? e : i === rod.alvo ? '❓' : e}
          </div>
        ))}
      </div>

      {fase === 'responder' && (
        <div className="grid grid-cols-4 gap-2">
          {rod.opcoes.map((op) => (
            <motion.button key={op} whileTap={{ scale: 0.94 }} onClick={() => responder(op)} disabled={!!aviso}
              className="rounded-xl bg-surface2 hover:bg-surface2 py-3 text-2xl disabled:opacity-60">
              {op}
            </motion.button>
          ))}
        </div>
      )}
      <p className="text-xs text-faint mt-3">Acertos: {acertos}</p>
    </div>
  )
}
