import { useEffect, useState, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import { pagamentoLicenca, urlCheckoutLicenca } from '../services/pagamentoLicenca.js'
import { formatarPreco } from '../services/comercial.js'

export default function PagamentoLicenca({ aoConfirmar }) {
  const [situacao, setSituacao] = useState(null)
  const [erro, setErro] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const [url, setUrl] = useState('')
  const [pago, setPago] = useState(false)
  const { search } = useLocation()
  const aoConfirmarRef = useRef(aoConfirmar)
  aoConfirmarRef.current = aoConfirmar
  const notificou = useRef(false)
  const aguardando = useRef(new URLSearchParams(search).has('order_nsu'))
  useEffect(() => {
    let vivo = true
    let buscando = false
    async function atualizar() {
      if (buscando) return
      buscando = true
      try {
        const d = await pagamentoLicenca('situacao')
        if (!vivo) return
        setSituacao(d)
        if (d.habilitado && d.licenca_ativa && aguardando.current && !notificou.current) {
          notificou.current = true
          setPago(true)
          await aoConfirmarRef.current()
        }
      } catch { /* mantém o último estado; falha de consulta não indica pagamento */ }
      finally { buscando = false }
    }
    atualizar()
    const timer = setInterval(atualizar, 8000)
    return () => { vivo = false; clearInterval(timer) }
  }, [])


  async function confirmar() {
    const q = new URLSearchParams(search)
    setOcupado(true); setErro('')
    try {
      const resultado = await pagamentoLicenca('confirmar', { order_nsu: q.get('order_nsu'), transaction_nsu: q.get('transaction_nsu'), slug: q.get('slug') })
      if (resultado?.ok !== true) throw new Error('Pagamento ainda não confirmado. Procure o suporte antes de pagar novamente.')
      setPago(true)
      notificou.current = true
      await aoConfirmarRef.current()
    } catch (e) { setErro(e.message) } finally { setOcupado(false) }
  }

  async function criar() {
    setOcupado(true); setErro('')
    try {
      const d = await pagamentoLicenca('criar')
      if (!d.habilitado && !d.url) throw new Error('Pagamento online ainda indisponível. Fale com a administração.')
      const segura = urlCheckoutLicenca(d.url)
      aguardando.current = true
      setSituacao(anterior => ({ ...anterior, ...d }))
      setUrl(segura)
    } catch (e) { setErro(e.message) } finally { setOcupado(false) }
  }

  const retorno = new URLSearchParams(search).has('order_nsu')
  if (!situacao?.habilitado) return null
  if (pago) return <p role="status" className="rounded-xl bg-emerald-50 p-4 text-emerald-800">Pagamento confirmado. Sua licença anual está ativa.</p>
  if (!situacao.pode_pagar && !retorno) return null
  return <section className="bg-surface border border-line rounded-2xl p-4 mt-4" aria-label="Pagamento da licença">
    <h2 className="font-bold text-ink">Pagar a licença anual</h2>
    {situacao.pode_pagar && <p className="text-sm text-muted mt-2">
      {formatarPreco(situacao.pix_centavos)} no Pix ou {formatarPreco(situacao.cartao_centavos)} no cartão,
      em até {situacao.parcelas}x, conforme condições do checkout. Confira o total antes de confirmar.
    </p>}
    {situacao.promocao && <p className="text-sm font-semibold text-amber-800 mt-2">Oferta de lançamento no primeiro ano. Renovação pelo preço regular de {formatarPreco(situacao.renovacao_centavos)} por ano.</p>}
    <p className="text-xs text-muted mt-2">O pagamento abre na InfinitePay. A licença é ativada automaticamente após a confirmação do pagamento. Esta tela atualiza a situação automaticamente.</p>
    {erro && <p role="alert" className="text-sm text-red-700 mt-2">{erro}</p>}
    {retorno && <button onClick={confirmar} disabled={ocupado} className="w-full min-h-12 bg-brand text-white rounded-xl font-bold mt-3 disabled:opacity-50">{ocupado ? 'Verificando…' : 'Confirmar pagamento'}</button>}
    {!retorno && situacao.pode_pagar && !url && <button onClick={criar} disabled={ocupado} className="w-full min-h-12 bg-brand text-white rounded-xl font-bold mt-3 disabled:opacity-50">{ocupado ? 'Preparando…' : 'Preparar pagamento'}</button>}
    {url && <a href={url} target="_blank" rel="noopener noreferrer" className="flex justify-center items-center min-h-12 bg-brand text-white rounded-xl font-bold mt-3">Continuar na InfinitePay</a>}
    <button onClick={() => aoConfirmar().catch(() => setErro('Não foi possível atualizar a licença.'))} className="min-h-11 text-brand text-sm underline mt-2">Atualizar situação da licença</button>
  </section>
}
