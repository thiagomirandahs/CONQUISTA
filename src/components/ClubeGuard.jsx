import { useAuth } from '../context/Auth.jsx'
import { useClube } from '../context/Clube.jsx'
import Logo from './Logo.jsx'

// Porteiro do app: só deixa passar quem tem VÍNCULO ATIVO com um clube em uso.
//  * carregando           -> espera o contexto do clube;
//  * erro de rede/servidor -> "tentar de novo" (NUNCA cai num papel/clube "por padrão" — falha fechada);
//  * sem vínculo ativo     -> tela clara (cadastro pendente, vínculo suspenso ou conta sem clube), com saída.
export default function ClubeGuard({ children }) {
  const { sair } = useAuth()
  const { carregando, erro, semVinculo, vinculos, recarregar, marca } = useClube()

  if (carregando) {
    return (
      <div className="min-h-full grid place-items-center bg-azul text-white p-6">
        <div className="text-center">
          <Logo className="w-16 h-16 mx-auto mb-3" />
          <p className="text-blue-100 text-sm">Carregando...</p>
        </div>
      </div>
    )
  }

  if (erro) {
    return (
      <Aviso icone="📡" titulo="Não deu pra carregar o seu clube">
        <p className="text-sm text-muted mt-1 mb-5">Confira a internet e tente de novo. Nada foi liberado enquanto isso.</p>
        <button onClick={recarregar} className="w-full bg-gradient-to-r from-brand to-brand2 text-white font-extrabold rounded-2xl py-3 shadow-glow">Tentar de novo</button>
        <button onClick={sair} className="mt-2 w-full text-sm text-muted font-semibold py-2">Sair</button>
      </Aviso>
    )
  }

  if (semVinculo) {
    const pendente = vinculos.some((v) => v.status === 'pendente')
    return (
      <Aviso icone={pendente ? '⏳' : '🔒'} titulo={pendente ? 'Seu cadastro aguarda aprovação' : 'Sem acesso a nenhum clube'}>
        <p className="text-sm text-muted mt-1 mb-5">
          {pendente
            ? `A liderança de ${vinculos.find((v) => v.status === 'pendente')?.marca?.nome || marca.nome} ainda vai liberar o seu acesso.`
            : 'Esta conta não tem vínculo ativo com nenhum clube. Fale com a liderança do seu clube.'}
        </p>
        <button onClick={sair} className="w-full bg-gradient-to-r from-brand to-brand2 text-white font-extrabold rounded-2xl py-3 shadow-glow">Sair</button>
      </Aviso>
    )
  }

  return children
}

function Aviso({ icone, titulo, children }) {
  return (
    <div className="min-h-screen grid place-items-center p-6 text-center">
      <div className="max-w-sm">
        <div className="text-5xl mb-3">{icone}</div>
        <p className="font-extrabold text-ink text-lg">{titulo}</p>
        {children}
      </div>
    </div>
  )
}
