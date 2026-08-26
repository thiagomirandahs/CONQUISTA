import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { useAuth } from '../context/Auth.jsx'
import Avatar from '../components/Avatar.jsx'
import AvatarPersonagem from '../components/AvatarPersonagem.jsx'
import PersonalizarAvatar from '../components/PersonalizarAvatar.jsx'
import { atualizarFotoPerfil, carregarMeuExtrato, carregarMetricasConquistas, meuTotalPontos } from '../lib/dados.js'
import { somLigado, alternarSom, vitoria as festa } from '../lib/juice.js'
import { calcularNivel } from '../lib/nivel.js'

const CHAVE_NIVEL_VISTO = 'nivelVisto'

const rotuloPapel = {
  desbravador: 'Desbravador', conselheiro: 'Conselheiro', instrutor: 'Instrutor',
  tesoureiro: 'Tesoureiro', diretoria: 'Diretoria', pais: 'Pais',
}
const iconeOrigem = { apontamento: '✍️', atividade: '📋', unidade: '🛡️', devocional: '📖', missao: '🎯', trilha: '🗺️', manual: '🎖️', acampamento: '🏕️', leilao: '🏛️' }
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
  const [metricas, setMetricas] = useState({ passos: 0, sequencia: 0, fotos: 0 })
  const [somOn, setSomOn] = useState(true)
  const [totalPts, setTotalPts] = useState(0)
  const [personalizando, setPersonalizando] = useState(false)
  const [subiuNivel, setSubiuNivel] = useState(0)
  useEffect(() => { setSomOn(somLigado()) }, [])

  useEffect(() => {
    if (!profile?.id) return
    carregarMeuExtrato(profile.id)
      .then(setExtrato)
      .catch(() => {})
      .finally(() => setCarregandoExtrato(false))
    carregarMetricasConquistas(profile.id).then(setMetricas).catch(() => {})
    meuTotalPontos().then((t) => {
      setTotalPts(t)
      const nivelAgora = calcularNivel(t).nivel
      const visto = Number(localStorage.getItem(CHAVE_NIVEL_VISTO) || 0)
      if (visto > 0 && nivelAgora > visto) { festa(3); setSubiuNivel(nivelAgora) }
      localStorage.setItem(CHAVE_NIVEL_VISTO, String(nivelAgora))
    }).catch(() => {})
  }, [profile?.id])

  const nivel = calcularNivel(totalPts)
  const porOrigem = extrato.reduce((m, p) => { m[p.origem] = (m[p.origem] || 0) + 1; return m }, {})
  const medalhas = Math.floor((metricas.passos || 0) / 6)
  const missoesFeitas = (porOrigem.missao || 0) + (porOrigem.devocional || 0)
  const conquistas = [
    { emoji: '🌱', nome: 'Primeiros passos', atual: totalPts, meta: 1 },
    { emoji: '⭐', nome: 'Cem pontos', atual: totalPts, meta: 100 },
    { emoji: '🔥', nome: 'Ofensiva 7 dias', atual: metricas.sequencia, meta: 7 },
    { emoji: '💥', nome: 'Ofensiva 30 dias', atual: metricas.sequencia, meta: 30 },
    { emoji: '🏅', nome: 'Conquistou a Trilha', atual: medalhas, meta: 1 },
    { emoji: '🗺️', nome: 'Explorador', atual: metricas.passos, meta: 10 },
    { emoji: '📖', nome: 'Devoto', atual: missoesFeitas, meta: 10 },
    { emoji: '📋', nome: 'Caprichoso', atual: porOrigem.atividade || 0, meta: 5 },
    { emoji: '📸', nome: 'Fotógrafo', atual: metricas.fotos, meta: 3 },
  ].map((b) => ({ ...b, pronto: b.atual >= b.meta }))
  const nConquistadas = conquistas.filter((b) => b.pronto).length

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

      {subiuNivel > 0 && (
        <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}
          className="mb-4 rounded-2xl p-4 text-center text-white shadow-sm"
          style={{ background: 'linear-gradient(90deg,#1e3a8a,#4338ca)' }}>
          <div className="text-3xl mb-1">🎉</div>
          <p className="font-extrabold">Você subiu pro Nível {subiuNivel}!</p>
          <p className="text-xs text-blue-100 mt-0.5">Talvez tenha peça nova pra desbloquear no seu avatar 👀</p>
        </motion.div>
      )}

      {/* Nível (derivado dos pontos da temporada) */}
      <div className="bg-white rounded-2xl p-4 shadow-sm mb-4">
        <div className="flex items-center justify-between mb-1.5">
          <span className="font-extrabold text-slate-800">🌟 Nível {nivel.nivel}</span>
          <span className="text-xs text-slate-400">{totalPts} pts</span>
        </div>
        <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden">
          <motion.div className="h-full bg-gradient-to-r from-azul to-dourado rounded-full"
            initial={{ width: 0 }} animate={{ width: `${Math.round(nivel.progresso * 100)}%` }} transition={{ duration: 0.6 }} />
        </div>
        <p className="text-[11px] text-slate-400 mt-1.5">
          {nivel.faltam > 0 ? `Faltam ${nivel.faltam} pts pro Nível ${nivel.nivel + 1}` : 'Nível máximo por enquanto — você é demais! 🏆'}
        </p>
      </div>

      <div className="bg-white rounded-2xl p-6 shadow-sm text-center">
        <div className="mx-auto w-28 h-28 mb-4">
          {previa
            ? <img src={previa} alt="prévia" className="w-28 h-28 rounded-full object-cover shadow ring-2 ring-white" />
            : profile?.avatar_tipo === 'personagem'
              ? <AvatarPersonagem avatar={profile?.avatar} size="w-28 h-28" />
              : <Avatar foto={profile?.foto} nome={profile?.nome || '?'} cor="#1e3a8a" size="w-28 h-28" textSize="text-4xl" />}
        </div>

        <div className="font-extrabold text-slate-800 text-lg">{profile?.nome}</div>
        <div className="text-sm text-slate-400 mb-4">{rotuloPapel[profile?.papel] || profile?.papel}</div>

        <div className="flex gap-2 justify-center flex-wrap">
          <label className={`inline-flex items-center gap-2 bg-azul text-white font-semibold rounded-xl px-5 py-2.5 cursor-pointer ${enviando ? 'opacity-60 pointer-events-none' : 'hover:bg-azul-claro'}`}>
            {enviando ? 'Enviando…' : '📷 Trocar foto'}
            <input type="file" accept="image/*" className="hidden" disabled={enviando}
              onChange={(e) => escolher(e.target.files?.[0])} />
          </label>
          <button onClick={() => setPersonalizando(true)}
            className="inline-flex items-center gap-2 bg-dourado/15 text-amber-700 font-semibold rounded-xl px-5 py-2.5">
            🧑‍🎨 Meu avatar
          </button>
        </div>

        {msg && <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-sm mt-3 text-green-600 font-semibold">{msg}</motion.p>}
        {erro && <p className="text-sm mt-3 text-red-600">{erro}</p>}
      </div>

      <p className="text-center text-xs text-slate-400 mt-4">A foto ideal é quadrada e mostra bem o rosto 🙂</p>

      {/* Ofensiva (sequência de dias fazendo a missão) */}
      <div className="mt-6 rounded-2xl p-4 text-white flex items-center gap-3 shadow-sm"
        style={{ background: 'linear-gradient(90deg,#f97316,#f59e0b)' }}>
        <div className="text-4xl">🔥</div>
        <div className="min-w-0">
          <div className="text-2xl font-extrabold leading-none">{metricas.sequencia} dia{metricas.sequencia === 1 ? '' : 's'}</div>
          <div className="text-xs text-white/90 mt-1">
            {metricas.sequencia > 0
              ? 'de ofensiva! Não perca o ritmo — faça a missão de hoje. 🎯'
              : 'Faça a missão de hoje pra começar sua ofensiva!'}
          </div>
        </div>
      </div>

      {/* Estante de conquistas (insígnias colecionáveis) */}
      <div className="mt-6">
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-extrabold text-slate-800">🎖️ Minhas conquistas</h3>
          <span className="text-xs text-slate-400">{nConquistadas} de {conquistas.length}</span>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {conquistas.map((b) => (
            <div key={b.nome} className={`rounded-xl p-3 text-center border ${b.pronto ? 'bg-amber-50 border-dourado/40' : 'bg-slate-50 border-slate-200'}`}>
              <div className={`text-3xl ${b.pronto ? '' : 'grayscale opacity-40'}`}>{b.emoji}</div>
              <div className={`text-[11px] font-bold mt-1 leading-tight ${b.pronto ? 'text-amber-700' : 'text-slate-500'}`}>{b.nome}</div>
              <div className="text-[10px] text-slate-400 mt-0.5">{b.pronto ? '✓ conquistada' : `${Math.min(b.atual, b.meta)}/${b.meta}`}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Extrato: de onde vieram meus pontos */}
      <div className="mt-6">
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-extrabold text-slate-800">⭐ Meu histórico de pontos</h3>
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

      {/* Som e vibração dos jogos (desliga pra sala de aula/culto) */}
      <div className="mt-6 bg-white rounded-2xl p-4 shadow-sm flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="font-bold text-slate-800 text-sm">{somOn ? '🔊' : '🔇'} Som e vibração dos jogos</div>
          <div className="text-xs text-slate-400 mt-0.5">Efeitos ao acertar, errar e vencer</div>
        </div>
        <button
          onClick={() => setSomOn(alternarSom())}
          aria-label={somOn ? 'Desligar som e vibração' : 'Ligar som e vibração'}
          className={`shrink-0 w-12 h-7 rounded-full relative transition-colors ${somOn ? 'bg-azul' : 'bg-slate-300'}`}>
          <motion.span layout transition={{ type: 'spring', stiffness: 500, damping: 30 }}
            className="absolute top-1 w-5 h-5 bg-white rounded-full shadow"
            style={{ left: somOn ? 24 : 4 }} />
        </button>
      </div>

      {personalizando && (
        <PersonalizarAvatar avatarAtual={profile?.avatar} nivel={nivel.nivel}
          onFechar={() => setPersonalizando(false)}
          onSalvo={async () => { setPersonalizando(false); await recarregarPerfil?.() }} />
      )}
    </div>
  )
}
