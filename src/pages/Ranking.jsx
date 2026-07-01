import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import confetti from 'canvas-confetti'
import Avatar from '../components/Avatar.jsx'
import Contador from '../components/Contador.jsx'
import { carregarRanking } from '../lib/dados.js'

const medalhas = ['🥇', '🥈', '🥉']

function festa() {
  confetti({ particleCount: 130, spread: 80, origin: { y: 0.35 }, colors: ['#1e3a8a', '#f5c518', '#ffffff', '#1d4ed8'] })
}
function tituloDivertido(pos) {
  if (pos === 0) return '👑 Campeão(ã) do clube!'
  if (pos === 1) return '🥈 Quase no topo!'
  if (pos === 2) return '🥉 No pódio!'
  if (pos < 5) return '🔥 Subindo forte!'
  return '⭐ Mandando bem!'
}

export default function Ranking() {
  const [aba, setAba] = useState('unidades')
  const [card, setCard] = useState(null)
  const [dados, setDados] = useState({ unidades: [], individual: [] })
  const [carregando, setCarregando] = useState(true)

  useEffect(() => {
    carregarRanking().then((d) => { setDados(d); setCarregando(false) })
  }, [])

  const ehUnidade = aba === 'unidades'
  const lista = ehUnidade ? dados.unidades : dados.individual
  const valor = (i) => (ehUnidade ? i.pontos : i.pts)
  const max = Math.max(1, ...lista.map(valor))
  const top3 = lista.slice(0, 3)
  const pedestal = [top3[1], top3[0], top3[2]]
    .map((item, idx) => (item ? { item, pos: idx === 1 ? 0 : idx === 0 ? 1 : 2 } : null))
    .filter(Boolean)

  // Confete só quando há pontuação
  useEffect(() => {
    if (!carregando && lista.some((i) => valor(i) > 0)) {
      const t = setTimeout(festa, 350)
      return () => clearTimeout(t)
    }
  }, [aba, carregando]) // eslint-disable-line

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-extrabold text-slate-800">🏆 Ranking</h2>
          <p className="text-sm text-slate-500">Quem tá mandando bem? ⭐</p>
        </div>
        <motion.button whileTap={{ scale: 0.9 }} whileHover={{ scale: 1.05 }} onClick={festa}
          className="bg-dourado text-azul font-bold rounded-full px-4 py-2 text-sm shadow">🎉 Comemorar</motion.button>
      </div>

      <div className="relative bg-white rounded-xl p-1 flex shadow-sm mb-5 max-w-sm">
        {[['unidades', '🛡️ Unidades'], ['individual', '🧒 Individual']].map(([key, label]) => (
          <button key={key} onClick={() => setAba(key)} className="relative flex-1 py-2 text-sm font-bold">
            {aba === key && <motion.span layoutId="rank-pill" className="absolute inset-0 bg-azul rounded-lg" transition={{ type: 'spring', stiffness: 400, damping: 32 }} />}
            <span className={`relative z-10 ${aba === key ? 'text-white' : 'text-slate-500'}`}>{label}</span>
          </button>
        ))}
      </div>

      {carregando ? (
        <p className="text-slate-400 text-sm">Carregando...</p>
      ) : lista.length === 0 ? (
        <div className="bg-white rounded-2xl p-8 text-center shadow-sm">
          <div className="text-4xl mb-2">🏁</div>
          <p className="font-semibold text-slate-700">Ranking ainda vazio</p>
          <p className="text-sm text-slate-400">Os pontos vão aparecer quando as atividades começarem a ser entregues e aprovadas.</p>
        </div>
      ) : (
        <>
          {/* Pódio */}
          <motion.div key={'podio-' + aba} className="grid grid-cols-3 gap-2 mb-6 items-end"
            initial="hide" animate="show" variants={{ show: { transition: { staggerChildren: 0.12 } } }}>
            {pedestal.map(({ item, pos }) => {
              const corMedalha = pos === 0 ? '#f5c518' : pos === 1 ? '#9ca3af' : '#b45309'
              return (
                <motion.button key={item.id} onClick={() => { setCard({ item, pos }); if (pos === 0) festa() }}
                  variants={{ hide: { opacity: 0, y: 40, scale: 0.8 }, show: { opacity: 1, y: 0, scale: 1 } }}
                  transition={{ type: 'spring', stiffness: 300, damping: 18 }}
                  whileHover={{ y: -6 }} whileTap={{ scale: 0.95 }} className="flex flex-col items-center">
                  {pos === 0 && (
                    <motion.div className="text-3xl" animate={{ y: [0, -7, 0] }} transition={{ repeat: Infinity, duration: 1.4, ease: 'easeInOut' }}>👑</motion.div>
                  )}
                  <div className="relative">
                    <Avatar foto={item.foto} nome={item.nome} cor={item.cor} size={pos === 0 ? 'w-20 h-20' : 'w-14 h-14'} textSize={pos === 0 ? 'text-3xl' : 'text-xl'} />
                    <span className="absolute -bottom-1 -right-1 text-xl drop-shadow">{medalhas[pos]}</span>
                  </div>
                  <div className="font-bold text-slate-800 text-xs mt-1 truncate max-w-[90px]">{item.nome}</div>
                  <div className="text-azul font-extrabold text-lg leading-none"><Contador value={valor(item)} /></div>
                  <div className={`${pos === 0 ? 'h-24' : pos === 1 ? 'h-16' : 'h-12'} w-full rounded-t-xl mt-1 grid place-items-start justify-center pt-1`}
                    style={{ backgroundColor: corMedalha + '33' }}>
                    <span className="text-xs font-extrabold" style={{ color: corMedalha }}>{pos + 1}º</span>
                  </div>
                </motion.button>
              )
            })}
          </motion.div>

          {/* Lista */}
          <motion.div key={'lista-' + aba} className="bg-white rounded-2xl shadow-sm p-2"
            initial="hide" animate="show" variants={{ show: { transition: { staggerChildren: 0.06 } } }}>
            {lista.map((item, i) => (
              <motion.button key={item.id} onClick={() => setCard({ item, pos: i })}
                variants={{ hide: { opacity: 0, x: -20 }, show: { opacity: 1, x: 0 } }}
                whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.98 }}
                className="w-full flex items-center gap-3 px-2 py-2.5 rounded-xl hover:bg-slate-50 text-left">
                <span className="w-5 text-center font-extrabold text-slate-400">{i + 1}</span>
                <Avatar foto={item.foto} nome={item.nome} cor={item.cor} size="w-10 h-10" textSize="text-base" />
                <div className="flex-1 min-w-0">
                  <div className="font-bold text-slate-800 text-sm truncate">{item.nome}</div>
                  <div className="h-2 rounded-full bg-slate-100 overflow-hidden mt-1">
                    <motion.div className="h-full rounded-full" style={{ backgroundColor: item.cor }}
                      initial={{ width: 0 }} animate={{ width: `${(valor(item) / max) * 100}%` }}
                      transition={{ duration: 0.8, ease: 'easeOut', delay: 0.15 + i * 0.05 }} />
                  </div>
                  {item.unidade && <div className="text-[11px] text-slate-400 mt-0.5">{item.unidade}</div>}
                </div>
                <span className="font-extrabold text-azul w-10 text-right"><Contador value={valor(item)} /></span>
              </motion.button>
            ))}
          </motion.div>
        </>
      )}

      <AnimatePresence>
        {card && (
          <motion.div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-0 sm:p-6"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setCard(null)}>
            <motion.div onClick={(e) => e.stopPropagation()}
              initial={{ y: 60, opacity: 0, scale: 0.95 }} animate={{ y: 0, opacity: 1, scale: 1 }} exit={{ y: 60, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 320, damping: 28 }}
              className="bg-white w-full sm:max-w-sm rounded-t-3xl sm:rounded-3xl shadow-2xl overflow-hidden">
              <div className="p-6 text-center text-white relative" style={{ backgroundColor: card.item.cor }}>
                <button onClick={() => setCard(null)} className="absolute top-3 right-3 w-8 h-8 rounded-full bg-white/20 grid place-items-center">✕</button>
                <div className="flex justify-center mb-2">
                  <Avatar foto={card.item.foto} nome={card.item.nome} cor={card.item.cor} size="w-24 h-24" textSize="text-5xl" />
                </div>
                <h3 className="text-xl font-extrabold">{card.item.nome}</h3>
                <p className="text-white/90 text-sm">{tituloDivertido(card.pos)}</p>
              </div>
              <div className="p-5">
                <div className="grid grid-cols-3 gap-2 text-center">
                  <Stat rotulo="Posição" valor={`${card.pos + 1}º`} />
                  <Stat rotulo="Pontos" valor={<Contador value={valor(card.item)} />} destaque />
                  <Stat rotulo={ehUnidade ? 'Membros' : 'Unidade'} valor={ehUnidade ? card.item.membros.length : (card.item.unidade || '—')} />
                </div>
                <button onClick={() => setCard(null)} className="w-full mt-5 bg-azul text-white font-bold rounded-xl py-2.5">Fechar</button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function Stat({ rotulo, valor, destaque }) {
  return (
    <div className="bg-slate-50 rounded-xl py-2">
      <div className={`font-extrabold ${destaque ? 'text-dourado text-lg' : 'text-slate-800 text-sm'} truncate px-1`}>{valor}</div>
      <div className="text-[10px] text-slate-400">{rotulo}</div>
    </div>
  )
}
