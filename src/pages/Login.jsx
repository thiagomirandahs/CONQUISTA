import { useState, useEffect } from 'react'
import { Link, Navigate, useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/Auth.jsx'
import { marcarInicioDaNavegacao } from '../lib/barreiraDeVoltar.js'
import { souAdminPlataforma } from '../services/admin.js'
import { m as motion } from 'framer-motion'
import Logo from '../components/Logo.jsx'
import { supabase } from '../lib/supabase.js'
import { traduzErro } from '../lib/erros.js'
import { MARCA_PRODUTO as marca } from '../lib/marca.js'
import { lerRetorno, limparRetorno, retornoDaUrl } from '../lib/retornoPosLogin.js'

const inputClass =
  'w-full rounded-lg border border-line px-3 py-2.5 text-ink outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/30'

export default function Login() {
  const navigate = useNavigate()
  const { search } = useLocation()
  // Tela GLOBAL: sempre a identidade DesbravaClube (o clube só aparece depois de entrar)
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [erro, setErro] = useState('')
  const [carregando, setCarregando] = useState(false)
  const session = useAuth()?.session
  // Já logado e caiu no /login (ex.: apertou VOLTAR): não mostra o login de novo, vai pro destino.
  const destinoLogado = session ? (lerRetorno() || retornoDaUrl(search) || '/ranking') : null
  useEffect(() => { if (destinoLogado) { limparRetorno(); marcarInicioDaNavegacao() } }, [destinoLogado])

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
    //
    // Se a pessoa veio de um fluxo que exigiu login no meio (ex.: abriu um link de clube sem estar
    // logada), volta exatamente pra lá em vez de cair no ranking e perder o código/convite.
    const retorno = lerRetorno() || retornoDaUrl(search)
    // replace: a tela de login sai do histórico — o VOLTAR não reabre o login com a pessoa já dentro
    if (retorno) { limparRetorno(); navigate(retorno, { replace: true }); marcarInicioDaNavegacao(); return }
    // Conta de ADMIN da plataforma entra direto no painel (sem digitar /admin); as demais, no app.
    const ehAdmin = await souAdminPlataforma().catch(() => false)
    navigate(ehAdmin ? '/admin' : '/ranking', { replace: true })
    marcarInicioDaNavegacao()
  }

  if (destinoLogado && !carregando) return <Navigate to={destinoLogado} replace />

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
            <Logo produto className="w-24 h-24 mb-3" />
          </motion.div>
          <h1 className="text-brand text-xl font-extrabold text-center leading-tight">{marca.nome}</h1>
          {(marca.descricao || marca.lema) && <p className="text-muted text-sm">{marca.descricao || marca.lema}</p>}
        </div>

        <form onSubmit={entrar} className="space-y-4">
          <div>
            <label htmlFor="login-email" className="block text-sm font-medium text-ink mb-1">E-mail</label>
            <input id="login-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
              placeholder="voce@email.com" className={inputClass} />
          </div>
          <div>
            <label htmlFor="login-senha" className="block text-sm font-medium text-ink mb-1">Senha</label>
            <input id="login-senha" type="password" required value={senha} onChange={(e) => setSenha(e.target.value)}
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
          <Link to={`/cadastro${retornoDaUrl(search) ? search : ''}`} className="text-brand font-semibold hover:underline">Cadastre-se</Link>
        </p>
        <p className="text-center text-sm mt-2 text-muted">
          <Link to="/recuperar" className="text-brand font-semibold hover:underline">Esqueci minha senha</Link>
        </p>
      </motion.div>
      {marca.desde && <p className="text-white/80 text-xs mt-6 relative z-10">⭐ Desde {marca.desde}</p>}
    </div>
  )
}
