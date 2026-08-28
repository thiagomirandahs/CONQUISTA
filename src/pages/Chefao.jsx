import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useAuth } from '../context/Auth.jsx'
import { chefaoEstado, chefaoGolpe, chefaoConfig } from '../lib/dados.js'

const PODE_GERIR = ['instrutor', 'diretoria']
const fmtData = (iso) => (iso ? String(iso).slice(0, 10).split('-').reverse().slice(0, 2).join('/') : '')

function mmss(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000))
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

export default function Chefao() {
  const { profile } = useAuth()
  const ehAdmin = PODE_GERIR.includes(profile?.papel)
  const [est, setEst] = useState(null)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState('')
  const [golpeando, setGolpeando] = useState(false)
  const [hits, setHits] = useState([]) // números de dano voando
  const [agora, setAgora] = useState(Date.now())
  const [editar, setEditar] = useState(false)

  async function carregar() {
    try { setEst(await chefaoEstado()) } catch (e) { setErro(e?.message || 'Erro') }
    setCarregando(false)
  }
  useEffect(() => { carregar() }, [])

  // poll leve enquanto a batalha rola (barra "ao vivo") + ao voltar o foco
  useEffect(() => {
    const t = setInterval(carregar, 15000)
    const foco = () => { if (document.visibilityState === 'visible') carregar() }
    document.addEventListener('visibilitychange', foco)
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', foco) }
  }, [])

  // relógio de 1s pro countdown do golpe
  useEffect(() => {
    const t = setInterval(() => setAgora(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  async function golpe() {
    if (golpeando) return
    setGolpeando(true); setErro('')
    try {
      const r = await chefaoGolpe()
      // número de dano voando + tremida do chefão
      const id = Date.now()
      setHits((h) => [...h, { id, x: 30 + Math.random() * 40 }])
      setTimeout(() => setHits((h) => h.filter((x) => x.id !== id)), 1100)
      import('../lib/juice.js').then(({ acerto }) => acerto(3)).catch(() => {})
      setEst((e) => e ? { ...e, vida_atual: r.vida_atual, dano: (e.vida_total - r.vida_atual), venceu: r.venceu, golpe_pronto: false, ja_golpeei: true, proximo_golpe_em: new Date(Date.now() + 3600000).toISOString() } : e)
      if (r.venceu) { import('../lib/juice.js').then(({ vitoria }) => vitoria(3)).catch(() => {}); setTimeout(carregar, 400) }
    } catch (e) { setErro(e?.message || String(e)) }
    setGolpeando(false)
  }

  if (carregando) return <p className="text-faint text-sm text-center mt-10">Carregando…</p>

  // ---------- Sem chefão ativo ----------
  if (!est?.ativo) {
    return (
      <div className="max-w-md mx-auto">
        <h1 className="text-2xl font-extrabold text-ink mb-1">⚔️ Chefão do Fim de Semana</h1>
        <p className="text-sm text-muted mb-4">Um evento em que o clube inteiro se une pra derrotar um chefão gigante!</p>
        {ehAdmin ? (
          <FormChefao onSalvo={() => { setEditar(false); carregar() }} />
        ) : (
          <div className="bg-surface rounded-2xl p-8 text-center shadow-soft">
            <div className="text-5xl mb-2">😴</div>
            <p className="font-bold text-ink">Nenhum chefão por enquanto</p>
            <p className="text-sm text-faint mt-1">A liderança vai soltar um evento em breve — fique de olho no fim de semana! 🗡️</p>
          </div>
        )}
      </div>
    )
  }

  const vidaPct = Math.round((100 * est.vida_atual) / Math.max(1, est.vida_total))
  const venceu = est.venceu
  const fase = est.fase // antes | rolando | acabou
  const restam = est.proximo_golpe_em ? new Date(est.proximo_golpe_em).getTime() - agora : 0
  const golpeRecarregando = est.ja_golpeei && restam > 0 && !venceu && fase === 'rolando'
  const maxUni = Math.max(1, ...((est.por_unidade || []).map((u) => u.dano)))

  return (
    <div className="max-w-md mx-auto">
      <div className="flex items-center justify-between mb-2">
        <h1 className="text-xl font-extrabold text-ink">⚔️ {est.nome}</h1>
        {ehAdmin && (
          <button onClick={() => setEditar((v) => !v)} className="text-xs font-semibold text-muted bg-surface2 rounded-lg px-3 py-1.5">⚙️ {editar ? 'Fechar' : 'Editar'}</button>
        )}
      </div>

      {editar && ehAdmin && <div className="mb-3"><FormChefao inicial={est} onSalvo={() => { setEditar(false); carregar() }} /></div>}

      {/* Card de batalha */}
      <div className="relative rounded-3xl p-5 shadow-md overflow-hidden text-center"
        style={{ background: venceu ? 'linear-gradient(160deg,#134e2b,#0b3a20)' : 'linear-gradient(160deg,#2a1436,#3a1030)' }}>
        {/* dano voando */}
        <AnimatePresence>
          {hits.map((h) => (
            <motion.span key={h.id} initial={{ opacity: 0, y: 20, scale: 0.6 }} animate={{ opacity: [0, 1, 1, 0], y: -70, scale: 1.2 }}
              exit={{ opacity: 0 }} transition={{ duration: 1.05, ease: 'easeOut' }}
              className="absolute z-20 text-2xl font-extrabold text-gold pointer-events-none select-none"
              style={{ left: `${h.x}%`, top: '38%' }}>-25 💥</motion.span>
          ))}
        </AnimatePresence>

        <motion.div className="text-7xl mb-1 inline-block select-none" aria-hidden="true"
          animate={venceu ? { rotate: 0, y: [0, -6, 0], filter: 'grayscale(1) opacity(0.6)' } : { rotate: [0, -4, 4, -3, 3, 0], y: [0, -3, 0] }}
          transition={venceu ? { duration: 2, repeat: Infinity } : { duration: 3.2, repeat: Infinity, ease: 'easeInOut' }}>
          {venceu ? '💀' : est.emoji}
        </motion.div>

        {venceu ? (
          <p className="text-2xl font-extrabold text-white">Derrotado! 🎉</p>
        ) : (
          <p className="text-white/90 text-sm font-semibold">
            {fase === 'antes' ? `Aparece ${fmtData(est.inicio)} — prepare-se! 🛡️`
              : fase === 'acabou' ? 'A batalha acabou — resultado sai já já…'
              : 'Todo mundo junto contra ele! 💪'}
          </p>
        )}

        {/* Barra de vida */}
        <div className="mt-4">
          <div className="flex justify-between text-[11px] font-bold text-white/80 mb-1">
            <span>❤️ Vida do {est.nome}</span>
            <span>{est.vida_atual.toLocaleString('pt-BR')} / {est.vida_total.toLocaleString('pt-BR')}</span>
          </div>
          <div className="h-5 bg-black/40 rounded-full overflow-hidden border border-white/10">
            <motion.div className="h-full rounded-full"
              style={{ background: venceu ? '#22c55e' : vidaPct < 25 ? 'linear-gradient(90deg,#f59e0b,#ef4444)' : 'linear-gradient(90deg,#ef4444,#b91c1c)' }}
              animate={{ width: `${vidaPct}%` }} transition={{ type: 'spring', stiffness: 120, damping: 22 }} />
          </div>
          <p className="text-[11px] text-white/70 mt-1">💥 {est.dano.toLocaleString('pt-BR')} de dano do clube até agora</p>
        </div>

        {est.versiculo && !venceu && (
          <p className="text-white/80 text-xs italic mt-3 leading-snug">"{est.versiculo}"</p>
        )}
      </div>

      {/* Golpe especial */}
      {!venceu && fase === 'rolando' && (
        <div className="mt-3">
          {golpeRecarregando ? (
            <button disabled className="w-full rounded-2xl py-4 font-extrabold bg-surface2 text-muted">
              🗡️ Golpe recarregando… <span className="text-faint">{mmss(restam)}</span>
            </button>
          ) : (
            <motion.button whileTap={{ scale: 0.96 }} disabled={golpeando} onClick={golpe}
              className="w-full rounded-2xl py-4 font-extrabold text-white bg-gradient-to-r from-red-500 to-orange-500 shadow-glow disabled:opacity-60">
              🗡️ Golpe especial! <span className="opacity-80 font-bold">(-25)</span>
            </motion.button>
          )}
          <p className="text-[11px] text-faint text-center mt-1">Cada jogo, missão e leitura que você faz no fim de semana já bate no chefão. O golpe especial recarrega 1x por hora. ⏳</p>
        </div>
      )}

      {venceu && (
        <div className="mt-3 bg-green-50 border border-green-200 rounded-2xl p-4 text-center">
          <p className="font-extrabold text-green-700">🏆 O clube venceu junto!</p>
          <p className="text-sm text-muted mt-0.5">Quem deu ao menos 1 golpe leva <b>+15</b>, e o time que mais golpeou leva <b>+30</b> — sai no domingo à noite. 🎉</p>
        </div>
      )}

      {erro && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3 mt-3">{erro}</div>}

      {/* Placar por unidade (torcida coletiva — nunca "quem fez menos") */}
      {(est.por_unidade || []).length > 0 && (
        <div className="bg-surface rounded-2xl shadow-soft p-4 mt-3">
          <h3 className="font-bold text-ink text-sm mb-2">🛡️ Dano por unidade</h3>
          <div className="space-y-2">
            {est.por_unidade.map((u, i) => (
              <div key={u.unidade + i}>
                <div className="flex justify-between text-xs font-semibold text-muted mb-0.5">
                  <span>{['🥇', '🥈', '🥉'][i] || '•'} {u.unidade}</span>
                  <span>{u.dano.toLocaleString('pt-BR')} 💥</span>
                </div>
                <div className="h-2 bg-surface2 rounded-full overflow-hidden">
                  <motion.div className="h-full bg-gradient-to-r from-brand to-brand2 rounded-full"
                    animate={{ width: `${Math.round((100 * u.dano) / maxUni)}%` }} transition={{ type: 'spring', stiffness: 150, damping: 24 }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ---------------- Config da liderança ----------------
function FormChefao({ inicial, onSalvo }) {
  const [form, setForm] = useState(() => ({
    nome: inicial?.nome || '', emoji: inicial?.emoji || '🗿',
    vida: inicial?.vida_total || 3000, versiculo: inicial?.versiculo || '',
    inicio: inicial?.inicio ? String(inicial.inicio).slice(0, 10) : '',
  }))
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))
  const cls = 'w-full rounded-lg border border-line bg-surface2 px-3 py-2.5 text-sm text-ink outline-none focus:border-brand'

  const SUGESTOES = [
    { nome: 'Golias', emoji: '🗿', versiculo: 'Tu vens a mim com espada… mas eu venho em nome do Senhor. — 1 Samuel 17:45' },
    { nome: 'A Tempestade', emoji: '🌊', versiculo: 'Ele repreendeu o vento e disse ao mar: Cala-te, aquieta-te! — Marcos 4:39' },
    { nome: 'O Dragão', emoji: '🐉', versiculo: 'Resisti ao diabo, e ele fugirá de vós. — Tiago 4:7' },
  ]

  async function salvar(ligar) {
    setErro('')
    if (ligar && !form.nome.trim()) return setErro('Dê um nome ao chefão.')
    if (ligar && !form.inicio) return setErro('Escolha o sábado de início.')
    setSalvando(true)
    try {
      await chefaoConfig({ ...form, vida: Number(form.vida) || 3000, ativo: ligar })
      onSalvo()
    } catch (e) { setErro(e?.message || String(e)); setSalvando(false) }
  }

  return (
    <div className="bg-surface rounded-2xl shadow-soft p-4">
      <h3 className="font-bold text-ink text-sm mb-1">⚙️ Montar o chefão</h3>
      <p className="text-xs text-muted mb-3">Nasce desligado. A vida = quantos pontos o clube precisa somar no fim de semana pra derrotar (calibre pela quantidade de crianças).</p>

      <div className="flex gap-1.5 mb-3 flex-wrap">
        {SUGESTOES.map((s) => (
          <button key={s.nome} onClick={() => setForm((f) => ({ ...f, ...s }))}
            className="text-xs font-semibold bg-surface2 rounded-full px-3 py-1.5">{s.emoji} {s.nome}</button>
        ))}
      </div>

      <div className="space-y-2">
        <div className="grid grid-cols-3 gap-2">
          <div className="col-span-2">
            <label className="block text-xs font-medium text-ink mb-1">Nome</label>
            <input className={cls} value={form.nome} onChange={(e) => set('nome', e.target.value)} placeholder="Ex.: Golias" maxLength={30} />
          </div>
          <div>
            <label className="block text-xs font-medium text-ink mb-1">Emoji</label>
            <input className={cls + ' text-center text-lg'} value={form.emoji} onChange={(e) => set('emoji', e.target.value.slice(0, 4))} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-xs font-medium text-ink mb-1">Vida (pontos)</label>
            <input type="number" className={cls} value={form.vida} onChange={(e) => set('vida', e.target.value)} min={100} step={100} />
          </div>
          <div>
            <label className="block text-xs font-medium text-ink mb-1">Sábado de início</label>
            <input type="date" className={cls} value={form.inicio} onChange={(e) => set('inicio', e.target.value)} />
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium text-ink mb-1">Versículo-tema (opcional)</label>
          <textarea rows="2" className={cls} value={form.versiculo} onChange={(e) => set('versiculo', e.target.value)} placeholder="Ex.: Davi e Golias…" maxLength={240} />
        </div>
      </div>

      {erro && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-2 mt-2">{erro}</div>}

      <div className="flex gap-2 mt-3">
        {inicial?.ativo && (
          <button disabled={salvando} onClick={() => salvar(false)} className="flex-1 rounded-lg border border-line py-2.5 font-semibold text-muted">Desligar</button>
        )}
        <button disabled={salvando} onClick={() => salvar(true)}
          className="flex-1 rounded-lg bg-gradient-to-r from-red-500 to-orange-500 text-white py-2.5 font-extrabold shadow-glow disabled:opacity-60">
          {salvando ? '...' : inicial?.ativo ? 'Salvar' : '⚔️ Ligar chefão'}
        </button>
      </div>
    </div>
  )
}
