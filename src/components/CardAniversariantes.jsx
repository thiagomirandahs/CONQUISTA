import { useState, useEffect } from 'react'
import { m as motion } from 'framer-motion'
import Avatar from './Avatar.jsx'
import { carregarAniversariantes } from '../lib/dados.js'

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']

// aniversario vem do servidor como 'MM-DD' (membros_do_clube): só dia e mês, nunca o ano — o card
// não mostra mais a idade ("faz N anos"), porque a data completa da criança não é do clube inteiro.
function parseAniversario(mmdd) {
  const [mes, dia] = String(mmdd).split('-').map(Number)
  return { mes, dia }
}

export default function CardAniversariantes() {
  const [lista, setLista] = useState([])
  const [carregando, setCarregando] = useState(true)

  useEffect(() => {
    // o card é enfeite: se a busca falhar, ele só não aparece (sem erro solto no console)
    carregarAniversariantes()
      .then((d) => { setLista(d); setCarregando(false) })
      .catch(() => setCarregando(false))
  }, [])

  const hoje = new Date()
  const mesAtual = hoje.getMonth() + 1
  const diaHoje = hoje.getDate()

  const doMes = lista
    .filter((p) => p.aniversario)
    .map((p) => ({ ...p, ...parseAniversario(p.aniversario) }))
    .filter((p) => p.mes === mesAtual && p.dia)
    .sort((a, b) => a.dia - b.dia)

  if (carregando || doMes.length === 0) return null // não mostra card vazio

  const hojeAniversariantes = doMes.filter((p) => p.dia === diaHoje)

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
      className="bg-white rounded-2xl shadow-sm p-4 mb-5 border border-dourado/30">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-2xl">🎂</span>
        <h3 className="font-extrabold text-slate-800">Aniversariantes de {MESES[mesAtual - 1]}</h3>
      </div>

      {hojeAniversariantes.length > 0 && (
        <div className="bg-dourado/15 border border-dourado/40 rounded-xl p-3 mb-3">
          <p className="text-sm font-bold text-amber-700">
            🎉 Hoje é aniversário de {hojeAniversariantes.map((p) => (p.nome || 'alguém').split(' ')[0]).join(', ')}!
          </p>
          <p className="text-xs text-amber-600">Mande os parabéns 🥳</p>
        </div>
      )}

      <div className="space-y-1">
        {doMes.map((p) => {
          const ehHoje = p.dia === diaHoje
          return (
            <div key={p.id} className={`flex items-center gap-3 px-2 py-1.5 rounded-xl ${ehHoje ? 'bg-dourado/10' : ''}`}>
              <Avatar foto={p.foto} nome={p.nome} cor="#1e3a8a" size="w-9 h-9" textSize="text-sm" />
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-slate-800 text-sm truncate">{p.nome}{ehHoje && ' 🎉'}</div>
                <div className="text-xs text-slate-400">
                  dia {p.dia}
                </div>
              </div>
              {ehHoje && <span className="text-lg">🎂</span>}
            </div>
          )
        })}
      </div>
    </motion.div>
  )
}
