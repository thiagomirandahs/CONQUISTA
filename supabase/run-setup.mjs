import pg from 'pg'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const sql = readFileSync(join(__dirname, 'schema.sql'), 'utf8')

const client = new pg.Client({
  host: process.env.DBHOST || 'db.ezaajfisptbslheogaha.supabase.co',
  port: Number(process.env.DBPORT || 5432),
  user: process.env.DBUSER || 'postgres',
  password: process.env.DBPASS,
  database: 'postgres',
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 20000,
})

try {
  await client.connect()
  console.log('Conectado ao banco. Aplicando configuracao (schema)...')
  await client.query(sql)
  console.log('SUCESSO: tabelas, permissoes e limpeza aplicadas; API recarregada!')
} catch (e) {
  console.error('ERRO:', e.message)
  process.exitCode = 1
} finally {
  await client.end().catch(() => {})
}
