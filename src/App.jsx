import { lazy, Suspense, Component, useEffect } from 'react'
import { ehErroDeVersao, recuperarVersao } from './lib/recuperarVersao.js'
import { voltouAntesDoInicio, carimbarEntradaAtual } from './lib/barreiraDeVoltar.js'
import { Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from './context/Auth.jsx'
import { useClube } from './context/Clube.jsx'
import { rotaInicial } from './lib/clube.js'
import { reportarErro } from './lib/observabilidade.js'
import { guardarRetorno } from './lib/retornoPosLogin.js'
import { modoDoHost, rotaDoSite, rotaSoDoSite, urlDoApp, urlDoSite } from './lib/dominios.js'
import Entrar, { InscricaoPublica } from './pages/Entrar.jsx'
import ClubeGuard from './components/ClubeGuard.jsx'
import AppLayout from './components/AppLayout.jsx'
import Logo from './components/Logo.jsx'
import RotaRestrita from './components/RotaRestrita.jsx'
import RecursoOpcional from './components/RecursoOpcional.jsx'

// Cada tela é carregada só quando necessária (deixa o app mais leve/rápido)
const Landing = lazy(() => import('./pages/Landing.jsx'))
const Login = lazy(() => import('./pages/Login.jsx'))
const Cadastro = lazy(() => import('./pages/Cadastro.jsx'))
const Adquirir = lazy(() => import('./pages/Adquirir.jsx'))
const Recuperar = lazy(() => import('./pages/Recuperar.jsx'))
const NovaSenha = lazy(() => import('./pages/Recuperar.jsx').then((m) => ({ default: m.NovaSenha })))
const Ranking = lazy(() => import('./pages/Ranking.jsx'))
const Atividades = lazy(() => import('./pages/Atividades.jsx'))
const Unidades = lazy(() => import('./pages/Unidades.jsx'))
const Mural = lazy(() => import('./pages/Mural.jsx'))
const Aprovacoes = lazy(() => import('./pages/Aprovacoes.jsx'))
const VisitasClube = lazy(() => import('./pages/VisitasClube.jsx'))
const Apontamentos = lazy(() => import('./pages/Apontamentos.jsx'))
const Gestao = lazy(() => import('./pages/Gestao.jsx'))
const Mensalidades = lazy(() => import('./pages/Mensalidades.jsx'))
const Usuarios = lazy(() => import('./pages/Usuarios.jsx'))
const RemoverPontos = lazy(() => import('./pages/RemoverPontos.jsx'))
const Missoes = lazy(() => import('./pages/Missoes.jsx'))
const AprovarMissoes = lazy(() => import('./pages/AprovarMissoes.jsx'))
const Atividade = lazy(() => import('./pages/Atividade.jsx'))
const Trilha = lazy(() => import('./pages/Trilha.jsx'))
const Perfil = lazy(() => import('./pages/Perfil.jsx'))
const Avisos = lazy(() => import('./pages/Avisos.jsx'))
const Conteudo = lazy(() => import('./pages/Conteudo.jsx'))
const RadarFaltas = lazy(() => import('./pages/RadarFaltas.jsx'))
const Agenda = lazy(() => import('./pages/Agenda.jsx'))
const Temporada = lazy(() => import('./pages/Temporada.jsx'))
const JogosTrilha = lazy(() => import('./pages/JogosTrilha.jsx'))
const DesafiosSemana = lazy(() => import('./pages/DesafiosSemana.jsx'))
const Leilao = lazy(() => import('./pages/Leilao.jsx'))
const ModoAcampamento = lazy(() => import('./pages/ModoAcampamento.jsx'))
const Chat = lazy(() => import('./pages/Chat.jsx'))
const Biblia = lazy(() => import('./pages/Biblia.jsx'))
const Bichinho = lazy(() => import('./pages/Bichinho.jsx'))
const Chefao = lazy(() => import('./pages/Chefao.jsx'))
const PetsClube = lazy(() => import('./pages/PetsClube.jsx'))
const ChatModeracao = lazy(() => import('./pages/ChatModeracao.jsx'))
const MeuFilho = lazy(() => import('./pages/MeuFilho.jsx'))
const VinculosPais = lazy(() => import('./pages/VinculosPais.jsx'))
const ClubeConfig = lazy(() => import('./pages/ClubeConfig.jsx'))
const MinhaClasse = lazy(() => import('./pages/MinhaClasse.jsx'))
const AvaliarClasse = lazy(() => import('./pages/AvaliarClasse.jsx'))
const Investiduras = lazy(() => import('./pages/Investiduras.jsx'))
const VerificarDocumento = lazy(() => import('./pages/VerificarDocumento.jsx'))
const PortalInstitucional = lazy(() => import('./pages/PortalInstitucional.jsx'))
const Onboarding = lazy(() => import('./pages/Onboarding.jsx'))
const Admin = lazy(() => import('./pages/Admin.jsx'))
const ConviteCoordenacao = lazy(() => import('./pages/ConviteCoordenacao.jsx'))
const Planos = lazy(() => import('./pages/Planos.jsx'))
const SiteClubes = lazy(() => import('./pages/site/SiteClubes.jsx'))
const SiteCartaoClube = lazy(() => import('./pages/site/SiteCartaoClube.jsx'))
const SiteParceiros = lazy(() => import('./pages/site/SiteParceiros.jsx'))
const Inicio = lazy(() => import('./pages/Inicio.jsx'))
const Eu = lazy(() => import('./pages/Eu.jsx'))
const GestaoAvaliar = lazy(() => import('./pages/GestaoAvaliar.jsx'))
const GestaoAvaliacoes = lazy(() => import('./pages/GestaoAvaliacoes.jsx'))
const GestaoInscricoes = lazy(() => import('./pages/GestaoInscricoes.jsx'))
const GestaoDocumentos = lazy(() => import('./pages/GestaoDocumentos.jsx'))
const Jornada = lazy(() => import('./pages/Hub.jsx').then((m) => ({ default: m.Jornada })))
const MeuClubeHub = lazy(() => import('./pages/Hub.jsx').then((m) => ({ default: m.MeuClube })))
const JogosHub = lazy(() => import('./pages/Hub.jsx').then((m) => ({ default: m.Jogos })))
const Experiencias = lazy(() => import('./pages/Experiencias.jsx'))
const ExperienciaEditor = lazy(() => import('./pages/ExperienciaEditor.jsx'))
const DocumentoClasse = lazy(() => import('./pages/DocumentoClasse.jsx'))
const MinhasEspecialidades = lazy(() => import('./pages/MinhasEspecialidades.jsx'))
const AvaliarEspecialidades = lazy(() => import('./pages/AvaliarEspecialidades.jsx'))

function Carregando() {
  return (
    <div className="min-h-full grid place-items-center bg-azul text-white">
      <div className="text-center">
        <Logo produto className="w-16 h-16 mx-auto mb-3" />
        <p className="text-blue-100 text-sm">Carregando...</p>
      </div>
    </div>
  )
}

function Protegido({ children }) {
  const { session, carregando } = useAuth()
  const location = useLocation()
  if (carregando) return <Carregando />
  if (!session) {
    // a raiz "/" sem sessão é a landing PÚBLICA — mas só onde o site e o app moram juntos
    // (localhost, preview, APK). Em app.desbravaclube.com.br a raiz é o login: a vitrine é do site.
    if (location.pathname === '/' && modoDoHost() === 'unico') return <Landing />
    return <Navigate to="/login" replace />
  }
  // só entra quem tem vínculo ATIVO com um clube em uso (o contexto do clube é resolvido aqui, uma vez por sessão)
  return <ClubeGuard>{children}</ClubeGuard>
}

// Só exige sessão — sem ClubeGuard. É o que a jornada institucional precisa: a autoridade
// distrital/regional pode não ter (e normalmente não tem) vínculo de clube nenhum.
// Antes de mandar pro login, guarda ONDE a pessoa estava tentando chegar (ex.: /entrar?codigo=...)
// — nunca um club_id, só o caminho: o mesmo segredo que já ia na URL, só sobrevive ao login/cadastro
// em vez de se perder. Login.jsx lê isso depois de autenticar e volta pra cá sozinho.
function SessaoObrigatoria({ children }) {
  const { session, carregando } = useAuth()
  const location = useLocation()
  if (carregando) return <Carregando />
  if (!session) {
    guardarRetorno(location.pathname + location.search)
    return <Navigate to="/login" replace />
  }
  return children
}

// /entrar: com sessão é a tela de pedir entrada; SEM sessão e com o código do link, a página
// pública de inscrição (o clube vem do servidor pelo código). Sem código, é o login de sempre.
function PortaDeEntrada() {
  const { session, carregando } = useAuth()
  const location = useLocation()
  if (carregando) return <Carregando />
  if (session) return <Entrar />
  if (new URLSearchParams(location.search).get('codigo')) return <InscricaoPublica />
  guardarRetorno(location.pathname + location.search)
  return <Navigate to="/login" replace />
}

// O responsável cai direto no "Meu Filho"; os demais, no ranking.
function InicioRedirect() {
  const { papel } = useClube()
  return <Navigate to={rotaInicial(papel)} replace />
}

// "Atualizar agora" (botão): sempre executa, sem a trava de tempo.
const atualizarDeVez = () => recuperarVersao({ forcar: true })

// Rede de segurança: se uma página falhar ao CARREGAR (chunk velho depois de um
// deploy, com cache do PWA), em vez de tela branca a gente recarrega sozinho 1x
// pra pegar a versão nova. Se persistir (ou for outro erro), mostra "Atualizar".
class ErroApp extends Component {
  constructor(props) { super(props); this.state = { erro: false } }
  static getDerivedStateFromError() { return { erro: true } }
  componentDidCatch(erro) {
    // Tela quebrada e o pior caso para a pessoa e o mais dificil de reproduzir depois:
    // e o unico lugar onde o relato costuma ser so "deu erro e sumiu tudo".
    reportarErro(erro, { origem: 'boundary', contexto: 'A tela quebrou e o app precisou se recuperar.' })
    // versão velha (pedaço do app que sumiu no deploy): recupera SOZINHO — o botão só aparece se
    // já tentou há menos de 1 minuto (aí é outro problema e a pessoa decide).
    if (ehErroDeVersao(erro)) recuperarVersao()
  }
  render() {
    if (this.state.erro) {
      return (
        <div className="min-h-screen grid place-items-center p-6 text-center">
          <div className="max-w-sm">
            <div className="text-5xl mb-3">🔄</div>
            <p className="font-extrabold text-ink text-lg">Precisamos atualizar o app</p>
            <p className="text-sm text-muted mt-1 mb-5">Saiu uma versão nova. Toque abaixo pra atualizar — é rapidinho. 🙂</p>
            <button onClick={atualizarDeVez}
              className="w-full bg-gradient-to-r from-brand to-brand2 text-white font-extrabold rounded-2xl py-3.5 shadow-glow">
              Atualizar agora
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

// No domínio do SITE, só as rotas públicas moram aqui; qualquer outra (login, /criar-clube?plano=…,
// /entrar?codigo=…, /admin) segue para o app com o MESMO caminho e parâmetros — é a URL que carrega o
// plano/ciclo entre os domínios (sessão e sessionStorage não atravessam de uma origem para outra).
function IrParaApp() {
  const { pathname, search, hash } = useLocation()
  window.location.replace(urlDoApp(pathname + search + hash))
  return <Carregando />
}

function RotasDoSite() {
  const { pathname } = useLocation()
  if (!rotaDoSite(pathname)) return <IrParaApp />
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/planos" element={<Adquirir />} />
      <Route path="/adquirir" element={<Adquirir />} />
      <Route path="/verificar/:token" element={<VerificarDocumento />} />
      <Route path="/clubes" element={<SiteClubes />} />
      <Route path="/clubes/:slug" element={<SiteCartaoClube />} />
      <Route path="/parceiros" element={<SiteParceiros />} />
    </Routes>
  )
}

// Vitrine (clubes/parceiros) é SÓ do site: no domínio do app volta para o site; onde moram juntos, renderiza.
function SoNoSite({ children }) {
  const { pathname, search } = useLocation()
  if (modoDoHost() === 'app' && rotaSoDoSite(pathname)) {
    window.location.replace(urlDoSite(pathname + search))
    return <Carregando />
  }
  return children
}

// VOLTAR para antes do login/troca de clube (telas da conta anterior, do clube anterior, o próprio
// login): manda para o início desta sessão em vez de reabrir o que ficou para trás.
function BarreiraDeVoltar() {
  const session = useAuth()?.session
  const location = useLocation()
  const navigate = useNavigate()
  useEffect(() => {
    if (session && voltouAntesDoInicio()) { navigate('/', { replace: true }); return }
    carimbarEntradaAtual()
  }, [session, location, navigate])
  return null
}

// Pré-carrega, com o app já parado e só uma vez por abertura, o código das telas mais abertas
// (Início, Jornada/hubs, Minha Classe) — o toque nelas deixa de esperar a rede. Respeita "economia de
// dados" e 2G: aí não baixa nada adiantado.
let jaPrecarregou = false
function PrecarregarRotas() {
  const session = useAuth()?.session
  useEffect(() => {
    if (!session || jaPrecarregou) return
    const con = typeof navigator !== 'undefined' ? navigator.connection : null
    if (con && (con.saveData || /(^|-)2g$/.test(con.effectiveType || ''))) return
    jaPrecarregou = true
    const agendar = window.requestIdleCallback || ((fn) => setTimeout(fn, 1500))
    agendar(() => {
      import('./pages/Inicio.jsx').catch(() => {})
      import('./pages/Hub.jsx').catch(() => {})
      import('./pages/MinhaClasse.jsx').catch(() => {})
    }, { timeout: 4000 })
  }, [session])
  return null
}

export default function App() {
  if (modoDoHost() === 'site') {
    return (
      <ErroApp>
        <Suspense fallback={<Carregando />}><RotasDoSite /></Suspense>
      </ErroApp>
    )
  }
  return (
    <ErroApp>
    <Suspense fallback={<Carregando />}>
      <BarreiraDeVoltar />
      <PrecarregarRotas />
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/cadastro" element={<Cadastro />} />
        {/* Catálogo público de planos + entrada da aquisição (item 4): sem sessão, de propósito — é
            a vitrine que a landing usa. "Quero este plano" manda pra /criar-clube?plano=..., que já
            exige sessão e devolve pra cá sozinho via retornoPosLogin se a pessoa ainda não tem conta. */}
        <Route path="/adquirir" element={<Adquirir />} />
        {/* Recuperacao de senha: as duas pernas sao PUBLICAS. /nova-senha recebe quem volta pelo
            link do e-mail, e nesse momento a sessao de recuperacao ainda esta sendo montada pelo
            supabase-js — passar por SessaoObrigatoria jogaria a pessoa de volta pro login. */}
        <Route path="/recuperar" element={<Recuperar />} />
        <Route path="/nova-senha" element={<NovaSenha />} />
        {/* Verificação PÚBLICA de documento (sem login): só o resumo mínimo, via RPC anônima */}
        <Route path="/verificar/:token" element={<VerificarDocumento />} />
        <Route path="/clubes" element={<SoNoSite><SiteClubes /></SoNoSite>} />
        <Route path="/clubes/:slug" element={<SoNoSite><SiteCartaoClube /></SoNoSite>} />
        <Route path="/parceiros" element={<SoNoSite><SiteParceiros /></SoNoSite>} />

        {/* Jornada INSTITUCIONAL: exige sessão, mas NÃO passa pelo ClubeGuard — quem é só coordenador
            distrital/regional não tem vínculo de clube nenhum e ficaria trancado do lado de fora. */}
        <Route path="/institucional" element={<SessaoObrigatoria><PortalInstitucional /></SessaoObrigatoria>} />

        {/* Cadastro de um clube NOVO: exige sessão, mas não pode passar pelo ClubeGuard — quem chega
            pra abrir um clube ainda não tem clube nenhum (é justamente o que o onboarding cria). */}
        <Route path="/criar-clube" element={<SessaoObrigatoria><Onboarding /></SessaoObrigatoria>} />

        {/* Administração da PLATAFORMA: exige sessão, mas não passa pelo ClubeGuard — é autoridade
            comercial (contas, planos, assinaturas, provisionamento, suporte, auditoria), nunca
            autoridade de clube. O guard de verdade é dentro de Admin.jsx (eh_admin_plataforma() no
            servidor); não há link nenhum pra esta rota em nenhum menu — quem não é admin nem a vê. */}
        <Route path="/admin" element={<SessaoObrigatoria><Admin /></SessaoObrigatoria>} />

        {/* Convite de coordenação (link gerado no /admin): exige sessão — sem conta, cria/entra e volta
            pra cá — e não passa pelo ClubeGuard (coordenador não tem clube). */}
        <Route path="/coordenacao" element={<SessaoObrigatoria><ConviteCoordenacao /></SessaoObrigatoria>} />

        {/* Entrar num clube por código/QR ou por link de convite (fase 8.6). Exige SESSÃO e não
            passa pelo ClubeGuard, pela mesma razão do onboarding: quem chega aqui ainda não tem
            clube — é exatamente isso que esta tela resolve.
            A sessão é exigida de propósito, e é uma decisão de privacidade: sem ela, tentar códigos
            ao acaso seria uma sonda anônima e ilimitada contra a existência de clubes. Com ela,
            cada tentativa tem dono e entra no limite de abuso do servidor. */}
        <Route path="/entrar" element={<PortaDeEntrada />} />

        <Route element={<Protegido><AppLayout /></Protegido>}>
          <Route path="/" element={<InicioRedirect />} />
          {/* Destinos da fase 7 (hubs de jornada) */}
          <Route path="/inicio" element={<Inicio />} />
          <Route path="/jornada" element={<Jornada />} />
          <Route path="/meu-clube" element={<MeuClubeHub />} />
          <Route path="/jogos" element={<JogosHub />} />
          <Route path="/eu" element={<Eu />} />
          <Route path="/gestao/avaliar" element={<RotaRestrita><GestaoAvaliar /></RotaRestrita>} />
          <Route path="/gestao/avaliacoes" element={<RotaRestrita><GestaoAvaliacoes /></RotaRestrita>} />
          <Route path="/gestao/inscricoes" element={<RotaRestrita><GestaoInscricoes /></RotaRestrita>} />
          <Route path="/gestao/documentos" element={<RotaRestrita><GestaoDocumentos /></RotaRestrita>} />
          <Route path="/ranking" element={<Ranking />} />
          <Route path="/meu-filho" element={<MeuFilho />} />
          <Route path="/vinculos-pais" element={<RotaRestrita><VinculosPais /></RotaRestrita>} />
          <Route path="/missoes" element={<RecursoOpcional recurso="missoes"><Missoes /></RecursoOpcional>} />
          <Route path="/trilha" element={<RecursoOpcional recurso="jogos"><Trilha /></RecursoOpcional>} />
          <Route path="/aprovar-missoes" element={<RotaRestrita><AprovarMissoes /></RotaRestrita>} />
          <Route path="/atividade-jogos" element={<RotaRestrita><Atividade /></RotaRestrita>} />
          <Route path="/atividades" element={<RecursoOpcional recurso="atividades"><Atividades /></RecursoOpcional>} />
          <Route path="/unidades" element={<Unidades />} />
          <Route path="/mural" element={<RecursoOpcional recurso="mural"><Mural /></RecursoOpcional>} />
          <Route path="/gestao" element={<Gestao />} />
          <Route path="/aprovacoes" element={<RotaRestrita><Aprovacoes /></RotaRestrita>} />
          <Route path="/visitas" element={<RotaRestrita><VisitasClube /></RotaRestrita>} />
          <Route path="/apontamentos" element={<RotaRestrita><Apontamentos /></RotaRestrita>} />
          <Route path="/mensalidades" element={<RotaRestrita><Mensalidades /></RotaRestrita>} />
          <Route path="/usuarios" element={<RotaRestrita><Usuarios /></RotaRestrita>} />
          <Route path="/pontos" element={<RotaRestrita><RemoverPontos /></RotaRestrita>} />
          <Route path="/perfil" element={<Perfil />} />
          <Route path="/avisos" element={<RotaRestrita><Avisos /></RotaRestrita>} />
          <Route path="/conteudo" element={<RotaRestrita><Conteudo /></RotaRestrita>} />
          <Route path="/radar" element={<RotaRestrita><RadarFaltas /></RotaRestrita>} />
          <Route path="/temporada" element={<RotaRestrita><Temporada /></RotaRestrita>} />
          <Route path="/jogos-trilha" element={<RotaRestrita><JogosTrilha /></RotaRestrita>} />
          <Route path="/desafios" element={<RecursoOpcional recurso="desafios"><DesafiosSemana /></RecursoOpcional>} />
          <Route path="/leilao" element={<RecursoOpcional recurso="leilao"><Leilao /></RecursoOpcional>} />
          <Route path="/modo-acampamento" element={<RotaRestrita><ModoAcampamento /></RotaRestrita>} />
          <Route path="/chat" element={<RecursoOpcional recurso="chat"><Chat /></RecursoOpcional>} />
          <Route path="/biblia" element={<RecursoOpcional recurso="biblia"><Biblia /></RecursoOpcional>} />
          <Route path="/bichinho" element={<RecursoOpcional recurso="bichinho"><Bichinho /></RecursoOpcional>} />
          <Route path="/chefao" element={<RecursoOpcional recurso="chefao"><Chefao /></RecursoOpcional>} />
          <Route path="/pets-clube" element={<RecursoOpcional recurso="bichinho"><PetsClube /></RecursoOpcional>} />
          <Route path="/chat-moderacao" element={<RotaRestrita><ChatModeracao /></RotaRestrita>} />
          <Route path="/agenda" element={<RecursoOpcional recurso="agenda"><Agenda /></RecursoOpcional>} />
          <Route path="/clube" element={<RotaRestrita><ClubeConfig /></RotaRestrita>} />
          <Route path="/planos" element={<RotaRestrita><Planos /></RotaRestrita>} />
          <Route path="/experiencias" element={<RecursoOpcional recurso="experiencias"><Experiencias /></RecursoOpcional>} />
          <Route path="/experiencias/novo" element={<RotaRestrita><ExperienciaEditor /></RotaRestrita>} />
          <Route path="/minha-classe" element={<RecursoOpcional recurso="classes"><MinhaClasse /></RecursoOpcional>} />
          <Route path="/avaliar-classe" element={<RotaRestrita><AvaliarClasse /></RotaRestrita>} />
          <Route path="/investiduras" element={<RotaRestrita><Investiduras /></RotaRestrita>} />
          {/* Documento imprimível (dono/liderança); a autorização real é da RPC documento_conteudo */}
          <Route path="/documento/:token" element={<DocumentoClasse />} />
          {/* Especialidades: recurso PRÓPRIO, não `classes` (fase 9, item 9) — o catálogo ainda é de teste e fica fora do piloto.
              /avaliar-especialidades pega o mesmo recurso pela matriz (RECURSO_POR_ROTA). A trava de verdade são as RPCs. */}
          <Route path="/minhas-especialidades" element={<RecursoOpcional recurso="especialidades"><MinhasEspecialidades /></RecursoOpcional>} />
          <Route path="/avaliar-especialidades" element={<RotaRestrita><AvaliarEspecialidades /></RotaRestrita>} />
        </Route>
      </Routes>
    </Suspense>
    </ErroApp>
  )
}
