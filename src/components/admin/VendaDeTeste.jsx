import { useCallback, useEffect, useState } from 'react'
import { criarVendaTeste, listarVendasTeste, confirmarVendaTeste } from '../../services/pagamento.js'
import { clubesListar } from '../../services/admin.js'
import { Botao } from '../../ui/index.jsx'
import { avisar } from '../../ui/avisos.jsx'
import { Chip, Nota, dataHoraBR } from './AdminUI.jsx'
import { abrirNaMesmaTela, irParaCheckout, lerRetornoDoCheckout } from '../../lib/checkoutNaMesmaTela.js'

const reais = (c) => (Number(c || 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

// Homologação da InfinitePay (migration 551): gera um link de R$ 1,00 para um clube e acompanha o resultado.
// Funciona com a cobrança DESLIGADA. Pago, o teste NÃO ativa licença nem cria fatura — só prova que o caminho funciona.
export default function VendaDeTeste() {
  const [clubes, setClubes] = useState([])
  const [clube, setClube] = useState('')
  const [testes, setTestes] = useState(null)
  const [link, setLink] = useState(null)
  const [ocupado, setOcupado] = useState(false)
  const [retorno] = useState(lerRetornoDoCheckout)
  const [falhaRetorno, setFalhaRetorno] = useState(false)

  const atualizar = useCallback(() => { listarVendasTeste().then(setTestes).catch(() => setTestes((t) => t || [])) }, [])
  useEffect(() => {
    clubesListar().then((cs) => setClubes((cs || []).filter((c) => c.club_id))).catch(() => setClubes([]))
    atualizar()
  }, [atualizar])
  // enquanto houver teste aguardando, confere a cada 10 s (o webhook confirma sozinho)
  const aguardando = (testes || []).some((t) => t.status === 'pendente')
  useEffect(() => {
    if (!aguardando) return undefined
    const id = setInterval(atualizar, 10000)
    return () => clearInterval(id)
  }, [aguardando, atualizar])

  async function gerar() {
    if (!clube) { avisar.erro(null, 'Escolha o clube do teste.'); return }
    setOcupado(true); setLink(null)
    try {
      const d = await criarVendaTeste(clube)
      if (abrirNaMesmaTela()) { irParaCheckout(d.url); return }   // mesma aba; a InfinitePay volta para cá e confirma sozinho
      setLink(d.url); avisar.sucesso('Link de teste de R$ 1,00 criado.'); atualizar()
    }
    catch (e) { avisar.erro(e) } finally { setOcupado(false) }
  }

  async function confirmarRetorno() {
    setOcupado(true); setFalhaRetorno(false)
    try { await confirmarVendaTeste(retorno); avisar.sucesso('Pagamento de teste confirmado pela InfinitePay.'); atualizar() }
    catch (e) { setFalhaRetorno(true); avisar.erro(e) } finally { setOcupado(false) }
  }
  // voltou do checkout: confirma sozinho (sem precisar tocar em botão)
  useEffect(() => { if (retorno) confirmarRetorno() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="mt-4 border-t border-line pt-4" data-testid="venda-de-teste">
      <p className="font-bold text-ink">🧪 Venda de teste (R$ 1,00)</p>
      <p className="text-xs text-muted mt-1 mb-3">Paga de verdade na InfinitePay e passa pelo caminho real (webhook e conferência do valor), mas <strong>não ativa licença e não gera fatura</strong>. Funciona com a cobrança desligada.</p>
      {retorno && ocupado && <p className="mb-3 text-sm font-semibold text-ink" role="status">Confirmando o pagamento de teste…</p>}
      {retorno && falhaRetorno && (
        <Botao className="w-full mb-3" carregando={ocupado} desabilitado={ocupado} aoTocar={confirmarRetorno} data-testid="teste-confirmar-retorno">Tentar confirmar de novo</Botao>
      )}
      <label htmlFor="teste-clube" className="block text-xs font-semibold text-muted mb-1">Clube do teste</label>
      <select id="teste-clube" value={clube} onChange={(e) => setClube(e.target.value)} data-testid="teste-clube"
        className="w-full min-h-[44px] rounded-xl border border-line bg-surface2 px-3 text-sm text-ink mb-2">
        <option value="">Escolha…</option>
        {clubes.map((c) => <option key={c.club_id} value={c.club_id}>{c.nome}</option>)}
      </select>
      <Botao variacao="secundario" className="w-full" carregando={ocupado} desabilitado={ocupado || !clube} aoTocar={gerar} data-testid="teste-gerar">Gerar link de teste</Botao>
      {link && (
        <a href={link} target="_blank" rel="noopener noreferrer" data-testid="teste-link"
          className="mt-2 flex min-h-[44px] items-center justify-center rounded-xl bg-brand text-sm font-bold text-white">Abrir pagamento de teste ↗</a>
      )}
      {testes && testes.length > 0 && (
        <ul className="mt-3 space-y-1.5" data-testid="teste-lista">
          {testes.map((t) => (
            <li key={t.id} className="flex items-center justify-between gap-2 text-xs">
              <span className="min-w-0 truncate text-ink">{t.clube} · {reais(t.valor_centavos)} · {dataHoraBR(t.criado_em)}</span>
              {t.status === 'pago'
                ? <Chip tom="ok">Pago{t.metodo ? ` (${t.metodo === 'pix' ? 'Pix' : 'cartão'})` : ''} ✓</Chip>
                : <Chip tom="atencao">Aguardando pagamento</Chip>}
            </li>
          ))}
        </ul>
      )}
      {testes && testes.length === 0 && <div className="mt-3"><Nota>Nenhum teste feito ainda.</Nota></div>}
    </div>
  )
}
