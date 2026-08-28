import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { useAuth } from '../context/Auth.jsx'
import {
  carregarJogosTrilha, alternarJogoTrilha,
  lerReflexoSoDesbravador, salvarReflexoSoDesbravador,
  lerRodizioJogos, salvarRodizioJogos,
} from '../lib/dados.js'

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
      <div className="bg-surface rounded-2xl p-8 text-center shadow-soft">
        <div className="text-4xl mb-2">🔒</div>
        <p className="font-semibold text-ink">Área da liderança</p>
        <p className="text-sm text-faint">Apenas diretoria/instrutor ativam os jogos.</p>
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
        <h2 className="text-2xl font-extrabold text-ink">🎮 Jogos da Trilha</h2>
        <p className="text-sm text-muted">Ligue os jogos que a criançada pode jogar</p>
      </div>

      <RodizioJogos />
      <SoDesbravador />

      {carregando ? (
        <p className="text-faint text-sm">Carregando...</p>
      ) : erro || lista.length === 0 ? (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 text-sm text-amber-800">
          <p className="font-semibold mb-1">Nada pra mostrar</p>
          <p className="text-xs">Se a página é nova, rode <code className="bg-amber-100 rounded px-1">supabase/2026-07-09-jogos-trilha.sql</code> no Supabase.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {lista.map((j) => (
            <div key={j.chave} className="bg-surface rounded-2xl p-4 shadow-soft flex items-center gap-3">
              <span className="text-3xl shrink-0">{j.emoji}</span>
              <div className="flex-1 min-w-0">
                <div className="font-bold text-ink">{j.nome}</div>
                <div className="text-xs text-faint">{j.ativo ? 'Aparece pros meninos' : 'Escondido'}</div>
              </div>
              <motion.button whileTap={{ scale: 0.9 }} onClick={() => alternar(j)}
                className={`relative w-14 h-8 rounded-full shrink-0 transition-colors ${j.ativo ? 'bg-green-500' : 'bg-surface2'}`}>
                <motion.span layout className={`absolute top-1 w-6 h-6 bg-white rounded-full shadow ${j.ativo ? 'right-1' : 'left-1'}`} />
              </motion.button>
            </div>
          ))}
          <p className="text-[11px] text-faint mt-2">Se você desligar todos, a criançada ainda joga o Jogo da Memória (o clássico).</p>
        </div>
      )}
    </div>
  )
}

// Interruptor: rodízio 🥇 Jogos do Dia (3 jogos abertos por dia + prêmio +10
// pro melhor de cada; bônus do dia +20). Desligado = todos os jogos abertos
// (bônus +50 pelo dia completo). A regra de verdade fica no servidor.
function RodizioJogos() {
  const [ligado, setLigado] = useState(null)
  const [salvando, setSalvando] = useState(false)

  useEffect(() => { lerRodizioJogos().then(setLigado).catch(() => setLigado(null)) }, [])
  if (ligado === null) return null

  async function alternar() {
    const novo = !ligado
    setSalvando(true)
    try { await salvarRodizioJogos(novo); setLigado(novo) }
    catch (e) {
      alert(/config_clube|does not exist|schema cache/i.test(e?.message || '')
        ? 'Rode o SQL supabase/2026-08-28-rodizio-interruptor.sql primeiro.'
        : 'Não foi possível: ' + (e?.message || e))
    }
    setSalvando(false)
  }

  return (
    <div className="bg-surface rounded-2xl p-4 shadow-soft flex items-center gap-3 mb-4">
      <span className="text-3xl shrink-0">🥇</span>
      <div className="flex-1 min-w-0">
        <div className="font-bold text-ink">Rodízio dos Jogos do Dia</div>
        <div className="text-xs text-faint">
          {ligado
            ? 'Cada dia abrem 3 jogos; o melhor de cada leva +10 e completar o dia dá +20'
            : 'Desligado: todos os jogos abertos todo dia (completar o dia dá +50, sem prêmio de melhor)'}
        </div>
      </div>
      <motion.button whileTap={{ scale: 0.9 }} onClick={alternar} disabled={salvando}
        className={`relative w-14 h-8 rounded-full shrink-0 transition-colors disabled:opacity-60 ${ligado ? 'bg-green-500' : 'bg-surface2'}`}>
        <motion.span layout className={`absolute top-1 w-6 h-6 bg-white rounded-full shadow ${ligado ? 'right-1' : 'left-1'}`} />
      </motion.button>
    </div>
  )
}

// Interruptor: só desbravadores disputam os recordes do ⚡ Reflexo.
// A liderança continua jogando — só não entra no ranking nem ganha os +20.
function SoDesbravador() {
  const [ligado, setLigado] = useState(null)
  const [salvando, setSalvando] = useState(false)

  useEffect(() => { lerReflexoSoDesbravador().then(setLigado).catch(() => setLigado(null)) }, [])
  if (ligado === null) return null

  async function alternar() {
    const novo = !ligado
    setSalvando(true)
    try { await salvarReflexoSoDesbravador(novo); setLigado(novo) }
    catch (e) {
      alert(/config_clube|does not exist|schema cache/i.test(e?.message || '')
        ? 'Rode o SQL supabase/2026-07-27-reflexo-so-desbravador.sql primeiro.'
        : 'Não foi possível: ' + (e?.message || e))
    }
    setSalvando(false)
  }

  return (
    <div className="bg-surface rounded-2xl p-4 shadow-soft flex items-center gap-3 mb-4">
      <span className="text-3xl shrink-0">⚡</span>
      <div className="flex-1 min-w-0">
        <div className="font-bold text-ink">Reflexo: só desbravadores disputam</div>
        <div className="text-xs text-faint">
          {ligado
            ? 'A liderança joga, mas fica fora do ranking e do prêmio de +20'
            : 'Todo mundo disputa — inclusive conselheiro, instrutor e diretoria'}
        </div>
      </div>
      <motion.button whileTap={{ scale: 0.9 }} onClick={alternar} disabled={salvando}
        className={`relative w-14 h-8 rounded-full shrink-0 transition-colors disabled:opacity-60 ${ligado ? 'bg-green-500' : 'bg-surface2'}`}>
        <motion.span layout className={`absolute top-1 w-6 h-6 bg-white rounded-full shadow ${ligado ? 'right-1' : 'left-1'}`} />
      </motion.button>
    </div>
  )
}
