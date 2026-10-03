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
const preco = await ler('20260930000542_licenca-anual-220-pix-250-cartao.sql')
await db.exec(preco); await db.exec(preco)
assert.equal((await db.query('select count(*)::int n from public.billing_plans')).rows[0].n, 2)
assert.equal((await db.query('select plan_id=(select id from public.billing_plans where versao=1) preservado from public.subscriptions')).rows[0].preservado, true)
await db.exec(await ler('20260930000543_checkout-infinitepay.sql'))
assert.equal((await db.query(`select has_function_privilege('authenticated','public.licenca_infinitepay_confirmar(uuid,text,text,bigint,int)','execute') permitido`)).rows[0].permitido,false)
assert.equal((await db.query(`select has_table_privilege('authenticated','public.licenca_pedidos','insert') permitido`)).rows[0].permitido,false)
await db.exec(`select set_config('teste.uid','${outra}',false)`)
assert.equal((await db.query('select public.licenca_checkout_contexto() ctx')).rows[0].ctx.pode_pagar,false)
await assert.rejects(db.query('select public.licenca_checkout_criar()'), /responsável financeiro/)
await db.exec(`select set_config('teste.uid','${uid}',false)`)
const o = (await db.query('select public.licenca_checkout_criar() o')).rows[0].o
assert.equal(o.cartao_centavos,25000); assert.equal(o.pix_centavos,22000)
assert.equal((await db.query('select public.licenca_checkout_criar() o')).rows[0].o.id,o.id)
await assert.rejects(db.query(`select public.licenca_infinitepay_confirmar('${o.id}','transacao','credit_card',22000,12)`), /divergente/)
assert.equal((await db.query('select status from public.subscriptions')).rows[0].status,'trial')
await db.exec(`select public.licenca_infinitepay_confirmar('${o.id}','transacao','pix',22000,1)`)
const fim = (await db.query('select periodo_fim from public.subscriptions')).rows[0].periodo_fim
assert.equal((await db.query(`select public.licenca_infinitepay_confirmar('${o.id}','transacao','pix',22000,1) resultado`)).rows[0].resultado.duplicado,true)
assert.deepEqual((await db.query('select periodo_fim from public.subscriptions')).rows[0].periodo_fim,fim)
assert.equal((await db.query('select count(*)::int n from public.billing_invoices')).rows[0].n,1)
assert.equal((await db.query('select count(*)::int n from public.billing_events')).rows[0].n,1)
await assert.rejects(db.query(`select public.licenca_infinitepay_confirmar('${o.id}','outra-transacao','pix',22000,1)`), /outra transação/)
await assert.rejects(db.query('select public.licenca_checkout_criar()'), /responsável financeiro/)
await db.close()
console.log('OK: migrations, reexecução, preços, contratos antigos, permissões, isolamento, valor divergente, ativação anual e idempotência.')
