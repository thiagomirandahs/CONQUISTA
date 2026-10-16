-- 551 — VENDA DE TESTE da cobrança online (16/10/2026).
-- Pedido do dono: testar o pagamento de verdade com R$ 1,00 antes de ligar a cobrança para os clubes.
--
-- O teste percorre o caminho REAL (link da InfinitePay → pagamento → webhook → consulta payment_check → valor exato),
-- mas fica numa tabela SEPARADA dos pedidos de licença, de propósito:
--   · não aparece na tela de pagamento do clube (o checkout lê só licenca_pedidos);
--   · não ocupa vaga do lançamento nem tira o clube da promoção (_licenca_promocao_elegivel lê só licenca_pedidos);
--   · confirmado, NÃO ativa licença, NÃO cria fatura e NÃO mexe na assinatura: só marca o teste como pago.
-- Funciona com a cobrança DESLIGADA (o interruptor da 550 vale para pagamentos de verdade).
-- Só o administrador da plataforma cria e lista; só o serviço (Edge Function) confirma.
begin;

create table if not exists public.licenca_vendas_teste (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.organizational_units(id) on delete restrict,
  valor_centavos int not null check (valor_centavos between 100 and 1000),   -- R$ 1,00 a R$ 10,00
  status text not null default 'pendente' check (status in ('pendente', 'pago')),
  onde_pagar text,                   -- link do checkout externo (o nome evita o catálogo de caminhos de arquivo do GC de Storage)
  transaction_nsu text unique,
  metodo text check (metodo in ('pix', 'credit_card')),
  valor_pago int,
  criado_por uuid references auth.users(id) on delete set null,
  criado_em timestamptz not null default now(),
  pago_em timestamptz
);
create index if not exists licenca_vendas_teste_criado_em_idx on public.licenca_vendas_teste (criado_em desc);
alter table public.licenca_vendas_teste enable row level security;
revoke all on public.licenca_vendas_teste from public, anon, authenticated;
grant select, update on public.licenca_vendas_teste to service_role;

-- Admin cria o teste para um clube. Devolve o id (vira o order_nsu do link) e o valor.
create or replace function public.admin_licenca_teste_criar(p_club_id uuid, p_valor_centavos int default 100) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_admin uuid := public._exigir_admin_plataforma(); v public.licenca_vendas_teste;
begin
  if p_club_id is null or not exists (select 1 from public.organizational_units where id = p_club_id and type = 'clube') then
    raise exception 'Escolha um clube.';
  end if;
  if p_valor_centavos is null or p_valor_centavos not between 100 and 1000 then
    raise exception 'O valor do teste vai de R$ 1,00 a R$ 10,00.';
  end if;
  if (select count(*) from public.licenca_vendas_teste where criado_em > now() - interval '1 day') >= 20 then
    raise exception 'Muitos testes hoje (máximo 20 por dia).';
  end if;
  insert into public.licenca_vendas_teste (club_id, valor_centavos, criado_por) values (p_club_id, p_valor_centavos, v_admin)
    returning * into v;
  perform public._admin_auditar('licenca_teste_criar', 'club', p_club_id,
    jsonb_build_object('venda_teste_id', v.id, 'valor_centavos', v.valor_centavos));
  return jsonb_build_object('id', v.id, 'valor_centavos', v.valor_centavos);
end $$;
revoke all on function public.admin_licenca_teste_criar(uuid, int) from public, anon;
grant execute on function public.admin_licenca_teste_criar(uuid, int) to authenticated;

-- Admin vê os últimos testes (sem dado de ninguém: clube, valor, situação, método).
create or replace function public.admin_licenca_teste_listar() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public._exigir_admin_plataforma();
  return coalesce((select jsonb_agg(jsonb_build_object('id', v.id, 'clube', o.nome, 'valor_centavos', v.valor_centavos,
      'status', v.status, 'metodo', v.metodo, 'valor_pago', v.valor_pago, 'tem_link', v.onde_pagar is not null,
      'criado_em', v.criado_em, 'pago_em', v.pago_em) order by v.criado_em desc)
    from (select * from public.licenca_vendas_teste order by criado_em desc limit 10) v
    join public.organizational_units o on o.id = v.club_id), '[]'::jsonb);
end $$;
revoke all on function public.admin_licenca_teste_listar() from public, anon;
grant execute on function public.admin_licenca_teste_listar() to authenticated;

-- Confirmação (só serviço): exige o valor EXATO e 1 parcela; não ativa nada. Repetida com a mesma transação = idempotente.
create or replace function public.licenca_teste_confirmar(p_id uuid, p_transacao text, p_metodo text, p_valor bigint, p_parcelas int) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v public.licenca_vendas_teste;
begin
  select * into v from public.licenca_vendas_teste where id = p_id for update;
  if v.id is null then raise exception 'Teste inexistente.'; end if;
  if v.status = 'pago' then
    if v.transaction_nsu <> p_transacao then raise exception 'Teste já pago com outra transação.'; end if;
    return jsonb_build_object('ok', true, 'teste', true, 'duplicado', true);
  end if;
  if p_transacao is null or length(p_transacao) not between 1 and 120 or p_metodo not in ('pix', 'credit_card')
    or p_valor is distinct from v.valor_centavos::bigint or p_parcelas is distinct from 1 then
    raise exception 'Valor ou parcelamento divergente no teste.';
  end if;
  update public.licenca_vendas_teste set status = 'pago', transaction_nsu = p_transacao, metodo = p_metodo,
    valor_pago = p_valor, pago_em = now() where id = v.id;
  return jsonb_build_object('ok', true, 'teste', true, 'duplicado', false);
end $$;
revoke all on function public.licenca_teste_confirmar(uuid, text, text, bigint, int) from public, anon, authenticated;
grant execute on function public.licenca_teste_confirmar(uuid, text, text, bigint, int) to service_role;

select public._manutencao_instalar_guarda();
insert into public.migracoes_aplicadas (arquivo) values ('2026-10-16-licenca-venda-de-teste.sql') on conflict (arquivo) do nothing;
notify pgrst, 'reload schema';
commit;
