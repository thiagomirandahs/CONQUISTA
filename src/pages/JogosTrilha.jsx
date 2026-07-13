import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { useAuth } from '../context/Auth.jsx'
import { carregarJogosTrilha, alternarJogoTrilha } from '../lib/dados.js'

const PODE_GERIR = ['instrutor', 'diretoria']

// Liderança liga/desliga cada jogo da Trilha. Só os ligados aparecem pra
// criança escolher no dia.
export default function JogosTrilha() {
  const { profile } = useAuth()
  const ehAdmin = PODE_GERIR.includes(profile?.papel)
  const [lista, setLista] = useState([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState('')

  async function carregar() {
    setCarregando(true); setErro('')
    try { setLista(await carregarJogosTrilha()) } catch (e) { setErro(e?.message || 'Erro') }
    setCarregando(false)
  }
  useEffect(() => { if (ehAdmin) carregar(); else setCarregando(false) }, [ehAdmin])

  if (!ehAdmin) {
    return (
      <div className="bg-white rounded-2xl p-8 text-center shadow-sm">
        <div className="text-4xl mb-2">🔒</div>
        <p className="font-semibold text-slate-700">Área da liderança</p>
        <p className="text-sm text-slate-400">Apenas diretoria/instrutor ativam os jogos.</p>
      </div>
    )
  }

  async function alternar(j) {
    try {
      await alternarJogoTrilha(j.chave, !j.ativo)
      setLista((l) => l.map((x) => (x.chave === j.chave ? { ...x, ativo: !x.ativo } : x)))
    } catch (e) { alert('Não foi possível: ' + (e?.message || e)) }
  }

  return (
    <div>
      <div className="mb-4">
        <h2 className="text-2xl font-extrabold text-slate-800">🎮 Jogos da Trilha</h2>
        <p className="text-sm text-slate-500">Ligue os jogos que a criançada pode jogar</p>
      </div>

      {carregando ? (
        <p className="text-slate-400 text-sm">Carregando...</p>
      ) : erro || lista.length === 0 ? (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 text-sm text-amber-800">
          <p className="font-semibold mb-1">Nada pra mostrar</p>
          <p className="text-xs">Se a página é nova, rode <code className="bg-amber-100 rounded px-1">supabase/2026-07-09-jogos-trilha.sql</code> no Supabase.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {lista.map((j) => (
            <div key={j.chave} className="bg-white rounded-2xl p-4 shadow-sm flex items-center gap-3">
              <span className="text-3xl shrink-0">{j.emoji}</span>
              <div className="flex-1 min-w-0">
                <div className="font-bold text-slate-800">{j.nome}</div>
                <div className="text-xs text-slate-400">{j.ativo ? 'Aparece pros meninos' : 'Escondido'}</div>
              </div>
              <motion.button whileTap={{ scale: 0.9 }} onClick={() => alternar(j)}
                className={`relative w-14 h-8 rounded-full shrink-0 transition-colors ${j.ativo ? 'bg-green-500' : 'bg-slate-300'}`}>
                <motion.span layout className={`absolute top-1 w-6 h-6 bg-white rounded-full shadow ${j.ativo ? 'right-1' : 'left-1'}`} />
              </motion.button>
            </div>
          ))}
          <p className="text-[11px] text-slate-400 mt-2">Se você desligar todos, a criançada ainda joga o Jogo da Memória (o clássico).</p>
        </div>
      )}
    </div>
  )
}
