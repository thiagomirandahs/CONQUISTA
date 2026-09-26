import { useState, useEffect } from 'react'
import { m as motion, AnimatePresence } from 'framer-motion'
import { supabase } from '../lib/supabase.js'
import { useClube } from '../context/Clube.jsx'
import { entradasPendentes } from '../services/entrada.js'
import { CARGOS_LIDERANCA } from '../lib/cargos.js'
import { avisar } from '../ui/avisos.jsx'

// Extraído de Aprovacoes.jsx pra ser reaproveitado também em Gestão → Inscrições, sem duplicar a
// lógica de aprovar/recusar (mesma RPC `vinculo_gerir`, mesmo comportamento).
const fmtData = (iso) => (iso ? iso.split('-').reverse().join('/') : '—')
const ehLideranca = (cargo) => CARGOS_LIDERANCA.includes(cargo)

export default function SolicitacoesPendentes({ onContagem }) {
  const { clubeId } = useClube()
  const [pendentes, setPendentes] = useState([])
  const [carregando, setCarregando] = useState(true)

  async function carregar() {
    setCarregando(true)
    try {
      const d = await entradasPendentes()
      setPendentes(d)
      onContagem?.(d.length)
    } catch { setPendentes([]) }
    setCarregando(false)
  }

  useEffect(() => { carregar() }, [clubeId]) // eslint-disable-line react-hooks/exhaustive-deps

  async function decidir(id, novoStatus) {
    const alvo = pendentes.find((x) => x.id === id)
    setPendentes((p) => { const nova = p.filter((x) => x.id !== id); onContagem?.(nova.length); return nova })
    const { error } = await supabase.rpc('vinculo_gerir', { p_user_id: id, p_status: novoStatus })
    if (error) {
      avisar.erro(null, 'Não consegui salvar o cadastro.')
      if (alvo) setPendentes((p) => { const nova = [alvo, ...p]; onContagem?.(nova.length); return nova })
    }
  }

  if (carregando) return <p className="text-faint text-sm">Carregando...</p>
  if (pendentes.length === 0) {
    return (
      <div className="bg-surface rounded-2xl p-8 text-center shadow-soft">
        <div className="text-4xl mb-2">🎉</div>
        <p className="font-semibold text-ink">Tudo em dia!</p>
        <p className="text-sm text-faint">Nenhum cadastro pendente no momento.</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <AnimatePresence>
        {pendentes.map((p) => (
          <motion.div key={p.id} layout
            initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, x: -50 }}
            className="bg-surface rounded-2xl p-4 shadow-soft">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-full bg-brand/10 text-brand grid place-items-center font-extrabold shrink-0">
                {p.nome?.[0]?.toUpperCase() || '?'}
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-bold text-ink truncate">{p.nome || 'Sem nome'}</div>
                <div className="text-xs text-faint">
                  🎂 {fmtData(p.nascimento)}
                  {p.origem === 'codigo_de_entrada' ? ' · 🎟️ pelo código do clube' : ''}
                </div>
                <span className={`inline-block mt-1 text-xs font-semibold rounded-full px-2 py-0.5 ${ehLideranca(p.papel_pedido) ? 'bg-amber-100 text-amber-700' : 'bg-surface2 text-muted'}`}>
                  {ehLideranca(p.papel_pedido) ? '⭐ ' : ''}{p.papel_pedido}
                </span>
              </div>
            </div>
            <div className="flex gap-2 mt-3">
              <motion.button whileTap={{ scale: 0.95 }} onClick={() => decidir(p.id, 'rejeitado')}
                className="flex-1 text-sm rounded-xl py-2.5 border border-line text-muted hover:bg-surface2 font-semibold">Recusar</motion.button>
              <motion.button whileTap={{ scale: 0.95 }} onClick={() => decidir(p.id, 'ativo')}
                className="flex-1 text-sm rounded-xl py-2.5 bg-gradient-to-r from-brand to-brand2 shadow-glow text-white font-semibold">Aprovar</motion.button>
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}
