import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useAuth } from '../context/Auth.jsx'
import { carregarPainelDiretoria } from '../lib/dados.js'

const PODE_GERIR = ['instrutor', 'diretoria']

const FERRAMENTAS = [
  { to: '/aprovacoes', icon: '✅', titulo: 'Aprovações', desc: 'Liberar novos cadastros', papeis: ['diretoria', 'instrutor'] },
  { to: '/apontamentos', icon: '✍️', titulo: 'Apontamentos', desc: 'Pontos da reunião por desbravador', papeis: ['conselheiro', 'instrutor', 'diretoria'] },
  { to: '/mensalidades', icon: '💰', titulo: 'Mensalidades', desc: 'Controle de pagamentos', papeis: ['tesoureiro', 'diretoria'] },
  { to: '/usuarios', icon: '👥', titulo: 'Usuários', desc: 'Resetar senha de quem não entra', papeis: ['diretoria', 'instrutor'] },
  { to: '/pontos', icon: '➖', titulo: 'Remover pontos', desc: 'Apagar lançamentos errados', papeis: ['diretoria', 'instrutor'] },
  { to: '/aprovar-missoes', icon: '🎯', titulo: 'Aprovar missões', desc: 'Aprovar as fotos das missões', papeis: ['diretoria', 'instrutor'] },
  { to: '/radar', icon: '📡', titulo: 'Radar de faltas', desc: 'Quem está sumindo do clube', papeis: ['diretoria', 'instrutor'] },
  { to: '/temporada', icon: '🏁', titulo: 'Temporadas', desc: 'Zerar o ranking pra recomeçar', papeis: ['diretoria'] },
  { to: '/avisos', icon: '📣', titulo: 'Enviar aviso', desc: 'Recado pro clube (aparece no sino)', papeis: ['diretoria', 'instrutor'] },
  { to: '/conteudo', icon: '📖', titulo: 'Conteúdo', desc: 'Versículos e desafios das missões', papeis: ['diretoria', 'instrutor'] },
  { to: '/jogos-trilha', icon: '🎮', titulo: 'Jogos da Trilha', desc: 'Ativar os jogos pra criançada', papeis: ['diretoria', 'instrutor'] },
  { to: '/vinculos-pais', icon: '👨‍👩‍👧', titulo: 'Vínculos dos pais', desc: 'Confirmar quem é filho de quem + PIX', papeis: ['diretoria', 'instrutor'] },
]

export default function Gestao() {
  const { profile } = useAuth()
  const disp = FERRAMENTAS.filter((f) => f.papeis.includes(profile?.papel))
  const ehAdmin = PODE_GERIR.includes(profile?.papel)

  return (
    <div>
      <div className="mb-5">
        <h2 className="text-2xl font-extrabold text-slate-800">⚙️ Gestão</h2>
        <p className="text-sm text-slate-500">Ferramentas da liderança</p>
      </div>

      {ehAdmin && <PainelDiretoria />}

      {disp.length === 0 ? (
        <div className="bg-white rounded-2xl p-8 text-center shadow-sm">
          <div className="text-4xl mb-2">🔒</div>
          <p className="font-semibold text-slate-700">Sem ferramentas de gestão</p>
          <p className="text-sm text-slate-400">Seu perfil não tem acesso a estas áreas.</p>
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {disp.map((f) => (
            <motion.div key={f.to} whileHover={{ y: -4 }} whileTap={{ scale: 0.98 }}>
              <Link to={f.to} className="block bg-white rounded-2xl p-5 shadow-sm h-full">
                <div className="w-12 h-12 rounded-2xl grid place-items-center text-2xl mb-2 bg-gradient-to-br from-azul/10 to-dourado/20">{f.icon}</div>
                <div className="font-bold text-slate-800">{f.titulo}</div>
                <div className="text-sm text-slate-400">{f.desc}</div>
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
      <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-2">📊 Resumo do clube</h3>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {tiles.map((t) => (
          <motion.div key={t.lbl} whileTap={{ scale: 0.97 }}>
            <Link to={t.to}
              className={`block rounded-2xl p-3 shadow-sm text-center ${t.alerta ? 'bg-amber-50 border border-amber-200' : 'bg-white'}`}>
              <div className={`text-2xl font-extrabold leading-none ${t.alerta ? 'text-amber-700' : 'text-slate-800'}`}>{t.n}</div>
              <div className="text-[11px] text-slate-500 leading-tight mt-1">{t.lbl}</div>
            </Link>
          </motion.div>
        ))}
      </div>
    </div>
  )
}
