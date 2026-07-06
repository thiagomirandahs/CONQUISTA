import { useState } from 'react'
import { motion } from 'framer-motion'
import { useAuth } from '../context/Auth.jsx'
import Avatar from '../components/Avatar.jsx'
import { atualizarFotoPerfil } from '../lib/dados.js'

const rotuloPapel = {
  desbravador: 'Desbravador', conselheiro: 'Conselheiro', instrutor: 'Instrutor',
  tesoureiro: 'Tesoureiro', diretoria: 'Diretoria', pais: 'Pais',
}

// Página "Meu perfil": mostra a foto atual e deixa o próprio usuário trocá-la.
export default function Perfil() {
  const { profile, recarregarPerfil } = useAuth()
  const [enviando, setEnviando] = useState(false)
  const [msg, setMsg] = useState('')
  const [erro, setErro] = useState('')
  const [previa, setPrevia] = useState(null)

  async function escolher(file) {
    if (!file) return
    if (!file.type.startsWith('image/')) { setErro('Escolha uma imagem (foto).'); return }
    setPrevia(URL.createObjectURL(file))
    setEnviando(true); setMsg(''); setErro('')
    try {
      await atualizarFotoPerfil({ userId: profile.id, file })
      await recarregarPerfil?.()
      setMsg('✅ Foto atualizada! Já aparece no ranking e nas unidades.')
    } catch (e) {
      setErro('Não foi possível: ' + (e?.message || e))
      setPrevia(null)
    }
    setEnviando(false)
  }

  return (
    <div>
      <div className="mb-4">
        <h2 className="text-2xl font-extrabold text-slate-800">👤 Meu perfil</h2>
        <p className="text-sm text-slate-500">Sua foto aparece no ranking, nas unidades e nos apontamentos</p>
      </div>

      <div className="bg-white rounded-2xl p-6 shadow-sm text-center">
        <div className="mx-auto w-28 h-28 mb-4">
          {previa
            ? <img src={previa} alt="prévia" className="w-28 h-28 rounded-full object-cover shadow ring-2 ring-white" />
            : <Avatar foto={profile?.foto} nome={profile?.nome || '?'} cor="#1e3a8a" size="w-28 h-28" textSize="text-4xl" />}
        </div>

        <div className="font-extrabold text-slate-800 text-lg">{profile?.nome}</div>
        <div className="text-sm text-slate-400 mb-4">{rotuloPapel[profile?.papel] || profile?.papel}</div>

        <label className={`inline-flex items-center gap-2 bg-azul text-white font-semibold rounded-xl px-5 py-2.5 cursor-pointer ${enviando ? 'opacity-60 pointer-events-none' : 'hover:bg-azul-claro'}`}>
          {enviando ? 'Enviando…' : '📷 Trocar foto'}
          <input type="file" accept="image/*" className="hidden" disabled={enviando}
            onChange={(e) => escolher(e.target.files?.[0])} />
        </label>

        {msg && <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-sm mt-3 text-green-600 font-semibold">{msg}</motion.p>}
        {erro && <p className="text-sm mt-3 text-red-600">{erro}</p>}
      </div>

      <p className="text-center text-xs text-slate-400 mt-4">A foto ideal é quadrada e mostra bem o rosto 🙂</p>
    </div>
  )
}
