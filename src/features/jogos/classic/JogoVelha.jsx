import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import * as juice from '../../../lib/juice.js'

// ===================== ❌⭕ Jogo da Velha (estratégia) =====================
// Melhor de 3 contra o app. A criança é o ❌. O app: ganha se puder, bloqueia
// se precisar, prefere centro e cantos — bom, mas dá pra vencer com "garfo".
const LINHAS_VELHA = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]]
function vencedorVelha(b) {
  for (const [a, c, d] of LINHAS_VELHA) {
    if (b[a] && b[a] === b[c] && b[a] === b[d]) return b[a]
  }
  return b.every(Boolean) ? 'empate' : null
}
function jogadaApp(b) {
  const livres = b.map((v, i) => (v ? null : i)).filter((v) => v !== null)
  const tenta = (marca) => {
    for (const i of livres) {
      const c = [...b]; c[i] = marca
      if (vencedorVelha(c) === marca) return i
    }
    return null
  }
  let i = tenta('O')            // 1) ganha se der
  if (i !== null) return i
  i = tenta('X')                // 2) bloqueia a criança
  if (i !== null) return i
  if (!b[4]) return 4           // 3) centro
  const cantos = [0, 2, 6, 8].filter((c) => !b[c])
  if (cantos.length) return cantos[Math.floor(Math.random() * cantos.length)]
  return livres[Math.floor(Math.random() * livres.length)]
}

export default function JogoVelha({ onTerminar, onCancelar }) {
  const [tab, setTab] = useState(() => Array(9).fill(null))
  const [partida, setPartida] = useState(1)          // 1..3 (quem começa alterna)
  const [placar, setPlacar] = useState({ v: 0, e: 0, d: 0 })
  const [vez, setVez] = useState('X')
  const [fimPartida, setFimPartida] = useState(null) // 'X' | 'O' | 'empate'
  const [fim, setFim] = useState(false)

  // Vez do app: joga com um delay pra dar sensação de "pensar"
  useEffect(() => {
    if (vez !== 'O' || fimPartida || fim) return
    const t = setTimeout(() => {
      setTab((b) => {
        if (vencedorVelha(b)) return b
        const i = jogadaApp(b)
        const n = [...b]; n[i] = 'O'
        return n
      })
      setVez('X')
    }, 500)
    return () => clearTimeout(t)
  }, [vez, fimPartida, fim]) // eslint-disable-line

  // Confere o resultado a cada jogada
  useEffect(() => {
    const r = vencedorVelha(tab)
    if (!r || fimPartida) return
    setFimPartida(r)
    if (r === 'X') juice.acerto(); else if (r === 'O') juice.erro()
    const chave = r === 'X' ? 'v' : r === 'empate' ? 'e' : 'd'
    const novo = { ...placar, [chave]: placar[chave] + 1 }
    setPlacar(novo)
    if (partida >= 3) {
      setFim(true)
      const pts = novo.v * 2 + novo.e
      setTimeout(() => onTerminar(pts >= 4 ? 3 : pts >= 2 ? 2 : 1), 1500)
    } else {
      setTimeout(() => {
        setTab(Array(9).fill(null))
        setFimPartida(null)
        const prox = partida + 1
        setPartida(prox)
        setVez(prox === 2 ? 'O' : 'X') // na 2ª partida o app começa
      }, 1500)
    }
  }, [tab]) // eslint-disable-line

  function tocar(i) {
    if (vez !== 'X' || tab[i] || fimPartida || fim) return
    const n = [...tab]; n[i] = 'X'
    setTab(n)
    setVez('O')
  }

  const pontosFinais = placar.v * 2 + placar.e
  const status = fim
    ? (pontosFinais >= 4 ? 'Você levou a melhor! 🏆' : pontosFinais >= 2 ? 'Quase! Bom jogo 🙂' : 'O app venceu dessa vez 🤖')
    : fimPartida
    ? (fimPartida === 'X' ? 'Você venceu a partida! 🎉' : fimPartida === 'O' ? 'O app venceu essa 🤖' : 'Deu velha (empate)!')
    : vez === 'X' ? 'Sua vez — você é o ❌' : 'App pensando… 🤖'

  return (
    <div className="bg-surface rounded-3xl p-4 sm:p-5 shadow-md text-center">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-semibold text-muted">Partida {partida} de 3</span>
        <button onClick={onCancelar} className="text-xs text-faint p-3 -m-3">Cancelar</button>
      </div>
      <p className="text-sm font-bold text-ink mb-1">
        Você {placar.v} × {placar.d} App <span className="text-faint font-semibold">(empates: {placar.e})</span>
      </p>
      <p className="text-xs text-faint mb-3 h-4">{status}</p>

      <div className="grid grid-cols-3 gap-1.5 mx-auto max-w-[260px] select-none">
        {tab.map((v, i) => (
          <motion.button key={i} whileTap={!v && vez === 'X' && !fimPartida ? { scale: 0.94 } : undefined}
            onClick={() => tocar(i)} disabled={!!v || vez !== 'X' || !!fimPartida || fim}
            className={`aspect-square rounded-xl grid place-items-center text-3xl font-extrabold ${
              v === 'X' ? 'bg-brand/10 text-brand' : v === 'O' ? 'bg-amber-50 text-amber-500' : 'bg-surface2'
            }`}>
            {v === 'X' ? '❌' : v === 'O' ? '⭕' : ''}
          </motion.button>
        ))}
      </div>
      <p className="text-[11px] text-faint mt-3">Melhor de 3. Vitória vale 2 pontos e empate vale 1 — some 4+ pra fazer 3⭐.</p>
    </div>
  )
}
