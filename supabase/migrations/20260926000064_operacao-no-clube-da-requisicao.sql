-- =============================================================================
--  Fase 8.4 — cinco operações que aconteciam no clube do ALVO, não no clube da REQUISIÇÃO.
--
--  ACHADO PELO RED-TEAM AUTOMÁTICO, e só por ele: a pessoa dos três clubes, operando na aba de B,
--  chamou `unidade_excluir()` com o id de uma unidade de C — e recebeu `{"ok": true}`.
--
--  O motivo é uma linha que parece certa:
--
--      select club_id into v_club from public.unidades where id = p_unidade_id;
--      if v_club is null or not public.pode_gerir_no_clube(v_club) then ... end if;
--
--  Ela pergunta "você é liderança NAQUELE clube?". Para quem tem um clube só, isso é idêntico a
--  "você é liderança AQUI". Para uma instrutora de C que está com a aba de B aberta, não é: ela
--  é liderança em C de verdade, então a checagem passa, e a unidade de C é apagada por um clique
--  dado dentro de B. A permissão está correta e a operação está no lugar errado.
--
--  É a definição literal do que a Fase 8.4 chama de BLOCKER: "qualquer operação executada no clube
--  errado é BLOCKER, mesmo que ninguém consiga ler o resultado". Aqui nem é só leitura — é DELETE.
--
--  O ALCANCE, medido no catálogo antes de corrigir: das 65 funções `security definer` que checam
--  `pode_gerir_no_clube`/`membro_ativo_no_clube` a partir de uma variável de clube, 63 já
--  consultavam `clube_atual_id()`. O padrão certo é o do projeto; estas cinco é que escaparam dele.
--  Fica registrado porque muda a leitura do achado: não é uma arquitetura errada, são cinco pontos
--  fora da curva — e nenhum deles seria encontrado sem uma pessoa com vínculo em três clubes.
--
--  A REGRA aplicada às cinco, sem exceção: o clube que autoriza tem de ser o clube da requisição.
--  Nenhuma regra de autoridade legítima foi afrouxada — `club_id_origem` continua sendo quem manda
--  em conquista e snapshot; só passou a ser exigido que a aba seja a daquele mesmo clube.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. unidade_excluir — o caso que o red-team pegou. DELETE no clube errado.
-- ---------------------------------------------------------------------------
create or replace function public.unidade_excluir(p_unidade_id uuid)
returns json
language plpgsql security definer set search_path = ''
as $$
declare v_club uuid;
begin
  select club_id into v_club from public.unidades where id = p_unidade_id;
  -- `v_club = clube_atual_id()` primeiro: unidade de outro clube e unidade inexistente passam a
  -- cair no MESMO ramo, com a mesma mensagem. O oráculo fecha junto com o furo.
  if v_club is null or v_club is distinct from public.clube_atual_id()
     or not public.pode_gerir_no_clube(v_club) then
    raise exception 'Sem permissão (apenas diretoria/instrutor deste clube).';
  end if;
  update public.organization_memberships set unidade_id = null
   where unidade_id = p_unidade_id and organizational_unit_id = v_club;
  delete from public.unidades where id = p_unidade_id and club_id = v_club;
  return json_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------------------
-- 2. revogar_convite_responsavel — mesma forma, sobre convite de responsável.
-- ---------------------------------------------------------------------------
create or replace function public.revogar_convite_responsavel(p_id uuid)
returns json
language plpgsql security definer set search_path = ''
as $$
declare v_club uuid; v_usado timestamptz; v_revogado timestamptz;
begin
  select club_id into v_club from public.club_invites where id = p_id;
  if v_club is null or v_club is distinct from public.clube_atual_id()
     or not public.pode_gerir_no_clube(v_club) then
    raise exception 'Convite não encontrado ou sem permissão.';
  end if;
  select used_at, revoked_at into v_usado, v_revogado from public.club_invites where id = p_id for update;
  if v_usado is not null then raise exception 'Esse convite já foi usado.'; end if;
  if v_revogado is not null then raise exception 'Esse convite já foi revogado.'; end if;
  update public.club_invites set revoked_at = now(), revoked_by = auth.uid() where id = p_id;
  return json_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------------------
-- 3. aprovar_entrega — aprova e LANÇA PONTO. No clube errado, mexeria no ranking alheio.
-- ---------------------------------------------------------------------------
create or replace function public.aprovar_entrega(p_entrega_id uuid)
returns json
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_ent public.entregas;
  v_atv public.atividades;
  v_pts int;
begin
  -- permissão ANTES de qualquer distinção (id inexistente e id de outro clube respondem igual)
  if not exists (
    select 1 from public.entregas e
     where e.id = p_entrega_id
       and e.club_id = public.clube_atual_id()
       and public.pode_gerir_no_clube(e.club_id)
  ) then
    raise exception 'Sem permissão neste clube.';
  end if;
  select * into v_ent from public.entregas where id = p_entrega_id and status = 'pendente' for update;
  if v_ent.id is null then
    return json_build_object('ok', false, 'motivo', 'ja_avaliada');
  end if;

  update public.entregas
     set status = 'aprovada', avaliado_por = v_uid
   where id = v_ent.id;

  select * into v_atv from public.atividades where id = v_ent.atividade_id;
  v_pts := coalesce(v_atv.pontos, 0);
  update public.entregas set pontos_dados = v_pts where id = v_ent.id;
  insert into public.pontos (usuario_id, origem, pontos, motivo, lancado_por, entrega_id, club_id)
    values (v_ent.usuario_id, 'atividade', v_pts,
            'Atividade: ' || coalesce(v_atv.titulo, ''), v_uid, v_ent.id, v_ent.club_id);

  return json_build_object('ok', true, 'pontos', v_pts);
end $$;

-- ---------------------------------------------------------------------------
-- 4. curriculum_achievement_revogar — revoga uma conquista PORTÁTIL.
--
--  Esta é a de maior consequência das cinco: a conquista viaja com a pessoa entre clubes, então
--  revogá-la pela aba errada apaga, de dentro de um clube, um registro que vale em todos.
--
--  A autoridade continua sendo `club_id_origem` — quem emitiu é quem revoga, e isso não mudou.
--  O que passou a ser exigido é que a aba seja a daquele clube. E as duas recusas viraram UMA:
--  "não existe" e "existe, mas não é sua para revogar" respondiam com mensagens diferentes, o que
--  por si só já era um oráculo de existência de conquista alheia.
-- ---------------------------------------------------------------------------
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
  if v_ca.status = 'revogada' then raise exception 'Esta conquista já está revogada.'; end if;
  update public.curriculum_achievements
     set status = 'revogada', revogada_em = now(), revogada_por = v_uid, revogada_motivo = p_motivo
   where id = p_id;
  return json_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------------------
-- 5. snapshot_revogar — revoga snapshot, investidura e a conquista de classe em cascata.
-- ---------------------------------------------------------------------------
create or replace function public.snapshot_revogar(p_snapshot_id uuid, p_motivo text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := auth.uid(); v_s record; v_inv record; v_ach record;
begin
  if coalesce(trim(p_motivo), '') = '' then raise exception 'Informe o motivo da revogação.'; end if;
  select * into v_s from public.class_completion_snapshots where id = p_snapshot_id for update;
  if not found
     or v_s.club_id_origem is distinct from public.clube_atual_id()
     or not public.pode_gerir_no_clube(v_s.club_id_origem) then
    raise exception 'Snapshot não encontrado ou sem permissão (só a liderança do clube que emitiu, operando nele, pode revogar).';
  end if;
  if v_s.status = 'revogado' then raise exception 'Este snapshot já está revogado.'; end if;
  update public.class_completion_snapshots set status = 'revogado', revogado_em = now(), revogado_por = v_uid, revogado_motivo = p_motivo where id = v_s.id;
  perform public._classe_evento(v_s.member_class_id, 'snapshot_revogado', v_s.id, p_motivo, null);
  select * into v_inv from public.class_investitures where snapshot_id = v_s.id and status = 'registrada';
  if found then
    update public.class_investitures set status = 'revogada', revogado_em = now(), revogado_por = v_uid, revogado_motivo = p_motivo where id = v_inv.id;
    perform public._classe_evento(v_s.member_class_id, 'investidura_revogada', v_s.id, p_motivo, jsonb_build_object('investidura_id', v_inv.id));
    select * into v_ach from public.curriculum_achievements where member_class_id = v_s.member_class_id and tipo = 'classe' and status = 'ativa';
    if found then
      update public.curriculum_achievements set status = 'revogada', revogada_em = now(), revogada_por = v_uid, revogada_motivo = p_motivo where id = v_ach.id;
      perform public._classe_evento(v_s.member_class_id, 'conquista_revogada', v_s.id, p_motivo, jsonb_build_object('conquista_id', v_ach.id));
    end if;
  end if;
  update public.investiture_reviews set status = 'recusado' where snapshot_id = v_s.id and status in ('pendente', 'aprovado');
  if v_s.member_class_id is not null then
    update public.member_classes set status = 'em_andamento', concluida_em = null, investida_em = null, updated_at = now() where id = v_s.member_class_id;
  end if;
  return json_build_object('ok', true)::jsonb;
end $$;
