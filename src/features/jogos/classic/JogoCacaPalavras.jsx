import { useState } from 'react'
import * as juice from '../../../lib/juice.js'

// ===================== Caça-palavras =====================
// Monta um quadro NxN com as palavras escondidas e preenche o resto com
// letras aleatórias. Roda 1x na montagem do jogo.
function gerarCaca() {
  const N = 8
  const alvos = ['FOGO', 'TENDA', 'MAPA', 'MATA', 'TROPA', 'NORTE']
  const grid = Array(N * N).fill('')
  const dirs = [[0, 1], [1, 0], [1, 1], [1, -1]] // →  ↓  ↘  ↙
  const colocadas = []
  for (const p of alvos) {
    for (let t = 0; t < 200; t++) {
      const [dr, dc] = dirs[Math.floor(Math.random() * dirs.length)]
      const r0 = Math.floor(Math.random() * N)
      const c0 = Math.floor(Math.random() * N)
      const rf = r0 + dr * (p.length - 1)
      const cf = c0 + dc * (p.length - 1)
      if (rf < 0 || rf >= N || cf < 0 || cf >= N) continue
      let cabe = true
      for (let k = 0; k < p.length; k++) {
        const idx = (r0 + dr * k) * N + (c0 + dc * k)
        if (grid[idx] && grid[idx] !== p[k]) { cabe = false; break }
      }
      if (!cabe) continue
      for (let k = 0; k < p.length; k++) grid[(r0 + dr * k) * N + (c0 + dc * k)] = p[k]
      colocadas.push(p)
      break
    }
  }
  const AZ = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
  for (let i = 0; i < grid.length; i++) if (!grid[i]) grid[i] = AZ[Math.floor(Math.random() * 26)]
  return { N, grid, palavras: colocadas }
}

function JogoCacaPalavras({ onTerminar, onCancelar }) {
  const [jogo] = useState(gerarCaca)
  const { N, grid, palavras } = jogo
  const [sel, setSel] = useState(-1)
  const [achadas, setAchadas] = useState([])
  const [celulas, setCelulas] = useState(() => new Set())
  const [erros, setErros] = useState(0)
  const [fim, setFim] = useState(false)

  // Palavra formada pela linha reta entre duas células (nas duas direções)
  function palavraEntre(a, b) {
    const r1 = Math.floor(a / N), c1 = a % N, r2 = Math.floor(b / N), c2 = b % N
    const reto = r1 === r2 || c1 === c2 || Math.abs(r2 - r1) === Math.abs(c2 - c1)
    if (!reto) return null
    const dr = Math.sign(r2 - r1), dc = Math.sign(c2 - c1)
    const len = Math.max(Math.abs(r2 - r1), Math.abs(c2 - c1)) + 1
    let s = ''; const idxs = []
    for (let k = 0; k < len; k++) { const idx = (r1 + dr * k) * N + (c1 + dc * k); s += grid[idx]; idxs.push(idx) }
    const rev = s.split('').reverse().join('')
    const match = palavras.find((p) => !achadas.includes(p) && (p === s || p === rev))
    return match ? { match, idxs } : null
  }

  function tocar(idx) {
    if (fim) return
    if (sel === -1) { setSel(idx); return }
    if (sel === idx) { setSel(-1); return }
    const res = palavraEntre(sel, idx)
    if (res) {
      const novas = [...achadas, res.match]
      juice.acerto(achadas.length)
      setAchadas(novas)
      setCelulas((cs) => { const n = new Set(cs); res.idxs.forEach((i) => n.add(i)); return n })
      setSel(-1)
      if (novas.length === palavras.length) {
        setFim(true)
        const est = erros <= 2 ? 3 : erros <= 5 ? 2 : 1
        setTimeout(() => onTerminar(est), 700)
      }
    } else {
      juice.erro()
      setErros((e) => e + 1)
      setSel(-1)
    }
  }

  return (
    <div className="bg-surface rounded-3xl p-4 sm:p-5 shadow-md">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-semibold text-muted">{achadas.length}/{palavras.length} achadas</span>
        <button onClick={onCancelar} className="text-xs text-faint p-3 -m-3">Cancelar</button>
      </div>
      <p className="text-xs text-faint mb-3">{fim ? 'Achou todas! 🎉' : 'Toque na 1ª e na última letra da palavra.'}</p>
      <div className="grid gap-1 mx-auto max-w-[320px]" style={{ gridTemplateColumns: `repeat(${N}, 1fr)` }}>
        {grid.map((ch, i) => {
          const achada = celulas.has(i)
          const sela = sel === i
          return (
            <button key={i} onClick={() => tocar(i)} disabled={fim}
              className={`aspect-square rounded-md text-xs sm:text-sm font-extrabold grid place-items-center transition-colors ${
                achada ? 'bg-green-500 text-white' : sela ? 'bg-brand text-white' : 'bg-surface2 text-ink'
              }`}>
              {ch}
            </button>
          )
        })}
      </div>
      <div className="flex flex-wrap gap-1.5 justify-center mt-3">
        {palavras.map((p) => (
          <span key={p} className={`text-xs font-bold rounded-full px-2.5 py-1 ${achadas.includes(p) ? 'bg-green-100 text-green-700 line-through' : 'bg-surface2 text-muted'}`}>{p}</span>
        ))}
      </div>
    </div>
  )
}

export default JogoCacaPalavras
