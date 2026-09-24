import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { supabase } from '../lib/supabase.js'
import { useClube } from '../context/Clube.jsx'
import { entradasPendentes } from '../services/entrada.js'
import CodigoDeEntrada from '../components/CodigoDeEntrada.jsx'
import { CARGOS_LIDERANCA } from '../lib/cargos.js'
import { avisar } from '../ui/avisos.jsx'

const ADMIN = ['diretoria', 'instrutor']
const fmtData = (iso) => (iso ? iso.split('-').reverse().join('/') : '—')
const ehLideranca = (cargo) => CARGOS_LIDERANCA.includes(cargo)

export default function Aprovacoes() {
  const { papel: meuPapel, clubeId } = useClube()
  const ehAdmin = ADMIN.includes(meuPapel)
  const [pendentes, setPendentes] = useState([])
  const [carregando, setCarregando] = useState(true)

  // A fila é de VÍNCULOS do clube em uso, não de `profiles.status` (fase 8.6).
  //
  // Antes, esta tela perguntava "quem tem a CONTA pendente?" — o status global da pessoa. Era
  // herança de quando havia um clube só: com N clubes, "esta pessoa está pendente" não quer dizer
  // nada sem dizer pendente ONDE. E desde que o cadastro deixou de criar vínculo, a conta nasce
  // ativa: a lista ficaria permanentemente vazia, e ninguém seria aprovado em lugar nenhum.
  async function carregar() {
    setCarregando(true)
    try { setPendentes(await entradasPendentes()) } catch { setPendentes([]) }
    setCarregando(false)
  }

  // `clubeId` na dependência: a fila é do clube EM USO, então trocar de aba tem de recarregar.
  useEffect(() => {
    if (ehAdmin) carregar()
    else setCarregando(false)
  }, [ehAdmin, clubeId])

  async function decidir(id, novoStatus) {
    const alvo = pendentes.find((x) => x.id === id)
    setPendentes((p) => p.filter((x) => x.id !== id)) // some da lista na hora
    // Aprovar libera como DESBRAVADOR (nunca liderança pelo cadastro). Se for
    // líder, a diretoria promove depois em Usuários — decisão deliberada.
    // status é do VÍNCULO (organization_memberships), não de profiles: vinculo_gerir aceita o
    // mesmo vocabulário de sempre (ativo/rejeitado) e escreve no clube em uso.
    const { error } = await supabase.rpc('vinculo_gerir', { p_user_id: id, p_status: novoStatus })
    if (error) {
      avisar.erro(null, 'Não consegui salvar o cadastro.')
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
        <p className="text-sm text-muted">Quem pediu para entrar neste clube</p>
      </div>

      {/* O código fica AQUI, junto da fila que ele alimenta: é a mesma conversa — como as pessoas
          chegam, e quem deixa entrar. */}
      <div className="mb-5"><CodigoDeEntrada /></div>

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
                      🎂 {fmtData(p.nascimento)}
                      {p.origem === 'codigo_de_entrada' ? ' · 🎟️ pelo código do clube' : ''}
                    </div>
                    {/* A unidade não aparece porque não existe ainda: quem entra pelo código entra
                        SEM unidade, e atribuí-la é ato da liderança, em Usuários, depois de aprovar. */}
                    <span className={`inline-block mt-1 text-xs font-semibold rounded-full px-2 py-0.5 ${ehLideranca(p.papel_pedido) ? 'bg-amber-100 text-amber-700' : 'bg-surface2 text-muted'}`}>
                      {ehLideranca(p.papel_pedido) ? '⭐ ' : ''}{p.papel_pedido}
                    </span>
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
