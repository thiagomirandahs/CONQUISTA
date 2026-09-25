import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { guardarRetorno } from '../lib/retornoPosLogin.js'
import { useClube } from '../context/Clube.jsx'
import { abrirCodigo, abrirCodigoPublico, solicitarEntrada, abrirConvite, aceitarConvite } from '../services/entrada.js'
import { Card, Botao } from '../ui/index.jsx'

// A porta de entrada em um clube (fase 8.6).
//
// Duas formas, mesma tela e mesmo desenho em três tempos:
//
//   1. a pessoa apresenta um SEGREDO — o código do cartaz/QR do clube, ou o token de um convite;
//   2. o servidor devolve a identidade PÚBLICA do clube de destino, e só ela: "Você está entrando
//      em Clube X". Nada de membros, unidades ou contagem — quem ainda não entrou não vê o clube
//      por dentro;
//   3. a pessoa CONFIRMA. É o passo que evita entrar no lugar errado por um dígito trocado.
//
// O que o código NÃO faz é o mais importante: ele não coloca ninguém dentro do clube. Cria uma
// solicitação pendente, e a liderança aprova. O código diz "é para cá"; quem diz "esta pessoa
// entra" continua sendo o clube.
//
// `?convite=` na URL abre o passo 2 direto — é o link que chega por mensagem. O token vai no
// endereço porque é ele a prova; o clube, não: mandar `club_id` na URL seria deixar o cliente
// escolher o destino, que é justamente o que esta fase veio tirar.
export default function Entrar() {
  const [params] = useSearchParams()
  const tokenDaUrl = params.get('convite') || ''
  const codigoDaUrl = (params.get('codigo') || '').trim()
  // `pedir=1`: a pessoa já viu o clube na página pública do link e escolheu entrar/criar conta para
  // ele — ao voltar autenticada, o pedido segue sozinho (ela não procura o link de novo).
  const pedirDireto = params.get('pedir') === '1'
  const jaPediu = useRef(false)
  const { recarregar } = useClube()

  const [codigo, setCodigo] = useState('')
  const [destino, setDestino] = useState(null)   // { clube, sigla, lema, logo_url, papel }
  const [ehConvite, setEhConvite] = useState(false)
  const [erro, setErro] = useState('')
  const [pronto, setPronto] = useState(null)
  const [ocupado, setOcupado] = useState(false)

  // Um convite que veio por link já abre no passo 2: a pessoa clicou, não digitou.
  useEffect(() => {
    if (!tokenDaUrl) return
    setOcupado(true)
    abrirConvite(tokenDaUrl)
      .then((d) => { if (d) { setDestino(d); setEhConvite(true) } else setErro('Este convite não vale mais.') })
      .catch((e) => setErro(e.message))
      .finally(() => setOcupado(false))
  }, [tokenDaUrl])

  // Idem para o código do clube: um QR/link (/entrar?codigo=XXXX) já resolve o destino sozinho —
  // a pessoa não precisa digitar o que acabou de escanear. O servidor continua sendo quem decide
  // se o código vale; isto só evita a etapa de digitação quando ele já veio pronto na URL.
  useEffect(() => {
    if (!codigoDaUrl || tokenDaUrl) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- mesmo padrão já usado acima para `?convite=`
    setCodigo(codigoDaUrl)
    setOcupado(true)
    abrirCodigo(codigoDaUrl)
      .then(async (d) => {
        if (!d) { setErro('Código não encontrado. Confira com a liderança do clube.'); return }
        setDestino(d)
        if (!pedirDireto || jaPediu.current) return
        jaPediu.current = true
        const r = await solicitarEntrada(codigoDaUrl)
        if (!r) { setErro('Não vale mais. Peça outro à liderança do clube.'); return }
        setPronto({ clube: d.clube, jaEra: !!r.ja_era, situacao: r.situacao || null, convite: false })
        await recarregar()
      })
      .catch((e) => setErro(e.message))
      .finally(() => setOcupado(false))
  }, [codigoDaUrl, tokenDaUrl, pedirDireto, recarregar])

  async function conferir(e) {
    e.preventDefault()
    setErro(''); setOcupado(true)
    try {
      const d = await abrirCodigo(codigo.trim())
      // Código errado, revogado, vencido e inexistente dão a MESMA resposta — do servidor e daqui.
      // A diferença entre "não existe" e "existe mas venceu" já confirmaria que o clube existe.
      if (d) setDestino(d)
      else setErro('Código não encontrado. Confira com a liderança do clube.')
    } catch (e2) { setErro(e2.message) }
    setOcupado(false)
  }

  async function confirmar() {
    setErro(''); setOcupado(true)
    try {
      const r = ehConvite ? await aceitarConvite(tokenDaUrl) : await solicitarEntrada(codigo.trim())
      if (!r) { setErro('Não vale mais. Peça outro à liderança do clube.'); setOcupado(false); return }
      setPronto({ clube: destino.clube, jaEra: !!(r.ja_era || r.ja_era_membro), situacao: r.situacao || null, convite: ehConvite })
      await recarregar()
    } catch (e) { setErro(e.message) }
    setOcupado(false)
  }

  if (pronto) {
    const { titulo, texto } = resultadoDaEntrada(pronto)
    return (
      <Tela titulo={titulo}>
        <p className="text-sm text-muted" data-testid="resultado-entrada">{texto}</p>
        {/* Sem esta saída a tela era um beco: no app instalado (PWA/iPhone) não há botão de voltar.
            O início passa pelo porteiro do clube, que mostra a situação real da pessoa. */}
        <Link to="/" data-testid="voltar-inicio"
          className="mt-4 block w-full min-h-[44px] leading-[44px] text-sm text-muted font-semibold">
          Voltar ao início
        </Link>
      </Tela>
    )
  }

  // Passo 2: confirmar o destino.
  if (destino) {
    return (
      <Tela titulo="Confirme o clube">
        <div className="flex items-center gap-3 my-4" data-testid="destino">
          {destino.logo_url
            ? <img src={destino.logo_url} alt="" className="w-12 h-12 rounded-xl object-cover" />
            : <div className="w-12 h-12 rounded-xl bg-surface2 grid place-items-center font-extrabold text-ink">{destino.sigla || '?'}</div>}
          <div className="min-w-0 text-left">
            <p className="font-extrabold text-ink truncate">{destino.clube}</p>
            {destino.lema && <p className="text-xs text-muted truncate">{destino.lema}</p>}
          </div>
        </div>
        <p className="text-sm text-muted mb-4">
          {ehConvite
            ? 'Ao confirmar, você passa a fazer parte deste clube.'
            : 'Ao confirmar, a liderança deste clube recebe o seu pedido de entrada. Você entra quando eles aprovarem.'}
        </p>
        <Botao aoTocar={confirmar} carregando={ocupado} data-testid="confirmar-entrada">
          {ehConvite ? 'Entrar no clube' : 'Pedir para entrar'}
        </Botao>
        <button onClick={() => { setDestino(null); setErro('') }} className="mt-2 w-full min-h-[44px] text-sm text-muted font-semibold">
          Não é este clube
        </button>
        {erro && <p className="text-xs text-red-600 mt-3">{erro}</p>}
      </Tela>
    )
  }

  // Passo 1: o segredo.
  return (
    <Tela titulo="Entrar em um clube">
      <p className="text-sm text-muted mb-4">
        Peça o código de entrada à liderança do seu clube — ele costuma estar num cartaz ou num QR.
      </p>
      <form onSubmit={conferir} className="space-y-2">
        <input value={codigo} onChange={(e) => setCodigo(e.target.value.toUpperCase())}
          data-testid="campo-codigo" placeholder="CÓDIGO DO CLUBE" autoComplete="off"
          className="w-full min-h-[48px] text-center tracking-[0.2em] font-mono text-ink rounded-xl border border-line px-3" />
        <Botao tipo="submit" carregando={ocupado} desabilitado={codigo.trim().length < 4} data-testid="conferir-codigo">
          Continuar
        </Botao>
      </form>
      {erro && <p className="text-xs text-red-600 mt-3" data-testid="erro-codigo">{erro}</p>}
    </Tela>
  )
}

// O que dizer depois de confirmar. O servidor não cria um segundo vínculo para quem JÁ tem um neste
// clube (entrada_solicitar devolve `ja_era: true` e a `situacao` do vínculo que já existe;
// convite_aceitar devolve `ja_era_membro`). Antes esta tela ignorava isso e dizia "✅ Pedido
// enviado" para todo mundo — inclusive para quem foi desativado ou recusado, que ficava esperando
// uma aprovação que nunca viria, porque nenhum pedido tinha sido criado e a liderança não via nada.
// Cada mensagem aqui diz o que de fato aconteceu e, quando a pessoa não tem o que fazer no app,
// manda falar com a liderança (é ela quem reativa: o código não promove nem reativa ninguém).
function resultadoDaEntrada({ clube, jaEra, situacao, convite }) {
  const nome = <strong className="text-ink">{clube}</strong>
  if (!jaEra) {
    return convite
      ? { titulo: '🎉 Pronto!', texto: <>Você agora faz parte de {nome}.</> }
      : { titulo: '✅ Pedido enviado', texto: <>A liderança de {nome} recebeu seu pedido. Assim que aprovarem, o clube aparece aqui para você.</> }
  }
  // convite_aceitar só diz "já era membro", sem a situação: a mensagem não pode prometer acesso
  if (!convite && situacao === 'pendente') {
    return { titulo: '⏳ Pedido já enviado', texto: <>Você já tinha pedido para entrar em {nome}, e o pedido continua aguardando a liderança. Não precisa pedir de novo.</> }
  }
  if (!convite && situacao === 'ativo') {
    return { titulo: '✅ Você já faz parte deste clube', texto: <>Você já faz parte de {nome}. Nenhum pedido novo foi preciso.</> }
  }
  if (!convite && situacao === 'suspenso') {
    return { titulo: '⏸️ Acesso suspenso', texto: <>Você já faz parte de {nome}, mas seu acesso está suspenso. Um código novo não muda isso: fale com a liderança do clube.</> }
  }
  if (!convite && situacao === 'encerrado') {
    return { titulo: '🚫 Pedido recusado', texto: <>Seu pedido anterior para entrar em {nome} foi recusado (ou o seu vínculo foi encerrado). Um código novo não reabre o pedido: fale com a liderança do clube.</> }
  }
  return { titulo: 'ℹ️ Você já tinha cadastro aqui', texto: <>Você já tinha um cadastro em {nome}, então nada novo foi criado. Se o clube não abrir para você, fale com a liderança.</> }
}

function Tela({ titulo, children }) {
  return (
    <div className="min-h-screen grid place-items-center p-6 text-center">
      <Card className="max-w-sm w-full p-5">
        <p className="font-extrabold text-ink text-lg mb-1">{titulo}</p>
        {children}
      </Card>
    </div>
  )
}

// Quem abre o link/QR do clube SEM conta. O servidor resolve o clube pelo código (e só mostra a
// identidade pública dele); a pessoa decide entre entrar ou criar conta, e o caminho de volta —
// com o código e a intenção de pedir entrada — vai junto na URL e no retorno pós-login, para
// sobreviver a refresh e à navegação entre login e cadastro.
const iniciais = (nome = '') => nome.split(/\s+/).filter((p) => p.length > 2).slice(0, 2).map((p) => p[0]).join('').toUpperCase() || '•'

export function InscricaoPublica() {
  const [params] = useSearchParams()
  const codigo = (params.get('codigo') || '').trim()
  const [clube, setClube] = useState(null)
  const [estado, setEstado] = useState(codigo ? 'carregando' : 'sem_codigo')
  const [erro, setErro] = useState('')

  useEffect(() => {
    if (!codigo) return
    abrirCodigoPublico(codigo)
      .then((d) => { if (d) { setClube(d); setEstado('ok') } else setEstado('invalido') })
      .catch((e) => { setErro(e.message); setEstado('erro') })
  }, [codigo])

  const volta = `/entrar?codigo=${encodeURIComponent(codigo)}&pedir=1`
  const lembrar = () => guardarRetorno(volta)
  const proximo = `?proximo=${encodeURIComponent(volta)}`

  if (estado === 'carregando') return <Tela titulo="Inscrição no clube"><p className="text-sm text-muted" role="status">Conferindo o link…</p></Tela>
  if (estado !== 'ok') {
    return (
      <Tela titulo="Inscrição no clube">
        <p className="text-sm text-muted mb-4" data-testid="inscricao-invalida">
          {estado === 'erro' ? erro
            : estado === 'sem_codigo' ? 'Para entrar num clube, use o link ou o QR Code que a liderança do seu clube compartilhou.'
              : 'Este link não é válido ou não está mais ativo. Peça um link novo à liderança do clube.'}
        </p>
        <Link to="/login" className="block w-full min-h-[44px] leading-[44px] text-sm font-semibold text-brand">Ir para o login</Link>
      </Tela>
    )
  }

  return (
    <Tela titulo="Inscrição no clube">
      <div className="flex flex-col items-center gap-2 my-4" data-testid="inscricao-clube">
        {clube.logo_url
          ? <img src={clube.logo_url} alt="" className="w-16 h-16 rounded-2xl object-cover" />
          : <div className="w-16 h-16 rounded-2xl bg-surface2 grid place-items-center font-extrabold text-ink">{clube.sigla || iniciais(clube.clube)}</div>}
        <p className="font-extrabold text-ink text-xl">{clube.clube}</p>
        {clube.lema && <p className="text-xs text-muted">{clube.lema}</p>}
      </div>
      <p className="text-sm text-muted mb-5">Você está solicitando participação neste clube. A liderança recebe o seu pedido e aprova a sua entrada.</p>
      <div className="space-y-2">
        <Link to={`/login${proximo}`} onClick={lembrar} data-testid="ja-tenho-conta"
          className="block w-full min-h-[48px] leading-[48px] rounded-xl bg-gradient-to-r from-brand to-brand2 text-white font-bold">
          Já tenho conta
        </Link>
        <Link to={`/cadastro${proximo}`} onClick={lembrar} data-testid="criar-conta"
          className="block w-full min-h-[48px] leading-[48px] rounded-xl border border-line text-ink font-bold">
          Criar minha conta
        </Link>
      </div>
    </Tela>
  )
}
