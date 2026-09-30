import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { esquecerInicioDaNavegacao } from '../lib/barreiraDeVoltar.js'
import { limparRascunhosLocais } from '../lib/relatorio/rascunhoLocal.js'
import { supabase } from '../lib/supabase.js'
import { registrarPushNativo, desassociarPushNativo } from '../lib/pushNativo.js'
import { sincronizarPush, desassociarPush } from '../lib/push.js'
import { definirUsuarioImagens } from '../lib/imagens.js'
import { rpcAusente } from '../services/clubes.js'
import { sincronizarComPerfil } from '../lib/acessibilidade.js'
import { CHAVE_DA_SESSAO } from '../lib/chaveDaSessao.js'
import { PRAZOS, comPrazo, esperar, ehErroDeRede } from '../lib/prazo.js'
import { existeSessaoGuardada, marcar, montarRegistro, guardarPendente, enviarPendentes, recarregarAbertura } from '../lib/arranque.js'
import { reportarArranque } from '../lib/observabilidade.js'
import { ehNativo } from '../lib/nativo.js'

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
  // Arranque (fase 7): null = tudo bem; 'lento' | 'sem_conexao' | 'erro' = a abertura NÃO pode fingir que
  // "está carregando" — a tela explica e oferece "Tentar de novo". `carregando` continua true nesses
  // casos: sem sessão confirmada ninguém é mandado ao login, e o app segue sozinho quando a rede volta.
  const [problema, setProblema] = useState(null)
  // de quem é o perfil já carregado (evita buscar de novo na simples renovação do token)
  const perfilDe = useRef(null)
  const vivo = useRef(true)
  const concluido = useRef(false)     // a abertura já terminou (com ou sem sessão)
  const tentativa = useRef(0)         // qual rodada do arranque está valendo
  const problemaRef = useRef(null)
  const ultimaTentativaEm = useRef(0)
  const authFalhou = useRef(false)    // o cliente de login ficou preso em falha de rede: só recarregar recupera
  const houveProblema = useRef(false)  // a abertura mostrou algum problema (marcado NO INSTANTE, não na renderização)
  // muda o problema mostrado e já registra que houve (o ref não pode esperar a próxima renderização)
  const mudarProblema = useCallback((v) => {
    problemaRef.current = v
    if (v) houveProblema.current = true
    setProblema(v)
  }, [])

  // Registra (sem dado pessoal) que a abertura foi lenta, para o servidor saber EM QUE ETAPA.
  const relatarAberturaLenta = useCallback(() => {
    try {
      const reg = montarRegistro({
        problema: problemaRef.current || 'lento',
        tentativas: tentativa.current - 1,
        online: typeof navigator === 'undefined' || navigator.onLine !== false,
        nativo: ehNativo(),
      })
      guardarPendente(reg)
    } catch { /* telemetria nunca atrapalha */ }
  }, [])

  // A abertura, em etapas. Pode rodar mais de uma vez ("Tentar de novo", volta da rede): só a rodada
  // mais recente manda na tela, e a primeira que CONCLUIR vence.
  const iniciar = useCallback(async () => {
    const minha = ++tentativa.current
    const vale = () => vivo.current && !concluido.current && minha === tentativa.current
    const problemaDeRede = (padrao) => (typeof navigator !== 'undefined' && navigator.onLine === false ? 'sem_conexao' : padrao)
    marcar(minha === 1 ? 'sessao_inicio' : `sessao_tentativa_${minha}`)

    // getSession() pode precisar renovar o token PELA REDE (expirado há mais de 1 h) — é aí que pendura.
    // Guardamos a promessa ORIGINAL: se ela responder depois do prazo, o app segue sozinho.
    const sessaoP = Promise.resolve().then(() => supabase.auth.getSession())
      .catch((erro) => ({ data: { session: null }, error: erro || new Error('falha') }))
    const LENTO = Symbol('lento')
    let resultado = await Promise.race([sessaoP, esperar(PRAZOS.sessaoMs).then(() => LENTO)])
    if (!vale()) return
    if (resultado === LENTO) {
      marcar('sessao_lento')
      mudarProblema(problemaDeRede('lento'))
      resultado = await sessaoP
      if (!vale()) return
    }
    marcar('sessao_resposta')
    const { data, error } = resultado
    const sessao = data?.session || null

    if (!sessao) {
      // Falha de REDE com login guardado NÃO é "sem sessão": mandar ao login aqui desloga, na prática,
      // quem só está sem internet (visto na auditoria: 25 s de espera e depois a tela de login).
      if (error && existeSessaoGuardada(CHAVE_DA_SESSAO)) {
        authFalhou.current = true
        mudarProblema(problemaDeRede('erro'))
        return
      }
      concluido.current = true
      definirUsuarioImagens(undefined)
      setSession(null)
      mudarProblema(null)
      setCarregando(false)
      marcar('pronto_sem_sessao')
      return
    }

    definirUsuarioImagens(sessao.user?.id)   // cache de URLs assinadas das imagens é POR usuário
    setSession(sessao)
    marcar('perfil_inicio')
    const estado = await carregarPerfil(sessao.user.id)
    if (!vale()) return
    marcar('perfil_fim')
    if (estado === 'rede') {                 // o perfil não veio por causa da rede: não é "sem perfil"
      mudarProblema(problemaDeRede('erro'))
      return
    }
    concluido.current = true
    const foiLento = houveProblema.current || tentativa.current > 1
    mudarProblema(null)
    setCarregando(false)
    marcar('pronto')
    if (foiLento) relatarAberturaLenta()
    enviarPendentes((item) => reportarArranque(item)).catch(() => {})
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // "Tentar de novo" (botão) e o retorno automático (internet voltou / voltou para o app).
  // - Se o cliente de login ficou preso numa falha de rede (ver lib/arranque.js), repetir a chamada NÃO
  //   adianta: recarrega a abertura (o login guardado continua no aparelho), com trava contra laço.
  // - Nos demais casos (perfil sem resposta, renovação lenta) a retomada é no próprio lugar.
  const tentarDeNovo = useCallback((origem) => {
    if (concluido.current) return
    const manual = origem !== 'auto'
    ultimaTentativaEm.current = Date.now()
    if (authFalhou.current) {
      relatarAberturaLenta()                       // fica na fila e é enviado depois que a abertura der certo
      recarregarAbertura({ manual })
      return
    }
    mudarProblema(null)
    iniciar()
  }, [iniciar, relatarAberturaLenta, mudarProblema])

  useEffect(() => {
    vivo.current = true
    concluido.current = false
    marcar('auth_montado')
    iniciar()

    const retomar = () => {
      // a rede voltou (ou a pessoa voltou para o app) com a abertura ainda travada: tenta sozinho,
      // no máximo 1x a cada 3 s para não empilhar tentativas
      if (!concluido.current && problemaRef.current && Date.now() - ultimaTentativaEm.current > 3000) tentarDeNovo('auto')
    }
    window.addEventListener('online', retomar)
    const aoVoltar = () => { if (document.visibilityState === 'visible') retomar() }
    document.addEventListener('visibilitychange', aoVoltar)

    const { data: sub } = supabase.auth.onAuthStateChange(async (evt, sess) => {
      if (!vivo.current) return
      if (!concluido.current) {
        // durante a abertura quem manda é o arranque (ele carrega o perfil e conclui). Só reagimos a
        // "o login voltou a funcionar" (renovação que enfim deu certo) para não esperar o botão.
        if (sess) {
          setSession(sess)
          if ((evt === 'SIGNED_IN' || evt === 'TOKEN_REFRESHED') && problemaRef.current) retomar()
        }
        return
      }
      definirUsuarioImagens(sess?.user?.id)
      setSession(sess)
      // Renovação de token (a cada ~1 h) da MESMA pessoa também não muda o perfil.
      if (evt === 'INITIAL_SESSION') return
      if (evt === 'TOKEN_REFRESHED' && sess?.user?.id && sess.user.id === perfilDe.current) return
      if (sess) await carregarPerfil(sess.user.id)
      else { perfilDe.current = null; setProfile(null) }
    })

    return () => {
      vivo.current = false
      window.removeEventListener('online', retomar)
      document.removeEventListener('visibilitychange', aoVoltar)
      sub.subscription.unsubscribe()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // No app Android, registra o aparelho pra receber push nativo (FCM) assim que
  // o perfil carrega. No web/iPhone isso não faz nada.
  useEffect(() => {
    if (profile?.id) {
      registrarPushNativo(profile.id)
      sincronizarPush(profile.id).catch(() => {})   // aparelho web já com push: passa a ser de quem entrou
    }
  }, [profile?.id])

  // Acessibilidade salva na conta (migration 420): vale em qualquer aparelho. Só na troca de PESSOA
  // (id) — recarregar o perfil (ex.: trocar a foto) não desfaz o que a pessoa acabou de escolher.
  useEffect(() => {
    if (profile?.id) sincronizarComPerfil(profile.preferencias)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id])

  // Devolve 'ok' | 'sem_perfil' | 'rede'. 'rede' = a busca NÃO terminou por falha de transporte/prazo:
  // não é "não existe perfil" (e por isso não zera o perfil que já estava na tela).
  async function carregarPerfil(id) {
    setPerfilPronto(false)
    let falhouPorRede = false
    // rede móvel soluça: 1 nova tentativa antes de aceitar "sem perfil"
    for (let n = 0; n < 2; n++) {
      let r
      try { r = await comPrazo(lerMeuPerfil(id), PRAZOS.perfilMs, 'perfil') } catch (e) { r = { data: null, error: e } }
      const { data, error } = r
      if (!error) { // achou — ou "0 linhas" (não existe mesmo): data é null
        perfilDe.current = id
        setProfile(data || null)
        setPerfilPronto(true)
        return 'ok'
      }
      falhouPorRede = ehErroDeRede(error)
      if (n === 0) await esperar(1500)
    }
    if (falhouPorRede) return 'rede'
    perfilDe.current = null
    setProfile(null)
    setPerfilPronto(true) // busca TERMINOU sem perfil: as telas decidem (sem spinner eterno)
    return 'sem_perfil'
  }

  async function sair() {
    // o aparelho deixa de receber os avisos de quem sai (antes do signOut: precisa da sessão)
    await Promise.allSettled([desassociarPush(), desassociarPushNativo()])
    await supabase.auth.signOut()
    limparRascunhosLocais() // rascunhos de relatório (de criança) não ficam no aparelho depois de sair
    setProfile(null)
    // Sair recomeça a navegação do zero: o login substitui a tela atual e o VOLTAR não reabre
    // nada da conta que saiu (nem o clube dela).
    esquecerInicioDaNavegacao()
    try { window.location.replace('/login') } catch { /* fora do navegador */ }
  }

  // "Sair" da tela de conexão: sem internet o signOut normal pendura. Aqui só apaga o login DESTE aparelho
  // (escopo local, sem rede). É escolha explícita da pessoa — a sessão não é descartada por falta de internet.
  async function sairSemRede() {
    try { await comPrazo(supabase.auth.signOut({ scope: 'local' }), 4000, 'sair') } catch { /* apaga na mão abaixo */ }
    try { localStorage.removeItem(CHAVE_DA_SESSAO) } catch { /* ok */ }
    limparRascunhosLocais()
    setProfile(null)
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
  const valor = useMemo(() => ({ session, profile, carregando, perfilPronto, problema, tentarDeNovo: () => tentarDeNovo('botao'), sairSemRede, sair, recarregarPerfil }), [session, profile, carregando, perfilPronto, problema, tentarDeNovo])

  return (
    <AuthContext.Provider value={valor}>
      {children}
    </AuthContext.Provider>
  )
}
