import { useState } from 'react'
import { motion } from 'framer-motion'
import { embaralhar } from '../utils/comum.js'
import * as juice from '../../../lib/juice.js'

// ===================== 🚩 Semáfora =====================
// Só o CÍRCULO 1 (A–G), que é como o clube ensina no começo — e são as posições
// conferidas em fonte confiável. Dá pra ampliar depois com o manual do clube.
// Cada braço aponta pra baixo (0°) e gira pro seu lado: low 45°, out 90°,
// high 135°, up 180°. "esq" = mão DIREITA de quem sinaliza (como você vê).
const POS_ANG = { down: 0, low: 45, out: 90, high: 135, up: 180 }
const SEMAFORO = {
  A: { esq: 'low', dir: 'down' },
  B: { esq: 'out', dir: 'down' },
  C: { esq: 'high', dir: 'down' },
  D: { esq: 'up', dir: 'down' },
  E: { esq: 'down', dir: 'high' },
  F: { esq: 'down', dir: 'out' },
  G: { esq: 'down', dir: 'low' },
}
const LETRAS_SEM = Object.keys(SEMAFORO)

function Bandeirinha({ lado, pos }) {
  // esq gira pra esquerda (negativo), dir pra direita (positivo)
  const ang = (lado === 'esq' ? -1 : 1) * POS_ANG[pos]
  return (
    <div className="absolute left-1/2 top-1/2 w-2 h-16 -ml-1 origin-top"
      style={{ transform: `rotate(${ang}deg)` }}>
      <div className="w-2 h-16 bg-slate-700 rounded-full" />
      <div className="w-4 h-4 -ml-1 rounded-sm bg-red-500" />
    </div>
  )
}

export default function JogoSemaforo({ onTerminar, onCancelar }) {
  const TOTAL = 6
  const sortear = () => {
    const certa = LETRAS_SEM[Math.floor(Math.random() * LETRAS_SEM.length)]
    const outras = embaralhar(LETRAS_SEM.filter((l) => l !== certa)).slice(0, 3)
    return { certa, opcoes: embaralhar([certa, ...outras]) }
  }
  const [q, setQ] = useState(sortear)
  const [n, setN] = useState(1)
  const [acertos, setAcertos] = useState(0)
  const [aviso, setAviso] = useState('')
  const [fim, setFim] = useState(false)
  const sinal = SEMAFORO[q.certa]

  function responder(l) {
    if (fim || aviso) return
    const ok = l === q.certa
    const total = acertos + (ok ? 1 : 0)
    if (ok) { setAcertos(total); juice.acerto(acertos) } else juice.erro()
    setAviso(ok ? 'Isso! ✅' : `Era a letra ${q.certa}`)
    setTimeout(() => {
      setAviso('')
      if (n >= TOTAL) {
        setFim(true)
        onTerminar(total >= 6 ? 3 : total >= 4 ? 2 : 1)
      } else { setN(n + 1); setQ(sortear()) }
    }, 1100)
  }

  return (
    <div className="bg-surface rounded-3xl p-4 sm:p-5 shadow-md text-center">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-semibold text-muted">Letra {n} de {TOTAL}</span>
        <button onClick={onCancelar} className="text-xs text-faint p-3 -m-3">Cancelar</button>
      </div>
      <p className="text-xs text-faint mb-2">Que letra as bandeiras estão fazendo? (A a G)</p>

      <div className="relative h-44 mx-auto w-44 bg-surface2 rounded-2xl mb-3">
        <div className="absolute left-1/2 top-1/2 w-6 h-6 -ml-3 -mt-3 rounded-full bg-slate-700" />
        <Bandeirinha lado="esq" pos={sinal.esq} />
        <Bandeirinha lado="dir" pos={sinal.dir} />
      </div>

      <div className="grid grid-cols-4 gap-2">
        {q.opcoes.map((l) => (
          <motion.button key={l} whileTap={{ scale: 0.96 }} onClick={() => responder(l)} disabled={!!aviso || fim}
            className="rounded-xl bg-surface2 hover:bg-surface2 py-3 text-xl font-extrabold text-ink disabled:opacity-60">
            {l}
          </motion.button>
        ))}
      </div>
      {aviso && <p className={`text-sm font-bold mt-3 ${aviso.startsWith('Isso') ? 'text-green-600' : 'text-amber-600'}`}>{aviso}</p>}
      <p className="text-xs text-faint mt-2">Acertos: {acertos}</p>
    </div>
  )
}
