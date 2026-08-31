import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/Auth.jsx'
import { carregarEventos } from '../lib/dados.js'
import { detalhe, curto } from '../lib/eventos.js'

const hojeISO = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
const iconeTipo = { Reunião: '📋', Acampamento: '🏕️', Passeio: '🥾', Culto: '🙏', Evento: '🎉' }
const DIAS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']
function fmtLonga(iso) {
  if (!iso) return ''
  const [a, m, d] = String(iso).slice(0, 10).split('-').map(Number)
  const dt = new Date(a, m - 1, d)
  return `${DIAS[dt.getDay()]}, ${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}`
}
// Só chama a atenção pra eventos que estão CHEGANDO (até 15 dias) ou rolando.
const JANELA_DIAS = 15

// Popup na tela inicial com a contagem regressiva do PRÓXIMO evento (ex.: o
// acampamento). Aparece 1x por dia por evento (dá pra dispensar) e conta ao vivo.
export default function ProximoEventoPopup() {
  const { profile } = useAuth()
  const [ev, setEv] = useState(null)
  const [aberto, setAberto] = useState(false)
  const [agora, setAgora] = useState(Date.now())

  useEffect(() => {
    if (!profile?.id) return
    let vivo = true
    ;(async () => {
      try {
        const lista = await carregarEventos({ futuros: true })
        if (!vivo) return
        const agoraMs = Date.now()
        // primeiro evento que ainda não passou e está dentro da janela (ou rolando)
        const prox = (lista || []).find((e) => {
          const d = detalhe(e, agoraMs)
          return !d.passou && (d.rolando || (d.dias ?? 99) <= JANELA_DIAS)
        })
        if (!prox) return
        let visto = null
        try { visto = localStorage.getItem('popupEvento:' + prox.id) } catch { /* storage bloqueado */ }
        if (visto === hojeISO()) return
        setEv(prox)
        setAberto(true)
      } catch { /* sem eventos = sem popup */ }
    })()
    return () => { vivo = false }
  }, [profile?.id])

  // relógio ao vivo só enquanto o popup está aberto
  useEffect(() => {
    if (!aberto) return
    const t = setInterval(() => setAgora(Date.now()), 1000)
    return () => clearInterval(t)
  }, [aberto])

  function fechar() {
    try { if (ev?.id) localStorage.setItem('popupEvento:' + ev.id, hojeISO()) } catch { /* ignora */ }
    setAberto(false)
  }

  if (!ev) return null
  const det = detalhe(ev, agora)
  const caixas = [['dias', det.dias], ['horas', det.horas], ['min', det.min], ['seg', det.seg]]

  return (
    <AnimatePresence>
      {aberto && (
        <motion.div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[54] flex items-center justify-center p-4"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={fechar}>
          <motion.div onClick={(e) => e.stopPropagation()}
            initial={{ y: 40, opacity: 0, scale: 0.97 }} animate={{ y: 0, opacity: 1, scale: 1 }} exit={{ y: 40, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 320, damping: 28 }}
            className="bg-white w-full max-w-sm rounded-3xl shadow-2xl overflow-hidden text-center">
            <div className="p-5 text-white" style={{ background: 'linear-gradient(135deg,#1e3a8a,#4338ca)' }}>
              <div className="text-4xl mb-1">{iconeTipo[ev.tipo] || '📅'}</div>
              <div className="text-[11px] font-semibold opacity-90">{ev.tipo || 'Evento'} chegando!</div>
              <p className="text-xl font-extrabold leading-tight">{ev.titulo}</p>
            </div>
            <div className="p-5">
              <p className="text-xs text-slate-500 mb-3">
                📅 {fmtLonga(ev.data)}{ev.data_fim ? ` a ${curto(ev.data_fim)}` : ''}{ev.hora ? ` · ${ev.hora}` : ''}
                {ev.local ? ` · 📍 ${ev.local}` : ''}
              </p>

              {det.rolando ? (
                <p className="text-2xl font-extrabold text-green-600 my-4">🔴 Acontecendo agora!</p>
              ) : (
                <div className="flex gap-2 justify-center my-1">
                  {caixas.map(([lbl, val]) => (
                    <div key={lbl} className="bg-slate-100 rounded-xl px-2.5 py-2 min-w-[56px]">
                      <div className="text-2xl font-extrabold text-brand tabular-nums leading-none">{String(val).padStart(2, '0')}</div>
                      <div className="text-[10px] text-slate-500 font-bold uppercase mt-1">{lbl}</div>
                    </div>
                  ))}
                </div>
              )}

              <div className="flex gap-2 mt-5">
                <button onClick={fechar} className="flex-1 rounded-xl border border-line py-2.5 font-semibold text-muted">Fechar</button>
                <Link to="/agenda" onClick={fechar} className="flex-1 rounded-xl bg-gradient-to-r from-brand to-brand2 text-white py-2.5 font-extrabold shadow-glow">
                  Ver agenda
                </Link>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
