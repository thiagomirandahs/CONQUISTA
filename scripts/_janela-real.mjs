// Janela real de migração — ensaio final sobre o backup FRESCO (não o de 24/09), até a barreira
// anterior à produção. Reaproveita scripts/lib/descartavel.mjs e scripts/lib/aplicar.mjs (Etapa 3).
// NUNCA toca o Supabase real: só le o dump já baixado em backup-conquista-migracao-2026-09-24/.
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import {
  provisionar, descartar, esperarApi, trocarBanco, conferirQueODeployContinua, docker, R_NOME,
} from './lib/descartavel.mjs'
import { aplicarComoSqlEditor, faltando } from './lib/aplicar.mjs'

const DB = `supabase_db_${R_NOME}`
const BACKUP = 'backup-conquista-janela-real-final/database/banco-completo.dump'
const MIG = 'supabase/migrations'
const EVID = 'supabase/e2e/evidencias-janela-real'
mkdirSync(EVID, { recursive: true })

function preflight() {
  const sql = `begin transaction read only;\n${readFileSync('supabase/PREFLIGHT-PRODUCAO.sql', 'utf8')}\ncommit;`
  const out = docker(['exec', '-i', DB, 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-q', '-A', '-F', '\t'], { input: sql })
  const linhas = out.split('\n').filter(Boolean)
  return linhas
}

function estadoDentro() {
  const sql = `
begin transaction read only;
select 'auth.users', count(*)::text from auth.users
union all select 'clube_legado_existe', count(*)::text from public.organizational_units where slug='filhos-da-conquista'
union all select 'memberships_total', count(*)::text from public.organization_memberships
union all select 'memberships_no_legado', count(*)::text from public.organization_memberships m join public.organizational_units u on u.id=m.organizational_unit_id where u.slug='filhos-da-conquista'
union all select 'memberships_fora_do_legado', count(*)::text from public.organization_memberships m join public.organizational_units u on u.id=m.organizational_unit_id where u.slug<>'filhos-da-conquista'
union all select 'unidades', count(*)::text from public.unidades
union all select 'unidades_fora_do_legado', count(*)::text from public.unidades u join public.organizational_units o on o.id=u.club_id where o.slug<>'filhos-da-conquista'
union all select 'responsaveis', count(*)::text from public.responsaveis
union all select 'pontos_linhas', count(*)::text from public.pontos
union all select 'pontos_soma', sum(pontos)::text from public.pontos
union all select 'pontos_apontamento', count(*)::text from public.pontos where origem='apontamento'
union all select 'pontos_fora_do_legado', count(*)::text from public.pontos p join public.unidades u on u.id=p.unidade_id join public.organizational_units o on o.id=u.club_id where o.slug<>'filhos-da-conquista'
union all select 'mensalidades', count(*)::text from public.mensalidades
union all select 'trilha_jogos', count(*)::text from public.trilha_jogos
union all select 'partidas', count(*)::text from public.partidas
union all select 'notificacoes', count(*)::text from public.notificacoes
union all select 'devocional', count(*)::text from public.devocional
union all select 'missoes_feitas', count(*)::text from public.missoes_feitas
union all select 'biblia_leituras', count(*)::text from public.biblia_leituras
union all select 'bichinhos', count(*)::text from public.bichinhos
union all select 'storage_objects', count(*)::text from storage.objects
union all select 'club_storage_objetos', count(*)::text from public.club_storage_objetos
union all select 'club_storage_fora', count(*)::text from public.club_storage_objetos c join public.organizational_units o on o.id=c.club_id where o.slug<>'filhos-da-conquista'
union all select 'cron_jobs', count(*)::text from cron.job
union all select 'orfaos_auth_sem_profile', count(*)::text from auth.users u left join public.profiles p on p.id=u.id where p.id is null
union all select 'platform_admins', count(*)::text from public.platform_admins
union all select 'reconciliacao_pendente', count(*)::text from public.organization_memberships m left join public.profiles p on p.id=m.user_id where p.id is null;
commit;`
  const out = docker(['exec', '-i', DB, 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-q', '-A', '-F', '\t'], { input: sql })
  const linhas = out.split('\n').filter(Boolean).slice(1)
  const o = {}
  for (const l of linhas) { const [k, v] = l.split('\t'); o[k] = v }
  return o
}

console.log('# Janela real — ensaio final sobre backup fresco')
console.log('\n== restaurando o backup FRESCO num ambiente descartável ==')
descartar()
const { anon } = provisionar()
if (!(await esperarApi(anon))) throw new Error('API do descartável não respondeu')
const restore = trocarBanco(DB, BACKUP)
console.log('restore:', JSON.stringify(restore))
if (restore.erros.length) throw new Error(`restore com erro real: ${restore.erros.join(' | ')}`)

conferirQueODeployContinua(DB, (msg, ok, extra) => console.log(`   ${ok ? 'OK' : 'FALHOU'}  ${msg}${extra ? ` (${extra})` : ''}`))

console.log('\n== pré-voo ANTES do pré-janela ==')
const pre1 = preflight()
writeFileSync(join(EVID, 'preflight-antes.txt'), pre1.join('\n'))
console.log(pre1.filter((l) => /^PROBLEMA|^RESUMO/.test(l)).join('\n'))

console.log('\n== aplicando o pré-janela (ledger + legado nunca rodado) ==')
docker(['exec', '-i', DB, 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-q', '-v', 'ON_ERROR_STOP=1', '--single-transaction'],
  { input: readFileSync('scripts/pre-janela-conquista.sql', 'utf8').replace(/\r\n/g, '\n') })
console.log('   ok, sem erro')

console.log('\n== aplicando a remoção do Cartão de Classe (já autorizada e provada na Etapa 3) ==')
docker(['exec', '-i', DB, 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-q', '-v', 'ON_ERROR_STOP=1', '--single-transaction'],
  { input: readFileSync('scripts/remover-cartao-de-classe-legado.sql', 'utf8').replace(/\r\n/g, '\n') })
console.log('   ok, sem erro')

console.log('\n== pré-voo DEPOIS do pré-janela ==')
const pre2 = preflight()
writeFileSync(join(EVID, 'preflight-depois.txt'), pre2.join('\n'))
console.log(pre2.filter((l) => /^PROBLEMA|^RESUMO/.test(l)).join('\n'))
const problemas = pre2.filter((l) => l.startsWith('PROBLEMA') && !l.startsWith('PROBLEMA  RESUMO'))
const soFalsoPositivoConhecido = problemas.length === 1 && problemas[0].includes('funcoes-legadas-ausentes-ou-com-assinatura-diferente') && /listar_usuarios/.test(problemas[0])
if (problemas.length > 0 && !soFalsoPositivoConhecido) {
  throw new Error(`pré-voo com problema NOVO, não previsto na Etapa 3 — ABORTAR:\n${problemas.join('\n')}`)
}
console.log(soFalsoPositivoConhecido ? '   único PROBLEMA restante é o falso positivo já documentado (listar_usuarios) — segue' : '   nenhum PROBLEMA — segue')

const antesDentro = estadoDentro()
writeFileSync(join(EVID, 'antes.json'), JSON.stringify(antesDentro, null, 1))
console.log('\n== estado ANTES das migrations (dentro da cópia) ==')
console.log(JSON.stringify(antesDentro, null, 1))

console.log('\n== aplicando as 86 migrations SaaS ==')
const todas = readdirSync(MIG).filter((f) => f.endsWith('.sql') && f.split('_')[0] >= '20260921000001').sort()
const duracoes = []
let falhou = null
for (const f of todas) {
  const corpo = readFileSync(join(MIG, f), 'utf8')
  const r = aplicarComoSqlEditor(DB, f, corpo)
  duracoes.push({ f, ok: r.ok, ms: r.ms, erro: r.erro })
  if (!r.ok) { falhou = { f, erro: r.erro }; break }
}
writeFileSync(join(EVID, 'duracoes-migrations.json'), JSON.stringify(duracoes, null, 1))
if (falhou) {
  throw new Error(`Migration falhou: ${falhou.f}\n${falhou.erro}\nNÃO tocar na produção.`)
}
const totalMs = duracoes.reduce((s, d) => s + d.ms, 0)
console.log(`   ${duracoes.length}/${todas.length} aplicadas, total ${(totalMs / 1000).toFixed(1)}s`)
const ordenadas = [...duracoes].sort((a, b) => b.ms - a.ms).slice(0, 5)
console.log('   mais demoradas:', ordenadas.map((d) => `${d.f} (${d.ms}ms)`).join(' | '))

const semLedger = faltando(DB, todas.map((f) => f.split('_')[0]))
console.log('   faltando no ledger:', semLedger.length ? semLedger.join(',') : 'nenhuma — 100% registrado')
if (semLedger.length) throw new Error(`ledger incompleto: ${semLedger.join(',')}`)

conferirQueODeployContinua(DB, (msg, ok, extra) => console.log(`   ${ok ? 'OK' : 'FALHOU'}  ${msg}${extra ? ` (${extra})` : ''}`))

const depoisDentro = estadoDentro()
writeFileSync(join(EVID, 'depois.json'), JSON.stringify(depoisDentro, null, 1))
console.log('\n== estado DEPOIS das migrations (dentro da cópia) ==')
console.log(JSON.stringify(depoisDentro, null, 1))

console.log('\n== JANELA REAL: ensaio sobre backup fresco concluído até aqui. Container mantido para os gates. ==')
console.log(`CONTAINER=${DB}`)
