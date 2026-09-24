import { Link } from 'react-router-dom'
import { useAuth } from '../context/Auth.jsx'
import { useClube } from '../context/Clube.jsx'
import { useEscopo } from '../context/Escopo.jsx'
import Logo from './Logo.jsx'

// Porteiro do app: só deixa passar quem tem VÍNCULO ATIVO com um clube em uso.
//  * carregando            -> espera o contexto do clube;
//  * erro de rede/servidor -> "tentar de novo" (NUNCA cai num papel/clube "por padrão" — falha fechada);
//  * sem vínculo ativo     -> tela clara, COM AS SAÍDAS que a pessoa tem (pendente, suspenso e
//                             "nunca entrou" são telas diferentes: cada uma diz o que é verdade).
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
  const { carregando, erro, semVinculo, precisaEscolher, vinculos, recarregar, marca, trocarClube } = useClube()
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

  // O clube que esta aba usava deixou de valer — e a pessoa tem outros. Antes da fase 8.5 o app
  // escolhia um sozinho e seguia como se nada tivesse acontecido: a pessoa aparecia DENTRO de
  // outro clube, mesma sessão, sem um aviso. Aqui ela fica sabendo, e a escolha volta a ser dela.
  //
  // Não é um erro e não é "sem vínculo": é uma escolha pendente. A tela já está com a marca do
  // produto, não com a do clube perdido — o contexto zera essa marca no mesmo quadro.
  if (precisaEscolher) {
    const disponiveis = vinculos.filter((v) => v.status === 'ativo' && v.selecionavel)
    return (
      <Aviso icone="🔀" titulo="Escolha em qual clube continuar">
        <p className="text-sm text-muted mt-1 mb-5">
          O clube que você estava usando nesta aba não está mais disponível para você. Isso acontece
          quando a liderança encerra ou suspende um vínculo. Os seus outros clubes continuam abertos.
        </p>
        <div className="space-y-2">
          {disponiveis.map((v) => (
            <button key={v.clubeId} onClick={() => trocarClube(v.clubeId)} data-testid={`escolher-${v.clubeId}`}
              className="block w-full min-h-[48px] bg-gradient-to-r from-brand to-brand2 font-extrabold rounded-2xl shadow-glow"
              style={{ color: 'var(--marca-1-texto, #fff)' }}>
              {v.marca?.nome || v.nome}
            </button>
          ))}
          <button onClick={sair} className="w-full min-h-[44px] text-sm text-muted font-semibold">Sair</button>
        </div>
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
          {/* Desde que o Login deixou de barrar pelo espelho profiles.status, é aqui que a pessoa
              pendente chega — e um pedido pendente num clube não pode trancá-la para fora de
              outro: quem tem o código de outro clube continua podendo usá-lo. */}
          <Link to="/entrar" data-testid="ir-entrar-pendente"
            className="mt-2 block w-full min-h-[44px] leading-[44px] text-sm text-muted font-semibold">
            Tenho o código de outro clube
          </Link>
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
    // Desativada pela liderança: o vínculo continua existindo, SUSPENSO (meu_contexto o devolve com
    // status 'suspenso'). Antes esta pessoa caía na tela de quem nunca entrou em clube nenhum —
    // "Você ainda não está em um clube", com "Entrar com código" e "Criar um clube". Digitar o código
    // do próprio clube mostrava um "Pedido enviado" falso (o servidor não cria pedido para quem já tem
    // vínculo, e a liderança não via nada), e uma criança desativada era convidada a abrir um clube
    // e virar diretoria dele. Aqui ela fica sabendo a verdade e com quem falar. "Criar um clube"
    // some de propósito; o código de OUTRO clube continua valendo, como no ramo do pendente.
    const suspensos = vinculos.filter((v) => v.status === 'suspenso')
    if (suspensos.length) {
      return (
        <Aviso icone="⏸️" titulo="Seu acesso está suspenso">
          <p className="text-sm text-muted mt-1 mb-5" data-testid="aviso-suspenso">
            Você faz parte de {suspensos.map((v) => v.marca?.nome || v.nome).join(', ')}, mas a liderança
            suspendeu o seu acesso. Para voltar, fale com a liderança do clube.
          </p>
          <div className="space-y-2">
            {temEscopo && (
              <Link to="/institucional" data-testid="ir-portal"
                className="block w-full min-h-[48px] leading-[48px] bg-gradient-to-r from-brand to-brand2 font-extrabold rounded-2xl shadow-glow"
                style={{ color: 'var(--marca-1-texto, #fff)' }}>
                Abrir o portal institucional
              </Link>
            )}
            <button onClick={sair}
              className={`w-full min-h-[48px] font-extrabold rounded-2xl ${
                temEscopo ? 'bg-surface2 text-ink' : 'bg-gradient-to-r from-brand to-brand2 shadow-glow'}`}
              style={temEscopo ? undefined : { color: 'var(--marca-1-texto, #fff)' }}>Sair</button>
            <Link to="/entrar" data-testid="ir-entrar-suspenso"
              className="block w-full min-h-[44px] leading-[44px] text-sm text-muted font-semibold">
              Tenho o código de outro clube
            </Link>
          </div>
        </Aviso>
      )
    }
    return (
      <Aviso icone={temEscopo ? '🏛️' : '🏕️'} titulo={temEscopo ? 'Sua jornada é institucional' : 'Você ainda não está em um clube'}>
        <p className="text-sm text-muted mt-1 mb-5">
          {temEscopo
            ? `Esta conta não participa de nenhum clube, e não precisa: o seu lugar é o portal ${escopos[0]?.nome ? `de ${escopos[0].nome}` : 'institucional'}.`
            : 'Você ainda não participa de nenhum clube. Peça o código de entrada à liderança do seu clube — ou abra o seu próprio.'}
        </p>
        <div className="space-y-2">
          {temEscopo && (
            <Link to="/institucional" data-testid="ir-portal"
              className="block w-full min-h-[48px] leading-[48px] bg-gradient-to-r from-brand to-brand2 font-extrabold rounded-2xl shadow-glow"
              style={{ color: 'var(--marca-1-texto, #fff)' }}>
              Abrir o portal institucional
            </Link>
          )}
          {/* A porta PRINCIPAL desde a fase 8.6. Antes, cadastrar-se já colocava a pessoa dentro do
              Tenant 001 e esta tela quase nunca aparecia; quando aparecia, a única saída oferecida
              era abrir um clube — o que não serve para a maioria, que só quer entrar no clube que
              já existe. Agora entrar é o caminho normal, e abrir um clube é a exceção. */}
          <Link to="/entrar" data-testid="ir-entrar"
            className={`block w-full min-h-[48px] leading-[48px] font-extrabold rounded-2xl ${
              temEscopo ? 'bg-surface2 text-ink' : 'bg-gradient-to-r from-brand to-brand2 shadow-glow'}`}
            style={temEscopo ? undefined : { color: 'var(--marca-1-texto, #fff)' }}>
            Entrar com código
          </Link>
          <Link to="/criar-clube" data-testid="ir-criar-clube"
            className="block w-full min-h-[48px] leading-[48px] font-extrabold rounded-2xl bg-surface2 text-ink">
            Criar um clube
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
