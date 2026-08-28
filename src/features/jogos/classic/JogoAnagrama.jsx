import { useState } from 'react'
import { embaralhar } from '../utils/comum.js'
import * as juice from '../../../lib/juice.js'
import { PedirAjuda } from '../../../components/Ajuda.jsx'

// ===================== 🔤 Anagrama =====================
const PALAVRAS_ANAGRAMA = [
  'ACAMPAMENTO', 'FOGUEIRA', 'BUSSOLA', 'MOCHILA', 'BARRACA',
  'UNIFORME', 'LANTERNA', 'BANDEIRA', 'CAMINHADA', 'CANIVETE',
]
function embaralharPalavra(p) {
  let s = embaralhar(p.split('')).join('')
  // garante que não saiu igual à original
  for (let i = 0; i < 5 && s === p; i++) s = embaralhar(p.split('')).join('')
  return s
}

export default function JogoAnagrama({ onTerminar, onCancelar }) {
  const [rodadas] = useState(() => embaralhar(PALAVRAS_ANAGRAMA).slice(0, 3).map((p) => ({
    palavra: p, embaralhada: embaralharPalavra(p),
  })))
  const [i, setI] = useState(0)
  const [resp, setResp] = useState('')
  const [erros, setErros] = useState(0)
  const [aviso, setAviso] = useState('')
  const [fim, setFim] = useState(false)
  const q = rodadas[i]

  function conferir(e) {
    e.preventDefault()
    if (fim || aviso) return
    const ok = resp.trim().toUpperCase() === q.palavra
    const total = erros + (ok ? 0 : 1)
    if (ok) juice.acerto(); else { setErros(total); juice.erro() }
    setAviso(ok ? 'Acertou! ✅' : `Era ${q.palavra}`)
    setTimeout(() => {
      setAviso(''); setResp('')
      if (i + 1 >= rodadas.length) {
        setFim(true)
        onTerminar(total === 0 ? 3 : total === 1 ? 2 : 1)
      } else setI(i + 1)
    }, 1200)
  }
  function ajudado(r) {
    if (fim || aviso) return
    setFim(true); setAviso(`Um amigo te ajudou! Era ${r || q.palavra} 🤝`)
    setTimeout(() => onTerminar(1), 1600) // usou ajuda = 1 estrela
  }

  return (
    <div className="bg-surface rounded-3xl p-4 sm:p-5 shadow-md text-center">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-semibold text-muted">Palavra {i + 1} de {rodadas.length}</span>
        <button onClick={onCancelar} className="text-xs text-faint p-3 -m-3">Cancelar</button>
      </div>
      <p className="text-xs text-faint mb-3">Desembaralhe a palavra do clube 🏕️</p>

      <div className="flex flex-wrap justify-center gap-1.5 my-4">
        {q.embaralhada.split('').map((l, k) => (
          <span key={k} className="w-8 h-10 rounded-lg bg-brand/10 text-brand grid place-items-center text-lg font-extrabold">{l}</span>
        ))}
      </div>

      <form onSubmit={conferir} className="flex gap-2">
        <input value={resp} onChange={(e) => setResp(e.target.value)} disabled={!!aviso || fim}
          placeholder="Qual é a palavra?" autoCapitalize="characters"
          className="flex-1 rounded-lg border border-line px-3 py-2.5 text-sm uppercase outline-none focus:border-brand focus:ring-2 focus:ring-brand/30" />
        <button type="submit" disabled={!resp.trim() || !!aviso || fim}
          className="rounded-xl bg-brand text-white font-bold px-4 text-sm disabled:opacity-50">Conferir</button>
      </form>
      {!fim && !aviso && (
        <div className="mt-3">
          <PedirAjuda jogo="anagrama" resposta={q.palavra} onAjudado={ajudado}
            enunciado={{ tipo: 'anagrama', letras: q.embaralhada, dica: 'Palavra do clube' }} />
        </div>
      )}
      {aviso && <p className={`text-sm font-bold mt-3 ${aviso.startsWith('Acertou') ? 'text-green-600' : 'text-amber-600'}`}>{aviso}</p>}
    </div>
  )
}
