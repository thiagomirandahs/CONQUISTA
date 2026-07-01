import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useAuth } from '../context/Auth.jsx'

const FERRAMENTAS = [
  { to: '/aprovacoes', icon: '✅', titulo: 'Aprovações', desc: 'Liberar novos cadastros', papeis: ['diretoria', 'instrutor'] },
  { to: '/apontamentos', icon: '✍️', titulo: 'Apontamentos', desc: 'Pontos da reunião por desbravador', papeis: ['conselheiro', 'instrutor', 'diretoria'] },
  { to: '/mensalidades', icon: '💰', titulo: 'Mensalidades', desc: 'Controle de pagamentos', papeis: ['tesoureiro', 'diretoria'] },
  { to: '/usuarios', icon: '👥', titulo: 'Usuários', desc: 'Resetar senha de quem não entra', papeis: ['diretoria', 'instrutor'] },
  { to: '/pontos', icon: '➖', titulo: 'Remover pontos', desc: 'Apagar lançamentos errados', papeis: ['diretoria', 'instrutor'] },
  { to: '/aprovar-missoes', icon: '🎯', titulo: 'Aprovar missões', desc: 'Aprovar as fotos das missões', papeis: ['diretoria', 'instrutor'] },
]

export default function Gestao() {
  const { profile } = useAuth()
  const disp = FERRAMENTAS.filter((f) => f.papeis.includes(profile?.papel))

  return (
    <div>
      <div className="mb-5">
        <h2 className="text-2xl font-extrabold text-slate-800">⚙️ Gestão</h2>
        <p className="text-sm text-slate-500">Ferramentas da liderança</p>
      </div>

      {disp.length === 0 ? (
        <div className="bg-white rounded-2xl p-8 text-center shadow-sm">
          <div className="text-4xl mb-2">🔒</div>
          <p className="font-semibold text-slate-700">Sem ferramentas de gestão</p>
          <p className="text-sm text-slate-400">Seu perfil não tem acesso a estas áreas.</p>
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 gap-3">
          {disp.map((f) => (
            <motion.div key={f.to} whileHover={{ y: -4 }} whileTap={{ scale: 0.98 }}>
              <Link to={f.to} className="block bg-white rounded-2xl p-5 shadow-sm">
                <div className="text-3xl mb-2">{f.icon}</div>
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
