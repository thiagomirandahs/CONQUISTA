import { useState } from 'react'
import * as juice from '../../../lib/juice.js'

// ===================== 🗼 Torre de Hanói (lógica) =====================
// 4 discos, mínimo 15 movimentos. Toque num pino pra pegar o disco de cima e
// noutro pra soltar (nunca disco grande sobre pequeno).
const HANOI_DISCOS = 4
const HANOI_MINIMO = 15
const HANOI_COR = ['', 'bg-red-400', 'bg-amber-400', 'bg-green-500', 'bg-brand']

export default function JogoHanoi({ onTerminar, onCancelar }) {
  const [pinos, setPinos] = useState(() => [[4, 3, 2, 1], [], []]) // fim do array = topo
  const [sel, setSel] = useState(null)
  const [mov, setMov] = useState(0)
  const [erro, setErro] = useState(false)
  const [fim, setFim] = useState(false)

  function tocar(p) {
    if (fim) return
    if (sel === null) {
      if (pinos[p].length) setSel(p)
      return
    }
    if (sel === p) { setSel(null); return }
    const disco = pinos[sel][pinos[sel].length - 1]
    const topoDestino = pinos[p][pinos[p].length - 1]
    if (topoDestino && topoDestino < disco) {
      // não pode: grande sobre pequeno (pisca em vermelho)
      juice.erro()
      setErro(true)
      setTimeout(() => setErro(false), 450)
      setSel(null)
      return
    }
    const novo = pinos.map((x) => [...x])
    novo[sel].pop()
    novo[p].push(disco)
    const m = mov + 1
    setPinos(novo)
    setMov(m)
    setSel(null)
    if (novo[2].length === HANOI_DISCOS) {
      setFim(true)
      setTimeout(() => onTerminar(m <= HANOI_MINIMO ? 3 : m <= 22 ? 2 : 1), 1000)
    }
  }

  return (
    <div className="bg-surface rounded-3xl p-4 sm:p-5 shadow-md text-center">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-semibold text-muted">Movimentos: {mov} <span className="text-faint">(mínimo: {HANOI_MINIMO})</span></span>
        <button onClick={onCancelar} className="text-xs text-faint p-3 -m-3">Cancelar</button>
      </div>
      <p className={`text-xs mb-3 h-4 font-semibold ${erro ? 'text-red-500' : fim ? 'text-green-600' : 'text-faint'}`}>
        {erro ? 'Não pode: disco grande sobre pequeno!' : fim ? `Conseguiu em ${mov} movimentos! 🎉` : 'Leve todos os discos pro 3º pino 👉'}
      </p>

      <div className="flex items-end justify-center gap-2 select-none mb-1">
        {pinos.map((pino, p) => (
          <button key={p} onClick={() => tocar(p)}
            className={`relative flex-1 max-w-[110px] h-36 flex flex-col-reverse items-center pb-1 rounded-xl transition-colors ${
              sel === p ? 'bg-brand/10 ring-2 ring-brand' : 'bg-surface2'
            }`}>
            <div className="absolute bottom-1 top-4 left-1/2 -ml-[3px] w-1.5 bg-surface2 rounded-full" />
            {pino.map((d, i) => (
              <div key={d}
                className={`relative z-10 h-4 rounded-full mb-0.5 shadow-sm ${HANOI_COR[d]} ${
                  sel === p && i === pino.length - 1 ? 'ring-2 ring-white -translate-y-0.5' : ''
                }`}
                style={{ width: `${26 + d * 16}px` }} />
            ))}
          </button>
        ))}
      </div>
      <div className="h-2 bg-surface2 rounded-full max-w-[350px] mx-auto" />
      <p className="text-[11px] text-faint mt-3">Toque num pino pra pegar o disco de cima; toque noutro pra soltar.</p>
    </div>
  )
}
