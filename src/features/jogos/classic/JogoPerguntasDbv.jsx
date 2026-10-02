import { useEffect, useRef, useState } from 'react'
import { m as motion } from 'framer-motion'
import { embaralhar } from '../utils/comum.js'
import * as juice from '../../../lib/juice.js'
import { perguntasQuiz, afirmacoesVF, pistasDeClasse } from '../conteudo/dbv.js'

// ===================== Jogos de perguntas do ecossistema DBV =====================
// Um só motor (múltipla escolha com explicação) e três jogos em cima dele. O conteúdo vem de
// conteudo/dbv.js, conferido contra o manifesto das Classes. Sorteia `rodadas` perguntas por partida.
// Estrelas: todas certas = 3, ao menos 2/3 = 2, senão 1 (mesma régua do Quiz dos Nós).
const ATRASO_MS = 1800

export function estrelasDe(acertos, total) {
  return acertos >= total ? 3 : acertos >= Math.ceil((total * 2) / 3) ? 2 : 1
}

function Perguntas({ banco, emoji, rodadas = 6, embaralharOpcoes = true, onTerminar, onCancelar }) {
  const [lista] = useState(() => embaralhar(banco()).slice(0, rodadas).map((q) => {
    const certa = q.o[q.c]
    return { p: q.p, opcoes: embaralharOpcoes ? embaralhar(q.o) : q.o, certa, e: q.e }
  }))
  const [n, setN] = useState(0)
  const [acertos, setAcertos] = useState(0)
  const [feedback, setFeedback] = useState(null)
  const [fim, setFim] = useState(false)
  const timer = useRef(null)
  useEffect(() => () => clearTimeout(timer.current), [])
  const q = lista[n]

  function responder(op) {
    if (fim || feedback) return
    const ok = op === q.certa
    const total = acertos + (ok ? 1 : 0)
    if (ok) { setAcertos(total); juice.acerto(acertos) } else juice.erro()
    setFeedback({ ok, escolhida: op })
    timer.current = setTimeout(() => {
      setFeedback(null)
      if (n + 1 >= lista.length) {
        setFim(true)
        onTerminar(estrelasDe(total, lista.length))
      } else setN(n + 1)
    }, ATRASO_MS)
  }

  const duas = q.opcoes.length === 2
  return (
    <div className="bg-surface rounded-3xl p-4 sm:p-5 shadow-md">
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-semibold text-muted">Pergunta {n + 1} de {lista.length}</span>
        <button onClick={onCancelar} className="text-xs text-faint p-3 -m-3">Cancelar</button>
      </div>
      <div className="text-center text-4xl mb-2">{emoji}</div>
      <p className="text-ink font-semibold text-center mb-4">{q.p}</p>
      <div className={duas ? 'grid grid-cols-2 gap-2' : 'space-y-2'}>
        {q.opcoes.map((op) => {
          const mostrando = !!feedback
          const eCerta = mostrando && op === q.certa
          const eErrada = mostrando && op === feedback.escolhida && !feedback.ok
          return (
            <motion.button key={op} whileTap={{ scale: 0.98 }} onClick={() => responder(op)} disabled={mostrando || fim}
              className={`w-full min-h-[44px] rounded-xl py-3 px-3 text-sm font-semibold text-left disabled:opacity-100 ${duas ? 'text-center' : ''} ${
                eCerta ? 'bg-green-100 text-green-800 ring-2 ring-green-500' : eErrada ? 'bg-red-100 text-red-800 ring-2 ring-red-400' : 'bg-surface2 text-ink'
              } ${mostrando && !eCerta && !eErrada ? 'opacity-60' : ''}`}>
              {op}
            </motion.button>
          )
        })}
      </div>
      {feedback && (
        <div role="status" className="mt-3 text-center">
          <p className={`text-sm font-bold ${feedback.ok ? 'text-green-600' : 'text-amber-600'}`}>
            {feedback.ok ? 'Isso! ✅' : `Era: ${q.certa}`}
          </p>
          {q.e && <p className="text-xs text-muted mt-1">{q.e}</p>}
        </div>
      )}
      <p className="text-xs text-faint text-center mt-2">Acertos: {acertos}</p>
    </div>
  )
}

export function JogoQuizDbv(p) {
  return <Perguntas banco={perguntasQuiz} emoji="🧭" {...p} />
}
export function JogoVerdadeiroFalsoDbv(p) {
  return <Perguntas banco={afirmacoesVF} emoji="⚖️" rodadas={7} embaralharOpcoes={false} {...p} />
}
export function JogoQualClasseDbv(p) {
  return <Perguntas banco={pistasDeClasse} emoji="🎖️" rodadas={5} embaralharOpcoes={false} {...p} />
}
