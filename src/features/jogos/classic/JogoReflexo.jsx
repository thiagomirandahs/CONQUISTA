import { useState, useEffect, useRef } from 'react'
import { motion } from 'framer-motion'
import { embaralhar } from '../utils/comum.js'
import { registrarRecorde } from '../../../lib/dados.js'

const EMOJIS_REFLEXO = ['🔥', '⛺', '🧭', '📖', '⭐', '🍎', '🐍', '🦅', '🥾', '🪢', '💧', '🌙']

// Progressão: começa com 1 item e entra MAIS UM a cada nível (um item por
// rodada), até a grade encher com os 12 itens. Depois disso, o que aperta é o
// tempo. Itens sempre iguais e alinhados na grade (como era antes).
const qtdReflexo = (nv) => Math.min(EMOJIS_REFLEXO.length, 1 + nv)

export default function JogoReflexo({ onTerminar, onCancelar }) {
  const [nivel, setNivel] = useState(0)
  const [alvo, setAlvo] = useState(null)
  const [grade, setGrade] = useState([]) // emojis da rodada (o alvo está entre eles)
  const [rodadaId, setRodadaId] = useState(0) // muda a cada rodada (reinicia o timer)
  const [fim, setFim] = useState(false)
  const [resultado, setResultado] = useState(null) // { recorde, melhorou } | 'erro'
  const timerRef = useRef(null)

  // Calibragem (dono): tem que dar pra passar de 100 jogando de verdade.
  // Começa em 4s, aperta só 25ms por nível e NUNCA fica abaixo de 2s.
  const tempo = Math.max(2000, 4000 - nivel * 25)

  function novaRodada(nv) {
    const qtd = qtdReflexo(nv)
    const itens = embaralhar(EMOJIS_REFLEXO).slice(0, qtd) // itens únicos na grade
    setGrade(itens)
    setAlvo(itens[Math.floor(Math.random() * itens.length)])
    setRodadaId((r) => r + 1)
  }
  useEffect(() => { novaRodada(0) }, []) // eslint-disable-line

  // Estourou o tempo = fim de jogo
  useEffect(() => {
    if (fim || alvo === null) return
    timerRef.current = setTimeout(() => encerrar(nivel), tempo)
    return () => clearTimeout(timerRef.current)
  }, [rodadaId, fim]) // eslint-disable-line

  function tocar(e) {
    if (fim) return
    clearTimeout(timerRef.current)
    if (e === alvo) {
      const nv = nivel + 1
      setNivel(nv)
      novaRodada(nv)
    } else {
      encerrar(nivel)
    }
  }

  async function encerrar(pontos) {
    if (fim) return
    setFim(true)
    try {
      setResultado(await registrarRecorde('reflexo', pontos))
    } catch {
      setResultado('erro') // offline/SQL não rodado: a corrida não vira recorde
    }
  }

  function deNovo() {
    setNivel(0)
    setFim(false)
    setResultado(null)
    novaRodada(0)
  }

  // Colunas e tamanho do emoji acompanham a quantidade (item grande quando é
  // pouco; encolhe conforme a grade enche) — sempre alinhados e proporcionais.
  const cols = grade.length === 1 ? 1 : grade.length <= 4 ? 2 : 3
  const tamEmoji = cols === 1 ? 'text-[86px]' : cols === 2 ? 'text-5xl' : 'text-4xl'

  return (
    <div className="bg-surface rounded-3xl p-4 sm:p-5 shadow-md text-center">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-extrabold text-muted">⚡ Nível {nivel}</span>
        <button onClick={onCancelar} className="text-xs text-faint p-3 -m-3">Sair</button>
      </div>

      {fim ? (
        <div className="py-4">
          <div className="text-5xl mb-2">🏁</div>
          <p className="font-extrabold text-ink text-lg">Você chegou ao nível {nivel}!</p>
          {resultado === 'erro' ? (
            <p className="text-xs text-faint mt-1">Não deu pra salvar o recorde (sem internet?).</p>
          ) : resultado?.fora ? (
            <p className="text-sm font-bold text-muted mt-1">Boa! 🙂 (a liderança joga, mas fica fora do ranking)</p>
          ) : resultado ? (
            <p className={`text-sm font-bold mt-1 ${resultado.melhorou ? 'text-green-600' : 'text-muted'}`}>
              {resultado.melhorou ? '🚀 NOVO recorde seu da semana!' : `Seu recorde da semana: ${resultado.recorde}`}
            </p>
          ) : (
            <p className="text-xs text-faint mt-1">Salvando recorde…</p>
          )}
          {!resultado?.fora && (
            <p className="text-[11px] text-faint mt-2">O maior recorde da semana ganha <b>+20 pontos</b> no domingo!</p>
          )}
          <div className="flex gap-2 mt-4 max-w-[280px] mx-auto">
            <button onClick={onCancelar} className="flex-1 rounded-xl bg-surface2 text-ink font-semibold py-2.5">Sair</button>
            <button onClick={deNovo} className="flex-1 rounded-xl bg-brand text-white font-extrabold py-2.5">🔁 De novo</button>
          </div>
        </div>
      ) : (
        <>
          <p className="text-ink font-bold mb-2">Toque no <span className="text-3xl align-middle">{alvo}</span></p>
          {/* Barra do tempo da rodada (encolhe até zerar) */}
          <div className="h-2 bg-surface2 rounded-full overflow-hidden max-w-[280px] mx-auto mb-3">
            <motion.div key={rodadaId} initial={{ scaleX: 1 }} animate={{ scaleX: 0 }}
              transition={{ duration: tempo / 1000, ease: 'linear' }}
              className="h-full bg-brand rounded-full origin-left" />
          </div>
          <div className="grid gap-2 mx-auto max-w-[280px] select-none" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
            {grade.map((e, i) => (
              <motion.button key={rodadaId + '-' + i} whileTap={{ scale: 0.92 }} onClick={() => tocar(e)}
                className={`aspect-square rounded-2xl bg-surface2 hover:bg-surface2 grid place-items-center shadow-sm ${tamEmoji}`}>
                {e}
              </motion.button>
            ))}
          </div>
          <p className="text-[11px] text-faint mt-3">Sem limite de jogadas — cada corrida pode virar seu recorde da semana. 🚀</p>
        </>
      )}
    </div>
  )
}
