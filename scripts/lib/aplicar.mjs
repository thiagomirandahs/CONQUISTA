// O passo 7 de supabase/infra/DEPLOY-E-RECUPERACAO.md, como código: aplica UMA migration do jeito
// que o SQL Editor aplica — o arquivo inteiro numa transação só, como o papel `postgres` (não é
// superusuário) — e grava o ledger NA MESMA transação: se a migration cai, o registro cai junto.
// Usado por scripts/aplicar-migration.mjs e scripts/drill-migration.mjs.
import { execFileSync } from 'node:child_process'
import { basename } from 'node:path'

export function aplicarComoSqlEditor(container, nomeArquivo, corpo) {
  const [version, ...resto] = basename(nomeArquivo, '.sql').split('_')
  const sql = `${corpo}\n;insert into supabase_migrations.schema_migrations (version, name, statements) values ('${version}', '${resto.join('_')}', array[]::text[]);\n`
  const t0 = Date.now()
  try {
    execFileSync('docker', ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-q', '-v', 'ON_ERROR_STOP=1', '--single-transaction'],
      { input: sql, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] })
    return { ok: true, ms: Date.now() - t0, version }
  } catch (e) {
    return { ok: false, ms: Date.now() - t0, version, erro: (e.stderr || e.message).split('\n').find((l) => /ERROR/.test(l)) || e.message }
  }
}

// A conferência do ledger pelo CONJUNTO — nunca pelo max(version), que mente quando uma do meio falhou.
export function faltando(container, versoes) {
  const lista = versoes.map((v) => `'${v}'`).join(',')
  const saida = execFileSync('docker', ['exec', '-i', container, 'psql', '-U', 'supabase_admin', '-d', 'postgres', '-X', '-q', '-A', '-t'],
    { input: `select coalesce(string_agg(v, ','), '') from unnest(array[${lista}]) v where v not in (select version from supabase_migrations.schema_migrations);`, encoding: 'utf8' }).trim()
  return saida.split(',').filter(Boolean)
}
