import { useCallback, useEffect, useState } from 'react'
import { lerCobranca, definirCobranca } from '../../services/pagamento.js'
import { Card, Botao } from '../../ui/index.jsx'
import { avisar } from '../../ui/avisos.jsx'
import { Chip, Nota, LinkAcao, dataHoraBR } from './AdminUI.jsx'

// /admin › Assinaturas: interruptor da COBRANÇA da licença (InfinitePay). Nasce DESLIGADO. Desligada, ninguém consegue
// iniciar um pagamento novo (nem reservar vaga do lançamento); um pagamento que já aconteceu continua sendo confirmado.
// Toda mudança é auditada no servidor (aba Auditoria).
export default function CobrancaOnline() {
  const [estado, setEstado] = useState(null)
  const [falha, setFalha] = useState(false)
  const [ocupado, setOcupado] = useState(false)

  const carregar = useCallback(() => {
    lerCobranca().then((e) => { setFalha(false); setEstado(e) }).catch(() => setFalha(true))
  }, [])
  useEffect(() => { carregar() }, [carregar])

  async function mudar(ativo) {
    const ok = await avisar.confirmar(ativo
      ? { titulo: 'Ligar a cobrança agora?',
          descricao: 'Os clubes passam a ver o botão "Pagar a licença" e a poder pagar de verdade (R$ 250 por ano; R$ 220 no primeiro ano dos 50 primeiros). Confirme que a venda de teste na InfinitePay já deu certo.',
          rotulo: 'Ligar cobrança', perigo: false }
      : { titulo: 'Desligar a cobrança?',
          descricao: 'Ninguém consegue iniciar um pagamento novo. Quem já pagou continua tendo o pagamento confirmado normalmente.',
          rotulo: 'Desligar cobrança', perigo: true })
    if (!ok) return
    setOcupado(true)
    try {
      setEstado(await definirCobranca(ativo))
      avisar.sucesso(ativo ? 'Cobrança LIGADA.' : 'Cobrança desligada.')
    } catch (e) { avisar.erro(e) } finally { setOcupado(false) }
  }

  if (falha && !estado) {
    return <Card data-testid="cobranca-online"><p className="font-bold text-ink">💳 Cobrança online</p>
      <Nota icone="⚠️">Não consegui ler a situação da cobrança. <LinkAcao aoTocar={carregar}>Tentar de novo</LinkAcao></Nota></Card>
  }
  if (!estado) return <Card data-testid="cobranca-online"><p className="text-xs text-muted" role="status">Carregando…</p></Card>

  return (
    <Card data-testid="cobranca-online">
      <div className="flex items-center gap-2">
        <p className="flex-1 font-bold text-ink">💳 Cobrança online da licença</p>
        <Chip tom={estado.ativo ? 'ok' : 'neutro'} ponto data-testid="cobranca-situacao">{estado.ativo ? 'Ligada' : 'Desligada'}</Chip>
      </div>
      <p className="text-xs text-muted mt-1 mb-3">
        {estado.ativo
          ? 'Os clubes podem pagar a licença pela InfinitePay agora.'
          : 'Ninguém consegue iniciar um pagamento. Ligue só quando for cobrar.'}
        {estado.atualizadoEm ? ` Última mudança: ${dataHoraBR(estado.atualizadoEm)}.` : ''}
      </p>
      {estado.ativo
        ? <Botao className="w-full" variacao="perigo" carregando={ocupado} desabilitado={ocupado} aoTocar={() => mudar(false)} data-testid="cobranca-desligar">Desligar cobrança</Botao>
        : <Botao className="w-full" carregando={ocupado} desabilitado={ocupado} aoTocar={() => mudar(true)} data-testid="cobranca-ligar">Ligar cobrança</Botao>}
    </Card>
  )
}
