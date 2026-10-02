// Contrato entre o MOTOR de pagamento (banco + Edge Functions) e cada GATEWAY.
// Plugar um gateway novo = escrever UM arquivo que implemente `Adaptador` (copie `_modelo.ts`) e registrá-lo em `registro.ts`.
// O motor nunca conhece o vocabulário do gateway: o adaptador traduz os eventos DELE para os cinco eventos internos.

export type FormaPagamento = 'pix' | 'cartao'

export type TipoEvento =
  | 'pagamento_aprovado' | 'pagamento_recusado' | 'pagamento_atrasado' | 'renovacao' | 'cancelamento'

/** O que o checkout pede ao gateway (tudo já validado pelo banco; o valor NUNCA vem do navegador). */
export interface DadosCobranca {
  faturaId: string
  valorCentavos: number
  moeda: string
  descricao: string
  /** YYYY-MM-DD */
  venceEm: string
  forma: FormaPagamento
  pagador: { nome: string; email: string; documento?: string }
  /** Para onde o gateway devolve a pessoa depois de pagar. */
  urlRetorno: string
}

/** O que o gateway devolveu ao criar a cobrança. `refExterna` é o id dela lá: é por ele que o webhook acha a fatura. */
export interface CobrancaCriada {
  refExterna: string
  checkoutUrl?: string
  pixCopiaCola?: string
  /** YYYY-MM-DD, se o gateway ajustou o vencimento */
  venceEm?: string
}

/** Evento já traduzido para o vocabulário do motor. */
export interface EventoNormalizado {
  /** id do evento no gateway — a unicidade (provedor, id) é o que torna o webhook idempotente */
  eventoId: string
  tipo: TipoEvento
  /** cobranca_ref = refExterna da cobrança; motivo (recusa/cancelamento) é opcional */
  payload: { cobranca_ref?: string; assinatura_ref?: string; motivo?: string; [k: string]: unknown }
}

export type LerEnv = (nome: string) => string | undefined

export interface Adaptador {
  /** igual a billing_providers.chave (ex.: 'asaas', 'mercadopago', 'mock') */
  chave: string
  /** Cria a cobrança no gateway. Erro lançado vira 502 (nada é gravado como pago). */
  criarCobranca(dados: DadosCobranca, env: LerEnv): Promise<CobrancaCriada>
  /** Confere a autenticidade do aviso (assinatura/segredo do gateway). Falso = 401 e NADA é processado. */
  validarWebhook(req: { headers: Headers; corpo: string }, env: LerEnv): Promise<boolean>
  /** Traduz o corpo do aviso. Devolve null para eventos que não interessam (o webhook responde 200 e ignora). */
  traduzirEvento(corpo: unknown): EventoNormalizado | null
}
