-- =====================================================================
-- Fase 3.1 — regra curricular BLOQUEIA de verdade. Rodar DEPOIS da 20260921000040. Idempotente.
--
-- Achado da fase 3: o motor de explicação (migration 38) dizia "bloqueado" (dependência pendente,
-- conteúdo dinâmico sem valor), mas requisito_enviar/requisito_avaliar só conferiam a dependência —
-- dava pra enviar e aprovar um requisito anual sem o conteúdo do ano, e um "escolha 1 de 4" sem
-- ninguém registrar QUAL opção foi feita. Aprovação manual não pode substituir silenciosamente uma
-- regra estrutural. Esta migration:
--   A) member_requirement_options — a ESCOLHA registrada (qual/quais opções a pessoa cumpriu num
--      requisito N-de-M; texto livre só quando o cartão não lista opções). RPC requisito_escolher.
--   B) _requisito_bloqueios(member_requirement_id) — UMA função decide o que bloqueia: dependência
--      pendente; conteúdo dinâmico sem valor pro período; N-de-M com menos escolhas válidas que
--      n_minimo (escolhas registradas + opções cumpridas pelo histórico); sem_repeticao violada
--      (opção ligada a especialidade que a pessoa JÁ tinha antes de começar esta classe).
--   C) requisito_enviar E requisito_avaliar(aprovado) recusam quando há bloqueio — a mesma lista que
--      a tela mostra. explicar_requisito_classe passa a expor `bloqueios`; minha_classe() e
--      classe_avaliacoes_pendentes() entregam bloqueios/escolhas pra tela não depender de texto.
-- Limite honesto: sem_repeticao só é verificável automaticamente quando a opção tem specialty_id
-- (o catálogo de Especialidades ainda não foi importado — hoje as opções são rótulos); nesse caso
-- a regra fica declarada e visível, e a escolha registrada é o que a liderança confere.
-- =====================================================================

-- ---------------------------------------------------------------------
-- A) escolha registrada
-- ---------------------------------------------------------------------
create table if not exists public.member_requirement_options (
  id uuid primary key default gen_random_uuid(),
  member_requirement_id uuid not null references public.member_requirements(id) on delete cascade,
  option_id uuid references public.requirement_options(id) on delete cascade,
  rotulo_livre text,
  usuario_id uuid not null references public.profiles(id) on delete cascade,
  club_id uuid not null references public.organizational_units(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint member_requirement_options_um_dos_dois check (
    (option_id is not null and rotulo_livre is null) or (option_id is null and rotulo_livre is not null and length(trim(rotulo_livre)) > 0))
);
create unique index if not exists ux_member_requirement_options_opcao on public.member_requirement_options (member_requirement_id, option_id) where option_id is not null;
create unique index if not exists ux_member_requirement_options_livre on public.member_requirement_options (member_requirement_id, rotulo_livre) where rotulo_livre is not null;
create index if not exists idx_member_requirement_options_club on public.member_requirement_options (club_id);

alter table public.member_requirement_options enable row level security;
revoke insert, update, delete on public.member_requirement_options from authenticated, anon;
drop policy if exists "dono ou lideranca do clube" on public.member_requirement_options;
create policy "dono ou lideranca do clube" on public.member_requirement_options for select to authenticated
using ((usuario_id = auth.uid() and public.membro_ativo_no_clube(club_id)) or public.pode_gerir_no_clube(club_id));

drop trigger if exists trg_definir_escopo on public.member_requirement_options;
create trigger trg_definir_escopo before insert on public.member_requirement_options
for each row execute function public.definir_escopo_progresso('member_requirement_id', 'member_requirements');

-- ---------------------------------------------------------------------
-- B) estado da escolha + bloqueios (uma fonte só, usada por enviar/avaliar/explicar/minha_classe)
-- ---------------------------------------------------------------------
-- Pra um member_requirement com grupo N-de-M: o que foi escolhido, o que o histórico já cumpre, o que
-- viola sem_repeticao e quantas opções válidas há. Nulo quando o requisito não tem grupo.
create or replace function public._requisito_escolha_estado(p_member_requirement_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_mr record; v_mc record; v_g record; v_total int; v_escolhidas jsonb; v_auto uuid[]; v_viol jsonb; v_validas int;
begin
  select * into v_mr from public.member_requirements where id = p_member_requirement_id;
  if not found then return null; end if;
  select * into v_g from public.requirement_option_groups where alvo_tipo = 'class_requirement' and alvo_id = v_mr.requirement_id;
  if not found then return null; end if;
  select * into v_mc from public.member_classes where id = v_mr.member_class_id;
  select count(*) into v_total from public.requirement_options where grupo_id = v_g.id;

  -- opções cumpridas pelo histórico portátil: qualquer conquista ativa; com sem_repeticao, só as
  -- conquistadas DEPOIS de começar esta classe (antes = "realizada anteriormente", não vale)
  select coalesce(array_agg(o.id), '{}') into v_auto
  from public.requirement_options o
  where o.grupo_id = v_g.id and o.specialty_id is not null and exists (
    select 1 from public.curriculum_achievements a
    where a.usuario_id = v_mr.usuario_id and a.tipo = 'especialidade' and a.specialty_id = o.specialty_id and a.status = 'ativa'
      and (not v_g.sem_repeticao or a.concluida_em >= v_mc.iniciada_em));

  -- escolhas registradas; com sem_repeticao, uma escolha ligada a especialidade já tida ANTES da classe viola
  select coalesce(jsonb_agg(jsonb_build_object('option_id', mo.option_id, 'rotulo', coalesce(o.rotulo, mo.rotulo_livre), 'rotulo_livre', mo.rotulo_livre,
           'ja_realizada_antes', (v_g.sem_repeticao and o.specialty_id is not null and exists (
              select 1 from public.curriculum_achievements a
              where a.usuario_id = v_mr.usuario_id and a.tipo = 'especialidade' and a.specialty_id = o.specialty_id and a.status = 'ativa' and a.concluida_em < v_mc.iniciada_em)))
           order by o.ordem nulls last, mo.created_at), '[]'::jsonb) into v_escolhidas
  from public.member_requirement_options mo
  left join public.requirement_options o on o.id = mo.option_id
  where mo.member_requirement_id = p_member_requirement_id;

  select coalesce(jsonb_agg(e -> 'rotulo'), '[]'::jsonb) into v_viol from jsonb_array_elements(v_escolhidas) e where (e ->> 'ja_realizada_antes')::boolean;

  -- válidas = escolhas registradas que não violam ∪ opções cumpridas pelo histórico (sem contar 2x)
  select count(*) into v_validas from (
    select e ->> 'option_id' as k from jsonb_array_elements(v_escolhidas) e where not (e ->> 'ja_realizada_antes')::boolean and e ->> 'option_id' is not null
    union
    select 'livre:' || (e ->> 'rotulo_livre') from jsonb_array_elements(v_escolhidas) e where e ->> 'rotulo_livre' is not null
    union
    select a::text from unnest(v_auto) a
  ) x;

  return jsonb_build_object(
    'grupo_id', v_g.id, 'n_minimo', v_g.n_minimo, 'sem_repeticao', v_g.sem_repeticao, 'pool_sem_repeticao', v_g.pool_sem_repeticao,
    'total_opcoes', v_total, 'aceita_texto_livre', v_total = 0,
    'escolhidas', v_escolhidas, 'satisfeitas_automaticamente', coalesce(array_length(v_auto, 1), 0), 'opcoes_automaticas', to_jsonb(v_auto),
    'violacoes_sem_repeticao', v_viol, 'validas', v_validas, 'satisfeito', v_validas >= v_g.n_minimo
  );
end;
$$;
revoke all on function public._requisito_escolha_estado(uuid) from public, anon, authenticated;

create or replace function public._requisito_bloqueios(p_member_requirement_id uuid) returns text[]
language plpgsql stable security definer set search_path = '' as $$
declare v_mr record; v_req record; v_out text[] := '{}'; v_dep text[]; v_cont jsonb; v_nome text; v_esc jsonb;
begin
  select * into v_mr from public.member_requirements where id = p_member_requirement_id;
  if not found then return v_out; end if;
  select * into v_req from public.class_requirements where id = v_mr.requirement_id;

  v_dep := public.dependencias_pendentes('class_requirement', v_mr.requirement_id, v_mr.usuario_id, v_mr.club_id);
  if coalesce(array_length(v_dep, 1), 0) > 0 then
    v_out := array_append(v_out, 'Falta concluir antes: ' || array_to_string(v_dep, ', ') || '.');
  end if;

  if v_req.conteudo_dinamico_definicao_id is not null then
    select public.conteudo_dinamico_resolver(d.chave, current_date), d.nome into v_cont, v_nome
      from public.dynamic_content_definitions d where d.id = v_req.conteudo_dinamico_definicao_id;
    if v_cont is null or v_cont ->> 'valor' is null then
      v_out := array_append(v_out, 'O conteúdo oficial deste período (' || coalesce(v_nome, 'conteúdo do ano') || ') ainda não está disponível.');
    end if;
  end if;

  v_esc := public._requisito_escolha_estado(p_member_requirement_id);
  if v_esc is not null then
    if jsonb_array_length(v_esc -> 'violacoes_sem_repeticao') > 0 then
      v_out := array_append(v_out, 'Não vale repetir especialidade já realizada antes desta classe: '
        || (select string_agg(x #>> '{}', ', ') from jsonb_array_elements(v_esc -> 'violacoes_sem_repeticao') x) || '.');
    end if;
    if not (v_esc ->> 'satisfeito')::boolean then
      v_out := array_append(v_out, format('Escolha pelo menos %s %s (%s de %s até agora).',
        v_esc ->> 'n_minimo',
        case when (v_esc ->> 'total_opcoes')::int > 0 then 'das ' || (v_esc ->> 'total_opcoes') || ' opções' else 'e informe qual foi' end,
        v_esc ->> 'validas', v_esc ->> 'n_minimo'));
    end if;
  end if;
  return v_out;
end;
$$;
revoke all on function public._requisito_bloqueios(uuid) from public, anon, authenticated;

-- registra a escolha (substitui o conjunto atual). Só o próprio, no clube em uso, enquanto o requisito é editável.
create or replace function public.requisito_escolher(p_requirement_id uuid, p_option_ids uuid[] default '{}', p_rotulos_livres text[] default '{}') returns json
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_club uuid := public.clube_atual_id(); v_mr record; v_g record; v_total int; v_id uuid; v_txt text;
begin
  if v_uid is null or v_club is null then raise exception 'Sem clube em uso.'; end if;
  perform public._exigir_classes_habilitado(v_club);
  select * into v_mr from public.member_requirements where requirement_id = p_requirement_id and usuario_id = v_uid and club_id = v_club for update;
  if not found then raise exception 'Requisito não encontrado para você neste clube.'; end if;
  if v_mr.status not in ('nao_iniciado', 'em_andamento', 'correcao_solicitada') then raise exception 'Este requisito não pode mais ser alterado.'; end if;
  select * into v_g from public.requirement_option_groups where alvo_tipo = 'class_requirement' and alvo_id = p_requirement_id;
  if not found then raise exception 'Este requisito não tem opções pra escolher.'; end if;
  select count(*) into v_total from public.requirement_options where grupo_id = v_g.id;
  if v_total > 0 and coalesce(array_length(p_rotulos_livres, 1), 0) > 0 then raise exception 'Este requisito tem opções definidas — escolha entre elas.'; end if;
  if v_total = 0 and coalesce(array_length(p_option_ids, 1), 0) > 0 then raise exception 'Este requisito não tem lista de opções — informe qual foi.'; end if;

  delete from public.member_requirement_options where member_requirement_id = v_mr.id;
  foreach v_id in array coalesce(p_option_ids, '{}') loop
    if not exists (select 1 from public.requirement_options where id = v_id and grupo_id = v_g.id) then raise exception 'Opção inválida para este requisito.'; end if;
    insert into public.member_requirement_options (member_requirement_id, option_id) values (v_mr.id, v_id) on conflict do nothing;
  end loop;
  foreach v_txt in array coalesce(p_rotulos_livres, '{}') loop
    if length(trim(v_txt)) = 0 then continue; end if;
    insert into public.member_requirement_options (member_requirement_id, rotulo_livre) values (v_mr.id, trim(v_txt)) on conflict do nothing;
  end loop;
  update public.member_requirements set status = case when status = 'nao_iniciado' then 'em_andamento' else status end, updated_at = now() where id = v_mr.id;
  return json_build_object('ok', true, 'escolha', public._requisito_escolha_estado(v_mr.id));
end;
$$;
revoke all on function public.requisito_escolher(uuid, uuid[], text[]) from public, anon;
grant execute on function public.requisito_escolher(uuid, uuid[], text[]) to authenticated;

-- ---------------------------------------------------------------------
-- C) enviar/avaliar respeitam os bloqueios; explicação/minha_classe/fila expõem
-- ---------------------------------------------------------------------
create or replace function public.requisito_enviar(p_requirement_id uuid) returns json
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_club uuid := public.clube_atual_id(); v_mr record; v_req record; v_bloq text[];
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
  v_bloq := public._requisito_bloqueios(v_mr.id);
  if array_length(v_bloq, 1) > 0 then raise exception 'Requisito bloqueado: %', array_to_string(v_bloq, ' '); end if;
  update public.member_requirements set status = 'aguardando_avaliacao', enviado_em = now(), updated_at = now() where id = v_mr.id;
  return json_build_object('ok', true);
end;
$$;

create or replace function public.requisito_avaliar(p_member_requirement_id uuid, p_decisao text, p_comentario text default null) returns json
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_club uuid := public.clube_atual_id(); v_mr record; v_papel text; v_bloq text[];
begin
  if p_decisao not in ('aprovado', 'correcao_solicitada') then raise exception 'Decisão inválida.'; end if;
  if v_uid is null or v_club is null or not public.pode_gerir_no_clube(v_club) then
    raise exception 'Sem permissão (apenas diretoria/instrutor deste clube).';
  end if;
  perform public._exigir_classes_habilitado(v_club);
  select * into v_mr from public.member_requirements where id = p_member_requirement_id and club_id = v_club for update;
  if not found then raise exception 'Requisito não encontrado neste clube.'; end if;

  -- aprovar NÃO contorna regra curricular: a mesma lista que bloqueia o envio bloqueia a aprovação
  if p_decisao = 'aprovado' then
    v_bloq := public._requisito_bloqueios(v_mr.id);
    if array_length(v_bloq, 1) > 0 then raise exception 'Requisito bloqueado: %', array_to_string(v_bloq, ' '); end if;
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

create or replace function public.explicar_requisito_classe(p_member_requirement_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_mr record; v_req record; v_regras jsonb := '[]'::jsonb; v_resultado text; v_bloq text[];
  v_dep_pendentes text[]; v_esc jsonb; v_conteudo jsonb;
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

  if v_req.conteudo_dinamico_definicao_id is not null then
    select public.conteudo_dinamico_resolver(chave, current_date) into v_conteudo
      from public.dynamic_content_definitions where id = v_req.conteudo_dinamico_definicao_id;
    v_regras := v_regras || jsonb_build_object(
      'regra', 'conteudo_dinamico', 'satisfeito', (v_conteudo is not null and v_conteudo ->> 'valor' is not null),
      'origem', 'dynamic_content_definitions + dynamic_content_values', 'detalhe', coalesce(v_conteudo, 'null'::jsonb)
    );
  end if;

  v_esc := public._requisito_escolha_estado(p_member_requirement_id);
  if v_esc is not null then
    v_regras := v_regras || jsonb_build_object(
      'regra', 'escolha_n_de_m', 'satisfeito', ((v_esc ->> 'satisfeito')::boolean or v_mr.status = 'aprovado'),
      'origem', 'requirement_option_groups + requirement_options + member_requirement_options', 'detalhe', v_esc
    );
  end if;

  v_bloq := public._requisito_bloqueios(p_member_requirement_id);
  if v_mr.status = 'aprovado' then v_resultado := 'satisfeito';
  elsif coalesce(array_length(v_bloq, 1), 0) > 0 then v_resultado := 'bloqueado';
  else v_resultado := 'pendente';
  end if;

  return jsonb_build_object(
    'requisito', jsonb_build_object('tipo', 'class_requirement', 'id', v_mr.requirement_id, 'status_operacional', v_mr.status),
    'resultado', v_resultado, 'bloqueios', to_jsonb(coalesce(v_bloq, '{}'::text[])), 'regras_aplicadas', v_regras
  );
end;
$$;

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
    'classe', (select json_build_object('id', c.id, 'codigo', c.codigo, 'nome', c.nome, 'faixa_etaria', c.faixa_etaria,
                                        'idade_minima', c.idade_minima, 'manifesto_id', c.manifesto_id, 'vigente_desde', c.vigente_desde,
                                        'fonte_url', c.fonte_url, 'fonte_publicado_em', c.fonte_publicado_em)
               from public.classes c where c.id = v_mc.class_id),
    'curriculum_version', (
      select json_build_object('id', ver.id, 'origem', ver.origem, 'identificador', ver.identificador, 'versao', ver.versao,
               'status', ver.status, 'fonte_url', ver.fonte_url, 'fonte_descricao', ver.fonte_descricao,
               'vigente_desde', ver.vigente_desde, 'fonte_hash', ver.fonte_hash, 'importado_em', ver.importado_em)
      from public.classes c join public.curriculum_versions ver on ver.id = c.curriculum_version_id where c.id = v_mc.class_id
    ),
    'investidura', (
      select json_build_object('status', ir.status, 'solicitado_em', ir.solicitado_em, 'revisado_em', ir.revisado_em, 'comentario', ir.comentario)
      from public.investiture_reviews ir where ir.member_class_id = v_mc.id
    ),
    'secoes', (
      select coalesce(json_agg(json_build_object(
        'id', s.id, 'codigo', s.codigo, 'nome', s.nome, 'ordem', s.ordem,
        'requisitos', (
          select coalesce(json_agg(json_build_object(
            'id', r.id, 'codigo', r.codigo, 'descricao', r.descricao, 'manifesto_id', r.manifesto_id, 'status_fonte', r.status_fonte,
            'tipo_evidencia', r.tipo_evidencia, 'evidencia_obrigatoria', r.evidencia_obrigatoria,
            'member_requirement_id', mr.id, 'status', coalesce(mr.status, 'nao_iniciado'),
            'evidencia_texto', mr.evidencia_texto, 'evidencia_path', mr.evidencia_path, 'enviado_em', mr.enviado_em,
            'conteudo_dinamico', (select public.conteudo_dinamico_resolver(d.chave, current_date)
                                  from public.dynamic_content_definitions d where d.id = r.conteudo_dinamico_definicao_id),
            -- regra N-de-M + o estado da escolha desta pessoa (escolhidas, cumpridas pelo histórico, violações)
            'escolha', (
              select (public._requisito_escolha_estado(mr.id) || jsonb_build_object(
                'opcoes', (select coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'rotulo', o.rotulo, 'specialty_id', o.specialty_id) order by o.ordem), '[]'::jsonb)
                           from public.requirement_options o where o.grupo_id = g.id)))::json
              from public.requirement_option_groups g where g.alvo_tipo = 'class_requirement' and g.alvo_id = r.id and mr.id is not null
            ),
            -- por que NÃO dá pra enviar/aprovar agora (vazio = livre) — a mesma lista que o servidor usa pra recusar
            'bloqueios', case when mr.id is null then '[]'::json else to_json(public._requisito_bloqueios(mr.id)) end,
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

create or replace function public.classe_avaliacoes_pendentes() returns json
language sql stable security definer set search_path = '' as $$
  select coalesce(json_agg(json_build_object(
    'member_requirement_id', mr.id,
    'usuario_id', p.id, 'usuario_nome', p.nome, 'usuario_foto', p.foto,
    'classe_nome', c.nome, 'secao_nome', s.nome,
    'requisito_id', r.id, 'requisito_codigo', r.codigo, 'requisito_descricao', r.descricao,
    'tipo_evidencia', r.tipo_evidencia, 'evidencia_texto', mr.evidencia_texto, 'evidencia_path', mr.evidencia_path,
    'enviado_em', mr.enviado_em,
    'escolha', public._requisito_escolha_estado(mr.id),
    'conteudo_dinamico', (select public.conteudo_dinamico_resolver(d.chave, current_date) from public.dynamic_content_definitions d where d.id = r.conteudo_dinamico_definicao_id),
    'bloqueios', to_json(public._requisito_bloqueios(mr.id))
  ) order by mr.enviado_em), '[]'::json)
  from public.member_requirements mr
  join public.class_requirements r on r.id = mr.requirement_id
  join public.class_sections s on s.id = r.section_id
  join public.classes c on c.id = s.class_id
  join public.profiles p on p.id = mr.usuario_id
  where mr.club_id = public.clube_atual_id() and mr.status = 'aguardando_avaliacao'
    and public.pode_gerir_no_clube(public.clube_atual_id());
$$;

notify pgrst, 'reload schema';

insert into public.migracoes_aplicadas (arquivo)
values ('2026-09-21-regras-bloqueiam-envio-e-aprovacao.sql')
on conflict (arquivo) do update set aplicada_em = now();
