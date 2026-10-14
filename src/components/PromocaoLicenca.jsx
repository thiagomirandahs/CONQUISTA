import { useEffect, useState } from 'react'
import { carregarPromocaoLicenca, formatarPreco } from '../services/comercial.js'

export default function PromocaoLicenca() {
  const [oferta, setOferta] = useState(null)
  useEffect(() => {
    let vivo = true
    const carregar = () => carregarPromocaoLicenca().then(d => { if (vivo) setOferta(d) }).catch(() => { if (vivo) setOferta(null) })
    carregar()
    const timer = setInterval(carregar, 30000)
    return () => { vivo = false; clearInterval(timer) }
  }, [])
  if (!oferta) return null
  return <aside className="rounded-2xl border border-gold/30 bg-gold/10 p-4 mb-5 text-sm text-ink" aria-label="Oferta de lançamento">
    {oferta.disponiveis > 0 ? <>
      <p className="font-extrabold">Primeiros {oferta.limite} clubes: {formatarPreco(oferta.valor_centavos)} no primeiro ano</p>
      <p className="mt-1">Mesmo valor no Pix e no cartão. Depois, preço regular de {formatarPreco(oferta.regular_centavos)} por ano.</p>
      <p className="mt-2">{oferta.confirmados} pagamentos confirmados · {oferta.reservados} vagas reservadas · {oferta.disponiveis} disponíveis.</p>
      <p className="text-xs mt-1">A vaga é reservada ao preparar o pagamento, conforme disponibilidade. Criar conta não garante o desconto.</p>
    </> : <p>{oferta.confirmados >= oferta.limite ? 'As vagas de lançamento foram preenchidas.' : 'Todas as vagas de lançamento estão confirmadas ou reservadas.'} A licença anual está disponível pelo preço regular de {formatarPreco(oferta.regular_centavos)} no Pix ou cartão.</p>}
  </aside>
}
