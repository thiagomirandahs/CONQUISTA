import { lazy, Suspense, Component } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './context/Auth.jsx'
import AppLayout from './components/AppLayout.jsx'
import Logo from './components/Logo.jsx'
import RotaRestrita from './components/RotaRestrita.jsx'

// Cada tela é carregada só quando necessária (deixa o app mais leve/rápido)
const Login = lazy(() => import('./pages/Login.jsx'))
const Cadastro = lazy(() => import('./pages/Cadastro.jsx'))
const Ranking = lazy(() => import('./pages/Ranking.jsx'))
const Atividades = lazy(() => import('./pages/Atividades.jsx'))
const Unidades = lazy(() => import('./pages/Unidades.jsx'))
const Mural = lazy(() => import('./pages/Mural.jsx'))
const Aprovacoes = lazy(() => import('./pages/Aprovacoes.jsx'))
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

function Carregando() {
  return (
    <div className="min-h-full grid place-items-center bg-azul text-white">
      <div className="text-center">
        <Logo className="w-16 h-16 mx-auto mb-3" />
        <p className="text-blue-100 text-sm">Carregando...</p>
      </div>
    </div>
  )
}

function Protegido({ children }) {
  const { session, carregando } = useAuth()
  if (carregando) return <Carregando />
  if (!session) return <Navigate to="/login" replace />
  return children
}

// O responsável cai direto no "Meu Filho"; os demais, no ranking.
function InicioRedirect() {
  const { profile } = useAuth()
  return <Navigate to={profile?.papel === 'pais' ? '/meu-filho' : '/ranking'} replace />
}

// Nuke do service worker + caches e recarrega — pega a versão nova de vez.
async function atualizarDeVez() {
  try {
    const regs = await navigator.serviceWorker?.getRegistrations?.()
    if (regs) await Promise.all(regs.map((r) => r.unregister()))
    const chaves = await caches?.keys?.()
    if (chaves) await Promise.all(chaves.map((k) => caches.delete(k)))
  } catch { /* ignora */ }
  window.location.reload()
}

// Rede de segurança: se uma página falhar ao CARREGAR (chunk velho depois de um
// deploy, com cache do PWA), em vez de tela branca a gente recarrega sozinho 1x
// pra pegar a versão nova. Se persistir (ou for outro erro), mostra "Atualizar".
class ErroApp extends Component {
  constructor(props) { super(props); this.state = { erro: false } }
  static getDerivedStateFromError() { return { erro: true } }
  componentDidCatch(erro) {
    const msg = String(erro?.message || erro || '')
    const ehChunk = /dynamically imported module|module script failed|ChunkLoadError|Failed to fetch|Loading chunk|CSS chunk/i.test(msg)
    let jaTentou = false
    try { jaTentou = sessionStorage.getItem('recarregou_chunk') === '1' } catch { /* sem storage */ }
    if (ehChunk && !jaTentou) {
      try { sessionStorage.setItem('recarregou_chunk', '1') } catch { /* sem storage */ }
      atualizarDeVez()
    }
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

export default function App() {
  return (
    <ErroApp>
    <Suspense fallback={<Carregando />}>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/cadastro" element={<Cadastro />} />

        <Route element={<Protegido><AppLayout /></Protegido>}>
          <Route path="/" element={<InicioRedirect />} />
          <Route path="/ranking" element={<Ranking />} />
          <Route path="/meu-filho" element={<MeuFilho />} />
          <Route path="/vinculos-pais" element={<RotaRestrita><VinculosPais /></RotaRestrita>} />
          <Route path="/missoes" element={<Missoes />} />
          <Route path="/trilha" element={<Trilha />} />
          <Route path="/aprovar-missoes" element={<RotaRestrita><AprovarMissoes /></RotaRestrita>} />
          <Route path="/atividade-jogos" element={<RotaRestrita><Atividade /></RotaRestrita>} />
          <Route path="/atividades" element={<Atividades />} />
          <Route path="/unidades" element={<Unidades />} />
          <Route path="/mural" element={<Mural />} />
          <Route path="/gestao" element={<Gestao />} />
          <Route path="/aprovacoes" element={<RotaRestrita><Aprovacoes /></RotaRestrita>} />
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
          <Route path="/desafios" element={<DesafiosSemana />} />
          <Route path="/leilao" element={<Leilao />} />
          <Route path="/modo-acampamento" element={<RotaRestrita><ModoAcampamento /></RotaRestrita>} />
          <Route path="/chat" element={<Chat />} />
          <Route path="/biblia" element={<Biblia />} />
          <Route path="/bichinho" element={<Bichinho />} />
          <Route path="/chefao" element={<Chefao />} />
          <Route path="/pets-clube" element={<PetsClube />} />
          <Route path="/chat-moderacao" element={<RotaRestrita><ChatModeracao /></RotaRestrita>} />
          <Route path="/agenda" element={<Agenda />} />
        </Route>
      </Routes>
    </Suspense>
    </ErroApp>
  )
}
