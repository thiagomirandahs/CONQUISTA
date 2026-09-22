-- =====================================================================
-- Motor curricular versionado (Classes/Especialidades) — fase 1: só o MOTOR + UMA classe piloto.
-- Rodar DEPOIS da 20260921000035. Idempotente.
--
-- Objetivo desta migration: provar a arquitetura, não cadastrar o currículo oficial.
--   currículo oficial/versionado -> classe -> seção -> requisito -> progresso do membro ->
--   evidência -> avaliação/aprovação -> conclusão -> revisão para investidura.
--
-- ==================== A) catálogo curricular — conteúdo da PLATAFORMA (compartilhado/global) ====================
-- Igual ao padrão já usado para desafios/versiculos (migration 22) e recursos_catalogo (migration 33):
-- conteúdo OFICIAL pode ser global (não pertence a um clube); só é lido por RPC/policy de leitura, ninguém
-- grava pela API. `curriculum_versions` é o topo: registra origem, identificação/versão, vigência, status e
-- fonte. Mudar o currículo NUNCA edita uma versão publicada — cria uma versão nova (e, com ela, classes/seções/
-- requisitos NOVOS), preservando pra sempre o histórico de quem já iniciou ou concluiu a versão antiga
-- (member_classes/member_requirements de alguém sempre referenciam o requirement_id/class_id da versão em que
-- a pessoa realmente andou — nunca são reescritos por baixo quando a versão muda).
create table if not exists public.curriculum_versions (
  id uuid primary key default gen_random_uuid(),
  origem text not null check (origem in ('oficial', 'piloto_teste')),
  identificador text not null,
  versao text not null,
  vigente_desde date,
  vigente_ate date,
  status text not null default 'rascunho' check (status in ('rascunho', 'publicado', 'arquivado')),
  fonte_url text,
  fonte_descricao text not null default '',
  criado_por uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  unique (identificador, versao)
);

create table if not exists public.classes (
  id uuid primary key default gen_random_uuid(),
  curriculum_version_id uuid not null references public.curriculum_versions(id),
  codigo text not null,
  nome text not null,
  faixa_etaria text,
  ordem int not null default 100,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  unique (curriculum_version_id, codigo)
);

create table if not exists public.class_sections (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classes(id) on delete cascade,
  codigo text not null,
  nome text not null,
  ordem int not null default 100,
  created_at timestamptz not null default now(),
  unique (class_id, codigo)
);

-- tipo_evidencia é EXTENSÍVEL de propósito: hoje só 'texto' e 'foto' têm envio real na tela (Minha Classe); os
-- demais (presenca/atividade/biblia/evento/especialidade/externo) só ficam DECLARADOS, prontos para um módulo
-- futuro preencher automaticamente (ex.: presença batida em apontamentos aprova o requisito sozinha) — essa
-- automação NÃO é implementada agora, de propósito (ver AUDITORIA-MULTITENANT.md).
create table if not exists public.class_requirements (
  id uuid primary key default gen_random_uuid(),
  section_id uuid not null references public.class_sections(id) on delete cascade,
  codigo text not null,
  descricao text not null,
  tipo_evidencia text not null default 'nenhuma' check (tipo_evidencia in
    ('nenhuma', 'texto', 'foto', 'arquivo', 'presenca', 'atividade', 'biblia', 'evento', 'especialidade', 'externo')),
  evidencia_obrigatoria boolean not null default false,
  ordem int not null default 100,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  unique (section_id, codigo)
);

alter table public.curriculum_versions enable row level security;
alter table public.classes enable row level security;
alter table public.class_sections enable row level security;
alter table public.class_requirements enable row level security;

-- só o currículo PUBLICADO é visível pela API (rascunho/arquivado ficam fora — sem tela de autoria ainda,
-- só migration/SQL direto); mesmo padrão de "ninguém grava pela API" do catálogo de desafios/versículos.
create or replace function public.classe_esta_publicada(p_class_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.classes c
    join public.curriculum_versions v on v.id = c.curriculum_version_id
    where c.id = p_class_id and c.ativo and v.status = 'publicado'
  );
$$;
revoke all on function public.classe_esta_publicada(uuid) from public, anon, authenticated;
grant execute on function public.classe_esta_publicada(uuid) to authenticated;

drop policy if exists "leitura do curriculo publicado" on public.curriculum_versions;
create policy "leitura do curriculo publicado" on public.curriculum_versions for select to authenticated
using (status = 'publicado');

drop policy if exists "leitura do curriculo publicado" on public.classes;
create policy "leitura do curriculo publicado" on public.classes for select to authenticated
using (ativo and exists (select 1 from public.curriculum_versions v where v.id = curriculum_version_id and v.status = 'publicado'));

drop policy if exists "leitura do curriculo publicado" on public.class_sections;
create policy "leitura do curriculo publicado" on public.class_sections for select to authenticated
using (public.classe_esta_publicada(class_id));

drop policy if exists "leitura do curriculo publicado" on public.class_requirements;
create policy "leitura do curriculo publicado" on public.class_requirements for select to authenticated
using (ativo and exists (select 1 from public.class_sections s where s.id = section_id and public.classe_esta_publicada(s.class_id)));

revoke all on public.curriculum_versions from public, anon, authenticated;
revoke all on public.classes from public, anon, authenticated;
revoke all on public.class_sections from public, anon, authenticated;
revoke all on public.class_requirements from public, anon, authenticated;
grant select on public.curriculum_versions, public.classes, public.class_sections, public.class_requirements to authenticated;

-- ==================== B) progresso operacional — SEMPRE por clube, nunca global ====================
-- Fonte de papel/unidade/status de quem AVALIA é organization_memberships (via pode_gerir_no_clube/
-- papel_no_clube, migration 34) — nunca profiles.papel/status/unidade_id (contrato travado no teste 29 e
-- reforçado pelo teste de contrato desta fase, 31_motor_curricular_contrato.sql).
create table if not exists public.member_classes (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references public.profiles(id) on delete cascade,
  club_id uuid not null references public.organizational_units(id) on delete cascade,
  class_id uuid not null references public.classes(id),
  status text not null default 'em_andamento' check (status in ('em_andamento', 'concluida', 'investida', 'cancelada')),
  iniciada_em timestamptz not null default now(),
  concluida_em timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (usuario_id, club_id, class_id)
);
create index if not exists idx_member_classes_club on public.member_classes(club_id, status);
create index if not exists idx_member_classes_usuario on public.member_classes(usuario_id, club_id);

-- Os 5 estados são os que a tela "Minha Classe" mostra por requisito: não iniciado / em andamento /
-- aguardando avaliação / aprovado / correção solicitada. usuario_id/club_id são DERIVADOS de member_class_id
-- por gatilho (nunca aceitos direto do cliente) — mesmo padrão de "club_id explícito só se validado" das
-- migrations 34/35 (definir_club_ponto / definir_club_por_usuario).
create table if not exists public.member_requirements (
  id uuid primary key default gen_random_uuid(),
  member_class_id uuid not null references public.member_classes(id) on delete cascade,
  requirement_id uuid not null references public.class_requirements(id),
  usuario_id uuid not null references public.profiles(id) on delete cascade,
  club_id uuid not null references public.organizational_units(id) on delete cascade,
  status text not null default 'nao_iniciado' check (status in
    ('nao_iniciado', 'em_andamento', 'aguardando_avaliacao', 'aprovado', 'correcao_solicitada')),
  evidencia_texto text,
  evidencia_path text,
  enviado_em timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (member_class_id, requirement_id)
);
create index if not exists idx_member_requirements_club_status on public.member_requirements(club_id, status);
create index if not exists idx_member_requirements_usuario on public.member_requirements(usuario_id, club_id);

-- Auditoria: quem avaliou, em qual clube, quando e sobre qual versão do requisito (requirement_id já aponta
-- pra a versão certa — mudar o currículo cria requirement_id NOVO; curriculum_version_id fica também
-- denormalizado aqui só pra não obrigar um join de 4 tabelas toda vez que alguém quiser auditar).
create table if not exists public.requirement_approvals (
  id uuid primary key default gen_random_uuid(),
  member_requirement_id uuid not null references public.member_requirements(id) on delete cascade,
  requirement_id uuid not null references public.class_requirements(id),
  curriculum_version_id uuid not null references public.curriculum_versions(id),
  club_id uuid not null references public.organizational_units(id) on delete cascade,
  decisao text not null check (decisao in ('aprovado', 'correcao_solicitada')),
  avaliado_por uuid not null references public.profiles(id),
  avaliado_papel text not null,
  comentario text,
  created_at timestamptz not null default now()
);
create index if not exists idx_requirement_approvals_mr on public.requirement_approvals(member_requirement_id, created_at);
create index if not exists idx_requirement_approvals_club on public.requirement_approvals(club_id);

-- Base para a revisão de investidura (só a estrutura + o gatilho que abre o pedido quando a classe conclui;
-- SEM PDF/cartão final, assinatura digital nem tela própria nesta fase — só o "pendente" já prova o pipeline
-- completo: conclusão -> revisão para investidura).
create table if not exists public.investiture_reviews (
  id uuid primary key default gen_random_uuid(),
  member_class_id uuid not null references public.member_classes(id) on delete cascade,
  club_id uuid not null references public.organizational_units(id) on delete cascade,
  usuario_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pendente' check (status in ('pendente', 'investido', 'recusado')),
  solicitado_em timestamptz not null default now(),
  revisado_por uuid references public.profiles(id),
  revisado_em timestamptz,
  comentario text,
  created_at timestamptz not null default now(),
  unique (member_class_id)
);
create index if not exists idx_investiture_reviews_club on public.investiture_reviews(club_id, status);

alter table public.member_classes enable row level security;
alter table public.member_requirements enable row level security;
alter table public.requirement_approvals enable row level security;
alter table public.investiture_reviews enable row level security;

-- mesmo padrão de organization_memberships/missoes_feitas: só RPC (security definer) escreve; a policy de
-- SELECT é a única porta direta pela API.
revoke insert, update, delete on public.member_classes, public.member_requirements, public.requirement_approvals, public.investiture_reviews
  from authenticated, anon;

drop policy if exists "dono ou lideranca do clube" on public.member_classes;
create policy "dono ou lideranca do clube" on public.member_classes for select to authenticated
using ((usuario_id = auth.uid() and public.membro_ativo_no_clube(club_id)) or public.pode_gerir_no_clube(club_id));

drop policy if exists "dono ou lideranca do clube" on public.member_requirements;
create policy "dono ou lideranca do clube" on public.member_requirements for select to authenticated
using ((usuario_id = auth.uid() and public.membro_ativo_no_clube(club_id)) or public.pode_gerir_no_clube(club_id));

drop policy if exists "dono ou lideranca do clube" on public.requirement_approvals;
create policy "dono ou lideranca do clube" on public.requirement_approvals for select to authenticated
using (
  public.pode_gerir_no_clube(club_id)
  or exists (
    select 1 from public.member_requirements mr
    where mr.id = requirement_approvals.member_requirement_id
      and mr.usuario_id = auth.uid() and public.membro_ativo_no_clube(mr.club_id)
  )
);

drop policy if exists "dono ou lideranca do clube" on public.investiture_reviews;
create policy "dono ou lideranca do clube" on public.investiture_reviews for select to authenticated
using ((usuario_id = auth.uid() and public.membro_ativo_no_clube(club_id)) or public.pode_gerir_no_clube(club_id));

-- ==================== C) gatilhos: escopo derivado (nunca aceito do cliente) + conclusão automática ====================
create or replace function public.definir_escopo_member_requirement() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_mc record;
begin
  select usuario_id, club_id into v_mc from public.member_classes where id = new.member_class_id;
  if v_mc.usuario_id is null then raise exception 'Classe do membro não encontrada.'; end if;
  new.usuario_id := v_mc.usuario_id;
  new.club_id := v_mc.club_id;
  return new;
end;
$$;
revoke all on function public.definir_escopo_member_requirement() from public, anon, authenticated;
drop trigger if exists trg_definir_escopo_member_requirement on public.member_requirements;
create trigger trg_definir_escopo_member_requirement before insert on public.member_requirements
for each row execute function public.definir_escopo_member_requirement();

-- quando TODOS os requisitos ativos da classe ficam aprovados: a classe conclui e abre a revisão de
-- investidura sozinha (conclusão -> revisão para investidura, sem passo manual "solicitar revisão").
create or replace function public.avaliar_conclusao_classe() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_total int; v_aprovados int; v_mc record;
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
    update public.member_classes set status = 'concluida', concluida_em = now(), updated_at = now() where id = new.member_class_id;
    insert into public.investiture_reviews (member_class_id, club_id, usuario_id)
    values (new.member_class_id, v_mc.club_id, v_mc.usuario_id)
    on conflict (member_class_id) do nothing;
  end if;
  return new;
end;
$$;
revoke all on function public.avaliar_conclusao_classe() from public, anon, authenticated;
drop trigger if exists trg_avaliar_conclusao_classe on public.member_requirements;
create trigger trg_avaliar_conclusao_classe after update of status on public.member_requirements
for each row execute function public.avaliar_conclusao_classe();

-- ==================== D) percentual — SEMPRE calculado no servidor (o cliente nunca envia "concluído") ====================
create or replace function public.classe_percentual(p_member_class_id uuid) returns int
language sql stable security definer set search_path = '' as $$
  select case when count(r.*) = 0 then 0
    else round(100.0 * count(*) filter (where mr.status = 'aprovado') / count(r.*))::int end
  from public.member_classes mc
  join public.class_sections s on s.class_id = mc.class_id
  join public.class_requirements r on r.section_id = s.id and r.ativo
  left join public.member_requirements mr on mr.requirement_id = r.id and mr.member_class_id = mc.id
  where mc.id = p_member_class_id;
$$;
revoke all on function public.classe_percentual(uuid) from public, anon, authenticated;

-- ==================== E) RPCs ====================
-- Classes publicadas que a pessoa ainda não iniciou NO CLUBE EM USO.
create or replace function public.classes_disponiveis() returns json
language sql stable security definer set search_path = '' as $$
  select coalesce(json_agg(json_build_object(
    'class_id', c.id, 'codigo', c.codigo, 'nome', c.nome, 'faixa_etaria', c.faixa_etaria,
    'curriculum_version', json_build_object('id', v.id, 'origem', v.origem, 'identificador', v.identificador, 'versao', v.versao)
  ) order by c.ordem, c.nome), '[]'::json)
  from public.classes c
  join public.curriculum_versions v on v.id = c.curriculum_version_id
  where c.ativo and v.status = 'publicado'
    and public.membro_ativo_no_clube(public.clube_atual_id())
    and not exists (
      select 1 from public.member_classes mc
      where mc.usuario_id = auth.uid() and mc.club_id = public.clube_atual_id() and mc.class_id = c.id and mc.status <> 'cancelada'
    );
$$;
revoke all on function public.classes_disponiveis() from public, anon;
grant execute on function public.classes_disponiveis() to authenticated;

-- materializa member_requirements (um por requisito ativo) — status nasce sempre 'nao_iniciado', nunca aceito do cliente.
create or replace function public._classe_matricular(p_usuario_id uuid, p_club_id uuid, p_class_id uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_mc_id uuid;
begin
  insert into public.member_classes (usuario_id, club_id, class_id) values (p_usuario_id, p_club_id, p_class_id)
  on conflict (usuario_id, club_id, class_id) do nothing
  returning id into v_mc_id;
  if v_mc_id is null then
    select id into v_mc_id from public.member_classes where usuario_id = p_usuario_id and club_id = p_club_id and class_id = p_class_id;
  end if;
  insert into public.member_requirements (member_class_id, requirement_id)
  select v_mc_id, r.id
  from public.class_requirements r
  join public.class_sections s on s.id = r.section_id
  where s.class_id = p_class_id and r.ativo
  on conflict (member_class_id, requirement_id) do nothing;
  return v_mc_id;
end;
$$;
revoke all on function public._classe_matricular(uuid, uuid, uuid) from public, anon, authenticated;

create or replace function public.classe_iniciar(p_class_id uuid) returns json
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_club uuid := public.clube_atual_id(); v_mc_id uuid;
begin
  if v_uid is null or v_club is null or not public.membro_ativo_no_clube(v_club) then
    raise exception 'Sem clube em uso.';
  end if;
  if not public.classe_esta_publicada(p_class_id) then raise exception 'Classe não encontrada.'; end if;
  v_mc_id := public._classe_matricular(v_uid, v_club, p_class_id);
  return json_build_object('ok', true, 'member_class_id', v_mc_id);
end;
$$;
revoke all on function public.classe_iniciar(uuid) from public, anon;
grant execute on function public.classe_iniciar(uuid) to authenticated;

-- liderança inicia a classe em nome de alguém do PRÓPRIO clube em uso (nunca de outro clube da mesma pessoa).
create or replace function public.classe_atribuir(p_usuario_id uuid, p_class_id uuid) returns json
language plpgsql security definer set search_path = '' as $$
declare v_club uuid := public.clube_atual_id(); v_mc_id uuid;
begin
  if v_club is null or not public.pode_gerir_no_clube(v_club) then
    raise exception 'Sem permissão (apenas diretoria/instrutor deste clube).';
  end if;
  if not exists (
    select 1 from public.organization_memberships m
    where m.user_id = p_usuario_id and m.organizational_unit_id = v_club and m.role <> 'pais' and m.status = 'ativo'
      and m.starts_at <= now() and (m.ends_at is null or m.ends_at > now())
  ) then
    raise exception 'Pessoa sem vínculo ativo neste clube.';
  end if;
  if not public.classe_esta_publicada(p_class_id) then raise exception 'Classe não encontrada.'; end if;
  v_mc_id := public._classe_matricular(p_usuario_id, v_club, p_class_id);
  return json_build_object('ok', true, 'member_class_id', v_mc_id);
end;
$$;
revoke all on function public.classe_atribuir(uuid, uuid) from public, anon;
grant execute on function public.classe_atribuir(uuid, uuid) to authenticated;

-- "Minha Classe": progresso da própria pessoa NO CLUBE EM USO — percentual sempre calculado aqui (classe_percentual),
-- nunca recebido do cliente. Sem member_class_id, pega a mais recente em_andamento (senão a mais recente de
-- qualquer status) no clube atual. Seções/requisitos vêm do currículo versionado (nada de hardcode no React).
create or replace function public.minha_classe(p_member_class_id uuid default null) returns json
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_club uuid := public.clube_atual_id(); v_mc record;
begin
  if v_uid is null or v_club is null then return null; end if;
  if p_member_class_id is not null then
    select * into v_mc from public.member_classes where id = p_member_class_id and usuario_id = v_uid and club_id = v_club;
  else
    select * into v_mc from public.member_classes
     where usuario_id = v_uid and club_id = v_club
     order by (status = 'em_andamento') desc, iniciada_em desc
     limit 1;
  end if;
  if v_mc.id is null then return null; end if;

  return json_build_object(
    'member_class', json_build_object(
      'id', v_mc.id, 'status', v_mc.status, 'iniciada_em', v_mc.iniciada_em, 'concluida_em', v_mc.concluida_em,
      'percentual', public.classe_percentual(v_mc.id)
    ),
    'classe', (select json_build_object('id', c.id, 'codigo', c.codigo, 'nome', c.nome, 'faixa_etaria', c.faixa_etaria)
               from public.classes c where c.id = v_mc.class_id),
    'curriculum_version', (
      select json_build_object('id', ver.id, 'origem', ver.origem, 'identificador', ver.identificador, 'versao', ver.versao,
               'status', ver.status, 'fonte_url', ver.fonte_url, 'fonte_descricao', ver.fonte_descricao)
      from public.classes c join public.curriculum_versions ver on ver.id = c.curriculum_version_id where c.id = v_mc.class_id
    ),
    'investidura', (
      select json_build_object('status', ir.status, 'solicitado_em', ir.solicitado_em, 'revisado_em', ir.revisado_em, 'comentario', ir.comentario)
      from public.investiture_reviews ir where ir.member_class_id = v_mc.id
    ),
    'secoes', (
      select coalesce(json_agg(json_build_object(
        'id', s.id, 'nome', s.nome, 'ordem', s.ordem,
        'requisitos', (
          select coalesce(json_agg(json_build_object(
            'id', r.id, 'codigo', r.codigo, 'descricao', r.descricao,
            'tipo_evidencia', r.tipo_evidencia, 'evidencia_obrigatoria', r.evidencia_obrigatoria,
            'member_requirement_id', mr.id, 'status', coalesce(mr.status, 'nao_iniciado'),
            'evidencia_texto', mr.evidencia_texto, 'evidencia_path', mr.evidencia_path, 'enviado_em', mr.enviado_em,
            'avaliacoes', (
              select coalesce(json_agg(json_build_object(
                'decisao', a.decisao, 'avaliado_por_nome', p.nome, 'avaliado_papel', a.avaliado_papel,
                'comentario', a.comentario, 'created_at', a.created_at
              ) order by a.created_at), '[]'::json)
              from public.requirement_approvals a
              join public.profiles p on p.id = a.avaliado_por
              where mr.id is not null and a.member_requirement_id = mr.id
            )
          ) order by r.ordem, r.codigo), '[]'::json)
          from public.class_requirements r
          left join public.member_requirements mr on mr.requirement_id = r.id and mr.member_class_id = v_mc.id
          where r.section_id = s.id and r.ativo
        )
      ) order by s.ordem), '[]'::json)
      from public.class_sections s where s.class_id = v_mc.class_id
    )
  );
end;
$$;
revoke all on function public.minha_classe(uuid) from public, anon;
grant execute on function public.minha_classe(uuid) to authenticated;

-- rascunho: guarda texto/evidência sem enviar pra avaliação ainda (status nasce/volta pra 'em_andamento').
create or replace function public.requisito_salvar(p_requirement_id uuid, p_texto text default null, p_evidencia_path text default null) returns json
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_club uuid := public.clube_atual_id(); v_mr record;
begin
  if v_uid is null or v_club is null then raise exception 'Sem clube em uso.'; end if;
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
revoke all on function public.requisito_salvar(uuid, text, text) from public, anon;
grant execute on function public.requisito_salvar(uuid, text, text) to authenticated;

-- envia pra avaliação (exige evidência quando o requisito marca evidencia_obrigatoria).
create or replace function public.requisito_enviar(p_requirement_id uuid) returns json
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_club uuid := public.clube_atual_id(); v_mr record; v_req record;
begin
  if v_uid is null or v_club is null then raise exception 'Sem clube em uso.'; end if;
  select * into v_mr from public.member_requirements
   where requirement_id = p_requirement_id and usuario_id = v_uid and club_id = v_club for update;
  if not found then raise exception 'Requisito não encontrado para você neste clube.'; end if;
  if v_mr.status = 'aprovado' then raise exception 'Este requisito já foi aprovado.'; end if;
  select * into v_req from public.class_requirements where id = p_requirement_id;
  if v_req.evidencia_obrigatoria and coalesce(trim(v_mr.evidencia_texto), '') = '' and coalesce(v_mr.evidencia_path, '') = '' then
    raise exception 'Este requisito exige uma evidência antes de enviar.';
  end if;
  update public.member_requirements set status = 'aguardando_avaliacao', enviado_em = now(), updated_at = now() where id = v_mr.id;
  return json_build_object('ok', true);
end;
$$;
revoke all on function public.requisito_enviar(uuid) from public, anon;
grant execute on function public.requisito_enviar(uuid) to authenticated;

-- fila de avaliação da liderança, só do CLUBE EM USO de quem chama.
create or replace function public.classe_avaliacoes_pendentes() returns json
language sql stable security definer set search_path = '' as $$
  select coalesce(json_agg(json_build_object(
    'member_requirement_id', mr.id,
    'usuario_id', p.id, 'usuario_nome', p.nome, 'usuario_foto', p.foto,
    'classe_nome', c.nome, 'secao_nome', s.nome,
    'requisito_id', r.id, 'requisito_codigo', r.codigo, 'requisito_descricao', r.descricao,
    'tipo_evidencia', r.tipo_evidencia, 'evidencia_texto', mr.evidencia_texto, 'evidencia_path', mr.evidencia_path,
    'enviado_em', mr.enviado_em
  ) order by mr.enviado_em), '[]'::json)
  from public.member_requirements mr
  join public.class_requirements r on r.id = mr.requirement_id
  join public.class_sections s on s.id = r.section_id
  join public.classes c on c.id = s.class_id
  join public.profiles p on p.id = mr.usuario_id
  where mr.club_id = public.clube_atual_id() and mr.status = 'aguardando_avaliacao'
    and public.pode_gerir_no_clube(public.clube_atual_id());
$$;
revoke all on function public.classe_avaliacoes_pendentes() from public, anon;
grant execute on function public.classe_avaliacoes_pendentes() to authenticated;

-- A GUARDA CRÍTICA multi-clube: só avalia quem tem pode_gerir_no_clube(clube EM USO) — e o requisito
-- alvo (member_requirement_id) tem que SER desse mesmo clube (club_id = v_club), senão "não encontrado"
-- (mesma resposta de UUID inexistente — nenhum oráculo). Um avaliador do Clube A, mesmo sendo a mesma
-- pessoa desbravador/instrutor no Clube B, só passa por aqui quando está OPERANDO no clube certo E o
-- requisito é DESSE clube — nunca aprova o progresso do outro clube, mesmo trocando de aba.
create or replace function public.requisito_avaliar(p_member_requirement_id uuid, p_decisao text, p_comentario text default null) returns json
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_club uuid := public.clube_atual_id(); v_mr record; v_papel text;
begin
  if p_decisao not in ('aprovado', 'correcao_solicitada') then raise exception 'Decisão inválida.'; end if;
  if v_uid is null or v_club is null or not public.pode_gerir_no_clube(v_club) then
    raise exception 'Sem permissão (apenas diretoria/instrutor deste clube).';
  end if;
  select * into v_mr from public.member_requirements where id = p_member_requirement_id and club_id = v_club for update;
  if not found then raise exception 'Requisito não encontrado neste clube.'; end if;

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
revoke all on function public.requisito_avaliar(uuid, text, text) from public, anon;
grant execute on function public.requisito_avaliar(uuid, text, text) to authenticated;

-- base da revisão de investidura: só resolve (investido/recusado) o pedido do PRÓPRIO clube em uso.
-- Sem PDF/cartão/assinatura aqui — só fecha o registro (quem revisou, quando, comentário).
create or replace function public.investidura_confirmar(p_member_class_id uuid, p_aprovar boolean, p_comentario text default null) returns json
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_club uuid := public.clube_atual_id(); v_ir record;
begin
  if v_uid is null or v_club is null or not public.pode_gerir_no_clube(v_club) then
    raise exception 'Sem permissão (apenas diretoria/instrutor deste clube).';
  end if;
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
revoke all on function public.investidura_confirmar(uuid, boolean, text) from public, anon;
grant execute on function public.investidura_confirmar(uuid, boolean, text) to authenticated;

-- ==================== F) classe PILOTO — dados de TESTE, claramente identificados, não é currículo oficial ====================
-- origem='piloto_teste' (nunca 'oficial'); nomes/descrições prefixados "[PILOTO/TESTE]" de propósito, pra
-- nunca serem confundidos com o regulamento real de uma classe de Desbravadores. Existe só pra provar o motor
-- ponta a ponta (iniciar -> preencher -> enviar -> avaliar -> concluir -> abrir revisão de investidura).
-- Precisa ser SUBSTITUÍDA pela fonte oficial (e uma versão 'oficial' nova) antes de qualquer uso real.
insert into public.curriculum_versions (id, origem, identificador, versao, vigente_desde, status, fonte_url, fonte_descricao)
values (
  '00000000-0000-4000-a000-000000000001'::uuid, 'piloto_teste', 'piloto-motor-curricular', 'rascunho-1', current_date, 'publicado', null,
  'Dados de TESTE para validar o motor curricular (versão, classe, seções, requisitos, aprovação e investidura). ' ||
  'NÃO é o regulamento oficial de nenhuma classe de Desbravadores — precisa ser substituído pela fonte oficial ' ||
  '(manual/regulamento da associação) antes de qualquer uso real com membros.'
)
on conflict (identificador, versao) do nothing;

insert into public.classes (id, curriculum_version_id, codigo, nome, faixa_etaria, ordem)
values (
  '00000000-0000-4000-a000-000000000002'::uuid, '00000000-0000-4000-a000-000000000001'::uuid,
  'piloto_amigo', '[PILOTO/TESTE] Amigo', 'Dado de teste — não usar como referência etária real', 10
)
on conflict (curriculum_version_id, codigo) do nothing;

insert into public.class_sections (id, class_id, codigo, nome, ordem) values
  ('00000000-0000-4000-a000-000000000011'::uuid, '00000000-0000-4000-a000-000000000002'::uuid, 'espiritual', '[PILOTO/TESTE] Vida Espiritual', 10),
  ('00000000-0000-4000-a000-000000000012'::uuid, '00000000-0000-4000-a000-000000000002'::uuid, 'ar_livre', '[PILOTO/TESTE] Vida ao Ar Livre', 20),
  ('00000000-0000-4000-a000-000000000013'::uuid, '00000000-0000-4000-a000-000000000002'::uuid, 'conhecimentos', '[PILOTO/TESTE] Conhecimentos Gerais', 30)
on conflict (class_id, codigo) do nothing;

insert into public.class_requirements (section_id, codigo, descricao, tipo_evidencia, evidencia_obrigatoria, ordem) values
  ('00000000-0000-4000-a000-000000000011'::uuid, '1', '[DADO DE TESTE] Participar de 3 devocionais do clube (observado pela liderança).', 'nenhuma', false, 10),
  ('00000000-0000-4000-a000-000000000011'::uuid, '2', '[DADO DE TESTE] Escrever um texto curto sobre o que aprendeu numa reunião.', 'texto', true, 20),
  ('00000000-0000-4000-a000-000000000012'::uuid, '1', '[DADO DE TESTE] Enviar uma foto participando de uma atividade ao ar livre do clube.', 'foto', true, 10),
  ('00000000-0000-4000-a000-000000000012'::uuid, '2', '[DADO DE TESTE] Ser observado pela liderança identificando 2 nós básicos.', 'nenhuma', false, 20),
  ('00000000-0000-4000-a000-000000000013'::uuid, '1', '[DADO DE TESTE] Responder em texto livre um quiz sobre a história do clube.', 'texto', true, 10),
  ('00000000-0000-4000-a000-000000000013'::uuid, '2', '[DADO DE TESTE] Participar de uma atividade do módulo Atividades (registro manual da liderança — integração automática é fase futura).', 'atividade', false, 20)
on conflict (section_id, codigo) do nothing;

-- ==================== G) recurso do catálogo (feature flag — desligado por padrão, como o leilão) ====================
insert into public.recursos_catalogo (chave, nome, descricao, icone, padrao, ordem) values
  ('classes', 'Classes (piloto)', 'Motor curricular versionado: Minha Classe e avaliação de requisitos (fase piloto, dados de teste).', '🎖️', false, 130)
on conflict (chave) do update
  set nome = excluded.nome, descricao = excluded.descricao, icone = excluded.icone, padrao = excluded.padrao, ordem = excluded.ordem;

notify pgrst, 'reload schema';

insert into public.migracoes_aplicadas (arquivo)
values ('2026-09-21-motor-curricular-classes.sql')
on conflict (arquivo) do update set aplicada_em = now();
