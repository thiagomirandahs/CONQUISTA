import { useState, useEffect, useRef } from 'react'

// ===================== 🐍 Cobrinha =====================
const N_COBRA = 12
function novaComidaCobra(corpo) {
  const livres = []
  for (let y = 0; y < N_COBRA; y++) {
    for (let x = 0; x < N_COBRA; x++) {
      if (!corpo.some((s) => s.x === x && s.y === y)) livres.push({ x, y })
    }
  }
  return livres[Math.floor(Math.random() * livres.length)] || { x: 0, y: 0 }
}

export default function JogoCobra({ onTerminar, onCancelar }) {
  const [jogo, setJogo] = useState(() => ({
    cobra: [{ x: 6, y: 6 }], comida: { x: 3, y: 3 }, pontos: 0, fim: false,
  }))
  const dirRef = useRef({ x: 0, y: -1 }) // começa subindo

  // Passo do jogo: tudo calculado dentro do updater (sem efeito colateral).
  useEffect(() => {
    if (jogo.fim) return
    const t = setInterval(() => {
      setJogo((j) => {
        if (j.fim) return j
        const d = dirRef.current
        // ATRAVESSA A PAREDE: some de um lado e volta pelo outro (o % com +N
        // resolve o lado negativo também).
        const cab = {
          x: (j.cobra[0].x + d.x + N_COBRA) % N_COBRA,
          y: (j.cobra[0].y + d.y + N_COBRA) % N_COBRA,
        }
        const comeu = cab.x === j.comida.x && cab.y === j.comida.y
        // Só morre batendo em SI MESMA. O rabo não conta quando não come,
        // porque ele sai da casa no mesmo passo.
        const corpoRisco = comeu ? j.cobra : j.cobra.slice(0, -1)
        if (corpoRisco.some((s) => s.x === cab.x && s.y === cab.y)) return { ...j, fim: true }
        const corpo = [cab, ...j.cobra]
        if (!comeu) corpo.pop()
        return {
          cobra: corpo,
          comida: comeu ? novaComidaCobra(corpo) : j.comida,
          pontos: j.pontos + (comeu ? 1 : 0),
          fim: false,
        }
      })
    }, 230)
    return () => clearInterval(t)
  }, [jogo.fim])

  // Acabou: entrega as estrelas
  useEffect(() => {
    if (!jogo.fim) return
    const t = setTimeout(() => onTerminar(jogo.pontos >= 15 ? 3 : jogo.pontos >= 8 ? 2 : 1), 1000)
    return () => clearTimeout(t)
  }, [jogo.fim]) // eslint-disable-line

  function virar(x, y) {
    const d = dirRef.current
    if (d.x === -x && d.y === -y) return // não pode voltar em cima de si
    dirRef.current = { x, y }
  }

  const ehCobra = (x, y) => jogo.cobra.some((s) => s.x === x && s.y === y)
  const ehCabeca = (x, y) => jogo.cobra[0].x === x && jogo.cobra[0].y === y

  return (
    <div className="bg-surface rounded-3xl p-4 sm:p-5 shadow-md text-center">
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-semibold text-green-600">🍎 {jogo.pontos}</span>
        <button onClick={onCancelar} className="text-xs text-faint p-3 -m-3">Cancelar</button>
      </div>

      {jogo.fim ? (
        <div className="py-8">
          <div className="text-5xl mb-2">🐍</div>
          <p className="font-extrabold text-ink">Fim! Você comeu {jogo.pontos}.</p>
        </div>
      ) : (
        <>
          <div className="bg-emerald-950 rounded-2xl p-1.5 mx-auto max-w-[300px] mb-3 shadow-inner select-none">
            <div className="grid gap-px" style={{ gridTemplateColumns: `repeat(${N_COBRA}, 1fr)` }}>
              {Array.from({ length: N_COBRA * N_COBRA }, (_, i) => {
                const x = i % N_COBRA, y = Math.floor(i / N_COBRA)
                const comida = jogo.comida.x === x && jogo.comida.y === y
                return (
                  <div key={i} className={`aspect-square rounded-[3px] ${
                    ehCabeca(x, y) ? 'bg-lime-300 shadow-[0_0_8px_rgba(163,230,53,0.8)]'
                    : ehCobra(x, y) ? 'bg-lime-500'
                    : comida ? 'bg-red-500 rounded-full animate-pulse'
                    : 'bg-emerald-900/70'
                  }`} />
                )
              })}
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2 max-w-[220px] mx-auto select-none">
            <div />
            <button onClick={() => virar(0, -1)} className="rounded-2xl bg-surface2 active:bg-brand active:text-white py-4 text-2xl font-bold shadow-sm">↑</button>
            <div />
            <button onClick={() => virar(-1, 0)} className="rounded-2xl bg-surface2 active:bg-brand active:text-white py-4 text-2xl font-bold shadow-sm">←</button>
            <button onClick={() => virar(0, 1)} className="rounded-2xl bg-surface2 active:bg-brand active:text-white py-4 text-2xl font-bold shadow-sm">↓</button>
            <button onClick={() => virar(1, 0)} className="rounded-2xl bg-surface2 active:bg-brand active:text-white py-4 text-2xl font-bold shadow-sm">→</button>
          </div>
        </>
      )}
    </div>
  )
}
