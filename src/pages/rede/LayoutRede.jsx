import { useCallback, useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/Auth.jsx'
import { meuStatus } from '../../services/rede.js'
import { MARCA_PRODUTO } from '../../lib/marca.js'
import Notificacoes from '../../components/Notificacoes.jsx'
import { RedeContexto } from './contexto.js'
import { AvatarRede, Icone, PILL_CLARA, TXT, TXT_SUAVE, textoDoErro } from './componentes.jsx'
import { Carregando } from '../../ui/index.jsx'

// =============================================================================
//  REDE DBV — o "outro mundo" dentro do app, no ESTILO INSTAGRAM (refeito em 29/09/2026 a pedido
//  do dono). Layout PRÓPRIO (não usa o AppLayout do clube): fundo branco; topo com a logo à
//  esquerda e, à direita, ➕ publicar e 🔔 notificações em quadradinhos arredondados leves; barra
//  inferior SÓ de ícones (Início · Buscar · ➕ · Desafios · Perfil), ativo em azul com fundo suave.
//  "Sair" fica no topo, sempre visível; acessibilidade e moderação ficam em /rede/mais (menu do meu perfil).
//  Mobile-first: sem rolagem lateral, alvos ≥ 44px, área segura do iPhone respeitada.
// =============================================================================

const SEM_ACESSO = {
  sem_autorizacao: ['🔒', 'Falta a autorização do responsável', 'Peça para o seu pai, mãe ou responsável autorizar a Rede DBV pelo app (tela Meus filhos).'],
  recurso_desligado: ['🧩', 'A Rede DBV não está liberada', 'Este clube ainda não participa da Rede DBV.'],
}

const QUADRADINHO = 'w-11 h-11 rounded-xl bg-[#f1f5f9] grid place-items-center text-[#0f172a]'

function Topo() {
  return (
    <header className="bg-white/95 backdrop-blur sticky top-0 z-30 border-b border-[#eef1f5]" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
      <div className="max-w-xl mx-auto flex items-center justify-between gap-2 px-3 h-14">
        <Link to="/rede" className="flex items-center gap-2 no-underline min-h-[44px]" aria-label="Rede DBV — início">
          <img src={MARCA_PRODUTO.logoUrl} alt="" className="w-8 h-8 rounded-lg" />
          <span className={`font-extrabold text-[19px] tracking-tight ${TXT}`}>Rede DBV</span>
        </Link>
        <div className="flex items-center gap-2">
          {/* saída SEMPRE visível (antes só em Perfil → ☰ → Mais, e ninguém achava) */}
          <Link to="/inicio" aria-label="Sair da Rede DBV e voltar ao app do clube" data-testid="rede-sair"
            className="min-h-[44px] px-3 rounded-xl bg-[#f1f5f9] text-[#0f172a] inline-flex items-center gap-1.5 text-sm font-semibold no-underline">
            <Icone nome="sair" className="w-5 h-5" /> Sair
          </Link>
          <Link to="/rede/publicar" aria-label="Publicar" className={QUADRADINHO}><Icone nome="maisQuadrado" className="w-6 h-6" /></Link>
          <div className="relative"><Notificacoes classeBotao={QUADRADINHO} icone={<Icone nome="sino" className="w-6 h-6" />} /></div>
        </div>
      </div>
    </header>
  )
}

function BarraInferior({ eu }) {
  const item = ({ isActive }) =>
    `w-12 h-11 rounded-xl grid place-items-center no-underline ${isActive ? 'text-[#3b5bff] bg-[#eef2ff]' : 'text-[#0f172a]'}`
  return (
    <nav aria-label="Navegação da Rede DBV" className="fixed bottom-0 inset-x-0 z-30 bg-white border-t border-[#eef1f5]"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
      <ul className="max-w-xl mx-auto grid grid-cols-5 h-[58px] items-center">
        <li className="flex justify-center"><NavLink to="/rede" end aria-label="Início" className={item}><Icone nome="casa" className="w-[26px] h-[26px]" /></NavLink></li>
        <li className="flex justify-center"><NavLink to="/rede/buscar" aria-label="Buscar" className={item}><Icone nome="busca" className="w-[26px] h-[26px]" /></NavLink></li>
        <li className="flex justify-center"><NavLink to="/rede/publicar" aria-label="Publicar" className={item}><Icone nome="maisQuadrado" className="w-[27px] h-[27px]" /></NavLink></li>
        <li className="flex justify-center"><NavLink to="/rede/desafios" aria-label="Desafios" className={item}><Icone nome="trofeu" className="w-[26px] h-[26px]" /></NavLink></li>
        <li className="flex justify-center">
          <NavLink to="/rede/perfil" aria-label="Perfil" className={({ isActive }) => `w-12 h-11 rounded-xl grid place-items-center ${isActive ? 'bg-[#eef2ff]' : ''}`}>
            {({ isActive }) => (
              <span className={`rounded-full p-[1.5px] ${isActive ? 'bg-[#3b5bff]' : 'bg-transparent'}`}>
                <AvatarRede nome={eu?.nome} foto={eu?.foto} tamanho="w-7 h-7" texto="text-[10px]" />
              </span>
            )}
          </NavLink>
        </li>
      </ul>
    </nav>
  )
}

export default function LayoutRede() {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const { profile } = useAuth()
  const [status, setStatus] = useState(null)
  const [erro, setErro] = useState(null)

  const recarregar = useCallback(async () => {
    setErro(null)
    try { setStatus(await meuStatus()) } catch (e) { setErro(e) }
  }, [])
  useEffect(() => { recarregar() }, [recarregar])
  useEffect(() => { window.scrollTo?.(0, 0) }, [pathname])

  const sair = () => navigate('/inicio')
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
        <button type="button" onClick={sair} className={PILL_CLARA}>Voltar ao app do clube</button>
      </div>
    )
  } else {
    conteudo = <Outlet />
  }

  return (
    <RedeContexto.Provider value={{ status, recarregar }}>
      <div className="min-h-screen bg-white overflow-x-hidden" data-rede>
        <Topo />
        <main className="max-w-xl mx-auto pb-24">{conteudo}</main>
        <BarraInferior eu={profile} />
      </div>
    </RedeContexto.Provider>
  )
}
