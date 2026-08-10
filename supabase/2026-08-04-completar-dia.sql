-- =====================================================================
--  Filhos da Conquista — "Complete o dia" (bônus + lembrete) 2026-08-04
--
--  COMO APLICAR: Supabase -> SQL Editor -> New query -> cole tudo -> Run.
--  Idempotente. Precisa de pg_cron ativo (Database > Extensions) pro lembrete.
--
--  🎁 Quem jogar TODOS os jogos do dia ganha +50 de bônus (1x por dia).
--  ⏰ Às 18h de Brasília, quem ainda NÃO completou recebe um lembrete no app.
--
--  "Todos os jogos" = os jogos ATIVOS que valem 1x/dia (não conta ⚡ Reflexo /
--  🏕️ Corrida, que são de recorde e não têm "jogada do dia").
-- =====================================================================

-- 1) BÔNUS: dá +50 quando a criança completou todos os jogos do dia -------
create or replace function public.bonus_todos_jogos()
returns json language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_marca text := to_char(v_hoje, 'DD/MM/YYYY');
  v_total int;
  v_feitos int;
  v_ganhou int := 0;
  v_ja boolean;
begin
  if v_uid is null then raise exception 'Não autenticado.'; end if;
  if not public.eh_membro_ativo() then
    return json_build_object('completo', false, 'total', 0, 'feitos', 0, 'ganhou', 0);
  end if;

  -- quantos jogos diários existem ativos (não-arcade)
  select count(*) into v_total from public.jogos_trilha
  where ativo = true and chave not in ('reflexo', 'corrida');

  -- quantos DESSES a criança já jogou hoje (só conta jogo ativo e não-arcade)
  select count(distinct t.tipo) into v_feitos
  from public.trilha_jogos t
  join public.jogos_trilha j on j.chave = t.tipo
  where t.usuario_id = v_uid and t.data = v_hoje
    and j.ativo = true and j.chave not in ('reflexo', 'corrida');

  if v_total = 0 or v_feitos < v_total then
    return json_build_object('completo', false, 'total', v_total, 'feitos', v_feitos, 'ganhou', 0);
  end if;

  -- completou! conta de teste não pontua
  if coalesce((select teste from public.profiles where id = v_uid), false) then
    return json_build_object('completo', true, 'total', v_total, 'feitos', v_feitos, 'ganhou', 0, 'teste', true);
  end if;

  perform pg_advisory_xact_lock(hashtext(v_uid::text || ':bonus_dia:' || v_hoje::text));

  v_ja := exists (
    select 1 from public.pontos
    where usuario_id = v_uid and origem = 'bonus_dia' and motivo like '%(' || v_marca || ')%'
  );
  if not v_ja then
    insert into public.pontos (usuario_id, origem, pontos, motivo)
    values (v_uid, 'bonus_dia', 50, '🎮 Completou todos os jogos do dia (' || v_marca || ')');
    v_ganhou := 50;
  end if;

  return json_build_object('completo', true, 'total', v_total, 'feitos', v_feitos, 'ganhou', v_ganhou, 'ja', v_ja);
end;
$$;
grant execute on function public.bonus_todos_jogos() to authenticated;
revoke execute on function public.bonus_todos_jogos() from public, anon;

-- 2) LEMBRETE (cron 18h): avisa os desbravadores que ainda não completaram --
create or replace function public.lembrar_jogos_do_dia()
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_total int;
  r record;
begin
  -- idempotência: manda no máximo 1x por dia
  if coalesce((select valor from public.config_clube where chave = 'lembrete_jogos_dia'), '') = v_hoje::text then
    return;
  end if;

  select count(*) into v_total from public.jogos_trilha
  where ativo = true and chave not in ('reflexo', 'corrida');
  if v_total = 0 then return; end if; -- nenhum jogo diário ativo

  for r in
    select p.id
    from public.profiles p
    where p.status = 'ativo' and p.papel = 'desbravador' and coalesce(p.teste, false) = false
      and (
        select count(distinct t.tipo) from public.trilha_jogos t
        join public.jogos_trilha j on j.chave = t.tipo
        where t.usuario_id = p.id and t.data = v_hoje
          and j.ativo = true and j.chave not in ('reflexo', 'corrida')
      ) < v_total
  loop
    insert into public.notificacoes (titulo, corpo, tipo, link, para, para_usuario)
    values ('🎮 Ainda faltam jogos hoje!',
      'Você ainda não jogou todos os jogos de hoje. Complete todos e ganhe +50 de bônus! 🎁',
      'geral', '/trilha', 'pessoal', r.id);
  end loop;

  insert into public.config_clube (chave, valor) values ('lembrete_jogos_dia', v_hoje::text)
  on conflict (chave) do update set valor = excluded.valor;
end;
$$;
-- só o agendador roda
revoke all on function public.lembrar_jogos_do_dia() from public, anon, authenticated, service_role;

-- 3) Agenda: 18h de Brasília = 21:00 UTC ---------------------------------
do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron NÃO está ativo — ative em Database > Extensions (pg_cron) e re-rode este script.';
    return;
  end if;
  if exists (select 1 from cron.job where jobname = 'lembrar-jogos-do-dia') then
    perform cron.unschedule('lembrar-jogos-do-dia');
  end if;
  perform cron.schedule('lembrar-jogos-do-dia', '0 21 * * *', 'select public.lembrar_jogos_do_dia()');
  raise notice 'Agendado: lembrar-jogos-do-dia (18h de Brasília).';
end $$;

notify pgrst, 'reload schema';
