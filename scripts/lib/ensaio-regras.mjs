// As diferenças que o UPGRADE (migrations do SaaS) produz de propósito sobre dados que já existiam,
// cada uma com o predicado que a CONFINA. Usado por scripts/ensaio-producao.mjs com
// supabase/infra/ensaio/diferencas.sql: `a` = a linha de antes, `d` = a de depois.
//
// Regra boa é estreita: explica a diferença E prova que ela é a esperada (ex.: o texto da mensagem
// apagada virou o marcador E o original está guardado na trilha da moderação). Uma regra larga
// ("qualquer mudança em chat_mensagens") esconderia exatamente a F2 que o ensaio existe para pegar.
//
// Origem de cada regra: auditoria das instruções de dados fora de função nas migrations
// 20260921000001.. (update/delete/insert de nível superior e blocos DO), confirmada no ensaio
// sobre o backup sintético. Diferença que aparecer num backup real e não estiver aqui = NO-GO até
// ser entendida — e, se for legítima, vira regra nova com a migration que a causa.
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const DIR = join('supabase', 'migrations')
export const SAAS = readdirSync(DIR).filter((f) => f.endsWith('.sql') && f.split('_')[0] >= '20260921000001').sort()
const texto = (f) => readFileSync(join(DIR, f), 'utf8')
const lista = (xs) => [...new Set(xs)].map((x) => `'${x.replace(/'/g, "''")}'`).join(', ')

// o ledger ANTIGO (public.migracoes_aplicadas): cada migration do SaaS ainda grava o próprio nome nele
const LEDGER_ANTIGO = SAAS.flatMap((f) => [...texto(f).matchAll(/insert into public\.migracoes_aplicadas\s*\(arquivo\)\s*values\s*\('([^']+)'\)/gi)].map((m) => m[1]))
// os jobs do pg_cron que as migrations do SaaS (re)agendam ou desagendam
const CRON_AGENDA = SAAS.flatMap((f) => [...texto(f).matchAll(/cron\.schedule\(\s*'([^']+)'/g)].map((m) => m[1]))
const CRON_DESAGENDA = SAAS.flatMap((f) => [...texto(f).matchAll(/cron\.unschedule\(\s*'([^']+)'/g)].map((m) => m[1]))

export const REGRAS = [
  // ---- ledger antigo ----
  ...(LEDGER_ANTIGO.length ? [
    { copia: 'migracoes_aplicadas', tipo: 'adicionada', onde: `d.arquivo in (${lista(LEDGER_ANTIGO)})`,
      motivo: 'cada migration do SaaS registra o próprio nome no ledger antigo', migration: '1..' },
    { copia: 'migracoes_aplicadas', tipo: 'alterada', coluna: 'aplicada_em', onde: `a.arquivo in (${lista(LEDGER_ANTIGO)})`,
      motivo: 'reaplicar uma migration do SaaS atualiza a data no ledger antigo (on conflict)', migration: '1..' },
  ] : []),

  // ---- perfil: vira o ESPELHO do vínculo do clube primário, no vocabulário do vínculo ----
  // (a reconciliação da migration 34 regrava papel/situação do perfil a partir do vínculo). A regra
  // exige as duas coisas: a troca é a do mapa E o perfil ficou igual ao vínculo do Tenant 001.
  { copia: 'profiles', tipo: 'alterada', coluna: 'status',
    onde: `((a.status = 'inativo' and d.status = 'suspenso') or (a.status = 'rejeitado' and d.status = 'encerrado'))
           and d.status = (select m.status from public.organization_memberships m where m.user_id = d.id and m.organizational_unit_id = public.clube_legado_id())`,
    motivo: 'o perfil passa a espelhar o vínculo: "inativo" vira "suspenso" e "rejeitado" vira "encerrado" (vocabulário do vínculo)', migration: '13, 34' },
  { copia: 'profiles', tipo: 'alterada', coluna: 'papel',
    onde: `a.papel = 'responsavel' and d.papel = 'pais'
           and d.papel = (select m.role from public.organization_memberships m where m.user_id = d.id and m.organizational_unit_id = public.clube_legado_id())`,
    motivo: 'papel "responsavel" padronizado em "pais" (o vocabulário do vínculo)', migration: '13, 34' },

  // ---- chat: a mensagem que a liderança já tinha apagado ----
  { copia: 'chat_mensagens', tipo: 'alterada', coluna: 'texto',
    onde: `a.apagada and d.texto = '(mensagem apagada)' and exists (select 1 from public.chat_mensagens_apagadas x where x.mensagem_id = d.id and x.texto_original = a.texto)`,
    motivo: 'mensagem já apagada: o texto sai da tabela lida pelos membros e fica só na trilha da moderação (original conferido lá)', migration: '29' },

  // ---- Storage ----
  { copia: 'storage__buckets', tipo: 'alterada', coluna: 'public', onde: `a.id = 'imagens' and a.public and not d.public`,
    motivo: 'bucket imagens passa a PRIVADO (URL assinada por clube)', migration: '32' },
  { copia: 'storage__buckets', tipo: 'alterada', coluna: 'file_size_limit', onde: `a.id = 'imagens' and d.file_size_limit = 15728640`,
    motivo: 'limite de 15 MB por arquivo no bucket imagens', migration: '28' },
  { copia: 'storage__buckets', tipo: 'alterada', coluna: 'allowed_mime_types', onde: `a.id = 'imagens' and d.allowed_mime_types @> array['image/jpeg']`,
    motivo: 'só imagens no bucket imagens', migration: '28' },
  { copia: 'storage__buckets', tipo: 'alterada', coluna: 'updated_at', onde: `a.id = 'imagens'`,
    motivo: 'o bucket imagens foi atualizado pelas migrations 28/32', migration: '28, 32' },
  { copia: 'storage__buckets', tipo: 'adicionada', onde: `d.id = 'publico' and d.public`,
    motivo: 'bucket público novo, só para marca/brasão dos clubes', migration: '31' },

  // ---- pg_cron ----
  ...(CRON_AGENDA.length ? [
    { copia: 'cron__job', tipo: 'adicionada', onde: `d.jobname in (${lista(CRON_AGENDA)})`, motivo: 'job agendado pelas migrations do SaaS', migration: 'várias' },
    ...['jobid', 'schedule', 'command', 'active'].map((coluna) => ({
      copia: 'cron__job', tipo: 'alterada', coluna, onde: `a.jobname in (${lista(CRON_AGENDA)})`,
      motivo: 'job reagendado pelas migrations do SaaS (unschedule + schedule)', migration: 'várias' })),
  ] : []),
  ...(CRON_DESAGENDA.length ? [
    { copia: 'cron__job', tipo: 'removida', onde: `a.jobname in (${lista(CRON_DESAGENDA)})`, motivo: 'job de desenho antigo desagendado', migration: 'várias' },
  ] : []),
]

// Entidades críticas do resumo antes × depois (item 3: usuários, memberships, unidades, pontos,
// mensalidades, jogos, mensagens, Storage, configurações, documentos...). `antes` e `depois` são SQL
// escalares; `antes` lê de ensaio_antes (o retrato), `depois` do banco atualizado. `esperado` diz como
// os dois têm de se relacionar e POR QUÊ — só números, nunca conteúdo.
export const ENTIDADES = [
  { nome: 'contas (auth.users)', antes: 'select count(*) from ensaio_antes.auth__users', depois: 'select count(*) from auth.users', esperado: 'igual' },
  { nome: 'perfis', antes: 'select count(*) from ensaio_antes.profiles', depois: 'select count(*) from public.profiles', esperado: 'igual' },
  { nome: 'vínculos (antes: 1 perfil = 1 membro do clube único)', antes: 'select count(*) from ensaio_antes.profiles',
    depois: 'select count(*) from public.organization_memberships m join public.organizational_units u on u.id = m.organizational_unit_id and u.type = \'clube\'',
    esperado: 'igual', porque: 'a migration 2 cria exatamente um vínculo no Tenant 001 por perfil' },
  { nome: 'unidades', antes: 'select count(*) from ensaio_antes.unidades', depois: 'select count(*) from public.unidades', esperado: 'igual' },
  { nome: 'lançamentos de pontos', antes: 'select count(*) from ensaio_antes.pontos', depois: 'select count(*) from public.pontos', esperado: 'igual' },
  { nome: 'soma dos pontos', antes: 'select coalesce(sum(pontos), 0) from ensaio_antes.pontos', depois: 'select coalesce(sum(pontos), 0) from public.pontos', esperado: 'igual' },
  { nome: 'mensalidades', antes: 'select count(*) from ensaio_antes.mensalidades', depois: 'select count(*) from public.mensalidades', esperado: 'igual' },
  { nome: 'caixa (soma das mensalidades pagas)', antes: 'select coalesce(sum(valor), 0) from ensaio_antes.mensalidades where status = \'pago\'',
    depois: 'select coalesce(sum(valor), 0) from public.mensalidades where status = \'pago\'', esperado: 'igual' },
  { nome: 'catálogo de jogos', antes: 'select count(*) from ensaio_antes.jogos_trilha', depois: 'select count(*) from public.jogos_trilha', esperado: 'igual' },
  { nome: 'jogadas + recordes + partidas', antes: 'select (select count(*) from ensaio_antes.trilha_jogos) + (select count(*) from ensaio_antes.recordes) + (select count(*) from ensaio_antes.partidas)',
    depois: 'select (select count(*) from public.trilha_jogos) + (select count(*) from public.recordes) + (select count(*) from public.partidas)', esperado: 'igual' },
  { nome: 'mensagens do chat', antes: 'select count(*) from ensaio_antes.chat_mensagens', depois: 'select count(*) from public.chat_mensagens', esperado: 'igual' },
  { nome: 'avisos (notificações)', antes: 'select count(*) from ensaio_antes.notificacoes', depois: 'select count(*) from public.notificacoes', esperado: 'igual' },
  { nome: 'fotos do mural', antes: 'select count(*) from ensaio_antes.fotos', depois: 'select count(*) from public.fotos', esperado: 'igual' },
  { nome: 'objetos do Storage (metadados)', antes: 'select count(*) from ensaio_antes.storage__objects', depois: 'select count(*) from storage.objects', esperado: 'igual' },
  { nome: 'configurações do clube', antes: 'select count(*) from ensaio_antes.config_clube', depois: 'select count(*) from public.config_clube', esperado: 'igual' },
  { nome: 'responsáveis aprovados', antes: 'select count(*) from ensaio_antes.responsaveis where status = \'aprovado\'', depois: 'select count(*) from public.responsaveis where status = \'aprovado\'', esperado: 'igual' },
  { nome: 'eventos da agenda', antes: 'select count(*) from ensaio_antes.eventos', depois: 'select count(*) from public.eventos', esperado: 'igual' },
  { nome: 'atividades + entregas', antes: 'select (select count(*) from ensaio_antes.atividades) + (select count(*) from ensaio_antes.entregas)',
    depois: 'select (select count(*) from public.atividades) + (select count(*) from public.entregas)', esperado: 'igual' },
  { nome: 'leilões + lances', antes: 'select (select count(*) from ensaio_antes.leiloes) + (select count(*) from ensaio_antes.leilao_lances)',
    depois: 'select (select count(*) from public.leiloes) + (select count(*) from public.leilao_lances)', esperado: 'igual' },
  { nome: 'documentos de classe', antes: 'select 0', depois: 'select count(*) from public.class_documents', esperado: 'igual',
    porque: 'classes/documentos não existiam no produto antigo: o upgrade não pode inventar documento' },
  { nome: 'matrículas em classe', antes: 'select 0', depois: 'select count(*) from public.member_classes', esperado: 'igual',
    porque: 'idem: nenhuma matrícula nasce do upgrade' },
]
