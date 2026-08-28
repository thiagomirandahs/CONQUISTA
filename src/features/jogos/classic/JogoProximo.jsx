import { useState } from 'react'
import { motion } from 'framer-motion'
import { embaralhar } from '../utils/comum.js'
import * as juice from '../../../lib/juice.js'

// ===================== ➡️ Qual é o Próximo? (lógica) =====================
const SEQS_PROXIMO = [
  { s: '2, 4, 6, 8, …', o: ['9', '10', '12', '16'], c: 1 },
  { s: '1, 2, 4, 8, …', o: ['12', '14', '16', '10'], c: 2 },
  { s: '21, 18, 15, 12, …', o: ['10', '9', '8', '11'], c: 1 },
  { s: '1, 1, 2, 3, 5, …', o: ['6', '7', '8', '10'], c: 2 },
  { s: '1, 4, 9, 16, …', o: ['20', '24', '25', '36'], c: 2 },
  { s: '3, 6, 12, 24, …', o: ['30', '36', '48', '44'], c: 2 },
  { s: '10, 9, 7, 4, …', o: ['0', '1', '2', '3'], c: 0 },
  { s: '2, 3, 5, 7, 11, …', o: ['12', '13', '14', '15'], c: 1 },
  { s: '🔴 🔵 🔴 🔵 🔴 …', o: ['🔴', '🔵', '🟢', '🟡'], c: 1 },
  { s: '⭐ ⭐ 🔥 ⭐ ⭐ 🔥 ⭐ ⭐ …', o: ['⭐', '🔥', '🌙', '☀️'], c: 1 },
  { s: '🌱 🌿 🌳 🌱 🌿 …', o: ['🌱', '🌿', '🌳', '🍂'], c: 2 },
  { s: '🌞 🌙 🌞 🌙 🌞 …', o: ['🌞', '🌙', '⭐', '☁️'], c: 1 },
]

export default function JogoProximo({ onTerminar, onCancelar }) {
  const [rodadas] = useState(() => embaralhar(SEQS_PROXIMO).slice(0, 6).map((q) => ({
    s: q.s, certa: q.o[q.c], opcoes: embaralhar(q.o),
  })))
  const [n, setN] = useState(0)
  const [acertos, setAcertos] = useState(0)
  const [aviso, setAviso] = useState('')
  const q = rodadas[n]

  function responder(op) {
    if (aviso) return
    const ok = op === q.certa
    const tot = acertos + (ok ? 1 : 0)
    if (ok) { setAcertos(tot); juice.acerto(acertos) } else juice.erro()
    setAviso(ok ? 'Isso! ✅' : `Era ${q.certa}`)
    setTimeout(() => {
      setAviso('')
      if (n + 1 >= rodadas.length) onTerminar(tot >= 6 ? 3 : tot >= 4 ? 2 : 1)
      else setN(n + 1)
    }, 1100)
  }

  return (
    <div className="bg-surface rounded-3xl p-4 sm:p-5 shadow-md text-center">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-semibold text-muted">Sequência {n + 1} de {rodadas.length}</span>
        <button onClick={onCancelar} className="text-xs text-faint p-3 -m-3">Cancelar</button>
      </div>
      <p className="text-xs text-faint mb-4">O que vem no lugar do “…”?</p>

      <div className="bg-brand/5 rounded-2xl py-5 px-3 mb-4">
        <span className="text-2xl font-extrabold text-brand tracking-wide break-words">{q.s}</span>
      </div>

      <div className="grid grid-cols-2 gap-2">
        {q.opcoes.map((op) => (
          <motion.button key={op} whileTap={{ scale: 0.96 }} onClick={() => responder(op)} disabled={!!aviso}
            className="rounded-xl bg-surface2 hover:bg-surface2 py-4 text-xl font-extrabold text-ink disabled:opacity-60">
            {op}
          </motion.button>
        ))}
      </div>
      {aviso && <p className={`text-sm font-bold mt-3 ${aviso.startsWith('Isso') ? 'text-green-600' : 'text-amber-600'}`}>{aviso}</p>}
      <p className="text-xs text-faint mt-2">Acertos: {acertos}</p>
    </div>
  )
}
