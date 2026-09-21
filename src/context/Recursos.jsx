import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { useAuth } from './Auth.jsx'
import { recursosDaResposta } from '../lib/recursos.js'

const RecursosContext = createContext({ carregandoRecursos: true, recursos: {} })

export const useRecursos = () => useContext(RecursosContext)

// Recursos opcionais pertencem ao clube, não ao perfil. Uma falha de consulta
// deixa o recurso indisponível por segurança, em vez de expor uma tela global.
export function RecursosProvider({ children }) {
  const { session } = useAuth()
  const [carregandoRecursos, setCarregandoRecursos] = useState(true)
  const [recursos, setRecursos] = useState({})

  useEffect(() => {
    let vivo = true
    if (!session) {
      setRecursos({})
      setCarregandoRecursos(false)
      return () => { vivo = false }
    }

    setCarregandoRecursos(true)
    supabase.from('club_features').select('feature, enabled').then(({ data, error }) => {
      if (!vivo) return
      setRecursos(recursosDaResposta({ data, error }))
      setCarregandoRecursos(false)
    })

    return () => { vivo = false }
  }, [session?.user?.id])

  return <RecursosContext.Provider value={{ carregandoRecursos, recursos }}>{children}</RecursosContext.Provider>
}
