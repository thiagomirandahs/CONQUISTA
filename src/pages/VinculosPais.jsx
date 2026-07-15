import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useAuth } from '../context/Auth.jsx'
import Avatar from '../components/Avatar.jsx'
import {
  carregarVinculosPendentes, buscarDesbravadores, aprovarVinculo, rejeitarVinculo, lerPix, salvarPix,
} from '../lib/dados.js'

const PODE_GERIR = ['instrutor', 'diretoria']
const fmt = (iso) => (iso ? new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '')

// Diretoria confirma os pedidos de vínculo dos pais (escolhendo o desbravador
// certo) e cadastra a chave PIX do clube que aparece pros responsáveis.
export default function VinculosPais() {
  const { profile } = useAuth()
  const ehAdmin = PODE_GERIR.includes(profile?.papel)
  const ehDiretoria = profile?.papel === 'diretoria'
  const [pend, setPend] = useState([])
  const [carregando, setCarregando] = useState(true)
  const [aprovando, setAprovando] = useState(null)

  async function carregar() {
    setCarregando(true)
    try { setPend(await carregarVinculosPendentes()) } catch { /* ignora */ }
    setCarregando(false)
  }
  useEffect(() => { if (ehAdmin) carregar() }, [ehAdmin])

  if (!ehAdmin) {
    return (
      <div className="bg-white rounded-2xl p-8 text-center shadow-sm">
        <div className="text-4xl mb-2">🔒</div>
        <p className="font-semibold text-slate-700">Área da liderança</p>
      </div>
    )
  }

  async function rejeitar(p) {
    if (!window.confirm(`Rejeitar o pedido de "${p.nome_digitado}"?`)) return
    try { await rejeitarVinculo(p.id); carregar() } catch (e) { alert(e?.message || e) }
  }

  return (
    <div>
      <div className="mb-4">
        <h2 className="text-2xl font-extrabold text-slate-800">👨‍👩‍👧 Vínculos dos pais</h2>
        <p className="text-sm text-slate-500">Confirme quem é filho de quem</p>
      </div>

      <PixConfig ehDiretoria={ehDiretoria} />

      <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-2 mt-5">Pedidos aguardando</h3>
      {carregando ? (
        <p className="text-slate-400 text-sm">Carregando...</p>
      ) : pend.length === 0 ? (
        <div className="bg-white rounded-2xl p-6 text-center shadow-sm">
          <div className="text-3xl mb-1">✅</div>
          <p className="text-sm text-slate-500">Nenhum pedido de vínculo pendente.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {pend.map((p) => (
            <div key={p.id} className="bg-white rounded-2xl shadow-sm p-4">
              <div className="text-sm">
                <span className="font-bold text-slate-800">{p.responsavel}</span>
                <span className="text-slate-400"> diz ser responsável de</span>
              </div>
              <div className="text-base font-extrabold text-azul">"{p.nome_digitado}"</div>
              <div className="text-[11px] text-slate-400 mb-3">pedido em {fmt(p.criado_em)}</div>
              {ehDiretoria ? (
                <div className="flex gap-2">
                  <button onClick={() => setAprovando(p)} className="flex-1 bg-azul text-white font-bold rounded-xl py-2 text-sm">Confirmar vínculo</button>
                  <button onClick={() => rejeitar(p)} className="bg-red-50 text-red-600 font-bold rounded-xl py-2 px-3 text-sm">Rejeitar</button>
                </div>
              ) : (
                <p className="text-xs text-slate-400">Só a diretoria confirma ou rejeita.</p>
              )}
            </div>
          ))}
        </div>
      )}

      <AnimatePresence>
        {aprovando && (
          <ModalAprovar pedido={aprovando} onFechar={() => setAprovando(null)} onAprovado={() => { setAprovando(null); carregar() }} />
        )}
      </AnimatePresence>
    </div>
  )
}

// Escolhe o desbravador certo pra confirmar o vínculo (busca por nome).
function ModalAprovar({ pedido, onFechar, onAprovado }) {
  const [termo, setTermo] = useState(pedido.nome_digitado || '')
  const [lista, setLista] = useState([])
  const [buscando, setBuscando] = useState(false)
  const [erro, setErro] = useState('')
  const [salvando, setSalvando] = useState(false)

  useEffect(() => {
    let vivo = true
    setBuscando(true)
    const t = setTimeout(() => {
      buscarDesbravadores(termo).then((l) => { if (vivo) { setLista(l); setBuscando(false) } }).catch(() => setBuscando(false))
    }, 250)
    return () => { vivo = false; clearTimeout(t) }
  }, [termo])

  async function confirmar(desbravador) {
    if (salvando) return
    setSalvando(true); setErro('')
    try { await aprovarVinculo(pedido.id, desbravador.id); onAprovado() }
    catch (e) { setErro(e?.message || String(e)); setSalvando(false) }
  }

  return (
    <motion.div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[60] flex items-end sm:items-center justify-center p-0 sm:p-6"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={salvando ? undefined : onFechar}>
      <motion.div onClick={(e) => e.stopPropagation()}
        initial={{ y: 60, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 60, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 320, damping: 28 }}
        className="bg-white w-full sm:max-w-sm rounded-t-3xl sm:rounded-3xl shadow-2xl p-6 max-h-[85vh] overflow-y-auto">
        <h3 className="text-lg font-extrabold text-slate-800 mb-1">Confirmar vínculo</h3>
        <p className="text-sm text-slate-500 mb-3">O pai digitou <b>"{pedido.nome_digitado}"</b>. Escolha o desbravador certo:</p>
        <input value={termo} onChange={(e) => setTermo(e.target.value)} placeholder="Buscar por nome..."
          className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-azul-claro focus:ring-2 focus:ring-azul-claro/30 mb-3" />
        {erro && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3 mb-3">{erro}</div>}
        <div className="space-y-1">
          {buscando && <p className="text-xs text-slate-400">Buscando...</p>}
          {!buscando && lista.length === 0 && <p className="text-xs text-slate-400">Nenhum desbravador encontrado.</p>}
          {lista.map((d) => (
            <button key={d.id} onClick={() => confirmar(d)} disabled={salvando}
              className="w-full flex items-center gap-3 p-2 rounded-xl hover:bg-slate-50 text-left disabled:opacity-60">
              <Avatar foto={d.foto} nome={d.nome || '?'} size="w-9 h-9" textSize="text-sm" />
              <span className="font-semibold text-slate-800 text-sm truncate">{d.nome}</span>
            </button>
          ))}
        </div>
        <button onClick={onFechar} disabled={salvando} className="w-full mt-4 rounded-xl bg-slate-100 text-slate-700 font-semibold py-2.5 disabled:opacity-60">Cancelar</button>
      </motion.div>
    </motion.div>
  )
}

// Chave PIX do clube (aparece pros pais na cobrança). Todos da liderança editam.
function PixConfig({ ehDiretoria }) {
  const [pix, setPix] = useState('')
  const [editando, setEditando] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [ok, setOk] = useState(false)

  useEffect(() => { lerPix().then((v) => { setPix(v); setEditando(v) }).catch(() => {}) }, [])

  async function salvar() {
    setSalvando(true); setOk(false)
    try { await salvarPix(editando); setPix(editando.trim()); setOk(true) } catch (e) { alert(e?.message || e) }
    setSalvando(false)
  }

  return (
    <div className="bg-white rounded-2xl shadow-sm p-4">
      <p className="font-bold text-slate-800 mb-1">💰 Chave PIX do clube</p>
      <p className="text-xs text-slate-400 mb-2">Aparece pros pais quando a mensalidade está pendente.</p>
      <div className="flex gap-2">
        <input value={editando} onChange={(e) => { setEditando(e.target.value); setOk(false) }}
          placeholder="chave PIX (CNPJ, telefone, e-mail...)"
          className="flex-1 rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-azul-claro focus:ring-2 focus:ring-azul-claro/30" />
        <button onClick={salvar} disabled={salvando || editando.trim() === pix}
          className="rounded-xl bg-azul text-white font-bold px-4 text-sm disabled:opacity-50">
          {salvando ? '...' : ok ? '✓' : 'Salvar'}
        </button>
      </div>
    </div>
  )
}
