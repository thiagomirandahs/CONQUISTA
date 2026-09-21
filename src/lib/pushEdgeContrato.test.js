import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'

// Contrato da Edge Function enviar-push (Deno; não roda no vitest). A regra de negócio — quem recebe o
// quê — está no banco e é testada em supabase/tests/07_push_por_clube.sql. Estes testes travam o
// FORMATO da função para ninguém reintroduzir o broadcast global por engano.
// (o vitest roda na raiz do projeto; no ambiente jsdom o `URL` global não serve para o fs)
const fonte = readFileSync(join(process.cwd(), 'supabase', 'functions', 'enviar-push', 'index.ts'), 'utf8')

describe('Edge Function enviar-push: destinatários sempre por clube', () => {
  it('escolhe os destinatários pela função SQL do clube, passando o club_id da notificação', () => {
    expect(fonte).toMatch(/\.rpc\('push_destinatarios'/)
    expect(fonte).toMatch(/p_club_id:\s*clubeId/)
    expect(fonte).toMatch(/p_para_usuario:\s*paraUsuario/)
  })

  it('nunca lê push_subscriptions sem filtro (o "para todos" global de antes)', () => {
    expect(fonte).not.toMatch(/from\('push_subscriptions'\)\s*\.select\(/)
  })

  it('não escolhe a liderança por profiles.papel global', () => {
    expect(fonte).not.toMatch(/from\('profiles'\)/)
    expect(fonte).not.toMatch(/'instrutor',\s*'diretoria'/)
  })

  it('sem club_id válido a notificação não é enviada a ninguém', () => {
    expect(fonte).toMatch(/notificacao sem clube/)
    expect(fonte).toMatch(/UUID_RE\.test\(notif\.club_id\)/)
  })

  it('destino desconhecido não vira broadcast', () => {
    expect(fonte).toMatch(/destino desconhecido/)
  })

  it('erro ao escolher destinatários responde 500 e não envia (falha fechada)', () => {
    expect(fonte).toMatch(/if \(erroDestinatarios\) return new Response\('erro: '/)
  })

  it('continua removendo inscrições expiradas (só delete, sem select amplo)', () => {
    expect(fonte).toMatch(/from\('push_subscriptions'\)\.delete\(\)\.eq\('endpoint'/)
  })

  it('mantém a fechadura do webhook (segredo) e o link interno seguro', () => {
    expect(fonte).toMatch(/x-push-webhook-secret/)
    expect(fonte).toMatch(/function linkSeguro/)
  })
})
