-- Pedidos de licença da PLATAFORMA; não altera mensalidades dos membros.
-- Liberação real depende da Edge Function e da configuração/homologação da InfinitePay.
insert into public.billing_providers (chave, nome, tipo) values ('infinitepay', 'InfinitePay', 'externo') on conflict (chave) do nothing;
create table if not exists public.licenca_pedidos (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references public.subscriptions(id),
  plan_id uuid not null references public.billing_plans(id),
  price_id uuid not null references public.billing_prices(id),
  cartao_centavos bigint not null check (cartao_centavos > 0),
  pix_centavos bigint not null check (pix_centavos > 0 and pix_centavos <= cartao_centavos),
  parcelas int not null check (parcelas between 1 and 12),
  status text not null default 'pendente' check (status in ('pendente', 'pago')),
  onde_pagar text,                   -- link do checkout externo (o nome evita o catálogo de caminhos de arquivo do GC de Storage)
  transaction_nsu text unique,
  criado_por uuid references auth.users(id) on delete set null,   -- sem ON DELETE a exclusão de usuário morreria por FK (teste 63)
  created_at timestamptz not null default now(),
  pago_em timestamptz,
  metodo text,
  valor_pago bigint
);
create unique index if not exists licenca_um_pedido_pendente on public.licenca_pedidos(subscription_id) where status = 'pendente';
alter table public.licenca_pedidos enable row level security;
revoke all on public.licenca_pedidos from anon, authenticated;
grant all on public.licenca_pedidos to service_role;

-- Só o contato financeiro da conta pode comprar; papel de membro/diretoria não basta.
create or replace function public.licenca_checkout_contexto() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s public.subscriptions; p public.billing_prices; pedido public.licenca_pedidos;
begin
  select * into s from public.subscriptions where id = public.assinatura_do_clube_id(public.clube_atual_id());
  if s.id is null or not exists (select 1 from public.billing_account_contacts c
    where c.billing_account_id = s.billing_account_id and c.user_id = auth.uid() and c.ativo and c.papel in ('titular', 'financeiro')) then
    return jsonb_build_object('pode_pagar', false);
  end if;
  if s.status = 'cancelada' or (s.provider = 'cortesia' and s.periodo_fim > now() + interval '30 days') or (s.status = 'ativa' and s.periodo_fim > now() + interval '30 days')
    or (select chave from public.billing_plans where id = s.plan_id) <> 'anual' then
    return jsonb_build_object('pode_pagar', false);
  end if;
  select pr.* into p from public.billing_prices pr join public.billing_plans pl on pl.id = pr.plan_id
    where pl.chave = 'anual' and pl.publico and pl.ativo and pl.status = 'publicado' and pr.ativo
      and pr.ciclo = 'anual' and pr.moeda = 'BRL' and pr.vigente_de <= now() and (pr.vigente_ate is null or pr.vigente_ate > now())
    order by pl.versao desc, pr.vigente_de desc limit 1;
  if p.id is null then return jsonb_build_object('pode_pagar', false); end if;
  select * into pedido from public.licenca_pedidos where subscription_id = s.id and status = 'pendente';
  return jsonb_build_object('pode_pagar', true, 'subscription_id', s.id, 'price_id', p.id,
    'cartao_centavos', coalesce(pedido.cartao_centavos, p.valor_centavos),
    'pix_centavos', coalesce(pedido.pix_centavos, (p.metadata ->> 'pix_centavos')::bigint, p.valor_centavos),
    'parcelas', coalesce(pedido.parcelas, (p.metadata ->> 'parcelas_cartao')::int, 1),
    'pedido', case when pedido.id is not null then jsonb_build_object('id', pedido.id, 'url', pedido.onde_pagar) end);
end $$;
revoke all on function public.licenca_checkout_contexto() from public, anon;
grant execute on function public.licenca_checkout_contexto() to authenticated;

create or replace function public.licenca_checkout_criar() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare ctx jsonb; s public.subscriptions; p public.billing_prices; o public.licenca_pedidos;
begin
  ctx := public.licenca_checkout_contexto();
  if not coalesce((ctx ->> 'pode_pagar')::boolean, false) then raise exception 'Só o responsável financeiro pode pagar uma licença elegível.'; end if;
  select * into s from public.subscriptions where id = (ctx ->> 'subscription_id')::uuid for update;
  -- Reavalia depois do lock: pagamento concorrente pode ter renovado a licença.
  ctx := public.licenca_checkout_contexto();
  if not coalesce((ctx ->> 'pode_pagar')::boolean, false) then raise exception 'Esta licença já está regularizada.'; end if;
  select * into o from public.licenca_pedidos where subscription_id = s.id and status = 'pendente';
  if o.id is null then
    select * into p from public.billing_prices where id = (ctx ->> 'price_id')::uuid;
    insert into public.licenca_pedidos (subscription_id, plan_id, price_id, cartao_centavos, pix_centavos, parcelas, criado_por)
    values (s.id, p.plan_id, p.id, (ctx ->> 'cartao_centavos')::bigint, (ctx ->> 'pix_centavos')::bigint,
      (ctx ->> 'parcelas')::int, auth.uid()) returning * into o;
  end if;
  return jsonb_build_object('id', o.id, 'url', o.onde_pagar, 'cartao_centavos', o.cartao_centavos,
    'pix_centavos', o.pix_centavos, 'parcelas', o.parcelas);
end $$;
revoke all on function public.licenca_checkout_criar() from public, anon;
grant execute on function public.licenca_checkout_criar() to authenticated;

create or replace function public.licenca_pedido_consultar(p_pedido uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare o public.licenca_pedidos;
begin
  select p.* into o from public.licenca_pedidos p join public.subscriptions s on s.id = p.subscription_id
    join public.billing_account_contacts c on c.billing_account_id = s.billing_account_id
    where p.id = p_pedido and c.user_id = auth.uid() and c.ativo and c.papel in ('titular', 'financeiro');
  if o.id is null then raise exception 'Pedido indisponível para esta conta.'; end if;
  return jsonb_build_object('id', o.id, 'status', o.status);
end $$;
revoke all on function public.licenca_pedido_consultar(uuid) from public, anon;
grant execute on function public.licenca_pedido_consultar(uuid) to authenticated;

-- Só a Edge Function com confirmação consultada no PROVEDOR chama esta RPC.
-- Nunca confiar em "paid" enviado pelo navegador ou pelo corpo público do webhook.
create or replace function public.licenca_infinitepay_confirmar(p_pedido uuid, p_transacao text, p_metodo text, p_valor bigint, p_parcelas int) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare o public.licenca_pedidos; s public.subscriptions; inicio timestamptz; fim timestamptz; inv uuid;
begin
  select * into o from public.licenca_pedidos where id = p_pedido;
  if o.id is null then raise exception 'Pedido inexistente.'; end if;
  select * into s from public.subscriptions where id = o.subscription_id for update;
  select * into o from public.licenca_pedidos where id = p_pedido for update;
  if o.status = 'pago' then
    if o.transaction_nsu <> p_transacao then raise exception 'Pedido já pago com outra transação.'; end if;
    return jsonb_build_object('ok', true, 'duplicado', true);
  end if;
  if s.status = 'cancelada' then raise exception 'Assinatura cancelada: pagamento exige conciliação manual.'; end if;
  if p_transacao is null or length(p_transacao) not between 1 and 120 or p_metodo not in ('pix', 'credit_card')
    or p_metodo is null or p_valor is null or p_parcelas is null then raise exception 'Confirmação inválida.'; end if;
  if (p_metodo = 'pix' and (p_valor <> o.pix_centavos or p_parcelas <> 1))
    or (p_metodo = 'credit_card' and (p_valor <> o.cartao_centavos or p_parcelas not between 1 and o.parcelas)) then
    raise exception 'Valor ou parcelamento divergente: conciliação manual necessária.';
  end if;
  inicio := case when s.status = 'ativa' then greatest(now(), s.periodo_fim) else now() end;
  fim := inicio + interval '1 year';
  -- Evita substituir uma fatura anterior da mesma competência.
  if exists (select 1 from public.billing_invoices where subscription_id = s.id and competencia = inicio::date) then
    raise exception 'Já existe fatura nesta competência: conciliação manual necessária.';
  end if;
  insert into public.billing_invoices (subscription_id, competencia, valor_centavos, vence_em, status, pago_em, provider, provider_ref, metadata)
    values (s.id, inicio::date, p_valor, current_date, 'paga', now(), 'infinitepay', p_transacao,
      jsonb_build_object('pedido', o.id, 'metodo', p_metodo, 'parcelas', p_parcelas)) returning id into inv;
  update public.subscriptions set plan_id = o.plan_id, price_id = o.price_id, ciclo = 'anual', provider = 'infinitepay',
    periodo_inicio = inicio, periodo_fim = fim, updated_at = now() where id = s.id;
  perform public._assinatura_transicionar(s.id, 'ativa', 'Licença anual paga pela InfinitePay', 'webhook', jsonb_build_object('pedido', o.id));
  insert into public.billing_events (provider, evento_externo_id, tipo, payload, subscription_id, invoice_id, status, processado_em)
    values ('infinitepay', p_transacao, 'pagamento_aprovado', jsonb_build_object('pedido', o.id, 'valor_centavos', p_valor,
      'metodo', p_metodo), s.id, inv, 'processado', now());
  update public.licenca_pedidos set status = 'pago', transaction_nsu = p_transacao, pago_em = now(), metodo = p_metodo, valor_pago = p_valor where id = o.id;
  return jsonb_build_object('ok', true, 'duplicado', false, 'periodo_fim', fim);
end $$;
revoke all on function public.licenca_infinitepay_confirmar(uuid, text, text, bigint, int) from public, anon, authenticated;
grant execute on function public.licenca_infinitepay_confirmar(uuid, text, text, bigint, int) to service_role;
-- toda tabela nova entra na guarda do modo manutenção (teste 100)
select public._manutencao_instalar_guarda();

insert into public.migracoes_aplicadas (arquivo) values ('2026-10-03-checkout-infinitepay.sql') on conflict (arquivo) do nothing;
notify pgrst, 'reload schema';
