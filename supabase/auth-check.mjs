import pg from 'pg'

const client = new pg.Client({
  host: process.env.DBHOST, port: Number(process.env.DBPORT),
  user: process.env.DBUSER, password: process.env.DBPASS,
  database: 'postgres', ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 20000,
})

try {
  await client.connect()
  const { rows: cnt } = await client.query(
    'select count(*)::int total, count(email_confirmed_at)::int confirmados from auth.users'
  )
  console.log('Usuarios:', JSON.stringify(cnt[0]))
  const { rows } = await client.query(
    "select email, (email_confirmed_at is not null) as confirmado, to_char(created_at,'DD/MM HH24:MI') as criado from auth.users order by created_at desc limit 8"
  )
  rows.forEach((r) => console.log(`  ${r.confirmado ? 'OK ' : '-- '} ${r.criado}  ${r.email}`))
} catch (e) {
  console.error('ERRO:', e.message)
  process.exitCode = 1
} finally {
  await client.end().catch(() => {})
}
