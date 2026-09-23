import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'

// Contrato da Edge Function enviar-push (Deno; não roda no vitest). A regra de negócio — quem recebe o
// quê — está no banco e é testada em supabase/tests/07_push_por_clube.sql. Estes testes travam o
// FORMATO da função para ninguém reintroduzir o broadcast global por engano.
// (o vitest roda na raiz do projeto; no ambiente jsdom o `URL` global não serve para o fs)
const fonte = readFileSync(join(process.cwd(), 'supabase', 'functions', 'enviar-push', 'index.ts'), 'utf8')

describe('Edge Function enviar-push: destinatários sempre por clube', () => {
  // Fase 8.2: a função não escolhe mais o público — ela RESERVA entregas de um evento cujo
  // público já foi congelado no banco. O isolamento por clube continua sendo do banco, e agora
  // é ainda mais forte: a função sequer recebe club_id para errar.
  it('reserva as entregas de um evento; não recalcula público nenhum', () => {
    expect(fonte).toMatch(/\.rpc\('push_reservar', \{ p_evento_id: eventoId \}\)/)
    expect(fonte).not.toMatch(/\.rpc\('push_destinatarios'/)
    expect(fonte).not.toMatch(/\.rpc\('push_destinatarios_nativos'/)
  })

  it('sem evento de push, não envia nada (é assim que seed, fixture e RESTORE não acordam o clube)', () => {
    expect(fonte).toMatch(/sem evento de push/)
    expect(fonte).toMatch(/UUID_RE\.test\(notif\.push_evento_id\)/)
  })

  it('lista de reserva vazia é o caminho NORMAL de um retry, não erro', () => {
    expect(fonte).toMatch(/entregas\.length === 0/)
    expect(fonte).toMatch(/jaEntregue: true/)
  })

  it('toda tentativa reservada é concluída — nada fica preso em "enviando"', () => {
    expect(fonte).toMatch(/\.rpc\('push_concluir', \{ p_resultados: resultados \}\)/)
  })

  it('o que volta ao banco é id, sucesso, CÓDIGO e duração — nunca o conteúdo', () => {
    const blocos = [...fonte.matchAll(/resultados\.push\(\{[\s\S]*?\}\)/g)].map((m) => m[0])
    expect(blocos.length).toBeGreaterThanOrEqual(4)
    for (const b of blocos) {
      expect(b).not.toMatch(/titulo|corpo|payload|endpoint|token:|link/)
    }
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

  it('erro ao reservar responde 500 e não envia (falha fechada)', () => {
    expect(fonte).toMatch(/if \(erroReserva\) return new Response\('erro: '/)
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

// Fase 8.1 — o APK gravava o token do FCM em push_tokens e ninguém lia essa tabela: o push
// nativo no Android não funcionava. Estes testes travam a rota nova para ela não se perder de
// novo numa refatoração, e travam o teto de concorrência que a acompanha.
describe('Edge Function enviar-push: rota nativa (APK/FCM)', () => {
  it('as duas rotas saem da MESMA reserva — não há como web e Android divergirem de público', () => {
    expect(fonte).toMatch(/const subs = entregas\.filter\(\(e\) => e\.canal === 'web'\)/)
    expect(fonte).toMatch(/const tokens = entregas\.filter\(\(e\) => e\.canal === 'fcm'\)/)
  })

  it('a notificação carrega tag/collapse_key — duas iguais se substituem no aparelho', () => {
    expect(fonte).toMatch(/const tag = `cq-/)
    expect(fonte).toMatch(/collapse_key: tag/)
    expect(fonte).toMatch(/notification: \{ tag,/)
  })

  it('nunca lê push_tokens sem filtro (o mesmo erro que o broadcast global foi)', () => {
    expect(fonte).not.toMatch(/from\('push_tokens'\)\s*\.select\(/)
  })

  it('usa FCM HTTP v1 com conta de serviço (não a API legada por server key)', () => {
    expect(fonte).toMatch(/fcm\.googleapis\.com\/v1\/projects\//)
    expect(fonte).not.toMatch(/fcm\.googleapis\.com\/fcm\/send/)
    expect(fonte).toMatch(/FCM_SERVICE_ACCOUNT/)
  })

  it('só apaga o token quando o FCM diz que ele não existe mais (404)', () => {
    expect(fonte).toMatch(/resp\.status === 404.*push_tokens.*delete/s)
  })

  it('falta de configuração do FCM é REGISTRADA, não engolida — e não cala a rota web', () => {
    expect(fonte).toMatch(/registrarFalha\(`FCM_SERVICE_ACCOUNT ausente/)
    expect(fonte).toMatch(/from\('infra_falhas'\)\.insert/)
  })

  it('o registro de falha não guarda token, texto da notificação nem destinatário', () => {
    const corpoRegistrar = fonte.slice(fonte.indexOf('async function registrarFalha'), fonte.indexOf('async function emLotes'))
    expect(corpoRegistrar).not.toMatch(/token|titulo|corpo|payload|user_id|endpoint/)
  })
})

describe('Edge Function enviar-push: concorrência e prazo', () => {
  it('envia em lotes com teto — nunca um Promise.all sobre a lista inteira', () => {
    expect(fonte).toMatch(/const LOTE = \d+/)
    expect(fonte).toMatch(/async function emLotes/)
    // as duas rotas passam pelo limitador
    expect(fonte).toMatch(/emLotes\(subs, LOTE/)
    expect(fonte).toMatch(/emLotes\(tokens, LOTE/)
    // o Promise.all que sobra é o de DENTRO do lote (tamanho limitado) e o do digest do segredo
    expect(fonte).not.toMatch(/Promise\.all\(\s*subs\./)
    expect(fonte).not.toMatch(/Promise\.all\(\s*tokens\./)
  })

  it('toda chamada de saída tem prazo (sem isso um provedor lento segura o invoke inteiro)', () => {
    expect(fonte).toMatch(/const TIMEOUT_MS = /)
    expect(fonte).toMatch(/function comPrazo/)
    expect(fonte).toMatch(/comPrazo\(webpush\.sendNotification/)
    expect(fonte).toMatch(/comPrazo\(fetch\(urlFcm/)
  })
})
