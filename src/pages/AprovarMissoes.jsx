import { useState, useEffect } from 'react'
import { m as motion, AnimatePresence } from 'framer-motion'
import { useClube } from '../context/Clube.jsx'
import { carregarMissoesPendentes, avaliarMissao } from '../lib/dados.js'
import Comprovacao from '../components/Comprovacao.jsx'
import { mensagemDeErro, ErroDeCarga, BotaoVoltar } from '../ui/index.jsx'
import { avisar } from '../ui/avisos.jsx'
import { EsqueletoTela } from '../ui/carregamento.jsx'

const PODE_GERIR = ['instrutor', 'diretoria']
const fmtData = (iso) => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '')

export default function AprovarMissoes() {
  const { papel: meuPapel } = useClube()
  const ehAdmin = PODE_GERIR.includes(meuPapel)
  const [lista, setLista] = useState([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState('')
  const [ampliar, setAmpliar] = useState(null)
  const [tentativa, setTentativa] = useState(0)

  useEffect(() => {
    if (!ehAdmin) { setCarregando(false); return }
    setCarregando(true); setErro('')
    carregarMissoesPendentes()
      .then((d) => { setLista(d); setCarregando(false) })
      .catch((e) => { setErro(mensagemDeErro(e, 'Não consegui carregar as missões.')); setCarregando(false) })
  }, [ehAdmin, tentativa])

  if (!ehAdmin) {
    return (
      <div className="bg-surface rounded-2xl p-8 text-center shadow-soft">
        <div className="text-4xl mb-2">🔒</div>
        <p className="font-semibold text-ink">Área da diretoria</p>
        <p className="text-sm text-faint">Apenas diretoria/instrutor aprovam missões.</p>
      </div>
    )
  }

  async function avaliar(m, aprovar) {
    try {
      await avaliarMissao(m.id, aprovar)
      setLista((l) => l.filter((x) => x.id !== m.id))
    } catch (e) {
      avisar.erro(e)
    }
  }

  return (
    <div>
      <div className="mb-1"><BotaoVoltar para="/gestao" rotulo="a Gestão" /></div>
      <div className="mb-4">
        <h2 className="text-2xl font-extrabold text-ink">🎯 Aprovar missões</h2>
        <p className="text-sm text-muted">Missões de foto aguardando sua aprovação</p>
      </div>

      {carregando ? (
        <EsqueletoTela cabecalho={false} cartoes={2} />
      ) : erro ? (
        <ErroDeCarga titulo="Não consegui carregar as missões." detalhe={erro} aoTentar={() => setTentativa((n) => n + 1)} />
      ) : lista.length === 0 ? (
        <div className="bg-surface rounded-2xl p-8 text-center shadow-soft">
          <div className="text-4xl mb-2">🎉</div>
          <p className="font-semibold text-ink">Nada pra aprovar!</p>
          <p className="text-sm text-faint">As missões de foto pendentes aparecem aqui.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {lista.map((m) => (
            <div key={m.id} className="bg-surface rounded-2xl p-4 shadow-soft">
              <div className="flex items-center justify-between gap-2 mb-2">
                <div className="font-bold text-ink truncate">{m.nome || 'Desbravador'}</div>
                <span className="text-xs text-faint shrink-0">{fmtData(m.data)}</span>
              </div>
              {m.foto_url && (
                <Comprovacao valor={m.foto_url} alt="missão" onAmpliar={setAmpliar}
                  classImg="w-full max-h-64 object-cover rounded-lg"
                  classVideo="w-full max-h-64 rounded-lg bg-black" />
              )}
              <div className="flex gap-2 mt-3">
                <button onClick={() => avaliar(m, false)} className="flex-1 rounded-lg border border-line py-2 text-sm font-semibold text-muted hover:bg-surface2">Reprovar</button>
                <button onClick={() => avaliar(m, true)} className="flex-1 rounded-lg bg-green-600 hover:bg-green-700 text-white py-2 text-sm font-semibold">✅ Aprovar (+10)</button>
              </div>
            </div>
          ))}
        </div>
      )}

      <AnimatePresence>
        {ampliar && (
          <motion.div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setAmpliar(null)}>
            <img src={ampliar} alt="missão" className="max-w-full max-h-[85vh] rounded-xl object-contain shadow-2xl" />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
