import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { useAuth } from '../context/Auth.jsx'
import Avatar from '../components/Avatar.jsx'
import { carregarRadarFaltas, enviarAvisoPessoal } from '../lib/dados.js'

const PODE_GERIR = ['instrutor', 'diretoria']
const fmtData = (iso) => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '')

// Radar de faltas: quem está sumindo (2+ reuniões seguidas faltando), com um
// toque pra mandar "Sentimos sua falta!" direto no celular do desbravador.
export default function RadarFaltas() {
  const { profile } = useAuth()
  const ehAdmin = PODE_GERIR.includes(profile?.papel)
  const [lista, setLista] = useState([])
  const [carregando, setCarregando] = useState(true)
  const [enviados, setEnviados] = useState({})

  useEffect(() => {
    if (!ehAdmin) { setCarregando(false); return }
    carregarRadarFaltas().then(setLista).catch(() => {}).finally(() => setCarregando(false))
  }, [ehAdmin])

  if (!ehAdmin) {
    return (
      <div className="bg-white rounded-2xl p-8 text-center shadow-sm">
        <div className="text-4xl mb-2">🔒</div>
        <p className="font-semibold text-slate-700">Área da liderança</p>
        <p className="text-sm text-slate-400">Apenas diretoria/instrutor veem o radar de faltas.</p>
      </div>
    )
  }

  async function chamar(p) {
    try {
      await enviarAvisoPessoal({
        userId: p.id, criadoPor: profile?.id,
        titulo: 'Sentimos sua falta! 🧡',
        corpo: 'O clube tá te esperando na próxima reunião. Vem participar! 🏕️',
      })
      setEnviados((e) => ({ ...e, [p.id]: true }))
    } catch (e) {
      alert('Não foi possível enviar: ' + (e?.message || e))
    }
  }

  return (
    <div>
      <div className="mb-4">
        <h2 className="text-2xl font-extrabold text-slate-800">📡 Radar de faltas</h2>
        <p className="text-sm text-slate-500">Quem está sumindo — recupere antes de perder de vez</p>
      </div>

      {carregando ? (
        <p className="text-slate-400 text-sm">Carregando...</p>
      ) : lista.length === 0 ? (
        <div className="bg-white rounded-2xl p-8 text-center shadow-sm">
          <div className="text-4xl mb-2">🎉</div>
          <p className="font-semibold text-slate-700">Ninguém sumido!</p>
          <p className="text-sm text-slate-400">Todo mundo apareceu nas últimas reuniões.</p>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-xs text-slate-400 mb-1">Faltaram 2 ou mais reuniões seguidas:</p>
          {lista.map((p) => (
            <div key={p.id} className="bg-white rounded-2xl p-3 shadow-sm flex items-center gap-3">
              <Avatar foto={p.foto} nome={p.nome} cor="#1e3a8a" size="w-10 h-10" textSize="text-base" />
              <div className="flex-1 min-w-0">
                <div className="font-bold text-slate-800 text-sm truncate">{p.nome || 'Desbravador'}</div>
                <div className="text-[11px] text-red-500 font-semibold">❌ {p.faltas} faltas seguidas · última reunião: {fmtData(p.ultima)}</div>
              </div>
              {enviados[p.id] ? (
                <span className="text-xs text-green-600 font-bold shrink-0">Enviado ✓</span>
              ) : (
                <motion.button whileTap={{ scale: 0.94 }} onClick={() => chamar(p)}
                  className="text-xs bg-azul text-white rounded-lg px-3 py-2 font-semibold shrink-0">🧡 Sentimos sua falta</motion.button>
              )}
            </div>
          ))}
          <p className="text-[11px] text-slate-400 mt-2">O aviso vai só pra essa pessoa (no sino e, se ativou, no celular).</p>
        </div>
      )}
    </div>
  )
}
