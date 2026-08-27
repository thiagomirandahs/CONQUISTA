import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useAuth } from '../context/Auth.jsx'
import { carregarRanking, carregarTemporadas, iniciarNovaTemporada } from '../lib/dados.js'
import { vitoria as festa } from '../lib/juice.js'

const fmtData = (iso) => {
  if (!iso) return ''
  const s = String(iso)
  if (s.startsWith('-inf') || s.startsWith('inf')) return 'início'
  return s.slice(0, 10).split('-').reverse().join('/')
}

// Só a diretoria: encerra a temporada atual (guardando os campeões) e zera o
// ranking. Nada é apagado — os pontos antigos ficam no banco.
export default function Temporada() {
  const { profile } = useAuth()
  const ehDiretoria = profile?.papel === 'diretoria'
  const [ranking, setRanking] = useState({ unidades: [], individual: [] })
  const [passadas, setPassadas] = useState([])
  const [carregando, setCarregando] = useState(true)
  const [confirmando, setConfirmando] = useState(false)
  const [processando, setProcessando] = useState(false)

  async function carregar() {
    setCarregando(true)
    try {
      const [r, t] = await Promise.all([carregarRanking(), carregarTemporadas()])
      setRanking(r); setPassadas(t)
    } catch { /* ignora */ }
    setCarregando(false)
  }
  useEffect(() => { if (ehDiretoria) carregar(); else setCarregando(false) }, [ehDiretoria])

  if (!ehDiretoria) {
    return (
      <div className="bg-surface rounded-2xl p-8 text-center shadow-soft">
        <div className="text-4xl mb-2">🔒</div>
        <p className="font-semibold text-ink">Só a diretoria</p>
        <p className="text-sm text-faint">Iniciar uma nova temporada é uma ação da diretoria.</p>
      </div>
    )
  }

  // Campeão = 1º desbravador/conselheiro com pontos (líderes não contam; 0 ponto não vira campeão)
  const topInd = (ranking.individual || []).find((p) => (p.papel === 'desbravador' || p.papel === 'conselheiro') && p.pts > 0)
  const topUni = (ranking.unidades || []).find((u) => u.pontos > 0)
  const campInd = topInd?.nome || null
  const campUni = topUni?.nome || null

  async function confirmar() {
    setProcessando(true)
    try {
      const r = await iniciarNovaTemporada({ campeaoIndividual: campInd, campeaoUnidade: campUni })
      festa()
      setConfirmando(false)
      alert(`🏁 Temporada ${r?.numero || ''} iniciada! O ranking foi zerado e os campeões ficaram salvos.`)
      carregar()
    } catch (e) {
      alert('Não foi possível: ' + (e?.message || e))
    }
    setProcessando(false)
  }

  return (
    <div>
      <div className="mb-4">
        <h2 className="text-2xl font-extrabold text-ink">🏁 Temporadas</h2>
        <p className="text-sm text-muted">Zere o ranking pra recomeçar — sem perder o histórico</p>
      </div>

      {carregando ? (
        <p className="text-faint text-sm">Carregando...</p>
      ) : (
        <>
          <div className="bg-surface rounded-2xl p-5 shadow-soft">
            <p className="text-sm text-muted mb-3">
              Ao iniciar uma nova temporada, o ranking <b>volta a zero pra todos</b> e os pontos de agora
              deixam de contar. Os pontos antigos <b>ficam guardados</b> no banco (nada é apagado) e os
              campeões atuais entram pra galeria abaixo.
            </p>
            <div className="bg-amber-50 border border-gold/40 rounded-xl p-3 mb-4">
              <p className="text-xs font-semibold text-amber-700 mb-1">Campeões que serão coroados agora:</p>
              <p className="text-sm text-ink">🧒 Individual: <b>{campInd || '—'}</b></p>
              <p className="text-sm text-ink">🛡️ Unidade: <b>{campUni || '—'}</b></p>
            </div>
            <motion.button whileTap={{ scale: 0.97 }} onClick={() => setConfirmando(true)}
              className="w-full bg-gradient-to-r from-brand to-brand2 text-white font-bold rounded-xl py-3 shadow-glow">
              🏁 Encerrar e iniciar nova temporada
            </motion.button>
          </div>

          {passadas.length > 0 && (
            <div className="mt-6">
              <h3 className="font-extrabold text-ink mb-2">🏆 Campeões das temporadas</h3>
              <div className="bg-surface rounded-2xl shadow-soft divide-y divide-line">
                {passadas.map((t) => (
                  <div key={t.numero} className="px-4 py-3">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-ink">Temporada {t.numero}</span>
                      <span className="text-[11px] text-faint">{fmtData(t.inicio)} — {fmtData(t.fim)}</span>
                    </div>
                    <div className="text-sm text-muted mt-0.5">🧒 {t.campeao_individual || '—'} · 🛡️ {t.campeao_unidade || '—'}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      <AnimatePresence>
        {confirmando && (
          <motion.div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-0 sm:p-6"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => !processando && setConfirmando(false)}>
            <motion.div onClick={(e) => e.stopPropagation()}
              initial={{ y: 60, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 60, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 320, damping: 28 }}
              className="bg-surface w-full sm:max-w-sm rounded-t-3xl sm:rounded-3xl shadow-2xl p-6">
              <div className="text-4xl text-center mb-2">🏁</div>
              <h3 className="text-lg font-extrabold text-ink text-center">Iniciar nova temporada?</h3>
              <p className="text-sm text-muted text-center mt-2">
                O ranking <b>zera pra todos</b>. Os campeões <b>{campInd || '—'}</b> e <b>{campUni || '—'}</b> ficam
                guardados. Os pontos não são apagados, só param de contar.
              </p>
              <div className="flex gap-2 mt-5">
                <button onClick={() => setConfirmando(false)} disabled={processando}
                  className="flex-1 rounded-xl bg-surface2 text-ink font-semibold py-2.5">Cancelar</button>
                <motion.button onClick={confirmar} disabled={processando} whileTap={{ scale: 0.97 }}
                  className="flex-1 rounded-xl bg-gradient-to-r from-brand to-brand2 text-white font-semibold py-2.5 shadow-glow disabled:opacity-60">
                  {processando ? 'Zerando...' : 'Confirmar'}
                </motion.button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
