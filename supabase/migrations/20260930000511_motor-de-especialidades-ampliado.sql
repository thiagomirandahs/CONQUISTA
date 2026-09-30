-- =============================================================================
--  Fase 7 — Motor de ESPECIALIDADES ampliado (mesmo desenho das Classes, migration 510)
--
--  Prepara o motor (sem publicar nenhum conteúdo real) para os tipos de requisito aprovados:
--    leitura · resposta · relatório estruturado · foto · arquivo · atividade prática · validação do instrutor
--    · meta/quantidade · dependência entre requisitos · escolha N de M · prazo · vários anexos.
--
--  · MODELO do requisito: specialty_requirements.modelo (mesmo formato do motor de relatório da 510).
--    Meta/quantidade = campo `numero` com `min` no modelo (validado no servidor no envio).
--  · N de M: specialty_requirement_groups (chave, minimo) + specialty_requirements.grupo.
--  · Dependência: specialty_requirements.depende_de (códigos de requisitos da MESMA especialidade).
--  · Prazo: specialty_requirements.prazo_dias (contado da matrícula; vale para a 1ª entrega — corrigir e
--    reenviar um requisito devolvido não é penalizado).
--  · HISTÓRICO: specialty_requirement_submissions, append-only, uma linha por tentativa COM o conteúdo e os
--    anexos; cada decisão (requirement_approvals) aponta para a tentativa que decidiu. Nova tentativa nunca
--    sobrescreve a antiga.
--  · PROVENIÊNCIA das fontes (specialties/specialty_requirements): url, data da consulta, revisão, conferência.
--  Nenhuma linha de especialidade é criada aqui: o conteúdo real só entra por migration gerada do manifesto,
--  depois da aprovação da fonte.
-- =============================================================================

-- ==================== 1) catálogo: modelo, grupos, dependência, prazo, proveniência ====================
do $$
declare v_nome text;
begin
  for v_nome in
    select con.conname from pg_constraint con
     where con.conrelid = 'public.specialty_requirements'::regclass and con.contype = 'c'
       and pg_get_constraintdef(con.oid) like '%tipo_evidencia%'
  loop
    execute format('alter table public.specialty_requirements drop constraint %I', v_nome);
  end loop;
end $$;
alter table public.specialty_requirements add constraint specialty_requirements_tipo_evidencia_check
  check (tipo_evidencia in ('nenhuma', 'texto', 'foto', 'arquivo', 'presenca', 'atividade', 'biblia', 'evento', 'especialidade', 'externo',
                            'leitura', 'resposta', 'relatorio', 'validacao'));

alter table public.specialty_requirements
  add column if not exists modelo jsonb check (modelo is null or (jsonb_typeof(modelo) = 'object' and modelo ->> 'versao' = '1' and jsonb_typeof(modelo -> 'campos') = 'array')),
  add column if not exists grupo text check (grupo is null or grupo ~ '^[a-z][a-z0-9_]{0,39}$'),
  add column if not exists depende_de text[] not null default '{}',
  add column if not exists prazo_dias int check (prazo_dias is null or prazo_dias between 1 and 730),
  add column if not exists fonte_url text,
  add column if not exists status_fonte text check (status_fonte is null or status_fonte in ('pendente', 'conferido')),
  add column if not exists manifesto_id text;

alter table public.specialties
  add column if not exists fonte_url text,
  add column if not exists fonte_consultada_em date,
  add column if not exists fonte_revisao text,
  add column if not exists status_fonte text check (status_fonte is null or status_fonte in ('pendente', 'conferido')),
  add column if not exists manifesto_hash text;

create table if not exists public.specialty_requirement_groups (
  id uuid primary key default gen_random_uuid(),
  specialty_id uuid not null references public.specialties(id) on delete cascade,
  chave text not null check (chave ~ '^[a-z][a-z0-9_]{0,39}$'),
  rotulo text not null,
  minimo int not null check (minimo >= 1),
  unique (specialty_id, chave)
);
alter table public.specialty_requirement_groups enable row level security;
revoke all on public.specialty_requirement_groups from public, anon, authenticated;

-- o grupo de um requisito tem que existir na MESMA especialidade
create or replace function public._validar_grupo_do_requisito() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.grupo is not null and not exists (select 1 from public.specialty_requirement_groups g where g.specialty_id = new.specialty_id and g.chave = new.grupo) then
    raise exception 'Grupo "%" não existe nesta especialidade.', new.grupo;
  end if;
  if new.codigo = any (new.depende_de) then raise exception 'Requisito não pode depender de si mesmo.'; end if;
  return new;
end;
$$;
drop trigger if exists trg_validar_grupo_do_requisito on public.specialty_requirements;
create trigger trg_validar_grupo_do_requisito before insert or update on public.specialty_requirements
  for each row execute function public._validar_grupo_do_requisito();

-- ==================== 2) progresso do membro: rascunho estruturado ====================
alter table public.member_specialty_requirements
  add column if not exists rascunho jsonb,
  add column if not exists rascunho_anexos jsonb not null default '[]'::jsonb;

-- ==================== 3) tentativas imutáveis ====================
create table if not exists public.specialty_requirement_submissions (
  id uuid primary key default gen_random_uuid(),
  member_specialty_requirement_id uuid references public.member_specialty_requirements(id) on delete set null,
  specialty_requirement_id uuid not null references public.specialty_requirements(id),
  usuario_id uuid references public.profiles(id) on delete set null,
  club_id uuid not null references public.organizational_units(id) on delete cascade,
  tentativa_numero integer not null,
  tipo_evidencia_entregue text not null check (tipo_evidencia_entregue in ('nenhuma', 'texto', 'foto', 'arquivo', 'relatorio')),
  evidencia_texto text,
  evidencia_path text,
  conteudo jsonb,
  anexos jsonb not null default '[]'::jsonb,
  modelo_versao int,
  enviado_em timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (member_specialty_requirement_id, tentativa_numero)
);
create index if not exists idx_srs_msr on public.specialty_requirement_submissions(member_specialty_requirement_id, tentativa_numero desc);
create index if not exists idx_srs_club on public.specialty_requirement_submissions(club_id);
create index if not exists idx_srs_usuario on public.specialty_requirement_submissions(usuario_id, club_id);

-- usuario/clube/requisito são DERIVADOS do requisito do membro — nunca vêm do cliente
create or replace function public._definir_escopo_submissao_especialidade() returns trigger
language plpgsql as $$
declare v_mr record;
begin
  select specialty_requirement_id, usuario_id, club_id into v_mr from public.member_specialty_requirements where id = new.member_specialty_requirement_id;
  if not found then raise exception 'Requisito de membro inexistente.'; end if;
  new.specialty_requirement_id := v_mr.specialty_requirement_id;
  new.usuario_id := v_mr.usuario_id;
  new.club_id := v_mr.club_id;
  return new;
end;
$$;
drop trigger if exists trg_definir_escopo_submissao_especialidade on public.specialty_requirement_submissions;
create trigger trg_definir_escopo_submissao_especialidade before insert on public.specialty_requirement_submissions
  for each row execute function public._definir_escopo_submissao_especialidade();

drop trigger if exists trg_submissao_especialidade_imutavel on public.specialty_requirement_submissions;
create trigger trg_submissao_especialidade_imutavel before update or delete on public.specialty_requirement_submissions
  for each row execute function public._proteger_registro_imutavel();

alter table public.specialty_requirement_submissions enable row level security;
drop policy if exists "dono ou lideranca do clube le submissoes de especialidade" on public.specialty_requirement_submissions;
create policy "dono ou lideranca do clube le submissoes de especialidade" on public.specialty_requirement_submissions for select to authenticated
using (club_id = public.clube_atual_id() and (usuario_id = auth.uid() or public.pode_avaliar_curriculo(club_id)));
revoke all on public.specialty_requirement_submissions from public, anon, authenticated;
grant select on public.specialty_requirement_submissions to authenticated;

alter table public.requirement_approvals
  add column if not exists specialty_submission_id uuid references public.specialty_requirement_submissions(id);
create unique index if not exists idx_requirement_approvals_specialty_submission_unica
  on public.requirement_approvals(specialty_submission_id) where specialty_submission_id is not null;

-- ==================== 4) progresso com grupos N de M ====================
-- total = requisitos avulsos + Σ mínimo de cada grupo; feitos = avulsos aprovados + Σ min(aprovados do grupo, mínimo)
create or replace function public._especialidade_progresso(p_member_specialty_id uuid)
returns table (total int, feitos int)
language sql stable security definer set search_path = '' as $$
  with base as (
    select r.id, r.grupo, (mr.status = 'aprovado') as ok
      from public.member_specialties ms
      join public.specialty_requirements r on r.specialty_id = ms.specialty_id and r.ativo
      left join public.member_specialty_requirements mr on mr.specialty_requirement_id = r.id and mr.member_specialty_id = ms.id
     where ms.id = p_member_specialty_id
  ), avulsos as (
    select count(*)::int as total, count(*) filter (where ok)::int as feitos from base where grupo is null
  ), grupos as (
    select coalesce(sum(g.minimo), 0)::int as total,
           coalesce(sum(least((select count(*) filter (where b.ok) from base b where b.grupo = g.chave), g.minimo)), 0)::int as feitos
      from public.specialty_requirement_groups g
      join public.member_specialties ms on ms.specialty_id = g.specialty_id
     where ms.id = p_member_specialty_id
  )
  select a.total + g.total, a.feitos + g.feitos from avulsos a, grupos g;
$$;
revoke all on function public._especialidade_progresso(uuid) from public, anon, authenticated;

create or replace function public.especialidade_percentual(p_member_specialty_id uuid) returns int
language sql stable security definer set search_path = '' as $$
  select case when p.total = 0 then 0 else round(100.0 * p.feitos / p.total)::int end
    from public._especialidade_progresso(p_member_specialty_id) p;
$$;
revoke all on function public.especialidade_percentual(uuid) from public, anon, authenticated;

create or replace function public.avaliar_conclusao_especialidade() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_ms record; v_prazo_min int; v_tot int; v_feitos int;
begin
  if new.status is distinct from 'aprovado' then return new; end if;
  select * into v_ms from public.member_specialties where id = new.member_specialty_id;
  if v_ms.status is distinct from 'em_andamento' then return new; end if;
  select total, feitos into v_tot, v_feitos from public._especialidade_progresso(new.member_specialty_id);
  if v_tot > 0 and v_feitos >= v_tot then
    select prazo_minimo_dias into v_prazo_min from public.specialties where id = v_ms.specialty_id;
    if v_prazo_min is not null and now() < v_ms.iniciada_em + (v_prazo_min || ' days')::interval then
      return new;
    end if;
    update public.member_specialties set status = 'concluida', concluida_em = now(), updated_at = now() where id = new.member_specialty_id;
  end if;
  return new;
end;
$$;
revoke all on function public.avaliar_conclusao_especialidade() from public, anon, authenticated;

-- ==================== 5) bloqueios: dependência entre requisitos e prazo ====================
create or replace function public._especialidade_bloqueios(p_member_specialty_requirement_id uuid)
returns text[]
language plpgsql stable security definer set search_path = '' as $$
declare v_mr record; v_req record; v_ms record; v_out text[] := '{}'; v_cod text;
begin
  select * into v_mr from public.member_specialty_requirements where id = p_member_specialty_requirement_id;
  if not found then return v_out; end if;
  select * into v_req from public.specialty_requirements where id = v_mr.specialty_requirement_id;
  select * into v_ms from public.member_specialties where id = v_mr.member_specialty_id;
  foreach v_cod in array coalesce(v_req.depende_de, '{}') loop
    if not exists (
      select 1 from public.member_specialty_requirements m2
        join public.specialty_requirements r2 on r2.id = m2.specialty_requirement_id
       where m2.member_specialty_id = v_mr.member_specialty_id and r2.codigo = v_cod and m2.status = 'aprovado'
    ) then
      v_out := v_out || ('Conclua antes o requisito ' || v_cod || '.');
    end if;
  end loop;
  if v_req.prazo_dias is not null and now() > v_ms.iniciada_em + make_interval(days => v_req.prazo_dias)
     and not exists (select 1 from public.specialty_requirement_submissions s where s.member_specialty_requirement_id = v_mr.id) then
    v_out := v_out || 'O prazo deste requisito terminou. Fale com o instrutor.'::text;
  end if;
  return v_out;
end;
$$;
revoke all on function public._especialidade_bloqueios(uuid) from public, anon, authenticated;

-- ==================== 6) RPCs do membro ====================
create or replace function public.especialidade_requisito_relatorio_salvar(p_specialty_requirement_id uuid, p_conteudo jsonb, p_anexos jsonb default '[]'::jsonb)
returns json
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_club uuid := public.clube_atual_id(); v_mr record; v_req record; v_erros text[];
begin
  if v_uid is null or v_club is null then raise exception 'Sem clube em uso.'; end if;
  perform public._exigir_especialidades_habilitado(v_club);
  select * into v_mr from public.member_specialty_requirements
   where specialty_requirement_id = p_specialty_requirement_id and usuario_id = v_uid and club_id = v_club for update;
  select * into v_req from public.specialty_requirements where id = p_specialty_requirement_id;
  if v_mr.id is null or not public._especialidade_do_catalogo_oficial(v_req.specialty_id) then
    raise exception 'Requisito não encontrado para você neste clube.';
  end if;
  if v_mr.status = 'aprovado' then raise exception 'Este requisito já foi aprovado.'; end if;
  if v_mr.status = 'aguardando_avaliacao' then raise exception 'Este requisito já foi enviado. Aguarde a avaliação.'; end if;
  if v_req.modelo is null then raise exception 'Este requisito não tem formulário.'; end if;
  v_erros := public._relatorio_validar(v_req.modelo, p_conteudo, p_anexos, false) || public._anexos_do_dono_erros(p_anexos, v_uid, v_club);
  if array_length(v_erros, 1) > 0 then raise exception 'Formulário: %', public._erros_em_texto(v_erros); end if;
  update public.member_specialty_requirements
     set rascunho = p_conteudo, rascunho_anexos = coalesce(p_anexos, '[]'::jsonb),
         status = case when status in ('nao_iniciado', 'correcao_solicitada') then 'em_andamento' else status end,
         updated_at = now()
   where id = v_mr.id;
  return json_build_object('ok', true);
end;
$$;
revoke all on function public.especialidade_requisito_relatorio_salvar(uuid, jsonb, jsonb) from public, anon;
grant execute on function public.especialidade_requisito_relatorio_salvar(uuid, jsonb, jsonb) to authenticated;

create or replace function public.especialidade_requisito_enviar(p_specialty_requirement_id uuid)
returns json
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid(); v_club uuid := public.clube_atual_id(); v_mr record; v_req record;
  v_erros text[]; v_bloq text[]; v_tipo text; v_prox int; v_sub uuid; v_resumo text; v_primeiro text;
begin
  if v_uid is null or v_club is null then raise exception 'Sem clube em uso.'; end if;
  perform public._exigir_especialidades_habilitado(v_club);
  select * into v_mr from public.member_specialty_requirements
   where specialty_requirement_id = p_specialty_requirement_id and usuario_id = v_uid and club_id = v_club for update;
  select * into v_req from public.specialty_requirements where id = p_specialty_requirement_id;
  if v_mr.id is null or not public._especialidade_do_catalogo_oficial(v_req.specialty_id) then
    raise exception 'Requisito não encontrado para você neste clube.';
  end if;
  if v_mr.status = 'aprovado' then raise exception 'Este requisito já foi aprovado.'; end if;
  if v_mr.status = 'aguardando_avaliacao' then raise exception 'Este requisito já foi enviado. Aguarde a avaliação.'; end if;

  v_bloq := public._especialidade_bloqueios(v_mr.id);
  if array_length(v_bloq, 1) > 0 then raise exception 'Requisito bloqueado: %', array_to_string(v_bloq, ' '); end if;

  if v_req.modelo is null then
    if v_req.evidencia_obrigatoria and coalesce(trim(v_mr.evidencia_texto), '') = '' and coalesce(v_mr.evidencia_path, '') = '' then
      raise exception 'Este requisito exige uma evidência antes de enviar.';
    end if;
  else
    v_erros := public._relatorio_validar(v_req.modelo, coalesce(v_mr.rascunho, '{}'::jsonb), v_mr.rascunho_anexos, true)
            || public._anexos_do_dono_erros(v_mr.rascunho_anexos, v_uid, v_club);
    if array_length(v_erros, 1) > 0 then raise exception 'Formulário incompleto: %', public._erros_em_texto(v_erros); end if;
  end if;

  select coalesce(max(tentativa_numero), 0) + 1 into v_prox
    from public.specialty_requirement_submissions where member_specialty_requirement_id = v_mr.id;

  if v_req.modelo is null then
    v_tipo := case
      when v_mr.evidencia_path is not null and v_req.tipo_evidencia = 'arquivo' then 'arquivo'
      when v_mr.evidencia_path is not null then 'foto'
      when coalesce(trim(v_mr.evidencia_texto), '') <> '' then 'texto'
      else 'nenhuma'
    end;
    insert into public.specialty_requirement_submissions (member_specialty_requirement_id, tentativa_numero, tipo_evidencia_entregue, evidencia_texto, evidencia_path)
    values (v_mr.id, v_prox, v_tipo, v_mr.evidencia_texto, v_mr.evidencia_path) returning id into v_sub;
  else
    v_resumo := public._relatorio_resumo(v_req.modelo -> 'campos', coalesce(v_mr.rascunho, '{}'::jsonb));
    v_primeiro := v_mr.rascunho_anexos -> 0 ->> 'path';
    insert into public.specialty_requirement_submissions
      (member_specialty_requirement_id, tentativa_numero, tipo_evidencia_entregue, evidencia_texto, evidencia_path, conteudo, anexos, modelo_versao)
    values (v_mr.id, v_prox, 'relatorio', nullif(v_resumo, ''), v_primeiro, coalesce(v_mr.rascunho, '{}'::jsonb), v_mr.rascunho_anexos, 1) returning id into v_sub;
    update public.member_specialty_requirements set evidencia_texto = nullif(v_resumo, ''), evidencia_path = coalesce(v_primeiro, evidencia_path) where id = v_mr.id;
  end if;

  update public.member_specialty_requirements set status = 'aguardando_avaliacao', enviado_em = now(), updated_at = now() where id = v_mr.id;
  return json_build_object('ok', true, 'submission_id', v_sub, 'tentativa_numero', v_prox);
end;
$$;
revoke all on function public.especialidade_requisito_enviar(uuid) from public, anon;
grant execute on function public.especialidade_requisito_enviar(uuid) to authenticated;

-- ==================== 7) avaliação: por TENTATIVA, com trava de concorrência e comentário obrigatório ao devolver ====================
create or replace function public.especialidade_requisito_avaliar(p_member_specialty_requirement_id uuid, p_decisao text, p_comentario text default null, p_submission_id uuid default null)
returns json
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_club uuid := public.clube_atual_id(); v_mr record; v_papel text; v_sub_id uuid;
begin
  if p_decisao not in ('aprovado', 'correcao_solicitada') then raise exception 'Decisão inválida.'; end if;
  if p_decisao = 'correcao_solicitada' and coalesce(trim(p_comentario), '') = '' then raise exception 'Explique o que precisa ser corrigido.'; end if;
  if v_uid is null or v_club is null then raise exception 'Sem clube em uso.'; end if;
  perform public._exigir_especialidades_habilitado(v_club);
  select * into v_mr from public.member_specialty_requirements where id = p_member_specialty_requirement_id and club_id = v_club for update;
  if not found or not public._especialidade_do_catalogo_oficial((select r.specialty_id from public.specialty_requirements r where r.id = v_mr.specialty_requirement_id)) then
    raise exception 'Requisito não encontrado neste clube.';
  end if;
  if not public._pode_avaliar_especialidade(v_mr.member_specialty_id, v_club) then
    raise exception 'Sem permissão (apenas diretoria/instrutor deste clube, ou o instrutor responsável pela turma).';
  end if;
  if v_mr.usuario_id = v_uid then raise exception 'Você não pode avaliar o seu próprio requisito.'; end if;

  select id into v_sub_id from public.specialty_requirement_submissions
   where member_specialty_requirement_id = v_mr.id order by tentativa_numero desc limit 1 for update;
  if p_submission_id is not null and (v_sub_id is null or p_submission_id <> v_sub_id) then
    raise exception 'Esta não é mais a tentativa mais recente — o membro já reenviou, ou a tentativa não existe. Recarregue a fila.';
  end if;
  v_sub_id := coalesce(p_submission_id, v_sub_id);
  if v_sub_id is not null and exists (select 1 from public.requirement_approvals where specialty_submission_id = v_sub_id) then
    raise exception 'Esta tentativa já foi avaliada por outra pessoa — recarregue a fila.';
  end if;

  v_papel := coalesce(public.papel_no_clube(v_uid, v_club), 'responsavel_da_turma');
  begin
    insert into public.requirement_approvals (member_specialty_requirement_id, specialty_requirement_id, curriculum_version_id, club_id, decisao, avaliado_por, avaliado_papel, comentario, specialty_submission_id)
    select v_mr.id, v_mr.specialty_requirement_id, ver.id, v_club, p_decisao, v_uid, v_papel, p_comentario, v_sub_id
      from public.specialty_requirements r
      join public.specialties sp on sp.id = r.specialty_id
      join public.curriculum_versions ver on ver.id = sp.curriculum_version_id
     where r.id = v_mr.specialty_requirement_id;
  exception when unique_violation then
    raise exception 'Esta tentativa já foi avaliada por outra pessoa — recarregue a fila.';
  end;
  update public.member_specialty_requirements set status = p_decisao, updated_at = now() where id = v_mr.id;
  return json_build_object('ok', true);
end;
$$;
revoke all on function public.especialidade_requisito_avaliar(uuid, text, text, uuid) from public, anon;
grant execute on function public.especialidade_requisito_avaliar(uuid, text, text, uuid) to authenticated;
drop function if exists public.especialidade_requisito_avaliar(uuid, text, text);

-- Histórico completo (dono ou avaliador do clube em uso). Nunca cruza clubes.
create or replace function public.especialidade_historico(p_member_specialty_requirement_id uuid) returns json
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_club uuid := public.clube_atual_id(); v_mr record; v_req record;
begin
  if v_uid is null or v_club is null then raise exception 'Sem clube em uso.'; end if;
  perform public._exigir_especialidades_habilitado(v_club);
  select * into v_mr from public.member_specialty_requirements
   where id = p_member_specialty_requirement_id and club_id = v_club
     and (usuario_id = v_uid or public._pode_avaliar_especialidade(member_specialty_id, v_club));
  if not found then raise exception 'Requisito não encontrado para você neste clube.'; end if;
  select * into v_req from public.specialty_requirements where id = v_mr.specialty_requirement_id;
  return json_build_object(
    'requirement_id', v_mr.specialty_requirement_id,
    'status_atual', v_mr.status,
    'modelo', v_req.modelo,
    'tentativas', (
      select coalesce(json_agg(json_build_object(
        'submission_id', sub.id, 'tentativa_numero', sub.tentativa_numero, 'tipo_evidencia', sub.tipo_evidencia_entregue,
        'evidencia_texto', sub.evidencia_texto, 'evidencia_path', sub.evidencia_path, 'conteudo', sub.conteudo, 'anexos', sub.anexos,
        'modelo_versao', sub.modelo_versao, 'enviado_em', sub.enviado_em,
        'decisao', ap.decisao, 'avaliado_por_nome', av.nome, 'avaliado_papel', ap.avaliado_papel, 'comentario', ap.comentario, 'avaliado_em', ap.created_at
      ) order by sub.tentativa_numero), '[]'::json)
      from public.specialty_requirement_submissions sub
      left join public.requirement_approvals ap on ap.specialty_submission_id = sub.id
      left join public.profiles av on av.id = ap.avaliado_por
      where sub.member_specialty_requirement_id = v_mr.id
    )
  );
end;
$$;
revoke all on function public.especialidade_historico(uuid) from public, anon;
grant execute on function public.especialidade_historico(uuid) to authenticated;

-- ==================== 8) leitura: minha especialidade e fila de avaliação ====================
create or replace function public.minha_especialidade(p_member_specialty_id uuid default null)
returns json
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_club uuid := public.clube_atual_id(); v_ms record;
begin
  if v_uid is null or v_club is null then return null; end if;
  perform public._exigir_especialidades_habilitado(v_club);
  if p_member_specialty_id is not null then
    select * into v_ms from public.member_specialties
     where id = p_member_specialty_id and usuario_id = v_uid and club_id = v_club
       and public._especialidade_do_catalogo_oficial(specialty_id);
  else
    select * into v_ms from public.member_specialties
     where usuario_id = v_uid and club_id = v_club and public._especialidade_do_catalogo_oficial(specialty_id)
     order by (status = 'em_andamento') desc, iniciada_em desc
     limit 1;
  end if;
  if v_ms.id is null then return null; end if;

  return json_build_object(
    'member_specialty', json_build_object(
      'id', v_ms.id, 'status', v_ms.status, 'iniciada_em', v_ms.iniciada_em, 'concluida_em', v_ms.concluida_em,
      'percentual', public.especialidade_percentual(v_ms.id)
    ),
    'especialidade', (select json_build_object('id', sp.id, 'codigo', sp.codigo, 'nome', sp.nome, 'categoria', sp.categoria, 'nivel', sp.nivel,
                              'fonte_url', sp.fonte_url, 'fonte_consultada_em', sp.fonte_consultada_em, 'fonte_revisao', sp.fonte_revisao)
                       from public.specialties sp where sp.id = v_ms.specialty_id),
    'curriculum_version', (
      select json_build_object('id', ver.id, 'origem', ver.origem, 'identificador', ver.identificador, 'versao', ver.versao,
               'status', ver.status, 'fonte_url', ver.fonte_url, 'fonte_descricao', ver.fonte_descricao)
      from public.specialties sp join public.curriculum_versions ver on ver.id = sp.curriculum_version_id where sp.id = v_ms.specialty_id
    ),
    'oferta', (select json_build_object('titulo', o.titulo, 'instrutor_responsavel_nome', p.nome, 'periodo_inicio', o.periodo_inicio, 'periodo_fim', o.periodo_fim)
               from public.specialty_offerings o left join public.profiles p on p.id = o.instrutor_responsavel_id where o.id = v_ms.oferta_id),
    'grupos', (
      select coalesce(json_agg(json_build_object(
        'chave', g.chave, 'rotulo', g.rotulo, 'minimo', g.minimo,
        'aprovados', (select count(*) from public.specialty_requirements r2
                        join public.member_specialty_requirements m2 on m2.specialty_requirement_id = r2.id and m2.member_specialty_id = v_ms.id
                       where r2.specialty_id = g.specialty_id and r2.grupo = g.chave and m2.status = 'aprovado')
      ) order by g.chave), '[]'::json)
      from public.specialty_requirement_groups g where g.specialty_id = v_ms.specialty_id
    ),
    'requisitos', (
      select coalesce(json_agg(json_build_object(
        'id', r.id, 'codigo', r.codigo, 'descricao', r.descricao,
        'tipo_evidencia', r.tipo_evidencia, 'evidencia_obrigatoria', r.evidencia_obrigatoria,
        'modelo', r.modelo, 'grupo', r.grupo, 'depende_de', to_json(r.depende_de), 'prazo_dias', r.prazo_dias,
        'prazo_em', case when r.prazo_dias is null then null else v_ms.iniciada_em + make_interval(days => r.prazo_dias) end,
        'bloqueios', case when mr.id is null then '[]'::json else to_json(public._especialidade_bloqueios(mr.id)) end,
        'member_specialty_requirement_id', mr.id, 'status', coalesce(mr.status, 'nao_iniciado'),
        'evidencia_texto', mr.evidencia_texto, 'evidencia_path', mr.evidencia_path, 'enviado_em', mr.enviado_em,
        'rascunho', mr.rascunho, 'anexos', coalesce(mr.rascunho_anexos, '[]'::jsonb),
        'tentativas', (select count(*) from public.specialty_requirement_submissions s where s.member_specialty_requirement_id = mr.id),
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

create or replace function public.especialidade_avaliacoes_pendentes()
returns json
language plpgsql stable security definer set search_path = '' as $$
declare v_club uuid := public.clube_atual_id();
begin
  if v_club is null then return '[]'::json; end if;
  perform public._exigir_especialidades_habilitado(v_club);
  return coalesce((
    select json_agg(json_build_object(
      'member_specialty_requirement_id', mr.id,
      'submission_id', sub.id, 'tentativa_numero', sub.tentativa_numero,
      'usuario_id', p.id, 'usuario_nome', p.nome, 'usuario_foto', p.foto,
      'especialidade_nome', sp.nome,
      'requisito_id', r.id, 'requisito_codigo', r.codigo, 'requisito_descricao', r.descricao,
      'tipo_evidencia', coalesce(sub.tipo_evidencia_entregue, r.tipo_evidencia),
      'evidencia_texto', coalesce(sub.evidencia_texto, mr.evidencia_texto), 'evidencia_path', coalesce(sub.evidencia_path, mr.evidencia_path),
      'conteudo', sub.conteudo, 'anexos', coalesce(sub.anexos, '[]'::jsonb), 'modelo', r.modelo,
      'enviado_em', mr.enviado_em
    ) order by mr.enviado_em)
    from public.member_specialty_requirements mr
    join public.specialty_requirements r on r.id = mr.specialty_requirement_id
    join public.specialties sp on sp.id = r.specialty_id
    join public.profiles p on p.id = mr.usuario_id
    left join lateral (
      select * from public.specialty_requirement_submissions s2 where s2.member_specialty_requirement_id = mr.id order by s2.tentativa_numero desc limit 1
    ) sub on true
    where mr.club_id = v_club and mr.status = 'aguardando_avaliacao'
      and public._especialidade_do_catalogo_oficial(sp.id)
      and public._pode_avaliar_especialidade(mr.member_specialty_id, v_club)
  ), '[]'::json);
end;
$$;

-- ==================== 9) anexos de especialidade: visíveis à liderança, nunca "órfãos" ====================
create or replace function public.lideranca_ve_comprovacao(p_objeto text)
 returns boolean
 language sql
 stable security definer
 set search_path to ''
as $function$
  select public.pode_gerir_no_clube(public.clube_atual_id())
     and exists (
       select 1 from public.member_requirements x
        where x.evidencia_path = p_objeto and x.club_id = public.clube_atual_id()
       union all
       select 1 from public.member_requirements x, jsonb_array_elements(x.rascunho_anexos) a
        where a ->> 'path' = p_objeto and x.club_id = public.clube_atual_id()
       union all
       select 1 from public.requirement_submissions x
        where x.evidencia_path = p_objeto and x.club_id = public.clube_atual_id()
       union all
       select 1 from public.requirement_submissions x, jsonb_array_elements(x.anexos) a
        where a ->> 'path' = p_objeto and x.club_id = public.clube_atual_id()
       union all
       select 1 from public.member_specialty_requirements x
        where x.evidencia_path = p_objeto and x.club_id = public.clube_atual_id()
       union all
       select 1 from public.member_specialty_requirements x, jsonb_array_elements(x.rascunho_anexos) a
        where a ->> 'path' = p_objeto and x.club_id = public.clube_atual_id()
       union all
       select 1 from public.specialty_requirement_submissions x
        where x.evidencia_path = p_objeto and x.club_id = public.clube_atual_id()
       union all
       select 1 from public.specialty_requirement_submissions x, jsonb_array_elements(x.anexos) a
        where a ->> 'path' = p_objeto and x.club_id = public.clube_atual_id()
       union all
       select 1 from public.entregas x
        where x.foto_url = p_objeto and x.club_id = public.clube_atual_id()
       union all
       select 1 from public.missoes_feitas x
        where x.foto_url = p_objeto and x.club_id = public.clube_atual_id()
       union all
       select 1 from public.devocional x
        where x.foto_url = p_objeto and x.club_id = public.clube_atual_id()
       union all
       select 1 from public.experience_submissions x
        where x.arquivo_path = p_objeto and x.club_id = public.clube_atual_id()
     );
$function$;

create or replace function public._comprovacao_referenciada(p_nome text) returns boolean
language sql stable security definer set search_path = '' as $$
  select (auth.uid() is not null and p_nome not like auth.uid()::text || '/%')
      or exists (select 1 from public.member_requirements where evidencia_path = p_nome)
      or exists (select 1 from public.member_requirements x, jsonb_array_elements(x.rascunho_anexos) a where a ->> 'path' = p_nome)
      or exists (select 1 from public.requirement_submissions where evidencia_path = p_nome)
      or exists (select 1 from public.requirement_submissions x, jsonb_array_elements(x.anexos) a where a ->> 'path' = p_nome)
      or exists (select 1 from public.member_specialty_requirements where evidencia_path = p_nome)
      or exists (select 1 from public.member_specialty_requirements x, jsonb_array_elements(x.rascunho_anexos) a where a ->> 'path' = p_nome)
      or exists (select 1 from public.specialty_requirement_submissions where evidencia_path = p_nome)
      or exists (select 1 from public.specialty_requirement_submissions x, jsonb_array_elements(x.anexos) a where a ->> 'path' = p_nome)
      or exists (select 1 from public.class_completion_snapshots where strpos(conteudo::text, p_nome) > 0);
$$;
revoke all on function public._comprovacao_referenciada(text) from public, anon;
grant execute on function public._comprovacao_referenciada(text) to authenticated;

select public._manutencao_instalar_guarda();
notify pgrst, 'reload schema';
