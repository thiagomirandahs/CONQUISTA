import { useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import { useAuth } from '../context/Auth.jsx'
import { enviarSinal, caminhoContavel, INTERVALO_MS } from '../lib/metricas.js'

// Manda o sinal anônimo de uso: a cada troca de tela (página vista) e a cada minuto enquanto a tela está
// visível. Não renderiza nada. Fora de produção (dev/teste) não mede.
export default function MedidorDeUso() {
  const { pathname } = useLocation()
  const { session } = useAuth()
  const logado = !!session
  const ref = useRef({ pathname, logado })
  ref.current = { pathname, logado }

  useEffect(() => {
    if (import.meta.env?.DEV || !caminhoContavel(pathname)) return
    enviarSinal({ pagina: true, logado })
  }, [pathname]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (import.meta.env?.DEV) return undefined
    const batida = () => { if (caminhoContavel(ref.current.pathname)) enviarSinal({ logado: ref.current.logado }) }
    const id = setInterval(batida, INTERVALO_MS)
    document.addEventListener('visibilitychange', batida)
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', batida) }
  }, [])

  return null
}
