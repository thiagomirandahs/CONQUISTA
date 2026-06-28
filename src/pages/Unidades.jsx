import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

// Unidades de exemplo, agora com a lista de membros (virá do banco depois)
const unidades = [
  {
    nome: 'Águia', cor: '#1d4ed8', conselheiro: 'Tio Marcos', media: 92,
    membros: [
      { nome: 'Ana Souza', pts: 340 },
      { nome: 'Júlia Alves', pts: 298 },
      { nome: 'Rafael Gomes', pts: 210 },
      { nome: 'Beatriz Nunes', pts: 180 },
    ],
  },
  {
    nome: 'Falcão', cor: '#0ea5e9', conselheiro: 'Tia Sara', media: 88,
    membros: [
      { nome: 'Pedro Lima', pts: 325 },
      { nome: 'Caio Mendes', pts: 240 },
      { nome: 'Laura Pinto', pts: 190 },
    ],
  },
  {
    nome: 'Leão', cor: '#f59e0b', conselheiro: 'Tio André', media: 81,
    membros: [
      { nome: 'Lucas Dias', pts: 270 },
      { nome: 'Sofia Rocha', pts: 220 },
      { nome: 'Davi Costa', pts: 160 },
      { nome: 'Helena Brito', pts: 140 },
    ],
  },
  {
    nome: 'Pantera', cor: '#6366f1', conselheiro: 'Tia Rute', media: 74,
    membros: [
      { nome: 'Marina Reis', pts: 255 },
      { nome: 'Gabriel Sá', pts: 175 },
      { nome: 'Yasmin Lopes', pts: 130 },
    ],
  },
]
const medalhas = ['🥇', '🥈', '🥉']

export default function Unidades() {
  const [sel, setSel] = useState(null) // unidade selecionada

  return (
    <div>
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-extrabold text-slate-800">Unidades</h2>
          <p className="text-sm text-slate-500">Toque numa unidade para ver os membros</p>
        </div>
        <motion.button whileTap={{ scale: 0.94 }} whileHover={{ scale: 1.04 }}
          className="text-sm bg-azul text-white rounded-xl px-4 py-2 font-medium shadow-sm">
          + Nova
        </motion.button>
      </div>

      <motion.div className="grid grid-cols-2 lg:grid-cols-4 gap-3"
        initial="hide" animate="show" variants={{ show: { transition: { staggerChildren: 0.08 } } }}>
        {unidades.map((u) => (
          <motion.button key={u.nome} onClick={() => setSel(u)}
            variants={{ hide: { opacity: 0, y: 24, scale: 0.92 }, show: { opacity: 1, y: 0, scale: 1 } }}
            transition={{ type: 'spring', stiffness: 300, damping: 22 }}
            whileHover={{ y: -6 }} whileTap={{ scale: 0.97 }}
            className="bg-white rounded-2xl shadow-sm overflow-hidden text-left">
            <div className="h-2" style={{ backgroundColor: u.cor }} />
            <div className="p-4">
              <div className="w-11 h-11 rounded-full grid place-items-center text-white font-bold text-lg mb-2 shadow"
                style={{ backgroundColor: u.cor }}>
                {u.nome[0]}
              </div>
              <div className="font-bold text-slate-800">{u.nome}</div>
              <div className="text-xs text-slate-400 mb-3">{u.membros.length} membros</div>
              <div className="flex justify-between text-xs mb-1">
                <span className="text-slate-400">Média</span>
                <span className="text-dourado font-extrabold">{u.media} pts</span>
              </div>
              <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                <motion.div className="h-full rounded-full" style={{ backgroundColor: u.cor }}
                  initial={{ width: 0 }} animate={{ width: `${u.media}%` }}
                  transition={{ duration: 0.8, ease: 'easeOut', delay: 0.2 }} />
              </div>
            </div>
          </motion.button>
        ))}
      </motion.div>

      {/* Painel com os membros da unidade */}
      <AnimatePresence>
        {sel && (
          <motion.div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-0 sm:p-6"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={() => setSel(null)}>
            <motion.div
              initial={{ y: 60, opacity: 0, scale: 0.98 }}
              animate={{ y: 0, opacity: 1, scale: 1 }}
              exit={{ y: 60, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 320, damping: 30 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-white w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl shadow-2xl overflow-hidden max-h-[85vh] flex flex-col">
              {/* Cabeçalho da unidade */}
              <div className="p-5 text-white relative" style={{ backgroundColor: sel.cor }}>
                <button onClick={() => setSel(null)}
                  className="absolute top-4 right-4 w-8 h-8 rounded-full bg-white/20 hover:bg-white/30 grid place-items-center">
                  ✕
                </button>
                <div className="w-14 h-14 rounded-full bg-white/20 grid place-items-center text-2xl font-extrabold mb-2">
                  {sel.nome[0]}
                </div>
                <h3 className="text-2xl font-extrabold">{sel.nome}</h3>
                <p className="text-white/80 text-sm">Conselheiro(a): {sel.conselheiro}</p>
                <div className="flex gap-4 mt-3 text-sm">
                  <span>👥 {sel.membros.length} membros</span>
                  <span>⭐ {sel.media} pts (média)</span>
                </div>
              </div>

              {/* Lista de membros */}
              <div className="p-3 overflow-y-auto">
                <p className="text-xs font-semibold text-slate-400 px-2 mb-1">MEMBROS</p>
                {[...sel.membros].sort((a, b) => b.pts - a.pts).map((m, i) => (
                  <motion.div key={m.nome}
                    initial={{ opacity: 0, x: -16 }} animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.05 }}
                    className="flex items-center gap-3 px-2 py-2.5 rounded-xl hover:bg-slate-50">
                    <div className="w-9 h-9 rounded-full grid place-items-center text-white font-bold text-sm"
                      style={{ backgroundColor: sel.cor }}>
                      {m.nome[0]}
                    </div>
                    <span className="flex-1 font-medium text-slate-800">{m.nome}</span>
                    <span className="text-lg">{medalhas[i] || ''}</span>
                    <span className="font-extrabold text-azul">{m.pts}</span>
                  </motion.div>
                ))}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <p className="text-center text-xs text-slate-400 mt-6">
        🚧 Exemplos — a diretoria poderá criar e editar as unidades aqui.
      </p>
    </div>
  )
}
