import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

// Fotos de exemplo (espaços reservados) — o mural real virá do banco
const fotos = [
  { titulo: 'Acampamento', cor: '#1e3a8a' },
  { titulo: 'Investidura', cor: '#f5c518' },
  { titulo: 'Caminhada', cor: '#0ea5e9' },
  { titulo: 'Culto', cor: '#6366f1' },
  { titulo: 'Serviço', cor: '#10b981' },
  { titulo: 'Feira', cor: '#ef4444' },
]

export default function Mural() {
  const [aberta, setAberta] = useState(null)

  return (
    <div>
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-extrabold text-slate-800">Mural de Fotos</h2>
          <p className="text-sm text-slate-500">Memórias do clube — toque para ampliar</p>
        </div>
        <motion.button whileTap={{ scale: 0.94 }} whileHover={{ scale: 1.04 }}
          className="text-sm bg-azul text-white rounded-xl px-4 py-2 font-medium shadow-sm">
          + Foto
        </motion.button>
      </div>

      <motion.div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3"
        initial="hide" animate="show" variants={{ show: { transition: { staggerChildren: 0.06 } } }}>
        {fotos.map((f, i) => (
          <motion.button key={f.titulo} layoutId={`foto-${i}`} onClick={() => setAberta(i)}
            variants={{ hide: { opacity: 0, scale: 0.9 }, show: { opacity: 1, scale: 1 } }}
            whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.97 }}
            className="rounded-2xl overflow-hidden shadow-sm aspect-square grid place-items-center text-white relative"
            style={{ backgroundColor: f.cor }}>
            <span className="text-3xl opacity-80">📸</span>
            <span className="absolute bottom-2 left-2 text-xs font-semibold drop-shadow">{f.titulo}</span>
          </motion.button>
        ))}
      </motion.div>

      {/* Foto em tela cheia */}
      <AnimatePresence>
        {aberta !== null && (
          <motion.div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex flex-col items-center justify-center p-6"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={() => setAberta(null)}>
            <motion.div layoutId={`foto-${aberta}`}
              className="w-full max-w-md aspect-square rounded-3xl grid place-items-center text-white relative shadow-2xl"
              style={{ backgroundColor: fotos[aberta].cor }}>
              <span className="text-6xl opacity-90">📸</span>
              <span className="absolute bottom-4 left-5 text-lg font-bold drop-shadow">{fotos[aberta].titulo}</span>
            </motion.div>
            <p className="text-white/80 text-sm mt-5">✕ toque para fechar</p>
          </motion.div>
        )}
      </AnimatePresence>

      <p className="text-center text-xs text-slate-400 mt-6">
        🚧 Exemplos — aqui o clube poderá postar as fotos dos eventos.
      </p>
    </div>
  )
}
