-- Histórico de pagamentos recebidos (migration 552): só o admin da plataforma vê; licenças e testes separados;
-- totais do mês no fuso de Brasília; pedido pendente não conta.
begin;
\ir _lib.sql
\ir _fixtures.sql

\o /dev/null
select t.signup('adm152', '{"tipo":"fundador","nome":"Admin 152"}'::jsonb);
insert into public.platform_admins (user_id, papel) values (t.id('adm152'), 'operacao');
insert into public.billing_accounts (id, nome, status) values (public.curriculo_uuid('t152:conta'), 'Conta 152 [TESTE]', 'ativa');
insert into public.subscriptions (id, billing_account_id, plan_id, price_id, status, ciclo)
  select public.curriculo_uuid('t152:assin'), public.curriculo_uuid('t152:conta'), pl.id, pr.id, 'ativa', 'anual'
    from public.billing_plans pl join public.billing_prices pr on pr.plan_id = pl.id
   where pl.chave = 'anual' order by pl.versao desc limit 1;
insert into public.subscription_clubs (subscription_id, club_id) values (public.curriculo_uuid('t152:assin'), t.id('clube_a'));
-- licença paga neste mês (Pix, R$ 220) + uma antiga (cartão, R$ 250, há 2 meses) + uma pendente (não conta)
insert into public.licenca_pedidos (subscription_id, plan_id, price_id, cartao_centavos, pix_centavos, parcelas, status, pago_em, metodo, valor_pago, transaction_nsu, promocao)
  select s.id, s.plan_id, s.price_id, 22000, 22000, 12, 'pago', now(), 'pix', 22000, 'tx-152-a', true from public.subscriptions s where s.id = public.curriculo_uuid('t152:assin');
insert into public.licenca_pedidos (subscription_id, plan_id, price_id, cartao_centavos, pix_centavos, parcelas, status, pago_em, metodo, valor_pago, transaction_nsu)
  select s.id, s.plan_id, s.price_id, 25000, 25000, 12, 'pago', now() - interval '62 days', 'credit_card', 25000, 'tx-152-b' from public.subscriptions s where s.id = public.curriculo_uuid('t152:assin');
insert into public.licenca_pedidos (subscription_id, plan_id, price_id, cartao_centavos, pix_centavos, parcelas, status)
  select s.id, s.plan_id, s.price_id, 25000, 25000, 12, 'pendente' from public.subscriptions s where s.id = public.curriculo_uuid('t152:assin');
-- venda de teste paga (R$ 1)
insert into public.licenca_vendas_teste (club_id, valor_centavos, status, metodo, valor_pago, transaction_nsu, pago_em)
  values (t.id('clube_a'), 100, 'pago', 'pix', 100, 'tx-152-t', now());
\o

select t.como('lider_a');
select t.throws('liderança de clube não vê o histórico', 'select public.admin_pagamentos_recebidos()', 'Sem permissão');
reset role;
select t.como_anon();
select t.throws('anônimo não vê', 'select public.admin_pagamentos_recebidos()', 'permission denied');
reset role;

select t.como('adm152');
select set_config('t152.r', public.admin_pagamentos_recebidos()::text, true);
reset role;
select t.eq('3 pagamentos no histórico (2 licenças + 1 teste; pendente fica de fora)', jsonb_array_length(current_setting('t152.r')::jsonb -> 'itens')::bigint, 3::bigint);
select t.eq('total de licenças = R$ 470,00 (o teste NÃO entra)', ((current_setting('t152.r')::jsonb) #>> '{totais,licencas_total_centavos}')::bigint, 47000::bigint);
select t.eq('2 licenças pagas', ((current_setting('t152.r')::jsonb) #>> '{totais,licencas_quantidade}')::bigint, 2::bigint);
select t.eq('no mês: só a de R$ 220 (a de 2 meses atrás fica fora)', ((current_setting('t152.r')::jsonb) #>> '{totais,licencas_mes_centavos}')::bigint, 22000::bigint);
select t.eq('Pix R$ 220 e cartão R$ 250', ((current_setting('t152.r')::jsonb) #>> '{totais,pix_centavos}')::bigint * 1000000 + ((current_setting('t152.r')::jsonb) #>> '{totais,cartao_centavos}')::bigint, 22000025000::bigint);
select t.eq('testes somam à parte: R$ 1,00 em 1 teste', ((current_setting('t152.r')::jsonb) #>> '{totais,testes_total_centavos}')::bigint * 10 + ((current_setting('t152.r')::jsonb) #>> '{totais,testes_quantidade}')::bigint, 1001::bigint);
select t.eq('o mais recente vem primeiro e mostra o clube e o lançamento',
  (select (x->>'tipo') || '|' || (x->>'promocao') from jsonb_array_elements(current_setting('t152.r')::jsonb -> 'itens') with ordinality e(x, n) where x->>'transacao' = 'tx-152-a'), 'licenca|true');

select t.fim();
rollback;
