import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { registrarPushNativo, desassociarPushNativo } from '../lib/pushNativo.js'
import { sincronizarPush, desassociarPush } from '../lib/push.js'
import { definirUsuarioImagens } from '../lib/imagens.js'

const AuthContext = createContext(null)
export const useAuth = () => useContext(AuthContext)

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)
  const [carregando, setCarregando] = useState(true)
  // true quando a BUSCA do perfil terminou (mesmo que sem perfil) — permite às
  // telas distinguir "ainda carregando" de "não tem perfil mesmo"
  const [perfilPronto, setPerfilPronto] = useState(false)

  useEffect(() => {
    let vivo = true

    supabase.auth.getSession().then(async ({ data }) => {
      if (!vivo) return
      definirUsuarioImagens(data.session?.user?.id)   // cache de URLs assinadas das imagens é POR usuário
      setSession(data.session)
      if (data.session) await carregarPerfil(data.session.user.id)
      setCarregando(false)
    })

    const { data: sub } = supabase.auth.onAuthStateChange(async (_evt, sess) => {
      if (!vivo) return
      definirUsuarioImagens(sess?.user?.id)
      setSession(sess)
      if (sess) await carregarPerfil(sess.user.id)
      else setProfile(null)
    })

    return () => { vivo = false; sub.subscription.unsubscribe() }
  }, [])

  // No app Android, registra o aparelho pra receber push nativo (FCM) assim que
  // o perfil carrega. No web/iPhone isso não faz nada.
  useEffect(() => {
    if (profile?.id) {
      registrarPushNativo(profile.id)
      sincronizarPush(profile.id).catch(() => {})   // aparelho web já com push: passa a ser de quem entrou
    }
  }, [profile?.id])

  async function carregarPerfil(id) {
    setPerfilPronto(false)
    // rede móvel soluça: 1 nova tentativa antes de aceitar "sem perfil"
    for (let tentativa = 0; tentativa < 2; tentativa++) {
      const { data, error } = await supabase.from('profiles').select('*').eq('id', id).single()
      if (!error || error.code === 'PGRST116') { // achou — ou "0 linhas" (não existe mesmo)
        setProfile(data || null)
        setPerfilPronto(true)
        return
      }
      await new Promise((r) => setTimeout(r, 1500))
    }
    setProfile(null)
    setPerfilPronto(true) // busca TERMINOU sem perfil: as telas decidem (sem spinner eterno)
  }

  async function sair() {
    // o aparelho deixa de receber os avisos de quem sai (antes do signOut: precisa da sessão)
    await Promise.allSettled([desassociarPush(), desassociarPushNativo()])
    await supabase.auth.signOut()
    setProfile(null)
  }

  // Recarrega o perfil do banco (ex.: depois de trocar a foto) pra refletir na hora
  async function recarregarPerfil() {
    if (session?.user?.id) await carregarPerfil(session.user.id)
  }

  return (
    <AuthContext.Provider value={{ session, profile, carregando, perfilPronto, sair, recarregarPerfil }}>
      {children}
    </AuthContext.Provider>
  )
}
