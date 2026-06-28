import { Link, useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import Logo from '../components/Logo.jsx'

const inputClass =
  'w-full rounded-lg border border-slate-300 px-3 py-2.5 text-slate-900 outline-none transition focus:border-azul-claro focus:ring-2 focus:ring-azul-claro/30'

// Unidades de exemplo — depois virão do banco de dados (as que a diretoria criar)
const unidadesExemplo = ['Águia', 'Falcão', 'Leão', 'Pantera']

export default function Cadastro() {
  const navigate = useNavigate()

  function cadastrar(e) {
    e.preventDefault()
    // TODO: salvar no Supabase com status "pendente" (próximo passo)
    alert('Cadastro enviado! Ele passará pela aprovação da diretoria. ✅')
    navigate('/login')
  }

  return (
    <div className="min-h-full bg-slate-100 flex flex-col items-center py-8 px-6">
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: 'easeOut' }}
        className="w-full max-w-sm bg-white rounded-2xl shadow-xl p-7"
      >
        <div className="flex flex-col items-center mb-5">
          <Logo className="w-16 h-16 mb-2" />
          <h1 className="text-azul text-lg font-extrabold">Criar cadastro</h1>
          <p className="text-prata text-xs text-center">Preencha seus dados para participar do clube</p>
        </div>

        <form onSubmit={cadastrar} className="space-y-3.5">
          <Campo label="Nome completo" type="text" placeholder="Seu nome" />
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Foto de perfil</label>
            <input type="file" accept="image/*" className="text-sm w-full text-slate-600" />
            <p className="text-[11px] text-slate-400 mt-1">Ajuda líderes e colegas a te reconhecerem 😊</p>
          </div>
          <Campo label="E-mail" type="email" placeholder="voce@email.com" />
          <Campo label="Senha" type="password" placeholder="••••••••" />
          <Campo label="Data de nascimento" type="date" />
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Unidade</label>
            <select required className={inputClass} defaultValue="">
              <option value="" disabled>Escolha sua unidade</option>
              {unidadesExemplo.map((u) => (
                <option key={u} value={u}>{u}</option>
              ))}
            </select>
          </div>

          <div className="bg-amber-50 border border-amber-200 text-amber-800 text-xs rounded-lg p-3">
            ⚠️ Seu cadastro passará pela <strong>aprovação da diretoria</strong> antes de liberar o acesso.
          </div>

          <motion.button type="submit" whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}
            className="w-full rounded-lg bg-azul text-white font-semibold py-2.5 shadow-md">
            Enviar cadastro
          </motion.button>
        </form>

        <p className="text-center text-sm mt-4 text-slate-600">
          Já tem conta?{' '}
          <Link to="/login" className="text-azul-claro font-semibold hover:underline">Entrar</Link>
        </p>
      </motion.div>
    </div>
  )
}

function Campo({ label, ...props }) {
  return (
    <div>
      <label className="block text-sm font-medium text-slate-700 mb-1">{label}</label>
      <input {...props} required className={inputClass} />
    </div>
  )
}
