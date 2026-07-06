import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { useAuth } from '../context/Auth.jsx'
import Avatar from '../components/Avatar.jsx'
import { atualizarFotoPerfil, carregarMeuExtrato } from '../lib/dados.js'

const rotuloPapel = {
  desbravador: 'Desbravador', conselheiro: 'Conselheiro', instrutor: 'Instrutor',
  tesoureiro: 'Tesoureiro', diretoria: 'Diretoria', pais: 'Pais',
}
const iconeOrigem = { apontamento: '✍️', atividade: '📋', unidade: '🛡️', devocional: '📖', missao: '🎯', trilha: '🗺️', manual: '🎖️' }
const fmtData = (iso) => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '')

// Página "Meu perfil": mostra a foto atual e deixa o próprio usuário trocá-la.
export default function Perfil() {
  const { profile, recarregarPerfil } = useAuth()
  const [enviando, setEnviando] = useState(false)
  const [msg, setMsg] = useState('')
  const [erro, setErro] = useState('')
  const [previa, setPrevia] = useState(null)
  const [extrato, setExtrato] = useState([])
  const [carregandoExtrato, setCarregandoExtrato] = useState(true)

  useEffect(() => {
    if (!profile?.id) return
    carregarMeuExtrato(profile.id)
      .then(setExtrato)
      .catch(() => {})
      .finally(() => setCarregandoExtrato(false))
  }, [profile?.id])

  const totalPts = extrato.reduce((s, p) => s + (p.pontos || 0), 0)

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

      {/* Extrato: de onde vieram meus pontos */}
      <div className="mt-6">
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-extrabold text-slate-800">⭐ Meus pontos</h3>
          {!carregandoExtrato && extrato.length > 0 && (
            <span className="text-azul font-extrabold">{totalPts} pts</span>
          )}
        </div>
        {carregandoExtrato ? (
          <p className="text-slate-400 text-sm">Carregando...</p>
        ) : extrato.length === 0 ? (
          <div className="bg-white rounded-2xl p-6 text-center shadow-sm">
            <div className="text-3xl mb-1">🚀</div>
            <p className="text-sm text-slate-500">Você ainda não tem pontos. Bora participar das atividades, missões e da trilha!</p>
          </div>
        ) : (
          <div className="bg-white rounded-2xl shadow-sm divide-y divide-slate-100">
            {extrato.map((p) => (
              <div key={p.id} className="flex items-center gap-3 px-3 py-2.5">
                <span className="text-lg shrink-0">{iconeOrigem[p.origem] || '⭐'}</span>
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-slate-700 truncate">{p.motivo || p.origem}</div>
                  <div className="text-[11px] text-slate-400">{fmtData(p.data)}</div>
                </div>
                <span className={`font-extrabold shrink-0 ${p.pontos < 0 ? 'text-red-500' : 'text-azul'}`}>{p.pontos > 0 ? '+' : ''}{p.pontos}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
