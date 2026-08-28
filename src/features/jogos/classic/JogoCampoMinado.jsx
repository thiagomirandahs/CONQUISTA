import { useState } from 'react'
import * as juice from '../../../lib/juice.js'

// ===================== 💣 Campo Minado =====================
// 8x8 com 10 minas. O 1º toque é sempre seguro (as minas nascem depois dele,
// longe daquela casa). Modo ⛏️ cava; modo 🚩 marca. Perdeu = 1⭐; ganhou = 2⭐
// (3⭐ se em até 90s).
const N_MINADO = 8
const MINAS_TOTAL = 10
const CORES_NUM = ['', 'text-blue-600', 'text-green-600', 'text-red-500', 'text-purple-600',
  'text-amber-600', 'text-cyan-700', 'text-ink', 'text-ink']

function vizinhosMinado(i) {
  const x = i % N_MINADO, y = Math.floor(i / N_MINADO), v = []
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue
      const nx = x + dx, ny = y + dy
      if (nx >= 0 && nx < N_MINADO && ny >= 0 && ny < N_MINADO) v.push(ny * N_MINADO + nx)
    }
  }
  return v
}
function gerarMinas(evitar) {
  // nada de mina na 1ª casa tocada nem nas vizinhas (começo justo)
  const proibidas = new Set([evitar, ...vizinhosMinado(evitar)])
  const minas = new Set()
  while (minas.size < MINAS_TOTAL) {
    const i = Math.floor(Math.random() * N_MINADO * N_MINADO)
    if (!proibidas.has(i)) minas.add(i)
  }
  return minas
}

function JogoCampoMinado({ onTerminar, onCancelar }) {
  const [minas, setMinas] = useState(null) // só nascem no 1º toque
  const [abertas, setAbertas] = useState(() => new Set())
  const [bandeiras, setBandeiras] = useState(() => new Set())
  const [modo, setModo] = useState('cavar') // cavar | bandeira
  const [inicio, setInicio] = useState(null)
  const [fim, setFim] = useState(null) // null | 'ganhou' | 'perdeu'

  const contar = (i, ms) => vizinhosMinado(i).filter((v) => ms.has(v)).length

  function tocar(i) {
    if (fim || abertas.has(i)) return
    if (modo === 'bandeira') {
      setBandeiras((b) => {
        const n = new Set(b)
        if (n.has(i)) n.delete(i)
        else if (n.size < MINAS_TOTAL) n.add(i)
        return n
      })
      return
    }
    if (bandeiras.has(i)) return // casa marcada não cava (evita acidente)

    let ms = minas
    let t0 = inicio
    if (!ms) { ms = gerarMinas(i); setMinas(ms); t0 = Date.now(); setInicio(t0) }

    if (ms.has(i)) {
      setAbertas((a) => new Set([...a, i]))
      setFim('perdeu')
      juice.colisao()
      setTimeout(() => onTerminar(1), 1600)
      return
    }

    // abre em cascata as áreas sem mina por perto
    const novas = new Set(abertas)
    const fila = [i]
    while (fila.length) {
      const c = fila.pop()
      if (novas.has(c)) continue
      novas.add(c)
      if (contar(c, ms) === 0) {
        for (const v of vizinhosMinado(c)) {
          if (!novas.has(v) && !ms.has(v)) fila.push(v)
        }
      }
    }
    setAbertas(novas)
    juice.acerto(abertas.size)

    if (novas.size === N_MINADO * N_MINADO - MINAS_TOTAL) {
      setFim('ganhou')
      const seg = (Date.now() - t0) / 1000
      setTimeout(() => onTerminar(seg <= 90 ? 3 : 2), 1000)
    }
  }

  return (
    <div className="bg-surface rounded-3xl p-4 sm:p-5 shadow-md text-center">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-extrabold text-muted">🚩 {MINAS_TOTAL - bandeiras.size}</span>
        {fim && (
          <span className={`text-sm font-extrabold ${fim === 'ganhou' ? 'text-green-600' : 'text-red-500'}`}>
            {fim === 'ganhou' ? 'Campo limpo! 🎉' : 'BUM! 💥'}
          </span>
        )}
        <button onClick={onCancelar} className="text-xs text-faint p-3 -m-3">Cancelar</button>
      </div>

      <div className="bg-surface2 rounded-2xl p-1.5 mx-auto max-w-[320px] mb-3 select-none">
        <div className="grid gap-0.5" style={{ gridTemplateColumns: `repeat(${N_MINADO}, 1fr)` }}>
          {Array.from({ length: N_MINADO * N_MINADO }, (_, i) => {
            const aberta = abertas.has(i)
            const bandeira = bandeiras.has(i)
            const mina = minas?.has(i)
            const n = aberta && minas ? contar(i, minas) : 0
            const mostraMina = fim === 'perdeu' && mina
            return (
              <button key={i} onClick={() => tocar(i)} disabled={!!fim}
                className={`aspect-square rounded-[4px] grid place-items-center text-xs sm:text-sm font-extrabold ${
                  mostraMina ? (aberta ? 'bg-red-500' : 'bg-red-200')
                  : aberta ? 'bg-surface2'
                  : 'bg-gradient-to-br from-slate-400 to-slate-500 active:from-slate-500'
                }`}>
                {mostraMina ? (aberta ? '💥' : '💣')
                  : bandeira && !aberta ? '🚩'
                  : aberta && n > 0 ? <span className={CORES_NUM[n]}>{n}</span>
                  : ''}
              </button>
            )
          })}
        </div>
      </div>

      <div className="bg-surface2 rounded-xl p-1 flex max-w-[240px] mx-auto select-none">
        {[['cavar', '⛏️ Cavar'], ['bandeira', '🚩 Marcar']].map(([k, lbl]) => (
          <button key={k} onClick={() => setModo(k)}
            className={`flex-1 rounded-lg py-2 text-sm font-bold transition-colors ${modo === k ? 'bg-surface shadow text-ink' : 'text-muted'}`}>
            {lbl}
          </button>
        ))}
      </div>
      <p className="text-[11px] text-faint mt-2">O número mostra quantas minas tem nas casas vizinhas.</p>
    </div>
  )
}

export default JogoCampoMinado
