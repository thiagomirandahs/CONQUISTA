-- =============================================================================
--  (1) "Cada licença = 1 clube."  (2) Teste gratuito gerenciado pelo /admin.
--
--  (1) De onde vinha o "Clubes 1 / 3": a migration 101 semeou a Licença Anual (anual v1) com
--  limites.clubes = 3 (copiado do antigo tier "completo" da 48). O teto nunca foi APLICADO no
--  servidor — só exibido (limites_do_clube/limite_uso). Aqui:
--    a) o teto passa a 1 nos planos que tinham mais que isso (anual v1 e o tier oculto "completo").
--       billing_plans não tem gatilho de imutabilidade, e a 101 já ajustou a própria versão com
--       ON CONFLICT DO UPDATE; publicar anual v2 obrigaria mexer no plan_id de assinaturas vivas
--       (dado de cliente). Só a chave "clubes" do jsonb muda — nenhum outro limite, preço ou
--       assinatura é tocado. "legado-fundador" (Tenant 001) não tem a chave: continua sem teto.
--    b) gatilho em subscription_clubs: uma assinatura não passa a cobrir mais clubes do que o plano
--       permite. É a ÚNICA porta de "clube entra numa licença" (onboarding e qualquer insert/update
--       manual). Nada existente é removido: excedente já gravado continua, só não cresce.
--
--  (2) Teste gratuito: RPCs security definer que exigem _exigir_admin_plataforma(), com trilha em
--  platform_admin_audit + subscription_events (origem 'admin'). Nenhuma cobrança/fatura/pagamento
--  é criado. O padrão de dias para clubes novos já existia (billing_policies.trial_dias, lido por
--  politica_comercial() no onboarding): mudar o padrão publica uma NOVA VERSÃO da política
--  (a tabela é versionada), nunca reescreve a anterior.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1a) teto de clubes = 1 por licença
-- ---------------------------------------------------------------------------
do $$
declare v_excedentes int;
begin
  update public.billing_plans
     set limites = jsonb_set(limites, '{clubes}', '1'::jsonb)
   where (limites ->> 'clubes') ~ '^\d+$' and (limites ->> 'clubes')::int > 1;

  -- só informa (não altera nada): assinaturas vivas que JÁ cobrem mais clubes que o teto novo
  select count(*) into v_excedentes from (
    select sc.subscription_id from public.subscription_clubs sc
      join public.subscriptions s on s.id = sc.subscription_id and s.status <> 'cancelada'
      join public.billing_plans p on p.id = s.plan_id
     where (p.limites ->> 'clubes') ~ '^\d+$'
     group by sc.subscription_id, p.limites
    having count(*) > (p.limites ->> 'clubes')::int) x;
  raise notice 'Assinaturas vivas acima do novo teto de clubes (mantidas como estão): %', v_excedentes;
end $$;

-- ---------------------------------------------------------------------------
-- 1b) o teto é aplicado no servidor, onde um clube entra numa licença
-- ---------------------------------------------------------------------------
create or replace function public._exigir_limite_de_clubes() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_lim bigint; v_uso bigint; v_plano text;
begin
  if tg_op = 'UPDATE' and new.subscription_id = old.subscription_id then return new; end if;
  -- serializa inclusões concorrentes na MESMA assinatura
  perform 1 from public.subscriptions where id = new.subscription_id for update;
  select case when (p.limites ->> 'clubes') ~ '^\d+$' then (p.limites ->> 'clubes')::bigint end, p.nome
    into v_lim, v_plano
    from public.subscriptions s join public.billing_plans p on p.id = s.plan_id
   where s.id = new.subscription_id;
  if v_lim is null then return new; end if;                    -- sem chave = ilimitado (ex.: legado-fundador)
  select count(*) into v_uso from public.subscription_clubs
   where subscription_id = new.subscription_id and club_id <> new.club_id;
  if v_uso >= v_lim then
    raise exception 'Limite de clubes do plano "%" atingido (% de %). Cada licença cobre % clube(s).',
      v_plano, v_uso, v_lim, v_lim;
  end if;
  return new;
end;
$$;
revoke all on function public._exigir_limite_de_clubes() from public, anon, authenticated;
drop trigger if exists trg_exigir_limite_de_clubes on public.subscription_clubs;
create trigger trg_exigir_limite_de_clubes before insert or update on public.subscription_clubs
for each row execute function public._exigir_limite_de_clubes();

-- ---------------------------------------------------------------------------
-- 2) teste gratuito — administração da plataforma
-- ---------------------------------------------------------------------------
-- assinatura viva do clube (a mesma regra do admin_clubes_listar)
create or replace function public._admin_assinatura_viva_do_clube(p_club_id uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select s.id from public.subscription_clubs sc join public.subscriptions s on s.id = sc.subscription_id
   where sc.club_id = p_club_id and s.status <> 'cancelada'
   order by s.created_at desc limit 1;
$$;
revoke all on function public._admin_assinatura_viva_do_clube(uuid) from public, anon, authenticated;

create or replace function public.admin_trial_padrao() returns json
language plpgsql stable security definer set search_path = '' as $$
declare v_pol record;
begin
  perform public._exigir_admin_plataforma();
  select * into v_pol from public.politica_comercial() p;
  return json_build_object('trial_dias', coalesce(v_pol.trial_dias, 30),
                           'politica_chave', v_pol.chave, 'politica_versao', v_pol.versao,
                           'definido_em', v_pol.created_at);
end;
$$;

create or replace function public.admin_trial_padrao_definir(p_dias int, p_motivo text default null) returns json
language plpgsql security definer set search_path = '' as $$
declare v_admin uuid := public._exigir_admin_plataforma(); v_pol public.billing_policies; v_nova public.billing_policies;
begin
  if p_dias is null or p_dias < 0 or p_dias > 365 then
    raise exception 'Dias de teste inválidos: use de 0 a 365.';
  end if;
  select * into v_pol from public.politica_comercial() p;
  if v_pol.id is not null and v_pol.trial_dias = p_dias then
    return json_build_object('ok', true, 'trial_dias', p_dias, 'sem_mudanca', true);
  end if;
  -- versionado: publica a versão seguinte (copiando o resto da política) e aposenta a anterior
  insert into public.billing_policies (chave, versao, ativo, trial_dias, carencia_dias, dias_ate_inadimplente,
                                       dias_ate_suspensao, suspensao_bloqueia_recursos, observacao)
  values (coalesce(v_pol.chave, 'padrao'),
          coalesce((select max(versao) from public.billing_policies where chave = coalesce(v_pol.chave, 'padrao')), 0) + 1,
          true, p_dias, coalesce(v_pol.carencia_dias, 5), coalesce(v_pol.dias_ate_inadimplente, 10),
          coalesce(v_pol.dias_ate_suspensao, 30), coalesce(v_pol.suspensao_bloqueia_recursos, true),
          'teste gratuito padrão definido no /admin' || coalesce(': ' || nullif(btrim(p_motivo), ''), ''))
  returning * into v_nova;
  if v_pol.id is not null then
    update public.billing_policies set ativo = false where id = v_pol.id;
  end if;
  perform public._admin_auditar('trial_padrao_definir', 'billing_policy', v_nova.id,
    jsonb_build_object('de', v_pol.trial_dias, 'para', p_dias, 'versao', v_nova.versao, 'motivo', p_motivo));
  return json_build_object('ok', true, 'trial_dias', p_dias, 'politica_versao', v_nova.versao);
end;
$$;

create or replace function public.admin_trial_estender(
  p_club_id uuid, p_dias int default null, p_ate timestamptz default null, p_motivo text default null
) returns json
language plpgsql security definer set search_path = '' as $$
declare v_admin uuid := public._exigir_admin_plataforma(); v_sub public.subscriptions; v_novo timestamptz;
begin
  if (p_dias is null) = (p_ate is null) then
    raise exception 'Informe os dias a acrescentar OU a data final do teste (um dos dois).';
  end if;
  if p_dias is not null and (p_dias < 1 or p_dias > 365) then
    raise exception 'Dias inválidos: use de 1 a 365.';
  end if;
  select * into v_sub from public.subscriptions where id = public._admin_assinatura_viva_do_clube(p_club_id) for update;
  if not found then raise exception 'Este clube não tem assinatura (não há teste gratuito para gerenciar).'; end if;
  if v_sub.status not in ('trial', 'pagamento_pendente') then
    raise exception 'Só dá para estender o teste de um clube em teste ou aguardando pagamento (situação atual: %).', v_sub.status;
  end if;
  if v_sub.status = 'pagamento_pendente' and exists (
       select 1 from public.billing_invoices i where i.subscription_id = v_sub.id and i.status in ('aberta', 'vencida')) then
    raise exception 'Este clube tem cobrança em aberto: resolva a cobrança antes de reabrir o teste.';
  end if;

  v_novo := coalesce(p_ate, greatest(coalesce(v_sub.trial_ate, now()), now()) + make_interval(days => p_dias));
  if v_novo <= now() then raise exception 'A nova data do fim do teste precisa ser no futuro.'; end if;
  if v_novo > now() + interval '366 days' then raise exception 'O teste pode ir no máximo 1 ano à frente.'; end if;

  -- trial é status "de entrada": reabrir o teste é ato do admin, registrado como evento explícito
  update public.subscriptions
     set trial_ate = v_novo, status = 'trial',
         status_motivo = 'teste gratuito ajustado pela administração', updated_at = now()
   where id = v_sub.id;
  insert into public.subscription_events (subscription_id, de, para, motivo, origem, ator_id, detalhe)
  values (v_sub.id, v_sub.status, 'trial', coalesce(nullif(btrim(p_motivo), ''), 'teste gratuito estendido'), 'admin', v_admin,
          jsonb_build_object('trial_ate_de', v_sub.trial_ate, 'trial_ate_para', v_novo));
  perform public._admin_auditar('trial_estender', 'club', p_club_id,
    jsonb_build_object('subscription_id', v_sub.id, 'de', v_sub.trial_ate, 'para', v_novo,
                       'dias', p_dias, 'status_de', v_sub.status, 'motivo', p_motivo));
  return json_build_object('ok', true, 'trial_ate', v_novo, 'status', 'trial');
end;
$$;

create or replace function public.admin_trial_encerrar(p_club_id uuid, p_motivo text default null) returns json
language plpgsql security definer set search_path = '' as $$
declare v_admin uuid := public._exigir_admin_plataforma(); v_sub public.subscriptions;
begin
  select * into v_sub from public.subscriptions where id = public._admin_assinatura_viva_do_clube(p_club_id) for update;
  if not found then raise exception 'Este clube não tem assinatura (não há teste gratuito para encerrar).'; end if;
  if v_sub.status <> 'trial' then
    raise exception 'Este clube não está em teste gratuito (situação atual: %).', v_sub.status;
  end if;
  update public.subscriptions set trial_ate = now(), updated_at = now() where id = v_sub.id;
  -- fim do teste = aguardando pagamento (só aviso; nenhuma cobrança é criada e nada é apagado)
  perform public._assinatura_transicionar(v_sub.id, 'pagamento_pendente',
    coalesce(nullif(btrim(p_motivo), ''), 'teste gratuito encerrado pela administração'), 'admin',
    jsonb_build_object('trial_ate_de', v_sub.trial_ate));
  perform public._admin_auditar('trial_encerrar', 'club', p_club_id,
    jsonb_build_object('subscription_id', v_sub.id, 'trial_ate_de', v_sub.trial_ate, 'motivo', p_motivo));
  return json_build_object('ok', true, 'status', 'pagamento_pendente');
end;
$$;

do $$
declare f text;
begin
  foreach f in array array['admin_trial_padrao()', 'admin_trial_padrao_definir(int, text)',
                           'admin_trial_estender(uuid, int, timestamptz, text)', 'admin_trial_encerrar(uuid, text)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

notify pgrst, 'reload schema';

insert into public.migracoes_aplicadas (arquivo)
values ('2026-09-30-licenca-um-clube-e-teste-gratuito-admin.sql')
on conflict (arquivo) do update set aplicada_em = now();
