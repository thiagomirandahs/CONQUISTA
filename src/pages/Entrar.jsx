import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useClube } from '../context/Clube.jsx'
import { abrirCodigo, solicitarEntrada, abrirConvite, aceitarConvite } from '../services/entrada.js'
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
      setPronto({ clube: destino.clube, jaEra: r.ja_era || r.ja_era_membro, convite: ehConvite })
      await recarregar()
    } catch (e) { setErro(e.message) }
    setOcupado(false)
  }

  if (pronto) {
    return (
      <Tela titulo={pronto.convite ? '🎉 Pronto!' : '✅ Pedido enviado'}>
        {pronto.convite ? (
          <p className="text-sm text-muted">
            Você agora faz parte de <strong className="text-ink">{pronto.clube}</strong>.
          </p>
        ) : (
          <p className="text-sm text-muted">
            A liderança de <strong className="text-ink">{pronto.clube}</strong> recebeu seu pedido.
            Assim que aprovarem, o clube aparece aqui para você.
          </p>
        )}
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
