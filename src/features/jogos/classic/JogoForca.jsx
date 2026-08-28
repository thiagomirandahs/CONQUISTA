import { useState } from 'react'
import { motion } from 'framer-motion'
import * as juice from '../../../lib/juice.js'
import { PedirAjuda } from '../../../components/Ajuda.jsx'

// ===================== 🎯 Forca =====================
const PALAVRAS_FORCA = [
  'ACAMPAMENTO', 'DESBRAVADOR', 'BUSSOLA', 'FOGUEIRA', 'UNIFORME',
  'ESPECIALIDADE', 'LANTERNA', 'MOCHILA', 'BARRACA', 'CANIVETE',
  'CANTINA', 'BANDEIRA', 'CONSELHEIRO', 'INVESTIDURA', 'CAMINHADA',
]
const ALFABETO = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')

export default function JogoForca({ onTerminar, onCancelar }) {
  const VIDAS = 6
  const [palavra] = useState(() => PALAVRAS_FORCA[Math.floor(Math.random() * PALAVRAS_FORCA.length)])
  const [usadas, setUsadas] = useState([])
  const [fim, setFim] = useState(false)
  const [msg, setMsg] = useState('')

  const erradas = usadas.filter((l) => !palavra.includes(l))
  const vidas = VIDAS - erradas.length
  const mascara = palavra.split('').map((l) => (usadas.includes(l) ? l : '_')).join(' ')

  function tentar(l) {
    if (fim || usadas.includes(l)) return
    const novas = [...usadas, l]
    setUsadas(novas)
    if (palavra.includes(l)) juice.acerto(); else juice.erro()
    const err = novas.filter((x) => !palavra.includes(x)).length
    const ganhou = palavra.split('').every((x) => novas.includes(x))
    if (ganhou) {
      setFim(true); setMsg('Você descobriu! 🎉')
      setTimeout(() => onTerminar(err <= 1 ? 3 : err <= 3 ? 2 : 1), 900)
    } else if (err >= VIDAS) {
      setFim(true); setMsg(`Acabaram as vidas! Era ${palavra}`)
      setTimeout(() => onTerminar(1), 1400)
    }
  }
  function ajudado(resp) {
    if (fim) return
    setFim(true); setMsg(`Um amigo te ajudou! Era ${resp || palavra} 🤝`)
    setTimeout(() => onTerminar(1), 1600) // usou ajuda = 1 estrela
  }

  return (
    <div className="bg-surface rounded-3xl p-4 sm:p-5 shadow-md text-center">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-semibold text-muted">
          {'❤️'.repeat(Math.max(0, vidas))}{'🖤'.repeat(Math.min(VIDAS, erradas.length))}
        </span>
        <button onClick={onCancelar} className="text-xs text-faint p-3 -m-3">Cancelar</button>
      </div>
      <p className="text-xs text-faint mb-3">Adivinhe a palavra do mundo desbravador</p>

      <div className="flex flex-wrap justify-center gap-1.5 mb-4">
        {palavra.split('').map((l, k) => {
          const mostra = usadas.includes(l) || fim
          return (
            <motion.span key={k} animate={mostra ? { scale: [0.6, 1.15, 1] } : {}}
              className={`w-7 h-10 rounded-lg grid place-items-center text-xl font-extrabold ${
                mostra ? 'bg-brand/10 text-brand border-b-4 border-brand' : 'bg-surface2 border-b-4 border-line'
              }`}>
              {mostra ? l : ''}
            </motion.span>
          )
        })}
      </div>

      {msg && <p className={`text-sm font-bold mb-2 ${msg.startsWith('Você') ? 'text-green-600' : 'text-amber-600'}`}>{msg}</p>}

      {!fim && (
        <div className="mb-3">
          <PedirAjuda jogo="forca" resposta={palavra} onAjudado={ajudado}
            enunciado={{ tipo: 'forca', mascara, tema: 'mundo desbravador' }} />
        </div>
      )}

      <div className="grid grid-cols-7 gap-1">
        {ALFABETO.map((l) => {
          const usada = usadas.includes(l)
          const certa = usada && palavra.includes(l)
          return (
            <button key={l} onClick={() => tentar(l)} disabled={usada || fim}
              className={`aspect-square rounded-lg text-sm font-extrabold ${
                !usada ? 'bg-surface2 text-ink' : certa ? 'bg-green-500 text-white' : 'bg-surface2 text-white'
              } disabled:opacity-70`}>
              {l}
            </button>
          )
        })}
      </div>
    </div>
  )
}
