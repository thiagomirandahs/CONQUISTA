-- Item 7 da rodada de fechamento: auditei o motor de billing — mensal/anual JÁ EXISTE de verdade no
-- modelo (billing_prices.ciclo, subscriptions.ciclo/price_id, planos_disponiveis() já devolve os dois
-- preços por plano) — só o ONBOARDING não usava nada disso: sempre criava a assinatura com
-- ciclo='mensal' (o default da coluna) e price_id NULO, ignorando qualquer escolha. Corrigido: a
-- etapa "clube" agora lê p_dados->>'ciclo' (mensal/anual, default mensal), valida contra o catálogo
-- REAL (nunca inventa valor) e grava ciclo+price_id na assinatura.
create or replace function public.onboarding_etapa(p_etapa text, p_dados jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_s public.onboarding_sessions; v_etapas text[] := public._onboarding_etapas();
        v_pos int; v_pos_atual int; v_id uuid; v_plan record; v_pol record; v_nome text; v_slug text;
        v_feature text; v_email text; v_prov jsonb; v_ciclo text; v_price record;
begin
  if v_uid is null then raise exception 'Faça login para continuar.'; end if;
  p_dados := coalesce(p_dados, '{}'::jsonb);

  select * into v_s from public.onboarding_sessions where user_id = v_uid and status = 'em_andamento' for update;
  if not found then raise exception 'Nenhum cadastro em andamento. Comece um novo.'; end if;

  v_pos := array_position(v_etapas, p_etapa);
  v_pos_atual := array_position(v_etapas, v_s.etapa);
  if v_pos is null then raise exception 'Etapa desconhecida: %.', p_etapa; end if;
  -- não dá pra pular: só a etapa atual ou uma já concluída (reedição). O servidor manda na ordem.
  if v_pos > v_pos_atual then
    raise exception 'Termine a etapa "%" antes de ir para "%".', v_s.etapa, p_etapa;
  end if;

  -- ---------------- conta comercial ----------------
  if p_etapa = 'conta' then
    v_nome := nullif(btrim(coalesce(p_dados ->> 'nome', '')), '');
    if v_nome is null then raise exception 'Informe o nome do responsável/organização.'; end if;
    if v_s.billing_account_id is null then                         -- IDEMPOTENTE: nunca uma 2ª conta
      insert into public.billing_accounts (nome, email_cobranca)
      values (v_nome, nullif(p_dados ->> 'email', '')) returning id into v_id;
      insert into public.billing_account_contacts (billing_account_id, user_id, papel)
      values (v_id, v_uid, 'titular') on conflict (billing_account_id, user_id) do nothing;
      update public.onboarding_sessions set billing_account_id = v_id where id = v_s.id;
    else
      update public.billing_accounts set nome = v_nome, email_cobranca = coalesce(nullif(p_dados ->> 'email', ''), email_cobranca),
             updated_at = now() where id = v_s.billing_account_id;
    end if;

  -- ---------------- dados básicos da conta ----------------
  elsif p_etapa = 'dados_basicos' then
    if v_s.billing_account_id is null then raise exception 'Crie a conta antes dos dados básicos.'; end if;
    update public.billing_accounts
       set documento = coalesce(nullif(p_dados ->> 'documento', ''), documento),
           telefone = coalesce(nullif(p_dados ->> 'telefone', ''), telefone),
           pais = coalesce(nullif(p_dados ->> 'pais', ''), pais),
           timezone = coalesce(nullif(p_dados ->> 'timezone', ''), timezone),
           updated_at = now()
     where id = v_s.billing_account_id;

  -- ---------------- criação do clube (+ assinatura em trial) ----------------
  elsif p_etapa = 'clube' then
    if v_s.billing_account_id is null then raise exception 'Crie a conta antes do clube.'; end if;
    v_nome := nullif(btrim(coalesce(p_dados ->> 'nome', '')), '');
    if v_s.club_id is null then
      if v_nome is null then raise exception 'Informe o nome do clube.'; end if;
      v_slug := public._slug_de_clube(v_nome);
      -- o gatilho trg_provisionar_clube roda aqui: config, jogos, chat e conteúdo iniciais
      insert into public.organizational_units (type, nome, slug, pais, timezone)
      values ('clube', v_nome, v_slug,
              coalesce((select pais from public.billing_accounts where id = v_s.billing_account_id), 'BR'),
              coalesce((select timezone from public.billing_accounts where id = v_s.billing_account_id), 'America/Recife'))
      returning id into v_id;
      update public.onboarding_sessions set club_id = v_id where id = v_s.id;
      v_s.club_id := v_id;
      v_prov := public._provisionamento_conferir(v_id);

      -- assinatura: uma só, em trial, no plano escolhido (público) ou no padrão
      if v_s.subscription_id is null then
        select * into v_pol from public.politica_comercial() p;
        select * into v_plan from public.billing_plans
         where chave = coalesce(nullif(p_dados ->> 'plano', ''), 'essencial')
           and publico and ativo and status = 'publicado' order by versao desc limit 1;
        if not found then
          select * into v_plan from public.billing_plans where publico and ativo and status = 'publicado'
           order by versao desc limit 1;
        end if;
        if not found then raise exception 'Nenhum plano publicado no catálogo.'; end if;

        -- ciclo: mensal ou anual — nunca inventado, sempre resolvido contra o PREÇO real do catálogo
        -- pra ESTE plano (nunca um price_id de outro plano colado por engano).
        v_ciclo := coalesce(nullif(p_dados ->> 'ciclo', ''), 'mensal');
        if v_ciclo not in ('mensal', 'anual') then raise exception 'Ciclo inválido: %.', v_ciclo; end if;
        select * into v_price from public.billing_prices
         where plan_id = v_plan.id and ciclo = v_ciclo and ativo
           and vigente_de <= now() and (vigente_ate is null or vigente_ate > now())
         limit 1;
        -- sem preço publicado pro ciclo pedido: cai pro mensal (sempre existe no catálogo seed) em vez
        -- de travar o onboarding — a pessoa continua entrando, só não com o ciclo que pediu.
        if not found and v_ciclo <> 'mensal' then
          v_ciclo := 'mensal';
          select * into v_price from public.billing_prices
           where plan_id = v_plan.id and ciclo = 'mensal' and ativo
             and vigente_de <= now() and (vigente_ate is null or vigente_ate > now())
           limit 1;
        end if;

        insert into public.subscriptions (billing_account_id, plan_id, price_id, status, ciclo, trial_ate, provider)
        values (v_s.billing_account_id, v_plan.id, v_price.id, 'trial', v_ciclo, now() + make_interval(days => coalesce(v_pol.trial_dias, 30)), 'mock')
        returning id into v_id;
        insert into public.subscription_events (subscription_id, de, para, motivo, origem, ator_id)
        values (v_id, null, 'trial', 'início pelo onboarding', 'onboarding', v_uid);
        insert into public.subscription_clubs (subscription_id, club_id) values (v_id, v_s.club_id)
        on conflict (club_id) do nothing;
        update public.onboarding_sessions set subscription_id = v_id where id = v_s.id;
      end if;
      update public.onboarding_sessions set dados = dados || jsonb_build_object('provisionamento', v_prov) where id = v_s.id;
    elsif v_nome is not null then
      update public.organizational_units set nome = v_nome, updated_at = now() where id = v_s.club_id;
    end if;

  -- ---------------- identidade visual ----------------
  elsif p_etapa = 'identidade' then
    if v_s.club_id is null then raise exception 'Crie o clube antes da identidade visual.'; end if;
    update public.organizational_units
       set metadata = jsonb_set(coalesce(metadata, '{}'::jsonb), '{marca}',
             coalesce(metadata -> 'marca', '{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object(
               'sigla', nullif(p_dados ->> 'sigla', ''), 'lema', nullif(p_dados ->> 'lema', ''),
               'descricao', nullif(p_dados ->> 'descricao', ''), 'desde', nullif(p_dados ->> 'desde', ''),
               'cor_primaria', nullif(p_dados ->> 'cor_primaria', ''), 'cor_secundaria', nullif(p_dados ->> 'cor_secundaria', ''))), true),
           updated_at = now()
     where id = v_s.club_id;

  -- ---------------- primeiro diretor (quem está cadastrando) ----------------
  elsif p_etapa = 'diretor' then
    if v_s.club_id is null then raise exception 'Crie o clube antes de definir o diretor.'; end if;
    insert into public.organization_memberships (user_id, organizational_unit_id, role, status)
    values (v_uid, v_s.club_id, 'diretoria', 'ativo')
    on conflict do nothing;                                       -- IDEMPOTENTE: repetir não duplica
    if not exists (select 1 from public.organization_memberships
                   where user_id = v_uid and organizational_unit_id = v_s.club_id and role = 'diretoria') then
      update public.organization_memberships set role = 'diretoria', status = 'ativo'
       where user_id = v_uid and organizational_unit_id = v_s.club_id;
    end if;

  -- ---------------- configuração inicial ----------------
  elsif p_etapa = 'configuracao' then
    if v_s.club_id is null then raise exception 'Crie o clube antes da configuração.'; end if;
    insert into public.config_clube (club_id, chave, valor)
    select v_s.club_id, k, coalesce(p_dados ->> k, '')
      from unnest(array['pix']) k
     where p_dados ? k
    on conflict (club_id, chave) do update set valor = excluded.valor;

  -- ---------------- recursos (respeitando o que o plano libera) ----------------
  elsif p_etapa = 'recursos' then
    if v_s.club_id is null then raise exception 'Crie o clube antes de escolher os recursos.'; end if;
    for v_feature in select jsonb_object_keys(coalesce(p_dados -> 'recursos', '{}'::jsonb)) loop
      if not exists (select 1 from public.recursos_catalogo where chave = v_feature) then
        raise exception 'Recurso desconhecido: %.', v_feature;
      end if;
      -- a 1ª camada manda: não adianta ligar no clube o que o plano não inclui
      if not public.recurso_disponivel_no_plano(v_s.club_id, v_feature) then
        raise exception 'O recurso "%" não está incluído no plano escolhido.', v_feature;
      end if;
      insert into public.club_features (club_id, feature, enabled)
      values (v_s.club_id, v_feature, ((p_dados -> 'recursos' ->> v_feature)::boolean))
      on conflict (club_id, feature) do update set enabled = excluded.enabled, updated_at = now();
    end loop;

  -- ---------------- convite da equipe ----------------
  elsif p_etapa = 'equipe' then
    if v_s.club_id is null then raise exception 'Crie o clube antes de convidar a equipe.'; end if;
    for v_email in select lower(btrim(e)) from jsonb_array_elements_text(coalesce(p_dados -> 'emails', '[]'::jsonb)) e loop
      if v_email = '' then continue; end if;
      insert into public.club_team_invites (club_id, email, papel, criado_por)
      values (v_s.club_id, v_email, coalesce(nullif(p_dados ->> 'papel', ''), 'diretoria'), v_uid)
      on conflict (club_id, email) do nothing;                    -- IDEMPOTENTE: repetir não duplica
    end loop;

  -- ---------------- pronto pra uso ----------------
  elsif p_etapa = 'pronto' then
    if v_s.club_id is null or v_s.subscription_id is null then
      raise exception 'O cadastro ainda não tem clube e assinatura.';
    end if;
    v_prov := public._provisionamento_conferir(v_s.club_id);
    update public.onboarding_sessions
       set status = 'concluido', dados = dados || jsonb_build_object('provisionamento', v_prov), updated_at = now()
     where id = v_s.id;
    select * into v_s from public.onboarding_sessions where id = v_s.id;
    return public._onboarding_json(v_s) || jsonb_build_object('provisionamento', v_prov);
  end if;

  -- avança (ou permanece, se foi reedição de etapa anterior)
  update public.onboarding_sessions
     set etapas_concluidas = (select array_agg(distinct x) from unnest(etapas_concluidas || p_etapa) x),
         etapa = case when p_etapa = etapa then v_etapas[v_pos + 1] else etapa end,
         dados = dados || jsonb_build_object(p_etapa, p_dados),
         ultimo_erro = null, updated_at = now()
   where id = v_s.id
  returning * into v_s;
  return public._onboarding_json(v_s);
end;
$$;
revoke all on function public.onboarding_etapa(text, jsonb) from public, anon;
grant execute on function public.onboarding_etapa(text, jsonb) to authenticated;

notify pgrst, 'reload schema';

insert into public.migracoes_aplicadas (arquivo)
values ('2026-09-30-onboarding-preserva-ciclo-mensal-anual.sql')
on conflict (arquivo) do update set aplicada_em = now();
