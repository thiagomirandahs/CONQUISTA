import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

const categorias = [
  { icon: '✨', nome: 'Todas' },
  { icon: '🙏', nome: 'Espiritual' },
  { icon: '🎖️', nome: 'Especialidades' },
  { icon: '🤝', nome: 'Serviço' },
  { icon: '🏕️', nome: 'Eventos' },
  { icon: '✅', nome: 'Presença' },
]
const iconeCat = { Espiritual: '🙏', Especialidades: '🎖️', Serviço: '🤝', Eventos: '🏕️', Presença: '✅' }
const unidadesAlvo = ['Todas as unidades', 'Águia', 'Falcão', 'Leão', 'Pantera']

const inputClass =
  'w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 outline-none transition focus:border-azul-claro focus:ring-2 focus:ring-azul-claro/30'

const atividadesIniciais = [
  { id: 1, categoria: 'Espiritual', titulo: 'Ler o livro de João', descricao: 'Leia 1 capítulo por dia e escreva o que aprendeu.', prazo: '2026-07-05', pts: 50, alvo: 'Todas as unidades', criterios: { foto: false, texto: true, arquivo: false }, status: 'pendente' },
  { id: 2, categoria: 'Eventos', titulo: 'Acampamento de Julho', descricao: 'Participe do acampamento e traga uma foto da sua unidade montando a barraca.', prazo: '2026-07-20', pts: 100, alvo: 'Todas as unidades', criterios: { foto: true, texto: false, arquivo: false }, status: 'pendente' },
  { id: 3, categoria: 'Serviço', titulo: 'Visita ao asilo (prazo já passou)', descricao: 'Visite o asilo e relate a experiência + envie uma foto.', prazo: '2026-06-20', pts: 70, alvo: 'Águia', criterios: { foto: true, texto: true, arquivo: false }, status: 'pendente' },
]

const fmtData = (iso) => (iso ? iso.split('-').reverse().join('/') : 'sem prazo')
const hojeISO = new Date().toISOString().slice(0, 10)
const prazoEncerrado = (iso) => iso && iso < hojeISO
function badgesCriterio(c) {
  const arr = []
  if (c.foto) arr.push('📷 Foto')
  if (c.texto) arr.push('✍️ Texto')
  if (c.arquivo) arr.push('📎 Arquivo')
  return arr.length ? arr : ['Sem comprovação']
}

export default function Atividades() {
  const [atividades, setAtividades] = useState(atividadesIniciais)
  const [filtro, setFiltro] = useState('Todas')
  const [criando, setCriando] = useState(false)
  const [entregando, setEntregando] = useState(null)

  const lista = filtro === 'Todas' ? atividades : atividades.filter((a) => a.categoria === filtro)

  function salvarNova(nova) {
    setAtividades((prev) => [nova, ...prev])
  }
  function confirmarEntrega(id) {
    setAtividades((prev) => prev.map((a) => (a.id === id ? { ...a, status: 'entregue' } : a)))
    setEntregando(null)
  }

  return (
    <div>
      <div className="mb-5 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-extrabold text-slate-800">Atividades</h2>
          <p className="text-sm text-slate-500">Entregue e ganhe pontos · líderes cadastram aqui</p>
        </div>
        <motion.button whileTap={{ scale: 0.94 }} whileHover={{ scale: 1.04 }} onClick={() => setCriando(true)}
          className="shrink-0 text-sm bg-azul text-white rounded-xl px-4 py-2 font-semibold shadow-sm">
          + Nova atividade
        </motion.button>
      </div>

      {/* Filtros por categoria */}
      <div className="flex gap-2 overflow-x-auto pb-2 mb-5 no-scrollbar">
        {categorias.map((c) => {
          const ativo = filtro === c.nome
          return (
            <button key={c.nome} onClick={() => setFiltro(c.nome)}
              className={`relative shrink-0 rounded-full px-4 py-2 text-sm font-medium transition-colors ${ativo ? 'text-white' : 'text-slate-600 bg-white border border-slate-200 hover:border-azul-claro'}`}>
              {ativo && <motion.span layoutId="cat-pill" className="absolute inset-0 bg-azul rounded-full" transition={{ type: 'spring', stiffness: 400, damping: 32 }} />}
              <span className="relative z-10"><span className="mr-1">{c.icon}</span>{c.nome}</span>
            </button>
          )
        })}
      </div>

      {/* Lista de atividades */}
      <motion.div layout className="grid sm:grid-cols-2 gap-3">
        <AnimatePresence mode="popLayout">
          {lista.map((a) => (
            <motion.div key={a.id} layout
              initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }}
              transition={{ type: 'spring', stiffness: 300, damping: 24 }}
              className="bg-white rounded-2xl p-4 shadow-sm flex flex-col gap-2">
              <div className="flex items-start gap-3">
                <div className="text-3xl">{iconeCat[a.categoria] || '📋'}</div>
                <div className="flex-1 min-w-0">
                  <div className="text-[11px] font-semibold text-azul-claro">{a.categoria} · {a.alvo}</div>
                  <div className="font-bold text-slate-800 leading-tight">{a.titulo}</div>
                  <div className="text-xs text-slate-500 mt-0.5 line-clamp-2">{a.descricao}</div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-dourado font-extrabold leading-none">+{a.pts}</div>
                  <div className="text-[10px] text-slate-400">pontos</div>
                </div>
              </div>

              {/* Critérios exigidos */}
              <div className="flex flex-wrap gap-1.5">
                {badgesCriterio(a.criterios).map((b) => (
                  <span key={b} className="text-[11px] bg-slate-100 text-slate-600 rounded-full px-2 py-0.5">{b}</span>
                ))}
              </div>

              <div className="flex items-center justify-between mt-1">
                <span className={`text-xs ${prazoEncerrado(a.prazo) ? 'text-red-400 font-medium' : 'text-slate-400'}`}>📅 {fmtData(a.prazo)}</span>
                {a.status === 'entregue' ? (
                  <span className="text-xs font-semibold text-green-600">✅ Entregue (aguardando correção)</span>
                ) : prazoEncerrado(a.prazo) ? (
                  <span className="text-xs font-semibold text-red-400">⏰ Prazo encerrado</span>
                ) : (
                  <motion.button whileTap={{ scale: 0.92 }} whileHover={{ scale: 1.05 }} onClick={() => setEntregando(a)}
                    className="text-xs bg-azul text-white rounded-lg px-3 py-1.5 font-medium">
                    Entregar
                  </motion.button>
                )}
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </motion.div>

      <p className="text-center text-xs text-slate-400 mt-6">
        🚧 Demonstração — as atividades criadas somem ao recarregar até ligarmos o banco de dados.
      </p>

      <AnimatePresence>
        {criando && <NovaAtividadeModal key="nova" onFechar={() => setCriando(false)} onSalvar={salvarNova} />}
      </AnimatePresence>
      <AnimatePresence>
        {entregando && <EntregarModal key="entrega" atividade={entregando} onFechar={() => setEntregando(null)} onConfirmar={confirmarEntrega} />}
      </AnimatePresence>
    </div>
  )
}

/* ---------- Modal: criar nova atividade (liderança) ---------- */
function NovaAtividadeModal({ onFechar, onSalvar }) {
  const [form, setForm] = useState({
    titulo: '', categoria: 'Espiritual', descricao: '', pts: 50, prazo: '', alvo: 'Todas as unidades',
    criterios: { foto: false, texto: true, arquivo: false },
  })
  const set = (campo, v) => setForm((f) => ({ ...f, [campo]: v }))
  const toggle = (c) => setForm((f) => ({ ...f, criterios: { ...f.criterios, [c]: !f.criterios[c] } }))

  function salvar(e) {
    e.preventDefault()
    onSalvar({ ...form, id: Date.now(), pts: Number(form.pts) || 0, status: 'pendente' })
    onFechar()
  }

  return (
    <Overlay onFechar={onFechar}>
      <Painel titulo="➕ Nova atividade" onFechar={onFechar}>
        <form onSubmit={salvar} className="p-5 space-y-3 overflow-y-auto">
          <Campo label="Título da atividade">
            <input className={inputClass} required value={form.titulo} onChange={(e) => set('titulo', e.target.value)} placeholder="Ex.: Ler o livro de João" />
          </Campo>
          <div className="grid grid-cols-2 gap-3">
            <Campo label="Categoria">
              <select className={inputClass} value={form.categoria} onChange={(e) => set('categoria', e.target.value)}>
                {categorias.filter((c) => c.nome !== 'Todas').map((c) => <option key={c.nome}>{c.nome}</option>)}
              </select>
            </Campo>
            <Campo label="Pontos">
              <input type="number" min="0" className={inputClass} value={form.pts} onChange={(e) => set('pts', e.target.value)} />
            </Campo>
          </div>
          <Campo label="Descrição / instruções">
            <textarea rows="3" className={inputClass} value={form.descricao} onChange={(e) => set('descricao', e.target.value)} placeholder="O que o desbravador deve fazer?" />
          </Campo>
          <div className="grid grid-cols-2 gap-3">
            <Campo label="Prazo">
              <input type="date" className={inputClass} value={form.prazo} onChange={(e) => set('prazo', e.target.value)} />
            </Campo>
            <Campo label="Para quem">
              <select className={inputClass} value={form.alvo} onChange={(e) => set('alvo', e.target.value)}>
                {unidadesAlvo.map((u) => <option key={u}>{u}</option>)}
              </select>
            </Campo>
          </div>

          <Campo label="O que precisa entregar? (critérios)">
            <div className="flex gap-2">
              <Toggle ativo={form.criterios.foto} onClick={() => toggle('foto')}>📷 Foto</Toggle>
              <Toggle ativo={form.criterios.texto} onClick={() => toggle('texto')}>✍️ Texto</Toggle>
              <Toggle ativo={form.criterios.arquivo} onClick={() => toggle('arquivo')}>📎 Arquivo</Toggle>
            </div>
          </Campo>

          <div className="flex gap-2 pt-2">
            <button type="button" onClick={onFechar} className="flex-1 rounded-lg border border-slate-300 py-2.5 font-semibold text-slate-600">Cancelar</button>
            <button type="submit" className="flex-1 rounded-lg bg-azul text-white py-2.5 font-semibold shadow">Salvar atividade</button>
          </div>
        </form>
      </Painel>
    </Overlay>
  )
}

/* ---------- Modal: entregar atividade (desbravador) ---------- */
function EntregarModal({ atividade, onFechar, onConfirmar }) {
  const [texto, setTexto] = useState('')
  const [foto, setFoto] = useState('')
  const [arquivo, setArquivo] = useState('')

  return (
    <Overlay onFechar={onFechar}>
      <Painel titulo="📤 Entregar atividade" onFechar={onFechar}>
        <div className="p-5 space-y-3 overflow-y-auto">
          <div className="bg-slate-50 rounded-xl p-3">
            <div className="font-bold text-slate-800">{atividade.titulo}</div>
            <div className="text-xs text-slate-500">{atividade.descricao}</div>
            <div className="text-xs text-dourado font-bold mt-1">Vale +{atividade.pts} pontos</div>
          </div>

          {atividade.criterios.texto && (
            <Campo label="✍️ Sua resposta">
              <textarea rows="3" className={inputClass} value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Escreva aqui..." />
            </Campo>
          )}
          {atividade.criterios.foto && (
            <Campo label="📷 Foto de comprovação">
              <input type="file" accept="image/*" className="text-sm" onChange={(e) => setFoto(e.target.files[0]?.name || '')} />
              {foto && <p className="text-xs text-green-600 mt-1">Anexado: {foto}</p>}
            </Campo>
          )}
          {atividade.criterios.arquivo && (
            <Campo label="📎 Arquivo">
              <input type="file" className="text-sm" onChange={(e) => setArquivo(e.target.files[0]?.name || '')} />
              {arquivo && <p className="text-xs text-green-600 mt-1">Anexado: {arquivo}</p>}
            </Campo>
          )}
          {!atividade.criterios.texto && !atividade.criterios.foto && !atividade.criterios.arquivo && (
            <p className="text-sm text-slate-500">Esta atividade não exige comprovação — é só confirmar a entrega. 😉</p>
          )}

          <div className="flex gap-2 pt-2">
            <button onClick={onFechar} className="flex-1 rounded-lg border border-slate-300 py-2.5 font-semibold text-slate-600">Cancelar</button>
            <button onClick={() => onConfirmar(atividade.id)} className="flex-1 rounded-lg bg-azul text-white py-2.5 font-semibold shadow">Confirmar entrega</button>
          </div>
        </div>
      </Painel>
    </Overlay>
  )
}

/* ---------- Peças reutilizáveis ---------- */
function Overlay({ children, onFechar }) {
  return (
    <motion.div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-0 sm:p-6"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onFechar}>
      {children}
    </motion.div>
  )
}
function Painel({ titulo, children, onFechar }) {
  return (
    <motion.div onClick={(e) => e.stopPropagation()}
      initial={{ y: 60, opacity: 0, scale: 0.97 }} animate={{ y: 0, opacity: 1, scale: 1 }} exit={{ y: 60, opacity: 0 }}
      transition={{ type: 'spring', stiffness: 320, damping: 30 }}
      className="bg-white w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl shadow-2xl overflow-hidden max-h-[90vh] flex flex-col">
      <div className="bg-azul text-white px-5 py-4 flex items-center justify-between">
        <h3 className="font-extrabold">{titulo}</h3>
        <button onClick={onFechar} className="w-8 h-8 rounded-full bg-white/20 grid place-items-center">✕</button>
      </div>
      {children}
    </motion.div>
  )
}
function Campo({ label, children }) {
  return (
    <div>
      <label className="block text-sm font-medium text-slate-700 mb-1">{label}</label>
      {children}
    </div>
  )
}
function Toggle({ ativo, onClick, children }) {
  return (
    <button type="button" onClick={onClick}
      className={`flex-1 rounded-xl px-2 py-2 text-sm font-medium border transition ${ativo ? 'bg-azul text-white border-azul shadow' : 'bg-white text-slate-600 border-slate-200'}`}>
      {children}
    </button>
  )
}
