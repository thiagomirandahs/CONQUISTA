import { useEffect, useState } from 'react'
import { Botao, Card } from '../ui/index.jsx'
import { avisar } from '../ui/avisos.jsx'
import { pagamentoDisponivel, faturasDoClube, iniciarPagamento, formatarPreco, ROTULO_FATURA } from '../services/comercial.js'

// Pagar / renovar a licença do clube (migration 540). Só aparece quando (1) algum provedor de pagamento foi habilitado no banco e
// (2) a pessoa é da diretoria (o banco recusa a lista de faturas aos demais). Em qualquer falha ao consultar: some, e a tela de
// Planos continua exatamente como era. O valor NUNCA é calculado aqui: vem da fatura que o servidor abre.
const PRECISA_PAGAR = new Set(['trial', 'pagamento_pendente', 'inadimplente', 'suspensa'])
const DIAS_PARA_RENOVAR = 45

export function precisaPagar(assinatura, agora = Date.now()) {
  if (!assinatura?.tem_assinatura || assinatura.status === 'cancelada') return false
  if (PRECISA_PAGAR.has(assinatura.status)) return true
  const fim = assinatura.periodo_fim ? new Date(assinatura.periodo_fim).getTime() : null
  return fim != null && fim - agora <= DIAS_PARA_RENOVAR * 86400000
}

export default function PagarLicenca({ assinatura }) {
  const [pronto, setPronto] = useState(false)
  const [faturas, setFaturas] = useState([])
  const [carregando, setCarregando] = useState(null) // 'pix' | 'cartao'
  const [cobranca, setCobranca] = useState(null)

  useEffect(() => {
    let vivo = true
    ;(async () => {
      try {
        const [ok, lista] = await Promise.all([pagamentoDisponivel(), faturasDoClube()])
        if (vivo) { setFaturas(lista); setPronto(ok) }
      } catch { /* sem permissão ou sem rede: o cartão não aparece */ }
    })()
    return () => { vivo = false }
  }, [])

  if (!pronto) return null
  const pagar = precisaPagar(assinatura)

  async function pagar_(forma) {
    if (carregando) return
    setCarregando(forma)
    try { setCobranca(await iniciarPagamento(forma)) } catch (e) { avisar.erro(e, 'Não consegui gerar o pagamento.') }
    setCarregando(null)
  }
  async function copiar() {
    try { await navigator.clipboard.writeText(cobranca.pix_copia_cola); avisar.sucesso('Código Pix copiado.') } catch { avisar.info('Selecione o código e copie.') }
  }

  return (
    <section className="mt-5" aria-labelledby="t-pagar" data-testid="pagar-licenca">
      <Card>
        <h2 id="t-pagar" className="font-extrabold text-ink">{pagar ? 'Pagar a licença do clube' : 'Licença do clube'}</h2>
        {!pagar && (
          <p className="text-xs text-muted mt-1">
            {assinatura?.periodo_fim ? `Licença em dia até ${new Date(assinatura.periodo_fim).toLocaleDateString('pt-BR')}.` : 'Licença em dia.'}
          </p>
        )}
        {pagar && !cobranca && (
          <>
            <p className="text-xs text-muted mt-1 mb-3">Escolha como pagar. Quando o pagamento for confirmado, a licença é renovada sozinha.</p>
            <div className="grid grid-cols-2 gap-2">
              <Botao aoTocar={() => pagar_('pix')} carregando={carregando === 'pix'} desabilitado={!!carregando}>Pagar com Pix</Botao>
              <Botao variacao="secundario" aoTocar={() => pagar_('cartao')} carregando={carregando === 'cartao'} desabilitado={!!carregando}>Cartão</Botao>
            </div>
          </>
        )}
        {cobranca && (
          <div className="mt-3 space-y-3" data-testid="cobranca-gerada">
            <p className="text-sm text-ink">Valor: <b>{formatarPreco(cobranca.valor_centavos)}</b>{cobranca.vence_em ? ` · vence em ${new Date(`${cobranca.vence_em}T12:00:00`).toLocaleDateString('pt-BR')}` : ''}</p>
            {cobranca.pix_copia_cola && (
              <div>
                <label htmlFor="pix-codigo" className="text-xs font-bold text-ink">Pix copia e cola</label>
                <textarea id="pix-codigo" readOnly rows={3} value={cobranca.pix_copia_cola} onFocus={(e) => e.target.select()}
                  className="w-full mt-1 rounded-lg border border-line bg-surface2 px-3 py-2 text-xs text-ink" />
                <div className="mt-2"><Botao variacao="secundario" aoTocar={copiar}>Copiar código</Botao></div>
              </div>
            )}
            {cobranca.checkout_url && (
              <a href={cobranca.checkout_url} target="_blank" rel="noopener noreferrer"
                className="block text-center min-h-[44px] leading-[44px] rounded-xl bg-brand text-white font-bold text-sm">Abrir página de pagamento</a>
            )}
            <p className="text-xs text-faint">Depois de pagar, volte para esta tela: a confirmação chega em instantes e a licença é renovada automaticamente.</p>
          </div>
        )}
      </Card>

      {faturas.length > 0 && (
        <Card className="mt-3">
          <h3 className="text-xs font-extrabold text-ink mb-2">Faturas</h3>
          <ul className="divide-y divide-line text-sm">
            {faturas.map((f) => (
              <li key={f.id} className="flex items-center justify-between gap-2 py-2">
                <span className="text-ink">{new Date(`${f.competencia}T12:00:00`).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}</span>
                <span className="text-right"><b>{formatarPreco(f.valor_centavos, f.moeda)}</b> <span className="text-xs text-muted">· {ROTULO_FATURA[f.status] || f.status}</span></span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </section>
  )
}
