-- =====================================================================
-- Fase 5 — FUNDAÇÃO COMERCIAL SaaS do DesbravaClube. Rodar DEPOIS da 20260921000047. Idempotente.
--
-- Isto é o MOTOR COMERCIAL, independente de provedor. NENHUM gateway é integrado aqui (nem Stripe,
-- nem Mercado Pago, nem Asaas): existe uma INTERFACE de provedor + um provedor `mock` local, que
-- serve pra provar pagamento aprovado/recusado/atraso, renovação, cancelamento e webhook duplicado.
--
-- Cadeia modelada:
--   conta/cliente (billing_accounts) → assinatura (subscriptions) → plano versionado (billing_plans)
--     → recursos/limites (recursos[] + limites{}) → clubes cobertos (subscription_clubs)
--     → cobrança (billing_invoices) → status comercial (subscriptions.status)
--
-- PRINCÍPIOS DESTA FASE (cada um vira teste no supabase/tests/43):
--
--  1. ASSINATURA NÃO É VÍNCULO. `organization_memberships` continua sendo a única fonte de autorização
--     de PESSOA. Clube inadimplente/suspenso não apaga ninguém, não desliga vínculo, não some com
--     dado: no máximo para a ESCRITA NOVA de recursos opcionais. Uma pessoa continua existindo.
--
--  2. TRÊS CAMADAS DISTINTAS, e uma operação só acontece quando as três permitirem:
--        recurso disponível no PLANO  → public.recurso_disponivel_no_plano(clube, recurso)
--        recurso habilitado pelo CLUBE → escolha em club_features, senão o padrão do catálogo
--        permissão do USUÁRIO          → pode_gerir_no_clube / membro_ativo_no_clube (o de sempre)
--     A integração é por DENTRO do entitlement que já existe: `recurso_habilitado_no_clube()` passa a
--     ser "plano E clube". Não nasce um segundo sistema de feature flags — os 17 gatilhos
--     `trg_exigir_recurso` da migration 34 passam a respeitar o plano de graça.
--
--  3. NADA É APAGADO por inadimplência ou cancelamento. A política comercial é configurável
--     (billing_policies), mas a coluna `nunca_apagar_dados` tem CHECK de valor verdadeiro: é
--     estruturalmente impossível configurar uma política que apague dados.
--
--  4. PREÇO NÃO MORA NO REACT. O catálogo de planos e preços é versionado no banco e lido pelo app.
--     Os valores semeados aqui são PROVISÓRIOS (billing_plans.provisorio / billing_prices.provisorio):
--     são placeholders de estrutura, não a decisão comercial — que ainda não foi tomada.
--
--  5. ADMIN DA PLATAFORMA NÃO É AUTORIDADE ECLESIÁSTICA. Mora em `platform_admins`, NUNCA em
--     organization_memberships. Não ganha NENHUMA policy nova sobre dado de clube: sem vínculo ele
--     continua sem clube_atual_id() e portanto sem foto, chat, evidência, responsável ou conteúdo.
--     Ele enxerga operação SaaS (contas, planos, assinaturas, status, uso, falhas de provisionamento).
--
--  6. SUPORTE É PEDIDO, NÃO PODER. `support_grants` modela impersonação assistida com autorização
--     EXPLÍCITA do clube, prazo obrigatório, motivo e auditoria. Nesta fase o acesso NÃO é
--     implementado: nenhuma policy consulta o grant (o teste 43 verifica isso por estrutura).
--
--  7. WEBHOOK É IDEMPOTENTE DESDE O PRIMEIRO DIA: unique (provider, evento_externo_id) e o receptor
--     devolve `duplicado: true` sem reprocessar.
--
--  8. TENANT 001 INTEIRO. Clube sem assinatura = comportamento de hoje, bit a bit (a camada do plano
--     devolve "disponível"). O plano `legado-fundador` já está no catálogo pra ser atribuído a ele no
--     futuro sem mudar nada: recursos = todos, limites = nenhum.
-- =====================================================================

-- ---------------------------------------------------------------------
-- A) CONTA / CLIENTE COMERCIAL  (separada da identidade eclesiástica)
-- ---------------------------------------------------------------------
create table if not exists public.billing_accounts (
  id uuid primary key default gen_random_uuid(),
  nome text not null check (length(btrim(nome)) between 2 and 120),
  documento text,                       -- CNPJ/CPF do responsável comercial (opcional nesta fase)
  email_cobranca text,
  telefone text,
  pais text not null default 'BR',
  timezone text not null default 'America/Recife',
  status text not null default 'ativa' check (status in ('ativa', 'suspensa', 'encerrada')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- quem responde pela conta COMERCIAL. Não é papel de clube, não é vínculo eclesiástico, não dá
-- acesso a nenhum dado operacional: só a conta, o plano, a assinatura e as cobranças dela.
create table if not exists public.billing_account_contacts (
  id uuid primary key default gen_random_uuid(),
  billing_account_id uuid not null references public.billing_accounts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  papel text not null check (papel in ('titular', 'financeiro', 'leitura')),
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  unique (billing_account_id, user_id)
);
create index if not exists idx_billing_contacts_user on public.billing_account_contacts (user_id) where ativo;

create or replace function public.eh_contato_da_conta(p_account_id uuid, p_uid uuid default null) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.billing_account_contacts c
    where c.billing_account_id = p_account_id and c.ativo
      and c.user_id = coalesce(p_uid, auth.uid())
  );
$$;
revoke all on function public.eh_contato_da_conta(uuid, uuid) from public, anon;
grant execute on function public.eh_contato_da_conta(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------
-- B) ADMINISTRADOR DA PLATAFORMA (definido cedo: várias policias abaixo dependem dele)
-- ---------------------------------------------------------------------
-- Papel de OPERAÇÃO DO PRODUTO, não de igreja. Por isso mora aqui e não em organization_memberships:
-- misturar os dois transformaria "quem opera o SaaS" numa autoridade sobre clubes — que é exatamente
-- o que a fase 4.3 provou que não pode acontecer.
create table if not exists public.platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  papel text not null check (papel in ('suporte', 'operacao', 'owner')),
  ativo boolean not null default true,
  motivo text,
  criado_por uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Sem parâmetro = "eu". NUNCA olha organization_memberships: ser diretor de clube não torna ninguém
-- administrador da plataforma, e vice-versa.
create or replace function public.eh_admin_plataforma(p_uid uuid default null) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.platform_admins a
    where a.user_id = coalesce(p_uid, auth.uid()) and a.ativo
  );
$$;
revoke all on function public.eh_admin_plataforma(uuid) from public, anon;
grant execute on function public.eh_admin_plataforma(uuid) to authenticated;

create or replace function public._exigir_admin_plataforma() returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null or not public.eh_admin_plataforma(v_uid) then
    raise exception 'Sem permissão (administração da plataforma DesbravaClube).';
  end if;
  return v_uid;
end;
$$;
revoke all on function public._exigir_admin_plataforma() from public, anon, authenticated;

-- auditoria de ações administrativas: imutável, com quem/o quê/quando/sobre quem.
create table if not exists public.platform_admin_audit (
  id uuid primary key default gen_random_uuid(),
  admin_user_id uuid references auth.users(id) on delete set null,
  acao text not null,
  alvo_tipo text not null,
  alvo_id uuid,
  detalhe jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_admin_audit_alvo on public.platform_admin_audit (alvo_tipo, alvo_id, created_at desc);

create or replace function public._admin_auditar(p_acao text, p_alvo_tipo text, p_alvo_id uuid, p_detalhe jsonb default '{}'::jsonb)
returns void language sql security definer set search_path = '' as $$
  insert into public.platform_admin_audit (admin_user_id, acao, alvo_tipo, alvo_id, detalhe)
  values (auth.uid(), p_acao, p_alvo_tipo, p_alvo_id, coalesce(p_detalhe, '{}'::jsonb));
$$;
revoke all on function public._admin_auditar(text, text, uuid, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- C) CATÁLOGO VERSIONADO DE PLANOS E PREÇOS
-- ---------------------------------------------------------------------
-- Versionado como o currículo (chave + versão): mudar um plano NÃO reescreve o que os clientes já
-- assinaram — publica-se uma versão nova. A assinatura aponta pra UMA versão específica.
create table if not exists public.billing_plans (
  id uuid primary key default gen_random_uuid(),
  chave text not null check (chave ~ '^[a-z][a-z0-9-]{1,39}$'),
  versao int not null check (versao >= 1),
  nome text not null,
  descricao text not null default '',
  publico boolean not null default true,          -- aparece na vitrine (plano legado/interno = false)
  status text not null default 'publicado' check (status in ('rascunho', 'publicado', 'arquivado')),
  ativo boolean not null default true,
  -- recursos: chaves de recursos_catalogo liberadas por este plano. NULL = TODOS (sem teto de módulo).
  recursos text[],
  -- limites: {"membros": 80, "administradores": 5, "clubes": 1, "fotos": 2000, "armazenamento_mb": 1024}
  -- chave ausente ou null = ILIMITADO. Ver `limite_uso` pra como cada um é medido.
  limites jsonb not null default '{}'::jsonb,
  -- a composição deste plano é PLACEHOLDER de estrutura, não decisão comercial fechada
  provisorio boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (chave, versao)
);

-- os recursos do plano só podem ser recursos que o app realmente tem (o mesmo catálogo de sempre).
-- Array não aceita FK; o gatilho faz o papel dela — e impede que o comercial invente módulo.
create or replace function public._validar_recursos_do_plano() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_invalidos text[];
begin
  if new.recursos is null then return new; end if;
  select array_agg(r) into v_invalidos from unnest(new.recursos) r
   where not exists (select 1 from public.recursos_catalogo c where c.chave = r);
  if v_invalidos is not null then
    raise exception 'Plano cita recurso que não existe no catálogo do app: %', array_to_string(v_invalidos, ', ');
  end if;
  return new;
end;
$$;
revoke all on function public._validar_recursos_do_plano() from public, anon, authenticated;
drop trigger if exists trg_validar_recursos_do_plano on public.billing_plans;
create trigger trg_validar_recursos_do_plano before insert or update on public.billing_plans
for each row execute function public._validar_recursos_do_plano();

create table if not exists public.billing_prices (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.billing_plans(id) on delete cascade,
  moeda text not null default 'BRL' check (moeda ~ '^[A-Z]{3}$'),
  ciclo text not null check (ciclo in ('mensal', 'anual')),
  valor_centavos bigint not null check (valor_centavos >= 0),
  ativo boolean not null default true,
  -- VALOR PROVISÓRIO: placeholder até a decisão comercial. O app mostra isso ao usuário.
  provisorio boolean not null default true,
  vigente_de timestamptz not null default now(),
  vigente_ate timestamptz,
  created_at timestamptz not null default now(),
  unique (plan_id, moeda, ciclo, vigente_de)
);

-- ---------------------------------------------------------------------
-- D) POLÍTICA COMERCIAL CONFIGURÁVEL (carência e suspensão) — versionada
-- ---------------------------------------------------------------------
create table if not exists public.billing_policies (
  id uuid primary key default gen_random_uuid(),
  chave text not null,
  versao int not null check (versao >= 1),
  ativo boolean not null default true,
  trial_dias int not null default 30 check (trial_dias >= 0),
  -- dias de CARÊNCIA depois do vencimento antes de qualquer consequência
  carencia_dias int not null default 5 check (carencia_dias >= 0),
  -- dias (após a carência) até marcar inadimplente
  dias_ate_inadimplente int not null default 10 check (dias_ate_inadimplente >= 0),
  -- dias (após inadimplente) até suspender
  dias_ate_suspensao int not null default 30 check (dias_ate_suspensao >= 0),
  -- o que a suspensão faz: parar ESCRITA NOVA de recurso opcional. Nunca apagar.
  suspensao_bloqueia_recursos boolean not null default true,
  -- garantia ESTRUTURAL: não existe política que apague dados por inadimplência/cancelamento.
  nunca_apagar_dados boolean not null default true check (nunca_apagar_dados),
  observacao text not null default '',
  created_at timestamptz not null default now(),
  unique (chave, versao)
);

create or replace function public.politica_comercial() returns public.billing_policies
language sql stable security definer set search_path = '' as $$
  select * from public.billing_policies where ativo order by chave = 'padrao' desc, versao desc limit 1;
$$;
revoke all on function public.politica_comercial() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- E) ASSINATURA + CLUBES COBERTOS
-- ---------------------------------------------------------------------
-- Ciclo comercial: trial → ativa → pagamento_pendente → inadimplente → suspensa → cancelada
-- (e reativação de qualquer um dos intermediários de volta pra ativa, quando a cobrança é paga).
create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  billing_account_id uuid not null references public.billing_accounts(id) on delete restrict,
  plan_id uuid not null references public.billing_plans(id) on delete restrict,
  price_id uuid references public.billing_prices(id) on delete set null,
  status text not null default 'trial'
    check (status in ('trial', 'ativa', 'pagamento_pendente', 'inadimplente', 'suspensa', 'cancelada')),
  ciclo text not null default 'mensal' check (ciclo in ('mensal', 'anual')),
  trial_ate timestamptz,
  periodo_inicio timestamptz not null default now(),
  periodo_fim timestamptz,
  provider text not null default 'mock',
  provider_ref text,                 -- id da assinatura no provedor, quando houver
  cancelada_em timestamptz,
  cancelamento_motivo text,
  status_motivo text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- uma conta tem no máximo UMA assinatura viva (canceladas ficam no histórico, nunca são apagadas)
create unique index if not exists uq_subscription_viva_por_conta
  on public.subscriptions (billing_account_id) where status <> 'cancelada';

-- histórico imutável das transições comerciais (auditoria do ciclo)
create table if not exists public.subscription_events (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references public.subscriptions(id) on delete cascade,
  de text,
  para text not null,
  motivo text,
  origem text not null default 'sistema' check (origem in ('sistema', 'webhook', 'admin', 'onboarding')),
  ator_id uuid references auth.users(id) on delete set null,
  detalhe jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_subscription_events_sub on public.subscription_events (subscription_id, created_at desc);

-- CLUBES COBERTOS pela assinatura. Um clube é coberto por no máximo uma assinatura.
create table if not exists public.subscription_clubs (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references public.subscriptions(id) on delete cascade,
  club_id uuid not null unique references public.organizational_units(id) on delete restrict,
  incluido_em timestamptz not null default now()
);
create index if not exists idx_subscription_clubs_sub on public.subscription_clubs (subscription_id);

-- ---------------------------------------------------------------------
-- F) COBRANÇA
-- ---------------------------------------------------------------------
create table if not exists public.billing_invoices (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references public.subscriptions(id) on delete restrict,
  competencia date not null,
  moeda text not null default 'BRL',
  valor_centavos bigint not null check (valor_centavos >= 0),
  status text not null default 'aberta' check (status in ('aberta', 'paga', 'vencida', 'cancelada', 'reembolsada')),
  vence_em date not null,
  pago_em timestamptz,
  provider text not null default 'mock',
  provider_ref text,                 -- id da cobrança no provedor (o webhook casa por aqui)
  tentativas int not null default 0,
  ultimo_erro text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (subscription_id, competencia)
);
create index if not exists idx_invoices_provider_ref on public.billing_invoices (provider, provider_ref);

-- ---------------------------------------------------------------------
-- G) INTERFACE DE PROVEDOR + WEBHOOKS IDEMPOTENTES
-- ---------------------------------------------------------------------
create table if not exists public.billing_providers (
  chave text primary key check (chave ~ '^[a-z][a-z0-9_-]{1,29}$'),
  nome text not null,
  tipo text not null check (tipo in ('mock', 'externo')),
  ativo boolean not null default true,
  -- eventos que o motor entende. Um provedor externo traduz os nomes dele PRA CÁ (adaptador),
  -- e o motor nunca conhece o vocabulário de nenhum gateway.
  eventos_suportados text[] not null default
    array['pagamento_aprovado', 'pagamento_recusado', 'pagamento_atrasado', 'renovacao', 'cancelamento'],
  created_at timestamptz not null default now()
);
insert into public.billing_providers (chave, nome, tipo) values
  ('mock', 'Provedor local de teste (mock)', 'mock')
on conflict (chave) do update set nome = excluded.nome, tipo = excluded.tipo;

-- Idempotência de webhook: a unicidade é do BANCO, não da aplicação. Reentrega do mesmo evento
-- (o caso mais comum e mais destrutivo de todo gateway) não reprocessa nada.
create table if not exists public.billing_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null references public.billing_providers(chave) on update cascade,
  evento_externo_id text not null,
  tipo text not null,
  payload jsonb not null default '{}'::jsonb,
  subscription_id uuid references public.subscriptions(id) on delete set null,
  invoice_id uuid references public.billing_invoices(id) on delete set null,
  status text not null default 'recebido' check (status in ('recebido', 'processado', 'ignorado', 'falhou')),
  resultado jsonb not null default '{}'::jsonb,
  erro text,
  recebido_em timestamptz not null default now(),
  processado_em timestamptz,
  unique (provider, evento_externo_id)
);
create index if not exists idx_billing_events_sub on public.billing_events (subscription_id, recebido_em desc);

-- ---------------------------------------------------------------------
-- H) SUPORTE TEMPORÁRIO / IMPERSONAÇÃO ASSISTIDA — modelo, NÃO acesso
-- ---------------------------------------------------------------------
-- O administrador PEDE; a liderança do clube AUTORIZA, com prazo. Nesta fase o grant não abre
-- absolutamente nada: nenhuma policy o consulta (teste 43 confere isso por estrutura). Ele existe
-- pra que, quando o acesso for implementado, já nasça com autorização explícita, prazo, motivo e
-- auditoria — e não como "o suporte vê tudo".
create table if not exists public.support_grants (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.organizational_units(id) on delete cascade,
  admin_user_id uuid not null references auth.users(id) on delete cascade,
  motivo text not null check (length(btrim(motivo)) >= 10),
  escopo text not null default 'operacional_leitura' check (escopo in ('operacional_leitura')),
  status text not null default 'solicitado'
    check (status in ('solicitado', 'autorizado', 'recusado', 'expirado', 'revogado')),
  solicitado_em timestamptz not null default now(),
  autorizado_por uuid references auth.users(id) on delete set null,
  autorizado_em timestamptz,
  expira_em timestamptz,
  revogado_em timestamptz,
  revogado_por uuid references auth.users(id) on delete set null,
  revogado_motivo text,
  created_at timestamptz not null default now(),
  -- autorizado SEM prazo é proibido pelo próprio schema
  constraint support_grant_autorizado_tem_prazo
    check (status <> 'autorizado' or (autorizado_por is not null and autorizado_em is not null
           and expira_em is not null and expira_em > autorizado_em))
);
create index if not exists idx_support_grants_clube on public.support_grants (club_id, status);

-- Existe, é auditável e é FECHADA: só devolve true com grant autorizado, não revogado e dentro do prazo.
-- Nenhuma policy desta fase a consulta — é a porta que amanhã será ligada, com a tranca já instalada.
create or replace function public.suporte_acesso_vigente(p_club_id uuid, p_uid uuid default null) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.support_grants g
    where g.club_id = p_club_id
      and g.admin_user_id = coalesce(p_uid, auth.uid())
      and g.status = 'autorizado'
      and g.revogado_em is null
      and g.expira_em > now()
  );
$$;
revoke all on function public.suporte_acesso_vigente(uuid, uuid) from public, anon;
grant execute on function public.suporte_acesso_vigente(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------
-- I) PROVISIONAMENTO: conferência e falhas visíveis pra operação
-- ---------------------------------------------------------------------
create table if not exists public.club_provisioning_status (
  club_id uuid primary key references public.organizational_units(id) on delete cascade,
  status text not null check (status in ('ok', 'incompleto', 'falhou')),
  detalhe jsonb not null default '{}'::jsonb,
  tentativas int not null default 1,
  erro text,
  verificado_em timestamptz not null default now()
);

-- Confere que o clube novo REALMENTE nasceu completo (o gatilho trg_provisionar_clube roda os
-- módulos _prov_*; aqui se verifica o RESULTADO). Não reprovisiona nada — só olha e registra.
create or replace function public._provisionamento_conferir(p_club_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_det jsonb; v_falta text[] := '{}'; v_status text;
begin
  -- um por módulo _prov_* da migration 20: config, jogos, chat, conteúdo e duelos
  v_det := jsonb_build_object(
    'config', (select count(*) from public.config_clube where club_id = p_club_id),
    'jogos_trilha', (select count(*) from public.jogos_trilha where club_id = p_club_id),
    'chat_conversas', (select count(*) from public.chat_conversas where club_id = p_club_id),
    'conteudo_desafios', (select count(*) from public.desafios where club_id = p_club_id),
    'duelos_modelos', (select count(*) from public.desafios_unidade where club_id = p_club_id)
  );
  if (v_det ->> 'config')::int = 0 then v_falta := v_falta || 'config'; end if;
  if (v_det ->> 'jogos_trilha')::int = 0 then v_falta := v_falta || 'jogos_trilha'; end if;
  if (v_det ->> 'chat_conversas')::int = 0 then v_falta := v_falta || 'chat_conversas'; end if;
  if (v_det ->> 'conteudo_desafios')::int = 0 then v_falta := v_falta || 'conteudo_desafios'; end if;
  if (v_det ->> 'duelos_modelos')::int = 0 then v_falta := v_falta || 'duelos_modelos'; end if;
  v_status := case when cardinality(v_falta) = 0 then 'ok' else 'incompleto' end;

  insert into public.club_provisioning_status (club_id, status, detalhe, tentativas, verificado_em)
  values (p_club_id, v_status, v_det || jsonb_build_object('faltando', to_jsonb(v_falta)), 1, now())
  on conflict (club_id) do update
    set status = excluded.status, detalhe = excluded.detalhe, erro = null,
        tentativas = public.club_provisioning_status.tentativas + 1, verificado_em = now();

  return jsonb_build_object('status', v_status, 'faltando', to_jsonb(v_falta), 'detalhe', v_det);
end;
$$;
revoke all on function public._provisionamento_conferir(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- J) AS TRÊS CAMADAS: plano → clube → usuário
-- ---------------------------------------------------------------------
-- 1ª camada. Qual assinatura cobre este clube? (nenhuma = clube não cobrado = comportamento de hoje)
create or replace function public.assinatura_do_clube_id(p_club_id uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select s.id
  from public.subscription_clubs sc
  join public.subscriptions s on s.id = sc.subscription_id
  where sc.club_id = p_club_id
  order by (s.status = 'cancelada'), s.created_at desc
  limit 1;
$$;
revoke all on function public.assinatura_do_clube_id(uuid) from public, anon, authenticated;

-- O recurso está DISPONÍVEL NO PLANO deste clube?
--   * sem assinatura  -> true  (Tenant 001 e qualquer clube não cobrado seguem exatamente como hoje)
--   * suspensa/cancelada -> false quando a política manda bloquear (nada é apagado; só para a escrita nova)
--   * plano com recursos = NULL -> todos os recursos
create or replace function public.recurso_disponivel_no_plano(p_club_id uuid, p_feature text) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare v_sub record; v_plan record; v_bloqueia boolean;
begin
  if p_club_id is null then return false; end if;
  select s.* into v_sub from public.subscriptions s where s.id = public.assinatura_do_clube_id(p_club_id);
  if not found then return true; end if;

  if v_sub.status in ('suspensa', 'cancelada') then
    select coalesce(p.suspensao_bloqueia_recursos, true) into v_bloqueia from public.politica_comercial() p;
    if coalesce(v_bloqueia, true) then return false; end if;
  end if;

  select p.* into v_plan from public.billing_plans p where p.id = v_sub.plan_id;
  if not found then return false; end if;
  return v_plan.recursos is null or p_feature = any (v_plan.recursos);
end;
$$;
revoke all on function public.recurso_disponivel_no_plano(uuid, text) from public, anon;
grant execute on function public.recurso_disponivel_no_plano(uuid, text) to authenticated;

-- 2ª camada integrada à 1ª, POR DENTRO do entitlement que já existia (migrations 7/33/34).
-- Assim os 17 gatilhos trg_exigir_recurso passam a respeitar o plano sem uma linha nova de gate,
-- e não nasce um segundo sistema de feature flags.
create or replace function public.recurso_habilitado_no_clube(p_club_id uuid, p_feature text) returns boolean
language sql stable security definer set search_path = 'public' as $$
  select public.recurso_disponivel_no_plano(p_club_id, p_feature)
     and coalesce(
       (select enabled from public.club_features where club_id = p_club_id and feature = p_feature),
       (select padrao from public.recursos_catalogo where chave = p_feature),
       false);
$$;

-- mapa {recurso: ligado?} — mesma composição das duas camadas (o app inteiro lê daqui).
-- O plano é resolvido UMA vez (e não uma por recurso): isto roda em todo meu_contexto().
create or replace function public.recursos_do_clube(p_club_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_sub record; v_plan record; v_bloqueia boolean; v_permitidos text[]; v_tudo boolean := true;
begin
  select s.* into v_sub from public.subscriptions s where s.id = public.assinatura_do_clube_id(p_club_id);
  if found then
    select p.* into v_plan from public.billing_plans p where p.id = v_sub.plan_id;
    select coalesce(pol.suspensao_bloqueia_recursos, true) into v_bloqueia from public.politica_comercial() pol;
    if v_sub.status in ('suspensa', 'cancelada') and coalesce(v_bloqueia, true) then
      v_tudo := false; v_permitidos := '{}';                       -- nada disponível; nada apagado
    elsif v_plan.id is null then
      v_tudo := false; v_permitidos := '{}';
    elsif v_plan.recursos is not null then
      v_tudo := false; v_permitidos := v_plan.recursos;
    end if;
  end if;

  return coalesce((
    select jsonb_object_agg(c.chave,
             (v_tudo or c.chave = any (coalesce(v_permitidos, '{}'))) and coalesce(f.enabled, c.padrao))
    from public.recursos_catalogo c
    left join public.club_features f on f.club_id = p_club_id and f.feature = c.chave), '{}'::jsonb);
end;
$$;
revoke all on function public.recursos_do_clube(uuid) from public, anon, authenticated;

-- as três camadas EXPLÍCITAS, pra tela poder dizer O QUE bloqueou (e não um "sem permissão" genérico)
create or replace function public.recurso_situacao(p_club_id uuid, p_feature text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'recurso', p_feature,
    'no_plano', public.recurso_disponivel_no_plano(p_club_id, p_feature),
    'no_clube', coalesce(
      (select enabled from public.club_features where club_id = p_club_id and feature = p_feature),
      (select padrao from public.recursos_catalogo where chave = p_feature), false),
    'efetivo', public.recurso_habilitado_no_clube(p_club_id, p_feature)
  );
$$;
-- a tela precisa poder dizer "não está no seu plano" vs "a diretoria desligou": nada aqui revela
-- dado de outro clube — é o estado do recurso no clube que a pessoa já enxerga.
revoke all on function public.recurso_situacao(uuid, text) from public, anon;
grant execute on function public.recurso_situacao(uuid, text) to authenticated;

-- A pergunta que a tela realmente faz: "eu, agora, neste clube, posso?". Responde com a CAMADA que
-- barrou — plano (comercial), clube (escolha da diretoria) ou usuário (permissão).
create or replace function public.operacao_permitida(p_feature text, p_acao text default 'usar') returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_club uuid := public.clube_atual_id(); v_plano boolean; v_clube boolean; v_user boolean; v_bloqueio text;
begin
  if p_acao not in ('ver', 'usar', 'gerir') then raise exception 'Ação inválida.'; end if;
  if v_club is null then
    return jsonb_build_object('permitido', false, 'bloqueio', 'usuario',
      'camadas', jsonb_build_object('plano', null, 'clube', null, 'usuario', false),
      'mensagem', 'Sem clube em uso.');
  end if;
  v_plano := public.recurso_disponivel_no_plano(v_club, p_feature);
  v_clube := coalesce(
    (select enabled from public.club_features where club_id = v_club and feature = p_feature),
    (select padrao from public.recursos_catalogo where chave = p_feature), false);
  v_user := case p_acao when 'gerir' then public.pode_gerir_no_clube(v_club) else public.membro_ativo_no_clube(v_club) end;

  v_bloqueio := case when not v_plano then 'plano' when not v_clube then 'clube' when not v_user then 'usuario' end;
  return jsonb_build_object(
    'permitido', v_plano and v_clube and v_user,
    'bloqueio', v_bloqueio,
    'camadas', jsonb_build_object('plano', v_plano, 'clube', v_clube, 'usuario', v_user),
    'mensagem', case v_bloqueio
      when 'plano'   then 'Este recurso não está incluído no plano deste clube.'
      when 'clube'   then 'A diretoria deste clube deixou este recurso desligado.'
      when 'usuario' then 'Você não tem permissão para esta ação neste clube.'
      else 'ok' end);
end;
$$;
revoke all on function public.operacao_permitida(text, text) from public, anon;
grant execute on function public.operacao_permitida(text, text) to authenticated;

-- ---------------------------------------------------------------------
-- K) LIMITES DO PLANO (medidos de verdade; o que não dá pra medir honestamente é declarado pendente)
-- ---------------------------------------------------------------------
create or replace function public.plano_limite(p_club_id uuid, p_chave text) returns bigint
language plpgsql stable security definer set search_path = '' as $$
declare v_sub record; v_val text;
begin
  select s.* into v_sub from public.subscriptions s where s.id = public.assinatura_do_clube_id(p_club_id);
  if not found then return null; end if;                      -- sem assinatura = sem teto
  select nullif(p.limites ->> p_chave, '') into v_val from public.billing_plans p where p.id = v_sub.plan_id;
  return case when v_val ~ '^\d+$' then v_val::bigint end;    -- ausente/null/não-numérico = ilimitado
end;
$$;
revoke all on function public.plano_limite(uuid, text) from public, anon, authenticated;

-- Uso ATUAL de cada limite. NULL = a plataforma ainda não sabe medir isto (e diz isso, em vez de
-- inventar um número): hoje é o caso de `armazenamento_mb` — os objetos do Storage não carregam o
-- clube no caminho (perfis/, mural/, unidades/), então medir por clube exige mudar a convenção de
-- caminho. Está declarado no plano e PENDENTE de medição, de propósito.
create or replace function public.limite_uso(p_club_id uuid, p_chave text) returns bigint
language sql stable security definer set search_path = '' as $$
  select case p_chave
    when 'membros' then (
      select count(*) from public.organization_memberships m
       where m.organizational_unit_id = p_club_id and m.status = 'ativo' and m.role <> 'pais'
         and m.starts_at <= now() and (m.ends_at is null or m.ends_at > now()))
    when 'administradores' then (
      select count(*) from public.organization_memberships m
       where m.organizational_unit_id = p_club_id and m.status = 'ativo' and m.role in ('diretoria', 'tesoureiro')
         and m.starts_at <= now() and (m.ends_at is null or m.ends_at > now()))
    when 'fotos' then (select count(*) from public.fotos f where f.club_id = p_club_id)
    when 'clubes' then (
      select count(*) from public.subscription_clubs sc
       where sc.subscription_id = public.assinatura_do_clube_id(p_club_id))
    else null end;
$$;
revoke all on function public.limite_uso(uuid, text) from public, anon, authenticated;

create or replace function public.limites_do_clube(p_club_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_object_agg(k, jsonb_build_object(
           'limite', public.plano_limite(p_club_id, k),
           'uso', public.limite_uso(p_club_id, k),
           'medicao', case when public.limite_uso(p_club_id, k) is null then 'pendente' else 'ok' end
         )), '{}'::jsonb)
  from unnest(array['membros', 'administradores', 'clubes', 'fotos', 'armazenamento_mb']) k;
$$;
revoke all on function public.limites_do_clube(uuid) from public, anon, authenticated;

-- Teto de vínculos: barra a ENTRADA NOVA quando o plano já está cheio. Nunca remove ninguém —
-- por isso um downgrade abaixo do uso atual é possível (fica "excedido"), mas não apaga nada:
-- só impede crescer mais. Vínculo de responsável (pais) nunca conta nem é barrado.
create or replace function public._exigir_limite_de_vinculo() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_lim bigint; v_uso bigint;
begin
  if new.status <> 'ativo' or new.role = 'pais' then return new; end if;
  if tg_op = 'UPDATE' and old.status = 'ativo' and old.role = new.role then return new; end if;

  v_lim := public.plano_limite(new.organizational_unit_id, 'membros');
  if v_lim is not null then
    v_uso := public.limite_uso(new.organizational_unit_id, 'membros');
    if v_uso >= v_lim then
      raise exception 'O plano deste clube permite % membros ativos (já são %). Nada foi removido: amplie o plano para incluir mais gente.', v_lim, v_uso;
    end if;
  end if;

  if new.role in ('diretoria', 'tesoureiro') then
    v_lim := public.plano_limite(new.organizational_unit_id, 'administradores');
    if v_lim is not null then
      v_uso := public.limite_uso(new.organizational_unit_id, 'administradores');
      if v_uso >= v_lim then
        raise exception 'O plano deste clube permite % administradores (já são %). Nada foi removido: amplie o plano.', v_lim, v_uso;
      end if;
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public._exigir_limite_de_vinculo() from public, anon, authenticated;
drop trigger if exists trg_exigir_limite_de_vinculo on public.organization_memberships;
create trigger trg_exigir_limite_de_vinculo before insert or update on public.organization_memberships
for each row execute function public._exigir_limite_de_vinculo();

-- ---------------------------------------------------------------------
-- L) CICLO COMERCIAL (transições + avaliação a partir das cobranças)
-- ---------------------------------------------------------------------
create or replace function public._assinatura_transicionar(
  p_sub_id uuid, p_novo text, p_motivo text default null, p_origem text default 'sistema', p_detalhe jsonb default '{}'::jsonb
) returns text
language plpgsql security definer set search_path = '' as $$
declare v_atual text; v_permitidos text[];
begin
  select status into v_atual from public.subscriptions where id = p_sub_id for update;
  if not found then raise exception 'Assinatura não encontrada.'; end if;
  if v_atual = p_novo then return v_atual; end if;

  -- cancelada é terminal: reativar é assinar de novo (histórico não se reescreve)
  v_permitidos := case v_atual
    when 'trial'              then array['ativa', 'pagamento_pendente', 'inadimplente', 'suspensa', 'cancelada']
    when 'ativa'              then array['pagamento_pendente', 'inadimplente', 'suspensa', 'cancelada']
    when 'pagamento_pendente' then array['ativa', 'inadimplente', 'suspensa', 'cancelada']
    when 'inadimplente'       then array['ativa', 'pagamento_pendente', 'suspensa', 'cancelada']
    when 'suspensa'           then array['ativa', 'pagamento_pendente', 'inadimplente', 'cancelada']
    when 'cancelada'          then array[]::text[]
    else array[]::text[] end;
  if not (p_novo = any (v_permitidos)) then
    raise exception 'Transição comercial inválida: % -> %.', v_atual, p_novo;
  end if;

  update public.subscriptions
     set status = p_novo, status_motivo = p_motivo, updated_at = now(),
         cancelada_em = case when p_novo = 'cancelada' then now() else cancelada_em end,
         cancelamento_motivo = case when p_novo = 'cancelada' then coalesce(p_motivo, cancelamento_motivo) else cancelamento_motivo end
   where id = p_sub_id;

  insert into public.subscription_events (subscription_id, de, para, motivo, origem, ator_id, detalhe)
  values (p_sub_id, v_atual, p_novo, p_motivo, p_origem, auth.uid(), coalesce(p_detalhe, '{}'::jsonb));
  return p_novo;
end;
$$;
revoke all on function public._assinatura_transicionar(uuid, text, text, text, jsonb) from public, anon, authenticated;

-- Deriva o status comercial das COBRANÇAS + política vigente. É idempotente: rodar duas vezes no
-- mesmo estado não muda nada nem duplica evento.
create or replace function public.assinatura_avaliar(p_sub_id uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare v_sub record; v_pol record; v_atraso int; v_alvo text;
        v_carencia int; v_ate_inad int; v_ate_susp int;
begin
  select * into v_sub from public.subscriptions where id = p_sub_id;
  if not found then raise exception 'Assinatura não encontrada.'; end if;
  if v_sub.status = 'cancelada' then return v_sub.status; end if;
  -- sem política cadastrada, os defaults do schema valem (nunca "suspende por falta de política")
  select * into v_pol from public.politica_comercial() p;
  v_carencia := coalesce(v_pol.carencia_dias, 5);
  v_ate_inad := coalesce(v_pol.dias_ate_inadimplente, 10);
  v_ate_susp := coalesce(v_pol.dias_ate_suspensao, 30);

  select max(current_date - i.vence_em) into v_atraso
    from public.billing_invoices i
   where i.subscription_id = p_sub_id and i.status in ('aberta', 'vencida') and i.vence_em < current_date;

  if v_atraso is null then
    -- nada vencido em aberto: trial enquanto durar, senão ativa (é a REATIVAÇÃO depois do pagamento)
    v_alvo := case when v_sub.trial_ate is not null and v_sub.trial_ate > now() then 'trial' else 'ativa' end;
  elsif v_atraso <= v_carencia then
    v_alvo := 'pagamento_pendente';                       -- dentro da carência: só um aviso
  elsif v_atraso <= v_carencia + v_ate_inad + v_ate_susp then
    v_alvo := 'inadimplente';                             -- inadimplente, mas ainda usando o sistema
  else
    v_alvo := 'suspensa';                                 -- para a escrita nova; NADA é apagado
  end if;

  if v_alvo = v_sub.status then return v_sub.status; end if;
  return public._assinatura_transicionar(p_sub_id, v_alvo, 'avaliação automática (atraso: ' || coalesce(v_atraso::text, '0') || ' dia(s))', 'sistema',
                                         jsonb_build_object('atraso_dias', v_atraso));
end;
$$;
revoke all on function public.assinatura_avaliar(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- M) RECEPTOR DE WEBHOOK — idempotente por construção
-- ---------------------------------------------------------------------
-- Chamado pela Edge Function do provedor (service_role). O adaptador de cada gateway traduz o evento
-- dele pro vocabulário daqui; o motor nunca conhece Stripe/Mercado Pago/Asaas.
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

  -- IDEMPOTÊNCIA: a unicidade (provider, evento_externo_id) é do banco. Reentrega não reprocessa.
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

  -- resolve a assinatura: por referência do provedor na cobrança, ou direto na assinatura
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

-- PROVEDOR MOCK: monta o payload como um gateway de verdade montaria e entra pela MESMA porta.
-- Serve pra provar o ciclo inteiro sem integrar ninguém — inclusive a reentrega do mesmo evento.
create or replace function public.billing_mock_emitir(
  p_subscription_id uuid, p_tipo text, p_evento_id text default null, p_dados jsonb default '{}'::jsonb
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_payload jsonb; v_ev text;
begin
  if auth.uid() is not null then perform public._exigir_admin_plataforma(); end if;  -- service_role passa direto
  if not exists (select 1 from public.subscriptions where id = p_subscription_id) then
    raise exception 'Assinatura não encontrada.';
  end if;
  v_ev := coalesce(p_evento_id, 'mock-' || replace(gen_random_uuid()::text, '-', ''));
  v_payload := coalesce(p_dados, '{}'::jsonb) || jsonb_build_object('subscription_id', p_subscription_id);
  return public.billing_webhook_receber('mock', v_ev, p_tipo, v_payload);
end;
$$;
revoke all on function public.billing_mock_emitir(uuid, text, text, jsonb) from public, anon;
grant execute on function public.billing_mock_emitir(uuid, text, text, jsonb) to service_role, authenticated;

-- ---------------------------------------------------------------------
-- N) O QUE O CLUBE VÊ DO PRÓPRIO COMERCIAL (sem ver a conta do cliente)
-- ---------------------------------------------------------------------
-- A diretoria precisa saber em que plano está, o que cabe nele e se há algo a resolver. NÃO precisa —
-- e não recebe — documento, e-mail de cobrança ou dados da conta comercial: isso é do contato da conta.
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
    'recursos', public.recursos_do_clube(v_club),
    'limites', public.limites_do_clube(v_club),
    -- a diretoria não muda de plano sozinha: isso é ato comercial da conta (ver plano_mudar)
    'pode_mudar_plano', false
  );
end;
$$;
revoke all on function public.assinatura_do_clube() from public, anon;
grant execute on function public.assinatura_do_clube() to authenticated;

-- catálogo pra vitrine: preço vem DAQUI, nunca do React
create or replace function public.planos_disponiveis() returns json
language sql stable security definer set search_path = '' as $$
  select coalesce((
    select json_agg(json_build_object(
      'chave', p.chave, 'versao', p.versao, 'nome', p.nome, 'descricao', p.descricao,
      'provisorio', p.provisorio, 'recursos', p.recursos, 'limites', p.limites,
      'precos', coalesce((select json_agg(json_build_object('ciclo', pr.ciclo, 'moeda', pr.moeda,
                            'valor_centavos', pr.valor_centavos, 'provisorio', pr.provisorio) order by pr.ciclo)
                          from public.billing_prices pr
                          where pr.plan_id = p.id and pr.ativo and pr.vigente_de <= now()
                            and (pr.vigente_ate is null or pr.vigente_ate > now())), '[]'::json)
    ) order by p.chave, p.versao desc)
    from public.billing_plans p
    where p.publico and p.ativo and p.status = 'publicado'), '[]'::json);
$$;
revoke all on function public.planos_disponiveis() from public, anon;
grant execute on function public.planos_disponiveis() to authenticated;

-- ---------------------------------------------------------------------
-- O) MUDANÇA DE PLANO (upgrade/downgrade) — ato COMERCIAL, nunca do clube
-- ---------------------------------------------------------------------
-- Downgrade abaixo do uso atual é PERMITIDO (e nunca apaga nada), mas exige confirmação explícita:
-- a resposta sem confirmação lista o que ficaria excedido. Depois de aplicado, o excedente continua
-- existindo — o que para é o CRESCIMENTO (gatilho de limite), não as pessoas que já estão lá.
create or replace function public.plano_mudar(
  p_subscription_id uuid, p_plano_chave text, p_plano_versao int default null, p_confirmar_excedente boolean default false
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_admin uuid := public._exigir_admin_plataforma(); v_sub record; v_plan record;
        v_exc jsonb := '[]'::jsonb; r record; v_lim bigint; v_uso bigint; k text;
begin
  select * into v_sub from public.subscriptions where id = p_subscription_id for update;
  if not found then raise exception 'Assinatura não encontrada.'; end if;
  if v_sub.status = 'cancelada' then raise exception 'Assinatura cancelada não muda de plano.'; end if;

  select * into v_plan from public.billing_plans
   where chave = p_plano_chave and (p_plano_versao is null or versao = p_plano_versao) and ativo and status = 'publicado'
   order by versao desc limit 1;
  if not found then raise exception 'Plano não encontrado no catálogo: %.', p_plano_chave; end if;

  -- o que ficaria acima do teto do plano novo (por clube coberto)
  for r in select sc.club_id, o.nome from public.subscription_clubs sc
            join public.organizational_units o on o.id = sc.club_id
           where sc.subscription_id = p_subscription_id loop
    foreach k in array array['membros', 'administradores', 'fotos'] loop
      v_lim := case when (v_plan.limites ->> k) ~ '^\d+$' then (v_plan.limites ->> k)::bigint end;
      v_uso := public.limite_uso(r.club_id, k);
      if v_lim is not null and v_uso is not null and v_uso > v_lim then
        v_exc := v_exc || jsonb_build_object('club_id', r.club_id, 'clube', r.nome, 'limite', k, 'teto', v_lim, 'uso', v_uso);
      end if;
    end loop;
  end loop;

  if jsonb_array_length(v_exc) > 0 and not coalesce(p_confirmar_excedente, false) then
    return jsonb_build_object('ok', false, 'precisa_confirmar', true, 'excedentes', v_exc,
      'mensagem', 'O plano escolhido é menor que o uso atual. Nada será apagado: o que já existe continua, mas não será possível crescer. Confirme para aplicar.');
  end if;

  update public.subscriptions set plan_id = v_plan.id, updated_at = now() where id = p_subscription_id;
  perform public._admin_auditar('plano_mudar', 'subscription', p_subscription_id,
    jsonb_build_object('de_plan_id', v_sub.plan_id, 'para', v_plan.chave || ' v' || v_plan.versao, 'excedentes', v_exc));
  insert into public.subscription_events (subscription_id, de, para, motivo, origem, ator_id, detalhe)
  values (p_subscription_id, v_sub.status, v_sub.status, 'mudança de plano para ' || v_plan.chave || ' v' || v_plan.versao,
          'admin', v_admin, jsonb_build_object('excedentes', v_exc));

  return jsonb_build_object('ok', true, 'plano', v_plan.chave, 'versao', v_plan.versao, 'excedentes', v_exc,
    'nada_foi_apagado', true);
end;
$$;
revoke all on function public.plano_mudar(uuid, text, int, boolean) from public, anon;
grant execute on function public.plano_mudar(uuid, text, int, boolean) to authenticated;

-- ---------------------------------------------------------------------
-- P) PAINEL DA OPERAÇÃO SaaS (administrador da plataforma)
-- ---------------------------------------------------------------------
-- SÓ operação comercial: contas, plano, assinatura, status, uso, falhas de provisionamento, suporte.
-- Nenhuma foto, mensagem, evidência, responsável ou conteúdo de clube passa por aqui — e nenhuma
-- policy nova foi criada, então nem por fora ele alcança isso.
create or replace function public.admin_contas_listar() returns json
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public._exigir_admin_plataforma();
  return coalesce((
    select json_agg(json_build_object(
      'conta_id', a.id, 'nome', a.nome, 'status', a.status, 'criada_em', a.created_at,
      'assinatura', (select json_build_object('id', s.id, 'status', s.status, 'ciclo', s.ciclo,
                              'trial_ate', s.trial_ate, 'periodo_fim', s.periodo_fim,
                              'plano', p.chave || ' v' || p.versao, 'plano_nome', p.nome)
                     from public.subscriptions s join public.billing_plans p on p.id = s.plan_id
                     where s.billing_account_id = a.id order by (s.status = 'cancelada'), s.created_at desc limit 1),
      'clubes', coalesce((select json_agg(json_build_object(
                            'club_id', o.id, 'nome', o.nome,
                            'membros', public.limite_uso(o.id, 'membros'),
                            'administradores', public.limite_uso(o.id, 'administradores'),
                            'provisionamento', coalesce((select ps.status from public.club_provisioning_status ps where ps.club_id = o.id), 'nao_verificado'))
                          order by o.nome)
                          from public.subscription_clubs sc
                          join public.subscriptions s2 on s2.id = sc.subscription_id and s2.billing_account_id = a.id
                          join public.organizational_units o on o.id = sc.club_id), '[]'::json),
      'cobrancas_abertas', (select count(*) from public.billing_invoices i
                             join public.subscriptions s3 on s3.id = i.subscription_id and s3.billing_account_id = a.id
                            where i.status in ('aberta', 'vencida'))
    ) order by a.created_at desc)
    from public.billing_accounts a), '[]'::json);
end;
$$;
revoke all on function public.admin_contas_listar() from public, anon;
grant execute on function public.admin_contas_listar() to authenticated;

create or replace function public.admin_provisionamento_pendencias() returns json
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public._exigir_admin_plataforma();
  return coalesce((
    select json_agg(json_build_object('club_id', ps.club_id, 'clube', o.nome, 'status', ps.status,
                                      'detalhe', ps.detalhe, 'tentativas', ps.tentativas, 'erro', ps.erro,
                                      'verificado_em', ps.verificado_em) order by ps.verificado_em desc)
    from public.club_provisioning_status ps
    join public.organizational_units o on o.id = ps.club_id
    where ps.status <> 'ok'), '[]'::json);
end;
$$;
revoke all on function public.admin_provisionamento_pendencias() from public, anon;
grant execute on function public.admin_provisionamento_pendencias() to authenticated;

create or replace function public.admin_provisionamento_reexecutar(p_club_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_res jsonb;
begin
  perform public._exigir_admin_plataforma();
  if not exists (select 1 from public.organizational_units where id = p_club_id and type = 'clube') then
    raise exception 'Clube não encontrado.';
  end if;
  begin
    perform public.provisionar_clube(p_club_id);
    v_res := public._provisionamento_conferir(p_club_id);
  exception when others then
    update public.club_provisioning_status set status = 'falhou', erro = sqlerrm, verificado_em = now(),
           tentativas = public.club_provisioning_status.tentativas + 1
     where club_id = p_club_id;
    v_res := jsonb_build_object('status', 'falhou', 'erro', sqlerrm);
  end;
  perform public._admin_auditar('provisionamento_reexecutar', 'clube', p_club_id, v_res);
  return v_res;
end;
$$;
revoke all on function public.admin_provisionamento_reexecutar(uuid) from public, anon;
grant execute on function public.admin_provisionamento_reexecutar(uuid) to authenticated;

create or replace function public.admin_assinatura_transicionar(p_subscription_id uuid, p_novo text, p_motivo text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_novo text;
begin
  perform public._exigir_admin_plataforma();
  if p_motivo is null or length(btrim(p_motivo)) < 5 then raise exception 'Informe o motivo da mudança de status.'; end if;
  v_novo := public._assinatura_transicionar(p_subscription_id, p_novo, p_motivo, 'admin');
  perform public._admin_auditar('assinatura_transicionar', 'subscription', p_subscription_id,
    jsonb_build_object('para', v_novo, 'motivo', p_motivo));
  return jsonb_build_object('ok', true, 'status', v_novo);
end;
$$;
revoke all on function public.admin_assinatura_transicionar(uuid, text, text) from public, anon;
grant execute on function public.admin_assinatura_transicionar(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------
-- Q) SUPORTE ASSISTIDO — pedir / autorizar / revogar (sem abrir acesso nenhum nesta fase)
-- ---------------------------------------------------------------------
create or replace function public.suporte_solicitar(p_club_id uuid, p_motivo text, p_horas int default 24) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_admin uuid := public._exigir_admin_plataforma(); v_id uuid;
begin
  if p_motivo is null or length(btrim(p_motivo)) < 10 then
    raise exception 'Descreva o motivo do acesso de suporte (mínimo 10 caracteres).';
  end if;
  if coalesce(p_horas, 0) not between 1 and 168 then raise exception 'O prazo deve ficar entre 1 e 168 horas.'; end if;
  if not exists (select 1 from public.organizational_units where id = p_club_id and type = 'clube') then
    raise exception 'Clube não encontrado.';
  end if;
  insert into public.support_grants (club_id, admin_user_id, motivo, status, expira_em)
  values (p_club_id, v_admin, btrim(p_motivo), 'solicitado', now() + make_interval(hours => p_horas))
  returning id into v_id;
  perform public._admin_auditar('suporte_solicitar', 'clube', p_club_id, jsonb_build_object('grant_id', v_id, 'motivo', p_motivo, 'horas', p_horas));
  return jsonb_build_object('ok', true, 'id', v_id, 'status', 'solicitado',
    'aviso', 'Só a liderança do clube pode autorizar. Enquanto não autorizar, nenhum dado do clube é acessível.');
end;
$$;
revoke all on function public.suporte_solicitar(uuid, text, int) from public, anon;
grant execute on function public.suporte_solicitar(uuid, text, int) to authenticated;

-- quem autoriza é o CLUBE (diretoria/instrutor com vínculo ativo), nunca a plataforma
create or replace function public.suporte_autorizar(p_id uuid, p_horas int default 24) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_g record;
begin
  select * into v_g from public.support_grants where id = p_id for update;
  if not found then raise exception 'Pedido de suporte não encontrado.'; end if;
  if not public.pode_gerir_no_clube(v_g.club_id) then
    raise exception 'Só a liderança deste clube pode autorizar o acesso de suporte.';
  end if;
  if v_g.status <> 'solicitado' then raise exception 'Este pedido não está aguardando autorização.'; end if;
  if coalesce(p_horas, 0) not between 1 and 168 then raise exception 'O prazo deve ficar entre 1 e 168 horas.'; end if;

  update public.support_grants
     set status = 'autorizado', autorizado_por = v_uid, autorizado_em = now(),
         expira_em = now() + make_interval(hours => p_horas)
   where id = p_id;
  insert into public.platform_admin_audit (admin_user_id, acao, alvo_tipo, alvo_id, detalhe)
  values (v_g.admin_user_id, 'suporte_autorizado_pelo_clube', 'clube', v_g.club_id,
          jsonb_build_object('grant_id', p_id, 'autorizado_por', v_uid, 'horas', p_horas));
  return jsonb_build_object('ok', true, 'status', 'autorizado', 'expira_em', now() + make_interval(hours => p_horas),
    'aviso', 'Nesta versão o acesso assistido ainda NÃO é executado pelo sistema: a autorização fica registrada e auditada.');
end;
$$;
revoke all on function public.suporte_autorizar(uuid, int) from public, anon;
grant execute on function public.suporte_autorizar(uuid, int) to authenticated;

create or replace function public.suporte_revogar(p_id uuid, p_motivo text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_g record;
begin
  select * into v_g from public.support_grants where id = p_id for update;
  if not found then raise exception 'Pedido de suporte não encontrado.'; end if;
  if not (public.pode_gerir_no_clube(v_g.club_id) or public.eh_admin_plataforma(v_uid)) then
    raise exception 'Sem permissão para revogar este acesso.';
  end if;
  if v_g.status in ('revogado', 'recusado') then return jsonb_build_object('ok', true, 'status', v_g.status, 'ja_estava', true); end if;
  update public.support_grants
     set status = case when v_g.status = 'solicitado' then 'recusado' else 'revogado' end,
         revogado_em = now(), revogado_por = v_uid, revogado_motivo = p_motivo
   where id = p_id;
  insert into public.platform_admin_audit (admin_user_id, acao, alvo_tipo, alvo_id, detalhe)
  values (v_g.admin_user_id, 'suporte_revogado', 'clube', v_g.club_id,
          jsonb_build_object('grant_id', p_id, 'por', v_uid, 'motivo', p_motivo));
  return jsonb_build_object('ok', true, 'status', case when v_g.status = 'solicitado' then 'recusado' else 'revogado' end);
end;
$$;
revoke all on function public.suporte_revogar(uuid, text) from public, anon;
grant execute on function public.suporte_revogar(uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- R) ONBOARDING DE CLUBE NOVO — retomável e idempotente
-- ---------------------------------------------------------------------
-- Etapas, nesta ordem:
--   conta → dados_basicos → clube → identidade → diretor → configuracao → recursos → equipe → pronto
-- Regras que o teste 43 cobre:
--   * fechar na etapa 4 e voltar depois continua de onde parou (a sessão é o estado, no servidor);
--   * repetir uma etapa NUNCA cria dois clubes nem duas assinaturas (os ids ficam na sessão);
--   * não dá pra pular etapa (a ordem é do servidor, não do cliente).
create table if not exists public.onboarding_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  billing_account_id uuid references public.billing_accounts(id) on delete set null,
  subscription_id uuid references public.subscriptions(id) on delete set null,
  club_id uuid references public.organizational_units(id) on delete set null,
  etapa text not null default 'conta',
  etapas_concluidas text[] not null default '{}',
  dados jsonb not null default '{}'::jsonb,
  status text not null default 'em_andamento' check (status in ('em_andamento', 'concluido', 'abandonado')),
  ultimo_erro text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- no máximo UM onboarding vivo por pessoa: repetir "iniciar" devolve o mesmo, nunca abre outro
create unique index if not exists uq_onboarding_vivo_por_usuario
  on public.onboarding_sessions (user_id) where status = 'em_andamento';

-- convites de EQUIPE do clube (diferente de club_invites, que é o convite de RESPONSÁVEL:
-- outra finalidade, outro público, outro fluxo — por isso tabela própria em vez de sobrecarregar aquela)
create table if not exists public.club_team_invites (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.organizational_units(id) on delete cascade,
  email text not null check (position('@' in email) > 1),
  papel text not null default 'diretoria' check (papel in ('diretoria', 'tesoureiro', 'instrutor', 'conselheiro')),
  status text not null default 'pendente' check (status in ('pendente', 'aceito', 'cancelado')),
  criado_por uuid references auth.users(id) on delete set null,
  aceito_por uuid references auth.users(id) on delete set null,
  aceito_em timestamptz,
  created_at timestamptz not null default now(),
  unique (club_id, email)
);

create or replace function public._onboarding_etapas() returns text[]
language sql immutable as $$
  select array['conta', 'dados_basicos', 'clube', 'identidade', 'diretor', 'configuracao', 'recursos', 'equipe', 'pronto'];
$$;
revoke all on function public._onboarding_etapas() from public, anon, authenticated;

-- slug único derivado do nome (sem acento, sem símbolo); colide -> sufixo numérico
create or replace function public._slug_de_clube(p_nome text) returns text
language plpgsql stable security definer set search_path = '' as $$
declare v_base text; v_try text; i int := 1;
begin
  v_base := lower(translate(coalesce(p_nome, ''),
    'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ', 'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC'));
  v_base := btrim(regexp_replace(v_base, '[^a-z0-9]+', '-', 'g'), '-');
  if v_base = '' then v_base := 'clube'; end if;
  v_base := left(v_base, 50);
  v_try := v_base;
  while exists (select 1 from public.organizational_units where slug = v_try) loop
    i := i + 1; v_try := v_base || '-' || i;
  end loop;
  return v_try;
end;
$$;
revoke all on function public._slug_de_clube(text) from public, anon, authenticated;

create or replace function public._onboarding_json(p_s public.onboarding_sessions) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', p_s.id, 'status', p_s.status, 'etapa', p_s.etapa,
    'etapas', to_jsonb(public._onboarding_etapas()),
    'etapas_concluidas', to_jsonb(p_s.etapas_concluidas),
    'billing_account_id', p_s.billing_account_id,
    'subscription_id', p_s.subscription_id,
    'club_id', p_s.club_id,
    'dados', p_s.dados,
    'atualizado_em', p_s.updated_at);
$$;
revoke all on function public._onboarding_json(public.onboarding_sessions) from public, anon, authenticated;

create or replace function public.onboarding_iniciar() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_s public.onboarding_sessions;
begin
  if v_uid is null then raise exception 'Faça login para começar.'; end if;
  select * into v_s from public.onboarding_sessions where user_id = v_uid and status = 'em_andamento';
  if found then return public._onboarding_json(v_s); end if;     -- IDEMPOTENTE: devolve o que já existe
  insert into public.onboarding_sessions (user_id) values (v_uid) returning * into v_s;
  return public._onboarding_json(v_s);
end;
$$;
revoke all on function public.onboarding_iniciar() from public, anon;
grant execute on function public.onboarding_iniciar() to authenticated;

create or replace function public.onboarding_estado() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_s public.onboarding_sessions;
begin
  if v_uid is null then raise exception 'Faça login para continuar.'; end if;
  select * into v_s from public.onboarding_sessions where user_id = v_uid and status = 'em_andamento'
   order by updated_at desc limit 1;
  if not found then
    -- Quem JÁ CONCLUIU não pode reencontrar a tela de "comece agora" — seria um convite a abrir um
    -- segundo clube por engano. Devolve-se o que ele terminou; abrir outro clube é ato explícito.
    select * into v_s from public.onboarding_sessions where user_id = v_uid and status = 'concluido'
     order by updated_at desc limit 1;
    if found then
      return jsonb_build_object('tem_sessao', false, 'concluido', true, 'club_id', v_s.club_id,
                                'etapas', to_jsonb(public._onboarding_etapas()), 'planos', public.planos_disponiveis());
    end if;
    return jsonb_build_object('tem_sessao', false, 'concluido', false,
                              'etapas', to_jsonb(public._onboarding_etapas()), 'planos', public.planos_disponiveis());
  end if;
  return jsonb_build_object('tem_sessao', true, 'concluido', false, 'planos', public.planos_disponiveis())
         || public._onboarding_json(v_s);
end;
$$;
revoke all on function public.onboarding_estado() from public, anon;
grant execute on function public.onboarding_estado() to authenticated;

-- A ÚNICA porta de escrita do onboarding. Trava a sessão (for update) — duas abas/cliques simultâneos
-- não criam dois clubes. Cada etapa é idempotente por construção: olha o que a sessão já tem.
create or replace function public.onboarding_etapa(p_etapa text, p_dados jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_s public.onboarding_sessions; v_etapas text[] := public._onboarding_etapas();
        v_pos int; v_pos_atual int; v_id uuid; v_plan record; v_pol record; v_nome text; v_slug text;
        v_feature text; v_email text; v_prov jsonb;
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
        insert into public.subscriptions (billing_account_id, plan_id, status, trial_ate, provider)
        values (v_s.billing_account_id, v_plan.id, 'trial', now() + make_interval(days => coalesce(v_pol.trial_dias, 30)), 'mock')
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

-- ---------------------------------------------------------------------
-- S) CADASTRO DE FUNDADOR — quem chega pra ABRIR um clube não nasce no Tenant 001
-- ---------------------------------------------------------------------
-- Achado ao construir o onboarding: hoje TODO cadastro público sem unidade cai no clube legado
-- (handle_new_user) e, mesmo sem vínculo, o espelho sincronizar_vinculo_perfil cria um lá. Pra um
-- SaaS isso significaria cada cliente novo virando membro pendente do Tenant 001 — exatamente o que
-- "preservar o Tenant 001" proíbe. A correção é ADITIVA e mínima: um tipo de cadastro 'fundador'
-- que nasce SEM clube (o clube dele é criado no onboarding, alguns cliques depois). Todo o resto do
-- cadastro público — membro e responsável — segue byte a byte igual.
create or replace function public.sincronizar_vinculo_perfil() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_role text := public._papel_do_vinculo(new.papel);
  v_status text := public._status_do_vinculo(new.status);
  v_signup text := nullif(current_setting('app.signup_club', true), '');
  v_row uuid;
  v_club uuid;
begin
  select m.id, m.organizational_unit_id into v_row, v_club
    from public.organization_memberships m
    join public.organizational_units u on u.id = m.organizational_unit_id and u.type = 'clube'
   where m.user_id = new.id
   order by (m.status in ('pendente', 'ativo')) desc, m.created_at desc
   limit 1;
  if v_row is null then
    -- cadastro de FUNDADOR: sem clube de propósito (o dele nasce no onboarding). Sem este desvio,
    -- o coalesce abaixo cairia em clube_legado_id() e o Tenant 001 ganharia um membro que não é dele.
    if coalesce(nullif(current_setting('app.signup_sem_clube', true), ''), '') = '1' then
      return new;
    end if;
    v_club := coalesce(v_signup::uuid, (select club_id from public.unidades where id = new.unidade_id), public.clube_legado_id());
    insert into public.organization_memberships (user_id, organizational_unit_id, role, status, metadata)
    values (new.id, v_club, v_role, v_status,
            jsonb_build_object('source', case when v_signup is not null then 'cadastro' else 'sincronia-perfil' end));
  else
    update public.organization_memberships set role = v_role, status = v_status, updated_at = now()
     where id = v_row and (role is distinct from v_role or status is distinct from v_status);
  end if;
  return new;
end;
$$;

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_tipo text := v_meta->>'tipo';
  v_token text := v_meta->>'convite_responsavel';
  v_inv public.club_invites;
  v_unidade uuid;
  v_club uuid;
begin
  if v_tipo = 'pais' then
    if coalesce(v_token, '') = '' then raise exception 'Cadastro de responsável exige convite do clube.'; end if;
    select * into v_inv from public.club_invites
     where token_hash = encode(extensions.digest(v_token, 'sha256'), 'hex')
       and used_at is null and revoked_at is null and expires_at > now()
     for update;
    if v_inv.id is null then raise exception 'Convite inválido, usado, revogado ou expirado.'; end if;
    v_club := v_inv.club_id;
    perform set_config('app.signup_club', v_club::text, true);
    insert into public.profiles (id, nome, papel, status) values (new.id, v_meta->>'nome', 'pais', 'ativo');
    insert into public.organization_memberships (user_id, organizational_unit_id, role, status, metadata)
    values (new.id, v_club, 'pais', 'ativo', '{"source":"cadastro"}'::jsonb);
    update public.club_invites set used_at = now(), used_by = new.id where id = v_inv.id;
  elsif v_tipo = 'fundador' then
    -- quem vem ABRIR um clube: identidade criada, NENHUM vínculo. Status 'ativo' (não há clube a
    -- aprová-lo), o que também evita o aviso "Novo cadastro" cair na liderança de um clube alheio.
    perform set_config('app.signup_sem_clube', '1', true);
    insert into public.profiles (id, nome, papel, status) values (new.id, v_meta->>'nome', 'desbravador', 'ativo');
    perform set_config('app.signup_sem_clube', '', true);
  else
    v_unidade := nullif(v_meta->>'unidade_id', '')::uuid;
    if v_unidade is not null then
      select club_id into v_club from public.unidades where id = v_unidade;
      if v_club is null then raise exception 'Unidade inválida.'; end if;
    else
      v_club := public.clube_legado_id();
    end if;
    perform set_config('app.signup_club', v_club::text, true);
    insert into public.profiles (id, nome, nascimento, unidade_id, cargo, papel, status)
    values (new.id, v_meta->>'nome', (nullif(v_meta->>'nascimento', ''))::date, v_unidade,
            v_meta->>'cargo', 'desbravador', 'pendente');
    insert into public.organization_memberships (user_id, organizational_unit_id, role, status, unidade_id, metadata)
    values (new.id, v_club, 'desbravador', 'pendente', v_unidade, '{"source":"cadastro"}'::jsonb);
  end if;
  perform set_config('app.signup_club', '', true);
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- T) RLS — quem vê o quê no comercial
-- ---------------------------------------------------------------------
-- Regra geral: dado comercial é do CONTATO DA CONTA e do ADMIN DA PLATAFORMA. Vínculo de clube não
-- dá acesso a dado comercial, e contato de conta não dá acesso a dado de clube. As duas coisas são
-- separadas de propósito — é o teste de isolamento "conta comercial × dados privados".
alter table public.billing_accounts          enable row level security;
alter table public.billing_account_contacts  enable row level security;
alter table public.billing_plans             enable row level security;
alter table public.billing_prices            enable row level security;
alter table public.billing_policies          enable row level security;
alter table public.subscriptions             enable row level security;
alter table public.subscription_events       enable row level security;
alter table public.subscription_clubs        enable row level security;
alter table public.billing_invoices          enable row level security;
alter table public.billing_providers         enable row level security;
alter table public.billing_events            enable row level security;
alter table public.platform_admins           enable row level security;
alter table public.platform_admin_audit      enable row level security;
alter table public.support_grants            enable row level security;
alter table public.club_provisioning_status  enable row level security;
alter table public.onboarding_sessions       enable row level security;
alter table public.club_team_invites         enable row level security;

revoke insert, update, delete on
  public.billing_accounts, public.billing_account_contacts, public.billing_plans, public.billing_prices,
  public.billing_policies, public.subscriptions, public.subscription_events, public.subscription_clubs,
  public.billing_invoices, public.billing_providers, public.billing_events, public.platform_admins,
  public.platform_admin_audit, public.support_grants, public.club_provisioning_status,
  public.onboarding_sessions, public.club_team_invites
from authenticated, anon;

grant select on public.billing_plans, public.billing_prices, public.billing_policies to authenticated;
grant select on public.billing_accounts, public.billing_account_contacts, public.subscriptions,
                public.subscription_events, public.subscription_clubs, public.billing_invoices,
                public.platform_admins, public.platform_admin_audit, public.support_grants,
                public.club_provisioning_status, public.onboarding_sessions, public.club_team_invites to authenticated;

-- catálogo: público (é vitrine). Preço e composição do plano não são segredo — e o React lê daqui.
drop policy if exists "catalogo publicado e visivel" on public.billing_plans;
create policy "catalogo publicado e visivel" on public.billing_plans for select to authenticated
using (status = 'publicado' and ativo or public.eh_admin_plataforma());
drop policy if exists "precos do catalogo publicado" on public.billing_prices;
create policy "precos do catalogo publicado" on public.billing_prices for select to authenticated
using (exists (select 1 from public.billing_plans p where p.id = plan_id and p.status = 'publicado' and p.ativo)
       or public.eh_admin_plataforma());
drop policy if exists "politica comercial e publica" on public.billing_policies;
create policy "politica comercial e publica" on public.billing_policies for select to authenticated using (true);

drop policy if exists "contato da conta ou admin" on public.billing_accounts;
create policy "contato da conta ou admin" on public.billing_accounts for select to authenticated
using (public.eh_contato_da_conta(id) or public.eh_admin_plataforma());

drop policy if exists "o proprio contato, o titular ou admin" on public.billing_account_contacts;
create policy "o proprio contato, o titular ou admin" on public.billing_account_contacts for select to authenticated
using (user_id = auth.uid() or public.eh_contato_da_conta(billing_account_id) or public.eh_admin_plataforma());

drop policy if exists "contato da conta ou admin" on public.subscriptions;
create policy "contato da conta ou admin" on public.subscriptions for select to authenticated
using (public.eh_contato_da_conta(billing_account_id) or public.eh_admin_plataforma());

drop policy if exists "contato da conta ou admin" on public.subscription_events;
create policy "contato da conta ou admin" on public.subscription_events for select to authenticated
using (exists (select 1 from public.subscriptions s where s.id = subscription_id
               and (public.eh_contato_da_conta(s.billing_account_id) or public.eh_admin_plataforma())));

-- clubes cobertos: o contato da conta, o admin E a liderança do próprio clube (que precisa saber
-- que o clube dela está coberto) — mas nada além do vínculo assinatura↔clube.
drop policy if exists "contato, admin ou lideranca do clube coberto" on public.subscription_clubs;
create policy "contato, admin ou lideranca do clube coberto" on public.subscription_clubs for select to authenticated
using (public.pode_gerir_no_clube(club_id) or public.eh_admin_plataforma()
       or exists (select 1 from public.subscriptions s where s.id = subscription_id and public.eh_contato_da_conta(s.billing_account_id)));

drop policy if exists "contato da conta ou admin" on public.billing_invoices;
create policy "contato da conta ou admin" on public.billing_invoices for select to authenticated
using (exists (select 1 from public.subscriptions s where s.id = subscription_id
               and (public.eh_contato_da_conta(s.billing_account_id) or public.eh_admin_plataforma())));

-- eventos de webhook e provedores: operação interna. Nem contato de conta lê.
drop policy if exists "so admin da plataforma" on public.billing_events;
create policy "so admin da plataforma" on public.billing_events for select to authenticated
using (public.eh_admin_plataforma());
drop policy if exists "so admin da plataforma" on public.billing_providers;
create policy "so admin da plataforma" on public.billing_providers for select to authenticated
using (public.eh_admin_plataforma());

-- quem é admin: cada um vê a própria linha; a lista inteira, só admin. Ninguém se promove:
-- não há INSERT/UPDATE para authenticated — só service_role (bootstrap) escreve aqui.
drop policy if exists "a propria linha ou admin" on public.platform_admins;
create policy "a propria linha ou admin" on public.platform_admins for select to authenticated
using (user_id = auth.uid() or public.eh_admin_plataforma());

drop policy if exists "so admin da plataforma" on public.platform_admin_audit;
create policy "so admin da plataforma" on public.platform_admin_audit for select to authenticated
using (public.eh_admin_plataforma());
drop trigger if exists trg_imutavel on public.platform_admin_audit;
create trigger trg_imutavel before update or delete on public.platform_admin_audit
for each row execute function public._proteger_registro_imutavel();

-- o clube PRECISA ver quem pediu acesso a ele, e quando expira
drop policy if exists "lideranca do clube ou admin" on public.support_grants;
create policy "lideranca do clube ou admin" on public.support_grants for select to authenticated
using (public.pode_gerir_no_clube(club_id) or public.eh_admin_plataforma());

drop policy if exists "lideranca do clube ou admin" on public.club_provisioning_status;
create policy "lideranca do clube ou admin" on public.club_provisioning_status for select to authenticated
using (public.pode_gerir_no_clube(club_id) or public.eh_admin_plataforma());

drop policy if exists "so a propria sessao" on public.onboarding_sessions;
create policy "so a propria sessao" on public.onboarding_sessions for select to authenticated
using (user_id = auth.uid());

drop policy if exists "lideranca do clube" on public.club_team_invites;
create policy "lideranca do clube" on public.club_team_invites for select to authenticated
using (public.pode_gerir_no_clube(club_id) or lower(email) = lower(coalesce((select u.email from auth.users u where u.id = auth.uid()), '')));

-- ---------------------------------------------------------------------
-- U) CATÁLOGO INICIAL — estrutura pronta, VALORES PROVISÓRIOS
-- ---------------------------------------------------------------------
-- A composição e os preços abaixo são PLACEHOLDERS pra provar o motor. A decisão comercial ainda não
-- foi tomada e nada aqui deve ser anunciado a cliente: por isso `provisorio = true` em tudo (o app
-- mostra o aviso). Mudar preço/composição = publicar uma VERSÃO NOVA, não editar estas linhas.
insert into public.billing_policies (chave, versao, trial_dias, carencia_dias, dias_ate_inadimplente, dias_ate_suspensao, observacao)
values ('padrao', 1, 30, 5, 10, 30,
  'Valores PROVISÓRIOS de carência/suspensão — a política é configurável e versionada; publique uma versão nova em vez de editar esta.')
on conflict (chave, versao) do nothing;

insert into public.billing_plans (chave, versao, nome, descricao, publico, recursos, limites, provisorio) values
  ('gratuito', 1, 'Gratuito', 'Para o clube começar: agenda, atividades, mural, missões e chat.', true,
   array['agenda', 'atividades', 'mural', 'missoes', 'chat'],
   '{"membros": 20, "administradores": 2, "clubes": 1, "fotos": 200}'::jsonb, true),
  ('essencial', 1, 'Essencial', 'O dia a dia completo do clube, com jogos, desafios e tesouraria.', true,
   array['agenda', 'atividades', 'mural', 'missoes', 'chat', 'desafios', 'jogos', 'biblia', 'bichinho', 'chefao', 'mensalidades'],
   '{"membros": 80, "administradores": 5, "clubes": 1, "fotos": 2000, "armazenamento_mb": 2048}'::jsonb, true),
  ('completo', 1, 'Completo', 'Tudo o que o DesbravaClube oferece, incluindo Classes e Leilão.', true,
   null,
   '{"membros": 300, "administradores": 20, "clubes": 3, "fotos": 20000, "armazenamento_mb": 10240}'::jsonb, true),
  -- PRONTO PRO TENANT 001: todos os recursos, nenhum teto. Não é público e não está atribuído a
  -- ninguém — atribuir depois não muda nada no comportamento do clube legado.
  ('legado-fundador', 1, 'Legado (fundador)', 'Plano do clube fundador: todos os recursos, sem limites.', false,
   null, '{}'::jsonb, true)
on conflict (chave, versao) do update
  set nome = excluded.nome, descricao = excluded.descricao, publico = excluded.publico,
      recursos = excluded.recursos, limites = excluded.limites;

insert into public.billing_prices (plan_id, ciclo, valor_centavos, provisorio)
select p.id, v.ciclo, v.valor, true
from public.billing_plans p
join (values ('gratuito', 'mensal', 0), ('gratuito', 'anual', 0),
             ('essencial', 'mensal', 4900), ('essencial', 'anual', 49000),
             ('completo', 'mensal', 9900), ('completo', 'anual', 99000),
             ('legado-fundador', 'mensal', 0), ('legado-fundador', 'anual', 0)
     ) as v(chave, ciclo, valor) on v.chave = p.chave
where p.versao = 1
  and not exists (select 1 from public.billing_prices x where x.plan_id = p.id and x.ciclo = v.ciclo);

-- os clubes que já existem entram no mapa de provisionamento (o legado nasce 'ok' por definição:
-- ele É o estado de referência).
insert into public.club_provisioning_status (club_id, status, detalhe)
select o.id, 'ok', jsonb_build_object('origem', 'clube existente antes da fase 5')
from public.organizational_units o where o.type = 'clube'
on conflict (club_id) do nothing;

notify pgrst, 'reload schema';

insert into public.migracoes_aplicadas (arquivo)
values ('2026-09-21-fundacao-comercial-saas.sql')
on conflict (arquivo) do update set aplicada_em = now();
