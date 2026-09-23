-- =====================================================================
-- Fase 4.2 — Hierarquia institucional (Clube → Distrito → Região → Campo/Associação-Missão, níveis
-- opcionais) + workflow VERSIONADO e DECLARATIVO de revisão/investidura. Rodar DEPOIS da 20260921000045.
-- Idempotente. Ainda SEM assinatura digital/ICP-Brasil: aprovação autenticada no sistema ('aprovacao_sistema')
-- é a única forma implementada — o modelo só PREPARA espaço pra métodos futuros.
--
-- ---------------------------------------------------------------------------------------------
-- PESQUISA institucional (antes de fixar qualquer regra — nada aqui foi inventado):
--   - Estrutura oficial (institucional.adventistas.org/pt/quem-somos/estrutura-organizacional):
--     Igreja Local → Distrito Pastoral → Associação/Missão → União → Divisão.
--   - Coordenação de Desbravadores (adventistas.org, página oficial de fundação de clube): "o líder do
--     Ministério de Desbravadores do campo local e seus colaboradores — coordenador geral, coordenadores
--     regionais e distritais — são responsáveis por todos os Clubes de Desbravadores de sua área
--     geográfica". Confirma que "coordenador distrital"/"coordenador regional" são papéis REAIS, cuja
--     autoridade é territorial (distrito/região), não do clube.
--   - QUEM aprova investidura (adventistas.org/pt/desbravadores/orientacoes-cartao-classes-de-lideranca):
--     item 9 do cartão — "LÍDER: MDA da Associação/Missão ou Pastor Distrital/Regional mediante
--     autorização. MÁSTER: MDA da União ou Associação. MÁSTER AVANÇADO: MDA da Divisão ou União." — mas
--     o próprio texto deixa claro que isso é SÓ para as Classes de Liderança (Líder/Máster/Máster
--     Avançado), que este produto ainda NÃO importou (ver AUDITORIA-CURRICULO-OFICIAL.md). Não há, nas
--     mesmas fontes, qualquer exigência de revisão distrital/regional pra investidura das Classes
--     REGULARES (Amigo–Guia) — a nomeação de diretor de clube é aprovada pela comissão da igreja local,
--     e a investidura dessas classes é um ato do clube.
--   - DECISÃO: o workflow ATIVO pra 'classes-regulares' tem só 2 etapas (revisão do clube + investidura,
--     ambas na autoridade do clube) — é o que está grounded. O MOTOR, porém, é genérico e suporta
--     etapas intermediárias em qualquer nível da hierarquia (distrito/região/campo) — pronto pra quando
--     as Classes de Liderança forem importadas (fase futura, fora de escopo aqui) ou pra um clube que
--     queira configurar revisão extra. Isso é exatamente "torne configurável/versionado em vez de
--     inventar regra": a exigência distrital/regional para Classes Regulares fica PENDENTE, não fixada.
-- ---------------------------------------------------------------------------------------------
--
-- O QUE MUDA:
--   A) Hierarquia: organizational_units JÁ suporta a árvore inteira desde a fundação (migration 01:
--      type in divisao/uniao/campo/regiao/distrito/igreja/clube, parent_id opcional/auto-referente) —
--      nada a alterar no schema da árvore em si (níveis intermediários já são opcionais: parent_id pode
--      pular direto de clube pra campo, por exemplo, sem duplicar identidade). O que faltava: papéis de
--      organization_memberships só existiam pro nível clube. Estendido (grounded acima) +
--      VALIDADO POR GATILHO contra o tipo da unidade (papel de clube não vale num distrito, e vice-versa).
--   B) investiture_workflows/investiture_workflow_stages: sequência declarativa e versionada de etapas
--      (chave, escopo_tipo, papéis permitidos, obrigatória, se pula quando o nível não existe na árvore
--      deste clube, se permite o mesmo decisor de uma etapa de escopo diferente). NENHUMA coluna
--      "assinatura_diretor"/"assinatura_distrital" — tudo dado, não schema.
--   C) investiture_workflow_runs + workflow_stage_decisions (IMUTÁVEL): uma "corrida" por snapshot
--      selado (preserva 1:1 a imutabilidade da fase 4); cada decisão grava escopo organizacional
--      RESOLVIDO, papel efetivamente usado, decisor, decisão, data, observação e a VERSÃO do workflow —
--      nunca reescrita depois (mudança de cargo/clube/nome/currículo não reescreve histórico).
--   D) O SERVIDOR resolve autoridade: unidade_ancestral() sobe a árvore a partir do clube até achar o
--      tipo exigido pela etapa; _workflow_papel_autorizado() confere se quem chamou tem vínculo ATIVO
--      com um dos papéis da etapa NAQUELA unidade concreta. O cliente nunca envia "sou distrital" — só
--      decisão + observação.
--   E) Segregação de funções: por padrão, a MESMA pessoa não pode decidir duas etapas de escopo_tipo
--      DIFERENTE na mesma investidura (ex.: aprovar como clube E, na mesma investidura, também aprovar
--      como distrital) — só se a etapa marcar explicitamente permite_mesmo_decisor. Etapas do MESMO
--      escopo_tipo (ex.: as 2 etapas do workflow padrão, ambas 'clube') nunca são bloqueadas entre si —
--      é a mesma autoridade, não duas distintas.
--   F) revisao_final_decidir/investidura_registrar (fase 4) preservados NA ÍNTEGRA (mesma assinatura,
--      mesmos textos de erro, mesmos efeitos colaterais em investiture_reviews/class_investitures/
--      curriculum_achievements) — agora IMPLEMENTADOS POR CIMA do motor declarativo (a autorização e o
--      registro de decisão vêm do motor; os efeitos legados continuam pra não quebrar minha_classe(),
--      documento_conteudo() e as telas já publicadas). Nova RPC workflow_etapa_intermediaria_decidir()
--      pra etapas que não são nem a primeira (revisao_clube) nem a última (investidura) de um workflow
--      com mais de 2 etapas.
-- =====================================================================

-- ---------------------------------------------------------------------
-- A) hierarquia: papéis fora do clube, validados por gatilho contra organizational_units.type
-- ---------------------------------------------------------------------
alter table public.organization_memberships drop constraint if exists organization_memberships_role_valido;
alter table public.organization_memberships add constraint organization_memberships_role_valido
  check (role in ('desbravador', 'conselheiro', 'instrutor', 'diretoria', 'tesoureiro', 'pais',
                   'coordenador_distrital', 'coordenador_regional', 'coordenador_geral', 'diretor_mda'));

-- CHECK não enxerga outra tabela — o gatilho garante que o papel bate com o TIPO da unidade
-- (papel de clube só em unidade type='clube'; coordenador_distrital só em type='distrito'; etc.).
-- Tipos ainda sem papel modelado nesta fase (igreja/uniao/divisao) recusam vínculo — schema pronto
-- pra crescer, sem aceitar dado sem sentido enquanto isso não for modelado.
create or replace function public._validar_role_por_tipo_unidade() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_tipo text; v_validos text[];
begin
  select type into v_tipo from public.organizational_units where id = new.organizational_unit_id;
  if v_tipo is null then raise exception 'Unidade organizacional não encontrada.'; end if;
  v_validos := case v_tipo
    when 'clube' then array['desbravador', 'conselheiro', 'instrutor', 'diretoria', 'tesoureiro', 'pais']
    when 'distrito' then array['coordenador_distrital']
    when 'regiao' then array['coordenador_regional']
    when 'campo' then array['coordenador_geral', 'diretor_mda']
    else null end;
  if v_validos is null then
    raise exception 'Vínculo em unidade do tipo "%" ainda não tem papéis modelados nesta fase.', v_tipo;
  end if;
  if new.role <> all (v_validos) then
    raise exception 'Papel "%" não é válido para uma unidade organizacional do tipo "%" (válidos: %).', new.role, v_tipo, array_to_string(v_validos, ', ');
  end if;
  return new;
end;
$$;
drop trigger if exists trg_validar_role_por_tipo on public.organization_memberships;
create trigger trg_validar_role_por_tipo before insert or update of role, organizational_unit_id on public.organization_memberships
for each row execute function public._validar_role_por_tipo_unidade();

-- Sobe a árvore (parent_id) a partir de QUALQUER unidade até achar um ancestral (ou ela mesma) do tipo
-- pedido. Retorna NULL quando esse nível não existe na hierarquia desta unidade — é assim que um nível
-- intermediário fica OPCIONAL (um clube pode ligar direto num campo, sem distrito/região no meio).
create or replace function public.unidade_ancestral(p_unit_id uuid, p_tipo text) returns uuid
language sql stable security definer set search_path = '' as $$
  with recursive cadeia as (
    select id, parent_id, type from public.organizational_units where id = p_unit_id
    union all
    select o.id, o.parent_id, o.type from public.organizational_units o join cadeia c on o.id = c.parent_id
  )
  select id from cadeia where type = p_tipo limit 1;
$$;
revoke all on function public.unidade_ancestral(uuid, text) from public, anon, authenticated;
grant execute on function public.unidade_ancestral(uuid, text) to authenticated;

-- Vínculo ATIVO de p_uid, numa unidade CONCRETA, com um dos papéis pedidos — a primitiva de autoridade
-- que o motor de workflow usa (nunca o cliente declarando "sou distrital"; só o banco confere).
create or replace function public._workflow_papel_autorizado(p_uid uuid, p_unit_id uuid, p_papeis text[]) returns text
language sql stable security definer set search_path = '' as $$
  select m.role from public.organization_memberships m
  where m.user_id = p_uid and m.organizational_unit_id = p_unit_id and m.role = any (p_papeis)
    and m.status = 'ativo' and m.starts_at <= now() and (m.ends_at is null or m.ends_at > now())
  order by m.starts_at, m.created_at, m.id limit 1;
$$;
revoke all on function public._workflow_papel_autorizado(uuid, uuid, text[]) from public, anon, authenticated;

-- Conveniência pro front: "eu, autenticado, posso atuar nesta unidade com algum destes papéis?"
create or replace function public.pode_atuar_na_unidade(p_unit_id uuid, p_papeis text[]) returns boolean
language sql stable security definer set search_path = '' as $$
  select public._workflow_papel_autorizado(auth.uid(), p_unit_id, p_papeis) is not null;
$$;
revoke all on function public.pode_atuar_na_unidade(uuid, text[]) from public, anon;
grant execute on function public.pode_atuar_na_unidade(uuid, text[]) to authenticated;

-- ---------------------------------------------------------------------
-- B) workflow declarativo e versionado
-- ---------------------------------------------------------------------
create table if not exists public.investiture_workflows (
  id uuid primary key default gen_random_uuid(),
  chave text not null,
  versao int not null check (versao >= 1),
  nome text not null,
  descricao text,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  unique (chave, versao)
);
alter table public.investiture_workflows enable row level security;
revoke all on public.investiture_workflows from public, anon, authenticated;
drop policy if exists "leitura publica" on public.investiture_workflows;
create policy "leitura publica" on public.investiture_workflows for select to authenticated using (true);
grant select on public.investiture_workflows to authenticated;

create table if not exists public.investiture_workflow_stages (
  id uuid primary key default gen_random_uuid(),
  workflow_id uuid not null references public.investiture_workflows(id) on delete cascade,
  ordem int not null check (ordem >= 1),
  -- 'aprovacao_intermediaria' cobre qualquer etapa entre a revisão do clube e a investidura (revisão
  -- distrital, regional, do campo...) — o escopo_tipo é que diz QUAL nível; pode haver várias na mesma
  -- corrida (ordens diferentes), cada uma resolvida contra o tipo dela.
  chave text not null check (chave in ('revisao_clube', 'aprovacao_intermediaria', 'investidura')),
  nome text not null,
  escopo_tipo text not null check (escopo_tipo in ('clube', 'distrito', 'regiao', 'campo', 'uniao', 'divisao')),
  papeis_permitidos text[] not null check (array_length(papeis_permitidos, 1) > 0),
  obrigatoria boolean not null default true,
  -- se este nível não existir na árvore do clube (ex.: clube sem distrito cadastrado), pula
  -- automaticamente em vez de travar a investidura pra sempre — "nível opcional" de verdade.
  pular_se_nivel_ausente boolean not null default false,
  -- segregação de funções: por padrão, quem já decidiu uma etapa de escopo DIFERENTE nesta mesma
  -- corrida não pode decidir esta (autoridades distintas exigem pessoas distintas). true = permite
  -- explicitamente a mesma pessoa (uso raro; documentar o motivo na descrição do workflow).
  permite_mesmo_decisor boolean not null default false,
  unique (workflow_id, ordem)
);
alter table public.investiture_workflow_stages enable row level security;
revoke all on public.investiture_workflow_stages from public, anon, authenticated;
drop policy if exists "leitura publica" on public.investiture_workflow_stages;
create policy "leitura publica" on public.investiture_workflow_stages for select to authenticated using (true);
grant select on public.investiture_workflow_stages to authenticated;

-- workflow ATIVO pra Classes Regulares: só o que está grounded (acima) — 2 etapas, as duas na
-- autoridade do CLUBE (revisão + investidura). É EXATAMENTE o fluxo já testado na fase 4; nada muda
-- na prática pra quem usa hoje. Revisão distrital/regional fica de fora até haver fonte que a exija.
insert into public.investiture_workflows (id, chave, versao, nome, descricao, ativo)
values (public.curriculo_uuid('workflow:classes-regulares:1'), 'classes-regulares', 1, 'Investidura — Classes Regulares (v1)',
  'Revisão do clube + investidura, ambas na autoridade do clube — não há exigência de revisão distrital/regional documentada '
  'em fonte oficial pra Amigo–Guia (só para Classes de Liderança, ainda não importadas). Ver comentário no topo desta migration.', true)
on conflict (chave, versao) do nothing;
insert into public.investiture_workflow_stages (id, workflow_id, ordem, chave, nome, escopo_tipo, papeis_permitidos, obrigatoria, pular_se_nivel_ausente, permite_mesmo_decisor)
values
  (public.curriculo_uuid('workflow-stage:classes-regulares:1:1'), public.curriculo_uuid('workflow:classes-regulares:1'), 1, 'revisao_clube', 'Revisão do clube', 'clube', array['instrutor', 'diretoria'], true, false, true),
  (public.curriculo_uuid('workflow-stage:classes-regulares:1:2'), public.curriculo_uuid('workflow:classes-regulares:1'), 2, 'investidura', 'Investidura', 'clube', array['instrutor', 'diretoria'], true, false, true)
on conflict (workflow_id, ordem) do nothing;

-- ---------------------------------------------------------------------
-- C) execução do workflow — imutável (nunca UPDATE/DELETE de decisão já tomada)
-- ---------------------------------------------------------------------
create table if not exists public.investiture_workflow_runs (
  id uuid primary key default gen_random_uuid(),
  snapshot_id uuid not null unique references public.class_completion_snapshots(id),
  member_class_id uuid references public.member_classes(id) on delete set null,
  usuario_id uuid references public.profiles(id) on delete set null,
  club_id_origem uuid not null references public.organizational_units(id),
  workflow_id uuid not null references public.investiture_workflows(id),
  workflow_versao int not null,
  status text not null default 'em_andamento' check (status in ('em_andamento', 'concluido', 'cancelado')),
  current_stage_ordem int not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_investiture_workflow_runs_mc on public.investiture_workflow_runs (member_class_id, status);

create table if not exists public.workflow_stage_decisions (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.investiture_workflow_runs(id) on delete cascade,
  stage_id uuid not null references public.investiture_workflow_stages(id),
  ordem int not null,
  stage_chave text not null,
  workflow_versao int not null,
  usuario_id uuid references public.profiles(id) on delete set null,       -- dono da conclusão (denorm p/ RLS)
  club_id_origem uuid not null references public.organizational_units(id), -- clube da conclusão (denorm p/ RLS)
  escopo_tipo text not null,
  -- a unidade CONCRETA resolvida (o distrito/região/clube exato); nulo só quando decisao='pulada_nivel_ausente'
  escopo_organizational_unit_id uuid references public.organizational_units(id) on delete set null,
  papeis_permitidos text[] not null,
  papel_utilizado text,
  decisor_id uuid references public.profiles(id) on delete set null,
  decisao text not null check (decisao in ('aprovado', 'reprovado', 'correcao_solicitada', 'pulada_nivel_ausente')),
  -- método da decisão: hoje SÓ 'aprovacao_sistema' é utilizável (aprovação autenticada dentro do
  -- sistema — autoria/auditoria, NÃO assinatura digital ICP-Brasil). Os outros dois são placeholders
  -- de schema pra métodos futuros; nenhuma RPC desta fase aceita nada além de 'aprovacao_sistema'.
  metodo text not null default 'aprovacao_sistema' check (metodo in ('aprovacao_sistema', 'assinatura_eletronica', 'certificado_digital')),
  observacao text,
  decidido_em timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (run_id, stage_id)
);
create index if not exists idx_workflow_stage_decisions_run on public.workflow_stage_decisions (run_id, ordem);
create index if not exists idx_workflow_stage_decisions_decisor on public.workflow_stage_decisions (decisor_id);

drop trigger if exists trg_imutavel on public.workflow_stage_decisions;
create trigger trg_imutavel before update or delete on public.workflow_stage_decisions
for each row execute function public._proteger_registro_imutavel();

alter table public.investiture_workflow_runs enable row level security;
alter table public.workflow_stage_decisions enable row level security;
revoke insert, update, delete on public.investiture_workflow_runs, public.workflow_stage_decisions from authenticated, anon;
drop policy if exists "dono, emissor ou lideranca de clube com vinculo ativo" on public.investiture_workflow_runs;
create policy "dono, emissor ou lideranca de clube com vinculo ativo" on public.investiture_workflow_runs for select to authenticated
using (public._pode_ver_conquista_curricular(usuario_id, club_id_origem));
drop policy if exists "dono, emissor ou lideranca de clube com vinculo ativo" on public.workflow_stage_decisions;
create policy "dono, emissor ou lideranca de clube com vinculo ativo" on public.workflow_stage_decisions for select to authenticated
using (public._pode_ver_conquista_curricular(usuario_id, club_id_origem));

-- ---------------------------------------------------------------------
-- D) o motor: inicia a corrida, resolve autoridade, registra decisão IMUTÁVEL, avança (pulando
--    automaticamente etapas de nível ausente), fecha (concluído) ou cancela (reprovado/correção).
-- ---------------------------------------------------------------------
create or replace function public._workflow_iniciar_run(p_snapshot_id uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_snap record; v_wf_id uuid; v_wf_versao int; v_run_id uuid;
begin
  select * into v_snap from public.class_completion_snapshots where id = p_snapshot_id;
  if not found then raise exception 'Snapshot não encontrado.'; end if;
  select id, versao into v_wf_id, v_wf_versao from public.investiture_workflows where chave = 'classes-regulares' and ativo order by versao desc limit 1;
  if v_wf_id is null then raise exception 'Nenhum workflow de investidura ativo para classes-regulares — configuração ausente.'; end if;
  insert into public.investiture_workflow_runs (snapshot_id, member_class_id, usuario_id, club_id_origem, workflow_id, workflow_versao, status, current_stage_ordem)
  values (p_snapshot_id, v_snap.member_class_id, v_snap.usuario_id, v_snap.club_id_origem, v_wf_id, v_wf_versao, 'em_andamento',
          (select min(ordem) from public.investiture_workflow_stages where workflow_id = v_wf_id))
  returning id into v_run_id;
  -- linha legada (compat de leitura pra minha_classe()/documento_conteudo()/Investiduras.jsx, fase 4)
  insert into public.investiture_reviews (member_class_id, club_id, usuario_id, snapshot_id)
  values (v_snap.member_class_id, v_snap.club_id_origem, v_snap.usuario_id, p_snapshot_id);
  return v_run_id;
end;
$$;
revoke all on function public._workflow_iniciar_run(uuid) from public, anon, authenticated;

-- Núcleo: registra a decisão da etapa ATUAL de uma corrida (trava a corrida, confere que a etapa
-- esperada bate — "tentativa de pular etapa" é recusada aqui —, resolve o escopo concreto pela
-- hierarquia, confere autoridade e segregação de funções, grava IMUTÁVEL e avança).
create or replace function public._workflow_registrar_decisao(p_run_id uuid, p_decisao text, p_observacao text, p_chave_esperada text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_run record; v_stage record; v_escopo_unit uuid; v_papel text;
  v_decision_id uuid; v_prox record; v_prox_unit uuid; v_ultima boolean;
begin
  if p_decisao not in ('aprovado', 'reprovado', 'correcao_solicitada') then raise exception 'Decisão inválida.'; end if;
  if v_uid is null then raise exception 'Não autenticado.'; end if;
  select * into v_run from public.investiture_workflow_runs where id = p_run_id for update;
  if not found then raise exception 'Workflow de investidura não encontrado.'; end if;
  if v_run.status <> 'em_andamento' then raise exception 'Este workflow já foi concluído ou cancelado.'; end if;

  select * into v_stage from public.investiture_workflow_stages where workflow_id = v_run.workflow_id and ordem = v_run.current_stage_ordem;
  if not found then raise exception 'Etapa atual do workflow não encontrada (configuração inconsistente).'; end if;
  if p_chave_esperada is not null and v_stage.chave <> p_chave_esperada then
    raise exception 'Esta matrícula está aguardando a etapa "%" (%), não "%". Não é possível pular etapa.', v_stage.nome, v_stage.chave, p_chave_esperada;
  end if;

  v_escopo_unit := public.unidade_ancestral(v_run.club_id_origem, v_stage.escopo_tipo);
  if v_escopo_unit is null then
    raise exception 'Este clube não tem unidade organizacional do tipo "%" na hierarquia — a etapa "%" não pode ser decidida (deveria ter sido pulada automaticamente; configuração inconsistente).', v_stage.escopo_tipo, v_stage.nome;
  end if;

  v_papel := public._workflow_papel_autorizado(v_uid, v_escopo_unit, v_stage.papeis_permitidos);
  if v_papel is null then
    raise exception 'Sem permissão: a etapa "%" exige um dos papéis (%) na unidade organizacional correspondente, e você não tem vínculo ativo com nenhum deles ali.',
      v_stage.nome, array_to_string(v_stage.papeis_permitidos, '/');
  end if;

  -- segregação de funções: quem já decidiu (aprovado/reprovado) uma etapa de escopo_tipo DIFERENTE
  -- nesta mesma corrida não decide esta, salvo permissão explícita da etapa.
  if not v_stage.permite_mesmo_decisor and exists (
    select 1 from public.workflow_stage_decisions d
    where d.run_id = v_run.id and d.decisor_id = v_uid and d.escopo_tipo is distinct from v_stage.escopo_tipo and d.decisao in ('aprovado', 'reprovado')
  ) then
    raise exception 'Segregação de funções: você já decidiu outra etapa desta investidura numa instância organizacional de tipo diferente; a etapa "%" exige uma autoridade distinta e este workflow não permite o mesmo decisor.', v_stage.nome;
  end if;

  insert into public.workflow_stage_decisions (run_id, stage_id, ordem, stage_chave, workflow_versao, usuario_id, club_id_origem,
    escopo_tipo, escopo_organizational_unit_id, papeis_permitidos, papel_utilizado, decisor_id, decisao, observacao)
  values (v_run.id, v_stage.id, v_stage.ordem, v_stage.chave, v_run.workflow_versao, v_run.usuario_id, v_run.club_id_origem,
    v_stage.escopo_tipo, v_escopo_unit, v_stage.papeis_permitidos, v_papel, v_uid, p_decisao, p_observacao)
  returning id into v_decision_id;

  if p_decisao in ('reprovado', 'correcao_solicitada') then
    update public.investiture_workflow_runs set status = 'cancelado', updated_at = now() where id = v_run.id;
    return jsonb_build_object('ok', true, 'decision_id', v_decision_id, 'run_status', 'cancelado', 'stage', v_stage.chave, 'escopo_unit_id', v_escopo_unit, 'papel_utilizado', v_papel);
  end if;

  -- aprovado: avança pra próxima etapa DECIDÍVEL, pulando automaticamente as de nível ausente
  -- (registrando o pulo, imutável, pra auditoria — nunca trava a investidura por um nível que o
  -- clube simplesmente não tem na árvore).
  select * into v_prox from public.investiture_workflow_stages where workflow_id = v_run.workflow_id and ordem > v_stage.ordem order by ordem limit 1;
  loop
    exit when v_prox.id is null;
    v_prox_unit := public.unidade_ancestral(v_run.club_id_origem, v_prox.escopo_tipo);
    exit when v_prox_unit is not null or not v_prox.pular_se_nivel_ausente;
    insert into public.workflow_stage_decisions (run_id, stage_id, ordem, stage_chave, workflow_versao, usuario_id, club_id_origem,
      escopo_tipo, escopo_organizational_unit_id, papeis_permitidos, papel_utilizado, decisor_id, decisao, observacao)
    values (v_run.id, v_prox.id, v_prox.ordem, v_prox.chave, v_run.workflow_versao, v_run.usuario_id, v_run.club_id_origem,
      v_prox.escopo_tipo, null, v_prox.papeis_permitidos, null, null, 'pulada_nivel_ausente',
      'Nível organizacional "' || v_prox.escopo_tipo || '" ausente na hierarquia deste clube — etapa pulada automaticamente.');
    select * into v_prox from public.investiture_workflow_stages where workflow_id = v_run.workflow_id and ordem > v_prox.ordem order by ordem limit 1;
  end loop;

  v_ultima := v_prox.id is null;
  if v_ultima then
    update public.investiture_workflow_runs set status = 'concluido', updated_at = now() where id = v_run.id;
  else
    update public.investiture_workflow_runs set current_stage_ordem = v_prox.ordem, updated_at = now() where id = v_run.id;
  end if;

  return jsonb_build_object('ok', true, 'decision_id', v_decision_id, 'run_status', case when v_ultima then 'concluido' else 'em_andamento' end,
    'stage', v_stage.chave, 'escopo_unit_id', v_escopo_unit, 'papel_utilizado', v_papel, 'proxima_etapa', v_prox.chave, 'etapa_final', v_ultima);
end;
$$;
revoke all on function public._workflow_registrar_decisao(uuid, text, text, text) from public, anon, authenticated;

-- histórico completo (etapas do workflow + decisão de cada uma, quando houver) — mesma visibilidade
-- da conquista portátil. Satisfaz "cada etapa registra escopo/papel/decisor/decisão/data/observação/versão".
create or replace function public.workflow_historico(p_member_class_id uuid) returns json
language sql stable security definer set search_path = '' as $$
  select json_build_object(
    'runs', (select coalesce(json_agg(json_build_object(
        'run_id', r.id, 'status', r.status, 'iniciado_em', r.created_at, 'snapshot_id', r.snapshot_id,
        'workflow', json_build_object('chave', wf.chave, 'versao', r.workflow_versao, 'nome', wf.nome),
        'etapas', (select coalesce(json_agg(json_build_object(
            'ordem', st.ordem, 'chave', st.chave, 'nome', st.nome, 'escopo_tipo', st.escopo_tipo,
            'papeis_permitidos', st.papeis_permitidos, 'obrigatoria', st.obrigatoria,
            'decisao', (select json_build_object('id', d.id, 'decisao', d.decisao, 'metodo', d.metodo, 'observacao', d.observacao,
                          'decidido_em', d.decidido_em, 'workflow_versao', d.workflow_versao, 'papel_utilizado', d.papel_utilizado,
                          'decisor', (select json_build_object('id', p.id, 'nome', p.nome) from public.profiles p where p.id = d.decisor_id),
                          'escopo', (select json_build_object('id', o.id, 'nome', o.nome, 'tipo', o.type) from public.organizational_units o where o.id = d.escopo_organizational_unit_id))
                        from public.workflow_stage_decisions d where d.run_id = r.id and d.stage_id = st.id)
          ) order by st.ordem), '[]'::json)
          from public.investiture_workflow_stages st where st.workflow_id = r.workflow_id)
      ) order by r.created_at), '[]'::json)
      from public.investiture_workflow_runs r join public.investiture_workflows wf on wf.id = r.workflow_id
      where r.member_class_id = p_member_class_id and public._pode_ver_conquista_curricular(r.usuario_id, r.club_id_origem))
  );
$$;
revoke all on function public.workflow_historico(uuid) from public, anon;
grant execute on function public.workflow_historico(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- E) _classe_selar_conclusao passa a abrir a CORRIDA do workflow (em vez de inserir direto em
--    investiture_reviews) — corpo idêntico ao da migration 44 fora dessa troca.
-- ---------------------------------------------------------------------
create or replace function public._classe_selar_conclusao(p_member_class_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_mc record; v_bloq jsonb; v_pend int; v_conteudo jsonb; v_hash text; v_versao int; v_snap uuid; v_prazo jsonb;
begin
  select * into v_mc from public.member_classes where id = p_member_class_id for update;
  if not found then raise exception 'Classe do membro não encontrada.'; end if;
  if v_mc.status <> 'requisitos_concluidos' then raise exception 'A matrícula não está em "requisitos concluídos" (status atual: %).', v_mc.status; end if;

  select count(*) into v_pend from public.member_requirements mr join public.class_requirements r on r.id = mr.requirement_id and r.ativo
   where mr.member_class_id = v_mc.id and mr.status <> 'aprovado';
  select coalesce(jsonb_agg(jsonb_build_object('member_requirement_id', mr.id, 'codigo', r.codigo, 'bloqueios', to_jsonb(b))), '[]'::jsonb) into v_bloq
    from public.member_requirements mr join public.class_requirements r on r.id = mr.requirement_id and r.ativo
    cross join lateral public._requisito_bloqueios(mr.id) b
   where mr.member_class_id = v_mc.id and array_length(b, 1) > 0;
  select public.prazo_situacao(v_mc.iniciada_em, c.prazo_minimo_dias, c.prazo_maximo_dias) into v_prazo from public.classes c where c.id = v_mc.class_id;
  if v_pend > 0 or jsonb_array_length(v_bloq) > 0 or not (v_prazo ->> 'minimo_atingido')::boolean then
    perform public._classe_evento(v_mc.id, 'conclusao_bloqueada', null, null,
      jsonb_build_object('requisitos_nao_aprovados', v_pend, 'bloqueios', v_bloq, 'prazo', v_prazo));
    return jsonb_build_object('ok', false, 'status', 'requisitos_concluidos', 'requisitos_nao_aprovados', v_pend, 'bloqueios', v_bloq, 'prazo', v_prazo);
  end if;

  v_conteudo := public._classe_snapshot_conteudo(v_mc.id);
  v_hash := public._snapshot_hash(v_conteudo);
  select coalesce(max(versao), 0) + 1 into v_versao from public.class_completion_snapshots where member_class_id = v_mc.id;
  update public.class_completion_snapshots set status = 'substituido' where member_class_id = v_mc.id and status = 'selado';
  insert into public.class_completion_snapshots (member_class_id, usuario_id, club_id_origem, classe_id, curriculum_version_id, versao, conteudo, hash, gerado_por)
  select v_mc.id, v_mc.usuario_id, v_mc.club_id, v_mc.class_id, c.curriculum_version_id, v_versao, v_conteudo, v_hash, auth.uid()
    from public.classes c where c.id = v_mc.class_id
  returning id into v_snap;
  if v_versao > 1 then perform public._classe_evento(v_mc.id, 'snapshot_substituido', v_snap, null, jsonb_build_object('versao_nova', v_versao)); end if;
  perform public._classe_evento(v_mc.id, 'snapshot_selado', v_snap, null, jsonb_build_object('versao', v_versao, 'hash', v_hash));

  perform public._workflow_iniciar_run(v_snap);  -- fase 4.2: corrida do workflow declarativo (+ linha legada investiture_reviews)
  update public.member_classes set status = 'aguardando_revisao', updated_at = now() where id = v_mc.id;
  perform public._classe_evento(v_mc.id, 'revisao_solicitada', v_snap, null, null);
  return jsonb_build_object('ok', true, 'status', 'aguardando_revisao', 'snapshot_id', v_snap, 'versao', v_versao, 'hash', v_hash);
end;
$$;
revoke all on function public._classe_selar_conclusao(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- F) revisao_final_decidir / investidura_registrar: MESMA assinatura, MESMOS textos de erro, MESMOS
--    efeitos em investiture_reviews/class_investitures/curriculum_achievements (nada muda pra quem já
--    usa) — agora autorizados e auditados pelo motor declarativo por baixo.
-- ---------------------------------------------------------------------
create or replace function public.revisao_final_decidir(p_member_class_id uuid, p_decisao text, p_observacao text default null, p_requisitos_para_corrigir uuid[] default '{}') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid(); v_club uuid := public.clube_atual_id(); v_mc record; v_ir record; v_papel text; v_id uuid; v_n int := 0;
  v_run record; v_result jsonb; v_status_final text;
begin
  if p_decisao not in ('aprovado', 'correcao_solicitada') then raise exception 'Decisão inválida.'; end if;
  if v_uid is null or v_club is null or not public.pode_gerir_no_clube(v_club) then raise exception 'Sem permissão (apenas diretoria/instrutor deste clube).'; end if;
  perform public._exigir_classes_habilitado(v_club);
  select * into v_mc from public.member_classes where id = p_member_class_id and club_id = v_club for update;
  if not found then raise exception 'Classe do membro não encontrada neste clube.'; end if;
  if v_mc.status <> 'aguardando_revisao' then raise exception 'Esta matrícula não está aguardando revisão final (status: %).', v_mc.status; end if;
  select * into v_ir from public.investiture_reviews where member_class_id = v_mc.id and status = 'pendente' for update;
  if not found then raise exception 'Revisão final pendente não encontrada.'; end if;
  select r.* into v_run from public.investiture_workflow_runs r where r.snapshot_id = v_ir.snapshot_id and r.status = 'em_andamento';
  if not found then raise exception 'Workflow de investidura não encontrado para esta revisão.'; end if;

  -- fase 4.2: a etapa "revisao_clube" precisa ser a atual — se um workflow com etapa intermediária
  -- (ex.: revisão distrital) ainda estiver pendente à frente desta, o motor recusa (não pula etapa).
  v_result := public._workflow_registrar_decisao(v_run.id, p_decisao, p_observacao, 'revisao_clube');
  v_papel := coalesce(v_result ->> 'papel_utilizado', public.papel_no_clube(v_uid, v_club), '?');

  if p_decisao = 'aprovado' then
    -- 'apto_investidura' só quando a PRÓXIMA etapa é a investidura (workflow padrão: sempre, hoje —
    -- generaliza corretamente se um dia houver etapa intermediária entre revisão e investidura).
    v_status_final := case when (v_result ->> 'proxima_etapa') = 'investidura' then 'apto_investidura' else v_mc.status end;
    update public.investiture_reviews set status = 'aprovado', revisado_por = v_uid, revisado_em = now(), revisado_papel = v_papel, comentario = p_observacao where id = v_ir.id;
    update public.member_classes set status = v_status_final, updated_at = now() where id = v_mc.id;
    perform public._classe_evento(v_mc.id, 'revisao_aprovada', v_ir.snapshot_id, p_observacao, jsonb_build_object('review_id', v_ir.id, 'proxima_etapa', v_result ->> 'proxima_etapa'));
    return jsonb_build_object('ok', true, 'status', v_status_final);
  end if;

  if coalesce(array_length(p_requisitos_para_corrigir, 1), 0) = 0 then raise exception 'Indique ao menos um requisito a corrigir.'; end if;
  if coalesce(trim(p_observacao), '') = '' then raise exception 'Explique o que precisa ser corrigido.'; end if;
  foreach v_id in array p_requisitos_para_corrigir loop
    if not exists (select 1 from public.member_requirements where id = v_id and member_class_id = v_mc.id) then raise exception 'Requisito % não é desta matrícula.', v_id; end if;
    update public.member_requirements set status = 'correcao_solicitada', updated_at = now() where id = v_id;
    insert into public.requirement_approvals (member_requirement_id, requirement_id, curriculum_version_id, club_id, decisao, avaliado_por, avaliado_papel, comentario)
    select mr.id, mr.requirement_id, c.curriculum_version_id, v_club, 'correcao_solicitada', v_uid, v_papel, 'Revisão final: ' || p_observacao
      from public.member_requirements mr join public.class_requirements r on r.id = mr.requirement_id join public.class_sections s on s.id = r.section_id join public.classes c on c.id = s.class_id
     where mr.id = v_id;
    v_n := v_n + 1;
  end loop;
  update public.investiture_reviews set status = 'correcao_solicitada', revisado_por = v_uid, revisado_em = now(), revisado_papel = v_papel, comentario = p_observacao where id = v_ir.id;
  update public.member_classes set status = 'em_andamento', concluida_em = null, updated_at = now() where id = v_mc.id;
  perform public._classe_evento(v_mc.id, 'revisao_correcao', v_ir.snapshot_id, p_observacao, jsonb_build_object('review_id', v_ir.id, 'requisitos', to_jsonb(p_requisitos_para_corrigir)));
  return jsonb_build_object('ok', true, 'status', 'em_andamento', 'requisitos_reabertos', v_n);
end;
$$;
revoke all on function public.revisao_final_decidir(uuid, text, text, uuid[]) from public, anon;
grant execute on function public.revisao_final_decidir(uuid, text, text, uuid[]) to authenticated;

-- etapas intermediárias (nem revisao_clube, nem investidura) — ex.: revisão distrital/regional num
-- workflow configurado com essa exigência (não é o caso do workflow ativo hoje, mas o motor suporta).
-- Quem decide aqui NÃO precisa ter clube em uso nem vínculo com o clube: a autoridade é resolvida pela
-- hierarquia (distrito/região do clube da matrícula), como em qualquer etapa do motor.
create or replace function public.workflow_etapa_intermediaria_decidir(p_member_class_id uuid, p_decisao text, p_observacao text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_mc record; v_run record; v_stage record; v_result jsonb;
begin
  if p_decisao not in ('aprovado', 'reprovado') then raise exception 'Decisão inválida.'; end if;
  if v_uid is null then raise exception 'Não autenticado.'; end if;
  select * into v_mc from public.member_classes where id = p_member_class_id;
  if not found then raise exception 'Classe do membro não encontrada.'; end if;
  perform public._exigir_classes_habilitado(v_mc.club_id);
  select r.* into v_run from public.investiture_workflow_runs r
   join public.class_completion_snapshots s on s.id = r.snapshot_id
   where r.member_class_id = v_mc.id and r.status = 'em_andamento' order by r.created_at desc limit 1 for update;
  if not found then raise exception 'Não há workflow de investidura em andamento para esta matrícula.'; end if;
  select * into v_stage from public.investiture_workflow_stages where workflow_id = v_run.workflow_id and ordem = v_run.current_stage_ordem;
  if not found or v_stage.chave <> 'aprovacao_intermediaria' then
    raise exception 'A etapa atual (%) não é uma etapa intermediária — use a RPC correspondente.', coalesce(v_stage.chave, '(nenhuma)');
  end if;

  v_result := public._workflow_registrar_decisao(v_run.id, p_decisao, p_observacao, null);
  if p_decisao = 'aprovado' and (v_result ->> 'proxima_etapa') = 'investidura' then
    update public.member_classes set status = 'apto_investidura', updated_at = now() where id = v_mc.id;
  elsif p_decisao = 'reprovado' then
    update public.member_classes set status = 'em_andamento', concluida_em = null, updated_at = now() where id = v_mc.id;
    perform public._classe_evento(v_mc.id, 'revisao_correcao', v_run.snapshot_id, p_observacao, jsonb_build_object('etapa', v_stage.chave, 'decisao', 'reprovado'));
  end if;
  return v_result;
end;
$$;
revoke all on function public.workflow_etapa_intermediaria_decidir(uuid, text, text) from public, anon;
grant execute on function public.workflow_etapa_intermediaria_decidir(uuid, text, text) to authenticated;

create or replace function public.investidura_registrar(p_member_class_id uuid, p_data date default current_date, p_observacao text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid(); v_club uuid := public.clube_atual_id(); v_mc record; v_ir record; v_snap record; v_pend int; v_bloq jsonb; v_inv uuid; v_papel text;
  v_run record; v_result jsonb;
begin
  if v_uid is null or v_club is null or not public.pode_gerir_no_clube(v_club) then raise exception 'Sem permissão (apenas diretoria/instrutor deste clube).'; end if;
  perform public._exigir_classes_habilitado(v_club);
  select * into v_mc from public.member_classes where id = p_member_class_id and club_id = v_club for update;
  if not found then raise exception 'Classe do membro não encontrada neste clube.'; end if;
  if v_mc.status = 'investida' or exists (select 1 from public.class_investitures where member_class_id = v_mc.id and status = 'registrada') then
    raise exception 'Investidura já registrada para esta matrícula.';
  end if;
  if v_mc.status <> 'apto_investidura' then raise exception 'Investidura não permitida: a revisão final ainda não foi aprovada (status: %).', v_mc.status; end if;
  select * into v_ir from public.investiture_reviews where member_class_id = v_mc.id and status = 'aprovado' order by revisado_em desc limit 1;
  if not found then raise exception 'Investidura não permitida: revisão final aprovada não encontrada.'; end if;
  select * into v_snap from public.class_completion_snapshots where id = v_ir.snapshot_id and status = 'selado';
  if not found then raise exception 'Investidura não permitida: o snapshot da conclusão não está selado.'; end if;
  if p_data is null or p_data > current_date then raise exception 'Data de investidura inválida.'; end if;
  select r.* into v_run from public.investiture_workflow_runs r where r.snapshot_id = v_snap.id and r.status = 'em_andamento' for update;
  if not found then raise exception 'Investidura não permitida: workflow desta conclusão não está em andamento (etapas obrigatórias pendentes ou já concluído/cancelado).'; end if;

  -- reconfere AGORA: requisito pendente, bloqueado, dinâmico sem valor, N-de-M incompleto — nada passa
  select count(*) into v_pend from public.member_requirements mr join public.class_requirements r on r.id = mr.requirement_id and r.ativo where mr.member_class_id = v_mc.id and mr.status <> 'aprovado';
  select coalesce(jsonb_agg(jsonb_build_object('codigo', r.codigo, 'bloqueios', to_jsonb(b))), '[]'::jsonb) into v_bloq
    from public.member_requirements mr join public.class_requirements r on r.id = mr.requirement_id and r.ativo
    cross join lateral public._requisito_bloqueios(mr.id) b where mr.member_class_id = v_mc.id and array_length(b, 1) > 0;
  if v_pend > 0 then raise exception 'Investidura não permitida: % requisito(s) não aprovado(s).', v_pend; end if;
  if jsonb_array_length(v_bloq) > 0 then raise exception 'Investidura não permitida: requisito bloqueado — %', v_bloq::text; end if;

  -- fase 4.2: etapa "investidura" precisa ser a atual (segrega e resolve autoridade pelo motor); só
  -- então grava o evento LEGADO de investidura (class_investitures) com o papel realmente usado.
  v_result := public._workflow_registrar_decisao(v_run.id, 'aprovado', p_observacao, 'investidura');
  v_papel := coalesce(v_result ->> 'papel_utilizado', public.papel_no_clube(v_uid, v_club), '?');

  insert into public.class_investitures (member_class_id, snapshot_id, usuario_id, club_id, registrado_por, registrado_papel, data_investidura, observacao)
  values (v_mc.id, v_snap.id, v_mc.usuario_id, v_club, v_uid, v_papel, p_data, p_observacao) returning id into v_inv;
  update public.investiture_reviews set status = 'investido' where id = v_ir.id;
  update public.member_classes set status = 'investida', investida_em = p_data::timestamptz, updated_at = now() where id = v_mc.id;  -- gatilho emite a conquista
  update public.curriculum_achievements set snapshot_id = v_snap.id where member_class_id = v_mc.id and tipo = 'classe' and status = 'ativa' and snapshot_id is null;
  perform public._classe_evento(v_mc.id, 'investidura_registrada', v_snap.id, p_observacao, jsonb_build_object('investidura_id', v_inv, 'data', p_data));
  return jsonb_build_object('ok', true, 'status', 'investida', 'investidura_id', v_inv, 'snapshot_id', v_snap.id,
    'conquista_id', (select id from public.curriculum_achievements where member_class_id = v_mc.id and tipo = 'classe' and status = 'ativa'));
end;
$$;
revoke all on function public.investidura_registrar(uuid, date, text) from public, anon;
grant execute on function public.investidura_registrar(uuid, date, text) to authenticated;

notify pgrst, 'reload schema';

insert into public.migracoes_aplicadas (arquivo)
values ('2026-09-21-hierarquia-institucional-e-workflow-investidura.sql')
on conflict (arquivo) do update set aplicada_em = now();
