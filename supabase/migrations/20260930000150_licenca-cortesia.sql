-- =============================================================================
--  LICENÇA CORTESIA (promoção / sorteio): o dono sorteia licenças grátis por 1 ano.
--
--  NÃO é pagamento: nenhuma cobrança (billing_invoices), nenhum evento de provedor (billing_events),
--  nenhum webhook. A assinatura fica 'ativa' com provider = 'cortesia', periodo_fim = fim da cortesia
--  e metadata.cortesia = { ate, origem, valor_centavos: 0, ... }, com evento em subscription_events e
--  linha em platform_admin_audit.
--
--  1) Códigos (courtesy_codes): gerados só pelo admin da plataforma. O código sai UMA vez da RPC que
--     o gera; no banco fica só o sha256 (padrão de club_entry_codes / hierarchy_invites). Limite de
--     usos, validade para resgate, revogar, apagar inativos.
--  2) Resgate no onboarding (onboarding_cortesia_resgatar): só o dono da sessão de onboarding viva,
--     depois que a etapa "clube" criou a assinatura. Rate limit por pessoa (10 erros / 10 min).
--     O admin também aplica direto a um clube existente (admin_cortesia_aplicar).
--  3) Fim: cortesias_expirar() (pg_cron diário) devolve o clube ao fluxo normal — provider volta a
--     'mock' e a assinatura vai para 'pagamento_pendente' pelo MESMO _assinatura_transicionar de
--     sempre (igual ao fim do teste gratuito na 109). Nada é apagado.
--  4) assinatura_do_clube() passa a devolver { cortesia: { ate } } para a tela do Plano do clube.
--
--  Esta migration NÃO altera dado nenhum de clube (nem Tenant 001 'filhos-da-conquista', nem
--  "Exército da colina"): só cria tabelas vazias, funções e o job. As RPCs recusam o Tenant 001.
-- =============================================================================

create table if not exists public.courtesy_codes (
  id uuid primary key default gen_random_uuid(),
  codigo_hash text not null unique,
  prefixo text not null,                                  -- só pra reconhecer na lista (4 chars)
  rotulo text not null check (length(rotulo) between 1 and 160),
  duracao_meses int not null default 12 check (duracao_meses between 1 and 36),
  max_usos int not null default 1 check (max_usos between 1 and 500),
  usos int not null default 0 check (usos >= 0),
  resgate_ate timestamptz not null,
  revogado_em timestamptz,
  revogado_motivo text,
  criado_por uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  check (usos <= max_usos)                                -- trava ESTRUTURAL: nunca além dos usos
);
alter table public.courtesy_codes enable row level security;
revoke all on public.courtesy_codes from public, anon, authenticated;

-- histórico de cada cortesia concedida (por código ou direto pelo admin). Sobrevive ao código apagado.
create table if not exists public.courtesy_grants (
  id uuid primary key default gen_random_uuid(),
  code_id uuid references public.courtesy_codes(id) on delete set null,
  rotulo text,
  subscription_id uuid not null references public.subscriptions(id) on delete cascade,
  club_id uuid references public.organizational_units(id) on delete set null,
  origem text not null check (origem in ('resgate', 'admin')),
  ator_id uuid references auth.users(id) on delete set null,
  inicio timestamptz not null default now(),
  fim timestamptz not null,
  expirada_em timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists idx_courtesy_grants_code on public.courtesy_grants (code_id);
create index if not exists idx_courtesy_grants_sub on public.courtesy_grants (subscription_id, created_at desc);
alter table public.courtesy_grants enable row level security;
revoke all on public.courtesy_grants from public, anon, authenticated;

create table if not exists public.courtesy_attempts (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  acertou boolean not null,
  quando timestamptz not null default now()
);
create index if not exists idx_courtesy_attempts_user on public.courtesy_attempts (user_id, quando desc);
alter table public.courtesy_attempts enable row level security;
revoke all on public.courtesy_attempts from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- helpers
-- ---------------------------------------------------------------------------
-- normaliza o que a pessoa digitou: maiúsculas, sem espaço/hífen ("dc-ab12 cd34" = "DCAB12CD34")
create or replace function public._cortesia_hash(p_codigo text) returns text
language sql immutable security definer set search_path = '' as $$
  select encode(extensions.digest(regexp_replace(upper(coalesce(p_codigo, '')), '[^A-Z0-9]', '', 'g'), 'sha256'), 'hex');
$$;
revoke all on function public._cortesia_hash(text) from public, anon, authenticated;

create or replace function public._cortesia_status(c public.courtesy_codes) returns text
language sql stable security definer set search_path = '' as $$
  select case when c.revogado_em is not null then 'revogado'
              when c.usos >= c.max_usos then 'resgatado'
              when c.resgate_ate <= now() then 'expirado'
              else 'ativo' end;
$$;
revoke all on function public._cortesia_status(public.courtesy_codes) from public, anon, authenticated;

-- Aplica a cortesia a uma assinatura. Devolve o fim. Única porta de escrita da cortesia.
create or replace function public._cortesia_aplicar(
  p_sub_id uuid, p_meses int, p_origem text, p_code_id uuid, p_rotulo text, p_motivo text
) returns timestamptz
language plpgsql security definer set search_path = '' as $$
declare v_sub public.subscriptions; v_club uuid; v_slug text; v_base timestamptz; v_fim timestamptz; v_ev_origem text;
begin
  select * into v_sub from public.subscriptions where id = p_sub_id for update;
  if not found then raise exception 'Assinatura não encontrada.'; end if;
  if v_sub.status = 'cancelada' then raise exception 'Assinatura cancelada não recebe cortesia.'; end if;
  select sc.club_id, u.slug into v_club, v_slug
    from public.subscription_clubs sc join public.organizational_units u on u.id = sc.club_id
   where sc.subscription_id = p_sub_id order by sc.incluido_em limit 1;
  if v_slug = 'filhos-da-conquista' then raise exception 'O clube fundador não usa licença cortesia.'; end if;
  if p_meses is null or p_meses < 1 or p_meses > 36 then raise exception 'Duração inválida: use de 1 a 36 meses.'; end if;

  -- já ativa e com período pago/cortesia no futuro: soma a partir do fim atual (não "rouba" tempo)
  v_base := case when v_sub.status = 'ativa' and v_sub.periodo_fim > now() then v_sub.periodo_fim else now() end;
  v_fim := v_base + make_interval(months => p_meses);
  v_ev_origem := case when p_origem = 'resgate' then 'onboarding' else 'admin' end;

  update public.subscriptions
     set provider = 'cortesia',
         periodo_inicio = case when v_base = now() then now() else periodo_inicio end,
         periodo_fim = v_fim,
         -- encerra o teste: senão assinatura_avaliar() devolveria o clube a 'trial'
         trial_ate = case when trial_ate is not null and trial_ate > now() then now() else trial_ate end,
         metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('cortesia', jsonb_build_object(
           'ate', v_fim, 'inicio', now(), 'meses', p_meses, 'origem', p_origem, 'code_id', p_code_id,
           'rotulo', p_rotulo, 'valor_centavos', 0, 'provider_anterior', v_sub.provider)),
         updated_at = now()
   where id = p_sub_id;

  if v_sub.status <> 'ativa' then
    perform public._assinatura_transicionar(p_sub_id, 'ativa', coalesce(p_motivo, 'licença cortesia'), v_ev_origem,
      jsonb_build_object('cortesia', true, 'ate', v_fim, 'meses', p_meses, 'code_id', p_code_id, 'valor_centavos', 0));
    update public.subscriptions set status_motivo = 'licença cortesia até ' || to_char(v_fim, 'DD/MM/YYYY') where id = p_sub_id;
  else
    insert into public.subscription_events (subscription_id, de, para, motivo, origem, ator_id, detalhe)
    values (p_sub_id, 'ativa', 'ativa', coalesce(p_motivo, 'licença cortesia'), v_ev_origem, auth.uid(),
            jsonb_build_object('cortesia', true, 'ate', v_fim, 'meses', p_meses, 'code_id', p_code_id, 'valor_centavos', 0));
  end if;

  insert into public.courtesy_grants (code_id, rotulo, subscription_id, club_id, origem, ator_id, fim)
  values (p_code_id, p_rotulo, p_sub_id, v_club, p_origem, auth.uid(), v_fim);
  return v_fim;
end;
$$;
revoke all on function public._cortesia_aplicar(uuid, int, text, uuid, text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- admin da plataforma
-- ---------------------------------------------------------------------------
create or replace function public.admin_cortesia_gerar(
  p_rotulo text, p_meses int default 12, p_max_usos int default 1, p_dias_para_resgate int default 90
) returns json
language plpgsql security definer set search_path = '' as $$
declare v_admin uuid := public._exigir_admin_plataforma(); v_rotulo text := nullif(btrim(coalesce(p_rotulo, '')), '');
        v_bruto text; v_codigo text; v_id uuid; v_ate timestamptz;
begin
  if v_rotulo is null then raise exception 'Dê um nome à cortesia (ex.: "Sorteio outubro 2026").'; end if;
  if p_meses is null or p_meses < 1 or p_meses > 36 then raise exception 'Duração inválida: use de 1 a 36 meses.'; end if;
  if p_max_usos is null or p_max_usos < 1 or p_max_usos > 500 then raise exception 'Número de usos inválido: use de 1 a 500.'; end if;
  if p_dias_para_resgate is null or p_dias_para_resgate < 1 or p_dias_para_resgate > 365 then
    raise exception 'Prazo para resgatar inválido: use de 1 a 365 dias.';
  end if;
  -- 16 caracteres hex (64 bits) em blocos, fácil de ditar: DC-XXXX-XXXX-XXXX-XXXX. Sai daqui UMA vez.
  v_bruto := upper(encode(extensions.gen_random_bytes(8), 'hex'));
  v_codigo := 'DC-' || substr(v_bruto, 1, 4) || '-' || substr(v_bruto, 5, 4) || '-' || substr(v_bruto, 9, 4) || '-' || substr(v_bruto, 13, 4);
  v_ate := now() + make_interval(days => p_dias_para_resgate);
  insert into public.courtesy_codes (codigo_hash, prefixo, rotulo, duracao_meses, max_usos, resgate_ate, criado_por)
  values (public._cortesia_hash(v_codigo), substr(v_bruto, 1, 4), left(v_rotulo, 160), p_meses, p_max_usos, v_ate, v_admin)
  returning id into v_id;
  perform public._admin_auditar('cortesia_gerar', 'courtesy_code', v_id,
    jsonb_build_object('rotulo', v_rotulo, 'meses', p_meses, 'max_usos', p_max_usos, 'resgate_ate', v_ate));
  return json_build_object('ok', true, 'id', v_id, 'codigo', v_codigo, 'resgate_ate', v_ate,
                           'duracao_meses', p_meses, 'max_usos', p_max_usos);
end;
$$;

create or replace function public.admin_cortesias_listar() returns json
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public._exigir_admin_plataforma();
  return coalesce((
    select json_agg(json_build_object(
      'id', c.id, 'prefixo', c.prefixo, 'rotulo', c.rotulo, 'duracao_meses', c.duracao_meses,
      'max_usos', c.max_usos, 'usos', c.usos, 'resgate_ate', c.resgate_ate, 'status', public._cortesia_status(c),
      'revogado_em', c.revogado_em, 'revogado_motivo', c.revogado_motivo, 'created_at', c.created_at,
      'resgates', coalesce((select json_agg(json_build_object('club_id', g.club_id, 'clube', u.nome, 'fim', g.fim,
                                                              'em', g.created_at, 'expirada_em', g.expirada_em) order by g.created_at)
                              from public.courtesy_grants g left join public.organizational_units u on u.id = g.club_id
                             where g.code_id = c.id), '[]'::json))
      order by c.created_at desc)
    from public.courtesy_codes c), '[]'::json);
end;
$$;

-- cortesias concedidas (inclusive as diretas do admin) — com a data de fim, pro /admin acompanhar
create or replace function public.admin_cortesias_concedidas() returns json
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public._exigir_admin_plataforma();
  return coalesce((
    select json_agg(json_build_object('id', g.id, 'club_id', g.club_id, 'clube', u.nome, 'origem', g.origem,
             'rotulo', g.rotulo, 'inicio', g.inicio, 'fim', g.fim, 'expirada_em', g.expirada_em,
             'status_assinatura', s.status) order by g.created_at desc)
      from public.courtesy_grants g
      join public.subscriptions s on s.id = g.subscription_id
      left join public.organizational_units u on u.id = g.club_id), '[]'::json);
end;
$$;

create or replace function public.admin_cortesia_revogar(p_id uuid, p_motivo text default null) returns json
language plpgsql security definer set search_path = '' as $$
declare v_admin uuid := public._exigir_admin_plataforma(); v_c public.courtesy_codes;
begin
  select * into v_c from public.courtesy_codes where id = p_id for update;
  if not found then raise exception 'Código de cortesia não encontrado.'; end if;
  if v_c.revogado_em is not null then return json_build_object('ok', true, 'sem_mudanca', true); end if;
  -- revogar o CÓDIGO não tira a cortesia de quem já resgatou (isso seria outro ato, explícito)
  update public.courtesy_codes set revogado_em = now(), revogado_motivo = nullif(btrim(coalesce(p_motivo, '')), '') where id = p_id;
  perform public._admin_auditar('cortesia_revogar', 'courtesy_code', p_id, jsonb_build_object('rotulo', v_c.rotulo, 'motivo', p_motivo));
  return json_build_object('ok', true, 'status', 'revogado');
end;
$$;

create or replace function public.admin_cortesia_apagar(p_id uuid) returns json
language plpgsql security definer set search_path = '' as $$
declare v_admin uuid := public._exigir_admin_plataforma(); v_c public.courtesy_codes;
begin
  select * into v_c from public.courtesy_codes where id = p_id for update;
  if not found then raise exception 'Código de cortesia não encontrado.'; end if;
  if public._cortesia_status(v_c) = 'ativo' then
    raise exception 'Código ainda ativo: revogue antes de apagar.';
  end if;
  delete from public.courtesy_codes where id = p_id;       -- courtesy_grants ficam (code_id vira nulo)
  perform public._admin_auditar('cortesia_apagar', 'courtesy_code', p_id,
    jsonb_build_object('rotulo', v_c.rotulo, 'usos', v_c.usos, 'max_usos', v_c.max_usos));
  return json_build_object('ok', true);
end;
$$;

-- ganhador que já tinha clube (em teste, aguardando pagamento...): o admin aplica direto
create or replace function public.admin_cortesia_aplicar(p_club_id uuid, p_meses int default 12, p_motivo text default null) returns json
language plpgsql security definer set search_path = '' as $$
declare v_admin uuid := public._exigir_admin_plataforma(); v_sub uuid; v_fim timestamptz; v_motivo text;
begin
  v_sub := public._admin_assinatura_viva_do_clube(p_club_id);
  if v_sub is null then raise exception 'Este clube não tem assinatura viva para receber a cortesia.'; end if;
  v_motivo := coalesce(nullif(btrim(coalesce(p_motivo, '')), ''), 'licença cortesia concedida pela administração');
  v_fim := public._cortesia_aplicar(v_sub, p_meses, 'admin', null, v_motivo, v_motivo);
  perform public._admin_auditar('cortesia_aplicar', 'club', p_club_id,
    jsonb_build_object('subscription_id', v_sub, 'meses', p_meses, 'ate', v_fim, 'motivo', v_motivo));
  return json_build_object('ok', true, 'ate', v_fim, 'status', 'ativa');
end;
$$;

-- ---------------------------------------------------------------------------
-- resgate pelo dono do onboarding
-- ---------------------------------------------------------------------------
create or replace function public.onboarding_cortesia_resgatar(p_codigo text) returns json
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_s public.onboarding_sessions; v_c public.courtesy_codes; v_fim timestamptz;
begin
  if v_uid is null then raise exception 'Faça login para continuar.'; end if;
  if (select count(*) from public.courtesy_attempts
       where user_id = v_uid and not acertou and quando > now() - interval '10 minutes') >= 10 then
    raise exception 'Muitas tentativas. Espere alguns minutos e tente de novo.';
  end if;

  select * into v_s from public.onboarding_sessions where user_id = v_uid and status = 'em_andamento' for update;
  if not found then raise exception 'Nenhum cadastro de clube em andamento.'; end if;
  if v_s.subscription_id is null then raise exception 'Crie o clube antes de usar o código de cortesia.'; end if;
  if exists (select 1 from public.courtesy_grants where subscription_id = v_s.subscription_id and expirada_em is null and fim > now()) then
    raise exception 'Este clube já está com licença cortesia.';
  end if;

  select * into v_c from public.courtesy_codes where codigo_hash = public._cortesia_hash(p_codigo) for update;
  if not found or public._cortesia_status(v_c) <> 'ativo' then
    insert into public.courtesy_attempts (user_id, acertou) values (v_uid, false);
    delete from public.courtesy_attempts where quando < now() - interval '1 day';
    -- mensagem única: não revela se o código existe, foi usado, revogado ou expirou
    return json_build_object('ok', false, 'erro', 'Código de cortesia inválido, expirado ou já utilizado.');
  end if;
  insert into public.courtesy_attempts (user_id, acertou) values (v_uid, true);

  update public.courtesy_codes set usos = usos + 1 where id = v_c.id;
  v_fim := public._cortesia_aplicar(v_s.subscription_id, v_c.duracao_meses, 'resgate', v_c.id, v_c.rotulo,
                                    'licença cortesia resgatada: ' || v_c.rotulo);
  insert into public.platform_admin_audit (admin_user_id, acao, alvo_tipo, alvo_id, detalhe)
  values (v_uid, 'cortesia_resgatar', 'courtesy_code', v_c.id,
          jsonb_build_object('ator', 'titular_do_onboarding', 'subscription_id', v_s.subscription_id,
                             'club_id', v_s.club_id, 'ate', v_fim, 'rotulo', v_c.rotulo));
  return json_build_object('ok', true, 'ate', v_fim, 'meses', v_c.duracao_meses, 'rotulo', v_c.rotulo);
end;
$$;

-- ---------------------------------------------------------------------------
-- fim da cortesia -> fluxo normal (aguardando pagamento), igual ao fim do teste
-- ---------------------------------------------------------------------------
create or replace function public.cortesias_expirar() returns int
language plpgsql security definer set search_path = '' as $$
declare r record; n int := 0;
begin
  for r in select s.id, s.periodo_fim from public.subscriptions s
            where s.provider = 'cortesia' and s.status <> 'cancelada' and s.periodo_fim <= now()
            for update skip locked loop
    update public.subscriptions
       set provider = 'mock',
           metadata = jsonb_set(coalesce(metadata, '{}'::jsonb), '{cortesia,expirada_em}', to_jsonb(now()), true),
           updated_at = now()
     where id = r.id;
    update public.courtesy_grants set expirada_em = now() where subscription_id = r.id and expirada_em is null;
    if (select status from public.subscriptions where id = r.id) = 'ativa' then
      perform public._assinatura_transicionar(r.id, 'pagamento_pendente', 'licença cortesia terminou — aguardando pagamento',
        'sistema', jsonb_build_object('cortesia_fim', r.periodo_fim));
    end if;
    n := n + 1;
  end loop;
  return n;
end;
$$;
revoke all on function public.cortesias_expirar() from public, anon, authenticated;
grant execute on function public.cortesias_expirar() to service_role;

select cron.schedule('expirar-cortesias', '15 4 * * *', 'select public.cortesias_expirar()')
 where not exists (select 1 from cron.job where jobname = 'expirar-cortesias');

-- ---------------------------------------------------------------------------
-- o clube vê "Licença cortesia até dd/mm/aaaa" (mesmo corpo da 48 + campo cortesia)
-- ---------------------------------------------------------------------------
create or replace function public.assinatura_do_clube() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_club uuid := public.clube_atual_id(); v_sub record; v_plan record;
begin
  if v_club is null or not public.membro_ativo_no_clube(v_club) then
    raise exception 'Sem clube em uso.';
  end if;
  select s.* into v_sub from public.subscriptions s where s.id = public.assinatura_do_clube_id(v_club);
  if not found then
    return jsonb_build_object('tem_assinatura', false, 'clube_id', v_club,
      'recursos', public.recursos_do_clube(v_club), 'limites', public.limites_do_clube(v_club),
      'aviso', 'Este clube não está vinculado a nenhuma assinatura — nenhum limite comercial se aplica.');
  end if;
  select p.* into v_plan from public.billing_plans p where p.id = v_sub.plan_id;
  return jsonb_build_object(
    'tem_assinatura', true,
    'clube_id', v_club,
    'plano', jsonb_build_object('chave', v_plan.chave, 'versao', v_plan.versao, 'nome', v_plan.nome,
                                'descricao', v_plan.descricao, 'provisorio', v_plan.provisorio),
    'status', v_sub.status,
    'status_motivo', v_sub.status_motivo,
    'ciclo', v_sub.ciclo,
    'trial_ate', v_sub.trial_ate,
    'periodo_fim', v_sub.periodo_fim,
    'cortesia', case when v_sub.provider = 'cortesia' then jsonb_build_object('ate', v_sub.periodo_fim) end,
    'recursos', public.recursos_do_clube(v_club),
    'limites', public.limites_do_clube(v_club),
    'pode_mudar_plano', false
  );
end;
$$;
revoke all on function public.assinatura_do_clube() from public, anon;
grant execute on function public.assinatura_do_clube() to authenticated;

do $$
declare f text;
begin
  foreach f in array array['admin_cortesia_gerar(text, int, int, int)', 'admin_cortesias_listar()',
                           'admin_cortesias_concedidas()', 'admin_cortesia_revogar(uuid, text)',
                           'admin_cortesia_apagar(uuid)', 'admin_cortesia_aplicar(uuid, int, text)',
                           'onboarding_cortesia_resgatar(text)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

notify pgrst, 'reload schema';

insert into public.migracoes_aplicadas (arquivo)
values ('2026-09-30-licenca-cortesia.sql')
on conflict (arquivo) do update set aplicada_em = now();
