import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { lembrarOrigemDaRede } from '../lib/redeModo.js'

// Guarda a última tela do APP (fora da Rede) para o "← App" da Rede DBV voltar para ela. Não desenha nada.
export default function OrigemDaRede() {
  const { pathname, search } = useLocation()
  useEffect(() => { if (!pathname.startsWith('/rede')) lembrarOrigemDaRede(pathname + search) }, [pathname, search])
  return null
}
