-- =====================================================================
-- Motor de Regras Curriculares — fase 2.6. Rodar DEPOIS da 20260921000037. Idempotente.
--
-- Evolui o schema para representar SEM PERDA as 4 lacunas achadas na auditoria oficial
-- (AUDITORIA-CURRICULO-OFICIAL.md §10, manifesto supabase/curriculo-manifesto/):
--   A) conteúdo anual/dinâmico — catálogo temporal próprio (dynamic_content_definitions/
--      dynamic_content_values), resolução determinística por vigência, SEM criar uma
--      curriculum_version nova por ano.
--   B) escolha N-de-M — requirement_option_groups/requirement_options, declarativo,
--      extensível a qualquer N (não só "escolha 1"); servidor calcula satisfação.
--   C) não repetir especialidade — NÃO consulta member_specialties do clube atual: cria
--      curriculum_achievements, o HISTÓRICO CURRICULAR PORTÁTIL da pessoa (identidade
--      global), com proveniência completa (clube de origem, versão, data, avaliador via
--      requirement_approvals já existente, revogação preserva histórico). Um clube nunca
--      alter/apaga conquista emitida por outro — só o próprio emissor revoga (soft, nunca
--      hard delete). dependencias_pendentes/dependencias_satisfeitas (migration 37) passam
--      a consultar ESTE histórico portátil em vez de member_classes/member_specialties
--      direto — é assim que "o novo clube consulta a conclusão reconhecida pra satisfazer
--      regra curricular" (o pedido desta fase), sem nunca vazar pontos/ranking/mensalidade/
--      presença/mensagens/arquivo — nada disso está em curriculum_achievements.
--   D) prazo de conclusão — prazo_minimo_dias/prazo_maximo_dias em classes/specialties
--      (colunas genéricas do PRÓPRIO registro versionado, não uma coluna por regra tipo
--      "prazo_lider"); o gatilho de conclusão passa a respeitar o prazo mínimo. NULL em
--      todas as 6 Classes Regulares hoje (a fonte não determina prazo pra elas) — a
--      capacidade existe, sem ser aplicada sem fonte que mande.
--
-- Motor de explicação: explicar_requisito_classe/explicar_requisito_especialidade devolvem
-- { resultado: satisfeito|pendente|bloqueado, regras_aplicadas: [{regra, satisfeito, origem, detalhe}] }
-- — cada regra aponta pra qual mecanismo (tabela/coluna) produziu o resultado.
--
-- Ainda NÃO importa as 6 Classes Regulares nem cria dado real além de fixtures de teste
-- (nos arquivos de teste, não nesta migration). PDF/cartão/assinatura/Liderança/catálogo
-- de Especialidades continuam fora de escopo.
-- =====================================================================

-- ---------------------------------------------------------------------
-- A) Conteúdo anual/dinâmico
-- ---------------------------------------------------------------------
create table if not exists public.dynamic_content_definitions (
  id uuid primary key default gen_random_uuid(),
  chave text not null unique check (chave ~ '^[a-z][a-z0-9_]*$'),
  nome text not null,
  descricao text,
  created_at timestamptz not null default now()
);

create table if not exists public.dynamic_content_values (
  id uuid primary key default gen_random_uuid(),
  definicao_id uuid not null references public.dynamic_content_definitions(id) on delete cascade,
  valor text not null,
  vigente_desde date not null,
  vigente_ate date,
  fonte_url text,
  fonte_descricao text,
  created_at timestamptz not null default now(),
  constraint dynamic_content_values_periodo_valido check (vigente_ate is null or vigente_ate >= vigente_desde)
);
create index if not exists idx_dynamic_content_values_definicao on public.dynamic_content_values(definicao_id, vigente_desde);

-- nenhum valor pode sobrepor o período de outro da MESMA definição (usa daterange nativo — sem
-- precisar de extensão nova pra um EXCLUDE constraint).
create or replace function public.validar_periodo_conteudo_dinamico() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  -- período invertido: deixa o CHECK da tabela recusar com a mensagem própria (não monta um daterange inválido)
  if new.vigente_ate is not null and new.vigente_ate < new.vigente_desde then return new; end if;
  if exists (
    select 1 from public.dynamic_content_values v
    where v.definicao_id = new.definicao_id and v.id <> new.id
      and daterange(v.vigente_desde, coalesce(v.vigente_ate, date '9999-12-31'), '[]')
          && daterange(new.vigente_desde, coalesce(new.vigente_ate, date '9999-12-31'), '[]')
  ) then
    raise exception 'Período de vigência (% a %) sobrepõe outro valor já cadastrado para esta definição.', new.vigente_desde, new.vigente_ate;
  end if;
  return new;
end;
$$;
revoke all on function public.validar_periodo_conteudo_dinamico() from public, anon, authenticated;
drop trigger if exists trg_validar_periodo_conteudo_dinamico on public.dynamic_content_values;
create trigger trg_validar_periodo_conteudo_dinamico before insert or update on public.dynamic_content_values
for each row execute function public.validar_periodo_conteudo_dinamico();

-- resolução determinística: o valor vigente numa DATA (padrão hoje) para uma chave. valor=null
-- quando não há nenhum período cadastrado cobrindo a data (nunca adivinha).
create or replace function public.conteudo_dinamico_resolver(p_chave text, p_data date default current_date) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'chave', d.chave, 'valor', v.valor, 'vigente_desde', v.vigente_desde, 'vigente_ate', v.vigente_ate,
    'fonte_url', v.fonte_url, 'fonte_descricao', v.fonte_descricao
  )
  from public.dynamic_content_definitions d
  left join public.dynamic_content_values v on v.definicao_id = d.id
    and v.vigente_desde <= p_data and (v.vigente_ate is null or v.vigente_ate >= p_data)
  where d.chave = p_chave
  limit 1;
$$;
revoke all on function public.conteudo_dinamico_resolver(text, date) from public, anon;
grant execute on function public.conteudo_dinamico_resolver(text, date) to authenticated;

alter table public.class_requirements
  add column if not exists conteudo_dinamico_definicao_id uuid references public.dynamic_content_definitions(id);
alter table public.specialty_requirements
  add column if not exists conteudo_dinamico_definicao_id uuid references public.dynamic_content_definitions(id);

alter table public.dynamic_content_definitions enable row level security;
alter table public.dynamic_content_values enable row level security;
revoke all on public.dynamic_content_definitions from public, anon, authenticated;
revoke all on public.dynamic_content_values from public, anon, authenticated;
drop policy if exists "leitura publica" on public.dynamic_content_definitions;
create policy "leitura publica" on public.dynamic_content_definitions for select to authenticated using (true);
drop policy if exists "leitura publica" on public.dynamic_content_values;
create policy "leitura publica" on public.dynamic_content_values for select to authenticated using (true);
grant select on public.dynamic_content_definitions, public.dynamic_content_values to authenticated;

-- ---------------------------------------------------------------------
-- B) Escolha N-de-M
-- ---------------------------------------------------------------------
create table if not exists public.requirement_option_groups (
  id uuid primary key default gen_random_uuid(),
  alvo_tipo text not null check (alvo_tipo in ('class_requirement', 'specialty_requirement')),
  alvo_id uuid not null,
  n_minimo int not null default 1 check (n_minimo >= 1),
  sem_repeticao boolean not null default false,
  created_at timestamptz not null default now(),
  unique (alvo_tipo, alvo_id)
);

create table if not exists public.requirement_options (
  id uuid primary key default gen_random_uuid(),
  grupo_id uuid not null references public.requirement_option_groups(id) on delete cascade,
  rotulo text not null,
  specialty_id uuid references public.specialties(id),
  ordem int not null default 100,
  created_at timestamptz not null default now()
);
create index if not exists idx_requirement_options_grupo on public.requirement_options(grupo_id);

create or replace function public.validar_grupo_opcoes() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_ok boolean;
begin
  v_ok := case new.alvo_tipo
    when 'class_requirement' then exists (select 1 from public.class_requirements where id = new.alvo_id)
    when 'specialty_requirement' then exists (select 1 from public.specialty_requirements where id = new.alvo_id)
    else false
  end;
  if not v_ok then raise exception 'requirement_option_groups.alvo_id não existe para alvo_tipo=%', new.alvo_tipo; end if;
  return new;
end;
$$;
revoke all on function public.validar_grupo_opcoes() from public, anon, authenticated;
drop trigger if exists trg_validar_grupo_opcoes on public.requirement_option_groups;
create trigger trg_validar_grupo_opcoes before insert or update on public.requirement_option_groups
for each row execute function public.validar_grupo_opcoes();

alter table public.requirement_option_groups enable row level security;
alter table public.requirement_options enable row level security;
revoke all on public.requirement_option_groups from public, anon, authenticated;
revoke all on public.requirement_options from public, anon, authenticated;
drop policy if exists "leitura publica" on public.requirement_option_groups;
create policy "leitura publica" on public.requirement_option_groups for select to authenticated using (true);
drop policy if exists "leitura publica" on public.requirement_options;
create policy "leitura publica" on public.requirement_options for select to authenticated using (true);
grant select on public.requirement_option_groups, public.requirement_options to authenticated;

-- ---------------------------------------------------------------------
-- C) Histórico curricular PORTÁTIL — a peça central desta fase
-- ---------------------------------------------------------------------
-- Uma linha por conquista (classe OU especialidade) concluída, presa à IDENTIDADE GLOBAL da
-- pessoa (usuario_id → profiles), nunca ao clube operacional. club_id_origem é IMUTÁVEL (só
-- quem emitiu pode revogar — nunca outro clube). NÃO tem pontos, presença, ranking,
-- mensalidade, mensagem ou arquivo — só o fato curricular + proveniência (quem concluiu, onde,
-- quando, a versão exata via classe_id/specialty_id que já aponta pra curriculum_version certa,
-- e requirement_approvals — já existente — continua sendo o rastro de QUEM avaliou cada
-- requisito que levou a essa conclusão).
create table if not exists public.curriculum_achievements (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references public.profiles(id) on delete cascade,
  tipo text not null check (tipo in ('classe', 'especialidade')),
  classe_id uuid references public.classes(id),
  specialty_id uuid references public.specialties(id),
  club_id_origem uuid not null references public.organizational_units(id),
  member_class_id uuid references public.member_classes(id) on delete set null,
  member_specialty_id uuid references public.member_specialties(id) on delete set null,
  concluida_em timestamptz not null,
  status text not null default 'ativa' check (status in ('ativa', 'revogada')),
  revogada_em timestamptz,
  revogada_por uuid references public.profiles(id),
  revogada_motivo text,
  created_at timestamptz not null default now(),
  constraint curriculum_achievements_tipo_coerente check (
    (tipo = 'classe' and classe_id is not null and specialty_id is null)
    or (tipo = 'especialidade' and specialty_id is not null and classe_id is null)
  )
);
-- 1 conquista por pessoa+classe+clube-emissor (e idem pra especialidade) — índices parciais
-- (não um UNIQUE combinado) porque classe_id/specialty_id são mutuamente NULL, e NULL nunca
-- colide em UNIQUE — um índice só bastaria pra deixar duplicar.
create unique index if not exists ux_curriculum_achievements_classe
  on public.curriculum_achievements (usuario_id, classe_id, club_id_origem) where tipo = 'classe';
create unique index if not exists ux_curriculum_achievements_especialidade
  on public.curriculum_achievements (usuario_id, specialty_id, club_id_origem) where tipo = 'especialidade';
create index if not exists idx_curriculum_achievements_usuario on public.curriculum_achievements(usuario_id, status);

alter table public.curriculum_achievements enable row level security;
revoke insert, update, delete on public.curriculum_achievements from authenticated, anon;

-- Quem pode VER: a própria pessoa; a liderança do clube que EMITIU (autoridade permanente sobre
-- o que emitiu, mesmo que a pessoa já não seja mais membro de lá); a liderança de QUALQUER clube
-- onde a pessoa TEM VÍNCULO ATIVO hoje (é assim que "o novo clube consulta" funciona).
create or replace function public._pode_ver_conquista_curricular(p_usuario_id uuid, p_club_id_origem uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_usuario_id = auth.uid()
    or public.pode_gerir_no_clube(p_club_id_origem)
    or exists (
      select 1 from public.organization_memberships m
      where m.user_id = p_usuario_id and m.status = 'ativo'
        and m.starts_at <= now() and (m.ends_at is null or m.ends_at > now())
        and public.pode_gerir_no_clube(m.organizational_unit_id)
    );
$$;
revoke all on function public._pode_ver_conquista_curricular(uuid, uuid) from public, anon;
grant execute on function public._pode_ver_conquista_curricular(uuid, uuid) to authenticated;

drop policy if exists "dono, emissor ou lideranca de clube com vinculo ativo" on public.curriculum_achievements;
create policy "dono, emissor ou lideranca de clube com vinculo ativo" on public.curriculum_achievements for select to authenticated
using (public._pode_ver_conquista_curricular(usuario_id, club_id_origem));

-- Gatilho: registra a conquista automaticamente quando member_classes/member_specialties chega
-- num status terminal de conclusão — por UPDATE (o caminho normal, via avaliação) OU por INSERT
-- já concluído (importação/reconhecimento direto por SQL). club_id_origem vem SEMPRE do próprio
-- registro operacional (nunca aceito do cliente) — não tem como forjar. on conflict pelos índices
-- parciais acima: reprocessar (ex. investidura depois de concluída) não duplica.
create or replace function public.registrar_conquista_curricular() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_argv[0] = 'member_classes' then
    if new.status in ('concluida', 'investida') and (old.status is null or old.status not in ('concluida', 'investida')) then
      insert into public.curriculum_achievements (usuario_id, tipo, classe_id, club_id_origem, member_class_id, concluida_em)
      values (new.usuario_id, 'classe', new.class_id, new.club_id, new.id, coalesce(new.concluida_em, now()))
      on conflict (usuario_id, classe_id, club_id_origem) where tipo = 'classe' do nothing;
    end if;
  elsif tg_argv[0] = 'member_specialties' then
    if new.status = 'concluida' and (old.status is null or old.status is distinct from 'concluida') then
      insert into public.curriculum_achievements (usuario_id, tipo, specialty_id, club_id_origem, member_specialty_id, concluida_em)
      values (new.usuario_id, 'especialidade', new.specialty_id, new.club_id, new.id, coalesce(new.concluida_em, now()))
      on conflict (usuario_id, specialty_id, club_id_origem) where tipo = 'especialidade' do nothing;
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.registrar_conquista_curricular() from public, anon, authenticated;

drop trigger if exists trg_registrar_conquista_curricular on public.member_classes;
create trigger trg_registrar_conquista_curricular after insert or update of status on public.member_classes
for each row execute function public.registrar_conquista_curricular('member_classes');

drop trigger if exists trg_registrar_conquista_curricular on public.member_specialties;
create trigger trg_registrar_conquista_curricular after insert or update of status on public.member_specialties
for each row execute function public.registrar_conquista_curricular('member_specialties');

-- Revogação: SEMPRE soft (nunca DELETE) — preserva histórico e autoria. Só o clube que EMITIU
-- pode revogar (club_id_origem é a única autoridade — nunca "o clube em uso" de quem chama, se
-- for outro clube). Idempotente contra revogar 2x.
create or replace function public.curriculum_achievement_revogar(p_id uuid, p_motivo text default null) returns json
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_ca record;
begin
  select * into v_ca from public.curriculum_achievements where id = p_id for update;
  if not found then raise exception 'Conquista curricular não encontrada.'; end if;
  if not public.pode_gerir_no_clube(v_ca.club_id_origem) then
    raise exception 'Sem permissão (só a liderança do clube que emitiu esta conquista pode revogar).';
  end if;
  if v_ca.status = 'revogada' then raise exception 'Esta conquista já está revogada.'; end if;
  update public.curriculum_achievements
     set status = 'revogada', revogada_em = now(), revogada_por = v_uid, revogada_motivo = p_motivo
   where id = p_id;
  return json_build_object('ok', true);
end;
$$;
revoke all on function public.curriculum_achievement_revogar(uuid, text) from public, anon;
grant execute on function public.curriculum_achievement_revogar(uuid, text) to authenticated;

-- Consulta portátil: uma pessoa concluiu esta classe/especialidade, ATIVA, em qualquer clube?
create or replace function public.curriculo_pessoa_concluiu(p_tipo text, p_usuario_id uuid, p_classe_id uuid default null, p_specialty_id uuid default null) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.curriculum_achievements
    where usuario_id = p_usuario_id and tipo = p_tipo and status = 'ativa'
      and (p_tipo <> 'classe' or classe_id = p_classe_id)
      and (p_tipo <> 'especialidade' or specialty_id = p_specialty_id)
  );
$$;
revoke all on function public.curriculo_pessoa_concluiu(text, uuid, uuid, uuid) from public, anon, authenticated;

-- "Não repetir especialidade": primitiva pública, usa o histórico PORTÁTIL (nunca
-- member_specialties do clube atual) — decide se uma especialidade já é conquista da pessoa,
-- em QUALQUER clube, ativa.
create or replace function public.especialidade_ja_concluida_pela_pessoa(p_usuario_id uuid, p_specialty_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.curriculo_pessoa_concluiu('especialidade', p_usuario_id, null, p_specialty_id);
$$;
revoke all on function public.especialidade_ja_concluida_pela_pessoa(uuid, uuid) from public, anon;
grant execute on function public.especialidade_ja_concluida_pela_pessoa(uuid, uuid) to authenticated;

-- Quantas opções de um grupo N-de-M já estão satisfeitas automaticamente (só as ligadas a
-- specialty_id, via o histórico PORTÁTIL) — informativo; aprovação manual continua valendo.
create or replace function public.opcoes_satisfeitas_automaticamente(p_grupo_id uuid, p_usuario_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'n_minimo', g.n_minimo,
    'sem_repeticao', g.sem_repeticao,
    'total_opcoes', (select count(*) from public.requirement_options where grupo_id = g.id),
    'satisfeitas', coalesce((
      select count(*) from public.requirement_options o
      where o.grupo_id = g.id and o.specialty_id is not null
        and public.curriculo_pessoa_concluiu('especialidade', p_usuario_id, null, o.specialty_id)
    ), 0)
  )
  from public.requirement_option_groups g where g.id = p_grupo_id;
$$;
revoke all on function public.opcoes_satisfeitas_automaticamente(uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- dependências curriculares (migration 37) passam a consultar o histórico PORTÁTIL — é assim
-- que "o novo clube consulta a conclusão reconhecida pra satisfazer regra curricular" funciona.
-- Antes: só contava conclusão NO MESMO CLUBE do requisito. Agora: conta em qualquer clube, desde
-- que a conquista esteja ATIVA (não revogada) — evolução consciente, documentada no relatório
-- desta fase (mudança de comportamento em relação à migration 37).
-- ---------------------------------------------------------------------
create or replace function public.dependencias_pendentes(p_alvo_tipo text, p_alvo_id uuid, p_usuario_id uuid, p_club_id uuid) returns text[]
language plpgsql stable security definer set search_path = '' as $$
declare r record; v_ok boolean; v_nome text; v_faltando text[] := '{}';
begin
  for r in select * from public.curriculum_dependencies where alvo_tipo = p_alvo_tipo and alvo_id = p_alvo_id and obrigatorio loop
    if r.depende_de_tipo = 'class' then
      v_ok := public.curriculo_pessoa_concluiu('classe', p_usuario_id, r.depende_de_id, null);
      select nome into v_nome from public.classes where id = r.depende_de_id;
    else
      v_ok := public.curriculo_pessoa_concluiu('especialidade', p_usuario_id, null, r.depende_de_id);
      select nome into v_nome from public.specialties where id = r.depende_de_id;
    end if;
    if not v_ok then
      v_faltando := array_append(v_faltando, coalesce(v_nome, r.depende_de_id::text));
    end if;
  end loop;
  return v_faltando;
end;
$$;
revoke all on function public.dependencias_pendentes(text, uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.dependencias_pendentes(text, uuid, uuid, uuid) to authenticated;
-- p_club_id não é mais usado no corpo (a checagem virou portátil) — mantido na assinatura só
-- por compatibilidade com quem já chama esta função (classe_iniciar, requisito_avaliar, etc.).

-- ---------------------------------------------------------------------
-- D) Prazo de conclusão
-- ---------------------------------------------------------------------
alter table public.classes add column if not exists prazo_minimo_dias int check (prazo_minimo_dias is null or prazo_minimo_dias >= 0);
alter table public.classes add column if not exists prazo_maximo_dias int check (prazo_maximo_dias is null or prazo_maximo_dias >= 0);
alter table public.specialties add column if not exists prazo_minimo_dias int check (prazo_minimo_dias is null or prazo_minimo_dias >= 0);
alter table public.specialties add column if not exists prazo_maximo_dias int check (prazo_maximo_dias is null or prazo_maximo_dias >= 0);

create or replace function public.prazo_situacao(p_iniciada_em timestamptz, p_prazo_minimo_dias int, p_prazo_maximo_dias int) returns jsonb
language sql stable as $$
  select jsonb_build_object(
    'prazo_minimo_dias', p_prazo_minimo_dias,
    'prazo_maximo_dias', p_prazo_maximo_dias,
    'dias_desde_inicio', extract(day from (now() - p_iniciada_em))::int,
    'minimo_atingido', p_prazo_minimo_dias is null or now() >= p_iniciada_em + (p_prazo_minimo_dias || ' days')::interval,
    'maximo_excedido', p_prazo_maximo_dias is not null and now() > p_iniciada_em + (p_prazo_maximo_dias || ' days')::interval
  );
$$;

-- ==================== conclusão de CLASSE passa a respeitar prazo_minimo_dias ====================
create or replace function public.avaliar_conclusao_classe() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_total int; v_aprovados int; v_mc record; v_prazo_min int;
begin
  if new.status is distinct from 'aprovado' then return new; end if;
  select * into v_mc from public.member_classes where id = new.member_class_id;
  if v_mc.status is distinct from 'em_andamento' then return new; end if;

  select count(*) into v_total
  from public.class_requirements r
  join public.class_sections s on s.id = r.section_id
  where s.class_id = v_mc.class_id and r.ativo;

  select count(*) into v_aprovados
  from public.member_requirements mr
  join public.class_requirements r on r.id = mr.requirement_id and r.ativo
  where mr.member_class_id = new.member_class_id and mr.status = 'aprovado';

  if v_total > 0 and v_aprovados >= v_total then
    select prazo_minimo_dias into v_prazo_min from public.classes where id = v_mc.class_id;
    if v_prazo_min is not null and now() < v_mc.iniciada_em + (v_prazo_min || ' days')::interval then
      return new; -- todos os requisitos aprovados, mas o prazo mínimo da classe ainda não foi atingido
    end if;
    update public.member_classes set status = 'concluida', concluida_em = now(), updated_at = now() where id = new.member_class_id;
    insert into public.investiture_reviews (member_class_id, club_id, usuario_id)
    values (new.member_class_id, v_mc.club_id, v_mc.usuario_id)
    on conflict (member_class_id) do nothing;
  end if;
  return new;
end;
$$;

-- ==================== conclusão de ESPECIALIDADE passa a respeitar prazo_minimo_dias ====================
create or replace function public.avaliar_conclusao_especialidade() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_total int; v_aprovados int; v_ms record; v_prazo_min int;
begin
  if new.status is distinct from 'aprovado' then return new; end if;
  select * into v_ms from public.member_specialties where id = new.member_specialty_id;
  if v_ms.status is distinct from 'em_andamento' then return new; end if;

  select count(*) into v_total from public.specialty_requirements r
   where r.specialty_id = v_ms.specialty_id and r.ativo;
  select count(*) into v_aprovados from public.member_specialty_requirements mr
   join public.specialty_requirements r on r.id = mr.specialty_requirement_id and r.ativo
   where mr.member_specialty_id = new.member_specialty_id and mr.status = 'aprovado';

  if v_total > 0 and v_aprovados >= v_total then
    select prazo_minimo_dias into v_prazo_min from public.specialties where id = v_ms.specialty_id;
    if v_prazo_min is not null and now() < v_ms.iniciada_em + (v_prazo_min || ' days')::interval then
      return new;
    end if;
    update public.member_specialties set status = 'concluida', concluida_em = now(), updated_at = now() where id = new.member_specialty_id;
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- Motor de explicação: satisfeito | pendente | bloqueado, com a regra e a origem de cada uma.
-- ---------------------------------------------------------------------
create or replace function public.explicar_requisito_classe(p_member_requirement_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_mr record; v_req record; v_regras jsonb := '[]'::jsonb; v_bloqueado boolean := false; v_resultado text;
  v_dep_pendentes text[]; v_grupo record; v_opcoes jsonb; v_conteudo jsonb;
begin
  select * into v_mr from public.member_requirements where id = p_member_requirement_id;
  if not found then return null; end if;
  select * into v_req from public.class_requirements where id = v_mr.requirement_id;

  v_dep_pendentes := public.dependencias_pendentes('class_requirement', v_mr.requirement_id, v_mr.usuario_id, v_mr.club_id);
  v_regras := v_regras || jsonb_build_object(
    'regra', 'dependencia_curricular', 'satisfeito', (coalesce(array_length(v_dep_pendentes, 1), 0) = 0),
    'origem', 'curriculum_dependencies + curriculum_achievements (histórico portátil)',
    'detalhe', jsonb_build_object('pendencias', to_jsonb(coalesce(v_dep_pendentes, '{}'::text[])))
  );
  if coalesce(array_length(v_dep_pendentes, 1), 0) > 0 then v_bloqueado := true; end if;

  if v_req.conteudo_dinamico_definicao_id is not null then
    select public.conteudo_dinamico_resolver(chave, current_date) into v_conteudo
      from public.dynamic_content_definitions where id = v_req.conteudo_dinamico_definicao_id;
    v_regras := v_regras || jsonb_build_object(
      'regra', 'conteudo_dinamico', 'satisfeito', (v_conteudo is not null and v_conteudo ->> 'valor' is not null),
      'origem', 'dynamic_content_definitions + dynamic_content_values', 'detalhe', coalesce(v_conteudo, 'null'::jsonb)
    );
    if v_conteudo is null or v_conteudo ->> 'valor' is null then v_bloqueado := true; end if;
  end if;

  select * into v_grupo from public.requirement_option_groups where alvo_tipo = 'class_requirement' and alvo_id = v_mr.requirement_id;
  if found then
    v_opcoes := public.opcoes_satisfeitas_automaticamente(v_grupo.id, v_mr.usuario_id);
    v_regras := v_regras || jsonb_build_object(
      'regra', 'escolha_n_de_m',
      'satisfeito', (((v_opcoes ->> 'satisfeitas')::int >= (v_opcoes ->> 'n_minimo')::int) or v_mr.status = 'aprovado'),
      'origem', 'requirement_option_groups + requirement_options', 'detalhe', v_opcoes
    );
  end if;

  if v_mr.status = 'aprovado' then v_resultado := 'satisfeito';
  elsif v_bloqueado then v_resultado := 'bloqueado';
  else v_resultado := 'pendente';
  end if;

  return jsonb_build_object(
    'requisito', jsonb_build_object('tipo', 'class_requirement', 'id', v_mr.requirement_id, 'status_operacional', v_mr.status),
    'resultado', v_resultado, 'regras_aplicadas', v_regras
  );
end;
$$;
revoke all on function public.explicar_requisito_classe(uuid) from public, anon;
grant execute on function public.explicar_requisito_classe(uuid) to authenticated;

create or replace function public.explicar_requisito_especialidade(p_member_specialty_requirement_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_mr record; v_req record; v_regras jsonb := '[]'::jsonb; v_bloqueado boolean := false; v_resultado text;
  v_grupo record; v_opcoes jsonb; v_conteudo jsonb;
begin
  select * into v_mr from public.member_specialty_requirements where id = p_member_specialty_requirement_id;
  if not found then return null; end if;
  select * into v_req from public.specialty_requirements where id = v_mr.specialty_requirement_id;

  if v_req.conteudo_dinamico_definicao_id is not null then
    select public.conteudo_dinamico_resolver(chave, current_date) into v_conteudo
      from public.dynamic_content_definitions where id = v_req.conteudo_dinamico_definicao_id;
    v_regras := v_regras || jsonb_build_object(
      'regra', 'conteudo_dinamico', 'satisfeito', (v_conteudo is not null and v_conteudo ->> 'valor' is not null),
      'origem', 'dynamic_content_definitions + dynamic_content_values', 'detalhe', coalesce(v_conteudo, 'null'::jsonb)
    );
    if v_conteudo is null or v_conteudo ->> 'valor' is null then v_bloqueado := true; end if;
  end if;

  select * into v_grupo from public.requirement_option_groups where alvo_tipo = 'specialty_requirement' and alvo_id = v_mr.specialty_requirement_id;
  if found then
    v_opcoes := public.opcoes_satisfeitas_automaticamente(v_grupo.id, v_mr.usuario_id);
    v_regras := v_regras || jsonb_build_object(
      'regra', 'escolha_n_de_m',
      'satisfeito', (((v_opcoes ->> 'satisfeitas')::int >= (v_opcoes ->> 'n_minimo')::int) or v_mr.status = 'aprovado'),
      'origem', 'requirement_option_groups + requirement_options', 'detalhe', v_opcoes
    );
  end if;

  if v_mr.status = 'aprovado' then v_resultado := 'satisfeito';
  elsif v_bloqueado then v_resultado := 'bloqueado';
  else v_resultado := 'pendente';
  end if;

  return jsonb_build_object(
    'requisito', jsonb_build_object('tipo', 'specialty_requirement', 'id', v_mr.specialty_requirement_id, 'status_operacional', v_mr.status),
    'resultado', v_resultado, 'regras_aplicadas', v_regras
  );
end;
$$;
revoke all on function public.explicar_requisito_especialidade(uuid) from public, anon;
grant execute on function public.explicar_requisito_especialidade(uuid) to authenticated;

notify pgrst, 'reload schema';

insert into public.migracoes_aplicadas (arquivo)
values ('2026-09-21-motor-de-regras-curriculares.sql')
on conflict (arquivo) do update set aplicada_em = now();
