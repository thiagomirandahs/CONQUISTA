// PostgreSQL WASM isolado: valida as migrations novas sem credenciais nem pagamentos.
// Não substitui o replay completo do Supabase. Instalação/execução em docs/PAGAMENTO-INFINITEPAY.md.
import { readFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
const { PGlite } = await import(process.env.PGLITE_MODULO || '@electric-sql/pglite')
const db = new PGlite()
const ler = n => readFile(new URL(`../../migrations/${n}`, import.meta.url), 'utf8')
await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
  create schema auth; create table auth.users(id uuid primary key);
  create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('teste.uid',true),'')::uuid $$;
  create table public.organizational_units(id uuid primary key);
  create table public.migracoes_aplicadas(arquivo text primary key, aplicada_em timestamptz default now());`)
const base = await ler('20260921000048_fundacao-comercial-saas.sql')
for (const n of ['billing_accounts','billing_account_contacts','billing_plans','billing_prices','subscriptions','subscription_events','subscription_clubs','billing_invoices','billing_providers','billing_events']) {
  const ddl = base.match(new RegExp(`create table if not exists public\\.${n} \\([\\s\\S]*?\\n\\);`))?.[0]
  assert.ok(ddl, n)
  await db.exec(ddl)
}
await db.exec(`alter table public.billing_prices add column metadata jsonb not null default '{}';
  create function public.clube_atual_id() returns uuid language sql as $$ select nullif(current_setting('teste.club',true),'')::uuid $$;
  create function public.assinatura_do_clube_id(c uuid) returns uuid language sql as $$ select subscription_id from public.subscription_clubs where club_id=c $$;
  create function public._assinatura_transicionar(s uuid, novo text, motivo text, origem text, detalhe jsonb) returns text language plpgsql as $$
    begin update public.subscriptions set status=novo where id=s; return novo; end $$;`)
const uid = '11111111-1111-4111-8111-111111111111'
const outra = '22222222-2222-4222-8222-222222222222'
const club = '33333333-3333-4333-8333-333333333333'
await db.exec(`insert into auth.users values ('${uid}'), ('${outra}');
  insert into public.organizational_units values ('${club}');
  insert into public.billing_plans(chave,versao,nome,status,publico,ativo,recursos,limites) values ('anual',1,'Licença Anual','publicado',true,true,null,'{"clubes":1}');
  insert into public.billing_prices(plan_id,ciclo,valor_centavos,metadata) select id,'anual',22990,'{"pix_centavos":19990}' from public.billing_plans;
  insert into public.billing_accounts(nome) values ('Clube de teste');
  insert into public.billing_account_contacts(billing_account_id,user_id,papel) select id,'${uid}','titular' from public.billing_accounts;
  insert into public.subscriptions(billing_account_id,plan_id,price_id,status,ciclo) select a.id,p.id,pr.id,'trial','anual' from public.billing_accounts a,public.billing_plans p,public.billing_prices pr;
  insert into public.subscription_clubs(subscription_id,club_id) select id,'${club}' from public.subscriptions;
  select set_config('teste.uid','${uid}',false),set_config('teste.club','${club}',false);`)

await db.exec(`create function public._manutencao_instalar_guarda() returns void language sql as $$ select $$;`)
await db.exec(await ler('20260930000542_licenca-anual-220-pix-250-cartao.sql'))
await db.exec(await ler('20260930000543_checkout-infinitepay.sql'))
const mig = await ler('20260930000547_licenca-250-promocao-50.sql')
await db.exec(mig); await db.exec(mig)
assert.equal((await db.query('select count(*)::int n from public.billing_plans')).rows[0].n, 3)
assert.equal((await db.query('select valor_centavos,metadata from public.billing_prices p join public.billing_plans b on b.id=p.plan_id where b.versao=3')).rows[0].metadata.pix_centavos,25000)
const q = async (sql) => (await db.query(sql)).rows[0]
const promo = async () => (await q('select public.licenca_promocao_situacao() d')).d
assert.equal((await promo()).disponiveis,50)
assert.equal((await q("select has_function_privilege('authenticated','public._licenca_infinitepay_confirmar_543(uuid,text,text,bigint,int)','execute') ok")).ok,false)
assert.equal((await q("select has_table_privilege('authenticated','public.licenca_promocao_vagas','insert') ok")).ok,false)
await db.exec(`select set_config('teste.uid','${outra}',false)`)
assert.equal((await q('select public.licenca_checkout_contexto() d')).d.pode_pagar,false)
await db.exec(`select set_config('teste.uid','${uid}',false)`)
const primeiro = (await q('select public.licenca_checkout_criar() d')).d
assert.equal(primeiro.pix_centavos,22000); assert.equal(primeiro.cartao_centavos,22000)
assert.equal(primeiro.promocao,true)
assert.equal((await q('select public.licenca_checkout_criar() d')).d.id,primeiro.id)
assert.equal((await promo()).reservados,1)
assert.equal((await promo()).confirmados,0)
await assert.rejects(db.query(`select public.licenca_infinitepay_confirmar('${primeiro.id}','pix-1','pix',25000,1)`), /divergente/)
assert.equal((await promo()).confirmados,0)
await db.exec(`select public.licenca_infinitepay_confirmar('${primeiro.id}','pix-1','pix',22000,1)`)
const fim = (await q('select periodo_fim from public.subscriptions')).periodo_fim
assert.equal((await promo()).confirmados,1)
assert.equal((await q(`select public.licenca_infinitepay_confirmar('${primeiro.id}','pix-1','pix',22000,1) d`)).d.duplicado,true)
assert.deepEqual((await q('select periodo_fim from public.subscriptions')).periodo_fim,fim)
// Mais 49 clubes: cadastrado não conta, pedido reserva, confirmação efetiva preenche.
for (let n=2;n<=50;n++) {
  const clube = `40000000-0000-4000-8000-${String(n).padStart(12,'0')}`
  await db.exec(`insert into public.organizational_units values('${clube}');
    insert into public.subscriptions(billing_account_id,plan_id,price_id,status,ciclo)
    select a.id,p.plan_id,p.id,'trial','anual' from public.billing_accounts a,public.billing_prices p join public.billing_plans b on b.id=p.plan_id where b.versao=3;
    insert into public.subscription_clubs(subscription_id,club_id) select id,'${clube}' from public.subscriptions s where not exists(select 1 from public.subscription_clubs c where c.subscription_id=s.id);
    select set_config('teste.club','${clube}',false);`)
  const o=(await q('select public.licenca_checkout_criar() d')).d
  assert.equal(o.promocao,true); assert.equal(o.cartao_centavos,22000)
  await db.exec(`select public.licenca_infinitepay_confirmar('${o.id}','cartao-${n}','credit_card',22000,1)`)
}
assert.equal((await promo()).confirmados,50)
assert.equal((await promo()).disponiveis,0)
// 51º clube paga o preço regular nos dois métodos.
await db.exec(`insert into public.organizational_units values('50000000-0000-4000-8000-000000000051');
  insert into public.subscriptions(billing_account_id,plan_id,price_id,status,ciclo)
    select a.id,p.plan_id,p.id,'trial','anual' from public.billing_accounts a,public.billing_prices p join public.billing_plans b on b.id=p.plan_id where b.versao=3;
  insert into public.subscription_clubs(subscription_id,club_id) select id,'50000000-0000-4000-8000-000000000051' from public.subscriptions s where not exists(select 1 from public.subscription_clubs c where c.subscription_id=s.id);
  select set_config('teste.club','50000000-0000-4000-8000-000000000051',false);`)
const normal=(await q('select public.licenca_checkout_criar() d')).d
assert.equal(normal.pix_centavos,25000); assert.equal(normal.cartao_centavos,25000); assert.equal(normal.promocao,false)
// Renovação do primeiro clube nunca recebe desconto outra vez.
await db.exec(`select set_config('teste.club','${club}',false); update public.subscriptions set periodo_fim=now()+interval '10 days' where id=(select subscription_id from public.subscription_clubs where club_id='${club}');`)
const renovar=(await q('select public.licenca_checkout_criar() d')).d
assert.equal(renovar.promocao,false); assert.equal(renovar.pix_centavos,25000)
assert.equal((await promo()).confirmados,50)
await db.close()
console.log('OK: preço regular, 50 clubes únicos, 51º regular, renovação, autorização, valor divergente, reserva, confirmação e idempotência.')
