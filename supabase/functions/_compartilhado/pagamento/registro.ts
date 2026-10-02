// Registro de adaptadores: a ÚNICA linha que muda para ligar um gateway novo (além do arquivo do adaptador).
// Qual adaptador está ativo vem da variável PAGAMENTO_PROVEDOR (secret da Edge Function). Sem ela: nenhum — o checkout responde
// "indisponível" e o webhook recusa tudo (falha fechada).
import type { Adaptador, LerEnv } from './tipos.ts'
import { adaptadorMock } from './mock.ts'
// import { adaptadorAsaas } from './asaas.ts'            // <- 1) crie o arquivo a partir de _modelo.ts
// import { adaptadorMercadoPago } from './mercadopago.ts'

const ADAPTADORES: Record<string, Adaptador> = {
  [adaptadorMock.chave]: adaptadorMock,
  // [adaptadorAsaas.chave]: adaptadorAsaas,               // <- 2) registre aqui
}

export function chavesRegistradas(): string[] {
  return Object.keys(ADAPTADORES)
}

/** O adaptador do ambiente, ou null (nenhum configurado, desconhecido, ou mock sem a variável de habilitação). */
export function adaptadorDoAmbiente(env: LerEnv): Adaptador | null {
  const chave = (env('PAGAMENTO_PROVEDOR') ?? '').trim().toLowerCase()
  if (!chave) return null
  const a = ADAPTADORES[chave]
  if (!a) return null
  if (a.chave === 'mock' && env('PAGAMENTO_MOCK_HABILITADO') !== 'sim') return null
  return a
}
