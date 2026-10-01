-- 521 — Registrar CLASSE JÁ CONCLUÍDA (histórico anterior ao app). Aditiva; não mexe em migrations <= 519.
--
-- Problema: pessoas que concluíram uma Classe ANTES do app não podem ser obrigadas a "iniciar" a classe e ter
-- requisitos aprovados artificialmente. Mas o histórico real precisa existir para (a) não oferecer/reabrir a classe,
-- (b) liberar a Classe Avançada correspondente, (c) preservar quem registrou, quando e por quê.
--
-- Decisões (todas auditáveis):
--  * O registro é uma linha em curriculum_achievements (a "conquista portátil", fonte única de "concluída") com
--    origem='registro_anterior'. NÃO cria member_classes, member_requirements, requirement_approvals, snapshot,
--    documento, investidura nem evento: nada de aprovação falsa. Documento/PDF/investidura só nascem pelo fluxo real.
--  * Capacidade: pode_avaliar_curriculo (diretoria | instrutor) NO CLUBE ATUAL — a mesma de classe_atribuir e de
--    avaliar requisitos: reconhecer conclusão de classe é ato curricular, não administrativo (pode_administrar_clube,
--    só diretoria, é aprovar membros/equipe/plano). Nenhum papel novo. Conselheiro/tesoureiro/pais/desbravador não.
--    Ninguém registra para si mesmo (separação de funções): peça a outra pessoa da liderança.
--  * Idade/nascimento NÃO são pré-requisito: é histórico real (a pessoa pode ter concluído há anos, ser adulta, ou
--    não ter informado nascimento). A regra de idade vale para MATRICULAR, não para reconhecer o que já aconteceu.
--    Se o nascimento é conhecido, a data informada não pode ser anterior a ele.
--  * Data: concluida_em é NOT NULL. Com data conhecida guardamos o dia ao meio-dia de São Paulo. Com data
--    DESCONHECIDA (data_desconhecida=true) guardamos o instante do registro só para satisfazer o NOT NULL/ordenação, e
--    TODAS as leituras devolvem concluida_em = null nesse caso: a data do registro nunca é apresentada como a
--    conclusão real (existe registrado_em para isso).
--  * Duplicata: conclusão ativa da mesma classe (por código oficial, em QUALQUER clube) recusa o registro; matrícula
--    não cancelada da mesma classe neste clube recusa (finalize ou cancele antes).
--  * Revogar: SÓ registro_anterior, soft (status 'revogada'; nunca DELETE), mesmo clube e capacidade. Conclusão real do
--    app continua revogável apenas pelo fluxo de selo/investidura (e curriculum_achievement_revogar agora recusa
--    registro_anterior, para não revogar sem log).
--  * Log append-only class_prior_completion_log (ator, papel, clube, membro, classe, ação, motivo, antes/depois).
--  * Índice único: passa a ignorar registro_anterior REVOGADO (permite registrar de novo depois de revogar sem
--    apagar nada; e uma conclusão real posterior no mesmo clube não é engolida pelo ON CONFLICT DO NOTHING).
--  * Comprovante opcional (foto do cartão/certificado): bucket privado 'comprovacoes' (já valida tamanho/mime: só
--    imagem/vídeo), pasta <club>/<membro>/conclusao-anterior/<uuid>.<ext>. Policies novas e aditivas; sem outro clube,
--    sem administrador geral da plataforma.

-- ------------------------------------------------------------------------------------------------
-- 1) colunas novas em curriculum_achievements
-- ------------------------------------------------------------------------------------------------
alter table public.curriculum_achievements
  add column if not exists origem text not null default 'conclusao_no_app',
  add column if not exists registrado_por uuid references public.profiles(id) on delete set null,
  add column if not exists registrado_papel text,
  add column if not exists registrado_em timestamptz,
  add column if not exists registrado_no_club_id uuid references public.organizational_units(id),
  add column if not exists data_desconhecida boolean not null default false,
  add column if not exists observacao text,
  add column if not exists comprovante_path text;

alter table public.curriculum_achievements drop constraint if exists curriculum_achievements_origem_check;
alter table public.curriculum_achievements add constraint curriculum_achievements_origem_check
  check (origem in ('conclusao_no_app', 'registro_anterior'));

alter table public.curriculum_achievements drop constraint if exists curriculum_achievements_registro_coerente;
alter table public.curriculum_achievements add constraint curriculum_achievements_registro_coerente check (
  (origem = 'conclusao_no_app' and not data_desconhecida and registrado_em is null and comprovante_path is null)
  or (origem = 'registro_anterior' and tipo = 'classe' and member_class_id is null
      and registrado_em is not null and registrado_no_club_id is not null and registrado_papel is not null
      and char_length(btrim(coalesce(observacao, ''))) >= 5)
);

create unique index if not exists ux_curriculum_achievements_comprovante
  on public.curriculum_achievements (comprovante_path) where comprovante_path is not null;

-- índice único por pessoa+classe+clube: ignora registro_anterior REVOGADO (o histórico fica, a vaga reabre)
drop index if exists public.ux_curriculum_achievements_classe;
create unique index ux_curriculum_achievements_classe
  on public.curriculum_achievements (usuario_id, classe_id, club_id_origem)
  where tipo = 'classe' and not (origem = 'registro_anterior' and status = 'revogada');

-- o gatilho do motor (versão da 044) infere o índice pelo predicado: mesmo corpo, predicado novo
create or replace function public.registrar_conquista_curricular() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_argv[0] = 'member_classes' then
    if new.status = 'investida' and (old.status is null or old.status is distinct from 'investida') then
      insert into public.curriculum_achievements (usuario_id, tipo, classe_id, club_id_origem, member_class_id, concluida_em)
      values (new.usuario_id, 'classe', new.class_id, new.club_id, new.id, coalesce(new.investida_em, now()))
      on conflict (usuario_id, classe_id, club_id_origem) where tipo = 'classe' and not (origem = 'registro_anterior' and status = 'revogada') do nothing;
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

-- registro_anterior: depois de gravado só muda a revogação; ninguém troca a origem de nenhuma conquista
create or replace function public._proteger_registro_anterior() returns trigger
language plpgsql security definer set search_path = '' as $$
declare k text; v_old jsonb := to_jsonb(old); v_new jsonb := to_jsonb(new);
begin
  if new.origem is distinct from old.origem then
    raise exception 'A origem de uma conquista curricular não pode ser alterada.';
  end if;
  if old.origem = 'registro_anterior' then
    for k in select jsonb_object_keys(v_new) loop
      if v_new -> k is distinct from v_old -> k and k not in ('status', 'revogada_em', 'revogada_por', 'revogada_motivo') then
        raise exception 'Registro de classe concluída anteriormente é imutável: a coluna "%" não pode ser alterada (revogue com auditoria).', k;
      end if;
    end loop;
  end if;
  return new;
end;
$$;
revoke all on function public._proteger_registro_anterior() from public, anon, authenticated;
drop trigger if exists trg_proteger_registro_anterior on public.curriculum_achievements;
create trigger trg_proteger_registro_anterior before update on public.curriculum_achievements
  for each row execute function public._proteger_registro_anterior();

-- a revogação genérica não revoga registro_anterior (precisa do log e do motivo): corpo da 064 + a recusa
create or replace function public.curriculum_achievement_revogar(p_id uuid, p_motivo text default null)
returns json
language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := auth.uid(); v_ca record;
begin
  select * into v_ca from public.curriculum_achievements where id = p_id for update;
  if not found
     or v_ca.club_id_origem is distinct from public.clube_atual_id()
     or not public.pode_gerir_no_clube(v_ca.club_id_origem) then
    raise exception 'Conquista curricular não encontrada ou sem permissão (só a liderança do clube que emitiu, operando nele, pode revogar).';
  end if;
  if v_ca.origem = 'registro_anterior' then
    raise exception 'Esta conquista foi registrada como concluída anteriormente: revogue pela opção própria (classe_concluida_anteriormente_revogar), com motivo.';
  end if;
  if v_ca.status = 'revogada' then raise exception 'Esta conquista já está revogada.'; end if;
  update public.curriculum_achievements
     set status = 'revogada', revogada_em = now(), revogada_por = v_uid, revogada_motivo = p_motivo
   where id = p_id;
  return json_build_object('ok', true);
end $$;

-- ------------------------------------------------------------------------------------------------
-- 2) log append-only
-- ------------------------------------------------------------------------------------------------
create table if not exists public.class_prior_completion_log (
  id uuid primary key default gen_random_uuid(),
  achievement_id uuid,                       -- sem FK de propósito: o log sobrevive à conta/ao registro
  club_id uuid not null references public.organizational_units(id),   -- clube onde o ato foi feito (o expurgo do clube apaga o log dele, como dos demais registros imutáveis)
  ator_id uuid,                              -- quem registrou/revogou (sem FK: sobrevive à conta)
  ator_papel text not null,
  usuario_id uuid not null,                  -- o membro
  class_id uuid not null,
  acao text not null check (acao in ('registrar', 'revogar')),
  motivo text not null,
  antes jsonb,
  depois jsonb,
  em timestamptz not null default now()
);
create index if not exists class_prior_completion_log_achievement_idx on public.class_prior_completion_log (achievement_id, em);
create index if not exists class_prior_completion_log_club_idx on public.class_prior_completion_log (club_id, em desc);
alter table public.class_prior_completion_log enable row level security;
revoke all on public.class_prior_completion_log from public, anon, authenticated;   -- leitura só pelas RPCs

drop trigger if exists trg_imutavel on public.class_prior_completion_log;
create trigger trg_imutavel before update or delete on public.class_prior_completion_log
  for each row execute function public._proteger_registro_imutavel();

create or replace function public._class_prior_log_sem_truncate() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  raise exception 'class_prior_completion_log é imutável: não pode ser esvaziado.';
end;
$$;
revoke all on function public._class_prior_log_sem_truncate() from public, anon, authenticated;
drop trigger if exists trg_sem_truncate on public.class_prior_completion_log;
create trigger trg_sem_truncate before truncate on public.class_prior_completion_log
  for each statement execute function public._class_prior_log_sem_truncate();

-- ------------------------------------------------------------------------------------------------
-- 3) comprovante: caminho esperado + policies do Storage (bucket 'comprovacoes', pasta conclusao-anterior)
-- ------------------------------------------------------------------------------------------------
-- caminho válido: <club>/<membro>/conclusao-anterior/<uuid>.<jpg|jpeg|png|webp|heic|heif>
create or replace function public._conclusao_anterior_caminho_ok(p_club uuid, p_membro uuid, p_path text)
returns boolean language sql immutable set search_path = '' as $$
  select p_club is not null and p_membro is not null and p_path is not null
     and p_path ~* ('^' || p_club::text || '/' || p_membro::text || '/conclusao-anterior/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|jpeg|png|webp|heic|heif)$');
$$;
revoke all on function public._conclusao_anterior_caminho_ok(uuid, uuid, text) from public, anon, authenticated;

-- pasta da conclusão anterior: <club>/<membro>/conclusao-anterior/ (qualquer arquivo)
create or replace function public._conclusao_anterior_pasta(p_objeto text) returns uuid[]
language sql immutable set search_path = '' as $$
  select case
    when p_objeto ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/conclusao-anterior/[^/]+$'
    then array[split_part(p_objeto, '/', 1)::uuid, split_part(p_objeto, '/', 2)::uuid]
  end;
$$;
revoke all on function public._conclusao_anterior_pasta(text) from public, anon, authenticated;

-- ENVIAR: liderança que avalia currículo, no clube em uso, para a pasta de um membro DESTE clube (nunca responsável)
create or replace function public.pode_enviar_conclusao_anterior(p_objeto text)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((
    select (p[1] = public.clube_atual_id())
       and public.pode_avaliar_curriculo(p[1])
       and public._conclusao_anterior_caminho_ok(p[1], p[2], p_objeto)
       and exists (select 1 from public.organization_memberships m
                    where m.user_id = p[2] and m.organizational_unit_id = p[1] and m.role <> 'pais' and m.status = 'ativo'
                      and m.starts_at <= now() and (m.ends_at is null or m.ends_at > now()))
    from (select public._conclusao_anterior_pasta(p_objeto) as p) x
  ), false);
$$;
revoke all on function public.pode_enviar_conclusao_anterior(text) from public, anon;
grant execute on function public.pode_enviar_conclusao_anterior(text) to authenticated;

-- LER: liderança que avalia currículo, no clube em uso, da pasta DO PRÓPRIO clube. (O dono já lê a própria pasta pela
-- policy "comprovacao dono ou lideranca le": formato <club>/<usuario>/..., no clube em uso.)
create or replace function public.pode_ver_conclusao_anterior(p_objeto text)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((
    select p[1] = public.clube_atual_id() and public.pode_avaliar_curriculo(p[1])
    from (select public._conclusao_anterior_pasta(p_objeto) as p) x
  ), false);
$$;
revoke all on function public.pode_ver_conclusao_anterior(text) from public, anon;
grant execute on function public.pode_ver_conclusao_anterior(text) to authenticated;

-- APAGAR: só a liderança do clube e só arquivo que NENHUMA conquista (nem revogada) referencia — evidência registrada fica
create or replace function public.pode_apagar_conclusao_anterior(p_objeto text)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.pode_ver_conclusao_anterior(p_objeto)
     and not exists (select 1 from public.curriculum_achievements a where a.comprovante_path = p_objeto);
$$;
revoke all on function public.pode_apagar_conclusao_anterior(text) from public, anon;
grant execute on function public.pode_apagar_conclusao_anterior(text) to authenticated;

drop policy if exists "conclusao anterior: lideranca envia" on storage.objects;
create policy "conclusao anterior: lideranca envia" on storage.objects for insert to authenticated
  with check (bucket_id = 'comprovacoes' and public.pode_enviar_conclusao_anterior(name));
drop policy if exists "conclusao anterior: lideranca le" on storage.objects;
create policy "conclusao anterior: lideranca le" on storage.objects for select to authenticated
  using (bucket_id = 'comprovacoes' and public.pode_ver_conclusao_anterior(name));
drop policy if exists "conclusao anterior: lideranca apaga sem uso" on storage.objects;
create policy "conclusao anterior: lideranca apaga sem uso" on storage.objects for delete to authenticated
  using (bucket_id = 'comprovacoes' and public.pode_apagar_conclusao_anterior(name));

-- ------------------------------------------------------------------------------------------------
-- 4) classe_concluida_anteriormente_registrar
-- ------------------------------------------------------------------------------------------------
create or replace function public.classe_concluida_anteriormente_registrar(
  p_usuario_id uuid, p_class_id uuid, p_concluida_em date default null, p_data_desconhecida boolean default false,
  p_observacao text default null, p_comprovante_path text default null
) returns json
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid(); v_club uuid := public.clube_atual_id();
  v_papel text; v_cls record; v_obs text := btrim(coalesce(p_observacao, ''));
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_nasc date; v_ts timestamptz; v_origem uuid; v_ach uuid; v_desc boolean := coalesce(p_data_desconhecida, false);
  v_path text := nullif(btrim(coalesce(p_comprovante_path, '')), '');
begin
  if v_uid is null or v_club is null or not public.pode_avaliar_curriculo(v_club) then
    raise exception 'Sem permissão (apenas diretoria/instrutor deste clube).';
  end if;
  perform public._exigir_classes_habilitado(v_club);
  if p_usuario_id is null or p_class_id is null then raise exception 'Informe a pessoa e a classe.'; end if;
  if p_usuario_id = v_uid then
    raise exception 'Peça a outra pessoa da liderança para registrar a sua classe já concluída.';
  end if;
  if not exists (
    select 1 from public.organization_memberships m
    where m.user_id = p_usuario_id and m.organizational_unit_id = v_club and m.role <> 'pais' and m.status = 'ativo'
      and m.starts_at <= now() and (m.ends_at is null or m.ends_at > now())
  ) then
    raise exception 'Pessoa sem vínculo ativo neste clube.';
  end if;
  select c.id, c.codigo, c.nome into v_cls
    from public.classes c join public.curriculum_versions v on v.id = c.curriculum_version_id
   where c.id = p_class_id and c.ativo and v.origem = 'oficial' and public._classe_no_fluxo_normal(c.id);
  if not found then raise exception 'Classe não encontrada.'; end if;

  if char_length(v_obs) < 5 then raise exception 'Informe a observação (de onde vem esta informação), com pelo menos 5 letras.'; end if;
  if char_length(v_obs) > 500 then raise exception 'A observação pode ter no máximo 500 caracteres.'; end if;

  if v_desc then
    if p_concluida_em is not null then raise exception 'Se a data é desconhecida, não informe a data.'; end if;
    v_ts := now();          -- só para o NOT NULL/ordenação; as leituras devolvem null (data_desconhecida)
  else
    if p_concluida_em is null then raise exception 'Informe a data da conclusão ou marque "não sei a data".'; end if;
    if p_concluida_em > v_hoje then raise exception 'A data da conclusão não pode ser no futuro.'; end if;
    if p_concluida_em < date '1950-01-01' then raise exception 'Data da conclusão inválida.'; end if;
    select p.nascimento into v_nasc from public.profiles p where p.id = p_usuario_id;
    if v_nasc is not null and p_concluida_em < v_nasc then raise exception 'A data da conclusão não pode ser anterior ao nascimento.'; end if;
    v_ts := ((p_concluida_em::timestamp + time '12:00') at time zone 'America/Sao_Paulo');
  end if;

  perform pg_advisory_xact_lock(hashtextextended('classe-concluida-anteriormente:' || p_usuario_id::text || ':' || v_cls.codigo, 0));

  v_origem := public._classe_conclusao_ativa_clube(p_usuario_id, p_class_id);
  if v_origem is not null then
    raise exception 'Esta classe já consta como concluída por esta pessoa%.', case when v_origem = v_club then ' neste clube' else ' em outro clube' end;
  end if;
  if exists (
    select 1 from public.member_classes mc join public.classes c2 on c2.id = mc.class_id
     where mc.usuario_id = p_usuario_id and mc.club_id = v_club and mc.status <> 'cancelada'
       and (mc.class_id = p_class_id or c2.codigo = v_cls.codigo)
  ) then
    raise exception 'Esta pessoa já tem matrícula desta classe neste clube: finalize ou cancele a matrícula antes de registrar como concluída anteriormente.';
  end if;

  if v_path is not null then
    if not public._conclusao_anterior_caminho_ok(v_club, p_usuario_id, v_path) then
      raise exception 'Comprovante inválido: envie a foto pelo próprio registro de classe concluída anteriormente.';
    end if;
    if not exists (select 1 from storage.objects o where o.bucket_id = 'comprovacoes' and o.name = v_path) then
      raise exception 'Comprovante não encontrado: envie a foto novamente.';
    end if;
    if exists (select 1 from public.curriculum_achievements a where a.comprovante_path = v_path) then
      raise exception 'Este comprovante já está em outro registro.';
    end if;
  end if;

  select m.role into v_papel from public.organization_memberships m
   where m.user_id = v_uid and m.organizational_unit_id = v_club and m.role in ('diretoria', 'instrutor') and m.status = 'ativo'
     and m.starts_at <= now() and (m.ends_at is null or m.ends_at > now())
   order by (m.role = 'diretoria') desc limit 1;

  insert into public.curriculum_achievements (usuario_id, tipo, classe_id, club_id_origem, concluida_em, origem, registrado_por, registrado_papel,
                                              registrado_em, registrado_no_club_id, data_desconhecida, observacao, comprovante_path)
  values (p_usuario_id, 'classe', p_class_id, v_club, v_ts, 'registro_anterior', v_uid, v_papel, now(), v_club, v_desc, v_obs, v_path)
  returning id into v_ach;

  insert into public.class_prior_completion_log (achievement_id, club_id, ator_id, ator_papel, usuario_id, class_id, acao, motivo, antes, depois)
  values (v_ach, v_club, v_uid, v_papel, p_usuario_id, p_class_id, 'registrar', v_obs, null,
          jsonb_build_object('status', 'ativa', 'data_desconhecida', v_desc, 'concluida_em', case when v_desc then null else p_concluida_em end,
                             'comprovante', v_path is not null));

  return json_build_object('ok', true, 'achievement_id', v_ach, 'class_id', p_class_id, 'codigo', v_cls.codigo, 'nome', v_cls.nome,
                           'origem', 'registro_anterior', 'concluida_em', case when v_desc then null else p_concluida_em end,
                           'data_desconhecida', v_desc);
exception when unique_violation then
  raise exception 'Esta classe já consta como concluída por esta pessoa neste clube.';
end;
$$;
revoke all on function public.classe_concluida_anteriormente_registrar(uuid, uuid, date, boolean, text, text) from public, anon;
grant execute on function public.classe_concluida_anteriormente_registrar(uuid, uuid, date, boolean, text, text) to authenticated;

-- ------------------------------------------------------------------------------------------------
-- 5) classe_concluida_anteriormente_revogar — soft, só registro_anterior, mesmo clube
-- ------------------------------------------------------------------------------------------------
create or replace function public.classe_concluida_anteriormente_revogar(p_achievement_id uuid, p_motivo text)
returns json
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_club uuid := public.clube_atual_id(); v_a record; v_papel text; v_mot text := btrim(coalesce(p_motivo, ''));
begin
  if v_uid is null or v_club is null or not public.pode_avaliar_curriculo(v_club) then
    raise exception 'Sem permissão (apenas diretoria/instrutor deste clube).';
  end if;
  perform public._exigir_classes_habilitado(v_club);
  if char_length(v_mot) < 5 then raise exception 'Informe o motivo da revogação, com pelo menos 5 letras.'; end if;
  if char_length(v_mot) > 500 then raise exception 'O motivo pode ter no máximo 500 caracteres.'; end if;
  select * into v_a from public.curriculum_achievements where id = p_achievement_id for update;
  -- "não existe" e "é de outro clube" respondem igual (sem oráculo de existência)
  if not found or v_a.tipo <> 'classe' or v_a.club_id_origem is distinct from v_club then
    raise exception 'Registro não encontrado ou sem permissão (só o clube que registrou, operando nele, pode revogar).';
  end if;
  if v_a.origem <> 'registro_anterior' then
    raise exception 'Esta conclusão foi feita no app e não pode ser revogada por aqui.';
  end if;
  if v_a.status = 'revogada' then raise exception 'Este registro já está revogado.'; end if;

  select m.role into v_papel from public.organization_memberships m
   where m.user_id = v_uid and m.organizational_unit_id = v_club and m.role in ('diretoria', 'instrutor') and m.status = 'ativo'
     and m.starts_at <= now() and (m.ends_at is null or m.ends_at > now())
   order by (m.role = 'diretoria') desc limit 1;

  update public.curriculum_achievements
     set status = 'revogada', revogada_em = now(), revogada_por = v_uid, revogada_motivo = v_mot
   where id = v_a.id;

  insert into public.class_prior_completion_log (achievement_id, club_id, ator_id, ator_papel, usuario_id, class_id, acao, motivo, antes, depois)
  values (v_a.id, v_club, v_uid, v_papel, v_a.usuario_id, v_a.classe_id, 'revogar', v_mot,
          jsonb_build_object('status', 'ativa', 'data_desconhecida', v_a.data_desconhecida, 'registrado_em', v_a.registrado_em),
          jsonb_build_object('status', 'revogada'));
  return json_build_object('ok', true, 'achievement_id', v_a.id);
end;
$$;
revoke all on function public.classe_concluida_anteriormente_revogar(uuid, text) from public, anon;
grant execute on function public.classe_concluida_anteriormente_revogar(uuid, text) to authenticated;

-- ------------------------------------------------------------------------------------------------
-- 6) classe_concluidas_do_membro — leitura da liderança (diretoria|instrutor do clube atual; membro do clube)
-- ------------------------------------------------------------------------------------------------
create or replace function public.classe_concluidas_do_membro(p_usuario_id uuid) returns json
language plpgsql stable security definer set search_path = '' as $$
declare v_club uuid := public.clube_atual_id();
begin
  if auth.uid() is null or v_club is null or not public.pode_avaliar_curriculo(v_club) then
    raise exception 'Sem permissão (apenas diretoria/instrutor deste clube).';
  end if;
  if p_usuario_id is null or not exists (
    select 1 from public.organization_memberships m
    where m.user_id = p_usuario_id and m.organizational_unit_id = v_club and m.role <> 'pais' and m.status = 'ativo'
      and m.starts_at <= now() and (m.ends_at is null or m.ends_at > now())
  ) then
    raise exception 'Pessoa sem vínculo ativo neste clube.';
  end if;
  return (
    select coalesce(json_agg(json_build_object(
      'achievement_id', a.id, 'class_id', c.id, 'codigo', c.codigo, 'nome', c.nome, 'avancada', c.tipo_classe = 'avancada',
      'origem', a.origem, 'status', a.status,
      'concluida_em', case when a.data_desconhecida then null else a.concluida_em end,
      'data_desconhecida', a.data_desconhecida,
      'clube_nome', u.nome, 'neste_clube', a.club_id_origem = v_club,
      'registrado_em', a.registrado_em,
      -- detalhes internos só do clube que registrou
      'registrado_por_nome', case when a.registrado_no_club_id = v_club then rp.nome end,
      'registrado_papel', case when a.registrado_no_club_id = v_club then a.registrado_papel end,
      'observacao', case when a.registrado_no_club_id = v_club then a.observacao end,
      'tem_comprovante', a.comprovante_path is not null and a.registrado_no_club_id = v_club,
      'comprovante_path', case when a.registrado_no_club_id = v_club then a.comprovante_path end,
      'revogada_em', case when a.status = 'revogada' and a.club_id_origem = v_club then a.revogada_em end,
      'revogada_motivo', case when a.status = 'revogada' and a.club_id_origem = v_club then a.revogada_motivo end,
      'pode_revogar', a.origem = 'registro_anterior' and a.status = 'ativa' and a.registrado_no_club_id = v_club
    ) order by a.status, a.concluida_em desc), '[]'::json)
    from public.curriculum_achievements a
    join public.classes c on c.id = a.classe_id
    join public.organizational_units u on u.id = a.club_id_origem
    left join public.profiles rp on rp.id = a.registrado_por
    where a.usuario_id = p_usuario_id and a.tipo = 'classe'
      -- conquistas de OUTROS clubes só entram se ativas (o que foi revogado lá é assunto de lá)
      and (a.club_id_origem = v_club or a.status = 'ativa')
  );
end;
$$;
revoke all on function public.classe_concluidas_do_membro(uuid) from public, anon;
grant execute on function public.classe_concluidas_do_membro(uuid) to authenticated;

-- ------------------------------------------------------------------------------------------------
-- 7) classes_concluidas_anteriormente (519): inclui os registros DESTE clube; data desconhecida nunca vira data
--    Itens 'outro_clube' mantêm EXATAMENTE as 7 chaves da 519. Itens 'registro_anterior_neste_clube' trazem
--    também registrada_em e data_desconhecida.
-- ------------------------------------------------------------------------------------------------
create or replace function public.classes_concluidas_anteriormente() returns json
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_club uuid := public.clube_atual_id();
begin
  if v_uid is null or v_club is null or not public.membro_ativo_no_clube(v_club)
     or not public.recurso_habilitado_no_clube(v_club, 'classes') then
    return '[]'::json;
  end if;
  return (
    select coalesce(json_agg(x.j order by x.ordem desc), '[]'::json) from (
      select t.ordem, case when t.neste_clube then
        json_build_object(
          'class_id', t.class_id, 'codigo', t.codigo, 'nome', t.nome, 'avancada', t.avancada,
          'concluida_em', case when t.data_desconhecida then null else t.concluida_em end,
          'origem_clube_nome', t.clube_nome, 'origem', 'registro_anterior_neste_clube',
          'registrada_em', t.registrado_em, 'data_desconhecida', t.data_desconhecida)
      else
        json_build_object(
          'class_id', t.class_id, 'codigo', t.codigo, 'nome', t.nome, 'avancada', t.avancada,
          'concluida_em', case when t.data_desconhecida then null else t.concluida_em end,
          'origem_clube_nome', t.clube_nome, 'origem', 'outro_clube')
      end as j
      from (
        select distinct on (c.codigo) c.id as class_id, c.codigo, c.nome, (c.tipo_classe = 'avancada') as avancada,
               a.concluida_em as ordem, a.concluida_em, a.data_desconhecida, a.registrado_em, u.nome as clube_nome,
               (a.club_id_origem = v_club) as neste_clube
          from public.curriculum_achievements a
          join public.classes c on c.id = a.classe_id
          join public.curriculum_versions v on v.id = c.curriculum_version_id and v.origem = 'oficial'
          join public.organizational_units u on u.id = a.club_id_origem
         where a.usuario_id = v_uid and a.tipo = 'classe' and a.status = 'ativa'
           and (a.club_id_origem <> v_club or a.origem = 'registro_anterior')
           and not exists (
             select 1 from public.member_classes mc join public.classes c2 on c2.id = mc.class_id
              where mc.usuario_id = v_uid and mc.club_id = v_club and mc.status <> 'cancelada' and c2.codigo = c.codigo
           )
         order by c.codigo, a.concluida_em desc
      ) t
      order by t.ordem desc
      limit 50
    ) x
  );
end;
$$;
revoke all on function public.classes_concluidas_anteriormente() from public, anon;
grant execute on function public.classes_concluidas_anteriormente() to authenticated;

-- ------------------------------------------------------------------------------------------------
-- 8) minha_jornada (514): as conquistas ganham origem e data_desconhecida; data desconhecida vira null
-- ------------------------------------------------------------------------------------------------
create or replace function public.minha_jornada() returns json
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_club uuid := public.clube_atual_id();
begin
  if v_uid is null or v_club is null or not public.membro_ativo_no_clube(v_club) then return null; end if;
  return json_build_object(
    'classes', coalesce((select json_agg(json_build_object('member_class_id', mc.id, 'nome', c.nome, 'manifesto_id', c.manifesto_id, 'status', mc.status,
            'percentual', public.classe_percentual(mc.id), 'iniciada_em', mc.iniciada_em, 'concluida_em', mc.concluida_em, 'investida_em', mc.investida_em) order by mc.iniciada_em desc)
        from public.member_classes mc join public.classes c on c.id = mc.class_id where mc.usuario_id = v_uid and mc.club_id = v_club and mc.status <> 'cancelada'), '[]'::json),
    'especialidades', coalesce((select json_agg(json_build_object('member_specialty_id', ms.id, 'codigo', sp.codigo, 'nome', sp.nome, 'categoria', sp.categoria, 'status', ms.status,
            'percentual', public.especialidade_percentual(ms.id), 'iniciada_em', ms.iniciada_em, 'concluida_em', ms.concluida_em) order by ms.iniciada_em desc)
        from public.member_specialties ms join public.specialties sp on sp.id = ms.specialty_id where ms.usuario_id = v_uid and ms.club_id = v_club and ms.status <> 'cancelada'), '[]'::json),
    'investiduras', coalesce((select json_agg(json_build_object('classe', c.nome, 'data', i.data_investidura) order by i.data_investidura desc)
        from public.class_investitures i join public.member_classes mc on mc.id = i.member_class_id join public.classes c on c.id = mc.class_id
       where i.usuario_id = v_uid and i.club_id = v_club and i.status = 'registrada'), '[]'::json),
    'conquistas', coalesce((select json_agg(json_build_object('tipo', a.tipo, 'nome', coalesce(c.nome, sp.nome),
            'concluida_em', case when a.data_desconhecida then null else a.concluida_em end,
            'origem', a.origem, 'data_desconhecida', a.data_desconhecida) order by a.concluida_em desc)
        from public.curriculum_achievements a left join public.classes c on c.id = a.classe_id left join public.specialties sp on sp.id = a.specialty_id
       where a.usuario_id = v_uid and a.status = 'ativa'), '[]'::json),
    'leituras', coalesce((select json_agg(json_build_object('titulo', m.titulo, 'concluido', p.concluido, 'ultima_em', p.ultima_em, 'capitulo', p.capitulo_ordem) order by p.ultima_em desc)
        from public.leitura_progresso p join public.leitura_materiais m on m.id = p.material_id where p.usuario_id = v_uid and p.club_id = v_club and m.ativo), '[]'::json)
  );
end;
$$;
revoke all on function public.minha_jornada() from public, anon;
grant execute on function public.minha_jornada() to authenticated;

select public._manutencao_instalar_guarda();
