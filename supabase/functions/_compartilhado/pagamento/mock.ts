// Adaptador de TESTE: prova o fluxo inteiro (checkout -> fatura -> aviso do "gateway" -> licença paga) sem cobrar ninguém.
// Só entra em ação quando PAGAMENTO_MOCK_HABILITADO=sim (ambiente local/staging). Em produção fica DESLIGADO: um aviso falso aqui
// poderia marcar uma licença como paga sem pagamento — por isso o registro recusa este adaptador sem a variável.
import type { Adaptador, EventoNormalizado, TipoEvento } from './tipos.ts'
import { TIPOS_DE_EVENTO, igualSeguro } from './comum.ts'

export const adaptadorMock: Adaptador = {
  chave: 'mock',
  async criarCobranca(d) {
    return {
      refExterna: `mock_${d.faturaId}`,
      checkoutUrl: `${d.urlRetorno}${d.urlRetorno.includes('?') ? '&' : '?'}mock=${encodeURIComponent(d.faturaId)}`,
      pixCopiaCola: d.forma === 'pix' ? `000201MOCK${d.faturaId.replaceAll('-', '').slice(0, 12)}` : undefined,
      venceEm: d.venceEm,
    }
  },
  async validarWebhook(req, env) {
    return igualSeguro(req.headers.get('x-pagamento-segredo') ?? '', env('PAGAMENTO_WEBHOOK_SEGREDO') ?? '')
  },
  traduzirEvento(corpo): EventoNormalizado | null {
    const c = corpo as { evento_id?: unknown; tipo?: unknown; cobranca_ref?: unknown; motivo?: unknown } | null
    if (!c || typeof c.evento_id !== 'string' || typeof c.tipo !== 'string') return null
    if (!(TIPOS_DE_EVENTO as readonly string[]).includes(c.tipo)) return null
    return {
      eventoId: c.evento_id, tipo: c.tipo as TipoEvento,
      payload: { cobranca_ref: typeof c.cobranca_ref === 'string' ? c.cobranca_ref : undefined, motivo: typeof c.motivo === 'string' ? c.motivo : undefined },
    }
  },
}
