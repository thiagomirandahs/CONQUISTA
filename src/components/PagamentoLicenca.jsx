import { useEffect, useState } from 'react'
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
  useEffect(() => {
    let vivo = true
    pagamentoLicenca('situacao').then(d => { if (vivo) setSituacao(d) }).catch(() => { if (vivo) setSituacao({ habilitado: false }) })
    return () => { vivo = false }
  }, [])

  async function confirmar() {
    const q = new URLSearchParams(search)
    setOcupado(true); setErro('')
    try {
      const resultado = await pagamentoLicenca('confirmar', { order_nsu: q.get('order_nsu'), transaction_nsu: q.get('transaction_nsu'), slug: q.get('slug') })
      if (resultado?.ok !== true) throw new Error('Pagamento ainda não confirmado. Procure o suporte antes de pagar novamente.')
      setPago(true)
      await aoConfirmar()
    } catch (e) { setErro(e.message) } finally { setOcupado(false) }
  }

  async function criar() {
    setOcupado(true); setErro('')
    try {
      const d = await pagamentoLicenca('criar')
      if (!d.habilitado && !d.url) throw new Error('Pagamento online ainda indisponível. Fale com a administração.')
      setUrl(urlCheckoutLicenca(d.url))
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
      em até {situacao.parcelas}x sem juros para o clube. Confira o total antes de confirmar.
    </p>}
    <p className="text-xs text-muted mt-2">O pagamento abre na InfinitePay. A licença é ativada após a confirmação do pagamento.</p>
    {erro && <p role="alert" className="text-sm text-red-700 mt-2">{erro}</p>}
    {retorno && <button onClick={confirmar} disabled={ocupado} className="w-full min-h-12 bg-brand text-white rounded-xl font-bold mt-3 disabled:opacity-50">{ocupado ? 'Verificando…' : 'Confirmar pagamento'}</button>}
    {!retorno && situacao.pode_pagar && !url && <button onClick={criar} disabled={ocupado} className="w-full min-h-12 bg-brand text-white rounded-xl font-bold mt-3 disabled:opacity-50">{ocupado ? 'Preparando…' : 'Preparar pagamento'}</button>}
    {url && <a href={url} target="_blank" rel="noopener noreferrer" className="flex justify-center items-center min-h-12 bg-brand text-white rounded-xl font-bold mt-3">Continuar na InfinitePay</a>}
    <button onClick={() => aoConfirmar().catch(() => setErro('Não foi possível atualizar a licença.'))} className="min-h-11 text-brand text-sm underline mt-2">Atualizar situação da licença</button>
  </section>
}
