-- PAGAMENTO — base para gateway (migration 540): nasce DESLIGADA; só a diretoria abre a fatura; valor vem do catálogo; reaproveita a fatura;
-- webhook idempotente estende a licença pelo ciclo; vincular só service_role; vencimento automático; nada vaza para quem não é diretoria.
begin;
\ir _lib.sql
\ir _fixtures.sql

\o /dev/null
insert into public.billing_accounts (id, nome, status) values (public.curriculo_uuid('t145:conta'), 'Conta 145 [TESTE]', 'ativa');
insert into public.subscriptions (id, billing_account_id, plan_id, status, ciclo, periodo_fim)
  values (public.curriculo_uuid('t145:assin'), public.curriculo_uuid('t145:conta'),
          (select id from public.billing_plans where chave = 'anual' order by versao desc limit 1), 'pagamento_pendente', 'anual', null);
insert into public.subscription_clubs (subscription_id, club_id) values (public.curriculo_uuid('t145:assin'), t.id('clube_a'));
create function t.sub145() returns uuid language sql as $$ select public.curriculo_uuid('t145:assin') $$;
grant execute on function t.sub145() to public;
\o

-- ==================== desligada por padrão ====================
select t.eq('nenhum provedor nasce com checkout habilitado', (select count(*) from public.billing_providers where checkout_habilitado), 0::bigint);
select t.como('lider_a');
select t.eq('pagamento_disponivel() = false', public.pagamento_disponivel()::text, 'false');
select t.throws('com o pagamento desligado, a diretoria NÃO abre fatura', $$select public.pagamento_fatura_preparar('pix')$$, 'ainda não está disponível');

-- liga o provedor de teste (só o banco/admin faz isso)
reset role;
update public.billing_providers set checkout_habilitado = true where chave = 'mock';
select t.como('lider_a');
select t.eq('pagamento_disponivel() = true depois de habilitar', public.pagamento_disponivel()::text, 'true');

-- ==================== quem pode abrir fatura ====================
select t.como('membro_a');
select t.throws('membro comum NÃO abre fatura', $$select public.pagamento_fatura_preparar('pix')$$, 'Sem permissão');
select t.throws('membro comum NÃO lista faturas', $$select public.faturas_do_clube()$$, 'Sem permissão');
select t.como_anon();
select t.throws('anon não executa pagamento_fatura_preparar', $$select public.pagamento_fatura_preparar('pix')$$, 'permission denied');
select t.throws('anon não executa pagamento_disponivel', $$select public.pagamento_disponivel()$$, 'permission denied');
reset role;
select t.como('lider_a');
select t.throws('forma inválida é recusada', $$select public.pagamento_fatura_preparar('boleto')$$, 'Forma de pagamento inválida');

-- ==================== a fatura vem do catálogo ====================
select set_config('t145.f', public.pagamento_fatura_preparar('pix')::text, true) is not null;
reset role;
select t.eq('fatura aberta de Pix com o valor do Pix do plano',
  (current_setting('t145.f')::json ->> 'valor_centavos')::bigint,
  coalesce(nullif((select metadata ->> 'pix_centavos' from public.billing_plans where chave = 'anual' order by versao desc limit 1), '')::bigint,
           (select pr.valor_centavos from public.billing_prices pr join public.billing_plans p on p.id = pr.plan_id where p.chave = 'anual' and pr.ciclo = 'anual' and pr.ativo order by pr.vigente_de desc limit 1)));
select t.eq('a fatura é do provedor habilitado', current_setting('t145.f')::json ->> 'provedor', 'mock');
select t.eq('só existe uma fatura', (select count(*) from public.billing_invoices where subscription_id = t.sub145()), 1::bigint);
select t.como('lider_a');
select set_config('t145.f2', public.pagamento_fatura_preparar('pix')::text, true) is not null;
reset role;
select t.eq('chamar de novo REAPROVEITA a mesma fatura', current_setting('t145.f2')::json ->> 'fatura_id', current_setting('t145.f')::json ->> 'fatura_id');
select t.como('lider_a');
select set_config('t145.f3', public.pagamento_fatura_preparar('cartao')::text, true) is not null;
reset role;
select t.eq('trocar para cartão muda a forma na MESMA fatura', (select forma from public.billing_invoices where subscription_id = t.sub145()), 'cartao');
select t.eq('...e continua sendo uma só', (select count(*) from public.billing_invoices where subscription_id = t.sub145()), 1::bigint);

-- ==================== vincular: só service_role ====================
select t.como('lider_a');
select t.throws('diretoria NÃO vincula cobrança (só a Edge Function)', format($q$select public.pagamento_fatura_vincular(%L, 'mock', 'ref1')$q$, current_setting('t145.f')::json ->> 'fatura_id'), 'permission denied');
reset role;
select public.pagamento_fatura_vincular((current_setting('t145.f')::json ->> 'fatura_id')::uuid, 'mock', 'mock_cob_145', 'https://pague.exemplo/145', '000201MOCK', current_date + 3) is not null;
select t.eq('cobrança vinculada (ref, link e Pix guardados)', (select provider_ref || '|' || onde_pagar || '|' || pix_copia_cola from public.billing_invoices where subscription_id = t.sub145()), 'mock_cob_145|https://pague.exemplo/145|000201MOCK');
select t.throws('fatura inexistente não vincula', $$select public.pagamento_fatura_vincular(gen_random_uuid(), 'mock', 'x')$$, 'não encontrada');

-- diretoria vê a fatura com o link
select t.como('lider_a');
select t.eq('diretoria lista a própria fatura com link e Pix', (public.faturas_do_clube() -> 0 ->> 'checkout_url') || '|' || (public.faturas_do_clube() -> 0 ->> 'pix_copia_cola'), 'https://pague.exemplo/145|000201MOCK');
reset role;

-- ==================== webhook: pagar estende a licença; reentrega não duplica ====================
select public.billing_webhook_receber('mock', 'ev145-pago', 'pagamento_aprovado', '{"cobranca_ref":"mock_cob_145"}'::jsonb) is not null;
select t.eq('assinatura ativa', (select status from public.subscriptions where id = t.sub145()), 'ativa');
select t.eq('fatura paga', (select status from public.billing_invoices where subscription_id = t.sub145()), 'paga');
select t.ok('licença anual passa a valer ~12 meses', (select periodo_fim between now() + interval '364 days' and now() + interval '366 days' from public.subscriptions where id = t.sub145()));
select t.eq('reentrega do MESMO evento é duplicado', (public.billing_webhook_receber('mock', 'ev145-pago', 'pagamento_aprovado', '{"cobranca_ref":"mock_cob_145"}'::jsonb) ->> 'duplicado'), 'true');
select t.ok('...e o período continua ~12 meses (não 24)', (select periodo_fim < now() + interval '366 days' from public.subscriptions where id = t.sub145()));
select t.como('lider_a');
select t.throws('paga a licença do período, não abre outra fatura', $$select public.pagamento_fatura_preparar('pix')$$, 'já está paga');
reset role;

-- ==================== vencimento automático ====================
update public.billing_invoices set status = 'aberta', pago_em = null, vence_em = current_date - 20 where subscription_id = t.sub145();
update public.subscriptions set status = 'ativa', periodo_fim = now() + interval '10 days' where id = t.sub145();
select t.ok('faturas_vencidas_avaliar roda e conta a assinatura', public.faturas_vencidas_avaliar() >= 1);
select t.eq('fatura aberta vencida virou vencida', (select status from public.billing_invoices where subscription_id = t.sub145()), 'vencida');
select t.ok('a assinatura avançou além de ativa (carência/inadimplência)', (select status from public.subscriptions where id = t.sub145()) <> 'ativa');
select t.ok('o cron do vencimento existe', exists (select 1 from cron.job where jobname = 'avaliar-faturas-vencidas'));
select t.como('lider_a');
select t.throws('faturas_vencidas_avaliar não é chamável por usuário', $$select public.faturas_vencidas_avaliar()$$, 'permission denied');
reset role;
select t.fim();
rollback;
