#!/usr/bin/env node
// =============================================================================
//  Fase 9.1, item 7 — BACKUP e PITR do projeto hospedado do piloto: o que EXISTE, e o que foi PROVADO.
//
//  Por que existe: o Go/No-Go da fase 9 provou restore e recuperação de migration no staging LOCAL
//  (53,4 s; 17,2 s) e deixou em aberto o mesmo no projeto real (P2). "A opção existe no painel" não
//  é prova de nada — o drill da fase 9 achou um restore que devolvia tudo e quebrava a PRÓXIMA
//  migration. Por isso este script separa as duas coisas:
//
//    o que existe   GET na Management API: plano, backups diários, retenção, PITR e a sua janela
//    o que foi provado   dois registros que o DONO produz fazendo o restore de verdade:
//                   --ensaio  <ensaio-*.json>   o relatório de `node scripts/ensaio-producao.mjs ensaiar`
//                                               sobre o backup diário BAIXADO deste projeto
//                   --registro <arquivo.json>   o registro do restore NO PROJETO e da responsabilidade
//                                               (modelo em supabase/infra/BACKUP-PITR-HOSPEDADO.md §5)
//  Sem os dois, o veredito nunca é VERDE — de propósito.
//
//  SOMENTE LEITURA (GET). Uso:
//    SUPABASE_ACCESS_TOKEN=<token> PROJECT_REF=<ref> [SUPABASE_URL=https://<ref>.supabase.co] \
//      node scripts/verificar-backup-hospedado.mjs [--ensaio arq.json] [--registro arq.json] [--saida arq.json] [--json]
//
//  Parâmetros: BACKUP_RETENCAO_DIAS (padrão 7), BACKUP_PITR_DIAS (padrão 7), BACKUP_EVIDENCIA_MAX_DIAS (padrão 30:
//  um restore testado há mais tempo que isso já não diz nada sobre o banco de hoje).
//  Guarda de produção: a mesma do verificar-auth-hospedado.mjs (scripts/lib/hospedado.mjs).
//  Saída: 0 VERDE · 1 algum FAIL · 2 algum obrigatório NAO-VERIFICAVEL · 3 recusado.
// =============================================================================
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { basename } from 'node:path'
import {
  Recusa, conferirAlvo, obterJson, gestao, API_GESTAO, lerArgs, novoRelatorio, resumir, imprimirCriterios, PASS, FAIL, NV,
} from './lib/hospedado.mjs'

const DIA = 86400
const agoraS = () => Math.floor(Date.now() / 1000)
const iso = (s) => (Number.isFinite(s) ? new Date(s * 1000).toISOString() : null)
const segDe = (v) => { const t = Date.parse(v); return Number.isFinite(t) ? Math.floor(t / 1000) : NaN }

// Puro (coberto pela simulação do autoteste): recebe as respostas da API e os registros, devolve pelo add.
export function avaliar({ projeto, org, addons, backups, ensaio, registro, ref, p }, add) {
  // --- projeto e plano ---
  if (projeto) {
    add({ id: 'projeto-ativo', titulo: 'projeto ativo e saudável', resultado: projeto.status === 'ACTIVE_HEALTHY' ? PASS : FAIL,
      valor: { status: projeto.status, regiao: projeto.region, postgres: projeto.database?.version || null }, esperado: 'ACTIVE_HEALTHY' })
  } else add({ id: 'projeto-ativo', titulo: 'projeto ativo e saudável', resultado: NV, nota: 'GET /v1/projects/<ref> não respondeu' })

  const plano = org?.plan ? String(org.plan).toLowerCase() : ''
  add({ id: 'plano-pago', titulo: 'plano com backup diário baixável (Pro ou acima)', resultado: !plano ? NV : ['pro', 'team', 'enterprise'].includes(plano) ? PASS : FAIL,
    valor: plano || null, esperado: 'pro, team ou enterprise',
    nota: !plano ? 'a API não informou o plano da organização: confira em Organization → Billing' : plano === 'free' ? 'Free pausa por inatividade e não dá backup baixável — AMBIENTE-DE-PRODUCAO.md §1 pede Pro' : '' })

  // --- backups que existem ---
  if (!backups) {
    for (const [id, t] of [['backup-diario-recente', 'backup de menos de 36 h'], ['retencao', `retenção ≥ ${p.retencaoDias} dias`],
      ['pitr-habilitado', 'PITR habilitado'], ['pitr-janela', `janela de PITR ≥ ${p.pitrDias} dias`]]) {
      add({ id, titulo: t, resultado: NV, nota: 'GET /v1/projects/<ref>/database/backups não respondeu' })
    }
  } else {
    const lista = Array.isArray(backups.backups) ? backups.backups : []
    const completos = lista.filter((b) => String(b.status || '').toUpperCase() === 'COMPLETED').map((b) => segDe(b.inserted_at)).filter(Number.isFinite)
    const fis = backups.physical_backup_data || {}
    const pitrIni = Number(fis.earliest_physical_backup_date_unix); const pitrFim = Number(fis.latest_physical_backup_date_unix)
    const pitr = backups.pitr_enabled === true
    const ultimo = Math.max(...completos, pitr && Number.isFinite(pitrFim) ? pitrFim : -Infinity)
    const recente = Number.isFinite(ultimo) && agoraS() - ultimo <= 36 * 3600
    add({ id: 'backup-diario-recente', titulo: 'existe backup de menos de 36 h', resultado: recente ? PASS : FAIL,
      valor: { ultimo: iso(ultimo), diarios_concluidos: completos.length, walg: backups.walg_enabled ?? null },
      esperado: 'um backup COMPLETED (ou ponto de PITR) nas últimas 36 h', nota: recente ? '' : 'sem backup recente não há de onde voltar' })

    const idadeDias = projeto?.created_at ? (agoraS() - segDe(projeto.created_at)) / DIA : NaN
    const dias = new Set(completos.map((s) => new Date(s * 1000).toISOString().slice(0, 10))).size
    const janelaPitr = pitr && Number.isFinite(pitrIni) && Number.isFinite(pitrFim) ? (pitrFim - pitrIni) / DIA : 0
    const cobertura = Math.max(dias, janelaPitr)
    const novo = Number.isFinite(idadeDias) && idadeDias < p.retencaoDias
    add({ id: 'retencao', titulo: `retenção cobre ≥ ${p.retencaoDias} dias`, resultado: cobertura >= p.retencaoDias ? PASS : novo ? NV : FAIL,
      valor: { dias_com_backup_diario: dias, janela_pitr_dias: Number(janelaPitr.toFixed(1)), idade_do_projeto_dias: Number.isFinite(idadeDias) ? Number(idadeDias.toFixed(1)) : null },
      esperado: `≥ ${p.retencaoDias} dias de pontos de restauração`,
      nota: novo && cobertura < p.retencaoDias ? `o projeto tem ${idadeDias.toFixed(1)} dia(s): a retenção só é verificável depois de ${p.retencaoDias}` : '' })

    const pitrAddon = (addons?.selected_addons || []).find((a) => a.type === 'pitr')
    add({ id: 'pitr-habilitado', titulo: 'PITR habilitado', resultado: pitr ? PASS : FAIL,
      valor: { pitr_enabled: backups.pitr_enabled ?? null, addon: pitrAddon?.variant?.id || pitrAddon?.variant?.name || null },
      esperado: 'pitr_enabled = true',
      nota: pitr ? '' : 'sem PITR o RPO é o backup diário (até ~24 h de escrita perdida) e o passo 10 do DEPLOY-E-RECUPERACAO.md ("PITR para o instante do passo 5") não existe. Se o dono decidir não contratar, registre o RPO de 24 h — este critério continua FAIL de propósito' })
    add({ id: 'pitr-janela', titulo: `janela de PITR ≥ ${p.pitrDias} dias`, resultado: !pitr ? NV : janelaPitr >= p.pitrDias ? PASS : novo ? NV : FAIL,
      valor: pitr ? { de: iso(pitrIni), ate: iso(pitrFim), dias: Number(janelaPitr.toFixed(1)) } : null,
      esperado: `≥ ${p.pitrDias} dias entre o ponto mais antigo e o mais novo`, nota: !pitr ? 'PITR desligado' : '' })
  }

  // --- o que foi PROVADO: restore do backup diário baixado, num ambiente descartável ---
  if (!ensaio) {
    add({ id: 'restore-diario-testado', titulo: 'backup diário baixado e restaurado (ensaio-producao.mjs, etapa 1)', resultado: NV,
      nota: 'sem --ensaio: "o backup existe" não é prova. Baixe o diário e rode node scripts/ensaio-producao.mjs ensaiar <arquivo> --rotulo piloto-AAAA-MM-DD' })
  } else {
    // O ensaio foi escrito para o UPGRADE da produção legada: as etapas 3 (pré-voo), 7 (invariantes
    // do Tenant 001) e 9 (jornadas do Tenant 001) não se aplicam a um backup do piloto, que já está no
    // schema do SaaS e tem vários clubes — lá elas podem dar NO-GO sem dizer nada sobre o restore.
    // O que prova o RESTORE é a etapa 1: o arquivo restaura sem erro, o banco volta com o dono certo,
    // o papel do SQL Editor ainda cria no public (a próxima migration passa) e os serviços sobem.
    const probs = []; const notas = []
    if (ensaio.erro) probs.push(ensaio.erro)
    else {
      const etapa1 = ensaio.checks.filter((c) => /^1./.test(c.etapa || ''))
      const outras = ensaio.checks.filter((c) => !c.ok && !/^1./.test(c.etapa || ''))
      if (etapa1.length < 4) probs.push(`a etapa 1 (restore) tem ${etapa1.length} verificação(ões); o ensaio completo tem 4`)
      const f1 = etapa1.filter((c) => !c.ok)
      if (f1.length) probs.push(`restore falhou: ${f1.map((c) => c.nome).join(' | ')}`)
      const alheias = outras.filter((c) => !/^(3|7|8|9)./.test(c.etapa || ''))
      if (alheias.length) probs.push(`falha fora das etapas específicas do upgrade: ${alheias.map((c) => `[${c.etapa.split(' ')[0]}] ${c.nome}`).join(' | ')}`)
      else if (outras.length) notas.push(`${outras.length} falha(s) só nas etapas do upgrade da produção legada (3/7/8/9) — não dizem respeito ao restore; confira o relatório .md`)
      if (/sint[eé]tic/i.test(String(ensaio.rotulo || ''))) probs.push('é o ensaio SINTÉTICO — prova a ferramenta, não o backup deste projeto')
      if (ensaio.idadeDias > p.evidenciaMaxDias) probs.push(`tem ${ensaio.idadeDias.toFixed(0)} dias (máx. ${p.evidenciaMaxDias})`)
    }
    add({ id: 'restore-diario-testado', titulo: 'backup diário baixado e restaurado (ensaio-producao.mjs, etapa 1)', resultado: probs.length ? FAIL : PASS,
      valor: { arquivo: ensaio.arquivo, rotulo: ensaio.rotulo ?? null, veredito: ensaio.veredito ?? null, idade_dias: Number.isFinite(ensaio.idadeDias) ? Number(ensaio.idadeDias.toFixed(1)) : null },
      esperado: 'etapa 1 do ensaio inteira OK, de um backup REAL deste projeto, recente', nota: [...probs, ...notas].join('; ') })
  }

  // --- o que foi PROVADO: restore no PRÓPRIO projeto (PITR, ou o diário pelo painel), e quem responde ---
  // É outro teste que o ensaio: o ensaio prova que o ARQUIVO do backup restaura inteiro num lugar
  // descartável; este prova que o projeto volta no tempo, que o app continua de pé depois e que a
  // próxima migration ainda aplica. Só dá para fazer antes de o piloto ter dado real (ou num projeto
  // de staging hospedado com o mesmo plano) — é destrutivo por definição.
  const TIT = 'restore no próprio projeto (PITR ou diário) executado e conferido'
  if (!registro) {
    add({ id: 'restore-no-projeto-testado', titulo: TIT, resultado: NV,
      nota: 'sem --registro: só um restore feito e conferido conta (BACKUP-PITR-HOSPEDADO.md §3)' })
    add({ id: 'responsabilidade-definida', titulo: 'responsável, RPO e RTO alvo registrados', resultado: NV, nota: 'sem --registro' })
  } else if (registro.erro) {
    add({ id: 'restore-no-projeto-testado', titulo: TIT, resultado: FAIL, nota: registro.erro })
    add({ id: 'responsabilidade-definida', titulo: 'responsável, RPO e RTO alvo registrados', resultado: FAIL, nota: registro.erro })
  } else {
    const r = registro.dados
    const d = r.restore_no_projeto || {}
    const probs = []
    if (r.projeto_ref !== ref) probs.push(`o registro é do projeto ${String(r.projeto_ref || '?').slice(0, 4)}…, não deste`)
    if (!['pitr', 'diario'].includes(d.tipo)) probs.push('tipo do restore ausente (pitr ou diario)')
    if (d.tipo === 'pitr' && backups && backups.pitr_enabled !== true) probs.push('o registro diz PITR, mas o projeto está com PITR desligado hoje')
    if (d.conferencia_ok !== true) probs.push('conferência depois do restore não está marcada como ok')
    const quando = segDe(d.data)
    if (!Number.isFinite(quando)) probs.push('data do drill ausente ou inválida')
    else if ((agoraS() - quando) / DIA > p.evidenciaMaxDias * 3) probs.push(`drill de ${((agoraS() - quando) / DIA).toFixed(0)} dias atrás (refazer a cada ${p.evidenciaMaxDias * 3})`)
    if (!Number.isFinite(segDe(d.ponto_restaurado))) probs.push('ponto restaurado ausente')
    if (Number.isFinite(d.rto_medido_min) && Number.isFinite(r.rto_alvo_min) && d.rto_medido_min > r.rto_alvo_min) probs.push(`RTO medido ${d.rto_medido_min} min > alvo ${r.rto_alvo_min} min`)
    if (d.proxima_migration_ok !== true) probs.push('não registrou que uma migration ainda aplica depois do restore (o achado do drill da fase 9)')
    add({ id: 'restore-no-projeto-testado', titulo: TIT, resultado: probs.length ? FAIL : PASS,
      valor: { tipo: d.tipo || null, data: d.data || null, ponto_restaurado: d.ponto_restaurado || null, rto_medido_min: d.rto_medido_min ?? null, conferencia_ok: d.conferencia_ok ?? null },
      esperado: 'drill registrado, deste projeto, conferido, com migration de prova depois', nota: probs.join('; ') })
    const faltam = ['responsavel', 'substituto', 'rpo_alvo_min', 'rto_alvo_min', 'quem_decide_restaurar'].filter((k) => r[k] === undefined || r[k] === null || r[k] === '')
    // um RPO alvo abaixo de um dia é promessa que só o PITR cumpre: sem ele, o ponto mais novo é o diário
    if (backups && backups.pitr_enabled !== true && Number.isFinite(r.rpo_alvo_min) && r.rpo_alvo_min < 24 * 60) {
      faltam.push(`RPO alvo de ${r.rpo_alvo_min} min com PITR desligado (sem PITR o RPO real é de até 24 h)`)
    }
    add({ id: 'responsabilidade-definida', titulo: 'responsável, RPO e RTO alvo registrados', resultado: faltam.length ? FAIL : PASS,
      valor: { rpo_alvo_min: r.rpo_alvo_min ?? null, rto_alvo_min: r.rto_alvo_min ?? null, papeis: faltam.length ? null : 'definidos' },
      esperado: 'responsavel, substituto, quem_decide_restaurar, rpo_alvo_min, rto_alvo_min', nota: faltam.length ? `faltam/inconsistente: ${faltam.join(', ')}` : '' })
  }
}

function lerEnsaio(arq) {
  if (!existsSync(arq)) return { arquivo: basename(arq), erro: 'arquivo não encontrado' }
  try {
    const j = JSON.parse(readFileSync(arq, 'utf8'))
    if (!Array.isArray(j.checks)) return { arquivo: basename(arq), erro: 'não é o JSON do ensaio (sem "checks")' }
    return { arquivo: basename(arq), rotulo: j.rotulo, veredito: j.veredito, falhas: j.falhas, checks: j.checks, idadeDias: (Date.now() - statSync(arq).mtimeMs) / 86400000 }
  } catch (e) { return { arquivo: basename(arq), erro: `não é o JSON do ensaio: ${e.message}` } }
}
function lerRegistro(arq) {
  if (!existsSync(arq)) return { erro: `registro não encontrado: ${basename(arq)}` }
  try { return { dados: JSON.parse(readFileSync(arq, 'utf8')) } } catch (e) { return { erro: `registro ilegível: ${e.message}` } }
}

async function principal(args) {
  const token = process.env.SUPABASE_ACCESS_TOKEN || ''
  const ref = process.env.PROJECT_REF || ''
  if (!token || !ref) {
    console.error('Faltou SUPABASE_ACCESS_TOKEN e PROJECT_REF. Ver o cabeçalho deste script e supabase/infra/BACKUP-PITR-HOSPEDADO.md.')
    return 3
  }
  let guarda
  try { guarda = conferirAlvo(process.env.SUPABASE_URL || `https://${ref}.supabase.co`, { ref }) } catch (e) {
    if (e instanceof Recusa) { console.error(e.message); return 3 }
    throw e
  }
  if (guarda.local) { console.error('Alvo local: backup/PITR do Docker é o scripts/restaurar-staging.mjs, não este script.'); return 3 }
  const p = {
    retencaoDias: Number(process.env.BACKUP_RETENCAO_DIAS || 7),
    pitrDias: Number(process.env.BACKUP_PITR_DIAS || 7),
    evidenciaMaxDias: Number(process.env.BACKUP_EVIDENCIA_MAX_DIAS || 30),
  }
  const soJson = Boolean(args.json)
  const log = soJson ? () => {} : (...a) => console.log(...a)
  log(`\n== Backup/PITR hospedado — projeto ${ref}`)
  log(`   guarda: ${guarda.bloqueios.length} endereço(s) de produção conhecido(s) — alvo não é nenhum deles`)

  const rP = await gestao(ref, '', token)
  const projeto = rP.status === 200 ? rP.json : null
  let org = null
  if (projeto?.organization_id) {
    const rO = await obterJson(`${API_GESTAO}/v1/organizations/${encodeURIComponent(projeto.organization_id)}`, { Authorization: `Bearer ${token}`, Accept: 'application/json' })
    org = rO.status === 200 ? rO.json : null
  }
  const rA = await gestao(ref, '/billing/addons', token)
  const rB = await gestao(ref, '/database/backups', token)
  const respostas = { projeto: rP.status, organizacao: org ? 200 : projeto?.organization_id ? 'falhou' : 'sem-org', addons: rA.status, backups: rB.status }
  if (rP.status === 401) log('   AVISO: o token foi recusado (401) — todos os critérios de API ficam NAO-VERIFICAVEL')

  const { criterios, add } = novoRelatorio()
  avaliar({
    projeto, org, addons: rA.status === 200 ? rA.json : null, backups: rB.status === 200 ? rB.json : null,
    ensaio: args.ensaio ? lerEnsaio(args.ensaio) : null, registro: args.registro ? lerRegistro(args.registro) : null, ref, p,
  }, add)
  const resumo = resumir(criterios)
  const b = rB.status === 200 ? rB.json : null
  const saida = {
    ferramenta: 'scripts/verificar-backup-hospedado.mjs', formato: 1, quando: new Date().toISOString(),
    alvo: { ref }, guarda: { producao_conhecida: guarda.bloqueios.length, recusou: false }, respostas,
    registro: {
      plano: org?.plan ?? null, regiao: projeto?.region ?? null, criado_em: projeto?.created_at ?? null,
      pitr_enabled: b?.pitr_enabled ?? null, walg_enabled: b?.walg_enabled ?? null,
      backups: (b?.backups || []).map((x) => ({ status: x.status, em: x.inserted_at, fisico: x.is_physical_backup })),
      pitr_de: iso(Number(b?.physical_backup_data?.earliest_physical_backup_date_unix)), pitr_ate: iso(Number(b?.physical_backup_data?.latest_physical_backup_date_unix)),
      addons: (rA.json?.selected_addons || []).map((a) => ({ tipo: a.type, variante: a.variant?.id || a.variant?.name || null })),
    },
    parametros: p, criterios, resumo,
  }
  if (!soJson) {
    log(`   respostas: ${JSON.stringify(respostas)}\n`)
    imprimirCriterios(criterios)
    log(`\nobrigatórios: ${resumo.obrigatorios.PASS} PASS · ${resumo.obrigatorios.FAIL} FAIL · ${resumo.obrigatorios[NV]} NAO-VERIFICAVEL`)
    log(`VEREDITO: ${resumo.veredito}${resumo.veredito !== 'VERDE' ? ' — o item 7 só fica verde com todos os obrigatórios em PASS, restore TESTADO incluído' : ''}\n`)
    log('--- JSON ---')
  }
  const texto = JSON.stringify(saida, null, 2)
  if (texto.includes(token) || /sbp_[A-Za-z0-9]{8,}/.test(texto) || /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/.test(texto)) {
    console.error('RECUSADO: a saída conteria algo com cara de token. Nada foi impresso nem gravado.')
    return 3
  }
  console.log(texto)
  if (args.saida) writeFileSync(args.saida, `${texto}\n`)
  return resumo.codigo_saida
}

const args = lerArgs(process.argv.slice(2), ['json'])
process.exit(await principal(args))
