-- 552 — HISTÓRICO DE PAGAMENTOS RECEBIDOS no /admin (16/10/2026).
-- Pedido do dono: "onde fica o histórico de pagamento de quanto eu recebi".
-- Só leitura, só administrador da plataforma. Junta os pagamentos CONFIRMADOS pela InfinitePay:
--   · licenças de verdade (licenca_pedidos pagos) — entram nos totais de receita;
--   · vendas de teste (licenca_vendas_teste pagas, migration 551) — aparecem marcadas e somam à parte.
-- Valores BRUTOS pagos pelo cliente (o que a InfinitePay confirmou). A taxa da InfinitePay e o valor líquido ficam no painel dela.
-- "Mês" e "hoje" no fuso de Brasília.
begin;

create or replace function public.admin_pagamentos_recebidos(p_limite int default 200) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_limite int := least(greatest(coalesce(p_limite, 200), 1), 1000);
  v_mes date := date_trunc('month', (now() at time zone 'America/Sao_Paulo'))::date;
  v_itens jsonb; v_totais jsonb;
begin
  perform public._exigir_admin_plataforma();

  with pag as (
    select 'licenca'::text as tipo, o.nome as clube, p.valor_pago::bigint as valor, p.metodo, p.pago_em, p.transaction_nsu as transacao,
           coalesce(p.promocao, false) as promocao
      from public.licenca_pedidos p
      join public.subscription_clubs sc on sc.subscription_id = p.subscription_id
      join public.organizational_units o on o.id = sc.club_id
     where p.status = 'pago' and p.pago_em is not null
    union all
    select 'teste', o.nome, v.valor_pago::bigint, v.metodo, v.pago_em, v.transaction_nsu, false
      from public.licenca_vendas_teste v
      join public.organizational_units o on o.id = v.club_id
     where v.status = 'pago' and v.pago_em is not null
  )
  select
    (select coalesce(jsonb_agg(jsonb_build_object('tipo', tipo, 'clube', clube, 'valor_centavos', valor, 'metodo', metodo,
             'pago_em', pago_em, 'transacao', transacao, 'promocao', promocao) order by pago_em desc), '[]'::jsonb)
       from (select * from pag order by pago_em desc limit v_limite) x),
    jsonb_build_object(
      'licencas_total_centavos', coalesce(sum(valor) filter (where tipo = 'licenca'), 0),
      'licencas_quantidade', count(*) filter (where tipo = 'licenca'),
      'licencas_mes_centavos', coalesce(sum(valor) filter (where tipo = 'licenca' and (pago_em at time zone 'America/Sao_Paulo')::date >= v_mes), 0),
      'licencas_mes_quantidade', count(*) filter (where tipo = 'licenca' and (pago_em at time zone 'America/Sao_Paulo')::date >= v_mes),
      'pix_centavos', coalesce(sum(valor) filter (where tipo = 'licenca' and metodo = 'pix'), 0),
      'cartao_centavos', coalesce(sum(valor) filter (where tipo = 'licenca' and metodo = 'credit_card'), 0),
      'testes_total_centavos', coalesce(sum(valor) filter (where tipo = 'teste'), 0),
      'testes_quantidade', count(*) filter (where tipo = 'teste'))
    into v_itens, v_totais
    from pag;

  return jsonb_build_object('itens', v_itens, 'totais', v_totais, 'gerado_em', now());
end $$;
revoke all on function public.admin_pagamentos_recebidos(int) from public, anon;
grant execute on function public.admin_pagamentos_recebidos(int) to authenticated;

insert into public.migracoes_aplicadas (arquivo) values ('2026-10-16-pagamentos-recebidos.sql') on conflict (arquivo) do nothing;
notify pgrst, 'reload schema';
commit;
