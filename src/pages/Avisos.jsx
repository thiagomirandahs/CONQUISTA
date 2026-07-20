import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { useAuth } from '../context/Auth.jsx'
import { enviarAviso, lerConfigPopup, salvarConfigPopup } from '../lib/dados.js'

const PODE_GERIR = ['instrutor', 'diretoria']
const inputClass =
  'w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-azul-claro focus:ring-2 focus:ring-azul-claro/30'

// Tela pra liderança mandar um recado geral ("Reunião sábado 15h", etc.).
// Aparece no sino de todo mundo e, com o push ligado, chega no celular.
export default function Avisos() {
  const { profile } = useAuth()
  const ehAdmin = PODE_GERIR.includes(profile?.papel)
  const [titulo, setTitulo] = useState('')
  const [corpo, setCorpo] = useState('')
  const [para, setPara] = useState('todos')
  const [enviando, setEnviando] = useState(false)
  const [ok, setOk] = useState(false)
  const [erro, setErro] = useState('')

  if (!ehAdmin) {
    return (
      <div className="bg-white rounded-2xl p-8 text-center shadow-sm">
        <div className="text-4xl mb-2">🔒</div>
        <p className="font-semibold text-slate-700">Área da liderança</p>
        <p className="text-sm text-slate-400">Apenas diretoria/instrutor podem enviar avisos.</p>
      </div>
    )
  }

  async function enviar(e) {
    e.preventDefault()
    if (!titulo.trim()) { setErro('Escreva um título pro aviso.'); return }
    setEnviando(true); setErro('')
    try {
      await enviarAviso({ titulo: titulo.trim(), corpo: corpo.trim(), para, criadoPor: profile?.id })
      setOk(true)
      setTitulo(''); setCorpo('')
      setTimeout(() => setOk(false), 3000)
    } catch (e2) {
      setErro('Não foi possível enviar: ' + (e2?.message || e2))
    }
    setEnviando(false)
  }

  return (
    <div>
      <div className="mb-4">
        <h2 className="text-2xl font-extrabold text-slate-800">📣 Enviar aviso</h2>
        <p className="text-sm text-slate-500">Um recado pra todo mundo (ou só pra liderança)</p>
      </div>

      <form onSubmit={enviar} className="bg-white rounded-2xl p-5 shadow-sm space-y-3">
        <div>
          <label className="block text-xs font-semibold text-slate-500 mb-1">Título</label>
          <input className={inputClass} value={titulo} onChange={(e) => setTitulo(e.target.value)} maxLength={80}
            placeholder="Ex.: Reunião neste sábado às 15h" />
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-500 mb-1">Detalhes (opcional)</label>
          <textarea rows="3" className={inputClass} value={corpo} onChange={(e) => setCorpo(e.target.value)} maxLength={280}
            placeholder="Ex.: Traga o uniforme completo e a carteirinha." />
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-500 mb-1">Quem recebe</label>
          <div className="flex gap-2">
            {[['todos', '👨‍👩‍👧 Todo o clube'], ['lideranca', '⭐ Só a liderança']].map(([k, lbl]) => (
              <button type="button" key={k} onClick={() => setPara(k)}
                className={`flex-1 rounded-lg py-2 text-sm font-semibold border transition ${para === k ? 'bg-azul text-white border-azul' : 'bg-white text-slate-600 border-slate-200'}`}>{lbl}</button>
            ))}
          </div>
        </div>

        {erro && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3">{erro}</div>}
        {ok && <div className="bg-green-50 border border-green-200 text-green-700 text-sm rounded-lg p-3">✅ Aviso enviado! Já aparece no sino de todos.</div>}

        <motion.button whileTap={{ scale: 0.98 }} type="submit" disabled={enviando}
          className="w-full bg-azul text-white font-bold rounded-xl py-3 shadow disabled:opacity-60">
          {enviando ? 'Enviando...' : '📣 Enviar aviso'}
        </motion.button>
      </form>

      <p className="text-center text-xs text-slate-400 mt-3">O aviso aparece no 🔔 de quem você escolher. Se o push estiver ligado, também chega no celular.</p>

      <PopupAviso />
    </div>
  )
}

// Popup que abre NA CARA de quem entra no app. Texto livre, editado aqui.
function PopupAviso() {
  const [cfg, setCfg] = useState(null)
  const [salvando, setSalvando] = useState(false)
  const [ok, setOk] = useState(false)

  useEffect(() => {
    lerConfigPopup()
      .then(setCfg)
      .catch(() => setCfg({ ativo: false, titulo: '', texto: '', alvo: 'todos' }))
  }, [])

  if (!cfg) return null
  const set = (k, v) => { setCfg((c) => ({ ...c, [k]: v })); setOk(false) }

  async function salvar() {
    setSalvando(true)
    try { await salvarConfigPopup(cfg); setOk(true) }
    catch (e) { alert('Não deu pra salvar: ' + (e?.message || e)) }
    setSalvando(false)
  }

  return (
    <div className="bg-white rounded-2xl p-5 shadow-sm mt-5 space-y-3">
      <div>
        <h3 className="font-extrabold text-slate-800">🔔 Popup de aviso</h3>
        <p className="text-xs text-slate-400">Abre na tela de quem entrar no app. Escreva o que quiser.</p>
      </div>

      <label className="flex items-center gap-2 text-sm text-slate-700">
        <input type="checkbox" checked={cfg.ativo} onChange={(e) => set('ativo', e.target.checked)} className="w-4 h-4 accent-azul" />
        Ligado (mostrar o popup)
      </label>

      <div>
        <label className="block text-xs font-semibold text-slate-500 mb-1">Título</label>
        <input className={inputClass} value={cfg.titulo} onChange={(e) => set('titulo', e.target.value)} maxLength={60}
          placeholder="Ex.: Mensalidade de julho" />
      </div>
      <div>
        <label className="block text-xs font-semibold text-slate-500 mb-1">Mensagem</label>
        <textarea rows="4" className={inputClass} value={cfg.texto} onChange={(e) => set('texto', e.target.value)} maxLength={400}
          placeholder={'Ex.: A mensalidade é R$ 30 e vence dia 10.\nPague no PIX do clube e avise a tesouraria. 🙂'} />
      </div>
      <div>
        <label className="block text-xs font-semibold text-slate-500 mb-1">Quem vê o popup</label>
        <div className="flex gap-2">
          {[['todos', '👥 Todo mundo'], ['devendo', '💰 Só quem está devendo']].map(([k, lbl]) => (
            <button type="button" key={k} onClick={() => set('alvo', k)}
              className={`flex-1 rounded-lg py-2 text-sm font-semibold border transition ${cfg.alvo === k ? 'bg-azul text-white border-azul' : 'bg-white text-slate-600 border-slate-200'}`}>{lbl}</button>
          ))}
        </div>
      </div>

      {ok && <div className="bg-green-50 border border-green-200 text-green-700 text-sm rounded-lg p-3">✅ Salvo! Quem abrir o app vai ver.</div>}

      <button onClick={salvar} disabled={salvando || (cfg.ativo && !cfg.texto.trim())}
        className="w-full bg-azul text-white font-bold rounded-xl py-3 shadow disabled:opacity-60">
        {salvando ? 'Salvando...' : 'Salvar popup'}
      </button>
      <p className="text-[11px] text-slate-400">
        Aparece 1x por dia pra cada pessoa. Se você mudar o texto, ele reaparece na hora — mesmo pra quem já tinha fechado.
      </p>
    </div>
  )
}
