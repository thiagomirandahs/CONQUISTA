// Recuperação de senha (fase 8.1).
//
// Por que isto existe: até agora a tela de login dizia "Esqueceu a senha? Fale com um líder do
// clube — ele cria uma nova pra você". Isso tem dois problemas. O primeiro é que a liderança
// passava a conhecer a senha das crianças, o que não deveria acontecer nunca. O segundo é que,
// com a confirmação de e-mail ligada para produção, quem esquecesse a senha ficaria simplesmente
// preso: não há caminho de volta que não passe por outra pessoa.
//
// São duas telas porque o fluxo tem duas pernas, separadas pelo e-mail:
//   /recuperar   pede o e-mail e dispara o link            (sem sessão)
//   /nova-senha  recebe quem voltou pelo link e troca      (com a sessão de recuperação)
//
// A tela de pedido responde SEMPRE a mesma coisa, exista a conta ou não. Se dissesse "e-mail não
// encontrado", viraria um jeito de descobrir quem tem conta no clube — e as contas aqui são de
// menores de idade.
import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import Logo from '../components/Logo.jsx'
import { supabase } from '../lib/supabase.js'
import { useClube } from '../context/Clube.jsx'
import { Botao, Campo, Aviso, mensagemDeErro } from '../ui/index.jsx'

function Moldura({ titulo, children }) {
  const { marca } = useClube()
  return (
    <div className="min-h-full flex flex-col items-center justify-center p-6 bg-gradient-to-br from-brand via-brand2 to-brand">
      <div className="w-full max-w-sm bg-surface rounded-2xl shadow-soft p-7">
        <div className="flex flex-col items-center mb-5">
          <Logo className="w-20 h-20 mb-3" />
          <h1 className="text-brand text-lg font-extrabold text-center leading-tight">{titulo}</h1>
          <p className="text-muted text-sm text-center">{marca.nome}</p>
        </div>
        {children}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Perna 1: pedir o link
// ---------------------------------------------------------------------------
export default function Recuperar() {
  const [email, setEmail] = useState('')
  const [enviado, setEnviado] = useState(false)
  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState('')

  async function pedir(e) {
    e.preventDefault()
    setErro('')
    setCarregando(true)
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/nova-senha`,
    })
    setCarregando(false)
    // Só erro de REDE/limite aparece. "Conta não existe" nunca vira mensagem: a resposta é
    // idêntica nos dois casos, de propósito (ver o comentário do topo).
    if (error && !/user|not found|invalid/i.test(error.message)) {
      setErro(mensagemDeErro(error, 'Não consegui enviar o e-mail agora.'))
      return
    }
    setEnviado(true)
  }

  if (enviado) {
    return (
      <Moldura titulo="Verifique seu e-mail">
        <Aviso tom="sucesso" titulo="Link enviado">
          Se existir uma conta com <strong>{email}</strong>, o link para criar uma senha nova chegou
          lá. Ele vale por 1 hora e só pode ser usado uma vez.
        </Aviso>
        <p className="text-sm text-muted mt-4">
          Não chegou? Confira a caixa de spam. O e-mail pode levar alguns minutos.
        </p>
        <div className="mt-5">
          <Botao variacao="secundario" para="/login">Voltar para o login</Botao>
        </div>
      </Moldura>
    )
  }

  return (
    <Moldura titulo="Esqueceu a senha?">
      <form onSubmit={pedir} className="space-y-4">
        <Campo id="email-recuperar" rotulo="E-mail da conta" tipo="email" required
          value={email} onChange={(e) => setEmail(e.target.value)} placeholder="voce@email.com"
          ajuda="Enviamos um link para você criar uma senha nova." />
        {erro && <Aviso tom="erro" titulo="Não deu certo">{erro}</Aviso>}
        <Botao tipo="submit" carregando={carregando}>Enviar o link</Botao>
      </form>
      <p className="text-center text-sm mt-5 text-muted">
        Lembrou? <Link to="/login" className="text-brand font-semibold hover:underline">Entrar</Link>
      </p>
    </Moldura>
  )
}

// ---------------------------------------------------------------------------
// Perna 2: definir a senha nova
// ---------------------------------------------------------------------------
export function NovaSenha() {
  const navigate = useNavigate()
  const [pronto, setPronto] = useState(false)   // a sessão de recuperação chegou?
  const [senha, setSenha] = useState('')
  const [repete, setRepete] = useState('')
  const [erro, setErro] = useState('')
  const [carregando, setCarregando] = useState(false)
  const [trocada, setTrocada] = useState(false)

  // O link do e-mail traz o token no fragmento da URL. O supabase-js o consome sozinho e emite
  // PASSWORD_RECOVERY. Antes disso não há sessão nenhuma — daí esperar o evento em vez de
  // assumir que quem abriu a página está autenticado.
  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((evento, sessao) => {
      if (evento === 'PASSWORD_RECOVERY' || sessao) setPronto(true)
    })
    supabase.auth.getSession().then(({ data }) => { if (data.session) setPronto(true) })
    return () => sub.subscription.unsubscribe()
  }, [])

  async function trocar(e) {
    e.preventDefault()
    setErro('')
    if (senha !== repete) { setErro('As duas senhas precisam ser iguais.'); return }
    setCarregando(true)
    const { error } = await supabase.auth.updateUser({ password: senha })
    setCarregando(false)
    if (error) { setErro(mensagemDeErro(error, 'Não consegui trocar a senha.')); return }
    // Encerra a sessão de recuperação: quem trocou a senha entra de novo com ela.
    // Assim o link do e-mail não deixa ninguém logado por engano num aparelho emprestado.
    await supabase.auth.signOut()
    setTrocada(true)
  }

  if (trocada) {
    return (
      <Moldura titulo="Senha trocada">
        <Aviso tom="sucesso" titulo="Pronto">Agora entre com a senha nova.</Aviso>
        <div className="mt-5"><Botao aoTocar={() => navigate('/login')}>Ir para o login</Botao></div>
      </Moldura>
    )
  }

  if (!pronto) {
    return (
      <Moldura titulo="Link inválido ou vencido">
        <Aviso tom="atencao" titulo="Este link não serve mais">
          Links de recuperação valem 1 hora e só funcionam uma vez. Peça um novo.
        </Aviso>
        <div className="mt-5"><Botao para="/recuperar">Pedir outro link</Botao></div>
      </Moldura>
    )
  }

  return (
    <Moldura titulo="Criar senha nova">
      <form onSubmit={trocar} className="space-y-4">
        <Campo id="senha-nova" rotulo="Senha nova" tipo="password" required minLength={8}
          value={senha} onChange={(e) => setSenha(e.target.value)}
          ajuda="Pelo menos 8 caracteres, com letras e números." autoComplete="new-password" />
        <Campo id="senha-repete" rotulo="Repita a senha" tipo="password" required minLength={8}
          value={repete} onChange={(e) => setRepete(e.target.value)} autoComplete="new-password" />
        {erro && <Aviso tom="erro" titulo="Não deu certo">{erro}</Aviso>}
        <Botao tipo="submit" carregando={carregando}>Salvar a senha nova</Botao>
      </form>
    </Moldura>
  )
}
