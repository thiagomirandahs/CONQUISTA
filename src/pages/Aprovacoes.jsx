import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../context/Auth.jsx'
import { CARGOS_LIDERANCA } from '../lib/cargos.js'

const ADMIN = ['diretoria', 'instrutor']
const fmtData = (iso) => (iso ? iso.split('-').reverse().join('/') : '—')
const ehLideranca = (cargo) => CARGOS_LIDERANCA.includes(cargo)

export default function Aprovacoes() {
  const { profile } = useAuth()
  const ehAdmin = ADMIN.includes(profile?.papel)
  const [pendentes, setPendentes] = useState([])
  const [carregando, setCarregando] = useState(true)

  async function carregar() {
    setCarregando(true)
    const { data } = await supabase
      .from('profiles')
      .select('id,nome,nascimento,unidade_id,cargo,unidades(nome)')
      .eq('status', 'pendente')
      .order('created_at', { ascending: true })
    setPendentes(data || [])
    setCarregando(false)
  }

  useEffect(() => {
    if (ehAdmin) carregar()
    else setCarregando(false)
  }, [ehAdmin])

  async function decidir(id, novoStatus) {
    const alvo = pendentes.find((x) => x.id === id)
    setPendentes((p) => p.filter((x) => x.id !== id)) // some da lista na hora
    // Aprovar libera como DESBRAVADOR (nunca liderança pelo cadastro). Se for
    // líder, a diretoria promove depois em Usuários — decisão deliberada.
    const { data, error } = await supabase.from('profiles').update({ status: novoStatus }).eq('id', id).select('id')
    if (error || !data || data.length === 0) {
      alert('Não consegui salvar — recarregue a página e tente de novo.')
      if (alvo) setPendentes((p) => [alvo, ...p]) // devolve o card que tinha sumido
    }
  }

  if (!ehAdmin) {
    return (
      <div className="bg-surface rounded-2xl p-8 text-center shadow-soft">
        <div className="text-4xl mb-2">🔒</div>
        <p className="font-semibold text-ink">Área restrita</p>
        <p className="text-sm text-faint">Apenas a diretoria e instrutores podem aprovar cadastros.</p>
      </div>
    )
  }

  return (
    <div>
      <div className="mb-5">
        <h2 className="text-2xl font-extrabold text-ink">✅ Aprovações</h2>
        <p className="text-sm text-muted">Novos cadastros aguardando liberação</p>
      </div>

      {carregando ? (
        <p className="text-faint text-sm">Carregando...</p>
      ) : pendentes.length === 0 ? (
        <div className="bg-surface rounded-2xl p-8 text-center shadow-soft">
          <div className="text-4xl mb-2">🎉</div>
          <p className="font-semibold text-ink">Tudo em dia!</p>
          <p className="text-sm text-faint">Nenhum cadastro pendente no momento.</p>
        </div>
      ) : (
        <div className="space-y-3">
          <AnimatePresence>
            {pendentes.map((p) => (
              <motion.div key={p.id} layout
                initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, x: -50 }}
                className="bg-surface rounded-2xl p-4 shadow-soft">
                {/* Linha 1: avatar + dados (largura toda pro nome/unidade/data) */}
                <div className="flex items-center gap-3">
                  <div className="w-11 h-11 rounded-full bg-brand/10 text-brand grid place-items-center font-extrabold shrink-0">
                    {p.nome?.[0]?.toUpperCase() || '?'}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-bold text-ink truncate">{p.nome || 'Sem nome'}</div>
                    <div className="text-xs text-faint">
                      {p.unidades?.nome ? `🏠 ${p.unidades.nome}` : 'Sem unidade'} · 🎂 {fmtData(p.nascimento)}
                    </div>
                    {p.cargo && (
                      <span className={`inline-block mt-1 text-[11px] font-semibold rounded-full px-2 py-0.5 ${ehLideranca(p.cargo) ? 'bg-amber-100 text-amber-700' : 'bg-surface2 text-muted'}`}>
                        {ehLideranca(p.cargo) ? '⭐ ' : ''}{p.cargo}
                      </span>
                    )}
                    {ehLideranca(p.cargo) && (
                      <div className="text-[10px] text-amber-600 mt-1">Entra como desbravador — se for líder mesmo, promova em Usuários.</div>
                    )}
                  </div>
                </div>
                {/* Linha 2: botões largos, fáceis de acertar no celular */}
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
      )}
    </div>
  )
}
