import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { supabase } from '../lib/supabase.js'
import { carregarRanking, lancarPontosUnidade } from '../lib/dados.js'
import { useAuth } from '../context/Auth.jsx'
import Avatar from '../components/Avatar.jsx'

const medalhas = ['🥇', '🥈', '🥉']
const PODE_GERIR = ['instrutor', 'diretoria']

export default function Unidades() {
  const { profile } = useAuth()
  const ehAdmin = PODE_GERIR.includes(profile?.papel)
  const [unidades, setUnidades] = useState([])
  const [carregando, setCarregando] = useState(true)
  const [sel, setSel] = useState(null)
  const [pontosPara, setPontosPara] = useState(null) // unidade que vai receber pontos de time

  async function carregar() {
    const { unidades } = await carregarRanking()
    setUnidades(unidades)
    setCarregando(false)
  }
  useEffect(() => { carregar() }, [])

  async function novaUnidade() {
    const nome = window.prompt('Nome da nova unidade:')
    if (!nome?.trim()) return
    const { error } = await supabase.from('unidades').insert({ nome: nome.trim() })
    if (error) alert('Não foi possível criar: ' + error.message)
    else carregar()
  }

  async function excluirUnidade(u) {
    if (!window.confirm(`Excluir a unidade "${u.nome}"? Os membros dela ficarão sem unidade.`)) return
    // tira os membros da unidade antes de apagar (evita erro de vínculo)
    await supabase.from('profiles').update({ unidade_id: null }).eq('unidade_id', u.id)
    const { error } = await supabase.from('unidades').delete().eq('id', u.id)
    if (error) { alert('Não foi possível excluir: ' + error.message); return }
    setSel(null)
    carregar()
  }

  async function trocarImagem(u, file) {
    const ext = (file.name.split('.').pop() || 'jpg').toLowerCase()
    const path = `unidades/${u.id}-${Date.now()}.${ext}`
    const { error: upErr } = await supabase.storage.from('imagens').upload(path, file, { upsert: true })
    if (upErr) { alert('Erro no upload: ' + upErr.message); return }
    const { data: pub } = supabase.storage.from('imagens').getPublicUrl(path)
    const { error } = await supabase.from('unidades').update({ emblema: pub.publicUrl }).eq('id', u.id)
    if (error) { alert('Erro ao salvar: ' + error.message); return }
    setSel((s) => (s ? { ...s, emblema: pub.publicUrl } : s))
    carregar()
  }

  return (
    <div>
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-extrabold text-slate-800">Unidades</h2>
          <p className="text-sm text-slate-500">Toque numa unidade para ver os membros</p>
        </div>
        {ehAdmin && (
          <motion.button whileTap={{ scale: 0.94 }} whileHover={{ scale: 1.04 }} onClick={novaUnidade}
            className="text-sm bg-azul text-white rounded-xl px-4 py-2 font-medium shadow-sm">
            + Nova
          </motion.button>
        )}
      </div>

      {carregando ? (
        <p className="text-slate-400 text-sm">Carregando...</p>
      ) : unidades.length === 0 ? (
        <div className="bg-white rounded-2xl p-8 text-center shadow-sm">
          <div className="text-4xl mb-2">🏠</div>
          <p className="font-semibold text-slate-700">Nenhuma unidade ainda</p>
          <p className="text-sm text-slate-400">{ehAdmin ? 'Toque em "+ Nova" para criar a primeira.' : 'A diretoria ainda vai cadastrar as unidades.'}</p>
        </div>
      ) : (
        <motion.div className="grid grid-cols-2 lg:grid-cols-4 gap-3"
          initial="hide" animate="show" variants={{ show: { transition: { staggerChildren: 0.08 } } }}>
          {unidades.map((u) => (
            <motion.button key={u.id} onClick={() => setSel(u)}
              variants={{ hide: { opacity: 0, y: 24, scale: 0.92 }, show: { opacity: 1, y: 0, scale: 1 } }}
              transition={{ type: 'spring', stiffness: 300, damping: 22 }}
              whileHover={{ y: -6 }} whileTap={{ scale: 0.97 }}
              className="bg-white rounded-2xl shadow-sm overflow-hidden text-left">
              <div className="h-2" style={{ backgroundColor: u.cor }} />
              <div className="p-4">
                {u.emblema ? (
                  <img src={u.emblema} alt={u.nome} className="w-11 h-11 rounded-full object-cover mb-2 shadow" />
                ) : (
                  <div className="w-11 h-11 rounded-full grid place-items-center text-white font-bold text-lg mb-2 shadow"
                    style={{ backgroundColor: u.cor }}>
                    {u.nome?.[0]?.toUpperCase()}
                  </div>
                )}
                <div className="font-bold text-slate-800">{u.nome}</div>
                <div className="text-xs text-slate-400 mb-3">{u.membros.length} membros</div>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-slate-400">Pontos</span>
                  <span className="text-dourado font-extrabold">{u.pontos} pts</span>
                </div>
                <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                  <motion.div className="h-full rounded-full" style={{ backgroundColor: u.cor }}
                    initial={{ width: 0 }} animate={{ width: `${Math.min(u.pontos, 100)}%` }}
                    transition={{ duration: 0.8, ease: 'easeOut', delay: 0.2 }} />
                </div>
                <div className="text-[10px] text-slate-400 mt-1">time {u.avulsos} + média {u.media}</div>
              </div>
            </motion.button>
          ))}
        </motion.div>
      )}

      <AnimatePresence>
        {sel && (
          <motion.div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-0 sm:p-6"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setSel(null)}>
            <motion.div onClick={(e) => e.stopPropagation()}
              initial={{ y: 60, opacity: 0, scale: 0.98 }} animate={{ y: 0, opacity: 1, scale: 1 }} exit={{ y: 60, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 320, damping: 30 }}
              className="bg-white w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl shadow-2xl overflow-hidden max-h-[85vh] flex flex-col">
              <div className="p-5 text-white relative" style={{ backgroundColor: sel.cor }}>
                <button onClick={() => setSel(null)} className="absolute top-4 right-4 w-8 h-8 rounded-full bg-white/20 grid place-items-center">✕</button>
                {sel.emblema ? (
                  <img src={sel.emblema} alt={sel.nome} className="w-14 h-14 rounded-full object-cover mb-2 ring-2 ring-white/40" />
                ) : (
                  <div className="w-14 h-14 rounded-full bg-white/20 grid place-items-center text-2xl font-extrabold mb-2">{sel.nome?.[0]?.toUpperCase()}</div>
                )}
                <h3 className="text-2xl font-extrabold">{sel.nome}</h3>
                <div className="flex gap-4 mt-2 text-sm">
                  <span>👥 {sel.membros.length} membros</span>
                  <span>⭐ {sel.pontos} pts</span>
                </div>
                <div className="text-xs text-white/80 mt-1">time {sel.avulsos} + média dos membros {sel.media}</div>
              </div>
              <div className="p-3 overflow-y-auto">
                <p className="text-xs font-semibold text-slate-400 px-2 mb-1">MEMBROS</p>
                {sel.membros.length === 0 ? (
                  <p className="text-sm text-slate-400 px-2 py-4 text-center">Nenhum membro aprovado nesta unidade ainda.</p>
                ) : sel.membros.map((m, i) => (
                  <div key={m.id} className="flex items-center gap-3 px-2 py-2.5 rounded-xl hover:bg-slate-50">
                    <Avatar foto={m.foto} nome={m.nome} cor={sel.cor} size="w-9 h-9" textSize="text-sm" />
                    <span className="flex-1 font-medium text-slate-800">{m.nome}</span>
                    <span className="text-lg">{medalhas[i] || ''}</span>
                    <span className="font-extrabold text-azul">{m.pts}</span>
                  </div>
                ))}
              </div>
              {ehAdmin && (
                <div className="p-3 border-t border-slate-100 space-y-2">
                  <button onClick={() => setPontosPara(sel)}
                    className="w-full text-sm text-white bg-azul hover:bg-azul-claro rounded-xl py-2.5 font-semibold">
                    🏆 Lançar pontos pra unidade
                  </button>
                  <div className="flex gap-2">
                    <label className="flex-1 text-sm text-azul bg-azul/10 hover:bg-azul/20 rounded-xl py-2.5 font-semibold text-center cursor-pointer">
                      📷 Imagem
                      <input type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files[0] && trocarImagem(sel, e.target.files[0])} />
                    </label>
                    <button onClick={() => excluirUnidade(sel)}
                      className="flex-1 text-sm text-red-600 bg-red-50 hover:bg-red-100 rounded-xl py-2.5 font-semibold">
                      🗑️ Excluir
                    </button>
                  </div>
                </div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Modal: lançar pontos avulsos pra unidade (só liderança) */}
      <AnimatePresence>
        {pontosPara && (
          <PontosUnidade
            unidade={pontosPara}
            onFechar={() => setPontosPara(null)}
            onLancar={async (valor, motivo) => {
              await lancarPontosUnidade({ unidadeId: pontosPara.id, pontos: valor, motivo, lancadoPor: profile?.id })
              setPontosPara(null)
              setSel(null)
              carregar()
            }}
          />
        )}
      </AnimatePresence>
    </div>
  )
}

function PontosUnidade({ unidade, onLancar, onFechar }) {
  const [valor, setValor] = useState('')
  const [motivo, setMotivo] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')

  async function enviar(e) {
    e.preventDefault()
    const n = parseInt(valor, 10)
    if (!n) { setErro('Digite uma quantidade de pontos (ex.: 50).'); return }
    setSalvando(true)
    setErro('')
    try {
      await onLancar(n, motivo.trim())
    } catch (err) {
      setErro('Não foi possível lançar: ' + (err?.message || err))
      setSalvando(false)
    }
  }

  return (
    <motion.div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[60] flex items-end sm:items-center justify-center p-0 sm:p-6"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onFechar}>
      <motion.form onClick={(e) => e.stopPropagation()} onSubmit={enviar}
        initial={{ y: 60, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 60, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 320, damping: 28 }}
        className="bg-white w-full sm:max-w-sm rounded-t-3xl sm:rounded-3xl shadow-2xl p-6">
        <h3 className="text-lg font-extrabold text-slate-800 mb-1">🏆 Pontos pra unidade</h3>
        <p className="text-sm text-slate-500 mb-4">Pontos de time para <strong>{unidade.nome}</strong> (entram no ranking da unidade).</p>

        <label className="block text-xs font-semibold text-slate-500 mb-1">Pontos</label>
        <input type="number" value={valor} onChange={(e) => setValor(e.target.value)} placeholder="ex.: 50"
          className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-azul-claro focus:ring-2 focus:ring-azul-claro/30 mb-2" />
        <div className="flex gap-1.5 mb-3">
          {[10, 20, 50, 100].map((q) => (
            <button type="button" key={q} onClick={() => setValor(String(q))}
              className="flex-1 rounded-lg py-1.5 text-xs font-semibold border border-slate-200 text-slate-600 hover:bg-slate-50">+{q}</button>
          ))}
        </div>

        <label className="block text-xs font-semibold text-slate-500 mb-1">Motivo (opcional)</label>
        <input type="text" value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={120} placeholder="ex.: Venceu a gincana"
          className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-azul-claro focus:ring-2 focus:ring-azul-claro/30 mb-3" />

        {erro && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3 mb-3">{erro}</div>}

        <div className="flex gap-2">
          <button type="button" onClick={onFechar} className="flex-1 rounded-xl bg-slate-100 text-slate-700 font-semibold py-2.5">Cancelar</button>
          <motion.button type="submit" disabled={salvando} whileTap={{ scale: 0.97 }}
            className="flex-1 rounded-xl bg-azul text-white font-semibold py-2.5 disabled:opacity-60">
            {salvando ? 'Lançando...' : 'Lançar'}
          </motion.button>
        </div>
      </motion.form>
    </motion.div>
  )
}
