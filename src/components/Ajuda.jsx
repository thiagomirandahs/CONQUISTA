import { useState, useEffect, useRef } from 'react'
import { useAuth } from '../context/Auth.jsx'
import Avatar from './Avatar.jsx'
import { listarColegas, pedirAjuda, ajudaStatus, cancelarAjuda, resolverAjuda } from '../lib/dados.js'

// ============ Botão "🆘 Pedir ajuda" (dentro dos jogos de palavra) ============
// Abre o seletor de amigo, cria o pedido e fica checando até o amigo resolver —
// aí chama onAjudado(resposta). enunciado = o que o amigo vê (sem a resposta).
export function PedirAjuda({ jogo, enunciado, resposta, onAjudado }) {
  const { profile } = useAuth()
  const [aberto, setAberto] = useState(false)
  const [colegas, setColegas] = useState(null)
  const [busca, setBusca] = useState('')
  const [pedidoId, setPedidoId] = useState(null) // aguardando amigo
  const [erro, setErro] = useState('')
  const timerRef = useRef(null)

  function abrir() {
    setAberto(true); setErro('')
    if (!colegas) listarColegas(profile?.id).then(setColegas).catch(() => setColegas([]))
  }
  async function escolher(amigo) {
    setErro('')
    try {
      const id = await pedirAjuda({ para: amigo.id, jogo, enunciado, resposta })
      setPedidoId(id); setAberto(false)
    } catch (e) {
      const m = e?.message || ''
      setErro(/pedir_ajuda|does not exist|schema cache|function|404/i.test(m)
        ? 'Esse recurso ainda está sendo ligado. Tente mais tarde 🙂'
        : (m || 'Não deu pra pedir'))
    }
  }
  function limpar() { clearInterval(timerRef.current); setPedidoId(null) }
  async function desistir() { if (pedidoId) { try { await cancelarAjuda(pedidoId) } catch { /* ok */ } } limpar() }

  // enquanto aguarda: checa o status a cada 4s e quando o app volta ao foco
  useEffect(() => {
    if (!pedidoId) return
    let vivo = true
    const checar = async () => {
      try {
        const s = await ajudaStatus(pedidoId)
        if (!vivo) return
        if (s.status === 'resolvido') { vivo = false; clearInterval(timerRef.current); onAjudado(s.resposta, s.ajudante) }
        else if (s.status === 'cancelado' || s.status === 'recusado') limpar()
      } catch { /* tenta de novo no próximo tick */ }
    }
    timerRef.current = setInterval(checar, 4000)
    const aoFocar = () => checar()
    window.addEventListener('focus', aoFocar)
    document.addEventListener('visibilitychange', aoFocar)
    checar()
    return () => {
      vivo = false; clearInterval(timerRef.current)
      window.removeEventListener('focus', aoFocar); document.removeEventListener('visibilitychange', aoFocar)
    }
  }, [pedidoId]) // eslint-disable-line

  const lista = (colegas || []).filter((c) => !busca || (c.nome || '').toLowerCase().includes(busca.toLowerCase()))

  return (
    <>
      <button onClick={abrir} className="text-xs font-bold text-azul bg-azul/10 rounded-lg px-3 py-2">🆘 Pedir ajuda</button>

      {pedidoId && (
        <div className="fixed inset-0 z-[70] bg-black/50 grid place-items-center p-4">
          <div className="bg-white rounded-3xl p-6 max-w-xs w-full text-center shadow-2xl">
            <div className="text-4xl mb-2 animate-pulse">📨</div>
            <p className="font-extrabold text-slate-800">Pedido enviado!</p>
            <p className="text-sm text-slate-500 mt-1">Esperando um amigo resolver o desafio pra te ajudar… 🙂</p>
            <button onClick={desistir} className="mt-4 text-sm font-bold text-slate-600 bg-slate-100 rounded-xl px-4 py-2">
              Desistir e continuar sozinho
            </button>
          </div>
        </div>
      )}

      {aberto && !pedidoId && (
        <div className="fixed inset-0 z-[70] bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={() => setAberto(false)}>
          <div onClick={(e) => e.stopPropagation()} className="bg-white w-full sm:max-w-sm rounded-t-3xl sm:rounded-3xl p-4 max-h-[80vh] flex flex-col shadow-2xl">
            <div className="flex items-center justify-between mb-2 shrink-0">
              <h3 className="font-extrabold text-slate-800">🆘 Chamar um amigo</h3>
              <button onClick={() => setAberto(false)} className="text-xs text-slate-400 p-3 -m-3">Fechar</button>
            </div>
            <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Procurar amigo…"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm mb-2 shrink-0 outline-none focus:border-azul" />
            {erro && <p className="text-xs text-red-600 mb-2">{erro}</p>}
            {colegas === null ? (
              <p className="text-sm text-slate-400 p-4 text-center">Carregando…</p>
            ) : (
              <div className="overflow-y-auto flex-1 min-h-0 space-y-1">
                {lista.map((c) => (
                  <button key={c.id} onClick={() => escolher(c)} className="w-full flex items-center gap-3 p-2 rounded-xl hover:bg-slate-50 text-left">
                    <Avatar foto={c.foto} nome={c.nome} size="w-9 h-9" textSize="text-sm" />
                    <span className="font-semibold text-slate-700 text-sm">{c.nome}</span>
                  </button>
                ))}
                {lista.length === 0 && <p className="text-sm text-slate-400 p-4 text-center">Ninguém encontrado.</p>}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}

// ============ O desafio que o AMIGO vê pra resolver ============
const COR_TERMO_AJUDA = { verde: 'bg-green-500 text-white', amarelo: 'bg-amber-400 text-white', cinza: 'bg-slate-300 text-slate-600' }
function PuzzleAjuda({ enunciado }) {
  const e = enunciado || {}
  if (e.tipo === 'anagrama') {
    return (
      <div className="text-center">
        <p className="text-xs text-slate-500 mb-1">Desembaralhe:</p>
        <div className="text-3xl font-extrabold tracking-[0.25em] text-azul">{e.letras}</div>
        {e.dica && <p className="text-xs text-slate-400 mt-1">{e.dica}</p>}
      </div>
    )
  }
  if (e.tipo === 'forca') {
    return (
      <div className="text-center">
        <p className="text-xs text-slate-500 mb-1">Descubra a palavra {e.tema ? `(${e.tema})` : ''}:</p>
        <div className="text-2xl font-extrabold tracking-[0.2em] text-slate-800">{e.mascara}</div>
      </div>
    )
  }
  if (e.tipo === 'termo') {
    return (
      <div>
        <p className="text-xs text-slate-500 mb-1 text-center">Adivinhe a palavra de {e.tamanho || 5} letras:</p>
        <div className="space-y-1">
          {(e.tentativas || []).map((l, i) => (
            <div key={i} className="flex gap-1 justify-center">
              {String(l.tent || '').split('').map((ch, j) => (
                <span key={j} className={`w-8 h-8 grid place-items-center rounded font-extrabold text-sm ${COR_TERMO_AJUDA[l.res?.[j]] || 'bg-slate-100'}`}>{ch}</span>
              ))}
            </div>
          ))}
          {(!e.tentativas || e.tentativas.length === 0) && <p className="text-xs text-slate-400 text-center">Sem pistas ainda — chute uma palavra!</p>}
        </div>
      </div>
    )
  }
  return <p className="text-sm text-slate-500">Ajude seu amigo a resolver!</p>
}

// ============ Caixa de "🆘 Pedidos de ajuda" (o AMIGO resolve aqui) ============
export function CaixaAjuda({ pedidos, aoFechar, aoResolvido }) {
  const [sel, setSel] = useState(null)
  const [resp, setResp] = useState('')
  const [aviso, setAviso] = useState('')
  const [enviando, setEnviando] = useState(false)

  async function enviar() {
    if (!resp.trim() || enviando) return
    setEnviando(true); setAviso('')
    try {
      const r = await resolverAjuda(sel.id, resp.trim())
      if (r.ok) {
        setAviso(r.ganhou ? `✅ Você ajudou! +${r.ganhou} pontos 🎉` : '✅ Você ajudou! (limite de pontos de hoje atingido)')
        setTimeout(() => { aoResolvido(sel.id); setSel(null); setResp(''); setAviso('') }, 1700)
      } else setAviso(r.erro === 'sumiu' ? 'Esse pedido não está mais disponível.' : '❌ Não é essa. Tenta de novo!')
    } catch (e) { setAviso(e?.message || 'Erro') }
    setEnviando(false)
  }

  return (
    <div className="fixed inset-0 z-[70] bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={aoFechar}>
      <div onClick={(e) => e.stopPropagation()} className="bg-white w-full sm:max-w-sm rounded-t-3xl sm:rounded-3xl p-4 max-h-[85vh] flex flex-col shadow-2xl">
        <div className="flex items-center justify-between mb-3 shrink-0">
          <h3 className="font-extrabold text-slate-800">🆘 Pedidos de ajuda</h3>
          <button onClick={aoFechar} className="text-xs text-slate-400 p-3 -m-3">Fechar</button>
        </div>

        {!sel ? (
          <div className="overflow-y-auto flex-1 min-h-0 space-y-2">
            {(pedidos || []).map((p) => (
              <button key={p.id} onClick={() => { setSel(p); setResp(''); setAviso('') }}
                className="w-full flex items-center gap-3 p-3 rounded-2xl bg-slate-50 hover:bg-slate-100 text-left">
                <Avatar foto={p.de_foto} nome={p.de_nome} size="w-10 h-10" textSize="text-sm" />
                <div className="min-w-0">
                  <p className="font-bold text-slate-800 text-sm truncate">{p.de_nome} precisa de ajuda</p>
                  <p className="text-xs text-slate-500">no jogo — toque pra resolver e ganhar +5 🤝</p>
                </div>
              </button>
            ))}
            {(!pedidos || pedidos.length === 0) && <p className="text-sm text-slate-400 p-6 text-center">Nenhum pedido agora. 🙂</p>}
          </div>
        ) : (
          <div className="flex-1 min-h-0 overflow-y-auto">
            <button onClick={() => setSel(null)} className="text-xs text-slate-400 mb-2">← voltar aos pedidos</button>
            <div className="flex items-center gap-2 mb-3">
              <Avatar foto={sel.de_foto} nome={sel.de_nome} size="w-8 h-8" textSize="text-xs" />
              <p className="text-sm font-bold text-slate-700">Ajude {sel.de_nome}:</p>
            </div>
            <div className="bg-slate-50 rounded-2xl p-4 mb-3"><PuzzleAjuda enunciado={sel.enunciado} /></div>
            <input value={resp} onChange={(e) => setResp(e.target.value)} placeholder="Escreva a resposta…"
              onKeyDown={(e) => { if (e.key === 'Enter') enviar() }}
              className="w-full rounded-xl border border-slate-300 px-3 py-3 text-base text-center font-bold uppercase outline-none focus:border-azul" />
            {aviso && <p className={`text-sm font-bold text-center mt-2 ${aviso.startsWith('✅') ? 'text-green-600' : 'text-amber-600'}`}>{aviso}</p>}
            <button onClick={enviar} disabled={enviando || !resp.trim()}
              className="w-full mt-3 rounded-xl bg-azul text-white font-extrabold py-3 disabled:opacity-50">
              {enviando ? 'Conferindo…' : 'Enviar resposta 🤝'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
