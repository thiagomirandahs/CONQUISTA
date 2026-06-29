import pg from 'pg'

const client = new pg.Client({
  host: process.env.DBHOST, port: Number(process.env.DBPORT),
  user: process.env.DBUSER, password: process.env.DBPASS,
  database: 'postgres', ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 20000,
})

try {
  await client.connect()
  const { rows } = await client.query(
    "select tablename from pg_tables where schemaname='public' order by tablename"
  )
  console.log('Tabelas no banco: ' + rows.map((r) => r.tablename).join(', '))
  await client.query("notify pgrst, 'reload schema'")
  console.log('Comando de reload da API enviado.')
} catch (e) {
  console.error('ERRO:', e.message)
  process.exitCode = 1
} finally {
  await client.end().catch(() => {})
}
