import { useCallback, useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { meuStatus } from '../../services/rede.js'
import { RedeContexto } from './contexto.js'
import { GRADIENTE, Icone, PILL_CLARA, TXT, TXT_SUAVE, CARD, textoDoErro } from './componentes.jsx'
import { Carregando } from '../../ui/index.jsx'

// =============================================================================
//  REDE DBV — o "outro mundo" dentro do app. Layout PRÓPRIO (não usa o AppLayout do clube):
//  cabeçalho com gradiente azul→roxo e "sair da rede", barra inferior própria
//  (Feed · Desafios · ➕ Publicar · Perfil · Mais). Fundo claro, cards brancos, ícones de linha.
//  Mobile-first: sem rolagem lateral, alvos ≥ 44px, área segura do iPhone respeitada.
// =============================================================================

const ABAS = [
  { to: '/rede', rotulo: 'Feed', icone: 'casa', fim: true },
  { to: '/rede/desafios', rotulo: 'Desafios', icone: 'trofeu' },
  { to: '/rede/publicar', rotulo: 'Publicar', icone: 'mais', central: true },
  { to: '/rede/perfil', rotulo: 'Perfil', icone: 'pessoa' },
  { to: '/rede/mais', rotulo: 'Mais', icone: 'menu' },
]

const SEM_ACESSO = {
  sem_autorizacao: ['🔒', 'Falta a autorização do responsável', 'Peça para o seu pai, mãe ou responsável autorizar a Rede DBV pelo app (tela Meus filhos).'],
  recurso_desligado: ['🧩', 'A Rede DBV não está liberada', 'Este clube ainda não participa da Rede DBV.'],
}

function Cabecalho({ aoSair }) {
  return (
    <header className={`${GRADIENTE} text-white sticky top-0 z-30`} style={{ paddingTop: 'env(safe-area-inset-top)' }}>
      <div className="max-w-xl mx-auto flex items-center justify-between gap-2 px-4 h-14">
        <p className="font-black text-lg tracking-tight">Rede DBV</p>
        <button type="button" onClick={aoSair} className="min-h-[44px] px-3 rounded-full inline-flex items-center gap-1.5 text-sm font-bold bg-white/15 hover:bg-white/25">
          <Icone nome="sair" className="w-5 h-5" /> Sair da rede
        </button>
      </div>
    </header>
  )
}

function BarraInferior() {
  return (
    <nav aria-label="Navegação da Rede DBV" className="fixed bottom-0 inset-x-0 z-30 bg-white border-t border-[#e8eaf3]"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
      <ul className="max-w-xl mx-auto grid grid-cols-5">
        {ABAS.map((a) => (
          <li key={a.to} className="flex justify-center">
            <NavLink to={a.to} end={a.fim} aria-label={a.rotulo}
              className={({ isActive }) => `min-h-[56px] w-full flex flex-col items-center justify-center gap-0.5 text-[11px] font-bold ${isActive ? 'text-[#4b3cff]' : TXT_SUAVE}`}>
              {a.central
                ? <span className={`${GRADIENTE} w-12 h-12 -mt-5 rounded-full grid place-items-center text-white shadow-[0_8px_18px_-8px_#4b3cff] ring-4 ring-white`}>
                    <Icone nome="mais" className="w-7 h-7" />
                  </span>
                : <Icone nome={a.icone} className="w-6 h-6" />}
              <span>{a.rotulo}</span>
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  )
}

export default function LayoutRede() {
  const navigate = useNavigate()
  const { pathname } = useLocation()
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
      <div className={`${CARD} p-6 text-center`}>
        <p className={`${TXT} font-bold`}>{textoDoErro(erro, 'Não consegui abrir a Rede DBV.')}</p>
        <button type="button" onClick={recarregar} className={`${PILL_CLARA} mt-3`}>Tentar de novo</button>
      </div>
    )
  } else if (!status) {
    conteudo = <Carregando />
  } else if (!status.pode_ver && !pathname.startsWith('/rede/mais')) {
    const [icone, titulo, texto] = SEM_ACESSO[status.motivo] || ['🧩', 'Rede DBV indisponível', 'Entre num clube para ver a Rede DBV.']
    conteudo = (
      <div className={`${CARD} p-8 text-center`}>
        <div className="text-4xl mb-2" aria-hidden="true">{icone}</div>
        <p className={`font-extrabold ${TXT}`}>{titulo}</p>
        <p className={`text-sm ${TXT_SUAVE} mt-1 mb-4`}>{texto}</p>
        <button type="button" onClick={sair} className={PILL_CLARA}>Voltar ao app do clube</button>
      </div>
    )
  } else {
    conteudo = <Outlet />
  }

  return (
    <RedeContexto.Provider value={{ status, recarregar }}>
      <div className="min-h-screen bg-[#f4f6fb] overflow-x-hidden" data-rede>
        <Cabecalho aoSair={sair} />
        <main className="max-w-xl mx-auto px-4 pt-4 pb-28">{conteudo}</main>
        <BarraInferior />
      </div>
    </RedeContexto.Provider>
  )
}
