import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { esquecerInicioDaNavegacao } from '../lib/barreiraDeVoltar.js'
import { supabase } from '../lib/supabase.js'
import { registrarPushNativo, desassociarPushNativo } from '../lib/pushNativo.js'
import { sincronizarPush, desassociarPush } from '../lib/push.js'
import { definirUsuarioImagens } from '../lib/imagens.js'
import { rpcAusente } from '../services/clubes.js'

const AuthContext = createContext(null)
export const useAuth = () => useContext(AuthContext)

// O perfil da PRÓPRIA pessoa vem da RPC meu_perfil() (migration 86), não de um select em profiles.
//
// Por quê: a data de nascimento completa ficava legível pela API para qualquer colega de clube
// (a policy de profiles libera quem divide um clube com você, e o grant era da tabela inteira).
// A 86 tira `nascimento` do SELECT direto — um select('*') em profiles passa a dar "permission
// denied" — e entrega a linha inteira, com o nascimento, só para a própria pessoa, por esta RPC.
// O nascimento é usado para a classe da criança (Missoes.jsx, classeDoUsuario).
//
// Fallback: front publicado ANTES do SQL (regra do rollout). Sem a RPC, lê só colunas legíveis por
// todos — a pessoa entra normalmente e só a classe da missão fica sem cor até a 86 chegar. Nunca
// '*' nem `nascimento`: depois da 86 isso quebraria o login de todo mundo. A lista fica LITERAL
// (e não numa constante) porque o contrato de front só consegue conferir colunas escritas assim.
async function lerMeuPerfil(id) {
  const { data, error } = await supabase.rpc('meu_perfil')
  // setof: vem como lista (0 ou 1 linha). Nenhuma linha = a pessoa não tem perfil mesmo.
  if (!error) return { data: Array.isArray(data) ? (data[0] ?? null) : (data ?? null), error: null }
  if (!rpcAusente(error)) return { data: null, error }
  return supabase.from('profiles').select('id,nome,foto,cargo,created_at,notif_visto_em,teste,avatar,avatar_tipo').eq('id', id).maybeSingle()
}

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)
  const [carregando, setCarregando] = useState(true)
  // true quando a BUSCA do perfil terminou (mesmo que sem perfil) — permite às
  // telas distinguir "ainda carregando" de "não tem perfil mesmo"
  const [perfilPronto, setPerfilPronto] = useState(false)
  // de quem é o perfil já carregado (evita buscar de novo na simples renovação do token)
  const perfilDe = useRef(null)

  useEffect(() => {
    let vivo = true

    supabase.auth.getSession().then(async ({ data }) => {
      if (!vivo) return
      definirUsuarioImagens(data.session?.user?.id)   // cache de URLs assinadas das imagens é POR usuário
      setSession(data.session)
      if (data.session) await carregarPerfil(data.session.user.id)
      setCarregando(false)
    })

    const { data: sub } = supabase.auth.onAuthStateChange(async (evt, sess) => {
      if (!vivo) return
      definirUsuarioImagens(sess?.user?.id)
      setSession(sess)
      // Abertura do app: o supabase-js emite INITIAL_SESSION logo ao assinar, e o getSession() acima
      // já busca o perfil — buscar aqui também dobrava a chamada meu_perfil em toda abertura.
      // Renovação de token (a cada ~1 h) da MESMA pessoa também não muda o perfil.
      if (evt === 'INITIAL_SESSION') return
      if (evt === 'TOKEN_REFRESHED' && sess?.user?.id && sess.user.id === perfilDe.current) return
      if (sess) await carregarPerfil(sess.user.id)
      else { perfilDe.current = null; setProfile(null) }
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
      const { data, error } = await lerMeuPerfil(id)
      if (!error) { // achou — ou "0 linhas" (não existe mesmo): data é null
        perfilDe.current = id
        setProfile(data || null)
        setPerfilPronto(true)
        return
      }
      await new Promise((r) => setTimeout(r, 1500))
    }
    perfilDe.current = null
    setProfile(null)
    setPerfilPronto(true) // busca TERMINOU sem perfil: as telas decidem (sem spinner eterno)
  }

  async function sair() {
    // o aparelho deixa de receber os avisos de quem sai (antes do signOut: precisa da sessão)
    await Promise.allSettled([desassociarPush(), desassociarPushNativo()])
    await supabase.auth.signOut()
    setProfile(null)
    // Sair recomeça a navegação do zero: o login substitui a tela atual e o VOLTAR não reabre
    // nada da conta que saiu (nem o clube dela).
    esquecerInicioDaNavegacao()
    try { window.location.replace('/login') } catch { /* fora do navegador */ }
  }

  // Recarrega o perfil do banco (ex.: depois de trocar a foto) pra refletir na hora
  async function recarregarPerfil() {
    if (session?.user?.id) await carregarPerfil(session.user.id)
  }

  // Valor estável: sem isto, qualquer render do provider entregava um objeto novo e re-renderizava
  // em cascata tudo que usa useAuth(). `sair`/`recarregarPerfil` só dependem de `session`.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const valor = useMemo(() => ({ session, profile, carregando, perfilPronto, sair, recarregarPerfil }), [session, profile, carregando, perfilPronto])

  return (
    <AuthContext.Provider value={valor}>
      {children}
    </AuthContext.Provider>
  )
}
