import pg from 'pg'

const client = new pg.Client({
  host: process.env.DBHOST, port: Number(process.env.DBPORT),
  user: process.env.DBUSER, password: process.env.DBPASS,
  database: 'postgres', ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 20000,
})

try {
  await client.connect()
  const r = await client.query('update auth.users set email_confirmed_at = now() where email_confirmed_at is null')
  console.log('Usuarios confirmados manualmente agora:', r.rowCount)
} catch (e) {
  console.error('ERRO:', e.message)
  process.exitCode = 1
} finally {
  await client.end().catch(() => {})
}
