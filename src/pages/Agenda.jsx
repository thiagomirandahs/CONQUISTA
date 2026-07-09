import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useAuth } from '../context/Auth.jsx'
import { carregarEventos, salvarEvento, excluirEvento } from '../lib/dados.js'

const PODE_GERIR = ['instrutor', 'diretoria']
const TIPOS = ['Reunião', 'Acampamento', 'Passeio', 'Culto', 'Evento']
const iconeTipo = { Reunião: '📋', Acampamento: '🏕️', Passeio: '🥾', Culto: '🙏', Evento: '🎉' }
const DIAS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']
const inputClass =
  'w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-azul-claro focus:ring-2 focus:ring-azul-claro/30'

function fmtDataLonga(iso) {
  if (!iso) return ''
  const [a, m, d] = String(iso).slice(0, 10).split('-').map(Number)
  const dt = new Date(a, m - 1, d)
  return `${DIAS[dt.getDay()]}, ${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}`
}

// Agenda do clube: próximos eventos pra todo mundo; a liderança cria/edita.
// O lembrete na véspera sai sozinho (pg_cron -> notificacoes -> push).
export default function Agenda() {
  const { profile } = useAuth()
  const ehAdmin = PODE_GERIR.includes(profile?.papel)
  const [lista, setLista] = useState([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState('')
  const [editando, setEditando] = useState(null)

  async function carregar() {
    setCarregando(true); setErro('')
    try { setLista(await carregarEventos()) } catch (e) { setErro(e?.message || 'Erro') }
    setCarregando(false)
  }
  useEffect(() => { carregar() }, [])

  async function excluir(ev) {
    if (!window.confirm(`Apagar "${ev.titulo}" da agenda?`)) return
    try { await excluirEvento(ev.id); carregar() }
    catch (e) { alert('Não foi possível: ' + (e?.message || e)) }
  }

  return (
    <div>
      <div className="mb-4 flex items-start justify-between gap-2">
        <div>
          <h2 className="text-2xl font-extrabold text-slate-800">📅 Agenda</h2>
          <p className="text-sm text-slate-500">Próximas reuniões e eventos do clube</p>
        </div>
        {ehAdmin && (
          <motion.button whileTap={{ scale: 0.94 }} onClick={() => setEditando({})}
            className="shrink-0 text-sm bg-azul text-white rounded-xl px-4 py-2 font-semibold shadow-sm">+ Novo</motion.button>
        )}
      </div>

      {carregando ? (
        <p className="text-slate-400 text-sm">Carregando...</p>
      ) : erro ? (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 text-sm text-amber-800">
          <p className="font-semibold mb-1">Não consegui carregar a agenda</p>
          <p className="text-xs">Se a página é nova, rode <code className="bg-amber-100 rounded px-1">supabase/2026-07-09-agenda.sql</code> no Supabase.</p>
        </div>
      ) : lista.length === 0 ? (
        <div className="bg-white rounded-2xl p-8 text-center shadow-sm">
          <div className="text-4xl mb-2">📅</div>
          <p className="font-semibold text-slate-700">Nenhum evento marcado</p>
          <p className="text-sm text-slate-400">{ehAdmin ? 'Toque em "+ Novo" pra marcar o próximo.' : 'A liderança ainda vai marcar os próximos eventos.'}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {lista.map((ev) => (
            <div key={ev.id} className="bg-white rounded-2xl p-4 shadow-sm flex gap-3">
              <div className="text-3xl shrink-0">{iconeTipo[ev.tipo] || '📅'}</div>
              <div className="flex-1 min-w-0">
                <div className="text-[11px] font-bold text-azul-claro">{ev.tipo || 'Evento'}</div>
                <div className="font-bold text-slate-800 break-words">{ev.titulo}</div>
                <div className="text-xs text-slate-500 mt-0.5">
                  📅 {fmtDataLonga(ev.data)}{ev.hora ? ` · ${ev.hora}` : ''}{ev.local ? ` · 📍 ${ev.local}` : ''}
                </div>
                {ev.descricao && <div className="text-xs text-slate-500 mt-1 break-words">{ev.descricao}</div>}
              </div>
              {ehAdmin && (
                <div className="flex flex-col gap-1 shrink-0">
                  <button onClick={() => setEditando(ev)} title="Editar" className="text-xs text-slate-500 hover:bg-slate-100 rounded-lg px-2 py-1">✏️</button>
                  <button onClick={() => excluir(ev)} title="Apagar" className="text-xs text-red-500 hover:bg-red-50 rounded-lg px-2 py-1">🗑️</button>
                </div>
              )}
            </div>
          ))}
          <p className="text-[11px] text-slate-400 mt-2 text-center">Na véspera, quem ativou os avisos recebe um lembrete no celular. 🔔</p>
        </div>
      )}

      <AnimatePresence>
        {editando && (
          <FormEvento inicial={editando.id ? editando : null} criadoPor={profile?.id}
            onFechar={() => setEditando(null)} onSalvo={() => { setEditando(null); carregar() }} />
        )}
      </AnimatePresence>
    </div>
  )
}

function FormEvento({ inicial, criadoPor, onFechar, onSalvo }) {
  const [form, setForm] = useState(() => ({
    titulo: inicial?.titulo || '', tipo: inicial?.tipo || 'Reunião',
    data: inicial?.data ? String(inicial.data).slice(0, 10) : '',
    hora: inicial?.hora || '', local: inicial?.local || '', descricao: inicial?.descricao || '',
  }))
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  async function salvar(e) {
    e.preventDefault()
    setErro('')
    if (!form.titulo.trim()) return setErro('Dê um título ao evento.')
    if (!form.data) return setErro('Escolha a data.')
    setSalvando(true)
    try {
      await salvarEvento({
        titulo: form.titulo.trim(), tipo: form.tipo, data: form.data,
        hora: form.hora.trim() || null, local: form.local.trim() || null,
        descricao: form.descricao.trim() || null,
        ...(inicial ? {} : { criado_por: criadoPor }),
      }, inicial?.id)
      onSalvo()
    } catch (e2) { setErro(e2?.message || String(e2)); setSalvando(false) }
  }

  return (
    <motion.div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-0 sm:p-6"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onFechar}>
      <motion.div onClick={(e) => e.stopPropagation()}
        initial={{ y: 60, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 60, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 320, damping: 30 }}
        className="bg-white w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl shadow-2xl overflow-hidden max-h-[92vh] flex flex-col">
        <div className="bg-azul text-white px-5 py-4 flex items-center justify-between shrink-0">
          <h3 className="font-extrabold">{inicial ? 'Editar evento' : 'Novo evento'}</h3>
          <button onClick={onFechar} className="w-8 h-8 rounded-full bg-white/20 grid place-items-center">✕</button>
        </div>
        <form onSubmit={salvar} className="p-5 space-y-3 overflow-y-auto">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Título</label>
            <input className={inputClass} value={form.titulo} onChange={(e) => set('titulo', e.target.value)} placeholder="Ex.: Reunião de sábado" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Tipo</label>
              <select className={inputClass} value={form.tipo} onChange={(e) => set('tipo', e.target.value)}>
                {TIPOS.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Hora</label>
              <input type="time" className={inputClass} value={form.hora} onChange={(e) => set('hora', e.target.value)} />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Data</label>
            <input type="date" className={inputClass} value={form.data} onChange={(e) => set('data', e.target.value)} />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Local (opcional)</label>
            <input className={inputClass} value={form.local} onChange={(e) => set('local', e.target.value)} placeholder="Ex.: Igreja Central" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Detalhes (opcional)</label>
            <textarea rows="2" className={inputClass} value={form.descricao} onChange={(e) => set('descricao', e.target.value)} placeholder="Ex.: Trazer uniforme completo" />
          </div>
          {erro && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3">{erro}</div>}
          <div className="flex gap-2 pt-1">
            <button type="button" onClick={onFechar} className="flex-1 rounded-lg border border-slate-300 py-2.5 font-semibold text-slate-600">Cancelar</button>
            <button type="submit" disabled={salvando} className="flex-1 rounded-lg bg-azul text-white py-2.5 font-semibold shadow disabled:opacity-60">{salvando ? 'Salvando...' : 'Salvar'}</button>
          </div>
        </form>
      </motion.div>
    </motion.div>
  )
}
