import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useClube } from '../context/Clube.jsx'
import Avatar from '../components/Avatar.jsx'
import {
  carregarVinculosPendentes, buscarDesbravadores, aprovarVinculo, rejeitarVinculo, lerPix, salvarPix,
  criarConviteResponsavel, listarConvitesResponsavel, revogarConviteResponsavel,
} from '../lib/dados.js'
import { montarLinkConvite, STATUS_CONVITE } from '../lib/convite.js'
import { avisar } from '../ui/avisos.jsx'

const PODE_GERIR = ['instrutor', 'diretoria']
const fmt = (iso) => (iso ? new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '')

// Diretoria confirma os pedidos de vínculo dos pais (escolhendo o desbravador
// certo) e cadastra a chave PIX do clube que aparece pros responsáveis.
export default function VinculosPais() {
  const { papel: meuPapel } = useClube()
  const ehAdmin = PODE_GERIR.includes(meuPapel)
  const ehDiretoria = meuPapel === 'diretoria'
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
      <div className="bg-surface rounded-2xl p-8 text-center shadow-soft">
        <div className="text-4xl mb-2">🔒</div>
        <p className="font-semibold text-ink">Área da liderança</p>
      </div>
    )
  }

  async function rejeitar(p) {
    if (!(await avisar.confirmar({ titulo: `Rejeitar o pedido de "${p.nome_digitado}"?`, descricao: 'O responsável não vai conseguir acompanhar essa criança. Ele pode pedir de novo depois.', rotulo: 'Rejeitar o pedido' }))) return
    try { await rejeitarVinculo(p.id); carregar() } catch (e) { avisar.erro(e) }
  }

  return (
    <div>
      <div className="mb-4">
        <h2 className="text-2xl font-extrabold text-ink">👨‍👩‍👧 Vínculos dos pais</h2>
        <p className="text-sm text-muted">Confirme quem é filho de quem</p>
      </div>

      {ehDiretoria && <ConvitesResponsavel />}

      <PixConfig ehDiretoria={ehDiretoria} />

      <h3 className="text-xs font-bold text-faint uppercase tracking-wide mb-2 mt-5">Pedidos aguardando</h3>
      {carregando ? (
        <p className="text-faint text-sm">Carregando...</p>
      ) : pend.length === 0 ? (
        <div className="bg-surface rounded-2xl p-6 text-center shadow-soft">
          <div className="text-3xl mb-1">✅</div>
          <p className="text-sm text-muted">Nenhum pedido de vínculo pendente.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {pend.map((p) => (
            <div key={p.id} className="bg-surface rounded-2xl shadow-soft p-4">
              <div className="text-sm">
                <span className="font-bold text-ink">{p.responsavel}</span>
                <span className="text-faint"> diz ser responsável de</span>
              </div>
              <div className="text-base font-extrabold text-brand">"{p.nome_digitado}"</div>
              <div className="text-xs text-faint mb-3">pedido em {fmt(p.criado_em)}</div>
              {ehDiretoria ? (
                <div className="flex gap-2">
                  <button onClick={() => setAprovando(p)} className="flex-1 bg-gradient-to-r from-brand to-brand2 shadow-glow text-white font-bold rounded-xl py-2 text-sm">Confirmar vínculo</button>
                  <button onClick={() => rejeitar(p)} className="bg-red-50 text-red-600 font-bold rounded-xl py-2 px-3 text-sm">Rejeitar</button>
                </div>
              ) : (
                <p className="text-xs text-faint">Só a diretoria confirma ou rejeita.</p>
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

// Convites para responsáveis: gera o link (o token só aparece AQUI, uma vez), lista os do meu
// clube com o estado de cada um e permite revogar os que ainda estão ativos.
function ConvitesResponsavel() {
  const [lista, setLista] = useState([])
  const [carregando, setCarregando] = useState(true)
  const [criando, setCriando] = useState(false)
  const [linkNovo, setLinkNovo] = useState('')
  const [copiado, setCopiado] = useState(false)
  const [erro, setErro] = useState('')

  async function carregar() {
    try { setLista(await listarConvitesResponsavel()); setErro('') }
    catch (e) { setErro(e?.message || String(e)) }
    setCarregando(false)
  }
  useEffect(() => { carregar() }, [])

  async function criar() {
    setCriando(true); setErro(''); setCopiado(false)
    try {
      const c = await criarConviteResponsavel()
      const link = montarLinkConvite(window.location.origin, c.token)
      setLinkNovo(link)
      try { await navigator.clipboard?.writeText(link); setCopiado(true) } catch { /* sem permissão: o link segue na tela */ }
      await carregar()
    } catch (e) { setErro(e?.message || String(e)) }
    setCriando(false)
  }

  async function copiar() {
    try { await navigator.clipboard?.writeText(linkNovo); setCopiado(true) } catch { /* selecione e copie na mão */ }
  }

  async function revogar(c) {
    if (!(await avisar.confirmar({ titulo: 'Revogar este convite?', descricao: 'O link para de funcionar na hora. Quem já usou continua com o acesso.', rotulo: 'Revogar o convite' }))) return
    try { await revogarConviteResponsavel(c.id); await carregar() } catch (e) { avisar.erro(e) }
  }

  return (
    <div className="bg-surface rounded-2xl shadow-soft p-4 mb-2">
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="min-w-0">
          <div className="font-bold text-ink text-sm">🔗 Convites para responsáveis</div>
          <p className="text-xs text-faint">Cada link vale 14 dias e só pode ser usado uma vez.</p>
        </div>
        <button onClick={criar} disabled={criando}
          className="shrink-0 rounded-xl bg-gradient-to-r from-brand to-brand2 text-white font-bold px-4 py-2.5 text-sm disabled:opacity-60">
          {criando ? 'Criando...' : 'Gerar link'}
        </button>
      </div>

      {linkNovo && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 mb-3">
          <p className="text-xs text-amber-800 mb-2">
            {copiado ? '✅ Link copiado. ' : ''}Envie agora ao responsável — por segurança ele não aparece de novo.
          </p>
          <input readOnly value={linkNovo} onFocus={(e) => e.target.select()}
            className="w-full rounded-lg border border-amber-200 bg-white px-2 py-2 text-xs text-ink" />
          <button onClick={copiar} className="mt-2 w-full rounded-lg bg-amber-600 text-white font-bold py-2 text-sm">Copiar link</button>
        </div>
      )}

      {erro && <p className="text-xs text-red-600 mb-2">{erro}</p>}

      {carregando ? (
        <p className="text-faint text-xs">Carregando...</p>
      ) : lista.length === 0 ? (
        <p className="text-faint text-xs">Nenhum convite gerado ainda.</p>
      ) : (
        <ul className="divide-y divide-line">
          {lista.map((c) => {
            const st = STATUS_CONVITE[c.status] || { rotulo: c.status, classe: 'bg-slate-100 text-slate-500' }
            return (
              <li key={c.id} className="py-2 flex items-center justify-between gap-2">
                <div className="min-w-0 text-xs">
                  <div className="text-ink">
                    Criado em {fmt(c.criado_em)}{c.criado_por_nome ? ` por ${c.criado_por_nome}` : ''}
                  </div>
                  <div className="text-faint">
                    {c.status === 'usado' ? `Usado em ${fmt(c.usado_em)}${c.usado_por_nome ? ` por ${c.usado_por_nome}` : ''}`
                      : c.status === 'revogado' ? `Revogado em ${fmt(c.revogado_em)}`
                      : `${c.status === 'expirado' ? 'Expirou' : 'Expira'} em ${fmt(c.expira_em)}`}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className={`text-xs font-bold rounded-full px-2 py-0.5 ${st.classe}`}>{st.rotulo}</span>
                  {c.status === 'ativo' && (
                    <button onClick={() => revogar(c)} className="text-xs font-bold text-red-600 bg-red-50 rounded-lg px-2.5 py-1.5">Revogar</button>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}
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
        className="bg-surface w-full sm:max-w-sm rounded-t-3xl sm:rounded-3xl shadow-2xl p-6 max-h-[85vh] overflow-y-auto">
        <h3 className="text-lg font-extrabold text-ink mb-1">Confirmar vínculo</h3>
        <p className="text-sm text-muted mb-3">O pai digitou <b>"{pedido.nome_digitado}"</b>. Escolha o desbravador certo:</p>
        <input value={termo} onChange={(e) => setTermo(e.target.value)} placeholder="Buscar por nome..."
          className="w-full rounded-lg bg-surface2 border border-line px-3 py-2.5 text-sm text-ink placeholder:text-faint outline-none focus:border-brand focus:ring-2 focus:ring-brand/30 mb-3" />
        {erro && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3 mb-3">{erro}</div>}
        <div className="space-y-1">
          {buscando && <p className="text-xs text-faint">Buscando...</p>}
          {!buscando && lista.length === 0 && <p className="text-xs text-faint">Nenhum desbravador encontrado.</p>}
          {lista.map((d) => (
            <button key={d.id} onClick={() => confirmar(d)} disabled={salvando}
              className="w-full flex items-center gap-3 p-2 rounded-xl hover:bg-surface2 text-left disabled:opacity-60">
              <Avatar foto={d.foto} nome={d.nome || '?'} size="w-9 h-9" textSize="text-sm" />
              <span className="font-semibold text-ink text-sm truncate">{d.nome}</span>
            </button>
          ))}
        </div>
        <button onClick={onFechar} disabled={salvando} className="w-full mt-4 rounded-xl bg-surface2 text-ink font-semibold py-2.5 disabled:opacity-60">Cancelar</button>
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
    try { await salvarPix(editando); setPix(editando.trim()); setOk(true) } catch (e) { avisar.erro(e) }
    setSalvando(false)
  }

  return (
    <div className="bg-surface rounded-2xl shadow-soft p-4">
      <p className="font-bold text-ink mb-1">💰 Chave PIX do clube</p>
      <p className="text-xs text-faint mb-2">Aparece pros pais quando a mensalidade está pendente.</p>
      <div className="flex gap-2">
        <input value={editando} onChange={(e) => { setEditando(e.target.value); setOk(false) }}
          placeholder="chave PIX (CNPJ, telefone, e-mail...)"
          className="flex-1 rounded-lg bg-surface2 border border-line px-3 py-2.5 text-sm text-ink placeholder:text-faint outline-none focus:border-brand focus:ring-2 focus:ring-brand/30" />
        <button onClick={salvar} disabled={salvando || editando.trim() === pix}
          className="rounded-xl bg-gradient-to-r from-brand to-brand2 shadow-glow text-white font-bold px-4 text-sm disabled:opacity-50">
          {salvando ? '...' : ok ? '✓' : 'Salvar'}
        </button>
      </div>
    </div>
  )
}
