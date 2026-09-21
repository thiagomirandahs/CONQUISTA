-- =====================================================================
--  Filhos da Conquista — Pontos dos jogos pra 30 (2026-08-29)
--
--  Pedido do dono: cada jogo passa a valer o DOBRO (1⭐=10, 2⭐=20, 3⭐=30) e o
--  bônus de completar os Jogos do Dia vai de +20 pra +30 (rodízio ligado).
--  O "+10 do melhor de cada jogo do dia" fica igual. Nada retroativo — vale só
--  pra pontos NOVOS.
--
--  Redefine só o que muda o número, rebaseado nas versões EM VIGOR:
--   * registrar_jogo → base 2026-08-29-anticheat-partidas.sql (só troca *5 por *10)
--   * status_jogos_do_dia / bonus_todos_jogos → base 2026-08-28-rodizio-
--     interruptor.sql (só troca o 20 do modo LIGADO por 30; o modo desligado
--     segue 50). Datado por ÚLTIMO (pontos-...) pra ser a definição final.
--
--  ⚠️ Depois desta, NÃO re-rode o anticheat nem o rodizio-interruptor pra estas
--  3 funções (voltariam pro *5 / +20). Ver GUIA-MIGRATIONS.md.
--
--  COMO APLICAR: Supabase -> SQL Editor -> New query -> cole -> Run. Idempotente.
-- =====================================================================

set lock_timeout = '10s';

-- 1) registrar_jogo: ponto = estrela × 10 (era × 5). Resto idêntico ao anticheat.
create or replace function public.registrar_jogo(p_tipo text, p_estrelas int, p_partida uuid default null)
returns json language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_estrelas int := greatest(1, least(3, coalesce(p_estrelas, 1)));
  v_tipo text := coalesce(nullif(p_tipo, ''), 'memoria');
  v_ja int;
  v_pontos int;
  v_passos int;
  v_ini timestamptz;
  v_seg numeric;
  v_exigir boolean := coalesce((select valor from public.config_clube where chave = 'exigir_partida'), 'nao') = 'sim';
begin
  if v_uid is null then raise exception 'Não autenticado.'; end if;
  if not public.eh_membro_ativo() then
    raise exception 'Apenas membros ativos do clube podem jogar.';
  end if;
  if not exists (select 1 from public.jogos_trilha where chave = v_tipo) then
    raise exception 'Jogo inválido.';
  end if;
  if v_tipo in ('reflexo', 'corrida') then
    raise exception 'Esse jogo é de recorde — jogue pelo ⚡/🏕️!';
  end if;
  if public.eh_teste() then
    return json_build_object('pontos', 0, 'estrelas', v_estrelas, 'passos', 0, 'extra', false, 'teste', true);
  end if;

  if exists (select 1 from public.trilha_jogos
             where usuario_id = v_uid and data = v_hoje and tipo = v_tipo) then
    raise exception 'Você já jogou esse jogo hoje! Escolha outro 🙂';
  end if;

  if p_partida is not null then
    update public.partidas
       set consumida_em = now(), resultado = v_estrelas
     where id = p_partida and usuario_id = v_uid and jogo = v_tipo
       and consumida_em is null and now() <= validade_em
     returning iniciado_em into v_ini;
    if not found then
      raise exception 'Partida inválida ou expirada — abra o jogo de novo. 🙂';
    end if;
    v_seg := extract(epoch from (now() - v_ini));
    if v_estrelas >= 2 and v_seg < public._min_segundos_jogo(v_tipo) then
      raise exception 'Rápido demais — jogue de verdade! 🙂';
    end if;
  else
    if v_exigir then
      raise exception 'Feche e abra o app pra atualizar, aí é só jogar de novo. 🙂';
    end if;
    if public.rodizio_ligado()
       and not exists (select 1 from public.jogos_do_dia(v_hoje) d where d.chave = v_tipo)
       and not exists (select 1 from public.jogos_liberados l where l.chave = v_tipo and l.data = v_hoje)
       and not ((now() at time zone 'America/Sao_Paulo')::time < time '00:10'
                and (exists (select 1 from public.jogos_do_dia(v_hoje - 1) d where d.chave = v_tipo)
                     or exists (select 1 from public.jogos_liberados l where l.chave = v_tipo and l.data = v_hoje - 1))) then
      raise exception 'Esse jogo abre outro dia! Feche e abra o app pra ver os 🥇 Jogos do Dia de hoje.';
    end if;
  end if;

  perform pg_advisory_xact_lock(hashtext(v_uid::text || ':' || v_hoje::text));

  select count(*) into v_ja
  from public.trilha_jogos where usuario_id = v_uid and data = v_hoje;

  v_pontos := v_estrelas * 10;   -- <<< era * 5 (agora 1⭐=10, 2⭐=20, 3⭐=30)

  insert into public.trilha_jogos (usuario_id, data, tipo, estrelas)
  values (v_uid, v_hoje, v_tipo, v_estrelas);

  insert into public.pontos (usuario_id, origem, pontos, motivo)
  values (v_uid, 'trilha', v_pontos,
          'Jogo ' || v_tipo || ' ' || to_char(v_hoje, 'DD/MM') || ' (' || v_estrelas || '⭐)');

  select count(*) into v_passos from public.trilha_jogos where usuario_id = v_uid;

  return json_build_object(
    'pontos', v_pontos, 'estrelas', v_estrelas, 'passos', v_passos, 'extra', (v_ja > 0)
  );
exception when unique_violation then
  raise exception 'Você já jogou esse jogo hoje! Escolha outro 🙂';
end;
$$;
revoke execute on function public.registrar_jogo(text, int, uuid) from public, anon;
grant execute on function public.registrar_jogo(text, int, uuid) to authenticated;

-- 2) status_jogos_do_dia: só troca valor_bonus 20 -> 30 (modo ligado). Resto igual.
create or replace function public.status_jogos_do_dia()
returns json language plpgsql stable security definer set search_path = '' as $$
declare
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_on boolean := public.rodizio_ligado();
  v_trio json; v_lib json; v_prox json; v_exig json;
begin
  if auth.uid() is null then raise exception 'Não autenticado.'; end if;

  if not v_on then
    select coalesce(json_agg(j.chave), '[]'::json) into v_exig
    from public.jogos_trilha j
    where j.ativo and j.chave not in ('reflexo', 'corrida') and not j.requer_webgl;
    return json_build_object('ativo', false, 'hoje', '[]'::json, 'liberados', '[]'::json,
      'proximos', '[]'::json, 'exigidos', v_exig, 'valor_bonus', 50);
  end if;

  select coalesce(json_agg(d.chave), '[]'::json) into v_trio
  from public.jogos_do_dia(v_hoje) d;

  select coalesce(json_agg(l.chave), '[]'::json) into v_lib
  from public.jogos_liberados l where l.data = v_hoje;

  select coalesce(json_agg(json_build_object('chave', s.chave, 'data', s.data)), '[]'::json)
  into v_prox
  from (
    select j.chave, min(v_hoje + i.i) as data
    from public.jogos_trilha j
    cross join generate_series(1, 21) i(i)
    where j.ativo and j.chave not in ('reflexo', 'corrida')
      and exists (select 1 from public.jogos_do_dia(v_hoje + i.i) x where x.chave = j.chave)
    group by j.chave
  ) s;

  select coalesce(json_agg(q.chave), '[]'::json) into v_exig
  from (
    select d.chave from public.jogos_do_dia(v_hoje) d
    union
    select l.chave from public.jogos_liberados l
    join public.jogos_trilha j on j.chave = l.chave
    where l.data = v_hoje and j.ativo and l.chave not in ('reflexo', 'corrida')
  ) q
  join public.jogos_trilha jt on jt.chave = q.chave
  where not jt.requer_webgl;

  return json_build_object('ativo', true, 'hoje', v_trio, 'liberados', v_lib, 'proximos', v_prox,
    'exigidos', v_exig, 'valor_bonus', 30);   -- <<< era 20
end;
$$;
grant execute on function public.status_jogos_do_dia() to authenticated;
revoke execute on function public.status_jogos_do_dia() from public, anon;

-- 3) bonus_todos_jogos: só troca o +20 do modo ligado por +30. Resto igual.
create or replace function public.bonus_todos_jogos()
returns json language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_marca text := to_char(v_hoje, 'DD/MM/YYYY');
  v_on boolean := public.rodizio_ligado();
  v_valor int;
  v_total int;
  v_feitos int;
  v_ganhou int := 0;
  v_ja boolean;
begin
  if v_uid is null then raise exception 'Não autenticado.'; end if;
  if not public.eh_membro_ativo() then
    return json_build_object('completo', false, 'total', 0, 'feitos', 0, 'ganhou', 0);
  end if;

  v_valor := case when v_on then 30 else 50 end;   -- <<< ligado era 20

  create temp table if not exists _abertos_hoje (chave text primary key) on commit drop;
  delete from _abertos_hoje;
  if v_on then
    insert into _abertos_hoje
      select q.chave from (
        select d.chave from public.jogos_do_dia(v_hoje) d
        union
        select l.chave from public.jogos_liberados l
        join public.jogos_trilha j on j.chave = l.chave
        where l.data = v_hoje and j.ativo and l.chave not in ('reflexo', 'corrida')
      ) q
      join public.jogos_trilha jt on jt.chave = q.chave
      where not jt.requer_webgl;
  else
    insert into _abertos_hoje
      select j.chave from public.jogos_trilha j
      where j.ativo and j.chave not in ('reflexo', 'corrida') and not j.requer_webgl;
  end if;

  select count(*) into v_total from _abertos_hoje;

  select count(distinct t.tipo) into v_feitos
  from public.trilha_jogos t
  where t.usuario_id = v_uid and t.data = v_hoje
    and t.tipo in (select chave from _abertos_hoje);

  if v_total = 0 or v_feitos < v_total then
    return json_build_object('completo', false, 'total', v_total, 'feitos', v_feitos, 'ganhou', 0);
  end if;

  if coalesce((select teste from public.profiles where id = v_uid), false) then
    return json_build_object('completo', true, 'total', v_total, 'feitos', v_feitos, 'ganhou', 0, 'teste', true);
  end if;

  perform pg_advisory_xact_lock(hashtext(v_uid::text || ':bonus_dia:' || v_hoje::text));

  v_ja := exists (
    select 1 from public.pontos
    where usuario_id = v_uid and origem = 'bonus_dia'
      and (data at time zone 'America/Sao_Paulo')::date = v_hoje
  );
  if not v_ja then
    insert into public.pontos (usuario_id, origem, pontos, motivo)
    values (v_uid, 'bonus_dia', v_valor, '🎮 Completou os jogos do dia (' || v_marca || ')');
    v_ganhou := v_valor;
  end if;

  return json_build_object('completo', true, 'total', v_total, 'feitos', v_feitos, 'ganhou', v_ganhou, 'ja', v_ja);
end;
$$;
grant execute on function public.bonus_todos_jogos() to authenticated;
revoke execute on function public.bonus_todos_jogos() from public, anon;

notify pgrst, 'reload schema';
