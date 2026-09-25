-- =============================================================================
--  Administração da Plataforma: visão por CLUBE (não só por conta comercial).
--
--  admin_contas_listar (migration 48) enxerga só clubes cobertos por uma assinatura — o Tenant 001
--  (sem conta comercial) e um clube parado no meio do onboarding ficavam invisíveis no /admin.
--
--  Só LEITURA administrativa: nenhuma escrita nova (as ações seguem nas RPCs da 48: plano_mudar,
--  admin_assinatura_transicionar, admin_provisionamento_reexecutar). Todas exigem
--  _exigir_admin_plataforma() e devolvem metadado comercial/operacional + CONTAGENS — nunca nome
--  de membro, chat, foto, evidência, documento, mensalidade individual ou dado de criança. O admin
--  administra a CONTA/CLUBE; não vira diretoria de clube nenhum (nenhum vínculo é criado aqui).
-- =============================================================================

create or replace function public._admin_situacao_armazenamento(p_bytes bigint, p_limite_mb bigint) returns text
language sql immutable set search_path = '' as $$
  select case
    when p_limite_mb is null then 'sem_limite'
    when p_limite_mb <= 0 or coalesce(p_bytes, 0) >= p_limite_mb * 1048576 then 'atingido'
    when coalesce(p_bytes, 0) >= p_limite_mb * 1048576 * 0.8 then 'proximo'
    else 'normal' end;
$$;
revoke all on function public._admin_situacao_armazenamento(bigint, bigint) from public, anon, authenticated;

create or replace function public.admin_clubes_listar() returns json
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public._exigir_admin_plataforma();
  return coalesce((select json_agg(c order by c.criado_em desc) from (
    select o.id as club_id, o.nome, o.slug, o.status, o.created_at as criado_em,
           a.assinatura_id, a.assinatura_status, a.ciclo, a.trial_ate, a.periodo_fim, a.provider,
           a.plano_chave, a.plano_versao, a.plano_nome,
           coalesce(u.bytes, 0) as armazenamento_bytes, coalesce(u.objetos, 0) as armazenamento_objetos,
           lim.mb as armazenamento_limite_mb,
           case when lim.mb > 0 then round(coalesce(u.bytes, 0) * 100.0 / (lim.mb * 1048576), 1) end as armazenamento_pct,
           public._admin_situacao_armazenamento(coalesce(u.bytes, 0), lim.mb) as armazenamento_situacao,
           public.limite_uso(o.id, 'membros') as membros,
           ob.status as onboarding_status, ob.etapa as onboarding_etapa,
           coalesce(ps.status, 'nao_verificado') as provisionamento
      from public.organizational_units o
      left join lateral (
        select s.id as assinatura_id, s.status as assinatura_status, s.ciclo, s.trial_ate, s.periodo_fim, s.provider,
               p.chave as plano_chave, p.versao as plano_versao, p.nome as plano_nome
          from public.subscription_clubs sc
          join public.subscriptions s on s.id = sc.subscription_id
          join public.billing_plans p on p.id = s.plan_id
         where sc.club_id = o.id
         order by (s.status = 'cancelada'), s.created_at desc limit 1) a on true
      left join public.club_storage_uso u on u.club_id = o.id
      left join lateral (select public.plano_limite(o.id, 'armazenamento_mb') as mb) lim on true
      left join lateral (select os.status, os.etapa from public.onboarding_sessions os
                          where os.club_id = o.id order by os.created_at desc limit 1) ob on true
      left join public.club_provisioning_status ps on ps.club_id = o.id
     where o.type = 'clube') c), '[]'::json);
end;
$$;

create or replace function public.admin_clube_detalhe(p_club_id uuid) returns json
language plpgsql stable security definer set search_path = '' as $$
declare v_clube json; v_sub uuid; v_plan uuid;
begin
  perform public._exigir_admin_plataforma();
  select value into v_clube from json_array_elements(public.admin_clubes_listar()) where value ->> 'club_id' = p_club_id::text;
  if v_clube is null then raise exception 'Clube não encontrado.'; end if;
  v_sub := nullif(v_clube ->> 'assinatura_id', '')::uuid;
  select plan_id into v_plan from public.subscriptions where id = v_sub;

  return json_build_object(
    'clube', v_clube,
    'hierarquia', (select json_build_object('tipo', pai.type, 'nome', pai.nome)
                     from public.organizational_units o join public.organizational_units pai on pai.id = o.parent_id
                    where o.id = p_club_id),
    'limites', (select coalesce(json_agg(json_build_object('chave', k.chave, 'teto', k.teto,
                                  'uso', case when k.chave = 'armazenamento_mb' then public.limite_uso(p_club_id, 'armazenamento_mb')
                                              else public.limite_uso(p_club_id, k.chave) end) order by k.chave), '[]'::json)
                  from (select key as chave, value #>> '{}' as teto from public.billing_plans bp, jsonb_each(bp.limites)
                         where bp.id = v_plan) k),
    'recursos', (select coalesce(json_agg(json_build_object('recurso', f.feature, 'ligado', f.enabled) order by f.feature), '[]'::json)
                   from public.club_features f where f.club_id = p_club_id),
    'vinculos_por_papel', (select coalesce(json_agg(json_build_object('papel', r.role, 'status', r.status, 'total', r.n) order by r.role, r.status), '[]'::json)
                             from (select m.role, m.status, count(*) as n from public.organization_memberships m
                                    where m.organizational_unit_id = p_club_id group by m.role, m.status) r),
    'assinatura_eventos', (select coalesce(json_agg(json_build_object('de', e.de, 'para', e.para, 'motivo', e.motivo,
                                                                      'origem', e.origem, 'em', e.created_at) order by e.created_at desc), '[]'::json)
                             from (select * from public.subscription_events where subscription_id = v_sub
                                    order by created_at desc limit 50) e),
    'onboarding', (select coalesce(json_agg(json_build_object('status', os.status, 'etapa', os.etapa,
                                            'etapas_concluidas', os.etapas_concluidas, 'ultimo_erro', os.ultimo_erro,
                                            'iniciado_em', os.created_at, 'atualizado_em', os.updated_at) order by os.created_at desc), '[]'::json)
                     from public.onboarding_sessions os where os.club_id = p_club_id),
    'provisionamento', (select json_build_object('status', ps.status, 'tentativas', ps.tentativas, 'erro', ps.erro,
                                                 'verificado_em', ps.verificado_em)
                          from public.club_provisioning_status ps where ps.club_id = p_club_id),
    'auditoria', (select coalesce(json_agg(json_build_object('acao', x.acao, 'alvo_tipo', x.alvo_tipo, 'em', x.created_at,
                                                             'detalhe', x.detalhe) order by x.created_at desc), '[]'::json)
                    from (select * from public.platform_admin_audit
                           where alvo_id = p_club_id or (v_sub is not null and alvo_id = v_sub)
                           order by created_at desc limit 50) x)
  );
end;
$$;

create or replace function public.admin_planos_listar() returns json
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public._exigir_admin_plataforma();
  return coalesce((select json_agg(json_build_object(
      'id', p.id, 'chave', p.chave, 'versao', p.versao, 'nome', p.nome, 'descricao', p.descricao,
      'publico', p.publico, 'status', p.status, 'ativo', p.ativo, 'provisorio', p.provisorio,
      'recursos', p.recursos, 'limites', p.limites, 'criado_em', p.created_at,
      'assinaturas', (select count(*) from public.subscriptions s where s.plan_id = p.id and s.status <> 'cancelada'),
      'precos', coalesce((select json_agg(json_build_object('ciclo', pr.ciclo, 'moeda', pr.moeda, 'valor_centavos', pr.valor_centavos,
                                          'ativo', pr.ativo, 'provisorio', pr.provisorio, 'vigente_de', pr.vigente_de,
                                          'vigente_ate', pr.vigente_ate) order by pr.ciclo, pr.vigente_de)
                          from public.billing_prices pr where pr.plan_id = p.id), '[]'::json)
    ) order by p.chave, p.versao desc)
    from public.billing_plans p), '[]'::json);
end;
$$;

create or replace function public.admin_assinaturas_listar() returns json
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public._exigir_admin_plataforma();
  return coalesce((select json_agg(json_build_object(
      'id', s.id, 'status', s.status, 'status_motivo', s.status_motivo, 'ciclo', s.ciclo,
      'criada_em', s.created_at, 'trial_ate', s.trial_ate, 'periodo_inicio', s.periodo_inicio, 'periodo_fim', s.periodo_fim,
      'cancelada_em', s.cancelada_em, 'provider', s.provider,
      'plano_chave', p.chave, 'plano_versao', p.versao, 'plano_nome', p.nome,
      'conta', a.nome,
      'clubes', coalesce((select json_agg(json_build_object('club_id', o.id, 'nome', o.nome) order by o.nome)
                            from public.subscription_clubs sc join public.organizational_units o on o.id = sc.club_id
                           where sc.subscription_id = s.id), '[]'::json),
      -- pagamento CONFIRMADO só existe quando uma fatura foi paga por um provedor real (não 'mock').
      'faturas_pagas_gateway', (select count(*) from public.billing_invoices i
                                 where i.subscription_id = s.id and i.status = 'paga' and coalesce(i.provider, 'mock') <> 'mock'),
      'faturas_abertas', (select count(*) from public.billing_invoices i
                           where i.subscription_id = s.id and i.status in ('aberta', 'vencida'))
    ) order by s.created_at desc)
    from public.subscriptions s
    join public.billing_plans p on p.id = s.plan_id
    left join public.billing_accounts a on a.id = s.billing_account_id), '[]'::json);
end;
$$;

create or replace function public.admin_onboarding_listar() returns json
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public._exigir_admin_plataforma();
  -- sem `dados` da sessão (tem nome/e-mail de quem cadastra): só o andamento.
  return coalesce((select json_agg(json_build_object(
      'id', os.id, 'status', os.status, 'etapa', os.etapa, 'etapas_concluidas', os.etapas_concluidas,
      'ultimo_erro', os.ultimo_erro, 'iniciado_em', os.created_at, 'atualizado_em', os.updated_at,
      'club_id', os.club_id, 'clube', o.nome,
      'provisionamento', (select ps.status from public.club_provisioning_status ps where ps.club_id = os.club_id)
    ) order by os.updated_at desc)
    from public.onboarding_sessions os
    left join public.organizational_units o on o.id = os.club_id), '[]'::json);
end;
$$;

create or replace function public.admin_visao_geral() returns json
language plpgsql stable security definer set search_path = '' as $$
declare v_clubes json;
begin
  perform public._exigir_admin_plataforma();
  v_clubes := public.admin_clubes_listar();
  return json_build_object(
    'clubes_total', (select count(*) from json_array_elements(v_clubes)),
    'clubes_ativos', (select count(*) from json_array_elements(v_clubes) c where c ->> 'status' = 'ativo'),
    'clubes_inativos', (select count(*) from json_array_elements(v_clubes) c where c ->> 'status' <> 'ativo'),
    'onboarding_em_andamento', (select count(*) from public.onboarding_sessions where status = 'em_andamento'),
    'onboarding_concluidos', (select count(*) from public.onboarding_sessions where status = 'concluido'),
    'assinaturas_por_status', (select coalesce(json_object_agg(status, n), '{}'::json)
                                 from (select status, count(*) as n from public.subscriptions group by status) s),
    'planos_total', (select count(*) from public.billing_plans),
    'planos_publicos', (select count(*) from public.billing_plans where publico and ativo and status = 'publicado'),
    'armazenamento_total_bytes', (select coalesce(sum(bytes), 0) from public.club_storage_uso),
    'clubes_proximos_do_limite', (select count(*) from json_array_elements(v_clubes) c where c ->> 'armazenamento_situacao' = 'proximo'),
    'clubes_no_limite', (select count(*) from json_array_elements(v_clubes) c where c ->> 'armazenamento_situacao' = 'atingido'),
    'provisionamentos_pendentes', (select count(*) from public.club_provisioning_status where status <> 'ok'),
    'eventos_admin_7d', (select count(*) from public.platform_admin_audit where created_at > now() - interval '7 days'),
    'eventos_assinatura_7d', (select count(*) from public.subscription_events where created_at > now() - interval '7 days')
  );
end;
$$;

do $$
declare f text;
begin
  foreach f in array array['admin_clubes_listar()', 'admin_clube_detalhe(uuid)', 'admin_planos_listar()',
                           'admin_assinaturas_listar()', 'admin_onboarding_listar()', 'admin_visao_geral()'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

notify pgrst, 'reload schema';
