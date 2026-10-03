import { useCallback, useEffect, useRef } from 'react'

// Agenda transições da partida e cancela tudo quando o jogo sai da tela.
// Evita registrar resultados e iniciar novas rodadas após Cancelar/Sair.
export function useGameTimeout() {
  const timers = useRef(new Set())
  useEffect(() => {
    const pendentes = timers.current
    return () => {
      pendentes.forEach(clearTimeout)
      pendentes.clear()
    }
  }, [])
  return useCallback((callback, delay) => {
    const id = setTimeout(() => {
      timers.current.delete(id)
      callback()
    }, delay)
    timers.current.add(id)
    return id
  }, [])
}
