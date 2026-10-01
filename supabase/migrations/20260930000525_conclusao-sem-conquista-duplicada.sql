-- 525 — Conclusão curricular pertence à PESSOA: a matrícula que conclui NÃO cria 2ª conquista de classe. Aditiva; não mexe em <= 524.
--
-- Problema (decisão do dono): conquista = conclusão válida da PESSOA. O índice único de curriculum_achievements é por
-- (usuário, classe, club_id_origem), então ele sozinho permite duas conquistas ATIVAS da mesma classe quando a pessoa participa
-- de dois clubes. Caminho de duplicação que sobrava depois da 519/521/523 (que já recusam INICIAR/ATRIBUIR/REGISTRAR quando a
-- conclusão existe):
--   * matrícula EM ANDAMENTO no clube A + a liderança do clube B registra "classe já concluída" (521 só olha a matrícula no
--     clube do registro) -> depois a matrícula do A investe e o gatilho registrar_conquista_curricular criava a 2ª conquista;
--   * o inverso: duas matrículas em andamento (uma por clube; a 519 só bloqueia depois que a conclusão existe), a primeira que
--     investe vira a conquista e a segunda criava outra.
--
-- AUDITORIA (onde nasce conquista de CLASSE) — um único ponto:
--   * gatilho trg_registrar_conquista_curricular (after insert/update of status em member_classes) -> função
--     registrar_conquista_curricular(), SOMENTE quando a matrícula vira 'investida' (investidura_registrar; a conclusão dos
--     requisitos/_classe_selar_conclusao/snapshot/revisão/workflow NÃO emitem conquista). Insere com ON CONFLICT DO NOTHING
--     pelo índice (usuário, classe, club) — por isso um conflito no MESMO clube era silencioso e em clubes diferentes duplicava.
--   * classe_concluida_anteriormente_registrar (521) insere origem='registro_anterior' (já recusa se há conclusão ativa em
--     qualquer clube; serializa por advisory lock pessoa+código).
--   * documento_emitir/PDF/assinatura/verificação usam snapshot + class_investitures da MATRÍCULA, nunca a conquista.
--   * revogação: snapshot_revogar (064/090) só revoga a conquista da PRÓPRIA matrícula (member_class_id) e tolera não haver;
--     curriculum_achievement_revogar (generica) e classe_concluida_anteriormente_revogar (521) revogam uma linha.
--
-- DESENHO (mínimo e seguro):
--   1) Quando a matrícula investe e já existe conquista ATIVA da pessoa para a classe EQUIVALENTE (mesmo id ou mesmo código
--      oficial em qualquer versão; qualquer clube; qualquer origem), o gatilho NÃO insere conquista: grava o RECONHECIMENTO em
--      class_completion_recognitions (append-only; ator, papel, clube da matrícula, origem e clube da conquista reconhecida,
--      data da conclusão reconhecida, quando). A matrícula segue o próprio workflow e continua investida: snapshot, revisão,
--      investidura e documentos dela permanecem como HISTÓRICO DESSA matrícula (nada é apagado/cancelado/alterado); nenhuma
--      aprovação de requisito é criada ou alterada.
--   2) Serialização: mesmo advisory lock da 521 (pessoa+código), então registro anterior e investidura concorrentes não
--      cruzam. Idempotente: UNIQUE (matrícula, conquista) e o gatilho só dispara na transição para 'investida'.
--   3) Conquista reconhecida REVOGADA depois: o futuro volta ao normal e ninguém fica sem conclusão válida — para cada
--      matrícula ainda 'investida' com investidura registrada que a reconhecia, (a) se já há outra conquista ativa equivalente,
--      grava novo reconhecimento apontando para ela; (b) senão emite a conquista PRÓPRIA dela (origem 'conclusao_no_app',
--      concluida_em = investida_em, snapshot_id da investidura). Nada de aprovação inventada: usa só o que a matrícula já tem.
--   4) Leitura: _classe_reconhecimento_json / classe_conclusao_reconhecida(p_member_class_id) (dono ou liderança que avalia
--      currículo no clube da matrícula) e minhas_classes() ganha 'conclusao_reconhecida' e 'reconhecimento' (chaves antigas
--      intactas). minha_classe() NÃO foi reescrita (evita copiar 90 linhas): a tela chama a RPC nova.
--   5) classe_concluida_anteriormente_registrar NÃO foi alterada: avisar "esta pessoa tem a mesma classe em andamento em outro
--      clube" vazaria dado de menor entre clubes (a liderança do B não vê matrícula do A); o registro continua permitido (é
--      histórico real) e a correção está no momento de concluir.
--   NÃO resolvido aqui (anotado no relatório): linha revogada do MESMO clube/classe ainda ocupa o índice parcial (pré-existente
--   desde a 044: reinvestir no mesmo clube depois de revogar a conquista não emite nova). Mudar o predicado do índice afetaria
--   a Rede (515/517 leem conquista revogada por member_class_id); fica para decisão própria.

-- ------------------------------------------------------------------------------------------------
-- 1) proveniência imutável do reconhecimento
-- ------------------------------------------------------------------------------------------------
create table if not exists public.class_completion_recognitions (
  id uuid primary key default gen_random_uuid(),
  member_class_id uuid not null,            -- a matrícula que concluiu (sem FK: o histórico sobrevive à matrícula/conta)
  achievement_id uuid not null,             -- a conquista ativa reconhecida (sem FK pelo mesmo motivo)
  usuario_id uuid not null,
  club_id uuid not null references public.organizational_units(id),   -- clube da matrícula (o expurgo do clube apaga estas linhas, como as demais imutáveis)
  class_id uuid not null,                   -- classe da matrícula
  ator_id uuid,                             -- quem registrou a investidura que disparou o reconhecimento (null em rotina/SQL)
  ator_papel text,
  origem_conquista text not null check (origem_conquista in ('conclusao_no_app', 'registro_anterior')),
  club_origem_id uuid not null,             -- clube que emitiu a conquista reconhecida
  conquista_concluida_em timestamptz,       -- null quando a data da conquista é desconhecida (nunca vira data)
  data_desconhecida boolean not null default false,
  reconhecida_em timestamptz not null default now(),
  constraint class_completion_recognitions_uq unique (member_class_id, achievement_id)
);
create index if not exists class_completion_recognitions_mc_idx on public.class_completion_recognitions (member_class_id, reconhecida_em desc);
create index if not exists class_completion_recognitions_ach_idx on public.class_completion_recognitions (achievement_id);
create index if not exists class_completion_recognitions_club_idx on public.class_completion_recognitions (club_id, reconhecida_em desc);
alter table public.class_completion_recognitions enable row level security;
revoke all on public.class_completion_recognitions from public, anon, authenticated;   -- leitura só pelas RPCs

drop trigger if exists trg_imutavel on public.class_completion_recognitions;
create trigger trg_imutavel before update or delete on public.class_completion_recognitions
  for each row execute function public._proteger_registro_imutavel();

create or replace function public._class_completion_recognitions_sem_truncate() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  raise exception 'class_completion_recognitions é imutável: não pode ser esvaziado.';
end;
$$;
revoke all on function public._class_completion_recognitions_sem_truncate() from public, anon, authenticated;
drop trigger if exists trg_sem_truncate on public.class_completion_recognitions;
create trigger trg_sem_truncate before truncate on public.class_completion_recognitions
  for each statement execute function public._class_completion_recognitions_sem_truncate();

-- ------------------------------------------------------------------------------------------------
-- 2) helpers internos
-- ------------------------------------------------------------------------------------------------
-- mesmo lock da 521 (pessoa + código da classe): serializa registro anterior, investidura e promoção
create or replace function public._classe_lock_conclusao(p_usuario_id uuid, p_class_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_cod text;
begin
  select c.codigo into v_cod from public.classes c where c.id = p_class_id;
  perform pg_advisory_xact_lock(hashtextextended('classe-concluida-anteriormente:' || p_usuario_id::text || ':' || coalesce(v_cod, p_class_id::text), 0));
end;
$$;
revoke all on function public._classe_lock_conclusao(uuid, uuid) from public, anon, authenticated;

-- conquista ATIVA da pessoa para a classe equivalente (mesmo id, ou mesmo código oficial em qualquer versão oficial),
-- em qualquer clube e de qualquer origem; p_excluir_mc ignora a conquista da própria matrícula
create or replace function public._classe_conquista_equivalente_ativa(p_usuario_id uuid, p_class_id uuid, p_excluir_mc uuid default null) returns uuid
language sql stable security definer set search_path = '' as $$
  with alvo as (
    select c.codigo, v.origem from public.classes c join public.curriculum_versions v on v.id = c.curriculum_version_id where c.id = p_class_id
  ), equivalentes as (
    select c.id from public.classes c join public.curriculum_versions v on v.id = c.curriculum_version_id, alvo
    where c.id = p_class_id or (alvo.origem = 'oficial' and v.origem = 'oficial' and c.codigo = alvo.codigo)
  )
  select a.id from public.curriculum_achievements a
   where a.usuario_id = p_usuario_id and a.tipo = 'classe' and a.status = 'ativa' and a.classe_id in (select id from equivalentes)
     and (p_excluir_mc is null or a.member_class_id is distinct from p_excluir_mc)
   order by a.created_at, a.id limit 1;
$$;
revoke all on function public._classe_conquista_equivalente_ativa(uuid, uuid, uuid) from public, anon, authenticated;

create or replace function public._classe_registrar_reconhecimento(p_member_class_id uuid, p_achievement_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_mc record; v_a record; v_uid uuid := auth.uid();
begin
  select * into v_mc from public.member_classes where id = p_member_class_id;
  select * into v_a from public.curriculum_achievements where id = p_achievement_id;
  if v_mc.id is null or v_a.id is null then return; end if;
  insert into public.class_completion_recognitions (member_class_id, achievement_id, usuario_id, club_id, class_id, ator_id, ator_papel,
                                                    origem_conquista, club_origem_id, conquista_concluida_em, data_desconhecida)
  values (v_mc.id, v_a.id, v_mc.usuario_id, v_mc.club_id, v_mc.class_id, v_uid,
          case when v_uid is null then null else public.papel_no_clube(v_uid, v_mc.club_id) end,
          v_a.origem, v_a.club_id_origem, case when v_a.data_desconhecida then null else v_a.concluida_em end, v_a.data_desconhecida)
  on conflict (member_class_id, achievement_id) do nothing;
end;
$$;
revoke all on function public._classe_registrar_reconhecimento(uuid, uuid) from public, anon, authenticated;

-- ------------------------------------------------------------------------------------------------
-- 3) gatilho do motor: investida + conquista ativa equivalente => reconhece, NÃO duplica
--    (corpo da 521 + o ramo de reconhecimento; especialidade intacta)
-- ------------------------------------------------------------------------------------------------
create or replace function public.registrar_conquista_curricular() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_exist uuid;
begin
  if tg_argv[0] = 'member_classes' then
    if new.status = 'investida' and (old.status is null or old.status is distinct from 'investida') then
      perform public._classe_lock_conclusao(new.usuario_id, new.class_id);
      v_exist := public._classe_conquista_equivalente_ativa(new.usuario_id, new.class_id, new.id);
      if v_exist is not null then
        perform public._classe_registrar_reconhecimento(new.id, v_exist);
      else
        insert into public.curriculum_achievements (usuario_id, tipo, classe_id, club_id_origem, member_class_id, concluida_em)
        values (new.usuario_id, 'classe', new.class_id, new.club_id, new.id, coalesce(new.investida_em, now()))
        on conflict (usuario_id, classe_id, club_id_origem) where tipo = 'classe' and not (origem = 'registro_anterior' and status = 'revogada') do nothing;
      end if;
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

-- ------------------------------------------------------------------------------------------------
-- 4) conquista reconhecida REVOGADA: ninguém fica sem a conclusão válida que já tinha sido investida
-- ------------------------------------------------------------------------------------------------
create or replace function public._conquista_revogada_promove_reconhecidas() returns trigger
language plpgsql security definer set search_path = '' as $$
declare r record; v_mc record; v_inv record; v_ex uuid;
begin
  if not (old.status = 'ativa' and new.status = 'revogada' and new.tipo = 'classe') then return new; end if;
  for r in select * from public.class_completion_recognitions where achievement_id = new.id order by reconhecida_em, id loop
    select * into v_mc from public.member_classes where id = r.member_class_id and status = 'investida' for update;
    if not found then continue; end if;
    select i.* into v_inv from public.class_investitures i where i.member_class_id = v_mc.id and i.status = 'registrada' order by i.created_at desc limit 1;
    if not found then continue; end if;
    perform public._classe_lock_conclusao(v_mc.usuario_id, v_mc.class_id);
    v_ex := public._classe_conquista_equivalente_ativa(v_mc.usuario_id, v_mc.class_id, v_mc.id);
    if v_ex is not null then
      perform public._classe_registrar_reconhecimento(v_mc.id, v_ex);
    else
      insert into public.curriculum_achievements (usuario_id, tipo, classe_id, club_id_origem, member_class_id, concluida_em, snapshot_id)
      values (v_mc.usuario_id, 'classe', v_mc.class_id, v_mc.club_id, v_mc.id, coalesce(v_mc.investida_em, now()), v_inv.snapshot_id)
      on conflict (usuario_id, classe_id, club_id_origem) where tipo = 'classe' and not (origem = 'registro_anterior' and status = 'revogada') do nothing;
    end if;
  end loop;
  return new;
end;
$$;
revoke all on function public._conquista_revogada_promove_reconhecidas() from public, anon, authenticated;
drop trigger if exists trg_conquista_revogada_promove on public.curriculum_achievements;
create trigger trg_conquista_revogada_promove after update of status on public.curriculum_achievements
  for each row execute function public._conquista_revogada_promove_reconhecidas();

-- ------------------------------------------------------------------------------------------------
-- 5) leitura: JSON do reconhecimento VIGENTE da matrícula (conquista reconhecida ainda ativa) ou null
-- ------------------------------------------------------------------------------------------------
create or replace function public._classe_reconhecimento_json(p_member_class_id uuid) returns json
language sql stable security definer set search_path = '' as $$
  select json_build_object(
    'reconhecida', true,
    'origem', r.origem_conquista,
    'clube_nome', u.nome,
    'neste_clube', r.club_origem_id = r.club_id,
    'concluida_em', case when r.data_desconhecida then null else r.conquista_concluida_em end,
    'data_desconhecida', r.data_desconhecida,
    'reconhecida_em', r.reconhecida_em,
    'texto', 'Conclusão já reconhecida (' || case r.origem_conquista when 'registro_anterior' then 'registro anterior' else 'conclusão no app' end
             || ' em ' || u.nome
             || case when r.data_desconhecida or r.conquista_concluida_em is null then ''
                     else ', ' || to_char(r.conquista_concluida_em at time zone 'America/Sao_Paulo', 'DD/MM/YYYY') end || ')')
  from public.class_completion_recognitions r
  join public.curriculum_achievements a on a.id = r.achievement_id and a.status = 'ativa'
  join public.organizational_units u on u.id = r.club_origem_id
  where r.member_class_id = p_member_class_id
  order by r.reconhecida_em desc, r.id desc
  limit 1;
$$;
revoke all on function public._classe_reconhecimento_json(uuid) from public, anon, authenticated;

-- dono da matrícula (vínculo ativo) ou liderança que avalia currículo NO clube da matrícula (clube em uso); resto: null (sem oráculo)
create or replace function public.classe_conclusao_reconhecida(p_member_class_id uuid) returns json
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_club uuid := public.clube_atual_id(); v_mc record; v_j json;
begin
  if v_uid is null or v_club is null or p_member_class_id is null then return null; end if;
  select * into v_mc from public.member_classes where id = p_member_class_id and club_id = v_club and public._classe_do_catalogo_oficial(class_id);
  if not found then return null; end if;
  if not ((v_mc.usuario_id = v_uid and public.membro_ativo_no_clube(v_club)) or public.pode_avaliar_curriculo(v_club)) then return null; end if;
  v_j := public._classe_reconhecimento_json(v_mc.id);
  return coalesce(v_j, json_build_object('reconhecida', false));
end;
$$;
revoke all on function public.classe_conclusao_reconhecida(uuid) from public, anon;
grant execute on function public.classe_conclusao_reconhecida(uuid) to authenticated;

-- minhas_classes (108): as mesmas chaves + conclusao_reconhecida/reconhecimento
create or replace function public.minhas_classes()
returns json
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_club uuid := public.clube_atual_id();
begin
  if v_uid is null or v_club is null then return '[]'::json; end if;
  perform public._exigir_classes_habilitado(v_club);
  return (
    select coalesce(json_agg(json_build_object(
      'member_class_id', mc.id, 'class_id', c.id, 'codigo', c.codigo, 'nome', c.nome, 'status', mc.status,
      'iniciada_em', mc.iniciada_em, 'concluida_em', mc.concluida_em, 'percentual', public.classe_percentual(mc.id),
      'conclusao_reconhecida', public._classe_reconhecimento_json(mc.id) is not null,
      'reconhecimento', public._classe_reconhecimento_json(mc.id)
    ) order by (mc.status = 'em_andamento') desc, c.ordem, c.nome, mc.iniciada_em), '[]'::json)
    from public.member_classes mc
    join public.classes c on c.id = mc.class_id
    where mc.usuario_id = v_uid and mc.club_id = v_club and mc.status <> 'cancelada'
      and public._classe_do_catalogo_oficial(mc.class_id)
  );
end;
$$;
revoke all on function public.minhas_classes() from public, anon;
grant execute on function public.minhas_classes() to authenticated;

select public._manutencao_instalar_guarda();
notify pgrst, 'reload schema';
