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

// A função é colada à mão no painel (sem lockfile): o que fixa a versão é o próprio especificador.
// `@2` no esm.sh (ou `^`/`~`/`latest`) faz o deploy de amanhã rodar código diferente do testado.
describe('Edge Function enviar-push: dependências fixadas', () => {
  const imports = [...fonte.matchAll(/^\s*import\s[^\n]*?from\s+['"]([^'"]+)['"]/gm)].map((m) => m[1])
  const externos = imports.filter((s) => !s.startsWith('.') && !s.startsWith('node:'))

  it('encontra as dependências externas (guarda contra o teste passar no vazio)', () => {
    expect(externos.length).toBeGreaterThanOrEqual(2)
  })

  it('toda dependência externa vem do registro npm com versão EXATA (x.y.z)', () => {
    for (const spec of externos) {
      expect(spec, spec).toMatch(/^npm:(@[a-z0-9-]+\/)?[a-z0-9.-]+@\d+\.\d+\.\d+$/)
    }
  })

  it('não usa esm.sh nem URL remota solta (versão flutuante, fora do npm)', () => {
    expect(fonte).not.toMatch(/esm\.sh/)
    expect(fonte).not.toMatch(/from\s+['"]https?:\/\//)
  })

  it('o supabase-js da função é a MESMA versão do package-lock do app (uma versão testada só)', () => {
    const lock = JSON.parse(readFileSync(join(process.cwd(), 'package-lock.json'), 'utf8'))
    const doLock = lock.packages['node_modules/@supabase/supabase-js'].version
    expect(externos).toContain(`npm:@supabase/supabase-js@${doLock}`)
  })
})
