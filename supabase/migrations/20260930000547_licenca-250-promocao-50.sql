-- 547 — R$ 250/ano em ambos os métodos; R$ 220 no primeiro ano dos 50 clubes.
-- Aprovação do dono nesta conversa em 14/10/2026. Preço é congelado no pedido.
-- Uma vaga por clube, somente na primeira contratação paga. Cadastro não ocupa vaga.
-- Link emitido reserva vaga sem expiração automática: não há API homologada de revogação.
-- Nunca reutilizar a vaga enquanto o checkout anterior puder receber pagamento.
begin;

do $$
declare b public.billing_plans; n uuid;
begin
  if exists (select 1 from public.migracoes_aplicadas where arquivo = '2026-10-14-licenca-250-promocao-50.sql') then return; end if;
  select * into b from public.billing_plans where chave='anual' and status='publicado' and ativo order by versao desc limit 1;
  if b.id is null then raise exception 'Licença anual publicada não encontrada.'; end if;
  insert into public.billing_plans(chave,versao,nome,descricao,publico,status,ativo,recursos,limites,provisorio)
    values(b.chave,(select max(versao)+1 from public.billing_plans where chave=b.chave),b.nome,b.descricao,
      b.publico,'publicado',true,b.recursos,b.limites,false) returning id into n;
  insert into public.billing_prices(plan_id,ciclo,valor_centavos,provisorio,metadata)
    values(n,'anual',25000,false,jsonb_build_object('pix_centavos',25000,'parcelas_cartao',12,'parcela_centavos',2083));
  insert into public.migracoes_aplicadas(arquivo) values('2026-10-14-licenca-250-promocao-50.sql');
end $$;

alter table public.licenca_pedidos add column if not exists promocao boolean not null default false;
create table if not exists public.licenca_promocao_vagas (
  numero int primary key check (numero between 1 and 50),
  club_id uuid not null unique references public.organizational_units(id) on delete restrict,
  subscription_id uuid not null unique references public.subscriptions(id) on delete restrict,
  pedido_id uuid not null unique references public.licenca_pedidos(id) on delete restrict,
  reservado_em timestamptz not null default now(),
  confirmado_em timestamptz
);
alter table public.licenca_promocao_vagas enable row level security;
revoke all on public.licenca_promocao_vagas from public, anon, authenticated;
-- Serviço pode ler para conciliação; writes ficam nas RPCs de checkout/confirmação.
grant select on public.licenca_promocao_vagas to service_role;

create or replace function public.licenca_promocao_situacao() returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object('limite',50,'valor_centavos',22000,'regular_centavos',25000,
    'confirmados',count(*) filter (where confirmado_em is not null),
    'reservados',count(*) filter (where confirmado_em is null),
    'disponiveis',50-count(*)) from public.licenca_promocao_vagas;
$$;
revoke all on function public.licenca_promocao_situacao() from public;
grant execute on function public.licenca_promocao_situacao() to anon, authenticated;

create or replace function public._licenca_promocao_elegivel(p_assinatura uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select (select count(*) from public.subscription_clubs where subscription_id=p_assinatura)=1
    and not exists (select 1 from public.billing_invoices where subscription_id=p_assinatura and status='paga')
    and not exists (select 1 from public.licenca_pedidos where subscription_id=p_assinatura and status='pago')
    and not exists (select 1 from public.licenca_promocao_vagas v join public.subscription_clubs c on c.club_id=v.club_id
      where c.subscription_id=p_assinatura);
$$;
revoke all on function public._licenca_promocao_elegivel(uuid) from public, anon, authenticated;

create or replace function public.licenca_checkout_contexto() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s public.subscriptions; p public.billing_prices; pedido public.licenca_pedidos; promo jsonb; elegivel boolean;
begin
  select * into s from public.subscriptions where id = public.assinatura_do_clube_id(public.clube_atual_id());
  if s.id is null or not exists (select 1 from public.billing_account_contacts c
    where c.billing_account_id = s.billing_account_id and c.user_id = auth.uid() and c.ativo and c.papel in ('titular', 'financeiro')) then
    return jsonb_build_object('pode_pagar', false);
  end if;
  if s.status = 'cancelada' or (s.provider = 'cortesia' and s.periodo_fim > now() + interval '30 days') or (s.status = 'ativa' and s.periodo_fim > now() + interval '30 days')
    or (select chave from public.billing_plans where id = s.plan_id) <> 'anual' then
    return jsonb_build_object('pode_pagar', false, 'licenca_ativa', s.status = 'ativa' and s.periodo_fim > now());
  end if;
  select pr.* into p from public.billing_prices pr join public.billing_plans pl on pl.id = pr.plan_id
    where pl.chave = 'anual' and pl.publico and pl.ativo and pl.status = 'publicado' and pr.ativo
      and pr.ciclo = 'anual' and pr.moeda = 'BRL' and pr.vigente_de <= now() and (pr.vigente_ate is null or pr.vigente_ate > now())
    order by pl.versao desc, pr.vigente_de desc limit 1;
  if p.id is null then return jsonb_build_object('pode_pagar', false); end if;
  select * into pedido from public.licenca_pedidos where subscription_id = s.id and status = 'pendente';
  promo := public.licenca_promocao_situacao();
  elegivel := public._licenca_promocao_elegivel(s.id);
  if pedido.id is null and elegivel and (promo ->> 'disponiveis')::int > 0 then
    p.valor_centavos := 22000;
    p.metadata := p.metadata || jsonb_build_object('pix_centavos', 22000);
  end if;
  return jsonb_build_object('promocao', case when pedido.id is not null then pedido.promocao else elegivel and (promo ->> 'disponiveis')::int > 0 end,
    'renovacao_centavos', 25000, 'pode_pagar', true, 'subscription_id', s.id, 'price_id', p.id,
    'cartao_centavos', coalesce(pedido.cartao_centavos, p.valor_centavos),
    'pix_centavos', coalesce(pedido.pix_centavos, (p.metadata ->> 'pix_centavos')::bigint, p.valor_centavos),
    'parcelas', coalesce(pedido.parcelas, (p.metadata ->> 'parcelas_cartao')::int, 1),
    'pedido', case when pedido.id is not null then jsonb_build_object('id', pedido.id, 'url', pedido.onde_pagar) end);
end $$;
revoke all on function public.licenca_checkout_contexto() from public, anon;
grant execute on function public.licenca_checkout_contexto() to authenticated;

create or replace function public.licenca_checkout_criar() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare ctx jsonb; s public.subscriptions; p public.billing_prices; o public.licenca_pedidos; clube uuid; vaga int; promocional boolean := false;
begin
  ctx := public.licenca_checkout_contexto();
  if not coalesce((ctx ->> 'pode_pagar')::boolean, false) then raise exception 'Só o responsável financeiro pode pagar uma licença elegível.'; end if;
  select * into s from public.subscriptions where id = (ctx ->> 'subscription_id')::uuid for update;
  -- Ordem de locks compartilhada com a confirmação: assinatura, depois campanha.
  perform pg_catalog.pg_advisory_xact_lock(25020050);
  -- Reavalia depois do lock: pagamento concorrente pode ter renovado a licença.
  ctx := public.licenca_checkout_contexto();
  if not coalesce((ctx ->> 'pode_pagar')::boolean, false) then raise exception 'Esta licença já está regularizada.'; end if;
  select * into o from public.licenca_pedidos where subscription_id = s.id and status = 'pendente';
  if o.id is null then
    select * into p from public.billing_prices where id = (ctx ->> 'price_id')::uuid;
    promocional := coalesce((ctx ->> 'promocao')::boolean, false);
    if promocional then
      select club_id into clube from public.subscription_clubs where subscription_id = s.id;
      select n into vaga from generate_series(1,50) n
        where not exists (select 1 from public.licenca_promocao_vagas v where v.numero = n)
        order by n limit 1;
      if vaga is null then raise exception 'Oferta mudou. Atualize a página antes de pagar.'; end if;
    end if;
    insert into public.licenca_pedidos (subscription_id, plan_id, price_id, cartao_centavos, pix_centavos, parcelas, criado_por, promocao)
    values (s.id, p.plan_id, p.id, (ctx ->> 'cartao_centavos')::bigint, (ctx ->> 'pix_centavos')::bigint,
      (ctx ->> 'parcelas')::int, auth.uid(), promocional) returning * into o;
    if promocional then
      insert into public.licenca_promocao_vagas(numero, club_id, subscription_id, pedido_id)
        values (vaga, clube, s.id, o.id);
    end if;
  end if;
  return jsonb_build_object('promocao', o.promocao, 'id', o.id, 'url', o.onde_pagar, 'cartao_centavos', o.cartao_centavos,
    'pix_centavos', o.pix_centavos, 'parcelas', o.parcelas);
end $$;
revoke all on function public.licenca_checkout_criar() from public, anon;
grant execute on function public.licenca_checkout_criar() to authenticated;

-- Guarda a implementação validada da 543, sem expor um caminho que ignore a campanha.
do $$ begin
  if to_regprocedure('public._licenca_infinitepay_confirmar_543(uuid,text,text,bigint,integer)') is null then
    alter function public.licenca_infinitepay_confirmar(uuid,text,text,bigint,int) rename to _licenca_infinitepay_confirmar_543;
  end if;
end $$;
revoke all on function public._licenca_infinitepay_confirmar_543(uuid,text,text,bigint,int) from public, anon, authenticated, service_role;

create or replace function public.licenca_infinitepay_confirmar(p_pedido uuid,p_transacao text,p_metodo text,p_valor bigint,p_parcelas int) returns jsonb
language plpgsql security definer set search_path='' as $$
declare o public.licenca_pedidos; resultado jsonb;
begin
  select * into o from public.licenca_pedidos where id=p_pedido;
  if o.id is null then raise exception 'Pedido inexistente.'; end if;
  perform 1 from public.subscriptions where id=o.subscription_id for update;
  perform pg_catalog.pg_advisory_xact_lock(25020050);
  if o.promocao and not exists(select 1 from public.licenca_promocao_vagas where pedido_id=o.id) then
    raise exception 'Pedido promocional sem vaga: conciliação necessária.';
  end if;
  resultado := public._licenca_infinitepay_confirmar_543(p_pedido,p_transacao,p_metodo,p_valor,p_parcelas);
  if o.promocao then
    update public.licenca_promocao_vagas set confirmado_em=coalesce(confirmado_em,now()) where pedido_id=o.id;
  end if;
  return resultado;
end $$;
revoke all on function public.licenca_infinitepay_confirmar(uuid,text,text,bigint,int) from public,anon,authenticated;
grant execute on function public.licenca_infinitepay_confirmar(uuid,text,text,bigint,int) to service_role;
select public._manutencao_instalar_guarda();
notify pgrst,'reload schema';
commit;
