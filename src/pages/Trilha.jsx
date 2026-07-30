import { useState, useEffect, useRef } from 'react'
import { motion } from 'framer-motion'
import confetti from 'canvas-confetti'
import { useAuth } from '../context/Auth.jsx'
import Avatar from '../components/Avatar.jsx'
import { carregarTrilha, registrarJogo, carregarRankingTrilha, carregarJogosTrilha, registrarRecorde, carregarRecordesSemana, excluirRecorde, lerJogoDaSemana } from '../lib/dados.js'

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
  nos: { nome: 'Quiz dos Nós', curto: 'Nós', emoji: '🪢', desc: 'Qual nó serve pra quê? Teste seus nós e amarras', Comp: JogoNos },
  semaforo: { nome: 'Semáfora', curto: 'Semáfora', emoji: '🚩', desc: 'Leia a letra pela posição das bandeiras', Comp: JogoSemaforo },
  cobra: { nome: 'Cobrinha', curto: 'Cobrinha', emoji: '🐍', desc: 'Atravesse as paredes! Só não bata em você mesmo', Comp: JogoCobra },
  anagrama: { nome: 'Anagrama', curto: 'Anagrama', emoji: '🔤', desc: 'Desembaralhe a palavra do clube', Comp: JogoAnagrama },
  minado: { nome: 'Campo Minado', curto: 'Minado', emoji: '💣', desc: 'Abra o campo sem pisar nas minas', Comp: JogoCampoMinado },
  mudou: { nome: 'O Que Mudou?', curto: 'Mudou', emoji: '👀', desc: 'Memorize a grade e diga o que sumiu', Comp: JogoMudou },
  hanoi: { nome: 'Torre de Hanói', curto: 'Hanói', emoji: '🗼', desc: 'Leve os discos pro último pino em poucos movimentos', Comp: JogoHanoi },
  termo: { nome: 'Termo do Clube', curto: 'Termo', emoji: '🟩', desc: 'Descubra a palavra de 5 letras em 6 tentativas', Comp: JogoTermo },
  proximo: { nome: 'Qual é o Próximo?', curto: 'Próximo', emoji: '➡️', desc: 'Complete a sequência lógica', Comp: JogoProximo },
  velha: { nome: 'Jogo da Velha', curto: 'Velha', emoji: '⭕', desc: 'Melhor de 3 contra o app — você é o ❌', Comp: JogoVelha },
  reflexo: { nome: 'Reflexo', curto: 'Reflexo', emoji: '⚡', desc: 'SEM LIMITE! Acelera a cada nível — o recorde da semana vale +20', Comp: JogoReflexo },
}
// Jogos "sem fim": repetição livre (não dão +10/+5; valem pelo recorde da semana)
const ARCADE = new Set(['reflexo'])

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
  const [jogoSemana, setJogoSemana] = useState('') // chave do jogo da semana (vale +20)

  // Quais jogos a liderança deixou ativos (só os que o app conhece aparecem).
  // Se a busca DER CERTO, vale a lista de verdade — mesmo vazia (a tela avisa).
  // Só se a busca FALHAR (offline / SQL não rodado) fica o padrão 'memoria'.
  useEffect(() => {
    carregarJogosTrilha()
      .then((l) => {
        setJogosAtivos(l.filter((g) => g.ativo).map((g) => g.chave).filter((c) => JOGOS[c]))
      })
      .catch(() => {})
    // Jogo da semana (o que vale +20 pro melhor no domingo). Se falhar, some.
    lerJogoDaSemana().then((c) => JOGOS[c] && setJogoSemana(c)).catch(() => {})
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
  // Jogo ARCADE ativo = a lista nunca "fecha" (ele é rejogável sem limite)
  const semJogos = !jogosAtivos.some((c) => ARCADE.has(c))
    && (servidorAntigo || jogosAtivos.every((c) => jogadosHoje.includes(c)))
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
        <RankingTrilha dados={ranking} carregando={carregandoRank} meuId={profile?.id}
          ehAdmin={['instrutor', 'diretoria'].includes(profile?.papel)} />
      ) : carregando ? (
        <p className="text-slate-400 text-sm">Carregando...</p>
      ) : jogando ? (
        (() => {
          const Jogo = JOGOS[jogoAtual]?.Comp || JogoMemoria
          // No PC o jogo fica centralizado num cartão, sem esticar a tela toda
          return (
            <motion.div key={jogoAtual} initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }}
              className="max-w-md mx-auto">
              <div className="text-center mb-2">
                <span className="inline-flex items-center gap-2 bg-white rounded-full shadow-sm px-4 py-1.5 text-sm font-extrabold text-slate-700">
                  {JOGOS[jogoAtual]?.emoji} {JOGOS[jogoAtual]?.nome}
                </span>
              </div>
              <Jogo onTerminar={aoTerminar} onCancelar={() => setJogando(false)} />
            </motion.div>
          )
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

              {jogoSemana && JOGOS[jogoSemana] && (
                <motion.button whileTap={{ scale: 0.98 }}
                  onClick={() => {
                    if (jogosAtivos.includes(jogoSemana)) {
                      setJogoAtual(jogoSemana); setJogando(true); setResultado(null)
                    }
                  }}
                  className="w-full text-left rounded-2xl p-3.5 mb-3 bg-amber-50 border-2 border-dourado flex items-center gap-3">
                  <span className="text-3xl shrink-0">{JOGOS[jogoSemana].emoji}</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-[11px] font-extrabold text-dourado uppercase tracking-wide">🎲 Jogo da semana</div>
                    <div className="font-extrabold text-slate-800 leading-tight">{JOGOS[jogoSemana].nome}</div>
                    <div className="text-xs text-slate-500">Quem fizer mais estrelas nele até domingo leva <b>+20</b> 🏆</div>
                  </div>
                </motion.button>
              )}

              <div className="grid sm:grid-cols-2 gap-2.5">
                {jogosAtivos.map((chave) => {
                  const j = JOGOS[chave]
                  if (!j) return null
                  const jogado = jogadosHoje.includes(chave) && !ARCADE.has(chave)
                  return (
                    <motion.button key={chave} disabled={jogado}
                      whileTap={jogado ? undefined : { scale: 0.97 }} whileHover={jogado ? undefined : { y: -3 }}
                      onClick={() => { setJogoAtual(chave); setJogando(true); setResultado(null) }}
                      className={`w-full rounded-2xl p-3.5 shadow-sm flex items-center gap-3 text-left ${jogado ? 'bg-slate-50 opacity-70' : 'bg-white'} ${ARCADE.has(chave) ? 'ring-2 ring-dourado' : ''}`}>
                      <span className={`w-12 h-12 rounded-2xl grid place-items-center text-2xl shrink-0 ${jogado ? 'bg-slate-100' : 'bg-gradient-to-br from-azul/10 to-dourado/20'}`}>
                        {j.emoji}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="font-bold text-slate-800 leading-tight">{j.nome}</div>
                        <div className="text-[11px] text-slate-400 leading-snug mt-0.5">{j.desc}</div>
                      </div>
                      {ARCADE.has(chave)
                        ? <span className="bg-dourado text-azul font-extrabold shrink-0 text-xs rounded-full px-2.5 py-1.5">🚀 Recorde</span>
                        : jogado
                        ? <span className="text-green-600 font-extrabold shrink-0 text-xs">✓ jogado</span>
                        : <span className="bg-azul text-white font-extrabold shrink-0 text-xs rounded-full px-2.5 py-1.5">+{proxPontos}</span>}
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
function RankingTrilha({ dados, carregando, meuId, ehAdmin }) {
  const [jogo, setJogo] = useState('geral')
  const [recordes, setRecordes] = useState(null) // ranking dos jogos sem fim
  const top = ['🥇', '🥈', '🥉']
  const abas = [['geral', '🏆', 'Geral'], ...Object.entries(JOGOS).map(([k, j]) => [k, j.emoji, j.curto])]
  const lista = (dados && dados[jogo]) || []
  const ehArcade = ARCADE.has(jogo)

  function recarregarRecs() {
    setRecordes(null)
    carregarRecordesSemana(jogo).then(setRecordes).catch(() => setRecordes([]))
  }
  useEffect(() => {
    if (!ehArcade) return
    recarregarRecs()
  }, [jogo]) // eslint-disable-line

  // Liderança: apaga um recorde suspeito da semana (ex.: valor forjado)
  async function apagarRec(r) {
    if (!window.confirm(`Apagar o recorde de ${r.nome || 'este membro'} (⚡ ${r.pontos}) desta semana?\n\nEle pode fazer um novo jogando de verdade.`)) return
    try {
      await excluirRecorde(r.id, jogo)
      recarregarRecs()
    } catch (e) {
      alert('Não foi possível: ' + (e?.message || e))
    }
  }

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

      {ehArcade ? (
        recordes === null ? (
          <p className="text-slate-400 text-sm">Carregando...</p>
        ) : recordes.length === 0 ? (
          <div className="bg-white rounded-2xl p-8 text-center shadow-sm">
            <div className="text-4xl mb-2">⚡</div>
            <p className="font-semibold text-slate-700">Nenhum recorde essa semana ainda</p>
            <p className="text-sm text-slate-400">Jogue sem limite e crave o seu!</p>
          </div>
        ) : (
          <>
            <p className="text-xs text-slate-400 mb-2">⚡ Recordes da SEMANA — o maior ganha <b>+20 pontos</b> no domingo!</p>
            <div className="bg-white rounded-2xl shadow-sm p-2">
              {recordes.map((r, i) => {
                const eu = r.id === meuId
                return (
                  <div key={r.id} className={`flex items-center gap-3 px-2 py-2.5 rounded-xl ${eu ? 'bg-azul/5' : ''}`}>
                    <span className="w-6 text-center font-extrabold text-slate-400">{top[i] || i + 1}</span>
                    <Avatar foto={r.foto} nome={r.nome || '?'} cor="#1e3a8a" size="w-9 h-9" textSize="text-sm" />
                    <div className="flex-1 min-w-0">
                      <div className="font-bold text-slate-800 text-sm truncate">{r.nome || 'Desbravador'}{eu && ' (você)'}</div>
                    </div>
                    <span className="font-extrabold text-dourado shrink-0">⚡ {r.pontos}</span>
                    {ehAdmin && (
                      <button onClick={() => apagarRec(r)} title="Apagar recorde suspeito"
                        className="text-red-400 hover:text-red-600 shrink-0 p-2 -m-1">🗑️</button>
                    )}
                  </div>
                )
              })}
            </div>
          </>
        )
      ) : carregando ? (
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
    <div className="bg-white rounded-3xl p-4 sm:p-5 shadow-md">
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-semibold text-slate-600">Tentativas: {jogadas}</span>
        <button onClick={onCancelar} className="text-xs text-slate-400 p-3 -m-3">Cancelar</button>
      </div>
      <div className="grid grid-cols-4 gap-2 select-none">
        {cartas.map((c, i) => {
          const achada = achadas.includes(c.emoji)
          const aberta = viradas.includes(i) || achada
          return (
            <motion.button key={c.id} onClick={() => clicar(i)} whileTap={{ scale: 0.92 }}
              animate={achada ? { scale: [1, 1.12, 1] } : {}}
              className={`aspect-square rounded-xl text-3xl grid place-items-center border-2 transition-colors shadow-sm ${
                achada ? 'bg-green-50 border-green-400'
                : aberta ? 'bg-white border-azul'
                : 'bg-gradient-to-br from-azul to-azul-claro border-transparent'
              }`}>
              {aberta ? c.emoji : <span className="text-white/80 text-xl font-extrabold">?</span>}
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
    <div className="bg-white rounded-3xl p-4 sm:p-5 shadow-md text-center">
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-semibold text-slate-600">Rodada {rodada}</span>
        <button onClick={onCancelar} className="text-xs text-slate-400 p-3 -m-3">Cancelar</button>
      </div>
      <p className="text-xs text-slate-400 mb-3 h-4">{mostrando ? 'Observe a sequência…' : fim ? 'Fim! 🎉' : 'Sua vez — repita!'}</p>
      <div className="grid grid-cols-3 gap-3 max-w-[300px] mx-auto">
        {SIMBOLOS.map((s, i) => (
          <motion.button key={i} onClick={() => tocar(i)} disabled={mostrando || fim}
            animate={{ scale: aceso === i ? 1.08 : 1, opacity: aceso === i ? 1 : 0.75 }}
            transition={{ duration: 0.12 }}
            className="aspect-square rounded-2xl text-4xl grid place-items-center border-2 border-white shadow select-none"
            style={{
              backgroundColor: aceso === i ? s.cor : s.cor + '33',
              boxShadow: aceso === i ? `0 0 24px ${s.cor}` : undefined,
            }}>
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
    <div className="bg-white rounded-3xl p-4 sm:p-5 shadow-md">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-semibold text-slate-600">{achadas.length}/{palavras.length} achadas</span>
        <button onClick={onCancelar} className="text-xs text-slate-400 p-3 -m-3">Cancelar</button>
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
    <div className="bg-white rounded-3xl p-4 sm:p-5 shadow-md text-center">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-semibold text-slate-600">Movimentos: {mov}</span>
        <button onClick={onCancelar} className="text-xs text-slate-400 p-3 -m-3">Cancelar</button>
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
    <div className="bg-white rounded-3xl p-4 sm:p-5 shadow-md">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-semibold text-slate-600">Palavra {i + 1} de {palavras.length}</span>
        <button onClick={onCancelar} className="text-xs text-slate-400 p-3 -m-3">Cancelar</button>
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

// Rosa dos ventos com a agulha apontando pra direção inicial da pergunta
function RosaDosVentos({ de }) {
  const ang = ROSA.indexOf(de) * 45
  return (
    <div className="relative w-40 h-40 mx-auto mb-3 rounded-full border-4 border-slate-200 bg-gradient-to-b from-white to-slate-50 shadow-inner select-none">
      {ROSA.map((d, i) => (
        <div key={d} className="absolute inset-0" style={{ transform: `rotate(${i * 45}deg)` }}>
          <div className="absolute top-1.5 inset-x-0 text-center">
            <span className={`inline-block text-[10px] font-extrabold ${i % 2 === 0 ? 'text-slate-600' : 'text-slate-300'}`}
              style={{ transform: `rotate(${-i * 45}deg)` }}>
              {d}
            </span>
          </div>
        </div>
      ))}
      <motion.div className="absolute inset-0" animate={{ rotate: ang }}
        transition={{ type: 'spring', stiffness: 120, damping: 14 }}>
        <div className="absolute top-6 inset-x-0 text-center text-red-500 text-xl leading-none">▲</div>
        <div className="absolute bottom-6 inset-x-0 text-center text-slate-300 text-xl leading-none">▼</div>
      </motion.div>
      <div className="absolute left-1/2 top-1/2 w-3 h-3 -ml-1.5 -mt-1.5 rounded-full bg-azul ring-4 ring-azul/20" />
    </div>
  )
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
    <div className="bg-white rounded-3xl p-4 sm:p-5 shadow-md text-center">
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-semibold text-slate-600">Pergunta {n} de {TOTAL}</span>
        <button onClick={onCancelar} className="text-xs text-slate-400 p-3 -m-3">Cancelar</button>
      </div>

      <RosaDosVentos de={q.de} />
      <p className="text-slate-700 leading-snug mb-1">
        A agulha mostra: você está virado para o <b>{NOME_DIR[q.de]}</b>.<br />
        Agora gire <b>{q.graus}°</b> <b>{q.horario ? 'à direita ↻' : 'à esquerda ↺'}</b>.
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
    <div className="bg-white rounded-3xl p-4 sm:p-5 shadow-md text-center">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-semibold text-slate-600">
          {'❤️'.repeat(Math.max(0, vidas))}{'🖤'.repeat(Math.min(VIDAS, erradas.length))}
        </span>
        <button onClick={onCancelar} className="text-xs text-slate-400 p-3 -m-3">Cancelar</button>
      </div>
      <p className="text-xs text-slate-400 mb-3">Adivinhe a palavra do mundo desbravador</p>

      <div className="flex flex-wrap justify-center gap-1.5 mb-4">
        {palavra.split('').map((l, k) => {
          const mostra = usadas.includes(l) || fim
          return (
            <motion.span key={k} animate={mostra ? { scale: [0.6, 1.15, 1] } : {}}
              className={`w-7 h-10 rounded-lg grid place-items-center text-xl font-extrabold ${
                mostra ? 'bg-azul/10 text-azul border-b-4 border-azul' : 'bg-slate-100 border-b-4 border-slate-300'
              }`}>
              {mostra ? l : ''}
            </motion.span>
          )
        })}
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
    <div className="bg-white rounded-3xl p-4 sm:p-5 shadow-md text-center">
      <div className="flex items-center justify-between mb-2">
        <span className={`text-sm font-extrabold ${tempo <= 10 ? 'text-red-500' : 'text-slate-600'}`}>⏱️ {tempo}s</span>
        <span className="text-sm font-semibold text-green-600">✅ {acertos}</span>
        <button onClick={onCancelar} className="text-xs text-slate-400 p-3 -m-3">Cancelar</button>
      </div>
      {/* Barra do tempo esvaziando (fica vermelha na reta final) */}
      <div className="h-2 bg-slate-100 rounded-full overflow-hidden mb-3">
        <div className={`h-full rounded-full transition-all duration-1000 ease-linear ${tempo <= 10 ? 'bg-red-500' : 'bg-azul'}`}
          style={{ width: `${(tempo / SEGUNDOS) * 100}%` }} />
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

// ===================== 🪢 Quiz dos Nós =====================
const PERGUNTAS_NOS = [
  { p: 'Qual nó emenda duas cordas da MESMA grossura?', o: ['Nó direito (quadrado)', 'Lais de guia', 'Volta do fiel', 'Nó de escota'], c: 0 },
  { p: 'E pra emendar duas cordas de grossuras DIFERENTES?', o: ['Nó de escota', 'Nó direito', 'Nó cego', 'Volta do fiel'], c: 0 },
  { p: 'Qual nó faz uma alça que NÃO aperta (usada em resgate)?', o: ['Lais de guia', 'Nó direito', 'Nó de escota', 'Nó cego'], c: 0 },
  { p: 'Qual nó prende a corda a um poste e começa as amarras?', o: ['Volta do fiel', 'Lais de guia', 'Nó de pescador', 'Nó direito'], c: 0 },
  { p: 'Qual nó serve de "parada" na ponta da corda, pra não escapar?', o: ['Nó de oito', 'Volta do fiel', 'Nó de escota', 'Lais de guia'], c: 0 },
  { p: 'Qual amarra une dois mastros em cruz (90°)?', o: ['Amarra quadrada', 'Amarra diagonal', 'Amarra redonda', 'Volta do fiel'], c: 0 },
  { p: 'E pra unir dois mastros cruzados em X (diagonal)?', o: ['Amarra diagonal', 'Amarra quadrada', 'Amarra redonda', 'Nó de escota'], c: 0 },
  { p: 'Qual amarra emenda dois mastros pra ficarem mais compridos?', o: ['Amarra redonda (de extensão)', 'Amarra quadrada', 'Amarra diagonal', 'Nó de oito'], c: 0 },
]

function JogoNos({ onTerminar, onCancelar }) {
  // Sorteia 6 perguntas e embaralha as opções de cada uma (a certa muda de lugar)
  const [rodadas] = useState(() => embaralhar(PERGUNTAS_NOS).slice(0, 6).map((q) => {
    const certa = q.o[q.c]
    return { p: q.p, opcoes: embaralhar(q.o), certa }
  }))
  const [n, setN] = useState(0)
  const [acertos, setAcertos] = useState(0)
  const [aviso, setAviso] = useState('')
  const [fim, setFim] = useState(false)
  const q = rodadas[n]

  function responder(op) {
    if (fim || aviso) return
    const ok = op === q.certa
    const total = acertos + (ok ? 1 : 0)
    if (ok) setAcertos(total)
    setAviso(ok ? 'Isso! ✅' : `Era: ${q.certa}`)
    setTimeout(() => {
      setAviso('')
      if (n + 1 >= rodadas.length) {
        setFim(true)
        onTerminar(total >= 6 ? 3 : total >= 4 ? 2 : 1)
      } else setN(n + 1)
    }, 1300)
  }

  return (
    <div className="bg-white rounded-3xl p-4 sm:p-5 shadow-md">
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-semibold text-slate-600">Pergunta {n + 1} de {rodadas.length}</span>
        <button onClick={onCancelar} className="text-xs text-slate-400 p-3 -m-3">Cancelar</button>
      </div>
      <div className="text-center text-4xl mb-2">🪢</div>
      <p className="text-slate-700 font-semibold text-center mb-4">{q.p}</p>
      <div className="space-y-2">
        {q.opcoes.map((op) => (
          <motion.button key={op} whileTap={{ scale: 0.98 }} onClick={() => responder(op)} disabled={!!aviso || fim}
            className="w-full rounded-xl bg-slate-50 hover:bg-slate-100 py-3 px-3 text-sm font-semibold text-slate-700 text-left disabled:opacity-60">
            {op}
          </motion.button>
        ))}
      </div>
      {aviso && <p className={`text-sm font-bold text-center mt-3 ${aviso.startsWith('Isso') ? 'text-green-600' : 'text-amber-600'}`}>{aviso}</p>}
      <p className="text-xs text-slate-400 text-center mt-2">Acertos: {acertos}</p>
    </div>
  )
}

// ===================== 🚩 Semáfora =====================
// Só o CÍRCULO 1 (A–G), que é como o clube ensina no começo — e são as posições
// conferidas em fonte confiável. Dá pra ampliar depois com o manual do clube.
// Cada braço aponta pra baixo (0°) e gira pro seu lado: low 45°, out 90°,
// high 135°, up 180°. "esq" = mão DIREITA de quem sinaliza (como você vê).
const POS_ANG = { down: 0, low: 45, out: 90, high: 135, up: 180 }
const SEMAFORO = {
  A: { esq: 'low', dir: 'down' },
  B: { esq: 'out', dir: 'down' },
  C: { esq: 'high', dir: 'down' },
  D: { esq: 'up', dir: 'down' },
  E: { esq: 'down', dir: 'high' },
  F: { esq: 'down', dir: 'out' },
  G: { esq: 'down', dir: 'low' },
}
const LETRAS_SEM = Object.keys(SEMAFORO)

function Bandeirinha({ lado, pos }) {
  // esq gira pra esquerda (negativo), dir pra direita (positivo)
  const ang = (lado === 'esq' ? -1 : 1) * POS_ANG[pos]
  return (
    <div className="absolute left-1/2 top-1/2 w-2 h-16 -ml-1 origin-top"
      style={{ transform: `rotate(${ang}deg)` }}>
      <div className="w-2 h-16 bg-slate-700 rounded-full" />
      <div className="w-4 h-4 -ml-1 rounded-sm bg-red-500" />
    </div>
  )
}

function JogoSemaforo({ onTerminar, onCancelar }) {
  const TOTAL = 6
  const sortear = () => {
    const certa = LETRAS_SEM[Math.floor(Math.random() * LETRAS_SEM.length)]
    const outras = embaralhar(LETRAS_SEM.filter((l) => l !== certa)).slice(0, 3)
    return { certa, opcoes: embaralhar([certa, ...outras]) }
  }
  const [q, setQ] = useState(sortear)
  const [n, setN] = useState(1)
  const [acertos, setAcertos] = useState(0)
  const [aviso, setAviso] = useState('')
  const [fim, setFim] = useState(false)
  const sinal = SEMAFORO[q.certa]

  function responder(l) {
    if (fim || aviso) return
    const ok = l === q.certa
    const total = acertos + (ok ? 1 : 0)
    if (ok) setAcertos(total)
    setAviso(ok ? 'Isso! ✅' : `Era a letra ${q.certa}`)
    setTimeout(() => {
      setAviso('')
      if (n >= TOTAL) {
        setFim(true)
        onTerminar(total >= 6 ? 3 : total >= 4 ? 2 : 1)
      } else { setN(n + 1); setQ(sortear()) }
    }, 1100)
  }

  return (
    <div className="bg-white rounded-3xl p-4 sm:p-5 shadow-md text-center">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-semibold text-slate-600">Letra {n} de {TOTAL}</span>
        <button onClick={onCancelar} className="text-xs text-slate-400 p-3 -m-3">Cancelar</button>
      </div>
      <p className="text-xs text-slate-400 mb-2">Que letra as bandeiras estão fazendo? (A a G)</p>

      <div className="relative h-44 mx-auto w-44 bg-slate-50 rounded-2xl mb-3">
        <div className="absolute left-1/2 top-1/2 w-6 h-6 -ml-3 -mt-3 rounded-full bg-slate-700" />
        <Bandeirinha lado="esq" pos={sinal.esq} />
        <Bandeirinha lado="dir" pos={sinal.dir} />
      </div>

      <div className="grid grid-cols-4 gap-2">
        {q.opcoes.map((l) => (
          <motion.button key={l} whileTap={{ scale: 0.96 }} onClick={() => responder(l)} disabled={!!aviso || fim}
            className="rounded-xl bg-slate-50 hover:bg-slate-100 py-3 text-xl font-extrabold text-slate-700 disabled:opacity-60">
            {l}
          </motion.button>
        ))}
      </div>
      {aviso && <p className={`text-sm font-bold mt-3 ${aviso.startsWith('Isso') ? 'text-green-600' : 'text-amber-600'}`}>{aviso}</p>}
      <p className="text-xs text-slate-400 mt-2">Acertos: {acertos}</p>
    </div>
  )
}

// ===================== 🐍 Cobrinha =====================
const N_COBRA = 12
function novaComidaCobra(corpo) {
  const livres = []
  for (let y = 0; y < N_COBRA; y++) {
    for (let x = 0; x < N_COBRA; x++) {
      if (!corpo.some((s) => s.x === x && s.y === y)) livres.push({ x, y })
    }
  }
  return livres[Math.floor(Math.random() * livres.length)] || { x: 0, y: 0 }
}

function JogoCobra({ onTerminar, onCancelar }) {
  const [jogo, setJogo] = useState(() => ({
    cobra: [{ x: 6, y: 6 }], comida: { x: 3, y: 3 }, pontos: 0, fim: false,
  }))
  const dirRef = useRef({ x: 0, y: -1 }) // começa subindo

  // Passo do jogo: tudo calculado dentro do updater (sem efeito colateral).
  useEffect(() => {
    if (jogo.fim) return
    const t = setInterval(() => {
      setJogo((j) => {
        if (j.fim) return j
        const d = dirRef.current
        // ATRAVESSA A PAREDE: some de um lado e volta pelo outro (o % com +N
        // resolve o lado negativo também).
        const cab = {
          x: (j.cobra[0].x + d.x + N_COBRA) % N_COBRA,
          y: (j.cobra[0].y + d.y + N_COBRA) % N_COBRA,
        }
        const comeu = cab.x === j.comida.x && cab.y === j.comida.y
        // Só morre batendo em SI MESMA. O rabo não conta quando não come,
        // porque ele sai da casa no mesmo passo.
        const corpoRisco = comeu ? j.cobra : j.cobra.slice(0, -1)
        if (corpoRisco.some((s) => s.x === cab.x && s.y === cab.y)) return { ...j, fim: true }
        const corpo = [cab, ...j.cobra]
        if (!comeu) corpo.pop()
        return {
          cobra: corpo,
          comida: comeu ? novaComidaCobra(corpo) : j.comida,
          pontos: j.pontos + (comeu ? 1 : 0),
          fim: false,
        }
      })
    }, 230)
    return () => clearInterval(t)
  }, [jogo.fim])

  // Acabou: entrega as estrelas
  useEffect(() => {
    if (!jogo.fim) return
    const t = setTimeout(() => onTerminar(jogo.pontos >= 15 ? 3 : jogo.pontos >= 8 ? 2 : 1), 1000)
    return () => clearTimeout(t)
  }, [jogo.fim]) // eslint-disable-line

  function virar(x, y) {
    const d = dirRef.current
    if (d.x === -x && d.y === -y) return // não pode voltar em cima de si
    dirRef.current = { x, y }
  }

  const ehCobra = (x, y) => jogo.cobra.some((s) => s.x === x && s.y === y)
  const ehCabeca = (x, y) => jogo.cobra[0].x === x && jogo.cobra[0].y === y

  return (
    <div className="bg-white rounded-3xl p-4 sm:p-5 shadow-md text-center">
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-semibold text-green-600">🍎 {jogo.pontos}</span>
        <button onClick={onCancelar} className="text-xs text-slate-400 p-3 -m-3">Cancelar</button>
      </div>

      {jogo.fim ? (
        <div className="py-8">
          <div className="text-5xl mb-2">🐍</div>
          <p className="font-extrabold text-slate-800">Fim! Você comeu {jogo.pontos}.</p>
        </div>
      ) : (
        <>
          <div className="bg-emerald-950 rounded-2xl p-1.5 mx-auto max-w-[300px] mb-3 shadow-inner select-none">
            <div className="grid gap-px" style={{ gridTemplateColumns: `repeat(${N_COBRA}, 1fr)` }}>
              {Array.from({ length: N_COBRA * N_COBRA }, (_, i) => {
                const x = i % N_COBRA, y = Math.floor(i / N_COBRA)
                const comida = jogo.comida.x === x && jogo.comida.y === y
                return (
                  <div key={i} className={`aspect-square rounded-[3px] ${
                    ehCabeca(x, y) ? 'bg-lime-300 shadow-[0_0_8px_rgba(163,230,53,0.8)]'
                    : ehCobra(x, y) ? 'bg-lime-500'
                    : comida ? 'bg-red-500 rounded-full animate-pulse'
                    : 'bg-emerald-900/70'
                  }`} />
                )
              })}
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2 max-w-[220px] mx-auto select-none">
            <div />
            <button onClick={() => virar(0, -1)} className="rounded-2xl bg-slate-100 active:bg-azul active:text-white py-4 text-2xl font-bold shadow-sm">↑</button>
            <div />
            <button onClick={() => virar(-1, 0)} className="rounded-2xl bg-slate-100 active:bg-azul active:text-white py-4 text-2xl font-bold shadow-sm">←</button>
            <button onClick={() => virar(0, 1)} className="rounded-2xl bg-slate-100 active:bg-azul active:text-white py-4 text-2xl font-bold shadow-sm">↓</button>
            <button onClick={() => virar(1, 0)} className="rounded-2xl bg-slate-100 active:bg-azul active:text-white py-4 text-2xl font-bold shadow-sm">→</button>
          </div>
        </>
      )}
    </div>
  )
}

// ===================== 🔤 Anagrama =====================
const PALAVRAS_ANAGRAMA = [
  'ACAMPAMENTO', 'FOGUEIRA', 'BUSSOLA', 'MOCHILA', 'BARRACA',
  'UNIFORME', 'LANTERNA', 'BANDEIRA', 'CAMINHADA', 'CANIVETE',
]
function embaralharPalavra(p) {
  let s = embaralhar(p.split('')).join('')
  // garante que não saiu igual à original
  for (let i = 0; i < 5 && s === p; i++) s = embaralhar(p.split('')).join('')
  return s
}

function JogoAnagrama({ onTerminar, onCancelar }) {
  const [rodadas] = useState(() => embaralhar(PALAVRAS_ANAGRAMA).slice(0, 3).map((p) => ({
    palavra: p, embaralhada: embaralharPalavra(p),
  })))
  const [i, setI] = useState(0)
  const [resp, setResp] = useState('')
  const [erros, setErros] = useState(0)
  const [aviso, setAviso] = useState('')
  const [fim, setFim] = useState(false)
  const q = rodadas[i]

  function conferir(e) {
    e.preventDefault()
    if (fim || aviso) return
    const ok = resp.trim().toUpperCase() === q.palavra
    const total = erros + (ok ? 0 : 1)
    if (!ok) setErros(total)
    setAviso(ok ? 'Acertou! ✅' : `Era ${q.palavra}`)
    setTimeout(() => {
      setAviso(''); setResp('')
      if (i + 1 >= rodadas.length) {
        setFim(true)
        onTerminar(total === 0 ? 3 : total === 1 ? 2 : 1)
      } else setI(i + 1)
    }, 1200)
  }

  return (
    <div className="bg-white rounded-3xl p-4 sm:p-5 shadow-md text-center">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-semibold text-slate-600">Palavra {i + 1} de {rodadas.length}</span>
        <button onClick={onCancelar} className="text-xs text-slate-400 p-3 -m-3">Cancelar</button>
      </div>
      <p className="text-xs text-slate-400 mb-3">Desembaralhe a palavra do clube 🏕️</p>

      <div className="flex flex-wrap justify-center gap-1.5 my-4">
        {q.embaralhada.split('').map((l, k) => (
          <span key={k} className="w-8 h-10 rounded-lg bg-azul/10 text-azul grid place-items-center text-lg font-extrabold">{l}</span>
        ))}
      </div>

      <form onSubmit={conferir} className="flex gap-2">
        <input value={resp} onChange={(e) => setResp(e.target.value)} disabled={!!aviso || fim}
          placeholder="Qual é a palavra?" autoCapitalize="characters"
          className="flex-1 rounded-lg border border-slate-300 px-3 py-2.5 text-sm uppercase outline-none focus:border-azul-claro focus:ring-2 focus:ring-azul-claro/30" />
        <button type="submit" disabled={!resp.trim() || !!aviso || fim}
          className="rounded-xl bg-azul text-white font-bold px-4 text-sm disabled:opacity-50">Conferir</button>
      </form>
      {aviso && <p className={`text-sm font-bold mt-3 ${aviso.startsWith('Acertou') ? 'text-green-600' : 'text-amber-600'}`}>{aviso}</p>}
    </div>
  )
}

// ===================== 💣 Campo Minado =====================
// 8x8 com 10 minas. O 1º toque é sempre seguro (as minas nascem depois dele,
// longe daquela casa). Modo ⛏️ cava; modo 🚩 marca. Perdeu = 1⭐; ganhou = 2⭐
// (3⭐ se em até 90s).
const N_MINADO = 8
const MINAS_TOTAL = 10
const CORES_NUM = ['', 'text-blue-600', 'text-green-600', 'text-red-500', 'text-purple-600',
  'text-amber-600', 'text-cyan-700', 'text-slate-700', 'text-slate-900']

function vizinhosMinado(i) {
  const x = i % N_MINADO, y = Math.floor(i / N_MINADO), v = []
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue
      const nx = x + dx, ny = y + dy
      if (nx >= 0 && nx < N_MINADO && ny >= 0 && ny < N_MINADO) v.push(ny * N_MINADO + nx)
    }
  }
  return v
}
function gerarMinas(evitar) {
  // nada de mina na 1ª casa tocada nem nas vizinhas (começo justo)
  const proibidas = new Set([evitar, ...vizinhosMinado(evitar)])
  const minas = new Set()
  while (minas.size < MINAS_TOTAL) {
    const i = Math.floor(Math.random() * N_MINADO * N_MINADO)
    if (!proibidas.has(i)) minas.add(i)
  }
  return minas
}

function JogoCampoMinado({ onTerminar, onCancelar }) {
  const [minas, setMinas] = useState(null) // só nascem no 1º toque
  const [abertas, setAbertas] = useState(() => new Set())
  const [bandeiras, setBandeiras] = useState(() => new Set())
  const [modo, setModo] = useState('cavar') // cavar | bandeira
  const [inicio, setInicio] = useState(null)
  const [fim, setFim] = useState(null) // null | 'ganhou' | 'perdeu'

  const contar = (i, ms) => vizinhosMinado(i).filter((v) => ms.has(v)).length

  function tocar(i) {
    if (fim || abertas.has(i)) return
    if (modo === 'bandeira') {
      setBandeiras((b) => {
        const n = new Set(b)
        if (n.has(i)) n.delete(i)
        else if (n.size < MINAS_TOTAL) n.add(i)
        return n
      })
      return
    }
    if (bandeiras.has(i)) return // casa marcada não cava (evita acidente)

    let ms = minas
    let t0 = inicio
    if (!ms) { ms = gerarMinas(i); setMinas(ms); t0 = Date.now(); setInicio(t0) }

    if (ms.has(i)) {
      setAbertas((a) => new Set([...a, i]))
      setFim('perdeu')
      setTimeout(() => onTerminar(1), 1600)
      return
    }

    // abre em cascata as áreas sem mina por perto
    const novas = new Set(abertas)
    const fila = [i]
    while (fila.length) {
      const c = fila.pop()
      if (novas.has(c)) continue
      novas.add(c)
      if (contar(c, ms) === 0) {
        for (const v of vizinhosMinado(c)) {
          if (!novas.has(v) && !ms.has(v)) fila.push(v)
        }
      }
    }
    setAbertas(novas)

    if (novas.size === N_MINADO * N_MINADO - MINAS_TOTAL) {
      setFim('ganhou')
      const seg = (Date.now() - t0) / 1000
      setTimeout(() => onTerminar(seg <= 90 ? 3 : 2), 1000)
    }
  }

  return (
    <div className="bg-white rounded-3xl p-4 sm:p-5 shadow-md text-center">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-extrabold text-slate-600">🚩 {MINAS_TOTAL - bandeiras.size}</span>
        {fim && (
          <span className={`text-sm font-extrabold ${fim === 'ganhou' ? 'text-green-600' : 'text-red-500'}`}>
            {fim === 'ganhou' ? 'Campo limpo! 🎉' : 'BUM! 💥'}
          </span>
        )}
        <button onClick={onCancelar} className="text-xs text-slate-400 p-3 -m-3">Cancelar</button>
      </div>

      <div className="bg-slate-300 rounded-2xl p-1.5 mx-auto max-w-[320px] mb-3 select-none">
        <div className="grid gap-0.5" style={{ gridTemplateColumns: `repeat(${N_MINADO}, 1fr)` }}>
          {Array.from({ length: N_MINADO * N_MINADO }, (_, i) => {
            const aberta = abertas.has(i)
            const bandeira = bandeiras.has(i)
            const mina = minas?.has(i)
            const n = aberta && minas ? contar(i, minas) : 0
            const mostraMina = fim === 'perdeu' && mina
            return (
              <button key={i} onClick={() => tocar(i)} disabled={!!fim}
                className={`aspect-square rounded-[4px] grid place-items-center text-xs sm:text-sm font-extrabold ${
                  mostraMina ? (aberta ? 'bg-red-500' : 'bg-red-200')
                  : aberta ? 'bg-slate-50'
                  : 'bg-gradient-to-br from-slate-400 to-slate-500 active:from-slate-500'
                }`}>
                {mostraMina ? (aberta ? '💥' : '💣')
                  : bandeira && !aberta ? '🚩'
                  : aberta && n > 0 ? <span className={CORES_NUM[n]}>{n}</span>
                  : ''}
              </button>
            )
          })}
        </div>
      </div>

      <div className="bg-slate-100 rounded-xl p-1 flex max-w-[240px] mx-auto select-none">
        {[['cavar', '⛏️ Cavar'], ['bandeira', '🚩 Marcar']].map(([k, lbl]) => (
          <button key={k} onClick={() => setModo(k)}
            className={`flex-1 rounded-lg py-2 text-sm font-bold transition-colors ${modo === k ? 'bg-white shadow text-slate-800' : 'text-slate-500'}`}>
            {lbl}
          </button>
        ))}
      </div>
      <p className="text-[11px] text-slate-400 mt-2">O número mostra quantas minas tem nas casas vizinhas.</p>
    </div>
  )
}

// ===================== 👀 O Que Mudou? (memória) =====================
// Memoriza a grade por alguns segundos; um item vira ❓ e a criança diz qual era.
const POOL_MUDOU = ['🔥', '⛺', '🧭', '🪢', '📖', '🥾', '🎒', '🔦', '🍎', '🌲', '🐍', '🦅', '⭐', '🌙', '☀️', '🚩', '🛶', '🪓', '🧣', '💧']
const TAMANHOS_MUDOU = [4, 6, 6, 8, 9]
const COLS_MUDOU = { 4: 2, 6: 3, 8: 4, 9: 3 }

function rodadaMudou(n) {
  const itens = embaralhar(POOL_MUDOU).slice(0, n)
  const alvo = Math.floor(Math.random() * n)
  const fora = embaralhar(POOL_MUDOU.filter((e) => !itens.includes(e))).slice(0, 3)
  return { itens, alvo, opcoes: embaralhar([itens[alvo], ...fora]) }
}

function JogoMudou({ onTerminar, onCancelar }) {
  const [n, setN] = useState(0)
  const [rod, setRod] = useState(() => rodadaMudou(TAMANHOS_MUDOU[0]))
  const [fase, setFase] = useState('olhar') // olhar | responder
  const [acertos, setAcertos] = useState(0)
  const [aviso, setAviso] = useState('')

  // Tempo de memorizar cresce um pouco com o tamanho da grade
  useEffect(() => {
    if (fase !== 'olhar') return
    const t = setTimeout(() => setFase('responder'), 2500 + rod.itens.length * 250)
    return () => clearTimeout(t)
  }, [fase, rod])

  function responder(op) {
    if (fase !== 'responder' || aviso) return
    const certo = rod.itens[rod.alvo]
    const ok = op === certo
    const tot = acertos + (ok ? 1 : 0)
    if (ok) setAcertos(tot)
    setAviso(ok ? 'Boa memória! ✅' : `Era ${certo}`)
    setTimeout(() => {
      setAviso('')
      if (n + 1 >= TAMANHOS_MUDOU.length) {
        onTerminar(tot >= 5 ? 3 : tot >= 3 ? 2 : 1)
      } else {
        const nx = n + 1
        setN(nx)
        setRod(rodadaMudou(TAMANHOS_MUDOU[nx]))
        setFase('olhar')
      }
    }, 1200)
  }

  const cols = COLS_MUDOU[rod.itens.length] || 3
  return (
    <div className="bg-white rounded-3xl p-4 sm:p-5 shadow-md text-center">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-semibold text-slate-600">Rodada {n + 1} de {TAMANHOS_MUDOU.length}</span>
        <button onClick={onCancelar} className="text-xs text-slate-400 p-3 -m-3">Cancelar</button>
      </div>
      <p className="text-xs text-slate-400 mb-3 h-4">
        {fase === 'olhar' ? '👀 Memorize os itens…' : aviso || 'Qual item estava na casa ❓?'}
      </p>

      <div className="grid gap-2 mx-auto max-w-[260px] mb-4 select-none" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
        {rod.itens.map((e, i) => (
          <div key={i} className={`aspect-square rounded-xl grid place-items-center text-3xl ${
            fase === 'responder' && i === rod.alvo ? 'bg-azul/10 border-2 border-azul text-azul font-extrabold' : 'bg-slate-50'
          }`}>
            {fase === 'olhar' ? e : i === rod.alvo ? '❓' : e}
          </div>
        ))}
      </div>

      {fase === 'responder' && (
        <div className="grid grid-cols-4 gap-2">
          {rod.opcoes.map((op) => (
            <motion.button key={op} whileTap={{ scale: 0.94 }} onClick={() => responder(op)} disabled={!!aviso}
              className="rounded-xl bg-slate-50 hover:bg-slate-100 py-3 text-2xl disabled:opacity-60">
              {op}
            </motion.button>
          ))}
        </div>
      )}
      <p className="text-xs text-slate-400 mt-3">Acertos: {acertos}</p>
    </div>
  )
}

// ===================== 🗼 Torre de Hanói (lógica) =====================
// 4 discos, mínimo 15 movimentos. Toque num pino pra pegar o disco de cima e
// noutro pra soltar (nunca disco grande sobre pequeno).
const HANOI_DISCOS = 4
const HANOI_MINIMO = 15
const HANOI_COR = ['', 'bg-red-400', 'bg-amber-400', 'bg-green-500', 'bg-azul']

function JogoHanoi({ onTerminar, onCancelar }) {
  const [pinos, setPinos] = useState(() => [[4, 3, 2, 1], [], []]) // fim do array = topo
  const [sel, setSel] = useState(null)
  const [mov, setMov] = useState(0)
  const [erro, setErro] = useState(false)
  const [fim, setFim] = useState(false)

  function tocar(p) {
    if (fim) return
    if (sel === null) {
      if (pinos[p].length) setSel(p)
      return
    }
    if (sel === p) { setSel(null); return }
    const disco = pinos[sel][pinos[sel].length - 1]
    const topoDestino = pinos[p][pinos[p].length - 1]
    if (topoDestino && topoDestino < disco) {
      // não pode: grande sobre pequeno (pisca em vermelho)
      setErro(true)
      setTimeout(() => setErro(false), 450)
      setSel(null)
      return
    }
    const novo = pinos.map((x) => [...x])
    novo[sel].pop()
    novo[p].push(disco)
    const m = mov + 1
    setPinos(novo)
    setMov(m)
    setSel(null)
    if (novo[2].length === HANOI_DISCOS) {
      setFim(true)
      setTimeout(() => onTerminar(m <= HANOI_MINIMO ? 3 : m <= 22 ? 2 : 1), 1000)
    }
  }

  return (
    <div className="bg-white rounded-3xl p-4 sm:p-5 shadow-md text-center">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-semibold text-slate-600">Movimentos: {mov} <span className="text-slate-400">(mínimo: {HANOI_MINIMO})</span></span>
        <button onClick={onCancelar} className="text-xs text-slate-400 p-3 -m-3">Cancelar</button>
      </div>
      <p className={`text-xs mb-3 h-4 font-semibold ${erro ? 'text-red-500' : fim ? 'text-green-600' : 'text-slate-400'}`}>
        {erro ? 'Não pode: disco grande sobre pequeno!' : fim ? `Conseguiu em ${mov} movimentos! 🎉` : 'Leve todos os discos pro 3º pino 👉'}
      </p>

      <div className="flex items-end justify-center gap-2 select-none mb-1">
        {pinos.map((pino, p) => (
          <button key={p} onClick={() => tocar(p)}
            className={`relative flex-1 max-w-[110px] h-36 flex flex-col-reverse items-center pb-1 rounded-xl transition-colors ${
              sel === p ? 'bg-azul/10 ring-2 ring-azul' : 'bg-slate-50'
            }`}>
            <div className="absolute bottom-1 top-4 left-1/2 -ml-[3px] w-1.5 bg-slate-300 rounded-full" />
            {pino.map((d, i) => (
              <div key={d}
                className={`relative z-10 h-4 rounded-full mb-0.5 shadow-sm ${HANOI_COR[d]} ${
                  sel === p && i === pino.length - 1 ? 'ring-2 ring-white -translate-y-0.5' : ''
                }`}
                style={{ width: `${26 + d * 16}px` }} />
            ))}
          </button>
        ))}
      </div>
      <div className="h-2 bg-slate-300 rounded-full max-w-[350px] mx-auto" />
      <p className="text-[11px] text-slate-400 mt-3">Toque num pino pra pegar o disco de cima; toque noutro pra soltar.</p>
    </div>
  )
}

// ===================== 🟩 Termo do Clube (lógica) =====================
// Estilo Termo/Wordle: 5 letras, 6 tentativas, palavras do mundo desbravador
// (sem acento/ç: LENÇO = LENCO). Verde = certa no lugar; amarelo = existe.
const PALAVRAS_TERMO = ['TENDA', 'CORDA', 'LENCO', 'TRIBO', 'JESUS', 'GRACA', 'ANJOS', 'AMIGO',
  'UNIAO', 'HONRA', 'SERVO', 'TERRA', 'MUNDO', 'CANTO', 'AGUIA', 'FESTA']
const TECLADO_TERMO = ['QWERTYUIOP', 'ASDFGHJKL', 'ZXCVBNM']

function avaliarTermo(tent, alvo) {
  const res = Array(5).fill('cinza')
  const sobras = {}
  for (let i = 0; i < 5; i++) {
    if (tent[i] === alvo[i]) res[i] = 'verde'
    else sobras[alvo[i]] = (sobras[alvo[i]] || 0) + 1
  }
  for (let i = 0; i < 5; i++) {
    if (res[i] !== 'verde' && sobras[tent[i]] > 0) { res[i] = 'amarelo'; sobras[tent[i]]-- }
  }
  return res
}
const COR_TERMO = {
  verde: 'bg-green-500 text-white border-green-500',
  amarelo: 'bg-amber-400 text-white border-amber-400',
  cinza: 'bg-slate-400 text-white border-slate-400',
}

function JogoTermo({ onTerminar, onCancelar }) {
  const [alvo] = useState(() => PALAVRAS_TERMO[Math.floor(Math.random() * PALAVRAS_TERMO.length)])
  const [linhas, setLinhas] = useState([])
  const [atual, setAtual] = useState('')
  const [fim, setFim] = useState(null) // ganhou | perdeu
  const [aviso, setAviso] = useState('')

  function tecla(k) {
    if (fim) return
    if (k === '⌫') { setAtual((a) => a.slice(0, -1)); return }
    if (k === 'OK') {
      if (atual.length < 5) { setAviso('Complete as 5 letras'); setTimeout(() => setAviso(''), 900); return }
      const res = avaliarTermo(atual, alvo)
      const novas = [...linhas, { tent: atual, res }]
      setLinhas(novas)
      setAtual('')
      if (atual === alvo) {
        setFim('ganhou')
        setTimeout(() => onTerminar(novas.length <= 3 ? 3 : 2), 1200)
      } else if (novas.length >= 6) {
        setFim('perdeu')
        setTimeout(() => onTerminar(1), 1800)
      }
      return
    }
    if (atual.length < 5) setAtual((a) => a + k)
  }

  // Cor de cada tecla = melhor resultado que aquela letra já teve
  const corTecla = {}
  const rank = { verde: 3, amarelo: 2, cinza: 1 }
  linhas.forEach(({ tent, res }) => tent.split('').forEach((l, i) => {
    if (!corTecla[l] || rank[res[i]] > rank[corTecla[l]]) corTecla[l] = res[i]
  }))

  return (
    <div className="bg-white rounded-3xl p-4 sm:p-5 shadow-md text-center">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-semibold text-slate-600">Tentativa {Math.min(linhas.length + 1, 6)} de 6</span>
        <button onClick={onCancelar} className="text-xs text-slate-400 p-3 -m-3">Cancelar</button>
      </div>
      <p className={`text-xs mb-3 h-4 font-semibold ${fim === 'ganhou' ? 'text-green-600' : fim === 'perdeu' ? 'text-amber-600' : 'text-slate-400'}`}>
        {fim === 'ganhou' ? 'Descobriu! 🎉' : fim === 'perdeu' ? `Era ${alvo}!` : aviso || 'Palavra do mundo desbravador'}
      </p>

      <div className="grid gap-1.5 mx-auto max-w-[280px] mb-4 select-none">
        {Array.from({ length: 6 }, (_, r) => {
          const linha = linhas[r]
          const ehAtual = r === linhas.length && !fim
          return (
            <div key={r} className="grid grid-cols-5 gap-1.5">
              {Array.from({ length: 5 }, (_, c) => {
                const letra = linha ? linha.tent[c] : ehAtual ? (atual[c] || '') : ''
                const cor = linha ? COR_TERMO[linha.res[c]] : 'bg-white border-slate-200 text-slate-800'
                return (
                  <div key={c} className={`aspect-square rounded-lg border-2 grid place-items-center text-xl font-extrabold ${cor} ${
                    ehAtual && atual[c] ? 'border-azul' : ''
                  }`}>
                    {letra}
                  </div>
                )
              })}
            </div>
          )
        })}
      </div>

      <div className="space-y-1.5 select-none">
        {TECLADO_TERMO.map((row, r) => (
          <div key={r} className="flex justify-center gap-1">
            {r === 2 && (
              <button onClick={() => tecla('OK')} className="rounded-lg bg-azul text-white text-xs font-extrabold px-2.5 h-11">OK</button>
            )}
            {row.split('').map((k) => (
              <button key={k} onClick={() => tecla(k)}
                className={`rounded-lg w-[8.2%] min-w-6 h-11 text-sm font-extrabold ${
                  corTecla[k] ? COR_TERMO[corTecla[k]] : 'bg-slate-100 text-slate-700'
                }`}>
                {k}
              </button>
            ))}
            {r === 2 && (
              <button onClick={() => tecla('⌫')} className="rounded-lg bg-slate-200 text-slate-700 text-sm font-extrabold px-2.5 h-11">⌫</button>
            )}
          </div>
        ))}
      </div>
      <p className="text-[11px] text-slate-400 mt-3">Sem acento nem ç (ex.: LENÇO = LENCO). Verde = lugar certo; amarelo = tem na palavra.</p>
    </div>
  )
}

// ===================== ➡️ Qual é o Próximo? (lógica) =====================
const SEQS_PROXIMO = [
  { s: '2, 4, 6, 8, …', o: ['9', '10', '12', '16'], c: 1 },
  { s: '1, 2, 4, 8, …', o: ['12', '14', '16', '10'], c: 2 },
  { s: '21, 18, 15, 12, …', o: ['10', '9', '8', '11'], c: 1 },
  { s: '1, 1, 2, 3, 5, …', o: ['6', '7', '8', '10'], c: 2 },
  { s: '1, 4, 9, 16, …', o: ['20', '24', '25', '36'], c: 2 },
  { s: '3, 6, 12, 24, …', o: ['30', '36', '48', '44'], c: 2 },
  { s: '10, 9, 7, 4, …', o: ['0', '1', '2', '3'], c: 0 },
  { s: '2, 3, 5, 7, 11, …', o: ['12', '13', '14', '15'], c: 1 },
  { s: '🔴 🔵 🔴 🔵 🔴 …', o: ['🔴', '🔵', '🟢', '🟡'], c: 1 },
  { s: '⭐ ⭐ 🔥 ⭐ ⭐ 🔥 ⭐ ⭐ …', o: ['⭐', '🔥', '🌙', '☀️'], c: 1 },
  { s: '🌱 🌿 🌳 🌱 🌿 …', o: ['🌱', '🌿', '🌳', '🍂'], c: 2 },
  { s: '🌞 🌙 🌞 🌙 🌞 …', o: ['🌞', '🌙', '⭐', '☁️'], c: 1 },
]

function JogoProximo({ onTerminar, onCancelar }) {
  const [rodadas] = useState(() => embaralhar(SEQS_PROXIMO).slice(0, 6).map((q) => ({
    s: q.s, certa: q.o[q.c], opcoes: embaralhar(q.o),
  })))
  const [n, setN] = useState(0)
  const [acertos, setAcertos] = useState(0)
  const [aviso, setAviso] = useState('')
  const q = rodadas[n]

  function responder(op) {
    if (aviso) return
    const ok = op === q.certa
    const tot = acertos + (ok ? 1 : 0)
    if (ok) setAcertos(tot)
    setAviso(ok ? 'Isso! ✅' : `Era ${q.certa}`)
    setTimeout(() => {
      setAviso('')
      if (n + 1 >= rodadas.length) onTerminar(tot >= 6 ? 3 : tot >= 4 ? 2 : 1)
      else setN(n + 1)
    }, 1100)
  }

  return (
    <div className="bg-white rounded-3xl p-4 sm:p-5 shadow-md text-center">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-semibold text-slate-600">Sequência {n + 1} de {rodadas.length}</span>
        <button onClick={onCancelar} className="text-xs text-slate-400 p-3 -m-3">Cancelar</button>
      </div>
      <p className="text-xs text-slate-400 mb-4">O que vem no lugar do “…”?</p>

      <div className="bg-azul/5 rounded-2xl py-5 px-3 mb-4">
        <span className="text-2xl font-extrabold text-azul tracking-wide break-words">{q.s}</span>
      </div>

      <div className="grid grid-cols-2 gap-2">
        {q.opcoes.map((op) => (
          <motion.button key={op} whileTap={{ scale: 0.96 }} onClick={() => responder(op)} disabled={!!aviso}
            className="rounded-xl bg-slate-50 hover:bg-slate-100 py-4 text-xl font-extrabold text-slate-700 disabled:opacity-60">
            {op}
          </motion.button>
        ))}
      </div>
      {aviso && <p className={`text-sm font-bold mt-3 ${aviso.startsWith('Isso') ? 'text-green-600' : 'text-amber-600'}`}>{aviso}</p>}
      <p className="text-xs text-slate-400 mt-2">Acertos: {acertos}</p>
    </div>
  )
}

// ===================== ❌⭕ Jogo da Velha (estratégia) =====================
// Melhor de 3 contra o app. A criança é o ❌. O app: ganha se puder, bloqueia
// se precisar, prefere centro e cantos — bom, mas dá pra vencer com "garfo".
const LINHAS_VELHA = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]]
function vencedorVelha(b) {
  for (const [a, c, d] of LINHAS_VELHA) {
    if (b[a] && b[a] === b[c] && b[a] === b[d]) return b[a]
  }
  return b.every(Boolean) ? 'empate' : null
}
function jogadaApp(b) {
  const livres = b.map((v, i) => (v ? null : i)).filter((v) => v !== null)
  const tenta = (marca) => {
    for (const i of livres) {
      const c = [...b]; c[i] = marca
      if (vencedorVelha(c) === marca) return i
    }
    return null
  }
  let i = tenta('O')            // 1) ganha se der
  if (i !== null) return i
  i = tenta('X')                // 2) bloqueia a criança
  if (i !== null) return i
  if (!b[4]) return 4           // 3) centro
  const cantos = [0, 2, 6, 8].filter((c) => !b[c])
  if (cantos.length) return cantos[Math.floor(Math.random() * cantos.length)]
  return livres[Math.floor(Math.random() * livres.length)]
}

function JogoVelha({ onTerminar, onCancelar }) {
  const [tab, setTab] = useState(() => Array(9).fill(null))
  const [partida, setPartida] = useState(1)          // 1..3 (quem começa alterna)
  const [placar, setPlacar] = useState({ v: 0, e: 0, d: 0 })
  const [vez, setVez] = useState('X')
  const [fimPartida, setFimPartida] = useState(null) // 'X' | 'O' | 'empate'
  const [fim, setFim] = useState(false)

  // Vez do app: joga com um delay pra dar sensação de "pensar"
  useEffect(() => {
    if (vez !== 'O' || fimPartida || fim) return
    const t = setTimeout(() => {
      setTab((b) => {
        if (vencedorVelha(b)) return b
        const i = jogadaApp(b)
        const n = [...b]; n[i] = 'O'
        return n
      })
      setVez('X')
    }, 500)
    return () => clearTimeout(t)
  }, [vez, fimPartida, fim]) // eslint-disable-line

  // Confere o resultado a cada jogada
  useEffect(() => {
    const r = vencedorVelha(tab)
    if (!r || fimPartida) return
    setFimPartida(r)
    const chave = r === 'X' ? 'v' : r === 'empate' ? 'e' : 'd'
    const novo = { ...placar, [chave]: placar[chave] + 1 }
    setPlacar(novo)
    if (partida >= 3) {
      setFim(true)
      const pts = novo.v * 2 + novo.e
      setTimeout(() => onTerminar(pts >= 4 ? 3 : pts >= 2 ? 2 : 1), 1500)
    } else {
      setTimeout(() => {
        setTab(Array(9).fill(null))
        setFimPartida(null)
        const prox = partida + 1
        setPartida(prox)
        setVez(prox === 2 ? 'O' : 'X') // na 2ª partida o app começa
      }, 1500)
    }
  }, [tab]) // eslint-disable-line

  function tocar(i) {
    if (vez !== 'X' || tab[i] || fimPartida || fim) return
    const n = [...tab]; n[i] = 'X'
    setTab(n)
    setVez('O')
  }

  const pontosFinais = placar.v * 2 + placar.e
  const status = fim
    ? (pontosFinais >= 4 ? 'Você levou a melhor! 🏆' : pontosFinais >= 2 ? 'Quase! Bom jogo 🙂' : 'O app venceu dessa vez 🤖')
    : fimPartida
    ? (fimPartida === 'X' ? 'Você venceu a partida! 🎉' : fimPartida === 'O' ? 'O app venceu essa 🤖' : 'Deu velha (empate)!')
    : vez === 'X' ? 'Sua vez — você é o ❌' : 'App pensando… 🤖'

  return (
    <div className="bg-white rounded-3xl p-4 sm:p-5 shadow-md text-center">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-semibold text-slate-600">Partida {partida} de 3</span>
        <button onClick={onCancelar} className="text-xs text-slate-400 p-3 -m-3">Cancelar</button>
      </div>
      <p className="text-sm font-bold text-slate-700 mb-1">
        Você {placar.v} × {placar.d} App <span className="text-slate-400 font-semibold">(empates: {placar.e})</span>
      </p>
      <p className="text-xs text-slate-400 mb-3 h-4">{status}</p>

      <div className="grid grid-cols-3 gap-1.5 mx-auto max-w-[260px] select-none">
        {tab.map((v, i) => (
          <motion.button key={i} whileTap={!v && vez === 'X' && !fimPartida ? { scale: 0.94 } : undefined}
            onClick={() => tocar(i)} disabled={!!v || vez !== 'X' || !!fimPartida || fim}
            className={`aspect-square rounded-xl grid place-items-center text-3xl font-extrabold ${
              v === 'X' ? 'bg-azul/10 text-azul' : v === 'O' ? 'bg-amber-50 text-amber-500' : 'bg-slate-50'
            }`}>
            {v === 'X' ? '❌' : v === 'O' ? '⭕' : ''}
          </motion.button>
        ))}
      </div>
      <p className="text-[11px] text-slate-400 mt-3">Melhor de 3. Vitória vale 2 pontos e empate vale 1 — some 4+ pra fazer 3⭐.</p>
    </div>
  )
}

// ===================== ⚡ Reflexo (modo SEM FIM) =====================
// Toque no alvo certo antes do tempo acabar. Cada acerto = +1 nível; o tempo
// encurta e a grade cresce. Errou ou estourou o tempo = fim. SEM limite de
// jogadas (não dá +10/+5) — a corrida vira RECORDE da semana; o maior ganha
// +20 automático no domingo.
const EMOJIS_REFLEXO = ['🔥', '⛺', '🧭', '📖', '⭐', '🍎', '🐍', '🦅', '🥾', '🪢', '💧', '🌙']

// Progressão: começa com 1 item e entra MAIS UM a cada nível (um item por
// rodada), até a grade encher com os 12 itens. Depois disso, o que aperta é o
// tempo. Itens sempre iguais e alinhados na grade (como era antes).
const qtdReflexo = (nv) => Math.min(EMOJIS_REFLEXO.length, 1 + nv)

function JogoReflexo({ onTerminar, onCancelar }) {
  const [nivel, setNivel] = useState(0)
  const [alvo, setAlvo] = useState(null)
  const [grade, setGrade] = useState([]) // emojis da rodada (o alvo está entre eles)
  const [rodadaId, setRodadaId] = useState(0) // muda a cada rodada (reinicia o timer)
  const [fim, setFim] = useState(false)
  const [resultado, setResultado] = useState(null) // { recorde, melhorou } | 'erro'
  const timerRef = useRef(null)

  // Calibragem (dono): tem que dar pra passar de 100 jogando de verdade.
  // Começa em 4s, aperta só 25ms por nível e NUNCA fica abaixo de 2s.
  const tempo = Math.max(2000, 4000 - nivel * 25)

  function novaRodada(nv) {
    const qtd = qtdReflexo(nv)
    const itens = embaralhar(EMOJIS_REFLEXO).slice(0, qtd) // itens únicos na grade
    setGrade(itens)
    setAlvo(itens[Math.floor(Math.random() * itens.length)])
    setRodadaId((r) => r + 1)
  }
  useEffect(() => { novaRodada(0) }, []) // eslint-disable-line

  // Estourou o tempo = fim de jogo
  useEffect(() => {
    if (fim || alvo === null) return
    timerRef.current = setTimeout(() => encerrar(nivel), tempo)
    return () => clearTimeout(timerRef.current)
  }, [rodadaId, fim]) // eslint-disable-line

  function tocar(e) {
    if (fim) return
    clearTimeout(timerRef.current)
    if (e === alvo) {
      const nv = nivel + 1
      setNivel(nv)
      novaRodada(nv)
    } else {
      encerrar(nivel)
    }
  }

  async function encerrar(pontos) {
    if (fim) return
    setFim(true)
    try {
      setResultado(await registrarRecorde('reflexo', pontos))
    } catch {
      setResultado('erro') // offline/SQL não rodado: a corrida não vira recorde
    }
  }

  function deNovo() {
    setNivel(0)
    setFim(false)
    setResultado(null)
    novaRodada(0)
  }

  // Colunas e tamanho do emoji acompanham a quantidade (item grande quando é
  // pouco; encolhe conforme a grade enche) — sempre alinhados e proporcionais.
  const cols = grade.length === 1 ? 1 : grade.length <= 4 ? 2 : 3
  const tamEmoji = cols === 1 ? 'text-[86px]' : cols === 2 ? 'text-5xl' : 'text-4xl'

  return (
    <div className="bg-white rounded-3xl p-4 sm:p-5 shadow-md text-center">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-extrabold text-slate-600">⚡ Nível {nivel}</span>
        <button onClick={onCancelar} className="text-xs text-slate-400 p-3 -m-3">Sair</button>
      </div>

      {fim ? (
        <div className="py-4">
          <div className="text-5xl mb-2">🏁</div>
          <p className="font-extrabold text-slate-800 text-lg">Você chegou ao nível {nivel}!</p>
          {resultado === 'erro' ? (
            <p className="text-xs text-slate-400 mt-1">Não deu pra salvar o recorde (sem internet?).</p>
          ) : resultado?.fora ? (
            <p className="text-sm font-bold text-slate-500 mt-1">Boa! 🙂 (a liderança joga, mas fica fora do ranking)</p>
          ) : resultado ? (
            <p className={`text-sm font-bold mt-1 ${resultado.melhorou ? 'text-green-600' : 'text-slate-500'}`}>
              {resultado.melhorou ? '🚀 NOVO recorde seu da semana!' : `Seu recorde da semana: ${resultado.recorde}`}
            </p>
          ) : (
            <p className="text-xs text-slate-400 mt-1">Salvando recorde…</p>
          )}
          {!resultado?.fora && (
            <p className="text-[11px] text-slate-400 mt-2">O maior recorde da semana ganha <b>+20 pontos</b> no domingo!</p>
          )}
          <div className="flex gap-2 mt-4 max-w-[280px] mx-auto">
            <button onClick={onCancelar} className="flex-1 rounded-xl bg-slate-100 text-slate-700 font-semibold py-2.5">Sair</button>
            <button onClick={deNovo} className="flex-1 rounded-xl bg-azul text-white font-extrabold py-2.5">🔁 De novo</button>
          </div>
        </div>
      ) : (
        <>
          <p className="text-slate-700 font-bold mb-2">Toque no <span className="text-3xl align-middle">{alvo}</span></p>
          {/* Barra do tempo da rodada (encolhe até zerar) */}
          <div className="h-2 bg-slate-100 rounded-full overflow-hidden max-w-[280px] mx-auto mb-3">
            <motion.div key={rodadaId} initial={{ scaleX: 1 }} animate={{ scaleX: 0 }}
              transition={{ duration: tempo / 1000, ease: 'linear' }}
              className="h-full bg-azul rounded-full origin-left" />
          </div>
          <div className="grid gap-2 mx-auto max-w-[280px] select-none" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
            {grade.map((e, i) => (
              <motion.button key={rodadaId + '-' + i} whileTap={{ scale: 0.92 }} onClick={() => tocar(e)}
                className={`aspect-square rounded-2xl bg-slate-50 hover:bg-slate-100 grid place-items-center shadow-sm ${tamEmoji}`}>
                {e}
              </motion.button>
            ))}
          </div>
          <p className="text-[11px] text-slate-400 mt-3">Sem limite de jogadas — cada corrida pode virar seu recorde da semana. 🚀</p>
        </>
      )}
    </div>
  )
}
