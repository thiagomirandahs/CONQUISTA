import { useState, useEffect, Suspense } from 'react'
import { motion } from 'framer-motion'
import { useAuth } from '../context/Auth.jsx'
import { CaixaAjuda } from '../components/Ajuda.jsx'
import FeedbackJogo from '../components/FeedbackJogo.jsx'
import { carregarTrilha, registrarJogo, carregarRankingTrilha, carregarJogosTrilha, lerJogoDaSemana, ajudasRecebidas, bonusTodosJogos, statusJogosDoDia, liberarJogo, trancarJogo, iniciarPartida } from '../lib/dados.js'
import * as juice from '../lib/juice.js'
// Registro dos jogos, error boundary e fallback WebGL — agora em features/jogos.
import { JOGOS, ARCADE, RESERVAS, JogoBoundary, JogoMemoria } from '../features/jogos/registry.jsx'
import ResultadoCard from '../features/jogos/ResultadoCard.jsx'
import RankingTrilha from '../features/jogos/RankingTrilha.jsx'

const festa = juice.festa

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
  const [pedidosAjuda, setPedidosAjuda] = useState([]) // pedidos de ajuda de amigos
  const [caixaAjuda, setCaixaAjuda] = useState(false)
  const [bonusDia, setBonusDia] = useState(0) // celebração ao completar todos os jogos do dia
  // Rodízio 🥇 Jogos do Dia: { hoje: [chaves], liberados: [chaves], proximos: [{chave,data}] }.
  // null = SQL do rodízio ainda não rodou → todos os jogos abertos (como antes).
  const [rodizio, setRodizio] = useState(null)

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
    // Rodízio dos Jogos do Dia. Se falhar (SQL não rodado), fica tudo aberto.
    statusJogosDoDia().then(setRodizio).catch(() => {})
  }, [])

  // Abre um jogo e já pede ao servidor a SESSÃO DE PARTIDA (anti-cheat): o
  // registrar_jogo/recorde levam esse id e o banco valida duração/validade.
  // Se a RPC falhar (offline/SQL antigo), o jogo abre normal mesmo assim.
  function abrirJogo(chave) {
    setJogoAtual(chave); setJogando(true); setResultado(null)
    iniciarPartida(chave).catch(() => {})
  }

  // Liderança: abre/tranca um jogo fora do rodízio (vale só hoje)
  async function alternarLiberacao(chave, liberar) {
    try {
      if (liberar) await liberarJogo(chave); else await trancarJogo(chave)
      setRodizio(await statusJogosDoDia())
    } catch (e) { alert(e?.message || String(e)) }
  }

  useEffect(() => { if (profile?.id) recarregar() }, [profile?.id]) // eslint-disable-line

  // Pedidos de ajuda que amigos me mandaram (poll leve + ao voltar o foco)
  useEffect(() => {
    if (!profile?.id) return
    const carregar = () => ajudasRecebidas().then(setPedidosAjuda).catch(() => {})
    carregar()
    const t = setInterval(carregar, 20000)
    const foco = () => { if (document.visibilityState === 'visible') carregar() }
    window.addEventListener('focus', foco)
    document.addEventListener('visibilitychange', foco)
    return () => { clearInterval(t); window.removeEventListener('focus', foco); document.removeEventListener('visibilitychange', foco) }
  }, [profile?.id])
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
      juice.vitoria(r.estrelas)
      setResultado({ estrelas: r.estrelas, pontos: r.pontos, extra: !!r.extra })
      setJogando(false)
      await recarregar()
      // Completou os jogos do dia? O servidor confere e dá o bônus (1x/dia).
      try { const b = await bonusTodosJogos(); if (b?.ganhou > 0) { festa(3); setBonusDia(b.ganhou) } } catch { /* silencioso */ }
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
  const ehAdmin = ['instrutor', 'diretoria'].includes(profile?.papel)
  // Rodízio: um jogo comum só está aberto no SEU dia (ou liberado pela liderança).
  // rodizio === null (SQL não rodou) OU ativo === false (interruptor da liderança
  // desligado em Gestão → 🎮) = tudo aberto, sem cadeados.
  const rodizioOn = !!rodizio && rodizio.ativo !== false
  const abertoHoje = (c) => !rodizioOn || ARCADE.has(c)
    || (rodizio.hoje || []).includes(c) || (rodizio.liberados || []).includes(c)
  const proximaData = (c) => (rodizio?.proximos || []).find((p) => p.chave === c)?.data
  const fmtAbre = (iso) => {
    if (!iso) return 'em breve'
    const [a, m, d] = String(iso).slice(0, 10).split('-').map(Number)
    const dt = new Date(a, m - 1, d)
    return ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'][dt.getDay()] + ' ' + String(d).padStart(2, '0') + '/' + String(m).padStart(2, '0')
  }

  // Progresso pro bônus do dia: o conjunto EXIGIDO vem do servidor (exclui o
  // que nem todo aparelho roda, ex. Pênaltis sem WebGL) — assim o contador e o
  // pagamento sempre batem. Sem o SQL do rodízio, vale a regra antiga (+50).
  const valorBonus = rodizio ? (rodizio.valor_bonus ?? (rodizioOn ? 20 : 50)) : 50
  const jogosDiarios = rodizio
    ? (rodizio.exigidos || rodizio.hoje || []).filter((c) => JOGOS[c])
    : jogosAtivos.filter((c) => !ARCADE.has(c))
  const feitosHoje = jogosDiarios.filter((c) => jogadosHoje.includes(c))
  const completouDia = jogosDiarios.length > 0 && feitosHoje.length >= jogosDiarios.length

  // Rede de segurança: se completou o dia mas o bônus não saiu (ex.: falhou a
  // chamada no fim do último jogo), tenta de novo ao abrir (o servidor dá 1x/dia).
  useEffect(() => {
    if (completouDia) bonusTodosJogos().then((b) => { if (b?.ganhou > 0) { festa(3); setBonusDia(b.ganhou) } }).catch(() => {})
  }, [completouDia]) // eslint-disable-line

  return (
    <div>
      <FeedbackJogo />
      <div className="mb-4">
        <h2 className="text-2xl font-extrabold text-ink">🎮 Jogos</h2>
        <p className="text-sm text-muted">
          {rodizioOn ? 'Cada dia 3 jogos abrem — jogue os de hoje e ganhe o bônus! 🎁' : 'Jogue e ganhe estrelas! Dá pra jogar todos, 1x cada por dia ⭐'}
        </p>
      </div>

      <div className="bg-surface rounded-xl p-1 flex shadow-sm mb-4 max-w-xs">
        {[['trilha', '🎮 Jogar'], ['ranking', '🏆 Ranking']].map(([k, lbl]) => (
          <button key={k} onClick={() => setAba(k)}
            className={`flex-1 rounded-lg py-2 text-sm font-bold transition-colors ${aba === k ? 'bg-brand text-white' : 'text-muted'}`}>{lbl}</button>
        ))}
      </div>

      {aba === 'ranking' ? (
        <RankingTrilha dados={ranking} carregando={carregandoRank} meuId={profile?.id}
          ehAdmin={['instrutor', 'diretoria'].includes(profile?.papel)} />
      ) : carregando ? (
        <p className="text-faint text-sm">Carregando...</p>
      ) : jogando ? (
        (() => {
          const Jogo = JOGOS[jogoAtual]?.Comp || JogoMemoria
          // No PC o jogo fica centralizado num cartão, sem esticar a tela toda
          return (
            <motion.div key={jogoAtual} initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }}
              className={`${jogoAtual === 'corrida' ? 'max-w-3xl' : 'max-w-md'} mx-auto`}>
              <div className="text-center mb-2">
                <span className="inline-flex items-center gap-2 bg-surface rounded-full shadow-sm px-4 py-1.5 text-sm font-extrabold text-ink">
                  {JOGOS[jogoAtual]?.emoji} {JOGOS[jogoAtual]?.nome}
                </span>
              </div>
              <JogoBoundary Reserva={RESERVAS[jogoAtual]} onTerminar={aoTerminar} onCancelar={() => setJogando(false)}>
                <Suspense fallback={<p className="text-faint text-sm text-center py-10">Carregando o jogo…</p>}>
                  <Jogo onTerminar={aoTerminar} onCancelar={() => setJogando(false)} />
                </Suspense>
              </JogoBoundary>
            </motion.div>
          )
        })()
      ) : (
        <div>
          {pedidosAjuda.length > 0 && (
            <button onClick={() => setCaixaAjuda(true)}
              className="w-full mb-3 flex items-center gap-3 rounded-2xl bg-brand/10 border border-brand/20 p-3 text-left">
              <span className="text-2xl shrink-0">🆘</span>
              <div className="flex-1 min-w-0">
                <p className="font-extrabold text-brand text-sm">
                  {pedidosAjuda.length} amigo{pedidosAjuda.length > 1 ? 's' : ''} precisa{pedidosAjuda.length > 1 ? 'm' : ''} de ajuda!
                </p>
                <p className="text-xs text-muted">Toque pra ajudar e ganhar +5 🤝</p>
              </div>
            </button>
          )}
          {resultado && <ResultadoCard resultado={resultado} />}

          {bonusDia > 0 && (
            <div className="bg-gold/15 border-2 border-gold rounded-2xl p-4 text-center mb-3 relative">
              <button onClick={() => setBonusDia(0)} className="absolute top-1.5 right-3 text-faint text-xl leading-none p-1">×</button>
              <div className="text-4xl mb-1">🎁</div>
              <p className="font-extrabold text-ink">Você completou TODOS os jogos de hoje!</p>
              <p className="text-sm font-extrabold text-gold mt-0.5">+{bonusDia} de bônus! 🎉</p>
            </div>
          )}

          {jogosDiarios.length > 0 && (
            <div className={`rounded-2xl p-3 mb-3 border ${completouDia ? 'bg-green-50 border-green-200' : 'bg-brand/5 border-brand/20'}`}>
              <div className="flex items-center justify-between text-sm gap-2">
                <span className="font-bold text-ink">
                  {completouDia ? `✅ Jogos do dia completos! +${valorBonus} 🎁` : `🎮 Jogos do dia: ${feitosHoje.length}/${jogosDiarios.length}`}
                </span>
                {!completouDia && <span className="text-[11px] text-muted shrink-0">complete todos = +{valorBonus} 🎁</span>}
              </div>
              <div className="h-2 bg-surface2 rounded-full overflow-hidden mt-2">
                <div className="h-full bg-brand rounded-full transition-all" style={{ width: `${Math.round((100 * feitosHoje.length) / jogosDiarios.length)}%` }} />
              </div>
            </div>
          )}

          {jogosAtivos.length === 0 ? (
            <div className="bg-amber-50 border border-amber-200 rounded-2xl p-6 text-center">
              <div className="text-4xl mb-2">🎮</div>
              <p className="font-semibold text-ink">Nenhum jogo ativo agora</p>
              <p className="text-sm text-muted mt-1">A liderança liga os jogos em Gestão → 🎮 Jogos da Trilha.</p>
            </div>
          ) : semJogos ? (
            <div className="bg-surface rounded-2xl p-6 shadow-sm text-center">
              <div className="text-5xl mb-2">🏆</div>
              <p className="font-bold text-ink">Você jogou todos os jogos de hoje!</p>
              <p className="text-sm text-faint mt-1">Volte amanhã pra jogar de novo 🙂</p>
            </div>
          ) : (
            <>
              <div className="text-center mb-3">
                <p className="font-bold text-ink">Escolha um jogo 🎮</p>
                <p className="text-sm text-faint mt-1">
                  {rodizioOn ? 'Os jogos com 🔒 abrem no dia deles. ' : 'Cada jogo, 1x por dia. '}
                  Cada ⭐ vale 5 pontos: <b>1⭐=5</b> · <b>2⭐=10</b> · <b>3⭐=15</b>.
                </p>
              </div>

              {jogoSemana && JOGOS[jogoSemana] && (() => {
                const semanaJogado = jogadosHoje.includes(jogoSemana)
                const semanaAberto = abertoHoje(jogoSemana)
                const semanaTravado = semanaJogado || !semanaAberto
                return (
                  <motion.button whileTap={semanaTravado ? undefined : { scale: 0.98 }} disabled={semanaTravado}
                    onClick={() => {
                      if (jogosAtivos.includes(jogoSemana)) {
                        abrirJogo(jogoSemana)
                      }
                    }}
                    className={`w-full text-left rounded-2xl p-3.5 mb-3 bg-amber-50 border-2 border-gold flex items-center gap-3 ${semanaTravado ? 'opacity-70' : ''}`}>
                    <span className={`text-3xl shrink-0 ${!semanaAberto ? 'grayscale' : ''}`}>{JOGOS[jogoSemana].emoji}</span>
                    <div className="flex-1 min-w-0">
                      <div className="text-[11px] font-extrabold text-gold uppercase tracking-wide">🎲 Jogo da semana</div>
                      <div className="font-extrabold text-ink leading-tight">{JOGOS[jogoSemana].nome}</div>
                      <div className="text-xs text-muted">
                        {semanaJogado ? '✓ Jogado hoje — volte amanhã! Quem fizer mais estrelas até domingo leva +20 🏆'
                          : !semanaAberto ? <>🔒 Abre <b>{fmtAbre(proximaData(jogoSemana))}</b> — ou peça pra liderança liberar</>
                          : <>Quem fizer mais estrelas nele até domingo leva <b>+20</b> 🏆</>}
                      </div>
                    </div>
                  </motion.button>
                )
              })()}

              {rodizioOn && (rodizio.hoje || []).some((c) => JOGOS[c]) && (
                <div className="rounded-2xl p-3.5 mb-3 bg-brand/5 border-2 border-brand/30">
                  <div className="text-[11px] font-extrabold text-brand uppercase tracking-wide">🥇 Jogos do dia</div>
                  <p className="text-xs text-muted mt-0.5 mb-2">
                    O melhor de cada um leva <b>+10</b> amanhã cedo (empate: quem jogou primeiro).
                    Jogue os {jogosDiarios.length} e ganhe <b>+{valorBonus}</b> de bônus! 🎁
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {(rodizio.hoje || []).map((chave) => {
                      const j = JOGOS[chave]
                      if (!j) return null
                      const feito = jogadosHoje.includes(chave)
                      return (
                        <motion.button key={chave} whileTap={feito ? undefined : { scale: 0.95 }} disabled={feito}
                          onClick={() => abrirJogo(chave)}
                          className={`text-sm font-bold rounded-full px-3.5 py-2 ${feito ? 'bg-surface2 text-faint' : 'bg-gradient-to-r from-brand to-brand2 text-white shadow-glow'}`}>
                          {j.emoji} {j.curto}{feito ? ' ✓' : ''}
                        </motion.button>
                      )
                    })}
                  </div>
                </div>
              )}

              <div className="grid sm:grid-cols-2 gap-2.5">
                {jogosAtivos.map((chave) => {
                  const j = JOGOS[chave]
                  if (!j) return null
                  const jogado = jogadosHoje.includes(chave) && !ARCADE.has(chave)
                  const aberto = abertoHoje(chave)
                  const doDia = (rodizio?.hoje || []).includes(chave)
                  const liberado = (rodizio?.liberados || []).includes(chave)
                  const travado = jogado || !aberto
                  return (
                    <div key={chave} className="relative">
                      <motion.button disabled={travado}
                        whileTap={travado ? undefined : { scale: 0.97 }} whileHover={travado ? undefined : { y: -3 }}
                        onClick={() => abrirJogo(chave)}
                        className={`w-full rounded-2xl p-3.5 shadow-sm flex items-center gap-3 text-left ${travado ? 'bg-surface2 opacity-70' : 'bg-surface'} ${ARCADE.has(chave) ? 'ring-2 ring-gold' : doDia ? 'ring-2 ring-brand/50' : ''}`}>
                        <span className={`w-12 h-12 rounded-2xl grid place-items-center text-2xl shrink-0 ${travado ? 'bg-surface2' : 'bg-gradient-to-br from-brand/10 to-gold/20'} ${!aberto ? 'grayscale' : ''}`}>
                          {j.emoji}
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="font-bold text-ink leading-tight">{doDia ? '🥇 ' : ''}{j.nome}</div>
                          <div className="text-[11px] text-faint leading-snug mt-0.5">
                            {aberto ? j.desc : <>🔒 Abre <b>{fmtAbre(proximaData(chave))}</b> — ou peça pra liderança liberar</>}
                          </div>
                        </div>
                        {ARCADE.has(chave)
                          ? <span className="bg-gold text-brand font-extrabold shrink-0 text-xs rounded-full px-2.5 py-1.5">🚀 Recorde</span>
                          : jogado
                          ? <span className="text-green-600 font-extrabold shrink-0 text-xs">✓ jogado</span>
                          : !aberto
                          ? <span className="text-faint font-extrabold shrink-0 text-base">🔒</span>
                          : <span className="bg-brand text-white font-extrabold shrink-0 text-xs rounded-full px-2.5 py-1.5">⭐ 5-15</span>}
                      </motion.button>
                      {ehAdmin && rodizio && !aberto && (
                        <button onClick={() => alternarLiberacao(chave, true)}
                          className="absolute -top-2 -right-2 z-10 text-xs font-extrabold bg-gold text-ink rounded-full px-3 py-2 shadow">🔓 Liberar hoje</button>
                      )}
                      {ehAdmin && liberado && (
                        <button onClick={() => alternarLiberacao(chave, false)}
                          className="absolute -top-2 -right-2 z-10 text-xs font-extrabold bg-surface border border-line text-muted rounded-full px-3 py-2 shadow">🔒 Trancar</button>
                      )}
                    </div>
                  )
                })}
              </div>
            </>
          )}
        </div>
      )}

      {caixaAjuda && (
        <CaixaAjuda pedidos={pedidosAjuda} aoFechar={() => setCaixaAjuda(false)}
          aoResolvido={(id) => setPedidosAjuda((ps) => ps.filter((p) => p.id !== id))} />
      )}
    </div>
  )
}
