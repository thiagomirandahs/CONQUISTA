// MODELO DE ADAPTADOR — copie este arquivo para `<gateway>.ts` (ex.: asaas.ts), preencha os 3 pontos marcados com TODO,
// registre em `registro.ts` e siga o passo a passo de supabase/PAGAMENTOS-COMO-PLUGAR-GATEWAY.md.
// Este arquivo NÃO é importado por ninguém (o prefixo _ é de propósito): não afeta o deploy enquanto não for copiado.
import type { Adaptador, EventoNormalizado, TipoEvento } from './tipos.ts'
import { centavosParaReais, hmacSha256Hex, igualSeguro } from './comum.ts'

// Mapa do vocabulário do gateway -> vocabulário do motor. TODO: preencha com os nomes reais do gateway.
const MAPA_EVENTOS: Record<string, TipoEvento> = {
  // 'PAYMENT_CONFIRMED': 'pagamento_aprovado',
  // 'PAYMENT_RECEIVED': 'pagamento_aprovado',
  // 'PAYMENT_OVERDUE': 'pagamento_atrasado',
  // 'PAYMENT_REFUNDED': 'cancelamento',
}

export const adaptadorModelo: Adaptador = {
  chave: 'modelo', // TODO: igual a billing_providers.chave (minúsculas, sem espaço)

  async criarCobranca(d, env) {
    const chaveApi = env('PAGAMENTO_API_KEY') ?? '' // secret da função; NUNCA no código nem no front
    if (!chaveApi) throw new Error('PAGAMENTO_API_KEY ausente')
    // TODO: chame a API do gateway para criar a cobrança de d.valorCentavos (use centavosParaReais se ele pedir decimal),
    // com vencimento d.venceEm, forma d.forma ('pix' | 'cartao') e o pagador d.pagador. Guarde d.faturaId como referência externa.
    void centavosParaReais
    throw new Error('adaptador modelo: criarCobranca não implementado')
    // return { refExterna: <id da cobrança no gateway>, checkoutUrl: <link para pagar>, pixCopiaCola: <código copia-e-cola> }
  },

  async validarWebhook(req, env) {
    // TODO: conferir como o gateway prova que o aviso é dele. Dois padrões comuns:
    //   a) token fixo num header:   return igualSeguro(req.headers.get('<header-do-gateway>') ?? '', env('PAGAMENTO_WEBHOOK_SEGREDO') ?? '')
    //   b) assinatura HMAC do corpo: compare hmacSha256Hex(segredo, req.corpo) com o header de assinatura
    void igualSeguro; void hmacSha256Hex
    return false // falha fechada até você implementar
  },

  traduzirEvento(corpo): EventoNormalizado | null {
    // TODO: extraia do corpo (JSON do gateway) o id do evento, o tipo e o id da cobrança.
    const c = corpo as { id?: string; event?: string; payment?: { id?: string } } | null
    const tipo = c?.event ? MAPA_EVENTOS[c.event] : undefined
    if (!c?.id || !tipo) return null // evento que não interessa: o webhook responde 200 e ignora
    return { eventoId: c.id, tipo, payload: { cobranca_ref: c.payment?.id } }
  },
}
