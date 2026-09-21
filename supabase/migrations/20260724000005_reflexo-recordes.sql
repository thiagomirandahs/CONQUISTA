-- =====================================================================
--  Filhos da Conquista — ⚡ Reflexo + Recordes da Semana (2026-07-24)
--
--  COMO APLICAR: Supabase -> SQL Editor -> New query -> cole -> Run.
--  Idempotente. Nada é apagado.
--
--  JOGO NOVO dedicado ao "modo sem fim": ⚡ Reflexo — toque no alvo certo,
--  acelera a cada nível, SEM LIMITE de jogadas. Cada corrida vira um RECORDE
--  semanal (guarda só o melhor de cada criança); o ranking mostra os recordes
--  e, no DOMINGO 23:50 de Brasília, quem tiver o MAIOR recorde da semana
--  ganha +20 pontos AUTOMÁTICO (empate = todos ganham; UMA notificação).
--
--  O Reflexo NÃO dá os +10/+5 diários (jogadas ilimitadas não podem virar
--  farm de pontos) — o prêmio dele é o +20 semanal do recorde.
--
--  Correções herdadas da revisão anterior (já aplicadas aqui):
--   * a premiação ancora a semana em (agora - 12h): mesmo que o robô atrase
--     ou rode de manhã na segunda, julga a semana QUE FECHOU, não a nova;
--   * revoke de anon/public nas funções (anon nasce com execute no Supabase);
--   * empate gera UMA notificação com todos os nomes (não uma por campeão).
-- =====================================================================

-- 0) Pré-requisitos (existiam no script do modo-teste; garantimos aqui também
--    porque este script os usa — idempotente, não conflita se já existirem)
alter table public.profiles add column if not exists teste boolean not null default false;

create or replace function public.eh_teste()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select teste from public.profiles where id = auth.uid()), false);
$$;
grant execute on function public.eh_teste() to authenticated;

-- 1) O jogo no catálogo (entra DESLIGADO; ligar em Gestão -> 🎮 Jogos da Trilha)
insert into public.jogos_trilha (chave, nome, emoji, ativo, ordem) values
  ('reflexo', 'Reflexo', '⚡', false, 19)
on conflict (chave) do nothing;

-- 2) Recordes: o melhor resultado de cada criança, por jogo e por semana
create table if not exists public.recordes (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references public.profiles(id) on delete cascade,
  jogo text not null references public.jogos_trilha(chave),
  semana date not null,              -- a segunda-feira daquela semana
  pontos int not null default 0,
  atualizado_em timestamptz default now(),
  unique (usuario_id, jogo, semana)
);
alter table public.recordes enable row level security;
-- Ler: só membro ativo (mesma blindagem do resto — pai/pendente não veem crianças).
drop policy if exists "ler recordes" on public.recordes;
create policy "ler recordes" on public.recordes for select to authenticated
  using (public.eh_membro_ativo());
-- Escrever: só pela função (sem policy de insert/update = ninguém grava na mão).

-- 3) Registrar a corrida (guarda só o MELHOR da semana; teste não conta)
create or replace function public.registrar_recorde(p_jogo text, p_pontos int)
returns json language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_seg date := (date_trunc('week', (now() at time zone 'America/Sao_Paulo')))::date;
  v_pts int := greatest(0, least(coalesce(p_pontos, 0), 500));
  v_antigo int;
begin
  if v_uid is null then raise exception 'Não autenticado.'; end if;
  if not public.eh_membro_ativo() then
    return json_build_object('recorde', v_pts, 'melhorou', false);
  end if;
  if public.eh_teste() then
    return json_build_object('recorde', v_pts, 'melhorou', false, 'teste', true);
  end if;
  if not exists (select 1 from public.jogos_trilha where chave = p_jogo) then
    raise exception 'Jogo inválido.';
  end if;

  select pontos into v_antigo from public.recordes
  where usuario_id = v_uid and jogo = p_jogo and semana = v_seg;

  insert into public.recordes (usuario_id, jogo, semana, pontos)
  values (v_uid, p_jogo, v_seg, v_pts)
  on conflict (usuario_id, jogo, semana)
  do update set pontos = greatest(public.recordes.pontos, excluded.pontos),
                atualizado_em = now();

  return json_build_object(
    'recorde', greatest(coalesce(v_antigo, 0), v_pts),
    'melhorou', v_pts > coalesce(v_antigo, 0)
  );
end;
$$;
grant execute on function public.registrar_recorde(text, int) to authenticated;
revoke execute on function public.registrar_recorde(text, int) from public, anon;

-- 4) Ranking de recordes da semana (top 20). Pai/pendente/anon recebem vazio.
create or replace function public.recordes_semana(p_jogo text)
returns json language sql stable security definer set search_path = '' as $$
  select case when public.eh_membro_ativo() then coalesce((
    select json_agg(json_build_object(
      'id', t.usuario_id, 'nome', t.nome, 'foto', t.foto, 'pontos', t.pontos
    ) order by t.pontos desc, t.atualizado_em)
    from (
      select r.usuario_id, p.nome, p.foto, r.pontos, r.atualizado_em
      from public.recordes r
      join public.profiles p on p.id = r.usuario_id
      where r.jogo = p_jogo
        and r.semana = (date_trunc('week', (now() at time zone 'America/Sao_Paulo')))::date
        and r.pontos > 0
        and p.status = 'ativo' and p.papel <> 'pais' and coalesce(p.teste, false) = false
      order by r.pontos desc, r.atualizado_em
      limit 20
    ) t
  ), '[]'::json) else '[]'::json end;
$$;
grant execute on function public.recordes_semana(text) to authenticated;
revoke execute on function public.recordes_semana(text) from public, anon;

-- 5) Premiação automática (+20 pro maior recorde de cada jogo da semana)
create or replace function public.premiar_campeao_semana()
returns void language plpgsql security definer set search_path = '' as $$
declare
  -- Âncora com -12h: rodando domingo 23:50 OU segunda de manhã (atraso/manual),
  -- julga sempre a semana QUE FECHOU. (Correção apontada pela revisão.)
  v_seg date := (date_trunc('week', ((now() at time zone 'America/Sao_Paulo') - interval '12 hours')))::date;
  rjogo record; r record;
  v_max int; v_nome_jogo text; v_marca text; v_nomes text;
begin
  for rjogo in select distinct jogo from public.recordes where semana = v_seg loop
    v_marca := rjogo.jogo || ' ' || to_char(v_seg, 'DD/MM/YYYY');

    -- não premia o mesmo jogo/semana duas vezes (re-execução segura)
    if exists (
      select 1 from public.pontos
      where origem = 'campeao' and motivo like '%(' || v_marca || ')%'
    ) then
      continue;
    end if;

    select nome into v_nome_jogo from public.jogos_trilha where chave = rjogo.jogo;

    select max(r2.pontos) into v_max
    from public.recordes r2
    join public.profiles p on p.id = r2.usuario_id
    where r2.jogo = rjogo.jogo and r2.semana = v_seg and r2.pontos > 0
      and p.status = 'ativo' and p.papel <> 'pais' and coalesce(p.teste, false) = false;
    if v_max is null or v_max <= 0 then continue; end if;

    v_nomes := null;
    for r in
      select r2.usuario_id, p.nome
      from public.recordes r2
      join public.profiles p on p.id = r2.usuario_id
      where r2.jogo = rjogo.jogo and r2.semana = v_seg and r2.pontos = v_max
        and p.status = 'ativo' and p.papel <> 'pais' and coalesce(p.teste, false) = false
    loop
      insert into public.pontos (usuario_id, origem, pontos, motivo)
      values (r.usuario_id, 'campeao', 20,
        '🏆 Recorde da semana no ' || coalesce(v_nome_jogo, rjogo.jogo) || ' (' || v_marca || ')');
      v_nomes := coalesce(v_nomes || ', ', '') || coalesce(r.nome, 'Alguém');
    end loop;

    -- UMA notificação por jogo, com todos os empatados (correção da revisão)
    insert into public.notificacoes (titulo, corpo, tipo, link, para)
    values ('🏆 Recorde da semana!',
      v_nomes || ' fez o maior recorde no ' || coalesce(v_nome_jogo, rjogo.jogo) || ' e levou +20 pontos!',
      'geral', '/trilha', 'todos');
  end loop;
end;
$$;
-- Ninguém chama pela API e se premia — só o agendador roda.
revoke all on function public.premiar_campeao_semana() from public, anon, authenticated, service_role;

-- 6) Agenda: domingo 23:50 de Brasília = segunda 02:50 UTC (pg_cron usa UTC)
do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron não está ativo — ative em Database > Extensions e re-rode este script.';
    return;
  end if;
  if exists (select 1 from cron.job where jobname = 'campeao-jogo-semana') then
    perform cron.unschedule('campeao-jogo-semana'); -- limpeza de um desenho antigo, se existir
  end if;
  if exists (select 1 from cron.job where jobname = 'campeao-recorde-semana') then
    perform cron.unschedule('campeao-recorde-semana');
  end if;
  perform cron.schedule('campeao-recorde-semana', '50 2 * * 1', 'select public.premiar_campeao_semana()');
end $$;

notify pgrst, 'reload schema';
