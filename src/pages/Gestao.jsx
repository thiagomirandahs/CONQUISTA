import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useClube } from '../context/Clube.jsx'
import { useEscopo } from '../context/Escopo.jsx'
import { carregarPainelDiretoria } from '../lib/dados.js'
// Matriz de permissões centralizada (hardening 28/08): a MESMA lista alimenta
// estes cards e a trava de rota <RotaRestrita> — muda num lugar, vale nos dois.
import { FERRAMENTAS } from '../lib/permissoes.js'

const PODE_GERIR = ['instrutor', 'diretoria']

export default function Gestao() {
  const { papel: meuPapel } = useClube()
  const { temEscopo, escopos } = useEscopo()
  const disp = FERRAMENTAS.filter((f) => f.papeis.includes(meuPapel))
  const ehAdmin = PODE_GERIR.includes(meuPapel)

  return (
    <div>
      <div className="mb-5">
        <h2 className="text-2xl font-extrabold text-ink">⚙️ Gestão</h2>
        <p className="text-sm text-muted">Ferramentas da liderança</p>
      </div>

      {/* Troca de JORNADA (não de conta): quem também tem vínculo institucional chega ao portal por aqui.
          O app do clube continua o app do clube — nada vira dashboard administrativo. */}
      {temEscopo && (
        <Link to="/institucional" data-testid="ir-portal"
          className="flex items-center gap-3 bg-surface rounded-2xl p-4 shadow-soft mb-4 border border-line">
          <span className="text-2xl" aria-hidden="true">🏛️</span>
          <span className="min-w-0">
            <span className="block font-bold text-ink text-sm">Portal institucional</span>
            <span className="block text-xs text-faint truncate">
              {escopos.length === 1 ? escopos[0].nome : `${escopos.length} escopos`} · acompanhar os clubes do seu escopo
            </span>
          </span>
        </Link>
      )}

      {ehAdmin && <PainelDiretoria />}

      {disp.length === 0 ? (
        <div className="bg-surface rounded-2xl p-8 text-center shadow-soft">
          <div className="text-4xl mb-2">🔒</div>
          <p className="font-semibold text-ink">Sem ferramentas de gestão</p>
          <p className="text-sm text-faint">Seu perfil não tem acesso a estas áreas.</p>
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {disp.map((f) => (
            <motion.div key={f.to} whileHover={{ y: -4 }} whileTap={{ scale: 0.98 }}>
              <Link to={f.to} className="block bg-surface rounded-2xl p-5 shadow-soft h-full">
                <div className="w-12 h-12 rounded-2xl grid place-items-center text-2xl mb-2 bg-gradient-to-br from-brand/10 to-gold/20">{f.icon}</div>
                <div className="font-bold text-ink">{f.titulo}</div>
                <div className="text-sm text-faint">{f.desc}</div>
              </Link>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  )
}

// Painel da diretoria: o clube numa olhada, cada número é um atalho.
function PainelDiretoria() {
  const [d, setD] = useState(null)
  useEffect(() => { carregarPainelDiretoria().then(setD).catch(() => {}) }, [])
  if (!d) return null
  const tiles = [
    { n: d.cadastros, lbl: 'Cadastros a aprovar', to: '/aprovacoes', alerta: d.cadastros > 0 },
    { n: d.entregas, lbl: 'Entregas a corrigir', to: '/atividades', alerta: d.entregas > 0 },
    { n: d.missoes, lbl: 'Missões a aprovar', to: '/aprovar-missoes', alerta: d.missoes > 0 },
    { n: `${d.mensPagas}/${d.membros}`, lbl: 'Mensalidades do mês', to: '/mensalidades', alerta: false },
  ]
  return (
    <div className="mb-5">
      <h3 className="text-xs font-bold text-faint uppercase tracking-wide mb-2">📊 Resumo do clube</h3>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {tiles.map((t) => (
          <motion.div key={t.lbl} whileTap={{ scale: 0.97 }}>
            <Link to={t.to}
              className={`block rounded-2xl p-3 shadow-soft text-center ${t.alerta ? 'bg-amber-50 border border-amber-200' : 'bg-surface'}`}>
              <div className={`text-2xl font-extrabold leading-none ${t.alerta ? 'text-amber-700' : 'text-ink'}`}>{t.n}</div>
              <div className="text-[11px] text-muted leading-tight mt-1">{t.lbl}</div>
            </Link>
          </motion.div>
        ))}
      </div>
    </div>
  )
}
