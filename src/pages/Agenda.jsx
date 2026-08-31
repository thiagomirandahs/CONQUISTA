import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useAuth } from '../context/Auth.jsx'
import { carregarEventos, salvarEvento, excluirEvento } from '../lib/dados.js'

const PODE_GERIR = ['instrutor', 'diretoria']
const TIPOS = ['Reunião', 'Acampamento', 'Passeio', 'Culto', 'Evento']
const iconeTipo = { Reunião: '📋', Acampamento: '🏕️', Passeio: '🥾', Culto: '🙏', Evento: '🎉' }
const DIAS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']
const inputClass =
  'w-full rounded-lg border border-line bg-surface2 px-3 py-2.5 text-sm text-ink outline-none placeholder:text-faint focus:border-brand focus:ring-2 focus:ring-brand/30'

function fmtDataLonga(iso) {
  if (!iso) return ''
  const [a, m, d] = String(iso).slice(0, 10).split('-').map(Number)
  const dt = new Date(a, m - 1, d)
  return `${DIAS[dt.getDay()]}, ${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}`
}
const curto = (iso) => (iso ? String(iso).slice(0, 10).split('-').reverse().slice(0, 2).join('/') : '')

// Data/hora do evento em milissegundos (local). fimDoDia = 23:59 (fim do período).
function msEvento(dataIso, hora, fimDoDia = false) {
  if (!dataIso) return null
  const [a, m, d] = String(dataIso).slice(0, 10).split('-').map(Number)
  let hh = fimDoDia ? 23 : 0, mm = fimDoDia ? 59 : 0
  if (!fimDoDia && hora && /^\d{1,2}:\d{2}/.test(hora)) { const [h, mi] = hora.split(':').map(Number); hh = h; mm = mi }
  return new Date(a, m - 1, d, hh, mm, fimDoDia ? 59 : 0).getTime()
}

// Contagem regressiva pro INÍCIO (ou "acontecendo" durante o período 4→7).
function contagem(ev, agora) {
  const inicio = msEvento(ev.data, ev.hora)
  const fim = msEvento(ev.data_fim || ev.data, null, true)
  if (inicio == null || agora > fim) return null
  if (agora >= inicio && agora <= fim) return { cor: 'verde', txt: '🔴 Acontecendo agora!' }
  const hoje0 = new Date(); hoje0.setHours(0, 0, 0, 0)
  const [a, m, d] = String(ev.data).slice(0, 10).split('-').map(Number)
  const dias = Math.round((new Date(a, m - 1, d).getTime() - hoje0.getTime()) / 86400000)
  if (dias <= 0) {
    const ms = inicio - agora, h = Math.floor(ms / 3600000), mi = Math.floor((ms % 3600000) / 60000)
    return { cor: 'vermelho', txt: h >= 1 ? `⏰ É HOJE! faltam ${h}h ${mi}min` : `⏰ É HOJE! faltam ${mi} min` }
  }
  if (dias === 1) return { cor: 'vermelho', txt: '🎉 É amanhã!' }
  return { cor: dias <= 3 ? 'amarelo' : 'brand', txt: `⏳ faltam ${dias} dias` }
}
const CORES_CONT = {
  verde: 'bg-green-100 text-green-700', vermelho: 'bg-red-100 text-red-600',
  amarelo: 'bg-amber-100 text-amber-700', brand: 'bg-brand/10 text-brand',
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
  const [agora, setAgora] = useState(Date.now())

  async function carregar() {
    setCarregando(true); setErro('')
    try { setLista(await carregarEventos()) } catch (e) { setErro(e?.message || 'Erro') }
    setCarregando(false)
  }
  useEffect(() => { carregar() }, [])
  // relógio pra contagem regressiva ficar ao vivo
  useEffect(() => { const t = setInterval(() => setAgora(Date.now()), 1000); return () => clearInterval(t) }, [])

  async function excluir(ev) {
    if (!window.confirm(`Apagar "${ev.titulo}" da agenda?`)) return
    try { await excluirEvento(ev.id); carregar() }
    catch (e) { alert('Não foi possível: ' + (e?.message || e)) }
  }

  return (
    <div>
      <div className="mb-4 flex items-start justify-between gap-2">
        <div>
          <h2 className="text-2xl font-extrabold text-ink">📅 Agenda</h2>
          <p className="text-sm text-muted">Próximas reuniões e eventos do clube</p>
        </div>
        {ehAdmin && (
          <motion.button whileTap={{ scale: 0.94 }} onClick={() => setEditando({})}
            className="shrink-0 text-sm bg-gradient-to-r from-brand to-brand2 text-white rounded-xl px-4 py-2 font-semibold shadow-glow">+ Novo</motion.button>
        )}
      </div>

      {carregando ? (
        <p className="text-faint text-sm">Carregando...</p>
      ) : erro ? (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 text-sm text-amber-800">
          <p className="font-semibold mb-1">Não consegui carregar a agenda</p>
          <p className="text-xs">Se a página é nova, rode <code className="bg-amber-100 rounded px-1">supabase/2026-07-09-agenda.sql</code> no Supabase.</p>
        </div>
      ) : lista.length === 0 ? (
        <div className="bg-surface rounded-2xl p-8 text-center shadow-soft">
          <div className="text-4xl mb-2">📅</div>
          <p className="font-semibold text-ink">Nenhum evento marcado</p>
          <p className="text-sm text-faint">{ehAdmin ? 'Toque em "+ Novo" pra marcar o próximo.' : 'A liderança ainda vai marcar os próximos eventos.'}</p>
        </div>
      ) : (
        <motion.div className="space-y-2" initial="hide" animate="show" variants={{ show: { transition: { staggerChildren: 0.06 } } }}>
          {lista.map((ev) => (
            <motion.div key={ev.id} variants={{ hide: { opacity: 0, y: 14 }, show: { opacity: 1, y: 0 } }} className="bg-surface rounded-2xl p-4 shadow-soft flex gap-3">
              <div className="text-3xl shrink-0">{iconeTipo[ev.tipo] || '📅'}</div>
              <div className="flex-1 min-w-0">
                <div className="text-[11px] font-bold text-brand2">{ev.tipo || 'Evento'}</div>
                <div className="font-bold text-ink break-words">{ev.titulo}</div>
                <div className="text-xs text-muted mt-0.5">
                  📅 {fmtDataLonga(ev.data)}{ev.data_fim ? ` a ${curto(ev.data_fim)}` : ''}{ev.hora ? ` · ${ev.hora}` : ''}{ev.local ? ` · 📍 ${ev.local}` : ''}
                </div>
                {(() => {
                  const c = contagem(ev, agora)
                  return c ? <span className={`inline-block mt-1.5 text-[11px] font-extrabold rounded-full px-2.5 py-1 ${CORES_CONT[c.cor]}`}>{c.txt}</span> : null
                })()}
                {ev.descricao && <div className="text-xs text-muted mt-1 break-words">{ev.descricao}</div>}
              </div>
              {ehAdmin && (
                <div className="flex flex-col gap-2 shrink-0">
                  <button onClick={() => setEditando(ev)} title="Editar" className="text-base text-muted hover:bg-surface2 rounded-lg p-2">✏️</button>
                  <button onClick={() => excluir(ev)} title="Apagar" className="text-base text-red-500 hover:bg-red-50 rounded-lg p-2">🗑️</button>
                </div>
              )}
            </motion.div>
          ))}
          <p className="text-[11px] text-faint mt-2 text-center">Na véspera, quem ativou os avisos recebe um lembrete no celular. 🔔</p>
        </motion.div>
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
    data_fim: inicial?.data_fim ? String(inicial.data_fim).slice(0, 10) : '',
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
        data_fim: form.data_fim || null,
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
        className="bg-surface w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl shadow-2xl overflow-hidden max-h-[92vh] flex flex-col">
        <div className="bg-gradient-to-r from-brand to-brand2 text-white px-5 py-4 flex items-center justify-between shrink-0">
          <h3 className="font-extrabold">{inicial ? 'Editar evento' : 'Novo evento'}</h3>
          <button onClick={onFechar} className="w-8 h-8 rounded-full bg-white/20 grid place-items-center">✕</button>
        </div>
        <form onSubmit={salvar} className="p-5 space-y-3 overflow-y-auto">
          <div>
            <label className="block text-sm font-medium text-ink mb-1">Título</label>
            <input className={inputClass} value={form.titulo} onChange={(e) => set('titulo', e.target.value)} placeholder="Ex.: Reunião de sábado" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-ink mb-1">Tipo</label>
              <select className={inputClass} value={form.tipo} onChange={(e) => set('tipo', e.target.value)}>
                {TIPOS.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-ink mb-1">Hora</label>
              <input type="time" className={inputClass} value={form.hora} onChange={(e) => set('hora', e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-ink mb-1">Data {form.data_fim ? '(início)' : ''}</label>
              <input type="date" className={inputClass} value={form.data} onChange={(e) => set('data', e.target.value)} />
            </div>
            <div>
              <label className="block text-sm font-medium text-ink mb-1">Fim <span className="text-faint font-normal">(opcional)</span></label>
              <input type="date" className={inputClass} value={form.data_fim} min={form.data || undefined} onChange={(e) => set('data_fim', e.target.value)} />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-ink mb-1">Local (opcional)</label>
            <input className={inputClass} value={form.local} onChange={(e) => set('local', e.target.value)} placeholder="Ex.: Igreja Central" />
          </div>
          <div>
            <label className="block text-sm font-medium text-ink mb-1">Detalhes (opcional)</label>
            <textarea rows="2" className={inputClass} value={form.descricao} onChange={(e) => set('descricao', e.target.value)} placeholder="Ex.: Trazer uniforme completo" />
          </div>
          {erro && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3">{erro}</div>}
          <div className="flex gap-2 pt-1">
            <button type="button" onClick={onFechar} className="flex-1 rounded-lg border border-line py-2.5 font-semibold text-muted">Cancelar</button>
            <button type="submit" disabled={salvando} className="flex-1 rounded-lg bg-gradient-to-r from-brand to-brand2 text-white py-2.5 font-semibold shadow-glow disabled:opacity-60">{salvando ? 'Salvando...' : 'Salvar'}</button>
          </div>
        </form>
      </motion.div>
    </motion.div>
  )
}
