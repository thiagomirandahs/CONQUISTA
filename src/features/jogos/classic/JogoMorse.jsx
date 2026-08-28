import { useState } from 'react'
import { embaralhar } from '../utils/comum.js'
import * as juice from '../../../lib/juice.js'

// ===================== 📻 Código Morse =====================
// Matéria de verdade do clube: a tabela fica à vista pra APRENDER jogando.
const MORSE = {
  A: '·–', B: '–···', C: '–·–·', D: '–··', E: '·', F: '··–·', G: '––·', H: '····', I: '··',
  J: '·–––', K: '–·–', L: '·–··', M: '––', N: '–·', O: '–––', P: '·––·', Q: '––·–', R: '·–·',
  S: '···', T: '–', U: '··–', V: '···–', W: '·––', X: '–··–', Y: '–·––', Z: '––··',
}
const PALAVRAS_MORSE = ['FOGO', 'MATA', 'NORTE', 'TENDA', 'MAPA', 'CORDA', 'SOL', 'LUA', 'NO', 'SUL']

export default function JogoMorse({ onTerminar, onCancelar }) {
  const [palavras] = useState(() => embaralhar(PALAVRAS_MORSE).slice(0, 3))
  const [i, setI] = useState(0)
  const [resp, setResp] = useState('')
  const [erros, setErros] = useState(0)
  const [aviso, setAviso] = useState('')
  const [fim, setFim] = useState(false)
  const palavra = palavras[i]

  function conferir(e) {
    e.preventDefault()
    if (fim || aviso) return
    const acertou = resp.trim().toUpperCase() === palavra
    const totalErros = erros + (acertou ? 0 : 1)
    if (acertou) juice.acerto(); else { setErros(totalErros); juice.erro() }
    setAviso(acertou ? 'Acertou! ✅' : `Era ${palavra}`)
    setTimeout(() => {
      setAviso(''); setResp('')
      if (i + 1 >= palavras.length) {
        setFim(true)
        onTerminar(totalErros === 0 ? 3 : totalErros === 1 ? 2 : 1)
      } else setI(i + 1)
    }, 1100)
  }

  return (
    <div className="bg-surface rounded-3xl p-4 sm:p-5 shadow-md">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-semibold text-muted">Palavra {i + 1} de {palavras.length}</span>
        <button onClick={onCancelar} className="text-xs text-faint p-3 -m-3">Cancelar</button>
      </div>
      <p className="text-xs text-faint mb-3">Decifre a palavra usando a tabela abaixo 👇</p>

      <div className="bg-brand text-white rounded-2xl p-4 text-center mb-3">
        <div className="text-2xl font-bold tracking-widest break-words leading-relaxed">
          {palavra.split('').map((l) => MORSE[l]).join('   ')}
        </div>
      </div>

      <form onSubmit={conferir} className="flex gap-2 mb-3">
        <input value={resp} onChange={(e) => setResp(e.target.value)} disabled={!!aviso || fim}
          placeholder="Qual é a palavra?" autoCapitalize="characters"
          className="flex-1 rounded-lg border border-line px-3 py-2.5 text-sm uppercase outline-none focus:border-brand focus:ring-2 focus:ring-brand/30" />
        <button type="submit" disabled={!resp.trim() || !!aviso || fim}
          className="rounded-xl bg-brand text-white font-bold px-4 text-sm disabled:opacity-50">Conferir</button>
      </form>
      {aviso && <p className={`text-sm font-bold text-center mb-2 ${aviso.startsWith('Acertou') ? 'text-green-600' : 'text-amber-600'}`}>{aviso}</p>}

      <div className="grid grid-cols-4 gap-1 text-[11px] text-muted">
        {Object.entries(MORSE).map(([l, m]) => (
          <div key={l} className="bg-surface2 rounded px-1 py-0.5 text-center">
            <b className="text-ink">{l}</b> {m}
          </div>
        ))}
      </div>
    </div>
  )
}
