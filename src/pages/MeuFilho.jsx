import { useState, useEffect } from 'react'
import { useAuth } from '../context/Auth.jsx'
import Avatar from '../components/Avatar.jsx'
import AvisoOffline from '../components/AvisoOffline.jsx'
import { carregarMeusFilhos, meusPedidosVinculo, pedirVinculo, lerPix } from '../lib/dados.js'

const MESES = ['', 'jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']

// Página do responsável: acompanha o(s) filho(s) aprovado(s) — pontos, presença,
// mensalidade + PIX — e pede vínculo de novos filhos (a diretoria confirma).
export default function MeuFilho() {
  const { profile } = useAuth()
  const [filhos, setFilhos] = useState([])
  const [pedidos, setPedidos] = useState([])
  const [pix, setPix] = useState('')
  const [carregando, setCarregando] = useState(true)
  const [nome, setNome] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [msg, setMsg] = useState('')

  async function carregar() {
    setCarregando(true)
    try {
      const [f, p, px] = await Promise.all([carregarMeusFilhos(), meusPedidosVinculo(), lerPix()])
      setFilhos(f); setPedidos(p); setPix(px)
    } catch (e) { setMsg(e?.message || 'Erro ao carregar') }
    setCarregando(false)
  }
  useEffect(() => { if (profile?.id) carregar() }, [profile?.id]) // eslint-disable-line

  async function pedir(e) {
    e.preventDefault()
    if (!nome.trim() || enviando) return
    setEnviando(true); setMsg('')
    try { await pedirVinculo(nome.trim()); setNome(''); setMsg('Pedido enviado! A diretoria vai confirmar. 🙂'); await carregar() }
    catch (err) { setMsg(err?.message || 'Erro') }
    setEnviando(false)
  }

  function copiarPix() {
    try { navigator.clipboard?.writeText(pix); setMsg('Chave PIX copiada! 📋') } catch { /* sem clipboard */ }
  }

  const pendentes = pedidos.filter((p) => p.status === 'pendente')

  if (carregando) return <p className="text-slate-400 text-sm">Carregando...</p>

  return (
    <div>
      <AvisoOffline />
      <div className="mb-4">
        <h2 className="text-2xl font-extrabold text-slate-800">👨‍👩‍👧 Meu Filho</h2>
        <p className="text-sm text-slate-500">Acompanhe seu(s) filho(s) no clube</p>
      </div>

      {filhos.map((c) => (
        <div key={c.id} className="bg-white rounded-2xl shadow-sm overflow-hidden mb-3">
          <div className="p-4 flex items-center gap-3 border-b border-slate-100">
            <Avatar foto={c.foto} nome={c.nome || '?'} size="w-14 h-14" textSize="text-xl" />
            <div className="flex-1 min-w-0">
              <div className="font-extrabold text-slate-800 truncate">{c.nome}</div>
              <div className="text-xs text-slate-400">{c.unidade || 'Sem unidade'}</div>
            </div>
          </div>
          <div className="grid grid-cols-3 divide-x divide-slate-100 text-center">
            <div className="p-3"><div className="text-xl font-extrabold text-dourado">{c.pontos}</div><div className="text-[11px] text-slate-400">pontos</div></div>
            <div className="p-3"><div className="text-xl font-extrabold text-green-600">{c.presencas}</div><div className="text-[11px] text-slate-400">presenças</div></div>
            <div className="p-3"><div className="text-xl font-extrabold text-slate-400">{c.faltas}</div><div className="text-[11px] text-slate-400">faltas</div></div>
          </div>
          {(c.mensalidades_pendentes || []).length > 0 && (
            <div className="p-4 bg-amber-50 border-t border-amber-100">
              <p className="text-sm font-bold text-amber-800">💰 Mensalidade pendente</p>
              <p className="text-xs text-amber-700 mt-0.5">
                {c.mensalidades_pendentes.map((m) => `${MESES[m.mes] || m.mes}/${String(m.ano).slice(2)}`).join(' · ')}
              </p>
              {pix ? (
                <div className="mt-2 bg-white rounded-xl p-3">
                  <p className="text-[11px] text-slate-400 mb-0.5">Chave PIX do clube (toque pra copiar)</p>
                  <button onClick={copiarPix} className="text-sm font-bold text-azul break-all text-left w-full">{pix}</button>
                </div>
              ) : (
                <p className="text-[11px] text-amber-600 mt-1">Fale com a tesouraria pra acertar o pagamento.</p>
              )}
            </div>
          )}
        </div>
      ))}

      {/* Pedir vínculo */}
      <div className="bg-white rounded-2xl shadow-sm p-4">
        <p className="font-bold text-slate-800 mb-1">{filhos.length ? 'Vincular outro filho' : 'Vincular seu filho(a)'}</p>
        <p className="text-xs text-slate-400 mb-3">Digite o nome do desbravador. A diretoria confirma o vínculo. 🙂</p>
        <form onSubmit={pedir} className="flex gap-2">
          <input value={nome} onChange={(e) => setNome(e.target.value)} maxLength={80} placeholder="Nome do seu filho(a)"
            className="flex-1 rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-azul-claro focus:ring-2 focus:ring-azul-claro/30" />
          <button type="submit" disabled={enviando || !nome.trim()}
            className="rounded-xl bg-azul text-white font-bold px-4 text-sm disabled:opacity-60">Pedir</button>
        </form>
        {msg && <p className="text-xs text-slate-500 mt-2">{msg}</p>}

        {pendentes.length > 0 && (
          <div className="mt-3 space-y-1 border-t border-slate-100 pt-3">
            {pendentes.map((p) => (
              <div key={p.id} className="text-xs text-slate-500 flex items-center gap-2">
                <span>⏳</span> <span className="truncate">"{p.nome_digitado}" — aguardando a diretoria</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
