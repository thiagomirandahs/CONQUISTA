import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import Logo from '../components/Logo.jsx'
import { supabase } from '../lib/supabase.js'
import { traduzErro } from '../lib/erros.js'
import { useClube } from '../context/Clube.jsx'

const inputClass =
  'w-full rounded-lg border border-line px-3 py-2.5 text-ink outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/30'

export default function Login() {
  const navigate = useNavigate()
  const { marca } = useClube()    // a marca do ÚLTIMO clube neste aparelho (ou a padrão): antes de entrar ainda não há clube em uso
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [erro, setErro] = useState('')
  const [carregando, setCarregando] = useState(false)

  async function entrar(e) {
    e.preventDefault()
    setErro('')
    setCarregando(true)

    const { error } = await supabase.auth.signInWithPassword({ email, password: senha })
    if (error) {
      setErro(traduzErro(error.message))
      setCarregando(false)
      return
    }

    // Não há mais portão aqui. Ele olhava o profiles.status da pessoa — um ESPELHO do clube
    // primário — e decidia por TODOS os clubes: quem estava suspensa num clube e pendente em
    // outro levava signOut com "aguardando aprovação" e não conseguia nem entrar para digitar o
    // código de outro clube (e a mensagem de "rejeitado" nunca casava). Quem decide agora é a
    // ClubeGuard, pelos VÍNCULOS (meu_contexto): cadastro pendente vê "Seu cadastro aguarda
    // aprovação"; sem clube vê "Entrar com código" / "Criar um clube"; clube perdido pede escolha.
    navigate('/ranking')
  }

  return (
    <div className="min-h-full relative flex flex-col items-center justify-center p-6 overflow-hidden bg-gradient-to-br from-brand via-brand2 to-brand">
      {/* Brilho suave decorativo (CSS puro, sem imagens — leve e rápido) */}
      <div className="absolute -top-24 -right-16 w-72 h-72 rounded-full bg-gold/20 blur-3xl pointer-events-none" />
      <div className="absolute -bottom-24 -left-16 w-72 h-72 rounded-full bg-white/10 blur-3xl pointer-events-none" />

      <motion.div
        initial={{ opacity: 0, y: 26, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.4, ease: 'easeOut' }}
        className="relative z-10 w-full max-w-sm bg-surface rounded-2xl shadow-soft p-7"
      >
        <div className="flex flex-col items-center mb-6">
          <motion.div initial={{ scale: 0.6, rotate: -8, opacity: 0 }} animate={{ scale: 1, rotate: 0, opacity: 1 }}
            transition={{ type: 'spring', stiffness: 200, damping: 14, delay: 0.1 }}>
            <Logo className="w-24 h-24 mb-3" />
          </motion.div>
          <h1 className="text-brand text-xl font-extrabold text-center leading-tight">{marca.nome}</h1>
          {(marca.descricao || marca.lema) && <p className="text-muted text-sm">{marca.descricao || marca.lema}</p>}
        </div>

        <form onSubmit={entrar} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-ink mb-1">E-mail</label>
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
              placeholder="voce@email.com" className={inputClass} />
          </div>
          <div>
            <label className="block text-sm font-medium text-ink mb-1">Senha</label>
            <input type="password" required value={senha} onChange={(e) => setSenha(e.target.value)}
              placeholder="••••••••" className={inputClass} />
          </div>

          {erro && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3">{erro}</div>
          )}

          <motion.button type="submit" disabled={carregando} whileHover={{ scale: carregando ? 1 : 1.02 }} whileTap={{ scale: 0.97 }}
            className="w-full rounded-lg bg-gradient-to-r from-brand to-brand2 shadow-glow text-white font-semibold py-2.5 disabled:opacity-60">
            {carregando ? 'Entrando...' : 'Entrar'}
          </motion.button>
        </form>

        <p className="text-center text-sm mt-5 text-muted">
          Ainda não tem conta?{' '}
          <Link to="/cadastro" className="text-brand font-semibold hover:underline">Cadastre-se</Link>
        </p>
        <p className="text-center text-sm mt-2 text-muted">
          <Link to="/recuperar" className="text-brand font-semibold hover:underline">Esqueci minha senha</Link>
        </p>
      </motion.div>
      {marca.desde && <p className="text-white/80 text-xs mt-6 relative z-10">⭐ Desde {marca.desde}</p>}
    </div>
  )
}
