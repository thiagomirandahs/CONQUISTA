import { useEffect } from 'react'
import { animate, useMotionValue, useTransform, motion } from 'framer-motion'

// Número que "sobe contando" de 0 até o valor (efeito divertido para o ranking)
export default function Contador({ value, duration = 1.2 }) {
  const mv = useMotionValue(0)
  const arredondado = useTransform(mv, (v) => Math.round(v))

  useEffect(() => {
    const controls = animate(mv, value, { duration, ease: 'easeOut' })
    return () => controls.stop()
  }, [value, duration, mv])

  return <motion.span>{arredondado}</motion.span>
}
