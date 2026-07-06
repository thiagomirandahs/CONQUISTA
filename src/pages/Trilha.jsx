import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import confetti from 'canvas-confetti'
import { useAuth } from '../context/Auth.jsx'
import { carregarTrilha, registrarJogo } from '../lib/dados.js'

// Os 6 postos da trilha = as 6 classes (cores oficiais dos lenços)
const POSTOS = [
  { nome: 'Fogueira', classe: 'Amigo', cor: '#1d4ed8', icon: '🔥' },
  { nome: 'Ponte de Cordas', classe: 'Companheiro', cor: '#dc2626', icon: '🌉' },
  { nome: 'Trilha na Mata', classe: 'Pesquisador', cor: '#16a34a', icon: '🥾' },
  { nome: 'Torre de Vigia', classe: 'Pioneiro', cor: '#6b7280', icon: '🗼' },
  { nome: 'Travessia do Rio', classe: 'Excursionista', cor: '#7c3aed', icon: '🛶' },
  { nome: 'Cume', classe: 'Guia', cor: '#d97706', icon: '🏔️' },
]
const PARES = ['🧭', '🧣', '🪢', '🔥', '📖', '⛺']

function embaralhar(arr) {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}
const CORES_FESTA = ['#1e3a8a', '#f5c518', '#ffffff', '#10b981', '#d97706']
function festa() {
  confetti({ particleCount: 130, spread: 80, origin: { y: 0.4 }, colors: CORES_FESTA })
}
// Festa grande de quem conquistou a Trilha inteira (fim de temporada)
function festaGrande() {
  confetti({ particleCount: 170, spread: 100, origin: { y: 0.35 }, colors: CORES_FESTA })
  setTimeout(() => confetti({ particleCount: 90, angle: 60, spread: 75, origin: { x: 0, y: 0.6 }, colors: CORES_FESTA }), 200)
  setTimeout(() => confetti({ particleCount: 90, angle: 120, spread: 75, origin: { x: 1, y: 0.6 }, colors: CORES_FESTA }), 380)
}

export default function Trilha() {
  const { profile } = useAuth()
  const [carregando, setCarregando] = useState(true)
  const [prog, setProg] = useState({ feito: false, passos: 0 })
  const [jogando, setJogando] = useState(false)
  const [resultado, setResultado] = useState(null)

  useEffect(() => { if (profile?.id) recarregar() }, [profile?.id]) // eslint-disable-line
  async function recarregar() {
    setCarregando(true)
    try { setProg(await carregarTrilha()) } finally { setCarregando(false) }
  }

  const posto = prog.passos % POSTOS.length
  const medalhas = Math.floor(prog.passos / POSTOS.length) // quantas vezes já completou a Trilha
  const temporada = medalhas + 1
  const conquistouAgora = resultado?.conquistou

  async function aoTerminar(estrelas) {
    try {
      const r = await registrarJogo('memoria', estrelas)
      // Fechou uma volta inteira (chegou ao Cume) = conquistou a Trilha
      const conquistou = r.passos > 0 && r.passos % POSTOS.length === 0
      if (conquistou) festaGrande(); else festa()
      setResultado({ estrelas: r.estrelas, pontos: r.pontos, conquistou, medalhas: Math.floor(r.passos / POSTOS.length) })
      setJogando(false)
      recarregar()
    } catch (e) {
      alert(e?.message || String(e))
      setJogando(false)
    }
  }

  return (
    <div>
      <div className="mb-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h2 className="text-2xl font-extrabold text-slate-800">🗺️ Trilha do Acampamento</h2>
            <p className="text-sm text-slate-500">Jogue o desafio de hoje e avance rumo ao Cume! 🏔️</p>
          </div>
          {medalhas > 0 && (
            <div className="shrink-0 text-center bg-amber-50 border border-dourado/50 rounded-xl px-3 py-1.5" title="Medalhas da Trilha">
              <div className="text-lg leading-none">🏅</div>
              <div className="text-[11px] font-extrabold text-amber-700 mt-0.5">× {medalhas}</div>
            </div>
          )}
        </div>
        <div className="mt-1.5 inline-block text-xs font-bold text-azul bg-azul/10 rounded-full px-2.5 py-0.5">Temporada {temporada}</div>
      </div>

      <div className="bg-white rounded-2xl shadow-sm p-3 mb-4">
        <div className="flex flex-col gap-1.5">
          {POSTOS.map((p, i) => {
            const passado = conquistouAgora || i < posto
            const aqui = !conquistouAgora && i === posto
            return (
              <div key={p.nome} className="flex items-center gap-3 rounded-xl p-2"
                style={aqui ? { boxShadow: `inset 0 0 0 2px ${p.cor}` } : {}}>
                <div className="w-9 h-9 rounded-full grid place-items-center text-lg shrink-0"
                  style={{ backgroundColor: passado || (aqui && prog.feito) ? p.cor : p.cor + '22' }}>
                  {passado || (aqui && prog.feito) ? '✅' : p.icon}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-bold text-slate-800 text-sm truncate">
                    {p.nome} <span className="text-[11px] font-semibold" style={{ color: p.cor }}>({p.classe})</span>
                  </div>
                </div>
                {aqui && <span className="text-xl">📍</span>}
              </div>
            )
          })}
        </div>
      </div>

      {carregando ? (
        <p className="text-slate-400 text-sm">Carregando...</p>
      ) : conquistouAgora ? (
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
          className="rounded-2xl p-8 shadow-sm text-center border-2 border-dourado bg-gradient-to-b from-amber-50 to-white">
          <motion.div initial={{ scale: 0, rotate: -30 }} animate={{ scale: 1, rotate: 0 }}
            transition={{ type: 'spring', stiffness: 260, damping: 13 }} className="text-7xl mb-2">🏅</motion.div>
          <h3 className="text-xl font-extrabold text-slate-800">Você conquistou a Trilha!</h3>
          <p className="text-sm text-slate-500 mt-1">Chegou ao Cume 🏔️ e completou todos os 6 postos.</p>
          <p className="text-amber-700 font-extrabold mt-3">{resultado.medalhas}ª medalha 🏅 · {'⭐'.repeat(resultado.estrelas)}</p>
          <p className="text-sm text-slate-600 mt-3">Amanhã começa a <b>Temporada {resultado.medalhas + 1}</b> — dá pra ganhar ainda mais medalhas! 🚀</p>
        </motion.div>
      ) : prog.feito ? (
        <div className="bg-white rounded-2xl p-6 shadow-sm text-center">
          <div className="text-5xl mb-2">🎉</div>
          <p className="font-bold text-slate-800">Você já jogou hoje!</p>
          {resultado && <p className="text-sm text-dourado font-bold mt-1">+{resultado.pontos} pontos · {'⭐'.repeat(resultado.estrelas)}</p>}
          <p className="text-sm text-slate-400 mt-1">Volte amanhã pra avançar mais um posto 🙂</p>
        </div>
      ) : jogando ? (
        <JogoMemoria onTerminar={aoTerminar} onCancelar={() => setJogando(false)} />
      ) : (
        <div className="bg-white rounded-2xl p-6 shadow-sm text-center">
          <div className="text-5xl mb-2">🧠</div>
          <p className="font-bold text-slate-800 mb-1">Jogo da Memória</p>
          {posto === 0 && medalhas > 0 && (
            <p className="text-xs font-extrabold text-azul mb-2">🚀 Temporada {temporada} começando — vá pela Fogueira! 🔥</p>
          )}
          <p className="text-sm text-slate-400 mb-4">Ache os pares dos itens do desbravador. Menos tentativas = mais estrelas!</p>
          <motion.button whileTap={{ scale: 0.97 }} onClick={() => setJogando(true)}
            className="bg-azul text-white font-extrabold rounded-xl px-6 py-3 shadow">🎮 Jogar (+10)</motion.button>
        </div>
      )}
    </div>
  )
}

function JogoMemoria({ onTerminar, onCancelar }) {
  const [cartas] = useState(() => embaralhar(PARES.flatMap((e, i) => [{ id: i + '-a', emoji: e }, { id: i + '-b', emoji: e }])))
  const [viradas, setViradas] = useState([])
  const [achadas, setAchadas] = useState([])
  const [jogadas, setJogadas] = useState(0)
  const [bloqueado, setBloqueado] = useState(false)

  function clicar(i) {
    if (bloqueado || viradas.includes(i) || achadas.includes(cartas[i].emoji)) return
    const novas = [...viradas, i]
    setViradas(novas)
    if (novas.length === 2) {
      const total = jogadas + 1
      setJogadas(total)
      setBloqueado(true)
      const [a, b] = novas
      if (cartas[a].emoji === cartas[b].emoji) {
        const novoAchadas = [...achadas, cartas[a].emoji]
        setTimeout(() => {
          setAchadas(novoAchadas)
          setViradas([])
          setBloqueado(false)
          if (novoAchadas.length === PARES.length) {
            const estrelas = total <= 8 ? 3 : total <= 11 ? 2 : 1
            setTimeout(() => onTerminar(estrelas), 400)
          }
        }, 500)
      } else {
        setTimeout(() => { setViradas([]); setBloqueado(false) }, 800)
      }
    }
  }

  return (
    <div className="bg-white rounded-2xl p-4 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-semibold text-slate-600">Tentativas: {jogadas}</span>
        <button onClick={onCancelar} className="text-xs text-slate-400">Cancelar</button>
      </div>
      <div className="grid grid-cols-4 gap-2">
        {cartas.map((c, i) => {
          const aberta = viradas.includes(i) || achadas.includes(c.emoji)
          return (
            <motion.button key={c.id} onClick={() => clicar(i)} whileTap={{ scale: 0.95 }}
              className={`aspect-square rounded-xl text-2xl grid place-items-center border-2 transition-colors ${aberta ? 'bg-azul/10 border-azul' : 'bg-slate-100 border-slate-200'}`}>
              {aberta ? c.emoji : '❓'}
            </motion.button>
          )
        })}
      </div>
    </div>
  )
}
