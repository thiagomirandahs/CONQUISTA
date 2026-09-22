-- =====================================================================
-- Motor curricular versionado — fase 2: Especialidades + dependências declarativas +
-- preparação do catálogo oficial. Rodar DEPOIS da 20260921000036. Idempotente.
--
-- Auditoria prévia (ver AUDITORIA-MULTITENANT.md, seção "Motor curricular — fase 2"):
-- o modelo da migration 36 (currículo → classe → seção → requisito) não tinha como
-- representar (a) Especialidades — que não têm "seções", têm categoria, podem ser
-- feitas fora de uma classe e às vezes têm pré-requisito; (b) dependência estruturada
-- entre um requisito/classe/especialidade e outra coisa que precisa estar concluída
-- antes; (c) rastreabilidade de IMPORTAÇÃO do material oficial (hash/checksum, data,
-- quem importou); (d) o recurso "classes" (feature flag) não bloqueava ESCRITA nas
-- RPCs novas — só escondia a rota no front (gap achado nesta auditoria, corrigido
-- abaixo, junto com Especialidades). Evoluções desta migration, uma a uma:
--   A) curriculum_versions ganha colunas de importação (fonte_hash, fonte_arquivo,
--      importado_em, importado_por) — sem isso não dá pra provar de onde veio um
--      material oficial nem detectar edição silenciosa do arquivo fonte.
--   B) O gatilho que deriva usuario_id/club_id (antes só de member_requirements) vira
--      GENÉRICO (mesmo idioma de definir_club_por_usuario, migration 22: tabela/coluna
--      pai por argumento do gatilho) — Especialidades reusa a MESMA função, não duplica.
--   C) specialties/specialty_requirements (catálogo, plataforma) e specialty_offerings/
--      member_specialties/member_specialty_requirements (operação, por clube).
--   D) requirement_approvals vira POLIMÓRFICO (aceita alvo de classe OU de
--      especialidade) — uma auditoria só, reusada, em vez de duplicar a tabela.
--   E) curriculum_dependencies: dependência declarativa (classe/especialidade/requisito
--      depende de classe/especialidade concluída), validada e consultada no SERVIDOR.
--   F) O recurso "classes" (feature flag) passa a bloquear ESCRITA nas RPCs de
--      Classes E Especialidades (antes só escondia a rota) — mesmo padrão da
--      migration 34, retroaplicado.
--   G) comparar_versoes_curriculares(): ferramenta de diff entre duas versões.
--   H) 1 especialidade PILOTO (dados de TESTE) + 1 requisito novo na classe piloto
--      dependendo dela, provando o pipeline de dependência ponta a ponta.
-- =====================================================================

-- ---------------------------------------------------------------------
-- A) curriculum_versions: rastreabilidade de importação
-- ---------------------------------------------------------------------
alter table public.curriculum_versions
  add column if not exists fonte_hash text,
  add column if not exists fonte_arquivo text,
  add column if not exists importado_em timestamptz,
  add column if not exists importado_por uuid references public.profiles(id);

-- Processo de importação (documentado aqui pra ficar perto do schema; ver também
-- AUDITORIA-MULTITENANT.md): quem for importar currículo oficial futuramente
-- registra origem='oficial', identificador/versao, vigente_desde/ate, fonte_url,
-- fonte_descricao (o que é o documento), fonte_hash (sha256 do arquivo fonte —
-- `sha256sum arquivo.pdf`), fonte_arquivo (nome do arquivo) e importado_em/por. Status
-- nasce 'rascunho' e só vira 'publicado' depois de revisão humana (comparar_versoes_
-- curriculares contra a versão anterior, abaixo). NUNCA editar uma versão já publicada
-- — sempre uma linha nova (curriculum_versions.id novo), preservando o histórico de
-- quem já iniciou/concluiu a versão anterior.

-- ---------------------------------------------------------------------
-- B) gatilho genérico de escopo (reusa, não duplica) — mesmo idioma de
--    definir_club_por_usuario (migration 22): tabela/coluna pai por argumento.
-- ---------------------------------------------------------------------
create or replace function public.definir_escopo_progresso() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_coluna_pai text := tg_argv[0];
  v_tabela_pai text := tg_argv[1];
  v_pai_id uuid := (to_jsonb(new) ->> v_coluna_pai)::uuid;
  v_pai record;
begin
  execute format('select usuario_id, club_id from public.%I where id = $1', v_tabela_pai) into v_pai using v_pai_id;
  if v_pai.usuario_id is null then
    raise exception 'Registro pai (%) não encontrado.', v_tabela_pai;
  end if;
  new.usuario_id := v_pai.usuario_id;
  new.club_id := v_pai.club_id;
  return new;
end;
$$;
revoke all on function public.definir_escopo_progresso() from public, anon, authenticated;

drop trigger if exists trg_definir_escopo_member_requirement on public.member_requirements;
drop trigger if exists trg_definir_escopo on public.member_requirements;
create trigger trg_definir_escopo before insert on public.member_requirements
for each row execute function public.definir_escopo_progresso('member_class_id', 'member_classes');
drop function if exists public.definir_escopo_member_requirement();

-- ---------------------------------------------------------------------
-- C) Especialidades: catálogo (plataforma) + operação (por clube)
-- ---------------------------------------------------------------------
-- Especialidade NÃO tem "seções" (ao contrário de classe): a lista real de
-- requisitos de uma especialidade é sempre plana (numerada, às vezes com
-- subitens dentro da própria descrição) — forçar uma camada de seção artificial
-- aqui seria "forçar o conteúdo a caber no modelo", exatamente o que foi pedido
-- pra evitar. `categoria` (Natureza, Artes e Habilidades, Recreação...) e `nivel`
-- (regular/avançada — algumas especialidades têm versão avançada) ficam livres
-- (texto) até o catálogo oficial confirmar o vocabulário exato.
create table if not exists public.specialties (
  id uuid primary key default gen_random_uuid(),
  curriculum_version_id uuid not null references public.curriculum_versions(id),
  codigo text not null,
  nome text not null,
  categoria text,
  nivel text,
  ordem int not null default 100,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  unique (curriculum_version_id, codigo)
);

create table if not exists public.specialty_requirements (
  id uuid primary key default gen_random_uuid(),
  specialty_id uuid not null references public.specialties(id) on delete cascade,
  codigo text not null,
  descricao text not null,
  tipo_evidencia text not null default 'nenhuma' check (tipo_evidencia in
    ('nenhuma', 'texto', 'foto', 'arquivo', 'presenca', 'atividade', 'biblia', 'evento', 'especialidade', 'externo')),
  evidencia_obrigatoria boolean not null default false,
  ordem int not null default 100,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  unique (specialty_id, codigo)
);

alter table public.specialties enable row level security;
alter table public.specialty_requirements enable row level security;

create or replace function public.especialidade_esta_publicada(p_specialty_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.specialties sp
    join public.curriculum_versions v on v.id = sp.curriculum_version_id
    where sp.id = p_specialty_id and sp.ativo and v.status = 'publicado'
  );
$$;
revoke all on function public.especialidade_esta_publicada(uuid) from public, anon, authenticated;
grant execute on function public.especialidade_esta_publicada(uuid) to authenticated;

drop policy if exists "leitura do curriculo publicado" on public.specialties;
create policy "leitura do curriculo publicado" on public.specialties for select to authenticated
using (ativo and exists (select 1 from public.curriculum_versions v where v.id = curriculum_version_id and v.status = 'publicado'));

drop policy if exists "leitura do curriculo publicado" on public.specialty_requirements;
create policy "leitura do curriculo publicado" on public.specialty_requirements for select to authenticated
using (ativo and public.especialidade_esta_publicada(specialty_id));

revoke all on public.specialties from public, anon, authenticated;
revoke all on public.specialty_requirements from public, anon, authenticated;
grant select on public.specialties, public.specialty_requirements to authenticated;

-- Oferta/turma: uma especialidade ENSINADA a um grupo, num clube, com instrutor
-- responsável e período. member_specialties pode (opcional) apontar pra uma oferta —
-- o progresso é SEMPRE individual (cada participante tem a própria linha), a oferta é
-- só o agrupamento administrativo (quem ensinou, quando, pra quem).
create table if not exists public.specialty_offerings (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.organizational_units(id) on delete cascade,
  specialty_id uuid not null references public.specialties(id),
  instrutor_responsavel_id uuid references public.profiles(id),
  titulo text,
  periodo_inicio date,
  periodo_fim date,
  status text not null default 'aberta' check (status in ('aberta', 'encerrada', 'cancelada')),
  criado_por uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
create index if not exists idx_specialty_offerings_club on public.specialty_offerings(club_id, status);

create table if not exists public.member_specialties (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references public.profiles(id) on delete cascade,
  club_id uuid not null references public.organizational_units(id) on delete cascade,
  specialty_id uuid not null references public.specialties(id),
  oferta_id uuid references public.specialty_offerings(id),
  status text not null default 'em_andamento' check (status in ('em_andamento', 'concluida', 'cancelada')),
  iniciada_em timestamptz not null default now(),
  concluida_em timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (usuario_id, club_id, specialty_id)
);
create index if not exists idx_member_specialties_club on public.member_specialties(club_id, status);
create index if not exists idx_member_specialties_usuario on public.member_specialties(usuario_id, club_id);

create table if not exists public.member_specialty_requirements (
  id uuid primary key default gen_random_uuid(),
  member_specialty_id uuid not null references public.member_specialties(id) on delete cascade,
  specialty_requirement_id uuid not null references public.specialty_requirements(id),
  usuario_id uuid not null references public.profiles(id) on delete cascade,
  club_id uuid not null references public.organizational_units(id) on delete cascade,
  status text not null default 'nao_iniciado' check (status in
    ('nao_iniciado', 'em_andamento', 'aguardando_avaliacao', 'aprovado', 'correcao_solicitada')),
  evidencia_texto text,
  evidencia_path text,
  enviado_em timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (member_specialty_id, specialty_requirement_id)
);
create index if not exists idx_member_specialty_req_club on public.member_specialty_requirements(club_id, status);
create index if not exists idx_member_specialty_req_usuario on public.member_specialty_requirements(usuario_id, club_id);

alter table public.specialty_offerings enable row level security;
alter table public.member_specialties enable row level security;
alter table public.member_specialty_requirements enable row level security;

revoke insert, update, delete on public.specialty_offerings, public.member_specialties, public.member_specialty_requirements
  from authenticated, anon;

-- Quem é o instrutor responsável da OFERTA a que este member_specialty pertence (se houver) — usado
-- tanto na policy de LEITURA (senão o responsável nem consegue pegar o id pra chamar a RPC de
-- avaliação: a subconsulta do cliente já roda sob RLS, antes mesmo de entrar na função SECURITY
-- DEFINER) quanto dentro da RPC de avaliação (_pode_avaliar_especialidade, abaixo) — uma fonte só.
create or replace function public._e_responsavel_da_oferta(p_member_specialty_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.member_specialties ms
    join public.specialty_offerings o on o.id = ms.oferta_id
    where ms.id = p_member_specialty_id and o.instrutor_responsavel_id = auth.uid()
  );
$$;
-- usada dentro de policy de RLS (avaliada como o papel de quem consulta, nunca via SECURITY DEFINER
-- de outra função) — precisa de EXECUTE pra "authenticated", mesmo padrão de pode_gerir_no_clube.
revoke all on function public._e_responsavel_da_oferta(uuid) from public, anon;
grant execute on function public._e_responsavel_da_oferta(uuid) to authenticated;

drop policy if exists "membro do clube le, lideranca gere" on public.specialty_offerings;
create policy "membro do clube le, lideranca gere" on public.specialty_offerings for select to authenticated
using (public.membro_ativo_no_clube(club_id) or public.pode_gerir_no_clube(club_id));

drop policy if exists "dono ou lideranca do clube" on public.member_specialties;
create policy "dono ou lideranca do clube" on public.member_specialties for select to authenticated
using (
  (usuario_id = auth.uid() and public.membro_ativo_no_clube(club_id))
  or public.pode_gerir_no_clube(club_id)
  or public._e_responsavel_da_oferta(id)
);

drop policy if exists "dono ou lideranca do clube" on public.member_specialty_requirements;
create policy "dono ou lideranca do clube" on public.member_specialty_requirements for select to authenticated
using (
  (usuario_id = auth.uid() and public.membro_ativo_no_clube(club_id))
  or public.pode_gerir_no_clube(club_id)
  or public._e_responsavel_da_oferta(member_specialty_id)
);

drop trigger if exists trg_definir_escopo on public.member_specialty_requirements;
create trigger trg_definir_escopo before insert on public.member_specialty_requirements
for each row execute function public.definir_escopo_progresso('member_specialty_id', 'member_specialties');

-- conclusão automática (sem seções, mais simples que a de classe — não força reuso
-- onde a forma de contar é estruturalmente diferente). Especialidade não tem
-- "investidura" própria (é reconhecida/entregue, não investida como uma classe) —
-- fica só 'concluida'; a entrega física (pin/emblema) é fora do sistema por ora.
create or replace function public.avaliar_conclusao_especialidade() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_total int; v_aprovados int; v_ms record;
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
    update public.member_specialties set status = 'concluida', concluida_em = now(), updated_at = now() where id = new.member_specialty_id;
  end if;
  return new;
end;
$$;
revoke all on function public.avaliar_conclusao_especialidade() from public, anon, authenticated;
drop trigger if exists trg_avaliar_conclusao_especialidade on public.member_specialty_requirements;
create trigger trg_avaliar_conclusao_especialidade after update of status on public.member_specialty_requirements
for each row execute function public.avaliar_conclusao_especialidade();

create or replace function public.especialidade_percentual(p_member_specialty_id uuid) returns int
language sql stable security definer set search_path = '' as $$
  select case when count(r.*) = 0 then 0
    else round(100.0 * count(*) filter (where mr.status = 'aprovado') / count(r.*))::int end
  from public.member_specialties ms
  join public.specialty_requirements r on r.specialty_id = ms.specialty_id and r.ativo
  left join public.member_specialty_requirements mr on mr.specialty_requirement_id = r.id and mr.member_specialty_id = ms.id
  where ms.id = p_member_specialty_id;
$$;
revoke all on function public.especialidade_percentual(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- D) requirement_approvals vira POLIMÓRFICO: mesma auditoria pra classe OU
--    especialidade (quem avaliou, em qual clube, quando, decisão) — reusa em vez
--    de duplicar a tabela e as policies de auditoria.
-- ---------------------------------------------------------------------
alter table public.requirement_approvals
  alter column member_requirement_id drop not null,
  alter column requirement_id drop not null,
  add column if not exists member_specialty_requirement_id uuid references public.member_specialty_requirements(id) on delete cascade,
  add column if not exists specialty_requirement_id uuid references public.specialty_requirements(id);

alter table public.requirement_approvals drop constraint if exists requirement_approvals_alvo_exclusivo;
alter table public.requirement_approvals add constraint requirement_approvals_alvo_exclusivo check (
  (member_requirement_id is not null and requirement_id is not null
    and member_specialty_requirement_id is null and specialty_requirement_id is null)
  or
  (member_specialty_requirement_id is not null and specialty_requirement_id is not null
    and member_requirement_id is null and requirement_id is null)
);
create index if not exists idx_requirement_approvals_msr on public.requirement_approvals(member_specialty_requirement_id, created_at);

drop policy if exists "dono ou lideranca do clube" on public.requirement_approvals;
create policy "dono ou lideranca do clube" on public.requirement_approvals for select to authenticated
using (
  public.pode_gerir_no_clube(club_id)
  or exists (
    select 1 from public.member_requirements mr
    where mr.id = requirement_approvals.member_requirement_id
      and mr.usuario_id = auth.uid() and public.membro_ativo_no_clube(mr.club_id)
  )
  or exists (
    select 1 from public.member_specialty_requirements mr
    where mr.id = requirement_approvals.member_specialty_requirement_id
      and mr.usuario_id = auth.uid() and public.membro_ativo_no_clube(mr.club_id)
  )
);

-- ---------------------------------------------------------------------
-- E) curriculum_dependencies: dependência declarativa, validada e consultada
--    sempre no SERVIDOR (nunca texto interpretado pelo frontend).
-- ---------------------------------------------------------------------
-- Ex.: um requisito de classe (`class_requirement`) pode exigir a CONCLUSÃO de uma
-- especialidade inteira (`specialty`); uma classe avançada pode exigir a classe
-- regular concluída (`class` depende de `class`); uma especialidade pode exigir
-- outra especialidade concluída antes. Fica no nível de CLASSE/ESPECIALIDADE
-- concluída (não de um requisito específico do outro lado) — é o que o pedido
-- descreve ("exigir a conclusão de determinada Especialidade") e evita um grafo
-- de dependências arbitrariamente fino sem fonte oficial que precise disso.
create table if not exists public.curriculum_dependencies (
  id uuid primary key default gen_random_uuid(),
  alvo_tipo text not null check (alvo_tipo in ('class', 'specialty', 'class_requirement', 'specialty_requirement')),
  alvo_id uuid not null,
  depende_de_tipo text not null check (depende_de_tipo in ('class', 'specialty')),
  depende_de_id uuid not null,
  obrigatorio boolean not null default true,
  observacao text,
  created_at timestamptz not null default now(),
  unique (alvo_tipo, alvo_id, depende_de_tipo, depende_de_id)
);

create or replace function public.validar_dependencia_curricular() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_ok boolean;
begin
  v_ok := case new.alvo_tipo
    when 'class' then exists (select 1 from public.classes where id = new.alvo_id)
    when 'specialty' then exists (select 1 from public.specialties where id = new.alvo_id)
    when 'class_requirement' then exists (select 1 from public.class_requirements where id = new.alvo_id)
    when 'specialty_requirement' then exists (select 1 from public.specialty_requirements where id = new.alvo_id)
    else false
  end;
  if not v_ok then raise exception 'curriculum_dependencies.alvo_id não existe para alvo_tipo=%', new.alvo_tipo; end if;
  v_ok := case new.depende_de_tipo
    when 'class' then exists (select 1 from public.classes where id = new.depende_de_id)
    when 'specialty' then exists (select 1 from public.specialties where id = new.depende_de_id)
    else false
  end;
  if not v_ok then raise exception 'curriculum_dependencies.depende_de_id não existe para depende_de_tipo=%', new.depende_de_tipo; end if;
  if new.alvo_tipo = new.depende_de_tipo and new.alvo_id = new.depende_de_id then
    raise exception 'Uma classe/especialidade não pode depender de si mesma.';
  end if;
  return new;
end;
$$;
revoke all on function public.validar_dependencia_curricular() from public, anon, authenticated;
drop trigger if exists trg_validar_dependencia_curricular on public.curriculum_dependencies;
create trigger trg_validar_dependencia_curricular before insert or update on public.curriculum_dependencies
for each row execute function public.validar_dependencia_curricular();

alter table public.curriculum_dependencies enable row level security;
revoke all on public.curriculum_dependencies from public, anon, authenticated;
drop policy if exists "leitura publica das dependencias" on public.curriculum_dependencies;
create policy "leitura publica das dependencias" on public.curriculum_dependencies for select to authenticated using (true);
grant select on public.curriculum_dependencies to authenticated;

-- Dependência satisfeita: olha o progresso da MESMA pessoa NO MESMO CLUBE (decisão
-- de desenho — ver AUDITORIA-MULTITENANT.md: o resto do motor é 100% escopado por
-- clube; uma dependência que "vazasse" progresso de outro clube seria a única
-- exceção nisso, então optamos por NÃO deixar).
create or replace function public.dependencias_pendentes(p_alvo_tipo text, p_alvo_id uuid, p_usuario_id uuid, p_club_id uuid) returns text[]
language plpgsql stable security definer set search_path = '' as $$
declare r record; v_ok boolean; v_nome text; v_faltando text[] := '{}';
begin
  for r in select * from public.curriculum_dependencies where alvo_tipo = p_alvo_tipo and alvo_id = p_alvo_id and obrigatorio loop
    if r.depende_de_tipo = 'class' then
      v_ok := exists (
        select 1 from public.member_classes
        where usuario_id = p_usuario_id and club_id = p_club_id and class_id = r.depende_de_id and status in ('concluida', 'investida')
      );
      select nome into v_nome from public.classes where id = r.depende_de_id;
    else
      v_ok := exists (
        select 1 from public.member_specialties
        where usuario_id = p_usuario_id and club_id = p_club_id and specialty_id = r.depende_de_id and status = 'concluida'
      );
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

create or replace function public.dependencias_satisfeitas(p_alvo_tipo text, p_alvo_id uuid, p_usuario_id uuid, p_club_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(array_length(public.dependencias_pendentes(p_alvo_tipo, p_alvo_id, p_usuario_id, p_club_id), 1), 0) = 0;
$$;
revoke all on function public.dependencias_satisfeitas(text, uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.dependencias_satisfeitas(text, uuid, uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------
-- F) recurso "classes" passa a bloquear ESCRITA nas RPCs (achado da auditoria: só
--    escondia a rota) — redefine as RPCs de Classes da migration 36 + define as
--    novas RPCs de Especialidades já com a checagem.
-- ---------------------------------------------------------------------
create or replace function public._exigir_classes_habilitado(p_club uuid) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.recurso_habilitado_no_clube(p_club, 'classes') then
    raise exception 'Este recurso está desabilitado neste clube.';
  end if;
end;
$$;
revoke all on function public._exigir_classes_habilitado(uuid) from public, anon, authenticated;

create or replace function public.classe_iniciar(p_class_id uuid) returns json
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_club uuid := public.clube_atual_id(); v_mc_id uuid; v_faltando text[];
begin
  if v_uid is null or v_club is null or not public.membro_ativo_no_clube(v_club) then
    raise exception 'Sem clube em uso.';
  end if;
  perform public._exigir_classes_habilitado(v_club);
  if not public.classe_esta_publicada(p_class_id) then raise exception 'Classe não encontrada.'; end if;
  v_faltando := public.dependencias_pendentes('class', p_class_id, v_uid, v_club);
  if array_length(v_faltando, 1) > 0 then
    raise exception 'Falta concluir antes: %', array_to_string(v_faltando, ', ');
  end if;
  v_mc_id := public._classe_matricular(v_uid, v_club, p_class_id);
  return json_build_object('ok', true, 'member_class_id', v_mc_id);
end;
$$;

create or replace function public.classe_atribuir(p_usuario_id uuid, p_class_id uuid) returns json
language plpgsql security definer set search_path = '' as $$
declare v_club uuid := public.clube_atual_id(); v_mc_id uuid; v_faltando text[];
begin
  if v_club is null or not public.pode_gerir_no_clube(v_club) then
    raise exception 'Sem permissão (apenas diretoria/instrutor deste clube).';
  end if;
  perform public._exigir_classes_habilitado(v_club);
  if not exists (
    select 1 from public.organization_memberships m
    where m.user_id = p_usuario_id and m.organizational_unit_id = v_club and m.role <> 'pais' and m.status = 'ativo'
      and m.starts_at <= now() and (m.ends_at is null or m.ends_at > now())
  ) then
    raise exception 'Pessoa sem vínculo ativo neste clube.';
  end if;
  if not public.classe_esta_publicada(p_class_id) then raise exception 'Classe não encontrada.'; end if;
  v_faltando := public.dependencias_pendentes('class', p_class_id, p_usuario_id, v_club);
  if array_length(v_faltando, 1) > 0 then
    raise exception 'Falta concluir antes: %', array_to_string(v_faltando, ', ');
  end if;
  v_mc_id := public._classe_matricular(p_usuario_id, v_club, p_class_id);
  return json_build_object('ok', true, 'member_class_id', v_mc_id);
end;
$$;

create or replace function public.requisito_salvar(p_requirement_id uuid, p_texto text default null, p_evidencia_path text default null) returns json
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_club uuid := public.clube_atual_id(); v_mr record;
begin
  if v_uid is null or v_club is null then raise exception 'Sem clube em uso.'; end if;
  perform public._exigir_classes_habilitado(v_club);
  select * into v_mr from public.member_requirements
   where requirement_id = p_requirement_id and usuario_id = v_uid and club_id = v_club for update;
  if not found then raise exception 'Requisito não encontrado para você neste clube.'; end if;
  if v_mr.status = 'aprovado' then raise exception 'Este requisito já foi aprovado.'; end if;
  update public.member_requirements
     set evidencia_texto = coalesce(p_texto, evidencia_texto),
         evidencia_path = coalesce(p_evidencia_path, evidencia_path),
         status = case when status in ('nao_iniciado', 'correcao_solicitada') then 'em_andamento' else status end,
         updated_at = now()
   where id = v_mr.id;
  return json_build_object('ok', true);
end;
$$;

create or replace function public.requisito_enviar(p_requirement_id uuid) returns json
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_club uuid := public.clube_atual_id(); v_mr record; v_req record; v_faltando text[];
begin
  if v_uid is null or v_club is null then raise exception 'Sem clube em uso.'; end if;
  perform public._exigir_classes_habilitado(v_club);
  select * into v_mr from public.member_requirements
   where requirement_id = p_requirement_id and usuario_id = v_uid and club_id = v_club for update;
  if not found then raise exception 'Requisito não encontrado para você neste clube.'; end if;
  if v_mr.status = 'aprovado' then raise exception 'Este requisito já foi aprovado.'; end if;
  select * into v_req from public.class_requirements where id = p_requirement_id;
  if v_req.evidencia_obrigatoria and coalesce(trim(v_mr.evidencia_texto), '') = '' and coalesce(v_mr.evidencia_path, '') = '' then
    raise exception 'Este requisito exige uma evidência antes de enviar.';
  end if;
  v_faltando := public.dependencias_pendentes('class_requirement', p_requirement_id, v_uid, v_club);
  if array_length(v_faltando, 1) > 0 then
    raise exception 'Falta concluir antes: %', array_to_string(v_faltando, ', ');
  end if;
  update public.member_requirements set status = 'aguardando_avaliacao', enviado_em = now(), updated_at = now() where id = v_mr.id;
  return json_build_object('ok', true);
end;
$$;

create or replace function public.requisito_avaliar(p_member_requirement_id uuid, p_decisao text, p_comentario text default null) returns json
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_club uuid := public.clube_atual_id(); v_mr record; v_papel text; v_faltando text[];
begin
  if p_decisao not in ('aprovado', 'correcao_solicitada') then raise exception 'Decisão inválida.'; end if;
  if v_uid is null or v_club is null or not public.pode_gerir_no_clube(v_club) then
    raise exception 'Sem permissão (apenas diretoria/instrutor deste clube).';
  end if;
  perform public._exigir_classes_habilitado(v_club);
  select * into v_mr from public.member_requirements where id = p_member_requirement_id and club_id = v_club for update;
  if not found then raise exception 'Requisito não encontrado neste clube.'; end if;

  if p_decisao = 'aprovado' then
    v_faltando := public.dependencias_pendentes('class_requirement', v_mr.requirement_id, v_mr.usuario_id, v_club);
    if array_length(v_faltando, 1) > 0 then
      raise exception 'Falta concluir antes: %', array_to_string(v_faltando, ', ');
    end if;
  end if;

  v_papel := public.papel_no_clube(v_uid, v_club);
  update public.member_requirements set status = p_decisao, updated_at = now() where id = v_mr.id;

  insert into public.requirement_approvals (member_requirement_id, requirement_id, curriculum_version_id, club_id, decisao, avaliado_por, avaliado_papel, comentario)
  select v_mr.id, v_mr.requirement_id, ver.id, v_club, p_decisao, v_uid, coalesce(v_papel, '?'), p_comentario
  from public.class_requirements r
  join public.class_sections s on s.id = r.section_id
  join public.classes c on c.id = s.class_id
  join public.curriculum_versions ver on ver.id = c.curriculum_version_id
  where r.id = v_mr.requirement_id;

  return json_build_object('ok', true);
end;
$$;

create or replace function public.investidura_confirmar(p_member_class_id uuid, p_aprovar boolean, p_comentario text default null) returns json
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_club uuid := public.clube_atual_id(); v_ir record;
begin
  if v_uid is null or v_club is null or not public.pode_gerir_no_clube(v_club) then
    raise exception 'Sem permissão (apenas diretoria/instrutor deste clube).';
  end if;
  perform public._exigir_classes_habilitado(v_club);
  select * into v_ir from public.investiture_reviews where member_class_id = p_member_class_id and club_id = v_club for update;
  if not found then raise exception 'Revisão de investidura não encontrada neste clube.'; end if;
  if v_ir.status <> 'pendente' then raise exception 'Esta revisão já foi concluída.'; end if;

  update public.investiture_reviews
     set status = case when p_aprovar then 'investido' else 'recusado' end,
         revisado_por = v_uid, revisado_em = now(), comentario = p_comentario
   where id = v_ir.id;
  if p_aprovar then
    update public.member_classes set status = 'investida', updated_at = now() where id = p_member_class_id;
  end if;
  return json_build_object('ok', true);
end;
$$;

-- ---------------------------------------------------------------------
-- RPCs de Especialidades (mesmo desenho das de Classe)
-- ---------------------------------------------------------------------
create or replace function public.especialidades_disponiveis() returns json
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_club uuid := public.clube_atual_id();
begin
  if v_uid is null or v_club is null then return '[]'::json; end if;
  return coalesce((
    select json_agg(json_build_object(
      'specialty_id', sp.id, 'codigo', sp.codigo, 'nome', sp.nome, 'categoria', sp.categoria, 'nivel', sp.nivel,
      'curriculum_version', json_build_object('id', v.id, 'origem', v.origem, 'identificador', v.identificador, 'versao', v.versao),
      'dependencias_pendentes', public.dependencias_pendentes('specialty', sp.id, v_uid, v_club)
    ) order by sp.ordem, sp.nome)
    from public.specialties sp
    join public.curriculum_versions v on v.id = sp.curriculum_version_id
    where sp.ativo and v.status = 'publicado'
      and public.membro_ativo_no_clube(v_club)
      and not exists (
        select 1 from public.member_specialties ms
        where ms.usuario_id = v_uid and ms.club_id = v_club and ms.specialty_id = sp.id and ms.status <> 'cancelada'
      )
  ), '[]'::json);
end;
$$;
revoke all on function public.especialidades_disponiveis() from public, anon;
grant execute on function public.especialidades_disponiveis() to authenticated;

create or replace function public._especialidade_matricular(p_usuario_id uuid, p_club_id uuid, p_specialty_id uuid, p_oferta_id uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_ms_id uuid;
begin
  insert into public.member_specialties (usuario_id, club_id, specialty_id, oferta_id) values (p_usuario_id, p_club_id, p_specialty_id, p_oferta_id)
  on conflict (usuario_id, club_id, specialty_id) do update set oferta_id = coalesce(public.member_specialties.oferta_id, excluded.oferta_id)
  returning id into v_ms_id;
  insert into public.member_specialty_requirements (member_specialty_id, specialty_requirement_id)
  select v_ms_id, r.id from public.specialty_requirements r where r.specialty_id = p_specialty_id and r.ativo
  on conflict (member_specialty_id, specialty_requirement_id) do nothing;
  return v_ms_id;
end;
$$;
revoke all on function public._especialidade_matricular(uuid, uuid, uuid, uuid) from public, anon, authenticated;

create or replace function public.especialidade_iniciar(p_specialty_id uuid, p_oferta_id uuid default null) returns json
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_club uuid := public.clube_atual_id(); v_ms_id uuid; v_faltando text[];
begin
  if v_uid is null or v_club is null or not public.membro_ativo_no_clube(v_club) then raise exception 'Sem clube em uso.'; end if;
  perform public._exigir_classes_habilitado(v_club);
  if not public.especialidade_esta_publicada(p_specialty_id) then raise exception 'Especialidade não encontrada.'; end if;
  if p_oferta_id is not null and not exists (select 1 from public.specialty_offerings where id = p_oferta_id and club_id = v_club and specialty_id = p_specialty_id) then
    raise exception 'Turma/oferta não encontrada neste clube.';
  end if;
  v_faltando := public.dependencias_pendentes('specialty', p_specialty_id, v_uid, v_club);
  if array_length(v_faltando, 1) > 0 then raise exception 'Falta concluir antes: %', array_to_string(v_faltando, ', '); end if;
  v_ms_id := public._especialidade_matricular(v_uid, v_club, p_specialty_id, p_oferta_id);
  return json_build_object('ok', true, 'member_specialty_id', v_ms_id);
end;
$$;
revoke all on function public.especialidade_iniciar(uuid, uuid) from public, anon;
grant execute on function public.especialidade_iniciar(uuid, uuid) to authenticated;

create or replace function public.especialidade_atribuir(p_usuario_id uuid, p_specialty_id uuid, p_oferta_id uuid default null) returns json
language plpgsql security definer set search_path = '' as $$
declare v_club uuid := public.clube_atual_id(); v_ms_id uuid; v_faltando text[];
begin
  if v_club is null or not public.pode_gerir_no_clube(v_club) then
    raise exception 'Sem permissão (apenas diretoria/instrutor deste clube).';
  end if;
  perform public._exigir_classes_habilitado(v_club);
  if not exists (
    select 1 from public.organization_memberships m
    where m.user_id = p_usuario_id and m.organizational_unit_id = v_club and m.role <> 'pais' and m.status = 'ativo'
      and m.starts_at <= now() and (m.ends_at is null or m.ends_at > now())
  ) then
    raise exception 'Pessoa sem vínculo ativo neste clube.';
  end if;
  if not public.especialidade_esta_publicada(p_specialty_id) then raise exception 'Especialidade não encontrada.'; end if;
  if p_oferta_id is not null and not exists (select 1 from public.specialty_offerings where id = p_oferta_id and club_id = v_club and specialty_id = p_specialty_id) then
    raise exception 'Turma/oferta não encontrada neste clube.';
  end if;
  v_faltando := public.dependencias_pendentes('specialty', p_specialty_id, p_usuario_id, v_club);
  if array_length(v_faltando, 1) > 0 then raise exception 'Falta concluir antes: %', array_to_string(v_faltando, ', '); end if;
  v_ms_id := public._especialidade_matricular(p_usuario_id, v_club, p_specialty_id, p_oferta_id);
  return json_build_object('ok', true, 'member_specialty_id', v_ms_id);
end;
$$;
revoke all on function public.especialidade_atribuir(uuid, uuid, uuid) from public, anon;
grant execute on function public.especialidade_atribuir(uuid, uuid, uuid) to authenticated;

-- turma/oferta: a liderança cria (instrutor responsável pode ser qualquer vínculo
-- ativo do clube — não precisa ser instrutor/diretoria; é quem vai ensinar/avaliar
-- ESSA turma) e atribui participantes em lote.
create or replace function public.oferta_especialidade_criar(
  p_specialty_id uuid, p_titulo text, p_instrutor_responsavel_id uuid default null,
  p_periodo_inicio date default null, p_periodo_fim date default null
) returns json
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_club uuid := public.clube_atual_id(); v_id uuid;
begin
  if v_club is null or not public.pode_gerir_no_clube(v_club) then
    raise exception 'Sem permissão (apenas diretoria/instrutor deste clube).';
  end if;
  perform public._exigir_classes_habilitado(v_club);
  if not public.especialidade_esta_publicada(p_specialty_id) then raise exception 'Especialidade não encontrada.'; end if;
  if p_instrutor_responsavel_id is not null and not exists (
    select 1 from public.organization_memberships m where m.user_id = p_instrutor_responsavel_id and m.organizational_unit_id = v_club and m.status = 'ativo'
  ) then
    raise exception 'O instrutor responsável precisa ter vínculo ativo neste clube.';
  end if;
  insert into public.specialty_offerings (club_id, specialty_id, instrutor_responsavel_id, titulo, periodo_inicio, periodo_fim, criado_por)
  values (v_club, p_specialty_id, p_instrutor_responsavel_id, p_titulo, p_periodo_inicio, p_periodo_fim, v_uid)
  returning id into v_id;
  return json_build_object('ok', true, 'oferta_id', v_id);
end;
$$;
revoke all on function public.oferta_especialidade_criar(uuid, text, uuid, date, date) from public, anon;
grant execute on function public.oferta_especialidade_criar(uuid, text, uuid, date, date) to authenticated;

create or replace function public.ofertas_especialidade_do_clube() returns json
language sql stable security definer set search_path = '' as $$
  select coalesce(json_agg(json_build_object(
    'oferta_id', o.id, 'specialty_id', o.specialty_id, 'especialidade_nome', sp.nome, 'titulo', o.titulo,
    'instrutor_responsavel_id', o.instrutor_responsavel_id, 'instrutor_responsavel_nome', p.nome,
    'periodo_inicio', o.periodo_inicio, 'periodo_fim', o.periodo_fim, 'status', o.status,
    'participantes', (select count(*) from public.member_specialties ms where ms.oferta_id = o.id)
  ) order by o.created_at desc), '[]'::json)
  from public.specialty_offerings o
  join public.specialties sp on sp.id = o.specialty_id
  left join public.profiles p on p.id = o.instrutor_responsavel_id
  where o.club_id = public.clube_atual_id() and public.pode_gerir_no_clube(public.clube_atual_id());
$$;
revoke all on function public.ofertas_especialidade_do_clube() from public, anon;
grant execute on function public.ofertas_especialidade_do_clube() to authenticated;

create or replace function public.minha_especialidade(p_member_specialty_id uuid default null) returns json
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_club uuid := public.clube_atual_id(); v_ms record;
begin
  if v_uid is null or v_club is null then return null; end if;
  if p_member_specialty_id is not null then
    select * into v_ms from public.member_specialties where id = p_member_specialty_id and usuario_id = v_uid and club_id = v_club;
  else
    select * into v_ms from public.member_specialties
     where usuario_id = v_uid and club_id = v_club
     order by (status = 'em_andamento') desc, iniciada_em desc
     limit 1;
  end if;
  if v_ms.id is null then return null; end if;

  return json_build_object(
    'member_specialty', json_build_object(
      'id', v_ms.id, 'status', v_ms.status, 'iniciada_em', v_ms.iniciada_em, 'concluida_em', v_ms.concluida_em,
      'percentual', public.especialidade_percentual(v_ms.id)
    ),
    'especialidade', (select json_build_object('id', sp.id, 'codigo', sp.codigo, 'nome', sp.nome, 'categoria', sp.categoria, 'nivel', sp.nivel)
                       from public.specialties sp where sp.id = v_ms.specialty_id),
    'curriculum_version', (
      select json_build_object('id', ver.id, 'origem', ver.origem, 'identificador', ver.identificador, 'versao', ver.versao,
               'status', ver.status, 'fonte_url', ver.fonte_url, 'fonte_descricao', ver.fonte_descricao)
      from public.specialties sp join public.curriculum_versions ver on ver.id = sp.curriculum_version_id where sp.id = v_ms.specialty_id
    ),
    'oferta', (select json_build_object('titulo', o.titulo, 'instrutor_responsavel_nome', p.nome, 'periodo_inicio', o.periodo_inicio, 'periodo_fim', o.periodo_fim)
               from public.specialty_offerings o left join public.profiles p on p.id = o.instrutor_responsavel_id where o.id = v_ms.oferta_id),
    'requisitos', (
      select coalesce(json_agg(json_build_object(
        'id', r.id, 'codigo', r.codigo, 'descricao', r.descricao,
        'tipo_evidencia', r.tipo_evidencia, 'evidencia_obrigatoria', r.evidencia_obrigatoria,
        'member_specialty_requirement_id', mr.id, 'status', coalesce(mr.status, 'nao_iniciado'),
        'evidencia_texto', mr.evidencia_texto, 'evidencia_path', mr.evidencia_path, 'enviado_em', mr.enviado_em,
        'avaliacoes', (
          select coalesce(json_agg(json_build_object(
            'decisao', a.decisao, 'avaliado_por_nome', p2.nome, 'avaliado_papel', a.avaliado_papel,
            'comentario', a.comentario, 'created_at', a.created_at
          ) order by a.created_at), '[]'::json)
          from public.requirement_approvals a
          join public.profiles p2 on p2.id = a.avaliado_por
          where mr.id is not null and a.member_specialty_requirement_id = mr.id
        )
      ) order by r.ordem, r.codigo), '[]'::json)
      from public.specialty_requirements r
      left join public.member_specialty_requirements mr on mr.specialty_requirement_id = r.id and mr.member_specialty_id = v_ms.id
      where r.specialty_id = v_ms.specialty_id and r.ativo
    )
  );
end;
$$;
revoke all on function public.minha_especialidade(uuid) from public, anon;
grant execute on function public.minha_especialidade(uuid) to authenticated;

create or replace function public.especialidade_requisito_salvar(p_specialty_requirement_id uuid, p_texto text default null, p_evidencia_path text default null) returns json
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_club uuid := public.clube_atual_id(); v_mr record;
begin
  if v_uid is null or v_club is null then raise exception 'Sem clube em uso.'; end if;
  perform public._exigir_classes_habilitado(v_club);
  select * into v_mr from public.member_specialty_requirements
   where specialty_requirement_id = p_specialty_requirement_id and usuario_id = v_uid and club_id = v_club for update;
  if not found then raise exception 'Requisito não encontrado para você neste clube.'; end if;
  if v_mr.status = 'aprovado' then raise exception 'Este requisito já foi aprovado.'; end if;
  update public.member_specialty_requirements
     set evidencia_texto = coalesce(p_texto, evidencia_texto),
         evidencia_path = coalesce(p_evidencia_path, evidencia_path),
         status = case when status in ('nao_iniciado', 'correcao_solicitada') then 'em_andamento' else status end,
         updated_at = now()
   where id = v_mr.id;
  return json_build_object('ok', true);
end;
$$;
revoke all on function public.especialidade_requisito_salvar(uuid, text, text) from public, anon;
grant execute on function public.especialidade_requisito_salvar(uuid, text, text) to authenticated;

create or replace function public.especialidade_requisito_enviar(p_specialty_requirement_id uuid) returns json
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_club uuid := public.clube_atual_id(); v_mr record; v_req record;
begin
  if v_uid is null or v_club is null then raise exception 'Sem clube em uso.'; end if;
  perform public._exigir_classes_habilitado(v_club);
  select * into v_mr from public.member_specialty_requirements
   where specialty_requirement_id = p_specialty_requirement_id and usuario_id = v_uid and club_id = v_club for update;
  if not found then raise exception 'Requisito não encontrado para você neste clube.'; end if;
  if v_mr.status = 'aprovado' then raise exception 'Este requisito já foi aprovado.'; end if;
  select * into v_req from public.specialty_requirements where id = p_specialty_requirement_id;
  if v_req.evidencia_obrigatoria and coalesce(trim(v_mr.evidencia_texto), '') = '' and coalesce(v_mr.evidencia_path, '') = '' then
    raise exception 'Este requisito exige uma evidência antes de enviar.';
  end if;
  update public.member_specialty_requirements set status = 'aguardando_avaliacao', enviado_em = now(), updated_at = now() where id = v_mr.id;
  return json_build_object('ok', true);
end;
$$;
revoke all on function public.especialidade_requisito_enviar(uuid) from public, anon;
grant execute on function public.especialidade_requisito_enviar(uuid) to authenticated;

-- Quem avalia: a liderança do clube EM USO OU o instrutor responsável DA OFERTA
-- daquele member_specialty (mesmo se não for instrutor/diretoria pelo vínculo).
create or replace function public._pode_avaliar_especialidade(p_member_specialty_id uuid, p_club uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.pode_gerir_no_clube(p_club) or public._e_responsavel_da_oferta(p_member_specialty_id);
$$;
revoke all on function public._pode_avaliar_especialidade(uuid, uuid) from public, anon, authenticated;

create or replace function public.especialidade_avaliacoes_pendentes() returns json
language sql stable security definer set search_path = '' as $$
  select coalesce(json_agg(json_build_object(
    'member_specialty_requirement_id', mr.id,
    'usuario_id', p.id, 'usuario_nome', p.nome, 'usuario_foto', p.foto,
    'especialidade_nome', sp.nome,
    'requisito_id', r.id, 'requisito_codigo', r.codigo, 'requisito_descricao', r.descricao,
    'tipo_evidencia', r.tipo_evidencia, 'evidencia_texto', mr.evidencia_texto, 'evidencia_path', mr.evidencia_path,
    'enviado_em', mr.enviado_em
  ) order by mr.enviado_em), '[]'::json)
  from public.member_specialty_requirements mr
  join public.specialty_requirements r on r.id = mr.specialty_requirement_id
  join public.specialties sp on sp.id = r.specialty_id
  join public.profiles p on p.id = mr.usuario_id
  where mr.club_id = public.clube_atual_id() and mr.status = 'aguardando_avaliacao'
    and public._pode_avaliar_especialidade(mr.member_specialty_id, public.clube_atual_id());
$$;
revoke all on function public.especialidade_avaliacoes_pendentes() from public, anon;
grant execute on function public.especialidade_avaliacoes_pendentes() to authenticated;

create or replace function public.especialidade_requisito_avaliar(p_member_specialty_requirement_id uuid, p_decisao text, p_comentario text default null) returns json
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_club uuid := public.clube_atual_id(); v_mr record; v_papel text;
begin
  if p_decisao not in ('aprovado', 'correcao_solicitada') then raise exception 'Decisão inválida.'; end if;
  if v_uid is null or v_club is null then raise exception 'Sem clube em uso.'; end if;
  perform public._exigir_classes_habilitado(v_club);
  select * into v_mr from public.member_specialty_requirements where id = p_member_specialty_requirement_id and club_id = v_club for update;
  if not found then raise exception 'Requisito não encontrado neste clube.'; end if;
  if not public._pode_avaliar_especialidade(v_mr.member_specialty_id, v_club) then
    raise exception 'Sem permissão (apenas diretoria/instrutor deste clube, ou o instrutor responsável pela turma).';
  end if;

  v_papel := coalesce(public.papel_no_clube(v_uid, v_club), 'responsavel_da_turma');
  update public.member_specialty_requirements set status = p_decisao, updated_at = now() where id = v_mr.id;

  insert into public.requirement_approvals (member_specialty_requirement_id, specialty_requirement_id, curriculum_version_id, club_id, decisao, avaliado_por, avaliado_papel, comentario)
  select v_mr.id, v_mr.specialty_requirement_id, ver.id, v_club, p_decisao, v_uid, v_papel, p_comentario
  from public.specialty_requirements r
  join public.specialties sp on sp.id = r.specialty_id
  join public.curriculum_versions ver on ver.id = sp.curriculum_version_id
  where r.id = v_mr.specialty_requirement_id;

  return json_build_object('ok', true);
end;
$$;
revoke all on function public.especialidade_requisito_avaliar(uuid, text, text) from public, anon;
grant execute on function public.especialidade_requisito_avaliar(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------
-- G) Ferramenta de diff: compara duas versões (classe OU especialidade) e reporta
--    requisitos adicionados/removidos/alterados — pra revisar ANTES de publicar.
-- ---------------------------------------------------------------------
create or replace function public.comparar_versoes_curriculares(p_versao_a uuid, p_versao_b uuid) returns json
language sql stable security definer set search_path = '' as $$
  with req_a as (
    select 'class_requirement'::text as tipo, c.codigo as pai_codigo, c.nome as pai_nome, r.codigo,
           r.descricao, r.tipo_evidencia, r.evidencia_obrigatoria, r.ordem
    from public.class_requirements r
    join public.class_sections s on s.id = r.section_id
    join public.classes c on c.id = s.class_id
    where c.curriculum_version_id = p_versao_a
    union all
    select 'specialty_requirement', sp.codigo, sp.nome, r.codigo, r.descricao, r.tipo_evidencia, r.evidencia_obrigatoria, r.ordem
    from public.specialty_requirements r join public.specialties sp on sp.id = r.specialty_id
    where sp.curriculum_version_id = p_versao_a
  ),
  req_b as (
    select 'class_requirement'::text as tipo, c.codigo as pai_codigo, c.nome as pai_nome, r.codigo,
           r.descricao, r.tipo_evidencia, r.evidencia_obrigatoria, r.ordem
    from public.class_requirements r
    join public.class_sections s on s.id = r.section_id
    join public.classes c on c.id = s.class_id
    where c.curriculum_version_id = p_versao_b
    union all
    select 'specialty_requirement', sp.codigo, sp.nome, r.codigo, r.descricao, r.tipo_evidencia, r.evidencia_obrigatoria, r.ordem
    from public.specialty_requirements r join public.specialties sp on sp.id = r.specialty_id
    where sp.curriculum_version_id = p_versao_b
  )
  select json_build_object(
    'versao_a', (select json_build_object('id', id, 'identificador', identificador, 'versao', versao, 'status', status) from public.curriculum_versions where id = p_versao_a),
    'versao_b', (select json_build_object('id', id, 'identificador', identificador, 'versao', versao, 'status', status) from public.curriculum_versions where id = p_versao_b),
    'adicionados', (
      select coalesce(json_agg(json_build_object('tipo', b.tipo, 'pai', b.pai_nome, 'codigo', b.codigo, 'descricao', b.descricao) order by b.pai_codigo, b.codigo), '[]'::json)
      from req_b b where not exists (select 1 from req_a a where a.tipo = b.tipo and a.pai_codigo = b.pai_codigo and a.codigo = b.codigo)
    ),
    'removidos', (
      select coalesce(json_agg(json_build_object('tipo', a.tipo, 'pai', a.pai_nome, 'codigo', a.codigo, 'descricao', a.descricao) order by a.pai_codigo, a.codigo), '[]'::json)
      from req_a a where not exists (select 1 from req_b b where b.tipo = a.tipo and b.pai_codigo = a.pai_codigo and b.codigo = a.codigo)
    ),
    'alterados', (
      select coalesce(json_agg(json_build_object(
        'tipo', a.tipo, 'pai', a.pai_nome, 'codigo', a.codigo,
        'descricao_antes', a.descricao, 'descricao_depois', b.descricao,
        'tipo_evidencia_antes', a.tipo_evidencia, 'tipo_evidencia_depois', b.tipo_evidencia,
        'evidencia_obrigatoria_antes', a.evidencia_obrigatoria, 'evidencia_obrigatoria_depois', b.evidencia_obrigatoria
      ) order by a.pai_codigo, a.codigo), '[]'::json)
      from req_a a join req_b b on b.tipo = a.tipo and b.pai_codigo = a.pai_codigo and b.codigo = a.codigo
      where a.descricao is distinct from b.descricao
         or a.tipo_evidencia is distinct from b.tipo_evidencia
         or a.evidencia_obrigatoria is distinct from b.evidencia_obrigatoria
    )
  );
$$;
revoke all on function public.comparar_versoes_curriculares(uuid, uuid) from public, anon, authenticated;
grant execute on function public.comparar_versoes_curriculares(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------
-- H) Especialidade PILOTO — dados de TESTE (mesmo padrão da classe piloto) +
--    1 requisito novo na classe piloto DEPENDENDO dela (prova a dependência).
-- ---------------------------------------------------------------------
insert into public.curriculum_versions (id, origem, identificador, versao, vigente_desde, status, fonte_url, fonte_descricao)
values (
  '00000000-0000-4000-a000-000000000101'::uuid, 'piloto_teste', 'piloto-motor-curricular-especialidade', 'rascunho-1', current_date, 'publicado', null,
  'Dados de TESTE para validar o motor de Especialidades (versão, requisitos, turma/oferta, dependência com classe, ' ||
  'aprovação e conclusão). NÃO é o regulamento oficial de nenhuma especialidade de Desbravadores — precisa ser ' ||
  'substituído pela fonte oficial antes de qualquer uso real com membros.'
)
on conflict (identificador, versao) do nothing;

insert into public.specialties (id, curriculum_version_id, codigo, nome, categoria, nivel, ordem)
values (
  '00000000-0000-4000-a000-000000000102'::uuid, '00000000-0000-4000-a000-000000000101'::uuid,
  'piloto_primeiros_socorros', '[PILOTO/TESTE] Primeiros Socorros', 'Dado de teste — sem categoria oficial ainda', 'regular', 10
)
on conflict (curriculum_version_id, codigo) do nothing;

insert into public.specialty_requirements (specialty_id, codigo, descricao, tipo_evidencia, evidencia_obrigatoria, ordem) values
  ('00000000-0000-4000-a000-000000000102'::uuid, '1', '[DADO DE TESTE] Explicar em texto livre o que fazer numa emergência simples.', 'texto', true, 10),
  ('00000000-0000-4000-a000-000000000102'::uuid, '2', '[DADO DE TESTE] Ser observado pela liderança fazendo um curativo simples.', 'nenhuma', false, 20),
  ('00000000-0000-4000-a000-000000000102'::uuid, '3', '[DADO DE TESTE] Enviar uma foto do kit de primeiros socorros montado.', 'foto', true, 30)
on conflict (specialty_id, codigo) do nothing;

-- novo requisito na classe piloto (migration 36), numa seção já existente, provando
-- a dependência requisito-de-classe -> especialidade-concluída ponta a ponta.
insert into public.class_requirements (section_id, codigo, descricao, tipo_evidencia, evidencia_obrigatoria, ordem)
values (
  '00000000-0000-4000-a000-000000000013'::uuid, '3',
  '[DADO DE TESTE] Ter concluído a especialidade [PILOTO/TESTE] Primeiros Socorros (dependência estrutural de teste — não é requisito oficial).',
  'nenhuma', false, 30
)
on conflict (section_id, codigo) do nothing;

insert into public.curriculum_dependencies (alvo_tipo, alvo_id, depende_de_tipo, depende_de_id, obrigatorio, observacao)
select 'class_requirement'::text, r.id, 'specialty'::text, '00000000-0000-4000-a000-000000000102'::uuid, true,
       'Dependência de TESTE: prova que um requisito de classe pode exigir uma especialidade concluída.'
from public.class_requirements r
where r.section_id = '00000000-0000-4000-a000-000000000013'::uuid and r.codigo = '3'
on conflict (alvo_tipo, alvo_id, depende_de_tipo, depende_de_id) do nothing;

notify pgrst, 'reload schema';

insert into public.migracoes_aplicadas (arquivo)
values ('2026-09-21-especialidades-e-dependencias.sql')
on conflict (arquivo) do update set aplicada_em = now();
