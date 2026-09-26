import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../context/Auth.jsx'
import { traduzErro } from '../lib/erros.js'
import { avisar } from '../ui/avisos.jsx'

// Trocar a senha estando DENTRO do app: pede a senha ATUAL antes (quem pegou o celular desbloqueado
// não troca a senha de ninguém). A senha atual é conferida entrando de novo com ela; só então a nova
// é gravada. Mesma regra do cadastro: mínimo 8, com letras e números (o servidor também exige).
export function erroDaNovaSenha(nova, confirmar, atual) {
  if (!nova || nova.length < 8) return 'A nova senha precisa ter pelo menos 8 caracteres.'
  if (!/[a-zA-Z]/.test(nova) || !/\d/.test(nova)) return 'Use letras e números na nova senha.'
  if (nova !== confirmar) return 'A confirmação não é igual à nova senha.'
  if (atual && nova === atual) return 'A nova senha precisa ser diferente da atual.'
  return ''
}

const campo = 'w-full min-h-[48px] rounded-xl border border-line bg-surface px-3 text-base text-ink focus:border-brand focus:outline-none'

export default function TrocarSenha() {
  const { session } = useAuth() || {}
  const navigate = useNavigate()
  const [atual, setAtual] = useState('')
  const [nova, setNova] = useState('')
  const [confirmar, setConfirmar] = useState('')
  const [ver, setVer] = useState(false)
  const [erro, setErro] = useState('')
  const [ocupado, setOcupado] = useState(false)

  async function trocar(e) {
    e.preventDefault()
    setErro('')
    if (!atual) { setErro('Digite a sua senha atual.'); return }
    const problema = erroDaNovaSenha(nova, confirmar, atual)
    if (problema) { setErro(problema); return }
    const email = session?.user?.email
    if (!email) { setErro('Não foi possível identificar a sua conta. Saia e entre de novo.'); return }
    setOcupado(true)
    try {
      const { error: errAtual } = await supabase.auth.signInWithPassword({ email, password: atual })
      if (errAtual) { setErro('A senha atual está incorreta.'); setOcupado(false); return }
      const { error } = await supabase.auth.updateUser({ password: nova })
      if (error) { setErro(traduzErro(error.message)); setOcupado(false); return }
      avisar.sucesso('Senha trocada! Use a nova senha na próxima vez que entrar.')
      navigate('/eu', { replace: true })
    } catch (e2) {
      setErro(traduzErro(e2?.message || String(e2)))
      setOcupado(false)
    }
  }

  return (
    <div className="max-w-md mx-auto">
      <h1 className="text-xl font-extrabold text-ink">🔑 Trocar senha</h1>
      <p className="text-sm text-muted mt-1 mb-5">Por segurança, confirme a sua senha atual antes de criar a nova.</p>
      <form onSubmit={trocar} className="space-y-4 rounded-2xl border border-line bg-surface p-4">
        <label className="block">
          <span className="block text-sm font-semibold text-ink mb-1">Senha atual</span>
          <input type={ver ? 'text' : 'password'} autoComplete="current-password" value={atual} onChange={(e) => setAtual(e.target.value)} className={campo} />
        </label>
        <label className="block">
          <span className="block text-sm font-semibold text-ink mb-1">Nova senha</span>
          <input type={ver ? 'text' : 'password'} autoComplete="new-password" value={nova} onChange={(e) => setNova(e.target.value)} className={campo} />
          <span className="block text-xs text-faint mt-1">Mínimo 8 caracteres, com letras e números.</span>
        </label>
        <label className="block">
          <span className="block text-sm font-semibold text-ink mb-1">Confirmar nova senha</span>
          <input type={ver ? 'text' : 'password'} autoComplete="new-password" value={confirmar} onChange={(e) => setConfirmar(e.target.value)} className={campo} />
        </label>
        <label className="flex min-h-[44px] items-center gap-2 text-sm text-muted">
          <input type="checkbox" checked={ver} onChange={(e) => setVer(e.target.checked)} className="h-5 w-5" /> Mostrar senhas
        </label>
        {erro && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{erro}</p>}
        <button type="submit" disabled={ocupado} className="w-full min-h-[48px] rounded-xl bg-brand text-white font-bold disabled:opacity-60 active:scale-[0.99]">
          {ocupado ? 'Trocando…' : 'Trocar senha'}
        </button>
      </form>
    </div>
  )
}
