import { useEffect, useState } from 'react'
import { lerPagamentoDoClube, salvarPagamentoDoClube } from '../services/unidades.js'
import { TIPOS_FORMA, MAX_FORMAS } from '../lib/formasPagamento.js'
import { Card, Botao, Campo, Aviso, mensagemDeErro } from '../ui/index.jsx'
import { avisar } from '../ui/avisos.jsx'

// Diretoria cadastra o valor da mensalidade e as formas de pagamento; os responsáveis veem isso em
// "Meu Filho" quando há mensalidade pendente. A regra (validação) mora em lib/formasPagamento.js.
export default function FormasPagamentoConfig() {
  const [formas, setFormas] = useState([])
  const [valor, setValor] = useState('')
  const [carregando, setCarregando] = useState(true)
  const [falha, setFalha] = useState(false)
  const [salvando, setSalvando] = useState(false)
  const [sujo, setSujo] = useState(false)

  useEffect(() => {
    let vivo = true
    lerPagamentoDoClube()
      .then((r) => { if (vivo) { setFormas(r.formas); setValor(r.valor ? String(r.valor) : ''); setFalha(false) } })
      .catch(() => { if (vivo) setFalha(true) })
      .finally(() => { if (vivo) setCarregando(false) })
    return () => { vivo = false }
  }, [])

  const mudar = (i, campo, v) => { setFormas((fs) => fs.map((f, j) => (j === i ? { ...f, [campo]: v } : f))); setSujo(true) }
  const adicionar = (tipo) => { setFormas((fs) => [...fs, { tipo, rotulo: '', detalhe: '' }]); setSujo(true) }
  const remover = (i) => { setFormas((fs) => fs.filter((_, j) => j !== i)); setSujo(true) }

  async function salvar() {
    setSalvando(true)
    try { await salvarPagamentoDoClube({ formas, valor }); setSujo(false); avisar.sucesso('Pagamento salvo. Os responsáveis já veem.') }
    catch (e) { avisar.erro(mensagemDeErro(e, 'Não consegui salvar.')) }
    setSalvando(false)
  }

  if (carregando) return null
  return (
    <Card className="mb-4" data-testid="config-pagamento">
      <p className="font-bold text-ink mb-1">💰 Mensalidade e formas de pagamento</p>
      <p className="text-xs text-faint mb-3">Os responsáveis veem o valor e como pagar na tela "Meu Filho" quando há mensalidade pendente.</p>
      {falha && <Aviso tom="erro">Não consegui carregar o que já estava salvo. Salvar agora pode apagar o que existe — recarregue a página.</Aviso>}
      <Campo id="pg-valor" rotulo="Valor da mensalidade (R$)" tipo="number" min="0" step="0.01" inputMode="decimal" value={valor}
        onChange={(e) => { setValor(e.target.value); setSujo(true) }} />
      <ul className="space-y-3">
        {formas.map((f, i) => (
          <li key={i} className="rounded-xl border border-line p-3" data-testid="forma-pagamento">
            <div className="flex items-center justify-between gap-2 mb-2">
              <span className="text-sm font-semibold text-ink">{TIPOS_FORMA[f.tipo].icone} {TIPOS_FORMA[f.tipo].rotulo}</span>
              <button type="button" onClick={() => remover(i)} aria-label={`Remover ${TIPOS_FORMA[f.tipo].rotulo}`}
                className="min-h-[44px] min-w-[44px] text-xs text-red-600 font-semibold">Remover</button>
            </div>
            <Campo id={`pg-d-${i}`} rotulo={TIPOS_FORMA[f.tipo].dica} value={f.detalhe} maxLength={300} linhas={f.tipo === 'outro' || f.tipo === 'conta' ? 3 : undefined}
              onChange={(e) => mudar(i, 'detalhe', e.target.value)} />
            <Campo id={`pg-r-${i}`} rotulo="Observação (opcional)" value={f.rotulo} maxLength={60} placeholder="ex.: até o dia 10"
              onChange={(e) => mudar(i, 'rotulo', e.target.value)} />
          </li>
        ))}
      </ul>
      {formas.length < MAX_FORMAS && (
        <div className="mt-3">
          <p className="text-xs font-semibold text-muted mb-1">Adicionar forma de pagamento</p>
          <div className="flex flex-wrap gap-2">
            {Object.entries(TIPOS_FORMA).map(([tipo, t]) => (
              <button key={tipo} type="button" onClick={() => adicionar(tipo)}
                className="min-h-[44px] px-3 rounded-xl border border-line text-sm text-ink bg-surface2">{t.icone} {t.rotulo}</button>
            ))}
          </div>
        </div>
      )}
      <Botao className="w-full mt-4" aoTocar={salvar} carregando={salvando} desabilitado={!sujo || falha}>Salvar</Botao>
    </Card>
  )
}
