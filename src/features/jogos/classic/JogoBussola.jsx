import { useState } from 'react'
import { motion } from 'framer-motion'
import { embaralhar } from '../utils/comum.js'
import * as juice from '../../../lib/juice.js'

// ===================== 🧭 Bússola =====================
const ROSA = ['N', 'NE', 'L', 'SE', 'S', 'SO', 'O', 'NO'] // 45° cada, sentido horário
const NOME_DIR = {
  N: 'Norte', NE: 'Nordeste', L: 'Leste', SE: 'Sudeste',
  S: 'Sul', SO: 'Sudoeste', O: 'Oeste', NO: 'Noroeste',
}
function novaBussola() {
  const de = Math.floor(Math.random() * 8)
  const passos = 1 + Math.floor(Math.random() * 4) // 45° a 180°
  const horario = Math.random() < 0.5
  const destino = ((de + (horario ? passos : -passos)) % 8 + 8) % 8
  const erradas = embaralhar(ROSA.filter((_, k) => k !== destino)).slice(0, 3)
  return {
    de: ROSA[de], graus: passos * 45, horario,
    certa: ROSA[destino], opcoes: embaralhar([ROSA[destino], ...erradas]),
  }
}

// Rosa dos ventos com a agulha apontando pra direção inicial da pergunta
function RosaDosVentos({ de }) {
  const ang = ROSA.indexOf(de) * 45
  return (
    <div className="relative w-40 h-40 mx-auto mb-3 rounded-full border-4 border-line bg-gradient-to-b from-white to-slate-50 shadow-inner select-none">
      {ROSA.map((d, i) => (
        <div key={d} className="absolute inset-0" style={{ transform: `rotate(${i * 45}deg)` }}>
          <div className="absolute top-1.5 inset-x-0 text-center">
            <span className={`inline-block text-[10px] font-extrabold ${i % 2 === 0 ? 'text-muted' : 'text-faint'}`}
              style={{ transform: `rotate(${-i * 45}deg)` }}>
              {d}
            </span>
          </div>
        </div>
      ))}
      <motion.div className="absolute inset-0" animate={{ rotate: ang }}
        transition={{ type: 'spring', stiffness: 120, damping: 14 }}>
        <div className="absolute top-6 inset-x-0 text-center text-red-500 text-xl leading-none">▲</div>
        <div className="absolute bottom-6 inset-x-0 text-center text-faint text-xl leading-none">▼</div>
      </motion.div>
      <div className="absolute left-1/2 top-1/2 w-3 h-3 -ml-1.5 -mt-1.5 rounded-full bg-brand ring-4 ring-brand/20" />
    </div>
  )
}

export default function JogoBussola({ onTerminar, onCancelar }) {
  const TOTAL = 6
  const [q, setQ] = useState(() => novaBussola())
  const [n, setN] = useState(1)
  const [acertos, setAcertos] = useState(0)
  const [aviso, setAviso] = useState('')
  const [fim, setFim] = useState(false)

  function responder(dir) {
    if (fim || aviso) return
    const ok = dir === q.certa
    const total = acertos + (ok ? 1 : 0)
    if (ok) { setAcertos(total); juice.acerto(acertos) } else juice.erro()
    setAviso(ok ? 'Isso! ✅' : `Era ${NOME_DIR[q.certa]}`)
    setTimeout(() => {
      setAviso('')
      if (n >= TOTAL) {
        setFim(true)
        onTerminar(total >= 6 ? 3 : total >= 4 ? 2 : 1)
      } else { setN(n + 1); setQ(novaBussola()) }
    }, 1000)
  }

  return (
    <div className="bg-surface rounded-3xl p-4 sm:p-5 shadow-md text-center">
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-semibold text-muted">Pergunta {n} de {TOTAL}</span>
        <button onClick={onCancelar} className="text-xs text-faint p-3 -m-3">Cancelar</button>
      </div>

      <RosaDosVentos de={q.de} />
      <p className="text-ink leading-snug mb-1">
        A agulha mostra: você está virado para o <b>{NOME_DIR[q.de]}</b>.<br />
        Agora gire <b>{q.graus}°</b> <b>{q.horario ? 'à direita ↻' : 'à esquerda ↺'}</b>.
      </p>
      <p className="text-sm text-faint mb-4">Para onde está olhando agora?</p>

      <div className="grid grid-cols-2 gap-2">
        {q.opcoes.map((d) => (
          <motion.button key={d} whileTap={{ scale: 0.97 }} onClick={() => responder(d)} disabled={!!aviso || fim}
            className="rounded-xl bg-surface2 hover:bg-surface2 py-3 font-bold text-ink disabled:opacity-60">
            {NOME_DIR[d]}
          </motion.button>
        ))}
      </div>
      {aviso && <p className={`text-sm font-bold mt-3 ${aviso.startsWith('Isso') ? 'text-green-600' : 'text-amber-600'}`}>{aviso}</p>}
      <p className="text-xs text-faint mt-3">Acertos: {acertos}</p>
    </div>
  )
}
