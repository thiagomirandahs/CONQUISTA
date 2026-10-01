-- 527 — Conquista curricular de CLASSE: UMA ATIVA por pessoa + classe EQUIVALENTE, garantida pelo BANCO; revogada não bloqueia mais. Aditiva; não mexe em <= 526.
--
-- DECISÃO DO DONO (01/10/2026): uma conquista REVOGADA não pode impedir para sempre uma nova conclusão legítima da mesma classe.
--   (1) conquista ATIVA é única por pessoa + classe EQUIVALENTE (mesmo `codigo` oficial; qualquer clube, versão ou origem);
--   (2) a revogada permanece no histórico, NUNCA apagada nem alterada (origem, ator, clube, data e motivo da revogação intactos);
--   (3) uma nova conclusão válida posterior pode gerar NOVA conquista ativa;
--   (4) nunca duas ATIVAS equivalentes;
--   (5) concorrência não pode gerar duplicidade (gatilho de investidura, registro anterior 521 e reconhecimento 525).
--
-- AUDITORIA (o que lia/escrevia conquista de classe e dependia do índice antigo)
--   Índice antigo ux_curriculum_achievements_classe (usuario_id, classe_id, club_id_origem) where tipo='classe' and not (registro_anterior revogado):
--     * era POR CLUBE (a unicidade entre clubes era só lógica: advisory lock + checagem), e
--     * uma conquista de conclusao_no_app REVOGADA continuava ocupando a vaga: reinvestir a matrícula no MESMO clube depois de snapshot_revogar
--       fazia o ON CONFLICT DO NOTHING engolir a nova conquista (bug achado na 525).
--   ON CONFLICT que dependiam do predicado: registrar_conquista_curricular (ramo member_classes, 525) e
--     _conquista_revogada_promove_reconhecidas (525). Ambos passam a usar o ponto único _classe_emitir_ou_reconhecer (abaixo), sem ON CONFLICT.
--     (O ramo de especialidade e o índice de especialidade NÃO mudam.)
--   Escrevem conquista de classe: gatilho do motor (matrícula -> 'investida'), classe_concluida_anteriormente_registrar (521; origem
--     registro_anterior) e a promoção da 525. Revogam (UPDATE de status, nunca DELETE): snapshot_revogar (064/090),
--     curriculum_achievement_revogar (521; recusa registro_anterior) e classe_concluida_anteriormente_revogar (521). NENHUMA delas muda.
--   Leem por classe_id/status: _classe_conclusao_ativa_clube e _dependencia_de_classe_satisfeita (519), _classe_conquista_equivalente_ativa (525),
--     classes_concluidas_anteriormente / classe_concluidas_do_membro (521), minha_jornada (514/521), investidura_registrar (snapshot_id e
--     conquista_id da conquista ATIVA da matrícula: com 1 ativa por matrícula continua exato). Já filtram status='ativa': NÃO mudam.
--     curriculo_pessoa_concluiu comparava classe_id exato (ignorava a equivalência por código): passa a usar a chave de equivalência.
--   Rede 515/517 (_rede_conquistas_do_clube): escondia a matrícula se existisse QUALQUER conquista revogada com o member_class_id dela.
--     Com a regra nova, a matrícula reinvestida tem 1 revogada (histórico) + 1 ativa; a Rede passaria a esconder uma conquista legítima.
--     Predicado ajustado: esconde só se há revogada E nenhuma ativa para a matrícula.
--
-- DESENHO
--   * coluna curriculum_achievements.classe_codigo: chave de equivalência = classes.codigo se a versão é OFICIAL; 'id:<uuid>' se não é (classe
--     fora do catálogo oficial só é equivalente a ela mesma — exatamente a regra de _classe_conquista_equivalente_ativa). Preenchida por gatilho
--     BEFORE INSERT/UPDATE (não dá para forjar) e por backfill das linhas existentes (só preenche a coluna nova; nenhum outro dado muda).
--   * índice único PARCIAL ux_curriculum_achievements_classe_ativa_pessoa (usuario_id, classe_codigo) where tipo='classe' and status='ativa'.
--   * índice antigo ux_curriculum_achievements_classe mantido com predicado só de ATIVAS (revogada nunca ocupa vaga).
--   * ponto único de emissão _classe_emitir_ou_reconhecer: lock da pessoa+código (o mesmo da 521/525) -> há equivalente ativa? reconhece (525) :
--     insere; se mesmo assim o índice recusar (caminho sem o lock, ex.: SQL direto concorrente) a violação é CONVERTIDA em reconhecimento
--     (ou no-op se a conquista ativa já é da própria matrícula), sem estado parcial (o INSERT roda em subtransação).
--   * registro anterior (521): a violação do índice vira mensagem amigável ("já consta... neste clube / em outro clube"); a função inteira já
--     é atômica (exception ao fim). Ela ainda serializa pelo mesmo advisory lock.
--
-- MIGRAÇÃO SEGURA EM BANCO COM DADOS: se já existirem 2+ conquistas ATIVAS equivalentes da mesma pessoa, esta migration ABORTA antes de criar os índices (nenhuma conquista é apagada ou alterada; só a coluna derivada classe_codigo já foi preenchida, o que é inofensivo e idempotente)
--   com mensagem clara listando pessoa/classe/ids. Decisão: escolher qual conquista vence é julgamento humano e revogar é ato auditável do clube
--   (curriculum_achievement_revogar / classe_concluida_anteriormente_revogar, com motivo); nada é apagado nem revogado automaticamente.
--   Depois de revogar as sobras, reaplique. Em PRODUÇÃO a tabela não tem conquistas de classe (conferido pelo dono): a verificação passa trivialmente.
--   Consulta para inspecionar antes:  select * from public._conquista_classe_duplicatas_ativas();

-- ------------------------------------------------------------------------------------------------
-- 1) chave de equivalência + preenchimento automático
-- ------------------------------------------------------------------------------------------------
alter table public.curriculum_achievements add column if not exists classe_codigo text;

create or replace function public._conquista_classe_codigo(p_classe_id uuid) returns text
language sql stable security definer set search_path = '' as $$
  select case when v.origem = 'oficial' then c.codigo else 'id:' || c.id::text end
    from public.classes c join public.curriculum_versions v on v.id = c.curriculum_version_id
   where c.id = p_classe_id;
$$;
revoke all on function public._conquista_classe_codigo(uuid) from public, anon, authenticated;

create or replace function public._conquista_classe_codigo_preencher() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.classe_codigo := case when new.tipo = 'classe' then public._conquista_classe_codigo(new.classe_id) end;
  return new;
end;
$$;
revoke all on function public._conquista_classe_codigo_preencher() from public, anon, authenticated;
drop trigger if exists trg_classe_codigo on public.curriculum_achievements;
create trigger trg_classe_codigo before insert or update of tipo, classe_id, classe_codigo on public.curriculum_achievements
  for each row execute function public._conquista_classe_codigo_preencher();

-- registro_anterior só muda a revogação... e a coluna DERIVADA classe_codigo (backfill; ela é recalculada por gatilho de classe_id, que continua imutável)
create or replace function public._proteger_registro_anterior() returns trigger
language plpgsql security definer set search_path = '' as $$
declare k text; v_old jsonb := to_jsonb(old); v_new jsonb := to_jsonb(new);
begin
  if new.origem is distinct from old.origem then
    raise exception 'A origem de uma conquista curricular não pode ser alterada.';
  end if;
  if old.origem = 'registro_anterior' then
    for k in select jsonb_object_keys(v_new) loop
      if v_new -> k is distinct from v_old -> k and k not in ('status', 'revogada_em', 'revogada_por', 'revogada_motivo', 'classe_codigo') then
        raise exception 'Registro de classe concluída anteriormente é imutável: a coluna "%" não pode ser alterada (revogue com auditoria).', k;
      end if;
    end loop;
  end if;
  return new;
end;
$$;
revoke all on function public._proteger_registro_anterior() from public, anon, authenticated;

-- backfill: só a coluna nova (o UPDATE nem dispara o gatilho de promoção, que escuta apenas status)
update public.curriculum_achievements a set classe_codigo = public._conquista_classe_codigo(a.classe_id)
 where a.tipo = 'classe' and a.classe_codigo is distinct from public._conquista_classe_codigo(a.classe_id);

alter table public.curriculum_achievements drop constraint if exists curriculum_achievements_classe_codigo_coerente;
alter table public.curriculum_achievements add constraint curriculum_achievements_classe_codigo_coerente
  check ((tipo = 'classe' and classe_codigo is not null) or (tipo <> 'classe' and classe_codigo is null));

-- ------------------------------------------------------------------------------------------------
-- 2) duplicatas ATIVAS equivalentes pré-existentes: detectar e ABORTAR com mensagem clara (nada é apagado/alterado)
-- ------------------------------------------------------------------------------------------------
create or replace function public._conquista_classe_duplicatas_ativas()
returns table (usuario_id uuid, classe_codigo text, qtd bigint, conquistas uuid[])
language sql stable security definer set search_path = '' as $$
  select a.usuario_id, a.classe_codigo, count(*), array_agg(a.id order by a.created_at, a.id)
    from public.curriculum_achievements a
   where a.tipo = 'classe' and a.status = 'ativa'
   group by a.usuario_id, a.classe_codigo
  having count(*) > 1;
$$;
revoke all on function public._conquista_classe_duplicatas_ativas() from public, anon, authenticated;

do $$
declare v_n bigint; v_lista text;
begin
  select count(*), string_agg(format('pessoa %s / classe %s: %s conquistas ativas (%s)', d.usuario_id, d.classe_codigo, d.qtd, array_to_string(d.conquistas, ', ')), E'\n  ')
    into v_n, v_lista
    from (select * from public._conquista_classe_duplicatas_ativas() order by usuario_id, classe_codigo limit 20) d;
  if v_n > 0 then
    raise exception E'527 ABORTADA (nenhuma conquista foi apagada ou alterada; os índices NÃO foram criados): existem conquistas de classe ATIVAS duplicadas para a mesma pessoa e classe equivalente.\n  %\nRevogue as sobras COM MOTIVO (curriculum_achievement_revogar / classe_concluida_anteriormente_revogar) mantendo uma por pessoa+classe e reaplique. Nada é apagado nem revogado automaticamente. Consulta: select * from public._conquista_classe_duplicatas_ativas();', v_lista;
  end if;
end;
$$;

-- ------------------------------------------------------------------------------------------------
-- 3) índices: 1 ATIVA por pessoa+classe equivalente; revogada nunca ocupa vaga
-- ------------------------------------------------------------------------------------------------
create unique index if not exists ux_curriculum_achievements_classe_ativa_pessoa
  on public.curriculum_achievements (usuario_id, classe_codigo) where tipo = 'classe' and status = 'ativa';

drop index if exists public.ux_curriculum_achievements_classe;
create unique index ux_curriculum_achievements_classe
  on public.curriculum_achievements (usuario_id, classe_id, club_id_origem) where tipo = 'classe' and status = 'ativa';

-- ------------------------------------------------------------------------------------------------
-- 4) ponto único: emite a conquista da matrícula OU reconhece a ativa equivalente (nunca duplica, nunca estado parcial)
--    devolve 'emitida' | 'reconhecida' | 'ja_propria'
-- ------------------------------------------------------------------------------------------------
create or replace function public._classe_emitir_ou_reconhecer(p_member_class_id uuid, p_usuario_id uuid, p_class_id uuid, p_club_id uuid,
                                                               p_concluida_em timestamptz, p_snapshot_id uuid default null) returns text
language plpgsql security definer set search_path = '' as $$
declare v_exist uuid;
begin
  perform public._classe_lock_conclusao(p_usuario_id, p_class_id);   -- o mesmo lock da 521/525: pessoa + código
  v_exist := public._classe_conquista_equivalente_ativa(p_usuario_id, p_class_id, p_member_class_id);
  if v_exist is not null then
    perform public._classe_registrar_reconhecimento(p_member_class_id, v_exist);
    return 'reconhecida';
  end if;
  begin
    insert into public.curriculum_achievements (usuario_id, tipo, classe_id, club_id_origem, member_class_id, concluida_em, snapshot_id)
    values (p_usuario_id, 'classe', p_class_id, p_club_id, p_member_class_id, p_concluida_em, p_snapshot_id);
    return 'emitida';
  exception when unique_violation then
    -- o índice (1 ativa por pessoa+classe) recusou: alguém emitiu no mesmo instante, fora do lock. Sem erro e sem estado parcial.
    v_exist := public._classe_conquista_equivalente_ativa(p_usuario_id, p_class_id, null);
    if v_exist is null then raise; end if;
    if exists (select 1 from public.curriculum_achievements a where a.id = v_exist and a.member_class_id is not distinct from p_member_class_id) then
      return 'ja_propria';       -- a ativa já é a conquista desta própria matrícula (reprocessamento)
    end if;
    perform public._classe_registrar_reconhecimento(p_member_class_id, v_exist);
    return 'reconhecida';
  end;
end;
$$;
revoke all on function public._classe_emitir_ou_reconhecer(uuid, uuid, uuid, uuid, timestamptz, uuid) from public, anon, authenticated;

-- gatilho do motor (corpo da 525; só o ramo de CLASSE muda: usa o ponto único, sem ON CONFLICT dependente de predicado)
create or replace function public.registrar_conquista_curricular() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_argv[0] = 'member_classes' then
    if new.status = 'investida' and (old.status is null or old.status is distinct from 'investida') then
      perform public._classe_emitir_ou_reconhecer(new.id, new.usuario_id, new.class_id, new.club_id, coalesce(new.investida_em, now()), null);
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

-- promoção (525): conquista reconhecida REVOGADA -> a matrícula investida assume (ou reconhece outra ativa)
create or replace function public._conquista_revogada_promove_reconhecidas() returns trigger
language plpgsql security definer set search_path = '' as $$
declare r record; v_mc record; v_inv record;
begin
  if not (old.status = 'ativa' and new.status = 'revogada' and new.tipo = 'classe') then return new; end if;
  for r in select * from public.class_completion_recognitions where achievement_id = new.id order by reconhecida_em, id loop
    select * into v_mc from public.member_classes where id = r.member_class_id and status = 'investida' for update;
    if not found then continue; end if;
    select i.* into v_inv from public.class_investitures i where i.member_class_id = v_mc.id and i.status = 'registrada' order by i.created_at desc limit 1;
    if not found then continue; end if;
    perform public._classe_emitir_ou_reconhecer(v_mc.id, v_mc.usuario_id, v_mc.class_id, v_mc.club_id, coalesce(v_mc.investida_em, now()), v_inv.snapshot_id);
  end loop;
  return new;
end;
$$;
revoke all on function public._conquista_revogada_promove_reconhecidas() from public, anon, authenticated;

-- ------------------------------------------------------------------------------------------------
-- 5) registro anterior (521): corpo vigente; só a recusa por violação do índice fica amigável e exata
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

  perform public._classe_lock_conclusao(p_usuario_id, p_class_id);

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
  -- o índice único (1 ativa por pessoa+classe equivalente) recusou: a ativa equivalente existe (a função inteira é desfeita: sem estado parcial)
  v_origem := public._classe_conclusao_ativa_clube(p_usuario_id, p_class_id);
  if v_origem is null then
    raise exception 'Este comprovante já está em outro registro.';
  end if;
  raise exception 'Esta classe já consta como concluída por esta pessoa%.', case when v_origem = v_club then ' neste clube' else ' em outro clube' end;
end;
$$;
revoke all on function public.classe_concluida_anteriormente_registrar(uuid, uuid, date, boolean, text, text) from public, anon;
grant execute on function public.classe_concluida_anteriormente_registrar(uuid, uuid, date, boolean, text, text) to authenticated;

-- ------------------------------------------------------------------------------------------------
-- 6) leituras
-- ------------------------------------------------------------------------------------------------
-- consulta portátil (038): para CLASSE compara a chave de equivalência (mesmo código oficial em qualquer versão), não só o id
create or replace function public.curriculo_pessoa_concluiu(p_tipo text, p_usuario_id uuid, p_classe_id uuid default null, p_specialty_id uuid default null) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.curriculum_achievements
    where usuario_id = p_usuario_id and tipo = p_tipo and status = 'ativa'
      and (p_tipo <> 'classe' or classe_codigo = public._conquista_classe_codigo(p_classe_id))
      and (p_tipo <> 'especialidade' or specialty_id = p_specialty_id)
  );
$$;
revoke all on function public.curriculo_pessoa_concluiu(text, uuid, uuid, uuid) from public, anon, authenticated;

-- Rede (517): conquista de classe publicável = matrícula investida e SEM conquista revogada que não tenha sido substituída por uma ativa
create or replace function public._rede_conquistas_do_clube(p_club uuid)
returns table(origem_tipo text, origem_id uuid, membro_id uuid, titulo text, rotulo text, concluida_em timestamptz)
language sql stable security definer set search_path = '' as $$
  select 'classe'::text, mc.id, mc.usuario_id, cl.nome, 'Classe'::text, coalesce(mc.investida_em, mc.concluida_em, mc.updated_at)
    from public.member_classes mc join public.classes cl on cl.id = mc.class_id
   where mc.club_id = p_club and mc.status = 'investida'
     and (not exists (select 1 from public.curriculum_achievements a where a.member_class_id = mc.id and a.status = 'revogada')
          or exists (select 1 from public.curriculum_achievements a where a.member_class_id = mc.id and a.status = 'ativa'))
  union all
  select 'especialidade'::text, ms.id, ms.usuario_id, sp.nome, 'Especialidade'::text, coalesce(ms.concluida_em, ms.updated_at)
    from public.member_specialties ms join public.specialties sp on sp.id = ms.specialty_id
   where ms.club_id = p_club and ms.status = 'concluida'
     and not exists (select 1 from public.curriculum_achievements a where a.member_specialty_id = ms.id and a.status = 'revogada');
$$;
revoke all on function public._rede_conquistas_do_clube(uuid) from public, anon, authenticated;

notify pgrst, 'reload schema';
