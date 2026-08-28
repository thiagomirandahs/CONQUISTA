import { useState } from 'react'
import { motion } from 'framer-motion'

// ===================== Quebra-cabeça deslizante (3x3) =====================
function vizinhosDesl(i, N) {
  const r = Math.floor(i / N), c = i % N, v = []
  if (r > 0) v.push(i - N)
  if (r < N - 1) v.push(i + N)
  if (c > 0) v.push(i - 1)
  if (c < N - 1) v.push(i + 1)
  return v
}
function resolvidoDesl(t) {
  for (let i = 0; i < t.length - 1; i++) if (t[i] !== i + 1) return false
  return t[t.length - 1] === 0
}
// Embaralha fazendo jogadas válidas a partir do resolvido (sempre tem solução)
function embaralharDesl(N) {
  const t = []
  for (let i = 1; i < N * N; i++) t.push(i)
  t.push(0)
  let vazio = N * N - 1
  for (let i = 0; i < 100; i++) {
    const viz = vizinhosDesl(vazio, N)
    const p = viz[Math.floor(Math.random() * viz.length)]
    ;[t[vazio], t[p]] = [t[p], t[vazio]]
    vazio = p
  }
  return resolvidoDesl(t) ? embaralharDesl(N) : t
}

export default function JogoDeslizante({ onTerminar, onCancelar }) {
  const N = 3
  const [tabu, setTabu] = useState(() => embaralharDesl(N))
  const [mov, setMov] = useState(0)
  const [fim, setFim] = useState(false)

  function mover(idx) {
    if (fim) return
    const vazio = tabu.indexOf(0)
    if (!vizinhosDesl(idx, N).includes(vazio)) return
    const novo = [...tabu]
    ;[novo[idx], novo[vazio]] = [novo[vazio], novo[idx]]
    const m = mov + 1
    setTabu(novo)
    setMov(m)
    if (resolvidoDesl(novo)) {
      setFim(true)
      const est = m <= 30 ? 3 : m <= 60 ? 2 : 1
      setTimeout(() => onTerminar(est), 700)
    }
  }

  return (
    <div className="bg-surface rounded-3xl p-4 sm:p-5 shadow-md text-center">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-semibold text-muted">Movimentos: {mov}</span>
        <button onClick={onCancelar} className="text-xs text-faint p-3 -m-3">Cancelar</button>
      </div>
      <p className="text-xs text-faint mb-3">{fim ? 'Resolvido! 🎉' : 'Deslize as peças até ficar 1, 2, 3…'}</p>
      <div className="grid grid-cols-3 gap-2 max-w-[260px] mx-auto">
        {tabu.map((v) => (
          v === 0 ? (
            <div key={v} className="aspect-square rounded-2xl bg-surface2" />
          ) : (
            <motion.button key={v} layout onClick={() => mover(tabu.indexOf(v))} disabled={fim}
              transition={{ type: 'spring', stiffness: 500, damping: 34 }}
              className="aspect-square rounded-2xl bg-brand text-white text-2xl font-extrabold grid place-items-center shadow">
              {v}
            </motion.button>
          )
        ))}
      </div>
    </div>
  )
}
