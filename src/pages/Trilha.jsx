import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import confetti from 'canvas-confetti'
import { useAuth } from '../context/Auth.jsx'
import Avatar from '../components/Avatar.jsx'
import { carregarTrilha, registrarJogo, carregarRankingTrilha, carregarJogosTrilha } from '../lib/dados.js'

const PARES = ['🧭', '🧣', '🪢', '🔥', '📖', '⛺']

function embaralhar(arr) {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}
const CORES_FESTA = ['#1e3a8a', '#f5c518', '#ffffff', '#10b981', '#d97706']
function festa() {
  confetti({ particleCount: 130, spread: 80, origin: { y: 0.4 }, colors: CORES_FESTA })
}
// Registro dos jogos que o app conhece (a chave bate com jogos_trilha)
const JOGOS = {
  memoria: { nome: 'Jogo da Memória', curto: 'Memória', emoji: '🧠', desc: 'Ache os pares dos itens do desbravador', Comp: JogoMemoria },
  genius: { nome: 'Siga a Sequência', curto: 'Sequência', emoji: '🎮', desc: 'Repita a ordem que os itens piscarem', Comp: JogoSequencia },
  caca: { nome: 'Caça-palavras', curto: 'Caça', emoji: '🔍', desc: 'Ache as palavras escondidas no quadro', Comp: JogoCacaPalavras },
  desliza: { nome: 'Quebra-cabeça', curto: 'Peças', emoji: '🧩', desc: 'Deslize as peças até ordenar os números', Comp: JogoDeslizante },
  morse: { nome: 'Código Morse', curto: 'Morse', emoji: '📻', desc: 'Decifre a palavra em pontos e traços', Comp: JogoMorse },
  bussola: { nome: 'Bússola', curto: 'Bússola', emoji: '🧭', desc: 'Girou 90°… pra onde você está olhando?', Comp: JogoBussola },
  forca: { nome: 'Forca', curto: 'Forca', emoji: '🎯', desc: 'Adivinhe a palavra letra por letra', Comp: JogoForca },
  contas: { nome: 'Conta Rápida', curto: 'Contas', emoji: '🔢', desc: 'Quantas contas você acerta em 30 segundos?', Comp: JogoContas },
}

export default function Trilha() {
  const { profile } = useAuth()
  const [carregando, setCarregando] = useState(true)
  const [prog, setProg] = useState({ feito: false, passos: 0, hoje: [] })
  const [jogando, setJogando] = useState(false)
  const [resultado, setResultado] = useState(null)
  const [aba, setAba] = useState('trilha') // trilha | ranking
  const [ranking, setRanking] = useState({}) // { geral:[...], memoria:[...], ... }
  const [carregandoRank, setCarregandoRank] = useState(false)
  const [jogosAtivos, setJogosAtivos] = useState(['memoria']) // chaves dos jogos ativos
  const [jogoAtual, setJogoAtual] = useState('memoria')

  // Quais jogos a liderança deixou ativos (só os que o app conhece aparecem).
  // Se a busca DER CERTO, vale a lista de verdade — mesmo vazia (a tela avisa).
  // Só se a busca FALHAR (offline / SQL não rodado) fica o padrão 'memoria'.
  useEffect(() => {
    carregarJogosTrilha()
      .then((l) => {
        setJogosAtivos(l.filter((g) => g.ativo).map((g) => g.chave).filter((c) => JOGOS[c]))
      })
      .catch(() => {})
  }, [])

  useEffect(() => { if (profile?.id) recarregar() }, [profile?.id]) // eslint-disable-line
  async function recarregar() {
    setCarregando(true)
    try { setProg(await carregarTrilha()) } finally { setCarregando(false) }
  }

  // Carrega o ranking só quando a aba abre (e recarrega quando o jogo termina)
  useEffect(() => {
    if (aba !== 'ranking') return
    setCarregandoRank(true)
    carregarRankingTrilha().then(setRanking).catch(() => {}).finally(() => setCarregandoRank(false))
  }, [aba, prog.passos])

  async function aoTerminar(estrelas) {
    try {
      const r = await registrarJogo(jogoAtual || 'memoria', estrelas)
      festa()
      setResultado({ estrelas: r.estrelas, pontos: r.pontos, extra: !!r.extra })
      setJogando(false)
      recarregar()
    } catch (e) {
      alert(e?.message || String(e))
      setJogando(false)
    }
  }

  // Cada jogo vale 1x por dia: os já jogados hoje ficam marcados; o resto segue jogável.
  const jogadosHoje = prog.hoje || []
  // Janela de deploy: o servidor ANTIGO só devolve 'feito' (nunca 'hoje'), e lá
  // ainda vale a trava de 1 jogo/dia. Nesse caso, 'feito' já significa "jogou hoje"
  // → bloqueia tudo (senão a criança joga e só leva o erro no fim). Depois do SQL,
  // 'feito' só é true quando 'hoje' tem itens, então isto nunca dispara à toa.
  const servidorAntigo = prog.feito && jogadosHoje.length === 0
  const semJogos = servidorAntigo || jogosAtivos.every((c) => jogadosHoje.includes(c))
  const proxPontos = jogadosHoje.length === 0 ? 10 : 5

  return (
    <div>
      <div className="mb-4">
        <h2 className="text-2xl font-extrabold text-slate-800">🎮 Jogos</h2>
        <p className="text-sm text-slate-500">Jogue e ganhe estrelas! Dá pra jogar todos, 1x cada por dia ⭐</p>
      </div>

      <div className="bg-white rounded-xl p-1 flex shadow-sm mb-4 max-w-xs">
        {[['trilha', '🎮 Jogar'], ['ranking', '🏆 Ranking']].map(([k, lbl]) => (
          <button key={k} onClick={() => setAba(k)}
            className={`flex-1 rounded-lg py-2 text-sm font-bold transition-colors ${aba === k ? 'bg-azul text-white' : 'text-slate-500'}`}>{lbl}</button>
        ))}
      </div>

      {aba === 'ranking' ? (
        <RankingTrilha dados={ranking} carregando={carregandoRank} meuId={profile?.id} />
      ) : carregando ? (
        <p className="text-slate-400 text-sm">Carregando...</p>
      ) : jogando ? (
        (() => {
          const Jogo = JOGOS[jogoAtual]?.Comp || JogoMemoria
          return <Jogo onTerminar={aoTerminar} onCancelar={() => setJogando(false)} />
        })()
      ) : (
        <div>
          {resultado && (
            <div className="bg-green-50 border border-green-200 rounded-2xl p-4 text-center mb-3">
              <div className="text-4xl mb-1">🎉</div>
              <p className="font-extrabold text-slate-800">+{resultado.pontos} pontos · {'⭐'.repeat(resultado.estrelas)}</p>
              <p className="text-xs text-slate-500 mt-0.5">
                {resultado.extra ? 'Jogo extra do dia (vale 5)' : 'Primeiro jogo do dia (vale 10)'}
              </p>
            </div>
          )}

          {jogosAtivos.length === 0 ? (
            <div className="bg-amber-50 border border-amber-200 rounded-2xl p-6 text-center">
              <div className="text-4xl mb-2">🎮</div>
              <p className="font-semibold text-slate-700">Nenhum jogo ativo agora</p>
              <p className="text-sm text-slate-500 mt-1">A liderança liga os jogos em Gestão → 🎮 Jogos da Trilha.</p>
            </div>
          ) : semJogos ? (
            <div className="bg-white rounded-2xl p-6 shadow-sm text-center">
              <div className="text-5xl mb-2">🏆</div>
              <p className="font-bold text-slate-800">Você jogou todos os jogos de hoje!</p>
              <p className="text-sm text-slate-400 mt-1">Volte amanhã pra jogar de novo 🙂</p>
            </div>
          ) : (
            <>
              <div className="text-center mb-3">
                <p className="font-bold text-slate-800">Escolha um jogo 🎮</p>
                <p className="text-sm text-slate-400 mt-1">
                  Cada jogo vale 1x por dia. O 1º do dia dá <b>+10</b>; os outros, <b>+5</b>.
                </p>
              </div>
              <div className="space-y-2">
                {jogosAtivos.map((chave) => {
                  const j = JOGOS[chave]
                  if (!j) return null
                  const jogado = jogadosHoje.includes(chave)
                  return (
                    <motion.button key={chave} disabled={jogado} whileTap={jogado ? undefined : { scale: 0.98 }}
                      onClick={() => { setJogoAtual(chave); setJogando(true); setResultado(null) }}
                      className={`w-full rounded-2xl p-4 shadow-sm flex items-center gap-3 text-left ${jogado ? 'bg-slate-50 opacity-70' : 'bg-white hover:bg-slate-50'}`}>
                      <span className="text-3xl shrink-0">{j.emoji}</span>
                      <div className="flex-1 min-w-0">
                        <div className="font-bold text-slate-800">{j.nome}</div>
                        <div className="text-xs text-slate-400">{j.desc}</div>
                      </div>
                      {jogado
                        ? <span className="text-green-600 font-extrabold shrink-0 text-sm">✓ jogado</span>
                        : <span className="text-azul font-extrabold shrink-0">Jogar (+{proxPontos})</span>}
                    </motion.button>
                  )
                })}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

// Placar por jogo: chips no topo trocam entre "Geral" e cada jogo.
function RankingTrilha({ dados, carregando, meuId }) {
  const [jogo, setJogo] = useState('geral')
  const top = ['🥇', '🥈', '🥉']
  const abas = [['geral', '🏆', 'Geral'], ...Object.entries(JOGOS).map(([k, j]) => [k, j.emoji, j.curto])]
  const lista = (dados && dados[jogo]) || []
  return (
    <div>
      <div className="flex gap-1.5 overflow-x-auto pb-2 mb-1 -mx-1 px-1">
        {abas.map(([k, emoji, lbl]) => (
          <button key={k} onClick={() => setJogo(k)}
            className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-bold whitespace-nowrap transition-colors ${jogo === k ? 'bg-azul text-white' : 'bg-white text-slate-500 shadow-sm'}`}>
            {emoji} {lbl}
          </button>
        ))}
      </div>

      {carregando ? (
        <p className="text-slate-400 text-sm">Carregando...</p>
      ) : lista.length === 0 ? (
        <div className="bg-white rounded-2xl p-8 text-center shadow-sm">
          <div className="text-4xl mb-2">🎮</div>
          <p className="font-semibold text-slate-700">Ninguém jogou {jogo === 'geral' ? 'ainda' : 'esse ainda'}</p>
          <p className="text-sm text-slate-400">Seja o primeiro a pontuar!</p>
        </div>
      ) : (
        <>
          <p className="text-xs text-slate-400 mb-2">{jogo === 'geral' ? 'Somando todos os jogos' : 'Só nesse jogo'} · ⭐ = soma das estrelas.</p>
          <div className="bg-white rounded-2xl shadow-sm p-2">
            {lista.map((r, i) => {
              const eu = r.id === meuId
              return (
                <div key={r.id} className={`flex items-center gap-3 px-2 py-2.5 rounded-xl ${eu ? 'bg-azul/5' : ''}`}>
                  <span className="w-6 text-center font-extrabold text-slate-400">{top[i] || i + 1}</span>
                  <Avatar foto={r.foto} nome={r.nome || '?'} cor="#1e3a8a" size="w-9 h-9" textSize="text-sm" />
                  <div className="flex-1 min-w-0">
                    <div className="font-bold text-slate-800 text-sm truncate">{r.nome || 'Desbravador'}{eu && ' (você)'}</div>
                    <div className="text-[11px] text-slate-400">{r.passos} jogo{r.passos === 1 ? '' : 's'}</div>
                  </div>
                  <span className="font-extrabold text-dourado shrink-0">⭐ {r.estrelas}</span>
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}

function JogoMemoria({ onTerminar, onCancelar }) {
  const [cartas] = useState(() => embaralhar(PARES.flatMap((e, i) => [{ id: i + '-a', emoji: e }, { id: i + '-b', emoji: e }])))
  const [viradas, setViradas] = useState([])
  const [achadas, setAchadas] = useState([])
  const [jogadas, setJogadas] = useState(0)
  const [bloqueado, setBloqueado] = useState(false)

  function clicar(i) {
    if (bloqueado || viradas.includes(i) || achadas.includes(cartas[i].emoji)) return
    const novas = [...viradas, i]
    setViradas(novas)
    if (novas.length === 2) {
      const total = jogadas + 1
      setJogadas(total)
      setBloqueado(true)
      const [a, b] = novas
      if (cartas[a].emoji === cartas[b].emoji) {
        const novoAchadas = [...achadas, cartas[a].emoji]
        setTimeout(() => {
          setAchadas(novoAchadas)
          setViradas([])
          setBloqueado(false)
          if (novoAchadas.length === PARES.length) {
            const estrelas = total <= 8 ? 3 : total <= 11 ? 2 : 1
            setTimeout(() => onTerminar(estrelas), 400)
          }
        }, 500)
      } else {
        setTimeout(() => { setViradas([]); setBloqueado(false) }, 800)
      }
    }
  }

  return (
    <div className="bg-white rounded-2xl p-4 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-semibold text-slate-600">Tentativas: {jogadas}</span>
        <button onClick={onCancelar} className="text-xs text-slate-400">Cancelar</button>
      </div>
      <div className="grid grid-cols-4 gap-2">
        {cartas.map((c, i) => {
          const aberta = viradas.includes(i) || achadas.includes(c.emoji)
          return (
            <motion.button key={c.id} onClick={() => clicar(i)} whileTap={{ scale: 0.95 }}
              className={`aspect-square rounded-xl text-2xl grid place-items-center border-2 transition-colors ${aberta ? 'bg-azul/10 border-azul' : 'bg-slate-100 border-slate-200'}`}>
              {aberta ? c.emoji : '❓'}
            </motion.button>
          )
        })}
      </div>
    </div>
  )
}

// Siga a Sequência (Gênius): os itens piscam numa ordem que cresce; repita.
function JogoSequencia({ onTerminar, onCancelar }) {
  const SIMBOLOS = [
    { e: '🔥', cor: '#ef4444' },
    { e: '🧭', cor: '#3b82f6' },
    { e: '🧣', cor: '#10b981' },
    { e: '🪢', cor: '#f59e0b' },
    { e: '📖', cor: '#8b5cf6' },
    { e: '⛺', cor: '#06b6d4' },
  ]
  const [seq, setSeq] = useState([])
  const [mostrando, setMostrando] = useState(false)
  const [aceso, setAceso] = useState(-1)
  const [pos, setPos] = useState(0)
  const [rodada, setRodada] = useState(0)
  const [fim, setFim] = useState(false)

  useEffect(() => { proximaRodada([]) }, []) // eslint-disable-line

  const rand = () => Math.floor(Math.random() * SIMBOLOS.length)

  function proximaRodada(atual) {
    const nova = [...atual, rand()]
    setSeq(nova)
    setRodada(nova.length)
    setPos(0)
    demonstrar(nova)
  }

  function demonstrar(s) {
    setMostrando(true)
    let i = 0
    const passo = () => {
      if (i >= s.length) { setAceso(-1); setMostrando(false); return }
      setAceso(s[i])
      setTimeout(() => {
        setAceso(-1)
        i++
        setTimeout(passo, 220)
      }, 520)
    }
    setTimeout(passo, 600)
  }

  function encerrar(rodadasCompletas) {
    setFim(true)
    const estrelas = rodadasCompletas >= 7 ? 3 : rodadasCompletas >= 4 ? 2 : 1
    setTimeout(() => onTerminar(estrelas), 500)
  }

  function tocar(idx) {
    if (mostrando || fim) return
    setAceso(idx)
    setTimeout(() => setAceso((a) => (a === idx ? -1 : a)), 180)
    if (idx !== seq[pos]) { encerrar(seq.length - 1); return } // errou
    const novaPos = pos + 1
    if (novaPos === seq.length) {
      if (seq.length >= 15) { encerrar(15); return } // venceu
      setMostrando(true) // trava toques durante a pausa até a próxima demonstração
      setTimeout(() => proximaRodada(seq), 650)
    } else {
      setPos(novaPos)
    }
  }

  return (
    <div className="bg-white rounded-2xl p-4 shadow-sm text-center">
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-semibold text-slate-600">Rodada {rodada}</span>
        <button onClick={onCancelar} className="text-xs text-slate-400">Cancelar</button>
      </div>
      <p className="text-xs text-slate-400 mb-3 h-4">{mostrando ? 'Observe a sequência…' : fim ? 'Fim! 🎉' : 'Sua vez — repita!'}</p>
      <div className="grid grid-cols-3 gap-3 max-w-[300px] mx-auto">
        {SIMBOLOS.map((s, i) => (
          <motion.button key={i} onClick={() => tocar(i)} disabled={mostrando || fim}
            animate={{ scale: aceso === i ? 1.06 : 1, opacity: aceso === i ? 1 : 0.7 }}
            transition={{ duration: 0.12 }}
            className="aspect-square rounded-2xl text-4xl grid place-items-center border-2 border-white shadow"
            style={{ backgroundColor: aceso === i ? s.cor : s.cor + '33' }}>
            {s.e}
          </motion.button>
        ))}
      </div>
    </div>
  )
}

// ===================== Caça-palavras =====================
// Monta um quadro NxN com as palavras escondidas e preenche o resto com
// letras aleatórias. Roda 1x na montagem do jogo.
function gerarCaca() {
  const N = 8
  const alvos = ['FOGO', 'TENDA', 'MAPA', 'MATA', 'TROPA', 'NORTE']
  const grid = Array(N * N).fill('')
  const dirs = [[0, 1], [1, 0], [1, 1], [1, -1]] // →  ↓  ↘  ↙
  const colocadas = []
  for (const p of alvos) {
    for (let t = 0; t < 200; t++) {
      const [dr, dc] = dirs[Math.floor(Math.random() * dirs.length)]
      const r0 = Math.floor(Math.random() * N)
      const c0 = Math.floor(Math.random() * N)
      const rf = r0 + dr * (p.length - 1)
      const cf = c0 + dc * (p.length - 1)
      if (rf < 0 || rf >= N || cf < 0 || cf >= N) continue
      let cabe = true
      for (let k = 0; k < p.length; k++) {
        const idx = (r0 + dr * k) * N + (c0 + dc * k)
        if (grid[idx] && grid[idx] !== p[k]) { cabe = false; break }
      }
      if (!cabe) continue
      for (let k = 0; k < p.length; k++) grid[(r0 + dr * k) * N + (c0 + dc * k)] = p[k]
      colocadas.push(p)
      break
    }
  }
  const AZ = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
  for (let i = 0; i < grid.length; i++) if (!grid[i]) grid[i] = AZ[Math.floor(Math.random() * 26)]
  return { N, grid, palavras: colocadas }
}

function JogoCacaPalavras({ onTerminar, onCancelar }) {
  const [jogo] = useState(gerarCaca)
  const { N, grid, palavras } = jogo
  const [sel, setSel] = useState(-1)
  const [achadas, setAchadas] = useState([])
  const [celulas, setCelulas] = useState(() => new Set())
  const [erros, setErros] = useState(0)
  const [fim, setFim] = useState(false)

  // Palavra formada pela linha reta entre duas células (nas duas direções)
  function palavraEntre(a, b) {
    const r1 = Math.floor(a / N), c1 = a % N, r2 = Math.floor(b / N), c2 = b % N
    const reto = r1 === r2 || c1 === c2 || Math.abs(r2 - r1) === Math.abs(c2 - c1)
    if (!reto) return null
    const dr = Math.sign(r2 - r1), dc = Math.sign(c2 - c1)
    const len = Math.max(Math.abs(r2 - r1), Math.abs(c2 - c1)) + 1
    let s = ''; const idxs = []
    for (let k = 0; k < len; k++) { const idx = (r1 + dr * k) * N + (c1 + dc * k); s += grid[idx]; idxs.push(idx) }
    const rev = s.split('').reverse().join('')
    const match = palavras.find((p) => !achadas.includes(p) && (p === s || p === rev))
    return match ? { match, idxs } : null
  }

  function tocar(idx) {
    if (fim) return
    if (sel === -1) { setSel(idx); return }
    if (sel === idx) { setSel(-1); return }
    const res = palavraEntre(sel, idx)
    if (res) {
      const novas = [...achadas, res.match]
      setAchadas(novas)
      setCelulas((cs) => { const n = new Set(cs); res.idxs.forEach((i) => n.add(i)); return n })
      setSel(-1)
      if (novas.length === palavras.length) {
        setFim(true)
        const est = erros <= 2 ? 3 : erros <= 5 ? 2 : 1
        setTimeout(() => onTerminar(est), 700)
      }
    } else {
      setErros((e) => e + 1)
      setSel(-1)
    }
  }

  return (
    <div className="bg-white rounded-2xl p-4 shadow-sm">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-semibold text-slate-600">{achadas.length}/{palavras.length} achadas</span>
        <button onClick={onCancelar} className="text-xs text-slate-400">Cancelar</button>
      </div>
      <p className="text-xs text-slate-400 mb-3">{fim ? 'Achou todas! 🎉' : 'Toque na 1ª e na última letra da palavra.'}</p>
      <div className="grid gap-1 mx-auto max-w-[320px]" style={{ gridTemplateColumns: `repeat(${N}, 1fr)` }}>
        {grid.map((ch, i) => {
          const achada = celulas.has(i)
          const sela = sel === i
          return (
            <button key={i} onClick={() => tocar(i)} disabled={fim}
              className={`aspect-square rounded-md text-xs sm:text-sm font-extrabold grid place-items-center transition-colors ${
                achada ? 'bg-green-500 text-white' : sela ? 'bg-azul text-white' : 'bg-slate-100 text-slate-700'
              }`}>
              {ch}
            </button>
          )
        })}
      </div>
      <div className="flex flex-wrap gap-1.5 justify-center mt-3">
        {palavras.map((p) => (
          <span key={p} className={`text-xs font-bold rounded-full px-2.5 py-1 ${achadas.includes(p) ? 'bg-green-100 text-green-700 line-through' : 'bg-slate-100 text-slate-500'}`}>{p}</span>
        ))}
      </div>
    </div>
  )
}

// ===================== Quebra-cabeça deslizante (3x3) =====================
function vizinhosDesl(i, N) {
  const r = Math.floor(i / N), c = i % N, v = []
  if (r > 0) v.push(i - N)
  if (r < N - 1) v.push(i + N)
  if (c > 0) v.push(i - 1)
  if (c < N - 1) v.push(i + 1)
  return v
}
function resolvidoDesl(t) {
  for (let i = 0; i < t.length - 1; i++) if (t[i] !== i + 1) return false
  return t[t.length - 1] === 0
}
// Embaralha fazendo jogadas válidas a partir do resolvido (sempre tem solução)
function embaralharDesl(N) {
  const t = []
  for (let i = 1; i < N * N; i++) t.push(i)
  t.push(0)
  let vazio = N * N - 1
  for (let i = 0; i < 100; i++) {
    const viz = vizinhosDesl(vazio, N)
    const p = viz[Math.floor(Math.random() * viz.length)]
    ;[t[vazio], t[p]] = [t[p], t[vazio]]
    vazio = p
  }
  return resolvidoDesl(t) ? embaralharDesl(N) : t
}

function JogoDeslizante({ onTerminar, onCancelar }) {
  const N = 3
  const [tabu, setTabu] = useState(() => embaralharDesl(N))
  const [mov, setMov] = useState(0)
  const [fim, setFim] = useState(false)

  function mover(idx) {
    if (fim) return
    const vazio = tabu.indexOf(0)
    if (!vizinhosDesl(idx, N).includes(vazio)) return
    const novo = [...tabu]
    ;[novo[idx], novo[vazio]] = [novo[vazio], novo[idx]]
    const m = mov + 1
    setTabu(novo)
    setMov(m)
    if (resolvidoDesl(novo)) {
      setFim(true)
      const est = m <= 30 ? 3 : m <= 60 ? 2 : 1
      setTimeout(() => onTerminar(est), 700)
    }
  }

  return (
    <div className="bg-white rounded-2xl p-4 shadow-sm text-center">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-semibold text-slate-600">Movimentos: {mov}</span>
        <button onClick={onCancelar} className="text-xs text-slate-400">Cancelar</button>
      </div>
      <p className="text-xs text-slate-400 mb-3">{fim ? 'Resolvido! 🎉' : 'Deslize as peças até ficar 1, 2, 3…'}</p>
      <div className="grid grid-cols-3 gap-2 max-w-[260px] mx-auto">
        {tabu.map((v) => (
          v === 0 ? (
            <div key={v} className="aspect-square rounded-2xl bg-slate-50" />
          ) : (
            <motion.button key={v} layout onClick={() => mover(tabu.indexOf(v))} disabled={fim}
              transition={{ type: 'spring', stiffness: 500, damping: 34 }}
              className="aspect-square rounded-2xl bg-azul text-white text-2xl font-extrabold grid place-items-center shadow">
              {v}
            </motion.button>
          )
        ))}
      </div>
    </div>
  )
}

// ===================== 📻 Código Morse =====================
// Matéria de verdade do clube: a tabela fica à vista pra APRENDER jogando.
const MORSE = {
  A: '·–', B: '–···', C: '–·–·', D: '–··', E: '·', F: '··–·', G: '––·', H: '····', I: '··',
  J: '·–––', K: '–·–', L: '·–··', M: '––', N: '–·', O: '–––', P: '·––·', Q: '––·–', R: '·–·',
  S: '···', T: '–', U: '··–', V: '···–', W: '·––', X: '–··–', Y: '–·––', Z: '––··',
}
const PALAVRAS_MORSE = ['FOGO', 'MATA', 'NORTE', 'TENDA', 'MAPA', 'CORDA', 'SOL', 'LUA', 'NO', 'SUL']

function JogoMorse({ onTerminar, onCancelar }) {
  const [palavras] = useState(() => embaralhar(PALAVRAS_MORSE).slice(0, 3))
  const [i, setI] = useState(0)
  const [resp, setResp] = useState('')
  const [erros, setErros] = useState(0)
  const [aviso, setAviso] = useState('')
  const [fim, setFim] = useState(false)
  const palavra = palavras[i]

  function conferir(e) {
    e.preventDefault()
    if (fim || aviso) return
    const acertou = resp.trim().toUpperCase() === palavra
    const totalErros = erros + (acertou ? 0 : 1)
    if (!acertou) setErros(totalErros)
    setAviso(acertou ? 'Acertou! ✅' : `Era ${palavra}`)
    setTimeout(() => {
      setAviso(''); setResp('')
      if (i + 1 >= palavras.length) {
        setFim(true)
        onTerminar(totalErros === 0 ? 3 : totalErros === 1 ? 2 : 1)
      } else setI(i + 1)
    }, 1100)
  }

  return (
    <div className="bg-white rounded-2xl p-4 shadow-sm">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-semibold text-slate-600">Palavra {i + 1} de {palavras.length}</span>
        <button onClick={onCancelar} className="text-xs text-slate-400">Cancelar</button>
      </div>
      <p className="text-xs text-slate-400 mb-3">Decifre a palavra usando a tabela abaixo 👇</p>

      <div className="bg-azul text-white rounded-2xl p-4 text-center mb-3">
        <div className="text-2xl font-bold tracking-widest break-words leading-relaxed">
          {palavra.split('').map((l) => MORSE[l]).join('   ')}
        </div>
      </div>

      <form onSubmit={conferir} className="flex gap-2 mb-3">
        <input value={resp} onChange={(e) => setResp(e.target.value)} disabled={!!aviso || fim}
          placeholder="Qual é a palavra?" autoCapitalize="characters"
          className="flex-1 rounded-lg border border-slate-300 px-3 py-2.5 text-sm uppercase outline-none focus:border-azul-claro focus:ring-2 focus:ring-azul-claro/30" />
        <button type="submit" disabled={!resp.trim() || !!aviso || fim}
          className="rounded-xl bg-azul text-white font-bold px-4 text-sm disabled:opacity-50">Conferir</button>
      </form>
      {aviso && <p className={`text-sm font-bold text-center mb-2 ${aviso.startsWith('Acertou') ? 'text-green-600' : 'text-amber-600'}`}>{aviso}</p>}

      <div className="grid grid-cols-4 gap-1 text-[11px] text-slate-500">
        {Object.entries(MORSE).map(([l, m]) => (
          <div key={l} className="bg-slate-50 rounded px-1 py-0.5 text-center">
            <b className="text-slate-700">{l}</b> {m}
          </div>
        ))}
      </div>
    </div>
  )
}

// ===================== 🧭 Bússola =====================
const ROSA = ['N', 'NE', 'L', 'SE', 'S', 'SO', 'O', 'NO'] // 45° cada, sentido horário
const NOME_DIR = {
  N: 'Norte', NE: 'Nordeste', L: 'Leste', SE: 'Sudeste',
  S: 'Sul', SO: 'Sudoeste', O: 'Oeste', NO: 'Noroeste',
}
function novaBussola() {
  const de = Math.floor(Math.random() * 8)
  const passos = 1 + Math.floor(Math.random() * 4) // 45° a 180°
  const horario = Math.random() < 0.5
  const destino = ((de + (horario ? passos : -passos)) % 8 + 8) % 8
  const erradas = embaralhar(ROSA.filter((_, k) => k !== destino)).slice(0, 3)
  return {
    de: ROSA[de], graus: passos * 45, horario,
    certa: ROSA[destino], opcoes: embaralhar([ROSA[destino], ...erradas]),
  }
}

function JogoBussola({ onTerminar, onCancelar }) {
  const TOTAL = 6
  const [q, setQ] = useState(() => novaBussola())
  const [n, setN] = useState(1)
  const [acertos, setAcertos] = useState(0)
  const [aviso, setAviso] = useState('')
  const [fim, setFim] = useState(false)

  function responder(dir) {
    if (fim || aviso) return
    const ok = dir === q.certa
    const total = acertos + (ok ? 1 : 0)
    if (ok) setAcertos(total)
    setAviso(ok ? 'Isso! ✅' : `Era ${NOME_DIR[q.certa]}`)
    setTimeout(() => {
      setAviso('')
      if (n >= TOTAL) {
        setFim(true)
        onTerminar(total >= 6 ? 3 : total >= 4 ? 2 : 1)
      } else { setN(n + 1); setQ(novaBussola()) }
    }, 1000)
  }

  return (
    <div className="bg-white rounded-2xl p-4 shadow-sm text-center">
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-semibold text-slate-600">Pergunta {n} de {TOTAL}</span>
        <button onClick={onCancelar} className="text-xs text-slate-400">Cancelar</button>
      </div>

      <div className="text-5xl mb-2">🧭</div>
      <p className="text-slate-700 leading-snug mb-1">
        Você está virado para o <b>{NOME_DIR[q.de]}</b> e gira <b>{q.graus}°</b>{' '}
        <b>{q.horario ? 'à direita' : 'à esquerda'}</b>.
      </p>
      <p className="text-sm text-slate-400 mb-4">Para onde está olhando agora?</p>

      <div className="grid grid-cols-2 gap-2">
        {q.opcoes.map((d) => (
          <motion.button key={d} whileTap={{ scale: 0.97 }} onClick={() => responder(d)} disabled={!!aviso || fim}
            className="rounded-xl bg-slate-50 hover:bg-slate-100 py-3 font-bold text-slate-700 disabled:opacity-60">
            {NOME_DIR[d]}
          </motion.button>
        ))}
      </div>
      {aviso && <p className={`text-sm font-bold mt-3 ${aviso.startsWith('Isso') ? 'text-green-600' : 'text-amber-600'}`}>{aviso}</p>}
      <p className="text-xs text-slate-400 mt-3">Acertos: {acertos}</p>
    </div>
  )
}

// ===================== 🎯 Forca =====================
const PALAVRAS_FORCA = [
  'ACAMPAMENTO', 'DESBRAVADOR', 'BUSSOLA', 'FOGUEIRA', 'UNIFORME',
  'ESPECIALIDADE', 'LANTERNA', 'MOCHILA', 'BARRACA', 'CANIVETE',
  'CANTINA', 'BANDEIRA', 'CONSELHEIRO', 'INVESTIDURA', 'CAMINHADA',
]
const ALFABETO = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')

function JogoForca({ onTerminar, onCancelar }) {
  const VIDAS = 6
  const [palavra] = useState(() => PALAVRAS_FORCA[Math.floor(Math.random() * PALAVRAS_FORCA.length)])
  const [usadas, setUsadas] = useState([])
  const [fim, setFim] = useState(false)
  const [msg, setMsg] = useState('')

  const erradas = usadas.filter((l) => !palavra.includes(l))
  const vidas = VIDAS - erradas.length

  function tentar(l) {
    if (fim || usadas.includes(l)) return
    const novas = [...usadas, l]
    setUsadas(novas)
    const err = novas.filter((x) => !palavra.includes(x)).length
    const ganhou = palavra.split('').every((x) => novas.includes(x))
    if (ganhou) {
      setFim(true); setMsg('Você descobriu! 🎉')
      setTimeout(() => onTerminar(err <= 1 ? 3 : err <= 3 ? 2 : 1), 900)
    } else if (err >= VIDAS) {
      setFim(true); setMsg(`Acabaram as vidas! Era ${palavra}`)
      setTimeout(() => onTerminar(1), 1400)
    }
  }

  return (
    <div className="bg-white rounded-2xl p-4 shadow-sm text-center">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-semibold text-slate-600">
          {'❤️'.repeat(Math.max(0, vidas))}{'🖤'.repeat(Math.min(VIDAS, erradas.length))}
        </span>
        <button onClick={onCancelar} className="text-xs text-slate-400">Cancelar</button>
      </div>
      <p className="text-xs text-slate-400 mb-3">Adivinhe a palavra do mundo desbravador</p>

      <div className="flex flex-wrap justify-center gap-1.5 mb-3">
        {palavra.split('').map((l, k) => (
          <span key={k} className="w-7 h-9 border-b-2 border-slate-300 grid place-items-center text-xl font-extrabold text-azul">
            {usadas.includes(l) || fim ? l : ''}
          </span>
        ))}
      </div>

      {msg && <p className={`text-sm font-bold mb-2 ${msg.startsWith('Você') ? 'text-green-600' : 'text-amber-600'}`}>{msg}</p>}

      <div className="grid grid-cols-7 gap-1">
        {ALFABETO.map((l) => {
          const usada = usadas.includes(l)
          const certa = usada && palavra.includes(l)
          return (
            <button key={l} onClick={() => tentar(l)} disabled={usada || fim}
              className={`aspect-square rounded-lg text-sm font-extrabold ${
                !usada ? 'bg-slate-100 text-slate-700' : certa ? 'bg-green-500 text-white' : 'bg-slate-300 text-white'
              } disabled:opacity-70`}>
              {l}
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ===================== 🔢 Conta Rápida =====================
function novaConta() {
  const op = ['+', '-', '×'][Math.floor(Math.random() * 3)]
  let a, b, r
  if (op === '×') { a = 2 + Math.floor(Math.random() * 8); b = 2 + Math.floor(Math.random() * 8); r = a * b }
  else if (op === '+') { a = 5 + Math.floor(Math.random() * 40); b = 5 + Math.floor(Math.random() * 40); r = a + b }
  else { a = 12 + Math.floor(Math.random() * 40); b = 1 + Math.floor(Math.random() * 10); r = a - b }
  // 3 alternativas erradas, todas diferentes da certa
  const set = new Set([r])
  while (set.size < 4) {
    const d = r + (Math.random() < 0.5 ? -1 : 1) * (1 + Math.floor(Math.random() * 6))
    if (d >= 0) set.add(d)
  }
  return { a, b, op, r, opcoes: embaralhar([...set]) }
}

function JogoContas({ onTerminar, onCancelar }) {
  const SEGUNDOS = 30
  const [q, setQ] = useState(() => novaConta())
  const [acertos, setAcertos] = useState(0)
  const [tempo, setTempo] = useState(SEGUNDOS)
  const [fim, setFim] = useState(false)

  useEffect(() => {
    if (fim) return
    if (tempo <= 0) {
      setFim(true)
      setTimeout(() => onTerminar(acertos >= 12 ? 3 : acertos >= 7 ? 2 : 1), 700)
      return
    }
    const t = setTimeout(() => setTempo((s) => s - 1), 1000)
    return () => clearTimeout(t)
  }, [tempo, fim]) // eslint-disable-line

  function responder(v) {
    if (fim) return
    if (v === q.r) setAcertos((x) => x + 1)
    setQ(novaConta())
  }

  return (
    <div className="bg-white rounded-2xl p-4 shadow-sm text-center">
      <div className="flex items-center justify-between mb-3">
        <span className={`text-sm font-extrabold ${tempo <= 10 ? 'text-red-500' : 'text-slate-600'}`}>⏱️ {tempo}s</span>
        <span className="text-sm font-semibold text-green-600">✅ {acertos}</span>
        <button onClick={onCancelar} className="text-xs text-slate-400">Cancelar</button>
      </div>

      {fim ? (
        <div className="py-6">
          <div className="text-5xl mb-2">🏁</div>
          <p className="font-extrabold text-slate-800">Tempo! Você acertou {acertos}.</p>
        </div>
      ) : (
        <>
          <div className="text-4xl font-extrabold text-azul my-5">{q.a} {q.op} {q.b}</div>
          <div className="grid grid-cols-2 gap-2">
            {q.opcoes.map((v) => (
              <motion.button key={v} whileTap={{ scale: 0.96 }} onClick={() => responder(v)}
                className="rounded-xl bg-slate-50 hover:bg-slate-100 py-4 text-xl font-extrabold text-slate-700">
                {v}
              </motion.button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
