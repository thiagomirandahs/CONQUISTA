import { useState, useEffect, useMemo } from 'react'
import { motion, AnimatePresence, useAnimationControls } from 'framer-motion'
import { Link } from 'react-router-dom'
import { meuBichinho, adotarBichinho, cuidarBichinho, equiparBichinho, vestirBichinho } from '../lib/dados.js'
import { montarBichinhoSvg, montarCenarioSvg, ESPECIES, ITENS, CORES, OLHOS, CENARIOS } from '../lib/bichinhoPecas.js'

function humorDe(b) {
  if (!b?.vivo) return 'morto'
  const min = Math.min(b.fome, b.higiene, b.felicidade)
  if (min <= 15) return 'doente'
  if (min <= 40) return 'triste'
  if (b.fome >= 75 && b.higiene >= 75 && b.felicidade >= 75) return 'feliz'
  return 'ok'
}

function BichinhoImg({ especie, humor, estagio, item = 'nenhum', cor = 'natural', olhos = 'padrao', animar = false, size = 190 }) {
  const svg = useMemo(() => montarBichinhoSvg({ especie, humor, estagio, item, cor, olhos, animar }), [especie, humor, estagio, item, cor, olhos, animar])
  return <svg viewBox="0 0 100 100" width={size} height={size} dangerouslySetInnerHTML={{ __html: svg }} />
}

// Cenário de fundo (o "mundinho"). Encaixa com o chão colado no rodapé do card.
function CenarioBg({ cenario = 'quintal', className = '' }) {
  const svg = useMemo(() => montarCenarioSvg(cenario), [cenario])
  return <svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMax slice" aria-hidden="true"
    className={className} dangerouslySetInnerHTML={{ __html: svg }} />
}

// Botãozinho de opção (enfeite/cor/olhos): trava por nível, marca o ativo.
function OpBtn({ bloq, ativo, nivel, nome, onClick, children }) {
  return (
    <button disabled={bloq} onClick={onClick}
      className={`rounded-xl p-1 border-2 flex flex-col items-center transition ${ativo ? 'border-brand bg-surface2' : 'border-line'} ${bloq ? 'opacity-50' : ''}`}>
      {children}
      <span className="text-[10px] font-semibold text-muted leading-none">{nome}</span>
      {bloq && <span className="text-[9px] text-faint leading-none mt-0.5">nível {nivel}</span>}
    </button>
  )
}

function Barra({ icone, rotulo, valor }) {
  const cor = valor <= 20 ? 'bg-red-500' : valor <= 45 ? 'bg-amber-400' : 'bg-green-500'
  return (
    <div>
      <div className="flex justify-between text-xs font-semibold text-muted mb-1">
        <span>{icone} {rotulo}</span><span>{valor}%</span>
      </div>
      <div className="h-2.5 bg-surface2 rounded-full overflow-hidden">
        <motion.div className={`h-full ${cor}`} animate={{ width: `${valor}%` }} transition={{ type: 'spring', stiffness: 200, damping: 26 }} />
      </div>
    </div>
  )
}

export default function Bichinho() {
  const [bicho, setBicho] = useState(null)
  const [carregando, setCarregando] = useState(true)
  const [cuidando, setCuidando] = useState('')
  const [flash, setFlash] = useState('') // +pts ou aviso rápido
  const [erro, setErro] = useState('')
  const [hearts, setHearts] = useState([]) // coraçõezinhos que sobem ao cuidar
  const [aba, setAba] = useState('enfeite') // aba do painel Personalizar
  const petControls = useAnimationControls()

  // Reação alegre ao cuidar: pulão + balançada + chuva de coraçõezinhos.
  function reagir() {
    petControls.start({
      y: [0, -18, 0, -6, 0],
      scale: [1, 1.16, 0.92, 1.06, 1],
      rotate: [0, -7, 7, -3, 0],
      transition: { duration: 0.75, ease: 'easeOut' },
    })
    const base = Date.now()
    const emojis = ['💛', '✨', '🥰', '💫', '💚', '⭐', '🎉']
    const novos = Array.from({ length: 7 }, (_, i) => ({
      id: base + i, x: 24 + Math.random() * 52, drift: (Math.random() - 0.5) * 36, e: emojis[i % emojis.length],
    }))
    setHearts((h) => [...h, ...novos])
    setTimeout(() => setHearts((h) => h.filter((x) => !novos.some((n) => n.id === x.id))), 1500)
  }

  async function carregar() {
    setCarregando(true)
    try { setBicho(await meuBichinho()) } catch (e) { setErro(e?.message || 'Erro') }
    setCarregando(false)
  }
  useEffect(() => { carregar() }, [])

  async function cuidar(acao) {
    if (cuidando) return
    setCuidando(acao); setErro('')
    try {
      const r = await cuidarBichinho(acao)
      if (r?.morreu) { await carregar(); return }
      // atualiza barrinhas na hora
      setBicho((b) => b ? { ...b, fome: r.fome, higiene: r.higiene, felicidade: r.felicidade,
        cuidados_total: (b.cuidados_total || 0) + 1, cuidou_hoje: true } : b)
      reagir()
      if (r?.pontos_ganhos > 0) {
        setFlash(`+${r.pontos_ganhos} pts 🎉`)
        import('../lib/juice.js').then(({ vitoria }) => vitoria(2)).catch(() => {})
      } else {
        setFlash('💛')
        import('../lib/juice.js').then(({ acerto }) => acerto(1)).catch(() => {})
      }
      setTimeout(() => setFlash(''), 1800)
    } catch (e) { setErro(e?.message || String(e)) }
    setCuidando('')
  }

  async function equipar(item) {
    setErro('')
    const anterior = bicho?.item
    setBicho((b) => b ? { ...b, item } : b) // otimista
    try { await equiparBichinho(item) }
    catch (e) { setBicho((b) => b ? { ...b, item: anterior } : b); setErro(e?.message || String(e)) }
  }

  // Personalizar visual: campo ∈ 'cenario' | 'cor' | 'olhos' (otimista).
  async function vestir(campo, valor) {
    setErro('')
    const anterior = bicho?.[campo]
    setBicho((b) => b ? { ...b, [campo]: valor } : b)
    try { await vestirBichinho(campo, valor) }
    catch (e) { setBicho((b) => b ? { ...b, [campo]: anterior } : b); setErro(e?.message || String(e)) }
  }

  if (carregando) return <p className="text-faint text-sm text-center mt-10">Carregando…</p>

  // ---------- Sem bichinho, ou morreu → tela de adotar ----------
  if (!bicho?.tem || !bicho?.vivo) {
    return <Adotar morto={bicho?.tem && !bicho?.vivo} nomeAntigo={bicho?.nome} especieAntiga={bicho?.especie} onPronto={carregar} />
  }

  const humor = humorDe(bicho)
  const emPerigo = !!bicho.em_perigo
  const horasParaMorte = Math.max(0, 72 - (bicho.horas_sem_cuidado || 0))
  const estagioNome = { 1: 'Filhote', 2: 'Jovem', 3: 'Adulto' }[bicho.estagio] || 'Filhote'

  return (
    <div className="max-w-md mx-auto">
      <div className="flex items-center justify-between mb-2">
        <div>
          <h1 className="text-xl font-extrabold text-brand">{bicho.nome}</h1>
          <p className="text-xs text-muted">{estagioNome} · {bicho.dias_cuidados || 0} {bicho.dias_cuidados === 1 ? 'dia cuidando' : 'dias cuidando'}</p>
        </div>
        {bicho.ofensiva > 0 && (
          <span className="text-sm font-extrabold bg-orange-100 text-orange-600 rounded-full px-3 py-1">🔥 {bicho.ofensiva} {bicho.ofensiva === 1 ? 'dia' : 'dias'}</span>
        )}
      </div>

      <div className="rounded-3xl border border-line shadow-soft p-5 text-center relative overflow-hidden">
        <CenarioBg cenario={bicho.cenario} className="absolute inset-0 w-full h-full" />
        <div className="relative z-10">
          <AnimatePresence>
            {flash && (
              <motion.div key={flash} initial={{ opacity: 0, y: 10, scale: 0.8 }} animate={{ opacity: 1, y: -6, scale: 1 }} exit={{ opacity: 0 }}
                className="absolute left-1/2 -translate-x-1/2 top-0 text-sm font-extrabold text-green-600 bg-white/85 rounded-full px-2 py-0.5 z-10">{flash}</motion.div>
            )}
          </AnimatePresence>
          {hearts.map((h) => (
            <motion.span key={h.id} initial={{ opacity: 0, y: 10, scale: 0.5 }} animate={{ opacity: [0, 1, 0], y: -92, scale: 1.1, x: h.drift }}
              transition={{ duration: 1.4, ease: 'easeOut' }} className="absolute bottom-16 text-2xl pointer-events-none select-none z-10"
              style={{ left: `${h.x}%` }}>{h.e}</motion.span>
          ))}
          <motion.div animate={{ y: [0, -6, 0] }} transition={{ repeat: Infinity, duration: 2.4, ease: 'easeInOut' }}>
            <motion.div animate={petControls} style={{ transformOrigin: '50% 85%' }}>
              <BichinhoImg especie={bicho.especie} humor={humor} estagio={bicho.estagio} item={bicho.item} cor={bicho.cor} olhos={bicho.olhos} animar />
            </motion.div>
          </motion.div>
          {emPerigo && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-xs font-bold rounded-xl p-2 -mt-1 mb-1">
              🆘 {bicho.nome} está muito carente! Cuide hoje — faltam ~{horasParaMorte}h pra ele passar mal.
            </div>
          )}
        </div>
      </div>

      <div className="bg-surface rounded-2xl shadow-soft p-4 mt-3 space-y-3">
        <Barra icone="🍖" rotulo="Fome" valor={bicho.fome} />
        <Barra icone="🛁" rotulo="Higiene" valor={bicho.higiene} />
        <Barra icone="😊" rotulo="Felicidade" valor={bicho.felicidade} />
      </div>

      {erro && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3 mt-3">{erro}</div>}

      <div className="grid grid-cols-3 gap-2 mt-3">
        {[['alimentar', '🍎', 'Alimentar'], ['banho', '🛁', 'Dar banho'], ['brincar', '🎾', 'Brincar']].map(([acao, ic, lbl]) => (
          <motion.button key={acao} whileTap={{ scale: 0.94 }} disabled={!!cuidando} onClick={() => cuidar(acao)}
            className="bg-gradient-to-r from-brand to-brand2 shadow-glow text-white font-bold rounded-2xl py-3 flex flex-col items-center gap-1 disabled:opacity-60">
            <span className="text-2xl">{ic}</span>
            <span className="text-xs">{lbl}</span>
          </motion.button>
        ))}
      </div>

      <div className="bg-surface rounded-2xl shadow-soft p-4 mt-3">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-bold text-ink text-sm">🎨 Personalizar</h3>
          <Link to="/pets-clube" className="text-xs font-semibold text-brand">Ver pets do clube →</Link>
        </div>

        <div className="grid grid-cols-4 gap-1 bg-surface2 rounded-xl p-1 mb-3">
          {[['enfeite', '🎩', 'Enfeite'], ['cor', '🎨', 'Cor'], ['olhos', '👀', 'Olhos'], ['cenario', '🌄', 'Cenário']].map(([id, ic, lbl]) => (
            <button key={id} onClick={() => setAba(id)}
              className={`rounded-lg py-1.5 text-[11px] font-bold flex flex-col items-center gap-0.5 transition ${aba === id ? 'bg-surface shadow-soft text-brand' : 'text-muted'}`}>
              <span className="text-base leading-none">{ic}</span>{lbl}
            </button>
          ))}
        </div>

        {aba === 'enfeite' && (
          <div className="grid grid-cols-4 gap-2">
            {ITENS.map((it) => (
              <OpBtn key={it.id} bloq={(bicho.nivel || 1) < it.nivel} ativo={bicho.item === it.id} nivel={it.nivel} nome={it.nome} onClick={() => equipar(it.id)}>
                <BichinhoImg especie={bicho.especie} humor="feliz" estagio={2} item={it.id} cor={bicho.cor} olhos={bicho.olhos} size={46} />
              </OpBtn>
            ))}
          </div>
        )}

        {aba === 'cor' && (
          <div className="grid grid-cols-4 gap-2">
            {CORES.map((c) => (
              <OpBtn key={c.id} bloq={(bicho.nivel || 1) < c.nivel} ativo={(bicho.cor || 'natural') === c.id} nivel={c.nivel} nome={c.nome} onClick={() => vestir('cor', c.id)}>
                <BichinhoImg especie={bicho.especie} humor="feliz" estagio={2} item="nenhum" cor={c.id} olhos={bicho.olhos} size={46} />
              </OpBtn>
            ))}
          </div>
        )}

        {aba === 'olhos' && (
          <div className="grid grid-cols-3 gap-2">
            {OLHOS.map((o) => (
              <OpBtn key={o.id} bloq={(bicho.nivel || 1) < o.nivel} ativo={(bicho.olhos || 'padrao') === o.id} nivel={o.nivel} nome={o.nome} onClick={() => vestir('olhos', o.id)}>
                <BichinhoImg especie={bicho.especie} humor="feliz" estagio={2} item="nenhum" cor={bicho.cor} olhos={o.id} size={56} />
              </OpBtn>
            ))}
          </div>
        )}

        {aba === 'cenario' && (
          <div className="grid grid-cols-4 gap-2">
            {CENARIOS.map((c) => {
              const bloq = (bicho.nivel || 1) < c.nivel
              const ativo = (bicho.cenario || 'quintal') === c.id
              return (
                <button key={c.id} disabled={bloq} onClick={() => vestir('cenario', c.id)}
                  className={`rounded-xl border-2 flex flex-col items-center overflow-hidden transition ${ativo ? 'border-brand' : 'border-line'} ${bloq ? 'opacity-50' : ''}`}>
                  <div className="relative w-full h-12">
                    <CenarioBg cenario={c.id} className="absolute inset-0 w-full h-full" />
                    <div className="absolute inset-0 flex items-end justify-center">
                      <BichinhoImg especie={bicho.especie} humor="feliz" estagio={1} item="nenhum" cor={bicho.cor} olhos={bicho.olhos} size={34} />
                    </div>
                  </div>
                  <span className="text-[10px] font-semibold text-muted leading-none py-0.5">{c.nome}</span>
                  {bloq && <span className="text-[9px] text-faint leading-none pb-0.5">nível {c.nivel}</span>}
                </button>
              )
            })}
          </div>
        )}
      </div>

      <p className="text-[11px] text-faint text-center mt-3">
        Fazer pelo menos <b>1 cuidado por dia</b> já mantém {bicho.nome} vivo e feliz, dá <b>+2 pontos</b> e mantém sua ofensiva 🔥. Se ficar <b>3 dias sem nenhum cuidado</b>, ele pode ir embora. 🥺
      </p>
    </div>
  )
}

// ---------------- Tela de adotar (novo ou depois da morte) ----------------
function Adotar({ morto, nomeAntigo, especieAntiga, onPronto }) {
  const [especie, setEspecie] = useState('cachorro')
  const [nome, setNome] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState('')

  async function adotar() {
    const n = nome.trim()
    if (!n) { setErro('Dê um nome ao bichinho 🙂'); return }
    setEnviando(true); setErro('')
    try { await adotarBichinho(n, especie); await onPronto() }
    catch (e) { setErro(e?.message || String(e)); setEnviando(false) }
  }

  return (
    <div className="max-w-md mx-auto">
      {morto && (
        <div className="bg-surface2 rounded-2xl p-4 text-center mb-4">
          <div className="text-3xl mb-1">⭐</div>
          <p className="font-bold text-ink">{nomeAntigo || 'Seu bichinho'} foi pro céu dos bichinhos…</p>
          <p className="text-sm text-muted">Ficou tempo demais sem cuidados. Que tal adotar um novo e cuidar com carinho? 🐾</p>
        </div>
      )}
      <h1 className="text-xl font-extrabold text-brand mb-1">🐾 Adote um bichinho</h1>
      <p className="text-sm text-muted mb-4">Escolha o bichinho e dê um nome. Depois é só cuidar todo dia!</p>

      <div className="grid grid-cols-2 gap-3 mb-4">
        {ESPECIES.map((e) => (
          <button key={e.id} onClick={() => setEspecie(e.id)}
            className={`rounded-2xl p-3 flex flex-col items-center border-2 transition ${especie === e.id ? 'border-brand bg-surface2' : 'border-line bg-surface'}`}>
            <BichinhoImg especie={e.id} humor="feliz" estagio={1} size={96} />
            <span className="text-sm font-bold text-ink">{e.emoji} {e.nome}</span>
          </button>
        ))}
      </div>

      <input value={nome} onChange={(e) => setNome(e.target.value)} maxLength={20} placeholder="Nome do bichinho"
        className="w-full rounded-xl border border-line bg-surface2 px-4 py-3 text-sm outline-none focus:border-brand mb-2" />
      {erro && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3 mb-2">{erro}</div>}
      <motion.button whileTap={{ scale: 0.97 }} disabled={enviando} onClick={adotar}
        className="w-full bg-gradient-to-r from-brand to-brand2 shadow-glow text-white font-extrabold rounded-xl py-3 disabled:opacity-60">
        {enviando ? '...' : '🐾 Adotar'}
      </motion.button>
    </div>
  )
}
