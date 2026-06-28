import { Link, useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import Logo from '../components/Logo.jsx'
import CarrosselFundo from '../components/CarrosselFundo.jsx'

const inputClass =
  'w-full rounded-lg border border-slate-300 px-3 py-2.5 text-slate-900 outline-none transition focus:border-azul-claro focus:ring-2 focus:ring-azul-claro/30'

export default function Login() {
  const navigate = useNavigate()

  function entrar(e) {
    e.preventDefault()
    // TODO: autenticar de verdade com o Supabase (próximo passo)
    navigate('/ranking')
  }

  return (
    <div className="min-h-full relative flex flex-col items-center justify-center p-6 overflow-hidden">
      {/* Carrossel de fotos das atividades ao fundo */}
      <CarrosselFundo />
      {/* Camada azul para dar contraste e legibilidade */}
      <div className="absolute inset-0 bg-gradient-to-b from-azul/85 via-azul/75 to-azul/90" />

      <motion.div
        initial={{ opacity: 0, y: 26, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.4, ease: 'easeOut' }}
        className="relative z-10 w-full max-w-sm bg-white rounded-2xl shadow-2xl p-7"
      >
        <div className="flex flex-col items-center mb-6">
          <motion.div initial={{ scale: 0.6, rotate: -8, opacity: 0 }} animate={{ scale: 1, rotate: 0, opacity: 1 }}
            transition={{ type: 'spring', stiffness: 200, damping: 14, delay: 0.1 }}>
            <Logo className="w-24 h-24 mb-3" />
          </motion.div>
          <h1 className="text-azul text-xl font-extrabold text-center leading-tight">Filhos da Conquista</h1>
          <p className="text-prata text-sm">Clube de Desbravadores · 1994</p>
        </div>

        <form onSubmit={entrar} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">E-mail</label>
            <input type="email" required placeholder="voce@email.com" className={inputClass} />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Senha</label>
            <input type="password" required placeholder="••••••••" className={inputClass} />
          </div>
          <motion.button type="submit" whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}
            className="w-full rounded-lg bg-azul text-white font-semibold py-2.5 shadow-md">
            Entrar
          </motion.button>
        </form>

        <p className="text-center text-sm mt-5 text-slate-600">
          Ainda não tem conta?{' '}
          <Link to="/cadastro" className="text-azul-claro font-semibold hover:underline">Cadastre-se</Link>
        </p>
      </motion.div>
      <p className="text-white/80 text-xs mt-6 relative z-10">⭐ Desde 1994</p>
    </div>
  )
}
