import { useState, useEffect } from 'react'
import { m as motion } from 'framer-motion'
import { useClube } from '../context/Clube.jsx'
import { carregarTodasConversasChat, apagarMensagemChat } from '../lib/dados.js'
import { supabase } from '../lib/supabase.js'
import { avisar } from '../ui/avisos.jsx'

const PODE_GERIR = ['instrutor', 'diretoria']

function fmtData(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  return d.toLocaleDateString('pt-BR') + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}

export default function ChatModeracao() {
  const { papel: meuPapel } = useClube()
  const ehAdmin = PODE_GERIR.includes(meuPapel)
  const [conversas, setConversas] = useState([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState('')
  const [aberta, setAberta] = useState(null)

  async function carregar() {
    setCarregando(true); setErro('')
    try { setConversas(await carregarTodasConversasChat()) } catch (e) { setErro(e?.message || 'Erro') }
    setCarregando(false)
  }
  useEffect(() => { if (ehAdmin) carregar() }, [ehAdmin]) // eslint-disable-line

  if (!ehAdmin) {
    return (
      <div className="bg-surface rounded-2xl p-8 text-center shadow-soft">
        <div className="text-4xl mb-2">🔒</div>
        <p className="font-semibold text-ink">Só a liderança</p>
      </div>
    )
  }

  if (carregando) return <p className="text-faint text-sm">Carregando...</p>

  if (erro) {
    const faltaSQL = /does not exist|schema cache|could not find the (table|relation)/i.test(erro)
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 text-sm text-amber-800">
        {faltaSQL ? (
          <>
            <p className="font-semibold mb-1">Chat ainda não configurado</p>
            <p className="text-xs">Rode <code className="bg-amber-100 rounded px-1">supabase/2026-08-24-chat.sql</code> no Supabase.</p>
          </>
        ) : (
          <>
            <p className="font-semibold mb-1">Não deu pra carregar</p>
            <p className="text-xs mb-3">{erro}</p>
            <button onClick={carregar} className="bg-amber-600 text-white font-bold rounded-xl px-4 py-2 text-xs">Tentar de novo</button>
          </>
        )}
      </div>
    )
  }

  return (
    <div>
      <div className="mb-4">
        <h2 className="text-2xl font-extrabold text-ink">💬 Moderação do chat</h2>
        <p className="text-sm text-muted">Todas as conversas do clube — grupo das unidades e diretas.</p>
      </div>

      {aberta ? (
        <ConversaAberta conversaId={aberta.conversa_id} titulo={aberta.unidade ? `🏠 ${aberta.unidade.nome}` : '💬 Conversa direta'}
          onVoltar={() => { setAberta(null); carregar() }} />
      ) : conversas.length === 0 ? (
        <div className="bg-surface rounded-2xl p-8 text-center shadow-soft">
          <div className="text-4xl mb-2">💬</div>
          <p className="font-semibold text-ink">Nenhuma conversa ainda</p>
        </div>
      ) : (
        <div className="space-y-2">
          {conversas.map((c) => (
            <button key={c.conversa_id} onClick={() => setAberta(c)}
              className="w-full text-left bg-surface rounded-2xl p-3 shadow-soft flex items-center gap-3">
              <span className="text-2xl shrink-0">{c.tipo === 'unidade' ? '🏠' : '💬'}</span>
              <div className="flex-1 min-w-0">
                <div className="font-bold text-ink text-sm">{c.tipo === 'unidade' ? (c.unidade?.nome || 'Unidade') : 'Conversa direta'}</div>
                <div className="text-xs text-muted truncate">{c.ultima_mensagem || '(sem mensagens)'}</div>
              </div>
              <div className="text-right shrink-0">
                <div className="text-xs text-faint">{c.total_mensagens} msg</div>
                {c.ultima_em && <div className="text-xs text-faint">{fmtData(c.ultima_em)}</div>}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function ConversaAberta({ conversaId, titulo, onVoltar }) {
  const [mensagens, setMensagens] = useState([])
  const [carregando, setCarregando] = useState(true)

  async function carregar() {
    setCarregando(true)
    // A VIEW (não a tabela): o texto original de mensagem apagada mora na trilha de moderação, e só a liderança do clube
    // o recebe por ela (a tabela guarda só o marcador "(mensagem apagada)" — migration 29).
    const { data } = await supabase.from('chat_mensagens_visiveis')
      .select('id,autor_id,texto,created_at,apagada').eq('conversa_id', conversaId).order('created_at')
    const autorIds = [...new Set((data || []).map((m) => m.autor_id))]
    const { data: perfis } = autorIds.length
      ? await supabase.from('profiles').select('id,nome').in('id', autorIds)
      : { data: [] }
    const porId = Object.fromEntries((perfis || []).map((p) => [p.id, p]))
    setMensagens((data || []).map((m) => ({ ...m, autor: porId[m.autor_id] || { nome: '?' } })))
    setCarregando(false)
  }
  useEffect(() => { carregar() }, [conversaId]) // eslint-disable-line

  async function apagar(id) {
    if (!(await avisar.confirmar({ titulo: 'Apagar esta mensagem?', descricao: 'Ela some da tela dos desbravadores. Você continua vendo o texto original aqui na moderação.', rotulo: 'Apagar a mensagem' }))) return
    try { await apagarMensagemChat(id); carregar() } catch (e) { avisar.erro(e, 'Não consegui apagar a mensagem.') }
  }

  return (
    <div>
      <button onClick={onVoltar} className="text-sm text-brand font-semibold mb-2">← Voltar</button>
      <div className="bg-surface rounded-2xl shadow-soft p-4">
        <h3 className="font-extrabold text-ink mb-3">{titulo}</h3>
        {carregando ? (
          <p className="text-faint text-sm">Carregando...</p>
        ) : mensagens.length === 0 ? (
          <p className="text-faint text-sm">Sem mensagens.</p>
        ) : (
          <div className="space-y-2 max-h-[65vh] overflow-y-auto">
            {mensagens.map((m) => (
              <div key={m.id} className={`rounded-xl p-2.5 ${m.apagada ? 'bg-red-50 border border-red-100' : 'bg-surface2'}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-bold text-ink">{m.autor?.nome || '?'}</span>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-xs text-faint">{fmtData(m.created_at)}</span>
                    {!m.apagada && (
                      <motion.button whileTap={{ scale: 0.95 }} onClick={() => apagar(m.id)}
                        className="text-xs text-red-600 font-bold">Apagar</motion.button>
                    )}
                  </div>
                </div>
                <p className={`text-sm mt-1 ${m.apagada ? 'text-red-700 line-through' : 'text-ink'}`}>{m.texto}</p>
                {m.apagada && <p className="text-xs text-red-500 mt-0.5">Apagada da tela dos desbravadores (texto original preservado aqui)</p>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
