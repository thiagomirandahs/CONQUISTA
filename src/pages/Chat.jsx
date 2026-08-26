import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useAuth } from '../context/Auth.jsx'
import { supabase } from '../lib/supabase.js'
import Avatar from '../components/Avatar.jsx'
import {
  carregarChatUnidade, carregarChatGeral, carregarMinhasConversasDiretas, carregarMensagensDireta,
  listarColegasChat, enviarMensagemUnidade, enviarMensagemGeral, enviarMensagemDireta,
} from '../lib/dados.js'
import { acerto } from '../lib/juice.js'

// Quem manda mensagem no chat da unidade / conversas diretas.
const MEMBRO = ['desbravador', 'conselheiro']
// Liderança: além de auditar tudo, também conversa no chat Geral.
const LIDERANCA = ['instrutor', 'diretoria', 'tesoureiro']

function tempoRel(iso) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000
  if (s < 60) return 'agora'
  if (s < 3600) return Math.floor(s / 60) + ' min'
  if (s < 86400) return Math.floor(s / 3600) + ' h'
  return Math.floor(s / 86400) + ' d'
}

export default function Chat() {
  const { profile } = useAuth()
  const ehMembro = MEMBRO.includes(profile?.papel)
  const ehLideranca = LIDERANCA.includes(profile?.papel)
  const podeUsar = ehMembro || ehLideranca
  // Todo mundo tem o Geral; membros ainda têm Unidade e Conversas diretas.
  const abas = ehMembro
    ? [['geral', '📣 Geral'], ['unidade', '🏠 Minha Unidade'], ['conversas', '💬 Conversas']]
    : [['geral', '📣 Geral']]
  const [aba, setAba] = useState('geral')
  const [conversaDireta, setConversaDireta] = useState(null) // {conversaId, outro} ou null (lista)
  const [escolhendo, setEscolhendo] = useState(false)

  if (!podeUsar) {
    return (
      <div className="bg-white rounded-2xl p-8 text-center shadow-sm">
        <div className="text-4xl mb-2">🔒</div>
        <p className="font-semibold text-slate-700">O chat é pra desbravadores, conselheiros e liderança</p>
        <p className="text-sm text-slate-400">Fale com a liderança se algo parecer errado.</p>
      </div>
    )
  }

  return (
    <div>
      <div className="mb-4">
        <h2 className="text-2xl font-extrabold text-slate-800">💬 Chat</h2>
        <p className="text-sm text-slate-500">
          {ehLideranca
            ? 'No Geral você fala com o clube todo. As demais conversas você acompanha em Gestão → 💬 Moderação.'
            : 'A liderança acompanha todas as conversas — trate os outros com respeito 🙂'}
        </p>
      </div>

      <div className="bg-white rounded-xl p-1 flex shadow-sm mb-4 max-w-md">
        {abas.map(([k, lbl]) => (
          <button key={k} onClick={() => { setAba(k); setConversaDireta(null) }}
            className={`flex-1 rounded-lg py-2 text-sm font-bold transition-colors ${aba === k ? 'bg-azul text-white' : 'text-slate-500'}`}>
            {lbl}
          </button>
        ))}
      </div>

      {aba === 'geral' ? (
        <Thread key="geral" tipo="geral" meuId={profile?.id} />
      ) : aba === 'unidade' ? (
        <Thread key="unidade" tipo="unidade" unidadeId={profile?.unidade_id} meuId={profile?.id} />
      ) : conversaDireta ? (
        <div>
          <button onClick={() => setConversaDireta(null)} className="text-sm text-azul font-semibold mb-2">← Voltar</button>
          <Thread key={conversaDireta.conversaId || conversaDireta.outro.id} tipo="direta"
            conversaIdInicial={conversaDireta.conversaId} destinatario={conversaDireta.outro} meuId={profile?.id} />
        </div>
      ) : (
        <ListaConversas meuId={profile?.id} onAbrir={setConversaDireta} onNova={() => setEscolhendo(true)} />
      )}

      <AnimatePresence>
        {escolhendo && (
          <EscolherColega meuId={profile?.id} onFechar={() => setEscolhendo(false)}
            onEscolher={(colega) => { setEscolhendo(false); setConversaDireta({ conversaId: null, outro: colega }) }} />
        )}
      </AnimatePresence>
    </div>
  )
}

function ListaConversas({ meuId, onAbrir, onNova }) {
  const [lista, setLista] = useState([])
  const [carregando, setCarregando] = useState(true)
  useEffect(() => { carregarMinhasConversasDiretas(meuId).then(setLista).catch(() => {}).finally(() => setCarregando(false)) }, [meuId])

  return (
    <div>
      <motion.button whileTap={{ scale: 0.97 }} onClick={onNova}
        className="w-full bg-azul text-white font-bold rounded-xl py-2.5 text-sm mb-3">
        + Nova conversa
      </motion.button>
      {carregando ? (
        <p className="text-slate-400 text-sm">Carregando...</p>
      ) : lista.length === 0 ? (
        <div className="bg-white rounded-2xl p-8 text-center shadow-sm">
          <div className="text-4xl mb-2">💬</div>
          <p className="font-semibold text-slate-700">Nenhuma conversa ainda</p>
          <p className="text-sm text-slate-400">Toque em "+ Nova conversa" pra começar.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {lista.map((c) => (
            <button key={c.conversaId} onClick={() => onAbrir(c)}
              className="w-full flex items-center gap-3 bg-white rounded-2xl p-3 shadow-sm text-left">
              <Avatar foto={c.outro.foto} nome={c.outro.nome} size="w-10 h-10" textSize="text-base" />
              <span className="font-semibold text-slate-800">{c.outro.nome}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function EscolherColega({ meuId, onFechar, onEscolher }) {
  const [colegas, setColegas] = useState([])
  const [busca, setBusca] = useState('')
  useEffect(() => { listarColegasChat(meuId).then(setColegas).catch(() => {}) }, [meuId])
  const filtrados = colegas.filter((c) => c.nome?.toLowerCase().includes(busca.toLowerCase()))

  return (
    <motion.div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onFechar}>
      <motion.div onClick={(e) => e.stopPropagation()}
        initial={{ y: 30, opacity: 0, scale: 0.97 }} animate={{ y: 0, opacity: 1, scale: 1 }} exit={{ y: 30, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 320, damping: 28 }}
        className="bg-white w-full max-w-sm rounded-3xl shadow-2xl max-h-[80vh] overflow-hidden flex flex-col">
        <div className="p-4 border-b border-slate-100">
          <h3 className="font-extrabold text-slate-800 mb-2">Falar com quem?</h3>
          <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar nome..."
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-azul-claro" />
        </div>
        <div className="overflow-y-auto flex-1">
          {filtrados.map((c) => (
            <button key={c.id} onClick={() => onEscolher(c)}
              className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-slate-50 border-b border-slate-50">
              <Avatar foto={c.foto} nome={c.nome} size="w-9 h-9" textSize="text-sm" />
              <span className="font-semibold text-slate-700 text-sm">{c.nome}</span>
            </button>
          ))}
          {filtrados.length === 0 && <p className="text-sm text-slate-400 text-center py-6">Ninguém encontrado.</p>}
        </div>
      </motion.div>
    </motion.div>
  )
}

// Thread reutilizável: chat da unidade OU conversa direta.
function Thread({ tipo, unidadeId, conversaIdInicial, destinatario, meuId }) {
  const [conversaId, setConversaId] = useState(conversaIdInicial || null)
  const [mensagens, setMensagens] = useState([])
  const [carregando, setCarregando] = useState(true)
  const [texto, setTexto] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState('')
  const autoresRef = useRef({})
  const fimRef = useRef(null)

  async function carregarInicial() {
    setCarregando(true); setErro('')
    try {
      if (tipo === 'unidade' || tipo === 'geral') {
        const r = tipo === 'geral' ? await carregarChatGeral() : await carregarChatUnidade(unidadeId)
        setConversaId(r.conversaId)
        setMensagens(r.mensagens)
        r.mensagens.forEach((m) => { autoresRef.current[m.autor_id] = m.autor })
      } else if (conversaId) {
        const msgs = await carregarMensagensDireta(conversaId)
        setMensagens(msgs)
        msgs.forEach((m) => { autoresRef.current[m.autor_id] = m.autor })
      }
    } catch (e) { setErro(e?.message || 'Erro') }
    setCarregando(false)
  }
  useEffect(() => { carregarInicial() }, [tipo, unidadeId, conversaId]) // eslint-disable-line

  // Tempo real: assim que souber o conversaId, escuta mensagens novas.
  useEffect(() => {
    if (!conversaId) return
    const canal = supabase.channel(`chat-${conversaId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_mensagens', filter: `conversa_id=eq.${conversaId}` },
        async (payload) => {
          const nova = payload.new
          setMensagens((atual) => (atual.some((m) => m.id === nova.id) ? atual : [...atual, { ...nova, autor: autoresRef.current[nova.autor_id] }]))
          if (!autoresRef.current[nova.autor_id]) {
            const { data } = await supabase.from('profiles').select('id,nome,foto').eq('id', nova.autor_id).single()
            if (data) {
              autoresRef.current[data.id] = data
              setMensagens((atual) => atual.map((m) => (m.id === nova.id ? { ...m, autor: data } : m)))
            }
          }
        })
      .subscribe()
    return () => { supabase.removeChannel(canal) }
  }, [conversaId])

  useEffect(() => { fimRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [mensagens.length])

  async function enviar() {
    const v = texto.trim()
    if (!v) return
    setErro(''); setEnviando(true)
    try {
      const r = tipo === 'geral' ? await enviarMensagemGeral(v)
        : tipo === 'unidade' ? await enviarMensagemUnidade(v)
        : await enviarMensagemDireta(destinatario.id, v)
      acerto(1)
      setTexto('')
      if (!conversaId && r?.conversa_id) setConversaId(r.conversa_id)
    } catch (e) { setErro(e?.message || String(e)) }
    setEnviando(false)
  }

  return (
    <div className="bg-white rounded-2xl shadow-sm flex flex-col" style={{ height: '65vh' }}>
      {tipo === 'direta' && (
        <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-100 shrink-0">
          <Avatar foto={destinatario.foto} nome={destinatario.nome} size="w-8 h-8" textSize="text-sm" />
          <span className="font-bold text-slate-800 text-sm">{destinatario.nome}</span>
        </div>
      )}
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {carregando ? (
          <p className="text-slate-400 text-sm text-center mt-4">Carregando...</p>
        ) : mensagens.length === 0 ? (
          <p className="text-slate-400 text-sm text-center mt-4">Nenhuma mensagem ainda — dá o primeiro "oi"! 👋</p>
        ) : (
          mensagens.map((m) => {
            const minha = m.autor_id === meuId
            return (
              <div key={m.id} className={`flex ${minha ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[75%] rounded-2xl px-3 py-2 ${minha ? 'bg-azul text-white' : 'bg-slate-100 text-slate-800'}`}>
                  {!minha && (tipo === 'unidade' || tipo === 'geral') && <div className="text-[11px] font-bold opacity-70 mb-0.5">{m.autor?.nome || '...'}</div>}
                  <div className={`text-sm ${m.apagada ? 'italic opacity-60' : ''}`}>
                    {m.apagada ? 'Mensagem removida pela liderança' : m.texto}
                  </div>
                  <div className={`text-[10px] mt-0.5 ${minha ? 'text-blue-100' : 'text-slate-400'}`}>{tempoRel(m.created_at)}</div>
                </div>
              </div>
            )
          })
        )}
        <div ref={fimRef} />
      </div>
      {erro && <p className="text-xs text-red-600 px-3 pb-1">{erro}</p>}
      <div className="flex gap-2 p-3 border-t border-slate-100 shrink-0">
        <input value={texto} onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') enviar() }}
          maxLength={500} placeholder="Escreva uma mensagem..."
          className="flex-1 rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-azul-claro" />
        <motion.button whileTap={{ scale: 0.95 }} disabled={enviando || !texto.trim()} onClick={enviar}
          className="bg-azul text-white font-bold rounded-xl px-4 disabled:opacity-50">
          ➤
        </motion.button>
      </div>
    </div>
  )
}
