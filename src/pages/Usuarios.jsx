import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useAuth } from '../context/Auth.jsx'
import Avatar from '../components/Avatar.jsx'
import { carregarUsuarios, resetarSenha } from '../lib/dados.js'

const PODE_GERIR = ['instrutor', 'diretoria']
const rotuloPapel = {
  desbravador: 'Desbravador', conselheiro: 'Conselheiro', instrutor: 'Instrutor',
  tesoureiro: 'Tesoureiro', diretoria: 'Diretoria', pais: 'Pais',
}

// Gera uma senha temporária fácil de passar (sem caracteres ambíguos).
function gerarSenha() {
  const chars = 'abcdefghijkmnpqrstuvwxyz23456789'
  let s = ''
  for (let i = 0; i < 8; i++) s += chars[Math.floor(Math.random() * chars.length)]
  return s
}

export default function Usuarios() {
  const { profile } = useAuth()
  const ehAdmin = PODE_GERIR.includes(profile?.papel)
  const [usuarios, setUsuarios] = useState([])
  const [carregando, setCarregando] = useState(true)
  const [busca, setBusca] = useState('')
  const [alvo, setAlvo] = useState(null)
  const [erroCarregar, setErroCarregar] = useState('')

  useEffect(() => {
    if (!ehAdmin) { setCarregando(false); return }
    carregarUsuarios()
      .then((d) => { setUsuarios(d); setCarregando(false) })
      .catch((e) => { setErroCarregar(e?.message || 'Erro ao carregar'); setCarregando(false) })
  }, [ehAdmin])

  if (!ehAdmin) {
    return (
      <div className="bg-white rounded-2xl p-8 text-center shadow-sm">
        <div className="text-4xl mb-2">🔒</div>
        <p className="font-semibold text-slate-700">Área da diretoria</p>
        <p className="text-sm text-slate-400">Apenas diretoria/instrutor podem gerenciar usuários.</p>
      </div>
    )
  }

  const lista = usuarios.filter((u) => (u.nome || '').toLowerCase().includes(busca.toLowerCase()))

  return (
    <div>
      <div className="mb-4">
        <h2 className="text-2xl font-extrabold text-slate-800">👥 Usuários</h2>
        <p className="text-sm text-slate-500">Resetar a senha de quem não consegue entrar</p>
      </div>

      <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="🔎 Buscar por nome..."
        className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm mb-3 outline-none focus:border-azul-claro focus:ring-2 focus:ring-azul-claro/30" />

      {carregando ? (
        <p className="text-slate-400 text-sm">Carregando...</p>
      ) : erroCarregar ? (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5 text-sm text-amber-800">
          <p className="font-semibold mb-1">Não consegui carregar os usuários</p>
          <p className="text-xs mb-2">{erroCarregar}</p>
          <p className="text-xs">Se a página é nova, falta publicar a função no Supabase:
            <code className="bg-amber-100 rounded px-1 ml-1">supabase functions deploy admin-reset-senha</code></p>
        </div>
      ) : lista.length === 0 ? (
        <p className="text-slate-400 text-sm">Nenhum usuário encontrado.</p>
      ) : (
        <div className="bg-white rounded-2xl shadow-sm divide-y divide-slate-100">
          {lista.map((u) => (
            <div key={u.id} className="flex items-center gap-3 px-3 py-2.5">
              <Avatar foto={u.foto} nome={u.nome} cor="#1e3a8a" size="w-9 h-9" textSize="text-sm" />
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-slate-800 text-sm truncate">{u.nome || '(sem nome)'}</div>
                <div className="text-[11px] text-slate-400 truncate">
                  {rotuloPapel[u.papel] || u.papel}{u.status !== 'ativo' ? ' · pendente' : ''}
                </div>
                {u.email && <div className="text-[11px] text-azul/80 truncate">✉️ {u.email}</div>}
              </div>
              <button onClick={() => setAlvo(u)}
                className="text-xs bg-azul/10 text-azul rounded-lg px-3 py-2 font-semibold shrink-0">🔑 Resetar senha</button>
            </div>
          ))}
        </div>
      )}

      <AnimatePresence>
        {alvo && <ModalReset usuario={alvo} onFechar={() => setAlvo(null)} />}
      </AnimatePresence>
    </div>
  )
}

function ModalReset({ usuario, onFechar }) {
  const [senha, setSenha] = useState(gerarSenha)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')
  const [pronto, setPronto] = useState(false)
  const [copiado, setCopiado] = useState(false)

  async function confirmar() {
    if (senha.length < 6) { setErro('A senha precisa ter pelo menos 6 caracteres.'); return }
    setSalvando(true)
    setErro('')
    try {
      await resetarSenha(usuario.id, senha)
      setPronto(true)
    } catch (e) {
      setErro('Não foi possível: ' + (e?.message || e))
      setSalvando(false)
    }
  }

  async function copiar() {
    try {
      await navigator.clipboard.writeText(senha)
      setCopiado(true)
      setTimeout(() => setCopiado(false), 1500)
    } catch { /* alguns navegadores bloqueiam: a senha já está visível */ }
  }

  return (
    <motion.div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-0 sm:p-6"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onFechar}>
      <motion.div onClick={(e) => e.stopPropagation()}
        initial={{ y: 60, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 60, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 320, damping: 28 }}
        className="bg-white w-full sm:max-w-sm rounded-t-3xl sm:rounded-3xl shadow-2xl p-6">
        <h3 className="text-lg font-extrabold text-slate-800 mb-1">🔑 Resetar senha</h3>
        <p className="text-sm text-slate-500 mb-3">Nova senha para <strong>{usuario.nome}</strong>.</p>

        {usuario.email ? (
          <div className="bg-slate-50 rounded-xl p-3 mb-4 flex items-center gap-2">
            <div className="flex-1 min-w-0">
              <div className="text-[11px] text-slate-400">E-mail do cadastro</div>
              <div className="font-medium text-slate-800 text-sm truncate select-all">{usuario.email}</div>
            </div>
            <a href={`mailto:${usuario.email}`} className="text-azul text-xs font-semibold bg-azul/10 rounded-lg px-3 py-2 shrink-0">✉️ Enviar</a>
          </div>
        ) : (
          <div className="bg-slate-50 rounded-xl p-3 mb-4 text-xs text-slate-400">Sem e-mail no cadastro.</div>
        )}

        {pronto ? (
          <>
            <div className="bg-green-50 border border-green-200 rounded-xl p-4 text-center mb-4">
              <p className="text-sm text-green-700 font-semibold mb-1">✅ Senha redefinida!</p>
              <p className="text-xs text-slate-500 mb-2">Passe esta senha para {(usuario.nome || '').split(' ')[0]}:</p>
              <div className="text-xl font-extrabold tracking-wider text-slate-800 bg-white rounded-lg py-2 border border-slate-200 select-all">{senha}</div>
              <button onClick={copiar} className="text-xs text-azul font-semibold mt-2">{copiado ? 'Copiado! ✓' : '📋 Copiar senha'}</button>
            </div>
            <button onClick={onFechar} className="w-full rounded-xl bg-azul text-white font-semibold py-2.5">Fechar</button>
          </>
        ) : (
          <>
            <label className="block text-xs font-semibold text-slate-500 mb-1">Nova senha (mín. 6)</label>
            <div className="flex gap-2 mb-3">
              <input value={senha} onChange={(e) => setSenha(e.target.value)}
                className="flex-1 rounded-lg border border-slate-300 px-3 py-2.5 text-sm font-mono outline-none focus:border-azul-claro focus:ring-2 focus:ring-azul-claro/30" />
              <button type="button" onClick={() => setSenha(gerarSenha())}
                className="text-xs bg-slate-100 text-slate-600 rounded-lg px-3 font-semibold">🎲 Gerar</button>
            </div>
            {erro && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3 mb-3">{erro}</div>}
            <div className="flex gap-2">
              <button onClick={onFechar} className="flex-1 rounded-xl bg-slate-100 text-slate-700 font-semibold py-2.5">Cancelar</button>
              <motion.button onClick={confirmar} disabled={salvando} whileTap={{ scale: 0.97 }}
                className="flex-1 rounded-xl bg-azul text-white font-semibold py-2.5 disabled:opacity-60">
                {salvando ? 'Salvando...' : 'Definir senha'}
              </motion.button>
            </div>
          </>
        )}
      </motion.div>
    </motion.div>
  )
}
