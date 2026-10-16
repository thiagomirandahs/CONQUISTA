-- Venda de teste (migration 551): só o admin cria, valor de R$ 1 a R$ 10, separada dos pedidos reais, confirmação só pelo
-- serviço com valor EXATO, e confirmada NÃO ativa licença, NÃO cria fatura, NÃO mexe na assinatura nem nas vagas.
begin;
\ir _lib.sql
\ir _fixtures.sql

\o /dev/null
select t.signup('adm151', '{"tipo":"fundador","nome":"Admin 151"}'::jsonb);
insert into public.platform_admins (user_id, papel) values (t.id('adm151'), 'operacao');
\o

-- quem não é admin não cria nem lista
select t.como('lider_a');
select t.throws('liderança de clube não cria teste', format('select public.admin_licenca_teste_criar(%L)', t.id('clube_a')), 'Sem permissão');
select t.throws('...nem lista', 'select public.admin_licenca_teste_listar()', 'Sem permissão');
select t.bloqueado('...nem lê a tabela', 'select count(*) from public.licenca_vendas_teste');
select t.throws('...nem confirma', format('select public.licenca_teste_confirmar(%L, %L, %L, 100, 1)', gen_random_uuid(), 'x', 'pix'), 'permission denied');
reset role;
select t.como_anon();
select t.bloqueado('anon não lê a tabela', 'select count(*) from public.licenca_vendas_teste');
reset role;

-- fotografia do que NÃO pode mudar
select count(*) as faturas_antes from public.billing_invoices \gset
select count(*) as pedidos_antes from public.licenca_pedidos \gset
select count(*) as vagas_antes from public.licenca_promocao_vagas \gset
select coalesce(string_agg(id || status || coalesce(periodo_fim::text, '-'), ',' order by id), '') as subs_antes from public.subscriptions \gset

-- admin cria: valor fora da faixa e clube inexistente são recusados
select t.como('adm151');
select t.throws('valor abaixo de R$ 1 é recusado', format('select public.admin_licenca_teste_criar(%L, 50)', t.id('clube_a')), 'R$ 1,00 a R$ 10,00');
select t.throws('valor acima de R$ 10 é recusado', format('select public.admin_licenca_teste_criar(%L, 25000)', t.id('clube_a')), 'R$ 1,00 a R$ 10,00');
select t.throws('clube inexistente é recusado', format('select public.admin_licenca_teste_criar(%L)', gen_random_uuid()), 'Escolha um clube');
select set_config('t151.v', public.admin_licenca_teste_criar(t.id('clube_a'))::text, true);
select t.eq('teste criado com R$ 1,00 por padrão', ((current_setting('t151.v')::jsonb)->>'valor_centavos')::bigint, 100::bigint);
select t.eq('admin lista o teste pendente', (select count(*) from jsonb_array_elements(public.admin_licenca_teste_listar()) x where x->>'status' = 'pendente'), 1::bigint);
reset role;
select t.eq('criação auditada', (select count(*) from public.platform_admin_audit where acao = 'licenca_teste_criar'), 1::bigint);

-- confirmação pelo serviço: valor divergente recusado; valor exato confirma
select t.como_service();
select t.throws('serviço: valor divergente é recusado', format('select public.licenca_teste_confirmar(%L, %L, %L, 200, 1)', (current_setting('t151.v')::jsonb)->>'id', 'tx-1', 'pix'), 'divergente');
select t.throws('serviço: parcelado é recusado', format('select public.licenca_teste_confirmar(%L, %L, %L, 100, 2)', (current_setting('t151.v')::jsonb)->>'id', 'tx-1', 'credit_card'), 'divergente');
select t.eq('serviço: valor exato confirma', (public.licenca_teste_confirmar(((current_setting('t151.v')::jsonb)->>'id')::uuid, 'tx-1', 'pix', 100, 1)->>'ok')::boolean::int::bigint, 1::bigint);
select t.eq('repetir a mesma transação é idempotente', (public.licenca_teste_confirmar(((current_setting('t151.v')::jsonb)->>'id')::uuid, 'tx-1', 'pix', 100, 1)->>'duplicado')::boolean::int::bigint, 1::bigint);
select t.throws('outra transação no mesmo teste é recusada', format('select public.licenca_teste_confirmar(%L, %L, %L, 100, 1)', (current_setting('t151.v')::jsonb)->>'id', 'tx-2', 'pix'), 'outra transação');
reset role;
select t.eq('teste ficou pago (pix, R$ 1,00)', (select count(*) from public.licenca_vendas_teste where status = 'pago' and metodo = 'pix' and valor_pago = 100 and transaction_nsu = 'tx-1'), 1::bigint);

-- e NADA comercial mudou
select t.eq('nenhuma fatura criada', (select count(*) from public.billing_invoices), :'faturas_antes'::bigint);
select t.eq('nenhum pedido de licença criado', (select count(*) from public.licenca_pedidos), :'pedidos_antes'::bigint);
select t.eq('nenhuma vaga do lançamento ocupada', (select count(*) from public.licenca_promocao_vagas), :'vagas_antes'::bigint);
select t.ok('nenhuma assinatura mudou (status e período)', (select coalesce(string_agg(id || status || coalesce(periodo_fim::text, '-'), ',' order by id), '') from public.subscriptions) = :'subs_antes');

select t.fim();
rollback;
