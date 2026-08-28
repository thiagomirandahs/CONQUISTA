import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { embaralhar } from '../utils/comum.js'
import * as juice from '../../../lib/juice.js'

// ===================== 🔢 Conta Rápida =====================
function novaConta() {
  const op = ['+', '-', '×'][Math.floor(Math.random() * 3)]
  let a, b, r
  if (op === '×') { a = 2 + Math.floor(Math.random() * 8); b = 2 + Math.floor(Math.random() * 8); r = a * b }
  else if (op === '+') { a = 5 + Math.floor(Math.random() * 40); b = 5 + Math.floor(Math.random() * 40); r = a + b }
  else { a = 12 + Math.floor(Math.random() * 40); b = 1 + Math.floor(Math.random() * 10); r = a - b }
  // 3 alternativas erradas, todas diferentes da certa
  const set = new Set([r])
  while (set.size < 4) {
    const d = r + (Math.random() < 0.5 ? -1 : 1) * (1 + Math.floor(Math.random() * 6))
    if (d >= 0) set.add(d)
  }
  return { a, b, op, r, opcoes: embaralhar([...set]) }
}

export default function JogoContas({ onTerminar, onCancelar }) {
  const SEGUNDOS = 30
  const [q, setQ] = useState(() => novaConta())
  const [acertos, setAcertos] = useState(0)
  const [tempo, setTempo] = useState(SEGUNDOS)
  const [fim, setFim] = useState(false)

  useEffect(() => {
    if (fim) return
    if (tempo <= 0) {
      setFim(true)
      setTimeout(() => onTerminar(acertos >= 12 ? 3 : acertos >= 7 ? 2 : 1), 700)
      return
    }
    const t = setTimeout(() => setTempo((s) => s - 1), 1000)
    return () => clearTimeout(t)
  }, [tempo, fim]) // eslint-disable-line

  function responder(v) {
    if (fim) return
    if (v === q.r) { setAcertos((x) => x + 1); juice.acerto(acertos) } else juice.erro()
    setQ(novaConta())
  }

  return (
    <div className="bg-surface rounded-3xl p-4 sm:p-5 shadow-md text-center">
      <div className="flex items-center justify-between mb-2">
        <span className={`text-sm font-extrabold ${tempo <= 10 ? 'text-red-500' : 'text-muted'}`}>⏱️ {tempo}s</span>
        <span className="text-sm font-semibold text-green-600">✅ {acertos}</span>
        <button onClick={onCancelar} className="text-xs text-faint p-3 -m-3">Cancelar</button>
      </div>
      {/* Barra do tempo esvaziando (fica vermelha na reta final) */}
      <div className="h-2 bg-surface2 rounded-full overflow-hidden mb-3">
        <div className={`h-full rounded-full transition-all duration-1000 ease-linear ${tempo <= 10 ? 'bg-red-500' : 'bg-brand'}`}
          style={{ width: `${(tempo / SEGUNDOS) * 100}%` }} />
      </div>

      {fim ? (
        <div className="py-6">
          <div className="text-5xl mb-2">🏁</div>
          <p className="font-extrabold text-ink">Tempo! Você acertou {acertos}.</p>
        </div>
      ) : (
        <>
          <div className="text-4xl font-extrabold text-brand my-5">{q.a} {q.op} {q.b}</div>
          <div className="grid grid-cols-2 gap-2">
            {q.opcoes.map((v) => (
              <motion.button key={v} whileTap={{ scale: 0.96 }} onClick={() => responder(v)}
                className="rounded-xl bg-surface2 hover:bg-surface2 py-4 text-xl font-extrabold text-ink">
                {v}
              </motion.button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
