import { useCallback, useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/Auth.jsx'
import { meuStatus, carregarPerfil } from '../../services/rede.js'
import { MARCA_PRODUTO } from '../../lib/marca.js'
import Notificacoes from '../../components/Notificacoes.jsx'
import BotaoAjuda from '../../components/BotaoAjuda.jsx'
import TourDaArea from '../../components/TourDaArea.jsx'
import { RedeContexto } from './contexto.js'
import { AvatarRede, Icone, PILL_CLARA, TXT, TXT_SUAVE, avatarPersonagemDe, textoDoErro } from './componentes.jsx'
import { Carregando, FilaDePopupsProvider } from '../../ui/index.jsx'
import { destinoDeSaidaDaRede, redeComoCoordenacao, sairDoModoCoordenacao } from '../../lib/redeModo.js'

// =============================================================================
//  REDE DBV — o "outro mundo" dentro do app: layout social limpo com a identidade DesbravaClube
//  (azul-marinho + dourado, Fase 6). Layout PRÓPRIO (não usa o AppLayout do clube): topo com a logo
//  à esquerda e, à direita, Sair, tema (claro/escuro), 🔔 e "?" (ajuda → /ajuda#rede-dbv) em
//  quadradinhos da superfície; barra inferior SÓ de ícones (Início · Buscar · ➕ · Desafios · Perfil),
//  ativo em marinho com um risco dourado embaixo. "Sair" fica no topo, sempre visível; acessibilidade
//  e moderação ficam em /rede/mais (menu do meu perfil). Cores: só as variáveis --rede-* (index.css).
//  Mobile-first: sem rolagem lateral, alvos ≥ 44px, área segura do iPhone respeitada.
// =============================================================================

const SEM_ACESSO = {
  sem_autorizacao: ['🔒', 'O seu responsável desligou a Rede DBV', 'Converse com o seu pai, mãe ou responsável: ele pode religar pelo app (tela Meus filhos).'],
  recurso_desligado: ['🧩', 'A Rede DBV não está liberada', 'Este clube ainda não participa da Rede DBV.'],
  // coordenação (490): a rede abre quando algum clube da área tiver o recurso ligado
  area_sem_rede: ['🌎', 'A Rede DBV ainda não está liberada na sua área', 'Quando um clube da sua coordenação entrar na Rede DBV, ela abre aqui para você.'],
}

const QUADRADINHO = 'w-11 h-11 rounded-xl bg-[var(--rede-superficie)] grid place-items-center text-[var(--rede-ink)]'

// Mesmo tema do app do clube (data-theme no <html> + localStorage "tema"): trocar aqui vale lá também.
function BotaoTema() {
  const [escuro, setEscuro] = useState(() => typeof document !== 'undefined' && document.documentElement.getAttribute('data-theme') === 'dark')
  function alternar() {
    const novo = !escuro
    document.documentElement.setAttribute('data-theme', novo ? 'dark' : 'light')
    try { localStorage.setItem('tema', novo ? 'escuro' : 'claro') } catch { /* sem storage */ }
    setEscuro(novo)
  }
  return (
    <button type="button" onClick={alternar} aria-label={escuro ? 'Mudar para o tema claro' : 'Mudar para o tema escuro'}
      data-testid="rede-tema" className={QUADRADINHO}>
      <Icone nome={escuro ? 'sol' : 'lua'} className="w-6 h-6" />
    </button>
  )
}

// Sair da rede: quem entrou pelo portal da coordenação volta para /institucional; o resto, ao app do clube.
// Sair também apaga o modo "coordenação" desta aba (a próxima entrada pelo clube é como membro).
function useSairDaRede() {
  const navigate = useNavigate()
  const coordenacao = redeComoCoordenacao()
  const destino = destinoDeSaidaDaRede(coordenacao)
  const sair = () => { sairDoModoCoordenacao(); navigate(destino) }
  return { coordenacao, sair }
}

function Topo() {
  const { coordenacao, sair } = useSairDaRede()
  return (
    <header className="bg-[var(--rede-bg)]/95 backdrop-blur sticky top-0 z-30 border-b border-[var(--rede-linha)]" style={{ paddingTop: 'var(--seguro-topo)' }}>
      <div className="max-w-xl mx-auto flex items-center justify-between gap-2 px-3 h-14">
        <Link to="/rede" className="flex items-center gap-2 no-underline min-h-[44px]" aria-label="Rede DBV — início">
          <img src={MARCA_PRODUTO.logoUrl} alt="" className="w-8 h-8 rounded-lg" />
          <span className={`font-extrabold text-[19px] tracking-tight ${TXT}`}>Rede DBV</span>
        </Link>
        <div className="flex items-center gap-2">
          {/* saída SEMPRE visível (antes só em Perfil → ☰ → Mais, e ninguém achava) */}
          <button type="button" onClick={sair} data-testid="rede-sair"
            aria-label={coordenacao ? 'Sair da Rede DBV e voltar ao portal da coordenação' : 'Sair da Rede DBV e voltar ao app do clube'}
            className="min-h-[44px] min-w-[44px] px-3 rounded-xl bg-[var(--rede-superficie)] text-[var(--rede-ink)] inline-flex items-center justify-center gap-1.5 text-sm font-semibold">
            <Icone nome="sair" className="w-5 h-5" /><span className="hidden min-[400px]:inline">Sair</span>
          </button>
          {/* o ➕ do topo saiu (29/09, pedido do dono): publicar fica só no botão do meio da barra de baixo */}
          <BotaoTema />
          <div className="relative"><Notificacoes classeBotao={QUADRADINHO} icone={<Icone nome="sino" className="w-6 h-6" />} /></div>
          <BotaoAjuda topico="rede-dbv" estilo={QUADRADINHO} />
        </div>
      </div>
    </header>
  )
}

// Destino ativo: ícone marinho sobre fundo suave + um risco DOURADO embaixo (o único dourado da barra).
const Indicador = () => <span aria-hidden="true" data-testid="indicador-ativo" className="absolute bottom-0 left-1/2 -translate-x-1/2 h-[3px] w-6 rounded-full bg-[var(--rede-destaque)]" />
function BarraInferior({ eu }) {
  const item = ({ isActive }) =>
    `relative w-12 h-11 rounded-xl grid place-items-center no-underline ${isActive ? 'text-[var(--rede-acao)] bg-[var(--rede-acao-suave)]' : 'text-[var(--rede-ink)]'}`
  const destino = (para, rotulo, icone, extra = {}) => (
    <li className="flex justify-center">
      <NavLink to={para} aria-label={rotulo} className={item} {...extra}>
        {({ isActive }) => (<><Icone nome={icone} className="w-[26px] h-[26px]" />{isActive && <Indicador />}</>)}
      </NavLink>
    </li>
  )
  return (
    <nav aria-label="Navegação da Rede DBV" className="fixed bottom-0 inset-x-0 z-30 bg-[var(--rede-bg)] border-t border-[var(--rede-linha)]"
      style={{ paddingBottom: 'var(--seguro-baixo)' }}>
      <ul className="max-w-xl mx-auto grid grid-cols-5 h-[58px] items-center">
        {destino('/rede', 'Início', 'casa', { end: true })}
        {destino('/rede/buscar', 'Buscar', 'busca')}
        {destino('/rede/publicar', 'Publicar', 'maisQuadrado')}
        {destino('/rede/desafios', 'Desafios', 'trofeu')}
        <li className="flex justify-center">
          <NavLink to="/rede/perfil" aria-label="Perfil" className={({ isActive }) => `relative w-12 h-11 rounded-xl grid place-items-center ${isActive ? 'bg-[var(--rede-acao-suave)]' : ''}`}>
            {({ isActive }) => (
              <>
                <span className={`rounded-full p-[1.5px] ${isActive ? 'bg-[var(--rede-acao)]' : 'bg-transparent'}`}>
                  {/* `eu` = rede_perfil() gateado (500): a mesma cara que os outros veem, nunca o profile do Auth */}
                  <AvatarRede nome={eu?.nome} foto={eu?.foto} avatarPersonagem={avatarPersonagemDe(eu)} tamanho="w-7 h-7" texto="text-[10px]" />
                </span>
                {isActive && <Indicador />}
              </>
            )}
          </NavLink>
        </li>
      </ul>
    </nav>
  )
}

export default function LayoutRede() {
  const { pathname } = useLocation()
  const { profile } = useAuth()
  const { coordenacao, sair } = useSairDaRede()
  const [status, setStatus] = useState(null)
  const [eu, setEu] = useState(null)
  const [erro, setErro] = useState(null)

  const recarregar = useCallback(async () => {
    setErro(null)
    try { setStatus(await meuStatus()) } catch (e) { setErro(e) }
  }, [])
  useEffect(() => { recarregar() }, [recarregar])

  // O MEU perfil da rede, gateado pelo servidor (500): comunidade_meu_status não traz foto/avatar, então
  // rede_perfil() é carregado UMA vez aqui e compartilhado (barra de baixo, "Seu story"). Enquanto não
  // chega (ou se falhar), cai no nome do Auth SEM a foto — iniciais, nunca a foto sem o gate.
  const podeVer = !!status?.pode_ver
  useEffect(() => {
    if (!podeVer) { setEu(null); return undefined }
    let vivo = true
    carregarPerfil(null).then((p) => { if (vivo) setEu(p) }).catch(() => {})
    return () => { vivo = false }
  }, [podeVer])
  const euNaRede = eu || (profile ? { id: profile.id, nome: profile.nome } : null)
  useEffect(() => { window.scrollTo?.(0, 0) }, [pathname])

  let conteudo
  if (erro) {
    conteudo = (
      <div className="p-6 text-center">
        <p className={`${TXT} font-bold`}>{textoDoErro(erro, 'Não consegui abrir a Rede DBV.')}</p>
        <button type="button" onClick={recarregar} className={`${PILL_CLARA} mt-3`}>Tentar de novo</button>
      </div>
    )
  } else if (!status) {
    conteudo = <div className="p-4"><Carregando /></div>
  } else if (!status.pode_ver && !pathname.startsWith('/rede/mais')) {
    const [icone, titulo, texto] = SEM_ACESSO[status.motivo] || ['🧩', 'Rede DBV indisponível', 'Entre num clube para ver a Rede DBV.']
    conteudo = (
      <div className="p-8 text-center">
        <div className="text-4xl mb-2" aria-hidden="true">{icone}</div>
        <p className={`font-bold ${TXT}`}>{titulo}</p>
        <p className={`text-sm ${TXT_SUAVE} mt-1 mb-4`}>{texto}</p>
        <button type="button" onClick={sair} className={PILL_CLARA}>{coordenacao ? 'Voltar ao portal da coordenação' : 'Voltar ao app do clube'}</button>
      </div>
    )
  } else {
    conteudo = <Outlet />
  }

  // Mini-tour da Rede (Fase 6, item 3): só quando a pessoa PODE VER a rede (nunca por cima da tela de
  // "sem acesso"), 1x por usuário neste aparelho (TourDaArea marca "visto"), pela FilaDePopups — este
  // layout não usa o AppLayout, então a fila é provida aqui (um popup por vez; "Rever tour" fica em /ajuda).
  return (
    <FilaDePopupsProvider>
      <RedeContexto.Provider value={{ status, eu: euNaRede, recarregar }}>
        <div className="min-h-screen bg-[var(--rede-bg)] overflow-x-hidden" data-rede>
          <Topo />
          <main className="max-w-xl mx-auto pb-[calc(6rem+var(--seguro-baixo))]">{conteudo}</main>
          <BarraInferior eu={euNaRede} />
          {podeVer && !erro && <TourDaArea id="rede" uid={profile?.id} />}
        </div>
      </RedeContexto.Provider>
    </FilaDePopupsProvider>
  )
}
