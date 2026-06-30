import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import confetti from 'canvas-confetti'
import { useAuth } from '../context/Auth.jsx'
import { carregarDevocional, enviarDevocional } from '../lib/dados.js'

function festa() {
  confetti({ particleCount: 140, spread: 80, origin: { y: 0.4 }, colors: ['#1e3a8a', '#f5c518', '#ffffff', '#10b981'] })
}

export default function CardDevocional() {
  const { profile } = useAuth()
  const [carregando, setCarregando] = useState(true)
  const [versiculo, setVersiculo] = useState(null)
  const [resumo, setResumo] = useState({ feito: false, sequencia: 0, foto: null })
  const [aberto, setAberto] = useState(false)

  async function recarregar() {
    const d = await carregarDevocional()
    setVersiculo(d.versiculo)
    setResumo(d.resumo)
    setCarregando(false)
  }
  useEffect(() => { if (profile?.id) recarregar() }, [profile?.id]) // eslint-disable-line

  if (carregando || !versiculo) return null // sem versículo cadastrado ainda: não mostra nada

  const feito = resumo.feito
  const seq = resumo.sequencia || 0

  return (
    <>
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
        className="rounded-2xl p-4 mb-5 text-white shadow-sm relative overflow-hidden"
        style={{ background: 'linear-gradient(135deg, #1e3a8a, #4338ca)' }}>
        <div className="absolute -top-6 -right-4 text-7xl opacity-15 select-none">📖</div>
        <div className="flex items-center justify-between mb-2 relative">
          <span className="font-extrabold flex items-center gap-2">📖 Devocional do dia</span>
          {seq > 0 && <span className="text-xs font-bold bg-white/15 rounded-full px-2.5 py-1">🔥 {seq} dia{seq > 1 ? 's' : ''}</span>}
        </div>

        <p className="text-[15px] leading-snug relative">"{versiculo.texto}"</p>
        {feito
          ? <p className="text-xs text-blue-100 mt-1 relative">— {versiculo.referencia}</p>
          : <p className="text-xs text-blue-100/70 mt-1 relative">📖 De qual livro será? Descubra no quiz!</p>}

        <div className="mt-3 relative">
          {feito ? (
            <div className="flex items-center gap-3 bg-white/10 rounded-xl p-2">
              {resumo.foto && <img src={resumo.foto} alt="sua foto" className="w-12 h-12 rounded-lg object-cover" />}
              <div className="text-sm font-semibold">✅ Feito hoje! Volte amanhã 🙂</div>
            </div>
          ) : (
            <motion.button whileTap={{ scale: 0.97 }} whileHover={{ scale: 1.02 }} onClick={() => setAberto(true)}
              className="w-full bg-dourado text-azul font-extrabold rounded-xl py-2.5 shadow">
              🙏 Fazer meu devocional (+10)
            </motion.button>
          )}
        </div>
      </motion.div>

      <AnimatePresence>
        {aberto && (
          <ModalDevocional
            versiculo={versiculo}
            userId={profile?.id}
            onFechar={() => setAberto(false)}
            onConcluido={() => { setAberto(false); festa(); recarregar() }}
          />
        )}
      </AnimatePresence>
    </>
  )
}

function ModalDevocional({ versiculo, userId, onFechar, onConcluido }) {
  const opcoes = Array.isArray(versiculo.opcoes) ? versiculo.opcoes : []
  const [resposta, setResposta] = useState(null)
  const [foto, setFoto] = useState(null)
  const [previa, setPrevia] = useState(null)
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState('')

  function escolherFoto(f) {
    setErro('')
    setFoto(f || null)
    setPrevia(f ? URL.createObjectURL(f) : null)
  }

  async function concluir() {
    if (opcoes.length && resposta === null) { setErro('Responda a pergunta do dia.'); return }
    if (!foto) { setErro('Tire/escolha uma foto com a sua Bíblia.'); return }
    setEnviando(true)
    setErro('')
    try {
      const r = await enviarDevocional({ foto, resposta, userId })
      // mostra resultado rápido antes de fechar
      onConcluido(r)
    } catch (e) {
      setErro(e?.message || String(e))
      setEnviando(false)
    }
  }

  return (
    <motion.div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-0 sm:p-6"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onFechar}>
      <motion.div onClick={(e) => e.stopPropagation()}
        initial={{ y: 60, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 60, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 320, damping: 28 }}
        className="bg-white w-full sm:max-w-sm rounded-t-3xl sm:rounded-3xl shadow-2xl overflow-hidden max-h-[90vh] flex flex-col">
        <div className="bg-azul text-white px-5 py-4 flex items-center justify-between">
          <h3 className="font-extrabold">📖 Devocional de hoje</h3>
          <button onClick={onFechar} className="w-8 h-8 rounded-full bg-white/20 grid place-items-center">✕</button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto">
          <div className="bg-slate-50 rounded-xl p-3">
            <p className="text-sm text-slate-700 leading-snug">"{versiculo.texto}"</p>
            <p className="text-[11px] text-slate-400 mt-1">📖 Leia com atenção e responda de qual livro é 👇</p>
          </div>

          {opcoes.length > 0 && (
            <div>
              <p className="text-sm font-semibold text-slate-700 mb-2">❓ {versiculo.pergunta}</p>
              <div className="grid grid-cols-2 gap-2">
                {opcoes.map((op, i) => (
                  <button key={i} type="button" onClick={() => setResposta(i)}
                    className={`rounded-xl py-2 text-sm font-semibold border transition ${resposta === i ? 'bg-azul text-white border-azul' : 'bg-white text-slate-600 border-slate-200'}`}>
                    {op}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div>
            <p className="text-sm font-semibold text-slate-700 mb-1">📷 Foto com a sua Bíblia</p>
            <input type="file" accept="image/*" className="text-sm w-full" onChange={(e) => escolherFoto(e.target.files?.[0])} />
            {previa && <img src={previa} alt="prévia" className="mt-2 w-full max-h-48 object-cover rounded-lg" />}
          </div>

          {erro && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3">{erro}</div>}

          <div className="flex gap-2 pt-1">
            <button onClick={onFechar} className="flex-1 rounded-xl bg-slate-100 text-slate-700 font-semibold py-2.5">Cancelar</button>
            <motion.button onClick={concluir} disabled={enviando} whileTap={{ scale: 0.97 }}
              className="flex-1 rounded-xl bg-azul text-white font-extrabold py-2.5 disabled:opacity-60">
              {enviando ? 'Enviando...' : 'Concluir 🎉'}
            </motion.button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  )
}
