-- =====================================================================
-- DesbravaClube — Correções multi-tenant 5/5: convites, notificações e push por clube
--
--  * Convite de responsável: listar (sem token nem hash), revogar, expira em 14 dias,
--    uso único e rastreado (used_by), papel 'pais'. O token aparece UMA vez na criação;
--    só o hash sha256 fica no banco.
--  * Notificações: toda linha nasce com o clube certo (destinatário > remetente > clube
--    explícito da rotina > legado). Cadastro novo avisa a liderança do PRÓPRIO clube;
--    aniversário e agenda saem por clube (antes iam todos para o feed do clube legado,
--    vazando nome/data de nascimento de menores entre clubes).
--  * Push: a seleção de destinatários vira uma função SQL por clube (só o service_role
--    executa). A Edge Function enviar-push a chama em vez de ler TODAS as inscrições.
-- =====================================================================

-- ==================== convites ====================
create or replace function public.criar_convite_responsavel() returns json
language plpgsql security definer set search_path = '' as $$
declare
  v_club uuid := public.clube_atual_id();
  v_token text := encode(extensions.gen_random_bytes(24), 'hex');
  v_exp timestamptz := now() + interval '14 days';
  v_id uuid;
begin
  if v_club is null or not public.pode_gerir_no_clube(v_club) then
    raise exception 'Sem permissão para criar convite.';
  end if;
  insert into public.club_invites (club_id, token_hash, expires_at, created_by)
  values (v_club, encode(extensions.digest(v_token, 'sha256'), 'hex'), v_exp, auth.uid())
  returning id into v_id;
  return json_build_object('id', v_id, 'token', v_token, 'expires_at', v_exp);
end;
$$;

create or replace function public.listar_convites_responsavel()
returns table (id uuid, criado_em timestamptz, expira_em timestamptz, usado_em timestamptz,
               revogado_em timestamptz, criado_por_nome text, usado_por_nome text, status text)
language sql stable security definer set search_path = '' as $$
  select i.id, i.created_at, i.expires_at, i.used_at, i.revoked_at,
         cp.nome, up.nome,
         case when i.used_at is not null then 'usado'
              when i.revoked_at is not null then 'revogado'
              when i.expires_at <= now() then 'expirado'
              else 'ativo' end
  from public.club_invites i
  left join public.profiles cp on cp.id = i.created_by
  left join public.profiles up on up.id = i.used_by
  where public.pode_gerir_no_clube(i.club_id)
    and i.club_id = public.clube_atual_id()
  order by i.created_at desc
  limit 100;
$$;

create or replace function public.revogar_convite_responsavel(p_id uuid) returns json
language plpgsql security definer set search_path = '' as $$
declare v_club uuid; v_usado timestamptz; v_revogado timestamptz;
begin
  select club_id, used_at, revoked_at into v_club, v_usado, v_revogado
    from public.club_invites where id = p_id for update;
  if not found then raise exception 'Convite não encontrado.'; end if;
  if not public.pode_gerir_no_clube(v_club) then raise exception 'Sem permissão para revogar este convite.'; end if;
  if v_usado is not null then raise exception 'Esse convite já foi usado.'; end if;
  if v_revogado is not null then raise exception 'Esse convite já foi revogado.'; end if;
  update public.club_invites set revoked_at = now(), revoked_by = auth.uid() where id = p_id;
  return json_build_object('ok', true);
end;
$$;

-- ==================== notificações sempre com o clube certo ====================
create or replace function public.definir_club_notificacao() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.para_usuario is not null then
    new.club_id := coalesce(public.clube_do_usuario(new.para_usuario), public.clube_legado_id());
  elsif new.criado_por is not null and public.clube_do_usuario(new.criado_por) is not null then
    new.club_id := public.clube_do_usuario(new.criado_por);
  else
    new.club_id := coalesce(new.club_id, public.clube_legado_id());
  end if;
  return new;
end;
$$;
revoke all on function public.definir_club_notificacao() from public, anon, authenticated;

create or replace function public.notif_novo_cadastro() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'pendente' then
    insert into public.notificacoes (titulo, corpo, tipo, link, para, club_id)
    values ('👤 Novo cadastro', coalesce(new.nome, 'Alguém') || ' está aguardando aprovação',
            'cadastro', '/aprovacoes', 'lideranca', public.clube_do_usuario(new.id));
  end if;
  return new;
end;
$$;
revoke all on function public.notif_novo_cadastro() from public, anon, authenticated;

create or replace function public.notif_pontos_unidade() returns trigger
language plpgsql security definer set search_path = '' as $$
declare uni text;
begin
  if new.unidade_id is not null then
    select nome into uni from public.unidades where id = new.unidade_id;
    insert into public.notificacoes (titulo, corpo, tipo, link, para, criado_por, club_id)
    values ('🏆 Pontos pra ' || coalesce(uni, 'unidade'),
            coalesce(uni, 'A unidade') || ' recebeu ' || new.pontos || ' pontos' || coalesce(' — ' || new.motivo, ''),
            'pontos', '/ranking', 'todos', new.lancado_por, new.club_id);
  end if;
  return new;
end;
$$;
revoke all on function public.notif_pontos_unidade() from public, anon, authenticated;

create or replace function public.notif_leilao() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.notificacoes (titulo, corpo, tipo, link, para, club_id)
  values ('🏛️ Leilão aberto!', 'Junte pontos com sua unidade e dê um lance: ' || coalesce(new.titulo, ''),
          'geral', '/leilao', 'todos', public.clube_legado_id());
  return new;
end;
$$;
revoke all on function public.notif_leilao() from public, anon, authenticated;

-- Aniversário: um aviso por aniversariante, no feed do clube DELE (antes: todos no clube legado)
create or replace function public.notif_aniversariantes_hoje() returns void
language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  for r in
    select p.nome, public.clube_do_usuario(p.id) as club_id
    from public.profiles p
    where p.status = 'ativo' and p.nascimento is not null
      and to_char(p.nascimento, 'MM-DD') = to_char((now() at time zone 'America/Sao_Paulo'), 'MM-DD')
      and public.clube_do_usuario(p.id) is not null
  loop
    insert into public.notificacoes (titulo, corpo, tipo, link, para, club_id)
    values ('🎂 Aniversário hoje!',
            'Hoje é aniversário de ' || coalesce(r.nome, 'um membro') || '. Mande os parabéns! 🥳',
            'aniversario', '/unidades', 'todos', r.club_id);
  end loop;
end;
$$;
revoke all on function public.notif_aniversariantes_hoje() from public, anon, authenticated;

-- Agenda: o lembrete do evento vai só para o clube do evento
create or replace function public.notif_eventos_amanha() returns void
language plpgsql security definer set search_path = '' as $$
declare
  r record;
  v_amanha date := ((now() at time zone 'America/Sao_Paulo')::date + 1);
begin
  for r in select titulo, hora, local, club_id from public.eventos where data = v_amanha loop
    insert into public.notificacoes (titulo, corpo, tipo, link, para, club_id)
    values (
      '📅 Amanhã: ' || r.titulo,
      nullif(concat_ws(' · ', nullif(r.hora, ''), nullif(r.local, '')), ''),
      'geral', '/agenda', 'todos', r.club_id);
  end loop;
end;
$$;
revoke all on function public.notif_eventos_amanha() from public, anon, authenticated;

-- ==================== push por clube ====================
-- Destinatários de UMA notificação. Espelha quem enxerga a notificação no app:
--   pessoal   -> só o destinatário, e só se ele é do clube da notificação;
--   lideranca -> instrutor/diretoria ativos do clube;
--   todos     -> membros ativos do clube (responsável não recebe aviso geral).
-- Sem clube, ou "para" desconhecido, ou "pessoal" sem destinatário = ninguém (nunca vira broadcast).
create or replace function public.push_destinatarios(p_club_id uuid, p_para text, p_para_usuario uuid)
returns table (user_id uuid, endpoint text, p256dh text, auth text)
language sql stable security definer set search_path = '' as $$
  select s.user_id, s.endpoint, s.p256dh, s.auth
  from public.push_subscriptions s
  where p_club_id is not null
    and (
      (p_para_usuario is not null and s.user_id = p_para_usuario and exists (
         select 1 from public.organization_memberships m
         where m.user_id = s.user_id and m.organizational_unit_id = p_club_id and m.status = 'ativo'))
      or (p_para_usuario is null and p_para = 'lideranca' and exists (
         select 1 from public.organization_memberships m
         where m.user_id = s.user_id and m.organizational_unit_id = p_club_id
           and m.role in ('instrutor', 'diretoria') and m.status = 'ativo'))
      or (p_para_usuario is null and p_para = 'todos' and exists (
         select 1 from public.organization_memberships m
         where m.user_id = s.user_id and m.organizational_unit_id = p_club_id
           and m.role <> 'pais' and m.status = 'ativo'))
    );
$$;
revoke all on function public.push_destinatarios(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.push_destinatarios(uuid, text, uuid) to service_role;

-- Limpeza final de ACL: nenhuma função nova ficou executável por PUBLIC/anon (só a do cadastro público).
revoke execute on all functions in schema public from public, anon;
grant execute on function public.clube_legado_id() to anon;

notify pgrst, 'reload schema';

insert into public.migracoes_aplicadas (arquivo)
values ('2026-09-21-convites-e-push-por-clube.sql')
on conflict (arquivo) do update set aplicada_em = now();
