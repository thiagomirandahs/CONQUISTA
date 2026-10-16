import { useCallback, useEffect, useState } from 'react'
import { pagamentosRecebidos } from '../../services/pagamento.js'
import { baixarCSV } from '../../lib/csv.js'
import { Card, Botao } from '../../ui/index.jsx'
import { Kpi, Chip, Nota, LinkAcao, dataHoraBR } from './AdminUI.jsx'

const reais = (c) => (Number(c || 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const metodoTexto = (m) => (m === 'pix' ? 'Pix' : m === 'credit_card' ? 'Cartão' : '—')

// /admin › Assinaturas: o que entrou pela InfinitePay (migration 552). Licenças contam na receita; testes aparecem à parte.
// Valores BRUTOS (o que o cliente pagou). Taxa e valor líquido ficam no painel da InfinitePay.
export default function PagamentosRecebidos() {
  const [dados, setDados] = useState(null)
  const [falha, setFalha] = useState(false)
  const carregar = useCallback(() => {
    pagamentosRecebidos().then((d) => { setFalha(false); setDados(d) }).catch(() => setFalha(true))
  }, [])
  useEffect(() => { carregar() }, [carregar])

  function exportar() {
    baixarCSV('pagamentos-recebidos.csv', ['Data', 'Clube', 'Tipo', 'Método', 'Valor (R$)', 'Transação'],
      dados.itens.map((p) => [dataHoraBR(p.pago_em), p.clube, p.tipo === 'teste' ? 'Teste' : p.promocao ? 'Licença (lançamento)' : 'Licença',
        metodoTexto(p.metodo), (Number(p.valor_centavos || 0) / 100).toFixed(2).replace('.', ','), p.transacao || '']))
  }

  if (falha && !dados) {
    return (
      <Card data-testid="pagamentos-recebidos">
        <p className="font-bold text-ink">📒 Pagamentos recebidos</p>
        <Nota icone="⚠️">Não consegui carregar o histórico. <LinkAcao aoTocar={carregar}>Tentar de novo</LinkAcao></Nota>
      </Card>
    )
  }
  if (!dados) return <Card data-testid="pagamentos-recebidos"><p className="text-xs text-muted" role="status">Carregando…</p></Card>

  const t = dados.totais
  return (
    <Card data-testid="pagamentos-recebidos">
      <div className="flex items-center gap-2 mb-3">
        <p className="flex-1 font-bold text-ink">📒 Pagamentos recebidos</p>
        <LinkAcao aoTocar={carregar}>Atualizar</LinkAcao>
      </div>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Kpi icone="📅" tom="ok" valor={reais(t.licencas_mes_centavos)} rotulo="Recebido no mês" detalhe={`${t.licencas_mes_quantidade || 0} licença(s)`} testid="recebido-mes" />
        <Kpi icone="💰" valor={reais(t.licencas_total_centavos)} rotulo="Total recebido" detalhe={`${t.licencas_quantidade || 0} licença(s)`} testid="recebido-total" />
        <Kpi icone="⚡" valor={reais(t.pix_centavos)} rotulo="Pelo Pix" testid="recebido-pix" />
        <Kpi icone="💳" valor={reais(t.cartao_centavos)} rotulo="Pelo cartão" testid="recebido-cartao" />
      </div>
      {t.testes_quantidade > 0 && (
        <p className="mt-2 text-xs text-muted" data-testid="recebido-testes">
          Testes: {reais(t.testes_total_centavos)} em {t.testes_quantidade} pagamento(s) — fora dos totais.
        </p>
      )}
      {dados.itens.length === 0
        ? <div className="mt-3"><Nota>Nenhum pagamento confirmado ainda.</Nota></div>
        : (
          <>
            <ul className="mt-3 divide-y divide-line" data-testid="recebidos-lista">
              {dados.itens.map((p) => (
                <li key={`${p.tipo}-${p.transacao}`} className="flex items-center justify-between gap-2 py-2">
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-ink">{p.clube}</span>
                    <span className="block text-xs text-muted">{dataHoraBR(p.pago_em)} · {metodoTexto(p.metodo)}</span>
                  </span>
                  <span className="flex shrink-0 flex-col items-end gap-1">
                    <span className="text-sm font-bold text-ink tabular-nums">{reais(p.valor_centavos)}</span>
                    {p.tipo === 'teste' ? <Chip>Teste</Chip> : p.promocao ? <Chip tom="dourado">Lançamento</Chip> : <Chip tom="ok">Licença</Chip>}
                  </span>
                </li>
              ))}
            </ul>
            <Botao variacao="secundario" className="w-full mt-3" aoTocar={exportar} data-testid="recebidos-csv">Baixar planilha (CSV)</Botao>
          </>
        )}
      <p className="mt-2 text-[11px] text-faint">Valores pagos pelo cliente. A taxa da InfinitePay e o valor líquido aparecem no painel da InfinitePay.</p>
    </Card>
  )
}
