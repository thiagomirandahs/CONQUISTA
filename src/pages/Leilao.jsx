import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useAuth } from '../context/Auth.jsx'
import {
  carregarLeilao, saldoLeilaoUnidade, pontosTemporadaUnidade,
  darLance, confirmarLanceConjunto, recusarLanceConjunto, criarLeilao, encerrarLeilao, cancelarLeilao,
} from '../lib/dados.js'
import { vitoria as festa, acerto } from '../lib/juice.js'

const PODE_GERIR = ['instrutor', 'diretoria']
// Só quem de fato compete pela unidade dá lance — diretoria/instrutor/tesoureiro
// não jogam os jogos que geram os pontos (mesmo que estejam ligados a alguma
// unidade, ex.: a unidade "Liderança" ou um conselheiro promovido).
const PODE_LEILOAR = ['desbravador', 'conselheiro']
const inputClass =
  'w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 outline-none transition focus:border-azul-claro focus:ring-2 focus:ring-azul-claro/30'

const ITENS_PADRAO = [
  { nome: 'Dormitório', emoji: '🏕️', descricao: 'Escolhe onde vai dormir no próximo acampamento', preco_base: 4800, incremento_minimo: 300 },
  { nome: 'Vale Ajuda', emoji: '🆘', descricao: 'Um "vale" pra pedir uma ajudinha quando precisar', preco_base: 3000, incremento_minimo: 180 },
  { nome: 'Poder de Trocar a Pergunta', emoji: '🔄', descricao: 'Troca uma pergunta difícil por uma fácil', preco_base: 2400, incremento_minimo: 120 },
  { nome: 'Poder Supremo', emoji: '👑', descricao: 'Um poder especial — combine com a liderança', preco_base: 2100, incremento_minimo: 120 },
  { nome: 'Caixa Misteriosa', emoji: '🎁', descricao: 'Ninguém sabe o que tem dentro...', preco_base: 1800, incremento_minimo: 60 },
]

function tempoRestante(fechaEm) {
  const ms = new Date(fechaEm).getTime() - Date.now()
  if (ms <= 0) return 'encerrando...'
  const s = Math.floor(ms / 1000)
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  const seg = s % 60
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m}min`
  if (m > 0) return `${m}min ${seg}s`
  return `${seg}s`
}

function tempoRel(iso) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000
  if (s < 60) return 'agora'
  if (s < 3600) return Math.floor(s / 60) + ' min atrás'
  if (s < 86400) return Math.floor(s / 3600) + ' h atrás'
  return Math.floor(s / 86400) + ' d atrás'
}

export default function Leilao() {
  const { profile } = useAuth()
  const ehAdmin = PODE_GERIR.includes(profile?.papel)
  const podeLeiloar = PODE_LEILOAR.includes(profile?.papel)
  const minhaUni = podeLeiloar ? (profile?.unidade_id || null) : null

  const [dados, setDados] = useState({ leilao: null, itens: [], unidades: [] })
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState('')
  const [saldo, setSaldo] = useState(0)
  const [pontos, setPontos] = useState(0)
  const [, forcaRender] = useState(0)
  const [criando, setCriando] = useState(false)
  const [lanceDe, setLanceDe] = useState(null) // item em que estou dando lance
  const [processando, setProcessando] = useState(false)

  async function buscarDados() {
    const d = await carregarLeilao()
    setDados(d)
    if (minhaUni) {
      const [s, p] = await Promise.all([saldoLeilaoUnidade(minhaUni), pontosTemporadaUnidade(minhaUni)])
      setSaldo(s); setPontos(p)
    }
  }
  async function carregar() {
    setCarregando(true); setErro('')
    try { await buscarDados() } catch (e) { setErro(e?.message || 'Erro') }
    setCarregando(false)
  }
  // Atualização de fundo (poll/foco): mesma busca, mas SEM mostrar "Carregando..."
  // de novo — senão a tela piscaria e fecharia qualquer histórico aberto.
  async function atualizarSilencioso() {
    try { await buscarDados() } catch { /* falha silenciosa — mantém o que já tinha na tela */ }
  }
  useEffect(() => { carregar() }, []) // eslint-disable-line

  // Relógio do leilão (recalcula o texto a cada segundo enquanto está aberto)
  useEffect(() => {
    if (dados.leilao?.status !== 'aberto') return
    const t = setInterval(() => forcaRender((n) => n + 1), 1000)
    return () => clearInterval(t)
  }, [dados.leilao?.status])

  // Acompanhamento ao vivo: enquanto está aberto, busca de novo sozinho (a cada
  // 15s) e também ao voltar o foco na aba/app — pra ver o lance dos outros sem
  // precisar recarregar a página. É o que dá o clima de disputa ao vivo.
  useEffect(() => {
    if (dados.leilao?.status !== 'aberto') return
    const t = setInterval(atualizarSilencioso, 15000)
    const foco = () => { if (document.visibilityState === 'visible') atualizarSilencioso() }
    window.addEventListener('focus', foco)
    document.addEventListener('visibilitychange', foco)
    return () => { clearInterval(t); window.removeEventListener('focus', foco); document.removeEventListener('visibilitychange', foco) }
  }, [dados.leilao?.status]) // eslint-disable-line

  if (carregando) return <p className="text-slate-400 text-sm">Carregando leilão...</p>

  if (erro) {
    const faltaSQL = /does not exist|schema cache|could not find the (table|relation)/i.test(erro)
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 text-sm text-amber-800">
        {faltaSQL ? (
          <>
            <p className="font-semibold mb-1">Leilão ainda não configurado</p>
            <p className="text-xs">Rode <code className="bg-amber-100 rounded px-1">supabase/2026-08-18-leilao.sql</code> no Supabase.</p>
          </>
        ) : (
          <>
            <p className="font-semibold mb-1">Não deu pra carregar o leilão</p>
            <p className="text-xs mb-3">{erro}</p>
            <button onClick={carregar} className="bg-amber-600 text-white font-bold rounded-xl px-4 py-2 text-xs">Tentar de novo</button>
          </>
        )}
      </div>
    )
  }

  const { leilao, itens, unidades } = dados
  const aberto = leilao?.status === 'aberto'

  // Convites de lance conjunto esperando minha unidade confirmar (em qualquer item)
  const convitesPendentes = aberto && minhaUni
    ? itens.flatMap((it) => (it.pendentes || [])
        .filter((l) => l.unidades.some((u) => u.id === minhaUni && !u.confirmado))
        .map((l) => ({ ...l, item: it })))
    : []

  async function confirmar(lance) {
    setProcessando(true)
    try {
      const r = await confirmarLanceConjunto(lance.id)
      if (r?.ativado) { acerto(3); alert('Confirmado! Seu lance conjunto está ativo agora. 🤝') }
      else if (r?.motivo) alert(r.motivo)
      else alert('Confirmado! Falta outra unidade aceitar pra valer.')
      await carregar()
    } catch (e) { alert(e?.message || e) }
    setProcessando(false)
  }

  async function recusar(lance) {
    if (!window.confirm('Recusar esse convite? O lance conjunto inteiro cai.')) return
    setProcessando(true)
    try {
      await recusarLanceConjunto(lance.id)
      await carregar()
    } catch (e) { alert(e?.message || e) }
    setProcessando(false)
  }

  async function encerrarAgora() {
    if (!window.confirm('Encerrar o leilão agora? Cada item vai pra quem estiver na frente.')) return
    setProcessando(true)
    try { await encerrarLeilao(leilao.id); festa(3); await carregar() }
    catch (e) { alert(e?.message || e) }
    setProcessando(false)
  }
  async function cancelarAgora() {
    if (!window.confirm('Cancelar este leilão? Ninguém perde pontos.')) return
    setProcessando(true)
    try { await cancelarLeilao(leilao.id); await carregar() }
    catch (e) { alert(e?.message || e) }
    setProcessando(false)
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-extrabold text-slate-800">🏛️ Leilão</h2>
          <p className="text-sm text-slate-500">Junte pontos com sua unidade e dê o maior lance!</p>
        </div>
        {ehAdmin && !leilao && (
          <motion.button whileTap={{ scale: 0.97 }} onClick={() => setCriando(true)}
            className="bg-azul text-white font-bold rounded-xl px-4 py-2.5 text-sm shrink-0">
            + Criar leilão
          </motion.button>
        )}
      </div>

      {!leilao ? (
        <div className="bg-white rounded-2xl p-8 text-center shadow-sm">
          <div className="text-4xl mb-2">🏛️</div>
          <p className="font-semibold text-slate-700">Nenhum leilão ainda</p>
          <p className="text-sm text-slate-400">{ehAdmin ? 'Crie o primeiro leilão do clube!' : 'A liderança ainda vai abrir um leilão.'}</p>
        </div>
      ) : (
        <>
          <div className={`rounded-2xl p-4 mb-4 flex items-center justify-between gap-3 ${
            aberto ? 'bg-azul text-white' : leilao.status === 'encerrado' ? 'bg-green-50 border border-green-200' : 'bg-slate-100 border border-slate-200'
          }`}>
            <div className="min-w-0">
              <div className={`font-extrabold truncate ${aberto ? '' : 'text-slate-800'}`}>{leilao.titulo}</div>
              <div className={`text-xs mt-0.5 ${aberto ? 'text-blue-100' : 'text-slate-500'}`}>
                {aberto ? `⏳ Fecha em ${tempoRestante(leilao.fecha_em)}` : leilao.status === 'encerrado' ? '✅ Encerrado' : '✖ Cancelado'}
              </div>
            </div>
            {ehAdmin && aberto && (
              <div className="flex gap-2 shrink-0">
                <button disabled={processando} onClick={encerrarAgora}
                  className="bg-white/20 hover:bg-white/30 text-white font-bold rounded-lg px-3 py-2 text-xs disabled:opacity-50">
                  Encerrar agora
                </button>
                <button disabled={processando} onClick={cancelarAgora}
                  className="bg-white/10 hover:bg-white/20 text-white/90 font-bold rounded-lg px-3 py-2 text-xs disabled:opacity-50">
                  Cancelar
                </button>
              </div>
            )}
            {ehAdmin && !aberto && (
              <motion.button whileTap={{ scale: 0.97 }} onClick={() => setCriando(true)}
                className="bg-azul text-white font-bold rounded-lg px-3 py-2 text-xs shrink-0">
                + Novo leilão
              </motion.button>
            )}
          </div>

          {aberto && minhaUni && (
            <div className="bg-dourado/10 border border-dourado/30 rounded-2xl p-3 mb-4 flex items-center justify-between">
              <div>
                <div className="text-xs text-slate-500">Sua unidade tem disponível</div>
                <div className="font-extrabold text-slate-800">{saldo} pontos <span className="font-normal text-slate-400 text-xs">de {pontos} no total</span></div>
              </div>
              <div className="text-3xl">💰</div>
            </div>
          )}
          {aberto && !minhaUni && (
            <p className="text-xs text-slate-400 mb-3">
              {podeLeiloar
                ? 'Você precisa estar numa unidade (com cadastro aprovado) pra dar lance.'
                : 'Só desbravadores e conselheiros dão lance no leilão — acompanhe a disputa das unidades abaixo 👇'}
            </p>
          )}

          {convitesPendentes.length > 0 && (
            <div className="mb-4 space-y-2">
              {convitesPendentes.map((l) => {
                const outras = l.unidades.filter((u) => u.id !== minhaUni)
                return (
                  <div key={l.id} className="bg-amber-50 border border-amber-200 rounded-2xl p-3 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-xs font-bold text-amber-700">🤝 Convite de lance conjunto</div>
                      <div className="text-sm text-slate-700">
                        <b>{l.item.nome}</b> por <b>{l.valor}</b> pts, com {outras.map((u) => u.nome).join(', ') || 'outra unidade'}
                      </div>
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <motion.button whileTap={{ scale: 0.97 }} disabled={processando} onClick={() => confirmar(l)}
                        className="bg-amber-600 text-white font-bold rounded-lg px-3 py-2 text-xs disabled:opacity-50">
                        Confirmar
                      </motion.button>
                      <motion.button whileTap={{ scale: 0.97 }} disabled={processando} onClick={() => recusar(l)}
                        className="bg-white border border-amber-300 text-amber-700 font-bold rounded-lg px-3 py-2 text-xs disabled:opacity-50">
                        Recusar
                      </motion.button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          <div className="space-y-3">
            {itens.map((it) => (
              <ItemCard key={it.id} item={it} aberto={aberto} podeDarLance={aberto && !!minhaUni}
                onDarLance={() => setLanceDe(it)} />
            ))}
          </div>
        </>
      )}

      <AnimatePresence>
        {criando && (
          <ModalCriarLeilao onFechar={() => setCriando(false)} onCriado={() => { setCriando(false); carregar() }} />
        )}
        {lanceDe && (
          <ModalLance item={lanceDe} unidades={unidades} minhaUni={minhaUni} saldo={saldo}
            onFechar={() => setLanceDe(null)}
            onDado={() => { setLanceDe(null); carregar() }} />
        )}
      </AnimatePresence>
    </div>
  )
}

function ItemCard({ item, aberto, podeDarLance, onDarLance }) {
  const atual = item.atual
  const proximoMinimo = atual ? atual.valor + item.incremento_minimo : item.preco_base
  const [verHistorico, setVerHistorico] = useState(false)
  // Histórico público: só lances que já valeram de verdade (não os pendentes,
  // que ainda estão sendo combinados e só aparecem pra unidade convidada).
  const historico = (item.lances || [])
    .filter((l) => l.status !== 'pendente')
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))

  return (
    <motion.div layout className="bg-white rounded-2xl p-4 shadow-sm">
      <div className="flex items-start gap-3">
        <span className="text-3xl shrink-0">{item.emoji || '🎁'}</span>
        <div className="flex-1 min-w-0">
          <div className="font-extrabold text-slate-800">{item.nome}</div>
          {item.descricao && <div className="text-xs text-slate-500 mt-0.5">{item.descricao}</div>}

          {atual ? (
            <div className="mt-2 flex items-center gap-2 flex-wrap">
              <span className={`text-xs font-bold px-2 py-1 rounded-full ${atual.status === 'vencedor' ? 'bg-green-100 text-green-700' : 'bg-dourado/15 text-amber-700'}`}>
                {atual.status === 'vencedor' ? '🏆 Venceu' : '👑 Na frente'}: {atual.valor} pts
              </span>
              {atual.unidades.map((u, i) => (
                <span key={i} className="text-xs font-semibold px-2 py-1 rounded-full text-white" style={{ background: u.cor || '#1e3a8a' }}>
                  {u.nome}
                </span>
              ))}
            </div>
          ) : (
            <div className="mt-2 text-xs text-slate-400">
              {aberto
                ? <>Nenhum lance ainda · mínimo <b>{item.preco_base}</b> pts</>
                : 'Ninguém deu lance neste item.'}
            </div>
          )}

          {historico.length > 0 && (
            <button onClick={() => setVerHistorico((v) => !v)}
              className="mt-2 text-[11px] font-semibold text-azul flex items-center gap-1">
              {verHistorico ? '▲ Esconder' : '▼ Ver'} disputa ({historico.length} lance{historico.length > 1 ? 's' : ''})
            </button>
          )}
          <AnimatePresence>
            {verHistorico && (
              <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
                className="overflow-hidden">
                <div className="mt-2 space-y-1.5 border-t border-slate-100 pt-2">
                  {historico.map((l) => (
                    <div key={l.id} className="flex items-center justify-between gap-2 text-xs">
                      <div className="flex items-center gap-1.5 min-w-0 flex-wrap">
                        {l.unidades.map((u, i) => (
                          <span key={i} className="font-bold px-1.5 py-0.5 rounded text-white text-[10px]" style={{ background: u.cor || '#1e3a8a' }}>
                            {u.nome}
                          </span>
                        ))}
                        <span className={l.status === 'superado' ? 'text-slate-400 line-through' : 'font-bold text-slate-700'}>
                          {l.valor} pts
                        </span>
                      </div>
                      <span className="text-slate-400 shrink-0">{tempoRel(l.created_at)}</span>
                    </div>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
      {podeDarLance && (
        <motion.button whileTap={{ scale: 0.97 }} onClick={onDarLance}
          className="mt-3 w-full bg-azul text-white font-bold rounded-xl py-2.5 text-sm">
          Dar lance (mín. {proximoMinimo} pts)
        </motion.button>
      )}
    </motion.div>
  )
}

function ModalLance({ item, unidades, minhaUni, saldo, onFechar, onDado }) {
  const proximoMinimo = item.atual ? item.atual.valor + item.incremento_minimo : item.preco_base
  const [valor, setValor] = useState(proximoMinimo)
  const [convidadas, setConvidadas] = useState([])
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState('')
  const outrasUnidades = unidades.filter((u) => u.id !== minhaUni)

  function alternar(id) {
    setConvidadas((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]))
  }

  async function enviar() {
    setErro('')
    const v = Math.round(Number(valor))
    if (!v || v < proximoMinimo) { setErro(`O lance mínimo agora é ${proximoMinimo} pontos.`); return }
    setEnviando(true)
    try {
      const r = await darLance(item.id, v, convidadas)
      acerto(2)
      if (r?.pendente) alert('Lance registrado! Falta a(s) outra(s) unidade(s) convidada(s) confirmar pra valer.')
      onDado()
    } catch (e) { setErro(e?.message || String(e)) }
    setEnviando(false)
  }

  return (
    <motion.div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onFechar}>
      <motion.div onClick={(e) => e.stopPropagation()}
        initial={{ y: 30, opacity: 0, scale: 0.97 }} animate={{ y: 0, opacity: 1, scale: 1 }} exit={{ y: 30, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 320, damping: 28 }}
        className="bg-white w-full max-w-sm rounded-3xl shadow-2xl max-h-[85vh] overflow-y-auto">
        <div className="p-5">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-2xl">{item.emoji}</span>
            <span className="font-extrabold text-slate-800">{item.nome}</span>
          </div>
          <p className="text-xs text-slate-400 mb-4">Sua unidade tem {saldo} pontos disponíveis agora.</p>

          <label className="block text-sm font-semibold text-slate-700 mb-1">Seu lance (mín. {proximoMinimo})</label>
          <input type="number" min={proximoMinimo} step={item.incremento_minimo} value={valor}
            onChange={(e) => setValor(e.target.value)} className={inputClass} />

          {outrasUnidades.length > 0 && (
            <div className="mt-4">
              <p className="text-sm font-semibold text-slate-700 mb-2">Juntar com outra(s) unidade(s)? (opcional)</p>
              <div className="flex flex-wrap gap-2">
                {outrasUnidades.map((u) => (
                  <button key={u.id} type="button" onClick={() => alternar(u.id)}
                    className={`text-xs font-bold px-3 py-1.5 rounded-full border transition ${
                      convidadas.includes(u.id) ? 'text-white border-transparent' : 'bg-white text-slate-600 border-slate-200'
                    }`}
                    style={convidadas.includes(u.id) ? { background: u.cor || '#1e3a8a' } : {}}>
                    {u.nome}
                  </button>
                ))}
              </div>
              {convidadas.length > 0 && (
                <p className="text-[11px] text-slate-400 mt-2">
                  Esse lance só entra na disputa depois que alguém de cada unidade convidada confirmar
                  (ela recebe o convite na tela do leilão). Se vencerem, os pontos são rateados proporcional
                  ao total de cada unidade.
                </p>
              )}
            </div>
          )}

          {erro && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3 mt-4">{erro}</div>}

          <div className="flex gap-2 mt-5">
            <button onClick={onFechar} className="flex-1 rounded-xl bg-slate-100 text-slate-700 font-semibold py-2.5">Cancelar</button>
            <motion.button onClick={enviar} disabled={enviando} whileTap={{ scale: 0.97 }}
              className="flex-1 rounded-xl bg-azul text-white font-extrabold py-2.5 disabled:opacity-60">
              {enviando ? '...' : '🔨 Dar lance'}
            </motion.button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  )
}

function ModalCriarLeilao({ onFechar, onCriado }) {
  const amanha = new Date(Date.now() + 24 * 3600 * 1000)
  amanha.setMinutes(amanha.getMinutes() - amanha.getTimezoneOffset())
  const [titulo, setTitulo] = useState('Leilão do Clube')
  const [fechaEm, setFechaEm] = useState(amanha.toISOString().slice(0, 16))
  const [itens, setItens] = useState(ITENS_PADRAO.map((i) => ({ ...i })))
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState('')

  function mudarItem(i, campo, valor) {
    setItens((arr) => arr.map((it, idx) => (idx === i ? { ...it, [campo]: valor } : it)))
  }

  async function enviar() {
    setErro('')
    if (!titulo.trim()) { setErro('Dê um título ao leilão.'); return }
    if (!fechaEm) { setErro('Escolha quando o leilão fecha.'); return }
    if (itens.some((i) => !i.nome.trim())) { setErro('Todo item precisa de um nome.'); return }
    setEnviando(true)
    try {
      await criarLeilao(titulo.trim(), new Date(fechaEm).toISOString(),
        itens.map((i) => ({ ...i, preco_base: Number(i.preco_base) || 0, incremento_minimo: Number(i.incremento_minimo) || 5 })))
      onCriado()
    } catch (e) { setErro(e?.message || String(e)) }
    setEnviando(false)
  }

  return (
    <motion.div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onFechar}>
      <motion.div onClick={(e) => e.stopPropagation()}
        initial={{ y: 30, opacity: 0, scale: 0.97 }} animate={{ y: 0, opacity: 1, scale: 1 }} exit={{ y: 30, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 320, damping: 28 }}
        className="bg-white w-full max-w-md rounded-3xl shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="p-5">
          <h3 className="font-extrabold text-slate-800 text-lg mb-4">🏛️ Criar leilão</h3>

          <label className="block text-sm font-semibold text-slate-700 mb-1">Título</label>
          <input value={titulo} onChange={(e) => setTitulo(e.target.value)} className={inputClass} />

          <label className="block text-sm font-semibold text-slate-700 mb-1 mt-3">Fecha em</label>
          <input type="datetime-local" value={fechaEm} onChange={(e) => setFechaEm(e.target.value)} className={inputClass} />

          <p className="text-sm font-semibold text-slate-700 mb-2 mt-4">Itens (ajuste o preço-base de cada um)</p>
          <div className="space-y-3">
            {itens.map((it, i) => (
              <div key={i} className="bg-slate-50 rounded-xl p-3">
                <div className="flex gap-2">
                  <input value={it.emoji} onChange={(e) => mudarItem(i, 'emoji', e.target.value)}
                    className={inputClass + ' w-14 text-center text-lg'} maxLength={4} />
                  <input value={it.nome} onChange={(e) => mudarItem(i, 'nome', e.target.value)}
                    className={inputClass + ' flex-1'} placeholder="Nome do item" />
                </div>
                <input value={it.descricao} onChange={(e) => mudarItem(i, 'descricao', e.target.value)}
                  className={inputClass + ' mt-2 text-sm'} placeholder="Descrição (opcional)" />
                <div className="flex gap-2 mt-2">
                  <div className="flex-1">
                    <label className="text-[11px] text-slate-400">Preço-base</label>
                    <input type="number" min={0} value={it.preco_base}
                      onChange={(e) => mudarItem(i, 'preco_base', e.target.value)} className={inputClass} />
                  </div>
                  <div className="flex-1">
                    <label className="text-[11px] text-slate-400">Incremento mín.</label>
                    <input type="number" min={1} value={it.incremento_minimo}
                      onChange={(e) => mudarItem(i, 'incremento_minimo', e.target.value)} className={inputClass} />
                  </div>
                </div>
              </div>
            ))}
          </div>

          {erro && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3 mt-4">{erro}</div>}

          <div className="flex gap-2 mt-5">
            <button onClick={onFechar} className="flex-1 rounded-xl bg-slate-100 text-slate-700 font-semibold py-2.5">Cancelar</button>
            <motion.button onClick={enviar} disabled={enviando} whileTap={{ scale: 0.97 }}
              className="flex-1 rounded-xl bg-azul text-white font-extrabold py-2.5 disabled:opacity-60">
              {enviando ? '...' : '🏛️ Abrir leilão'}
            </motion.button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  )
}
