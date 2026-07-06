import { useState } from 'react'
import { motion } from 'framer-motion'
import { useAuth } from '../context/Auth.jsx'
import { enviarAviso } from '../lib/dados.js'

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
    </div>
  )
}
