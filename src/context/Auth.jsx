import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase.js'

const AuthContext = createContext(null)
export const useAuth = () => useContext(AuthContext)

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)
  const [carregando, setCarregando] = useState(true)

  useEffect(() => {
    let vivo = true

    supabase.auth.getSession().then(async ({ data }) => {
      if (!vivo) return
      setSession(data.session)
      if (data.session) await carregarPerfil(data.session.user.id)
      setCarregando(false)
    })

    const { data: sub } = supabase.auth.onAuthStateChange(async (_evt, sess) => {
      if (!vivo) return
      setSession(sess)
      if (sess) await carregarPerfil(sess.user.id)
      else setProfile(null)
    })

    return () => { vivo = false; sub.subscription.unsubscribe() }
  }, [])

  async function carregarPerfil(id) {
    const { data } = await supabase.from('profiles').select('*').eq('id', id).single()
    setProfile(data || null)
  }

  async function sair() {
    await supabase.auth.signOut()
    setProfile(null)
  }

  return (
    <AuthContext.Provider value={{ session, profile, carregando, sair }}>
      {children}
    </AuthContext.Provider>
  )
}
