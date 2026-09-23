import { Link } from 'react-router-dom'
import { useAuth } from '../context/Auth.jsx'
import { useClube } from '../context/Clube.jsx'
import { useEscopo } from '../context/Escopo.jsx'
import Logo from './Logo.jsx'

// Porteiro do app: só deixa passar quem tem VÍNCULO ATIVO com um clube em uso.
//  * carregando            -> espera o contexto do clube;
//  * erro de rede/servidor -> "tentar de novo" (NUNCA cai num papel/clube "por padrão" — falha fechada);
//  * sem vínculo ativo     -> tela clara, COM AS SAÍDAS que a pessoa tem.
//
// Fase 7 — o achado mais duro da auditoria de UX: quem não tem clube caía aqui com UM ÚNICO botão,
// "Sair". Isso trancava do lado de fora duas jornadas que existem e funcionam:
//   * o coordenador distrital/regional, cujo portal fica em /institucional;
//   * o fundador recém-cadastrado, cujo onboarding fica em /criar-clube — que não tinha NENHUM link
//     no app inteiro.
// A trava de autorização não mudou em nada: continua sendo o servidor que decide o que cada um vê.
// O que mudou é que agora a porta certa aparece.
export default function ClubeGuard({ children }) {
  const { sair } = useAuth()
  const { carregando, erro, semVinculo, vinculos, recarregar, marca } = useClube()
  const { temEscopo, escopos, carregando: carregandoEscopo } = useEscopo()

  if (carregando) {
    return (
      <div className="min-h-full grid place-items-center bg-azul text-white p-6">
        <div className="text-center" role="status">
          <Logo className="w-16 h-16 mx-auto mb-3" />
          <p className="text-blue-100 text-sm">Carregando…</p>
        </div>
      </div>
    )
  }

  if (erro) {
    return (
      <Aviso icone="📡" titulo="Não deu pra carregar o seu clube">
        <p className="text-sm text-muted mt-1 mb-5">Confira a internet e tente de novo. Nada foi liberado enquanto isso.</p>
        <button onClick={recarregar} className="w-full min-h-[48px] bg-gradient-to-r from-brand to-brand2 font-extrabold rounded-2xl shadow-glow"
          style={{ color: 'var(--marca-1-texto, #fff)' }}>Tentar de novo</button>
        <button onClick={sair} className="mt-2 w-full min-h-[44px] text-sm text-muted font-semibold">Sair</button>
      </Aviso>
    )
  }

  if (semVinculo) {
    const pendente = vinculos.some((v) => v.status === 'pendente')
    if (pendente) {
      return (
        <Aviso icone="⏳" titulo="Seu cadastro aguarda aprovação">
          <p className="text-sm text-muted mt-1 mb-5">
            A liderança de {vinculos.find((v) => v.status === 'pendente')?.marca?.nome || marca.nome} ainda
            vai liberar o seu acesso. Assim que liberar, é só entrar de novo.
          </p>
          <button onClick={sair} className="w-full min-h-[48px] bg-gradient-to-r from-brand to-brand2 font-extrabold rounded-2xl shadow-glow"
            style={{ color: 'var(--marca-1-texto, #fff)' }}>Sair</button>
        </Aviso>
      )
    }
    // Sem clube — mas talvez com outra jornada. Enquanto o escopo carrega, não se decide nada.
    if (carregandoEscopo) {
      return (
        <div className="min-h-full grid place-items-center p-6">
          <p className="text-faint text-sm" role="status">Carregando…</p>
        </div>
      )
    }
    return (
      <Aviso icone={temEscopo ? '🏛️' : '🏕️'} titulo={temEscopo ? 'Sua jornada é institucional' : 'Você ainda não está em um clube'}>
        <p className="text-sm text-muted mt-1 mb-5">
          {temEscopo
            ? `Esta conta não participa de nenhum clube, e não precisa: o seu lugar é o portal ${escopos[0]?.nome ? `de ${escopos[0].nome}` : 'institucional'}.`
            : 'Esta conta ainda não faz parte de nenhum clube. Você pode abrir o seu próprio clube agora, ou pedir à liderança do seu clube para liberar o seu acesso.'}
        </p>
        <div className="space-y-2">
          {temEscopo && (
            <Link to="/institucional" data-testid="ir-portal"
              className="block w-full min-h-[48px] leading-[48px] bg-gradient-to-r from-brand to-brand2 font-extrabold rounded-2xl shadow-glow"
              style={{ color: 'var(--marca-1-texto, #fff)' }}>
              Abrir o portal institucional
            </Link>
          )}
          <Link to="/criar-clube" data-testid="ir-criar-clube"
            className={`block w-full min-h-[48px] leading-[48px] font-extrabold rounded-2xl ${
              temEscopo ? 'bg-surface2 text-ink' : 'bg-gradient-to-r from-brand to-brand2 shadow-glow'}`}
            style={temEscopo ? undefined : { color: 'var(--marca-1-texto, #fff)' }}>
            Criar o meu clube
          </Link>
          <button onClick={sair} className="w-full min-h-[44px] text-sm text-muted font-semibold">Sair</button>
        </div>
      </Aviso>
    )
  }

  return children
}

function Aviso({ icone, titulo, children }) {
  return (
    <div className="min-h-screen grid place-items-center p-6 text-center">
      <div className="max-w-sm w-full">
        <div className="text-5xl mb-3" aria-hidden="true">{icone}</div>
        <p className="font-extrabold text-ink text-lg">{titulo}</p>
        {children}
      </div>
    </div>
  )
}
