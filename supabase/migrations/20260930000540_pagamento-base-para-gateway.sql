-- =============================================================================
--  540 — PAGAMENTO: base para plugar QUALQUER gateway (nasce DESLIGADA — nada muda para ninguém até alguém habilitar um provedor)
--
--  O motor comercial (assinaturas, faturas, webhook idempotente, provedor mock) já existia desde a 048. Faltava a PONTA DO CHECKOUT.
--  Esta migration adiciona só o que o banco precisa para o fluxo "diretoria paga a licença do clube":
--    * billing_providers.checkout_habilitado — interruptor por provedor (padrão FALSO em todos, inclusive o mock);
--    * billing_invoices: onde_pagar, pix_copia_cola, forma ('pix'|'cartao');
--    * pagamento_disponivel()            — o front pergunta se o botão "Pagar" deve aparecer;
--    * pagamento_fatura_preparar(forma)  — a DIRETORIA do clube abre (ou reaproveita) a fatura da licença; o valor vem de billing_prices;
--    * pagamento_fatura_vincular(...)    — SÓ service_role (Edge Function): guarda a cobrança criada no gateway (id, link, Pix copia-e-cola);
--    * faturas_do_clube()                — a diretoria vê as próprias faturas (sem dados da conta/cobrança do cliente);
--    * billing_webhook_receber           — ao PAGAR, a licença passa a valer 12 meses (anual) ou 1 mês (mensal) a partir do fim do período vigente;
--    * faturas_vencidas_avaliar() + cron — faturas abertas vencidas fazem a assinatura avançar (pendente -> inadimplente -> suspensa) sozinhas.
--
--  Segurança: tudo security definer com search_path ''; o clube é o clube_atual_id() validado no servidor; só diretoria
--  (pode_administrar_clube) abre fatura; vincular/webhook só service_role; anon não executa nada daqui.
-- =============================================================================

alter table public.billing_providers add column if not exists checkout_habilitado boolean not null default false;
alter table public.billing_invoices add column if not exists onde_pagar text;
alter table public.billing_invoices add column if not exists pix_copia_cola text;
alter table public.billing_invoices add column if not exists forma text check (forma is null or forma in ('pix', 'cartao'));

-- ---------------------------------------------------------------- o botão "Pagar" deve aparecer?
create or replace function public.pagamento_disponivel() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.billing_providers where ativo and checkout_habilitado);
$$;
revoke all on function public.pagamento_disponivel() from public, anon;
grant execute on function public.pagamento_disponivel() to authenticated;

-- ---------------------------------------------------------------- abre (ou reaproveita) a fatura da licença do clube
create or replace function public.pagamento_fatura_preparar(p_forma text default 'pix') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_club uuid := public.clube_atual_id(); v_forma text := lower(coalesce(nullif(btrim(p_forma), ''), 'pix'));
  v_sub public.subscriptions; v_plan public.billing_plans; v_preco public.billing_prices; v_prov text;
  v_valor bigint; v_comp date := date_trunc('month', current_date)::date; v_inv public.billing_invoices; v_venc date;
begin
  if auth.uid() is null or v_club is null then raise exception 'Sessão expirada.'; end if;
  if not public.pode_administrar_clube(v_club) then raise exception 'Sem permissão: só a diretoria paga a licença do clube.'; end if;
  if v_forma not in ('pix', 'cartao') then raise exception 'Forma de pagamento inválida (use pix ou cartao).'; end if;

  select chave into v_prov from public.billing_providers where ativo and checkout_habilitado order by chave limit 1;
  if v_prov is null then raise exception 'O pagamento online ainda não está disponível. Fale com a administração.'; end if;

  select * into v_sub from public.subscriptions where id = public.assinatura_do_clube_id(v_club);
  if not found then raise exception 'Este clube não está vinculado a nenhuma licença.'; end if;
  if v_sub.status = 'cancelada' then raise exception 'Licença cancelada: contrate uma nova.'; end if;
  select * into v_plan from public.billing_plans where id = v_sub.plan_id;

  select * into v_preco from public.billing_prices
   where plan_id = v_sub.plan_id and ciclo = v_sub.ciclo and ativo and vigente_de <= now() and (vigente_ate is null or vigente_ate > now())
   order by vigente_de desc limit 1;
  if not found then raise exception 'Sem preço vigente para este plano.'; end if;
  -- Pix pode ter preço próprio (metadata do plano à venda guarda pix_centavos); o cartão usa o valor cheio.
  v_valor := case when v_forma = 'pix'
                  then coalesce(nullif((select (p.metadata ->> 'pix_centavos') from public.billing_plans p where p.id = v_sub.plan_id), '')::bigint, v_preco.valor_centavos)
                  else v_preco.valor_centavos end;
  v_venc := current_date + 3;

  select * into v_inv from public.billing_invoices where subscription_id = v_sub.id and competencia = v_comp;
  if found then
    if v_inv.status = 'paga' then raise exception 'A licença deste período já está paga.'; end if;
    if v_inv.status in ('cancelada', 'reembolsada') then raise exception 'Fatura do período encerrada: fale com a administração.'; end if;
    -- reaproveita a fatura aberta/vencida; se a forma ou o valor mudou, zera o link para o gateway criar outra cobrança
    if v_inv.forma is distinct from v_forma or v_inv.valor_centavos <> v_valor then
      update public.billing_invoices
         set forma = v_forma, valor_centavos = v_valor, vence_em = v_venc, status = 'aberta', provider = v_prov,
             provider_ref = null, onde_pagar = null, pix_copia_cola = null, updated_at = now()
       where id = v_inv.id returning * into v_inv;
    end if;
  else
    insert into public.billing_invoices (subscription_id, competencia, valor_centavos, moeda, vence_em, provider, forma)
    values (v_sub.id, v_comp, v_valor, v_preco.moeda, v_venc, v_prov, v_forma) returning * into v_inv;
  end if;

  return jsonb_build_object('fatura_id', v_inv.id, 'valor_centavos', v_inv.valor_centavos, 'moeda', v_inv.moeda, 'forma', v_inv.forma,
    'vence_em', v_inv.vence_em, 'provedor', v_prov, 'descricao', 'Licença ' || v_plan.nome || ' (' || v_sub.ciclo || ')',
    'checkout_url', v_inv.onde_pagar, 'pix_copia_cola', v_inv.pix_copia_cola, 'provider_ref', v_inv.provider_ref,
    'clube_id', v_club, 'subscription_id', v_sub.id);
end;
$$;
revoke all on function public.pagamento_fatura_preparar(text) from public, anon;
grant execute on function public.pagamento_fatura_preparar(text) to authenticated;

-- ---------------------------------------------------------------- a Edge Function guarda o que o gateway devolveu
create or replace function public.pagamento_fatura_vincular(
  p_fatura uuid, p_provider text, p_ref text, p_checkout_url text default null, p_pix_copia_cola text default null, p_vence_em date default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_inv public.billing_invoices;
begin
  if p_ref is null or btrim(p_ref) = '' then raise exception 'Referência da cobrança é obrigatória.'; end if;
  if not exists (select 1 from public.billing_providers where chave = p_provider and ativo) then
    raise exception 'Provedor de pagamento desconhecido ou inativo: %.', p_provider;
  end if;
  update public.billing_invoices
     set provider = p_provider, provider_ref = p_ref, onde_pagar = p_checkout_url, pix_copia_cola = p_pix_copia_cola,
         vence_em = coalesce(p_vence_em, vence_em), updated_at = now()
   where id = p_fatura and status in ('aberta', 'vencida')
   returning * into v_inv;
  if not found then raise exception 'Fatura não encontrada ou já encerrada.'; end if;
  update public.subscriptions set provider = p_provider, updated_at = now() where id = v_inv.subscription_id and status <> 'cancelada';
  return jsonb_build_object('ok', true, 'fatura_id', v_inv.id);
end;
$$;
revoke all on function public.pagamento_fatura_vincular(uuid, text, text, text, text, date) from public, anon, authenticated;
grant execute on function public.pagamento_fatura_vincular(uuid, text, text, text, text, date) to service_role;

-- ---------------------------------------------------------------- o que a diretoria vê das próprias faturas
create or replace function public.faturas_do_clube() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_club uuid := public.clube_atual_id();
begin
  if auth.uid() is null or v_club is null then raise exception 'Sessão expirada.'; end if;
  if not public.pode_administrar_clube(v_club) then raise exception 'Sem permissão.'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', i.id, 'competencia', i.competencia, 'valor_centavos', i.valor_centavos, 'moeda', i.moeda,
             'status', i.status, 'forma', i.forma, 'vence_em', i.vence_em, 'pago_em', i.pago_em,
             'checkout_url', case when i.status in ('aberta', 'vencida') then i.onde_pagar end,
             'pix_copia_cola', case when i.status in ('aberta', 'vencida') then i.pix_copia_cola end) order by i.competencia desc)
      from public.billing_invoices i where i.subscription_id = public.assinatura_do_clube_id(v_club)), '[]'::jsonb);
end;
$$;
revoke all on function public.faturas_do_clube() from public, anon;
grant execute on function public.faturas_do_clube() to authenticated;

-- ---------------------------------------------------------------- webhook: pagar = a licença passa a valer pelo ciclo
-- (cópia da função da 048 com UMA mudança, no ramo 'pagamento_aprovado'; o resto é idêntico)
create or replace function public.billing_webhook_receber(
  p_provider text, p_evento_id text, p_tipo text, p_payload jsonb default '{}'::jsonb
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_ev_id uuid; v_ja record; v_sub public.subscriptions; v_inv public.billing_invoices;
        v_res jsonb := '{}'::jsonb; v_status text := 'processado';
begin
  if p_provider is null or p_evento_id is null or p_tipo is null then
    raise exception 'Webhook inválido: provedor, id do evento e tipo são obrigatórios.';
  end if;
  if not exists (select 1 from public.billing_providers where chave = p_provider and ativo) then
    raise exception 'Provedor de pagamento desconhecido ou inativo: %.', p_provider;
  end if;

  insert into public.billing_events (provider, evento_externo_id, tipo, payload)
  values (p_provider, p_evento_id, p_tipo, coalesce(p_payload, '{}'::jsonb))
  on conflict (provider, evento_externo_id) do nothing
  returning id into v_ev_id;

  if v_ev_id is null then
    select * into v_ja from public.billing_events where provider = p_provider and evento_externo_id = p_evento_id;
    return jsonb_build_object('ok', true, 'duplicado', true, 'evento_id', v_ja.id,
                              'status', v_ja.status, 'processado_em', v_ja.processado_em,
                              'resultado', v_ja.resultado);
  end if;

  select * into v_inv from public.billing_invoices
   where provider = p_provider and provider_ref is not null and provider_ref = (p_payload ->> 'cobranca_ref');
  if found then
    select * into v_sub from public.subscriptions where id = v_inv.subscription_id;
  else
    select * into v_sub from public.subscriptions
     where (provider_ref is not null and provider_ref = (p_payload ->> 'assinatura_ref'))
        or id = nullif(p_payload ->> 'subscription_id', '')::uuid;
  end if;

  if v_sub.id is null then
    v_status := 'ignorado';
    v_res := jsonb_build_object('motivo', 'evento sem assinatura correspondente');
  elsif p_tipo = 'pagamento_aprovado' then
    if v_inv.id is not null then
      update public.billing_invoices set status = 'paga', pago_em = now(), updated_at = now() where id = v_inv.id;
      -- NOVO (540): fatura que ainda NÃO estava paga estende a licença pelo ciclo, a partir do fim do período vigente (ou de agora)
      if v_inv.status <> 'paga' then
        update public.subscriptions
           set periodo_inicio = case when periodo_fim is null or periodo_fim < now() then now() else coalesce(periodo_inicio, now()) end,
               periodo_fim = greatest(coalesce(periodo_fim, now()), now())
                             + case v_sub.ciclo when 'anual' then interval '1 year' else interval '1 month' end,
               updated_at = now()
         where id = v_sub.id;
      end if;
    end if;
    v_res := jsonb_build_object('status', public._assinatura_transicionar(v_sub.id, 'ativa', 'pagamento aprovado', 'webhook',
                                                                          jsonb_build_object('evento', p_evento_id)));
  elsif p_tipo = 'pagamento_recusado' then
    if v_inv.id is not null then
      update public.billing_invoices
         set status = 'aberta', tentativas = tentativas + 1,
             ultimo_erro = coalesce(p_payload ->> 'motivo', 'recusado pelo provedor'), updated_at = now()
       where id = v_inv.id;
    end if;
    v_res := jsonb_build_object('status', public.assinatura_avaliar(v_sub.id));
  elsif p_tipo = 'pagamento_atrasado' then
    if v_inv.id is not null then
      update public.billing_invoices set status = 'vencida', updated_at = now() where id = v_inv.id;
    end if;
    v_res := jsonb_build_object('status', public.assinatura_avaliar(v_sub.id));
  elsif p_tipo = 'renovacao' then
    update public.subscriptions
       set periodo_inicio = coalesce(nullif(p_payload ->> 'periodo_inicio', '')::timestamptz, now()),
           periodo_fim = nullif(p_payload ->> 'periodo_fim', '')::timestamptz,
           updated_at = now()
     where id = v_sub.id;
    insert into public.billing_invoices (subscription_id, competencia, valor_centavos, moeda, vence_em, provider, provider_ref)
    values (v_sub.id,
            coalesce(nullif(p_payload ->> 'competencia', '')::date, date_trunc('month', current_date)::date),
            coalesce(nullif(p_payload ->> 'valor_centavos', '')::bigint, 0), coalesce(p_payload ->> 'moeda', 'BRL'),
            coalesce(nullif(p_payload ->> 'vence_em', '')::date, current_date + 10), p_provider, p_payload ->> 'cobranca_ref')
    on conflict (subscription_id, competencia) do nothing;
    v_res := jsonb_build_object('status', public.assinatura_avaliar(v_sub.id));
  elsif p_tipo = 'cancelamento' then
    v_res := jsonb_build_object('status', public._assinatura_transicionar(v_sub.id, 'cancelada',
               coalesce(p_payload ->> 'motivo', 'cancelamento no provedor'), 'webhook', jsonb_build_object('evento', p_evento_id)));
  else
    v_status := 'ignorado';
    v_res := jsonb_build_object('motivo', 'tipo de evento não suportado: ' || p_tipo);
  end if;

  update public.billing_events
     set status = v_status, resultado = v_res, processado_em = now(),
         subscription_id = v_sub.id, invoice_id = v_inv.id
   where id = v_ev_id;

  return jsonb_build_object('ok', true, 'duplicado', false, 'evento_id', v_ev_id, 'status', v_status, 'resultado', v_res);
end;
$$;
revoke all on function public.billing_webhook_receber(text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.billing_webhook_receber(text, text, text, jsonb) to service_role;

-- ---------------------------------------------------------------- vencimento automático (antes só andava por webhook ou pelo admin)
create or replace function public.faturas_vencidas_avaliar() returns int
language plpgsql security definer set search_path = '' as $$
declare r record; n int := 0;
begin
  update public.billing_invoices set status = 'vencida', updated_at = now() where status = 'aberta' and vence_em < current_date;
  for r in select distinct subscription_id from public.billing_invoices where status = 'vencida' loop
    perform public.assinatura_avaliar(r.subscription_id);
    n := n + 1;
  end loop;
  return n;
end;
$$;
revoke all on function public.faturas_vencidas_avaliar() from public, anon, authenticated;
grant execute on function public.faturas_vencidas_avaliar() to service_role;

select cron.schedule('avaliar-faturas-vencidas', '35 4 * * *', 'select public.faturas_vencidas_avaliar()')
 where not exists (select 1 from cron.job where jobname = 'avaliar-faturas-vencidas');

notify pgrst, 'reload schema';
