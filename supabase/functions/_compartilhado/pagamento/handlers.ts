// Regras das duas Edge Functions de pagamento, SEM Deno e SEM rede: tudo que fala com o banco entra por parâmetro, então dá para
// testar no vitest (src/lib/pagamentoEdge.test.js). As funções (pagamento-checkout / pagamento-webhook) só ligam os fios.
import type { Adaptador, DadosCobranca, LerEnv } from './tipos.ts'
import { eventoValido, formaValida } from './comum.ts'

export interface Resposta { status: number; corpo: Record<string, unknown> }
type Rpc = (nome: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: { message?: string; code?: string } | null }>

const R = (status: number, corpo: Record<string, unknown>): Resposta => ({ status, corpo })

/** Mensagem do banco -> código HTTP. O texto do banco já é em português e seguro para a pessoa ler. */
export function statusDoErroDoBanco(msg: string): number {
  if (/Sessão expirada/i.test(msg)) return 401
  if (/Sem permissão/i.test(msg)) return 403
  if (/ainda não está disponível/i.test(msg)) return 503
  return 400
}

export interface EntradaCheckout {
  corpo: unknown
  env: LerEnv
  adaptador: Adaptador | null
  usuario: { nome: string; email: string }
  /** chamadas com a sessão da PESSOA (a autorização é do banco: diretoria do clube em uso) */
  rpcUsuario: Rpc
  /** chamadas com a chave de serviço (só guardar o resultado do gateway) */
  rpcServico: Rpc
}

export async function tratarCheckout(e: EntradaCheckout): Promise<Resposta> {
  if (!e.adaptador) return R(503, { erro: 'O pagamento online ainda não está disponível.' })
  const forma = (e.corpo as { forma?: unknown } | null)?.forma ?? 'pix'
  if (!formaValida(forma)) return R(400, { erro: 'Forma de pagamento inválida (use pix ou cartao).' })

  const prep = await e.rpcUsuario('pagamento_fatura_preparar', { p_forma: forma })
  if (prep.error) { const m = prep.error.message ?? 'Não foi possível abrir a fatura.'; return R(statusDoErroDoBanco(m), { erro: m }) }
  const f = prep.data as {
    fatura_id: string; valor_centavos: number; moeda: string; forma: 'pix' | 'cartao'; vence_em: string; provedor: string; descricao: string
    checkout_url: string | null; pix_copia_cola: string | null; provider_ref: string | null
  }
  // o provedor habilitado NO BANCO tem de ser o adaptador deste ambiente (evita criar cobrança no gateway errado)
  if (f.provedor !== e.adaptador.chave) return R(503, { erro: 'O pagamento online ainda não está disponível.' })

  // já existe cobrança criada para esta fatura e forma: devolve a MESMA (clicar duas vezes não gera duas cobranças no gateway)
  if (f.provider_ref && (f.checkout_url || f.pix_copia_cola)) {
    return R(200, { fatura_id: f.fatura_id, checkout_url: f.checkout_url, pix_copia_cola: f.pix_copia_cola, vence_em: f.vence_em, valor_centavos: f.valor_centavos, reaproveitada: true })
  }

  const base = (e.env('PAGAMENTO_URL_RETORNO') ?? '').replace(/\/+$/, '')
  const dados: DadosCobranca = {
    faturaId: f.fatura_id, valorCentavos: Number(f.valor_centavos), moeda: f.moeda, descricao: f.descricao, venceEm: f.vence_em,
    forma: f.forma, pagador: { nome: e.usuario.nome, email: e.usuario.email }, urlRetorno: `${base}/planos`,
  }
  let c
  try { c = await e.adaptador.criarCobranca(dados, e.env) } catch { return R(502, { erro: 'O serviço de pagamento não respondeu. Tente de novo em instantes.' }) }
  if (!c?.refExterna) return R(502, { erro: 'O serviço de pagamento não respondeu. Tente de novo em instantes.' })

  const vinc = await e.rpcServico('pagamento_fatura_vincular', {
    p_fatura: f.fatura_id, p_provider: e.adaptador.chave, p_ref: c.refExterna,
    p_checkout_url: c.checkoutUrl ?? null, p_pix_copia_cola: c.pixCopiaCola ?? null, p_vence_em: c.venceEm ?? null,
  })
  if (vinc.error) return R(500, { erro: 'Não consegui registrar a cobrança. Tente de novo.' })
  return R(200, { fatura_id: f.fatura_id, checkout_url: c.checkoutUrl ?? null, pix_copia_cola: c.pixCopiaCola ?? null, vence_em: c.venceEm ?? f.vence_em, valor_centavos: f.valor_centavos })
}

export interface EntradaWebhook {
  corpoTexto: string
  headers: Headers
  env: LerEnv
  adaptador: Adaptador | null
  rpcServico: Rpc
}

export async function tratarWebhook(e: EntradaWebhook): Promise<Resposta> {
  // sem adaptador configurado: recusa tudo (falha fechada)
  if (!e.adaptador) return R(503, { erro: 'indisponível' })
  if (!(await e.adaptador.validarWebhook({ headers: e.headers, corpo: e.corpoTexto }, e.env))) return R(401, { erro: 'não autorizado' })
  let corpo: unknown
  try { corpo = JSON.parse(e.corpoTexto) } catch { return R(400, { erro: 'corpo inválido' }) }

  const ev = e.adaptador.traduzirEvento(corpo)
  if (ev === null) return R(200, { ok: true, ignorado: true })      // evento que não interessa: 200 para o gateway não reenviar
  if (!eventoValido(ev)) return R(400, { erro: 'evento inválido' })

  const r = await e.rpcServico('billing_webhook_receber', {
    p_provider: e.adaptador.chave, p_evento_id: ev.eventoId, p_tipo: ev.tipo, p_payload: ev.payload,
  })
  // erro do banco = 500: o gateway tenta de novo (a idempotência do banco protege a reentrega)
  if (r.error) return R(500, { erro: 'falha ao processar' })
  const d = r.data as { duplicado?: boolean; status?: string } | null
  return R(200, { ok: true, duplicado: !!d?.duplicado, status: d?.status ?? null })
}
