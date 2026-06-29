import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'

// Pega automaticamente TODAS as fotos colocadas em src/assets/fotos/
const modulos = import.meta.glob('../assets/fotos/*.{jpg,jpeg,png,webp,JPG,JPEG,PNG,WEBP}', { eager: true })
const fotosReais = Object.values(modulos).map((m) => m.default)

// Slides de reserva (aparecem só enquanto não houver fotos)
const gradientes = [
  { titulo: 'Acampamentos', icon: '🏕️', de: '#1e3a8a', para: '#1d4ed8' },
  { titulo: 'Investidura', icon: '🎖️', de: '#92400e', para: '#f5c518' },
  { titulo: 'Aventuras', icon: '🧭', de: '#0ea5e9', para: '#1e3a8a' },
  { titulo: 'Serviço à comunidade', icon: '🤝', de: '#047857', para: '#10b981' },
  { titulo: 'Momentos espirituais', icon: '🙏', de: '#4338ca', para: '#6366f1' },
]

export default function CarrosselFundo() {
  const usandoFotos = fotosReais.length > 0
  const total = usandoFotos ? fotosReais.length : gradientes.length
  const [i, setI] = useState(0)
  // Carrega só a foto atual e a próxima (mais leve no primeiro acesso)
  const [carregadas, setCarregadas] = useState(() => new Set([0, total > 1 ? 1 : 0]))

  useEffect(() => {
    if (total <= 1) return
    const timer = setInterval(() => setI((v) => (v + 1) % total), 4000)
    return () => clearInterval(timer)
  }, [total])

  useEffect(() => {
    setCarregadas((prev) => new Set(prev).add(i).add((i + 1) % total))
  }, [i, total])

  return (
    <div className="absolute inset-0 overflow-hidden">
      {usandoFotos
        ? fotosReais.map((src, k) => (
            <motion.div key={k}
              className="absolute inset-0 bg-cover bg-center"
              style={{ backgroundImage: carregadas.has(k) ? `url(${src})` : 'none', zIndex: k === i ? 1 : 0 }}
              initial={false}
              animate={{ opacity: k === i ? 1 : 0, scale: k === i ? 1 : 1.08 }}
              transition={{ duration: 1.2, ease: 'easeInOut' }}
            />
          ))
        : gradientes.map((s, k) => (
            <motion.div key={k}
              className="absolute inset-0 grid place-items-center"
              style={{ background: `linear-gradient(135deg, ${s.de}, ${s.para})`, zIndex: k === i ? 1 : 0 }}
              initial={false}
              animate={{ opacity: k === i ? 1 : 0, scale: k === i ? 1 : 1.1 }}
              transition={{ duration: 1.2, ease: 'easeInOut' }}
            >
              <div className="text-center select-none">
                <div className="text-[130px] leading-none opacity-20">{s.icon}</div>
                <div className="text-white/30 font-bold tracking-wide mt-2">{s.titulo}</div>
              </div>
            </motion.div>
          ))}

      {total > 1 && (
        <div className="absolute bottom-4 inset-x-0 flex justify-center gap-2" style={{ zIndex: 2 }}>
          {Array.from({ length: total }).map((_, k) => (
            <span key={k}
              className={`h-1.5 rounded-full transition-all duration-500 ${k === i ? 'w-6 bg-white' : 'w-1.5 bg-white/50'}`} />
          ))}
        </div>
      )}
    </div>
  )
}
