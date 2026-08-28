-- =====================================================================
--  Filhos da Conquista — Interruptor do rodízio 🥇 Jogos do Dia (2026-08-28)
--
--  COMO APLICAR: Supabase -> SQL Editor -> New query -> cole -> Run. Idempotente.
--  Depende do 2026-08-28-jogos-do-dia.sql já rodado.
--
--  Pedido do dono: "libera todos os jogos por hora". Em vez de desfazer o
--  rodízio, ele ganha um INTERRUPTOR (Gestão -> 🎮 Jogos da Trilha):
--   * DESLIGADO (este script já deixa assim): todos os jogos abertos, sem
--     cadeado, sem +10 diário; o bônus de completar o dia volta a ser +50
--     por TODOS os jogos ativos (sem arcade e sem os requer_webgl).
--   * LIGADO: rodízio completo (3/dia, cadeados, +10 ao melhor, bônus +20).
--  A troca vale na hora, sem SQL — é só o botão.
-- =====================================================================

-- 0) O interruptor (nasce DESLIGADO = tudo aberto, como o dono pediu agora)
insert into public.config_clube (chave, valor) values ('rodizio_jogos', 'nao')
on conflict (chave) do nothing;

create or replace function public.rodizio_ligado()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select valor from public.config_clube where chave = 'rodizio_jogos'), 'sim') = 'sim';
$$;
grant execute on function public.rodizio_ligado() to authenticated;

-- 1) registrar_jogo: a guarda do rodízio só vale com o interruptor LIGADO
--    (o resto é idêntico ao 2026-08-28-jogos-do-dia.sql: ponto = estrela×5,
--    modo teste, arcade bloqueado, tolerância da meia-noite)
create or replace function public.registrar_jogo(p_tipo text, p_estrelas int)
returns json language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_estrelas int := greatest(1, least(3, coalesce(p_estrelas, 1)));
  v_tipo text := coalesce(nullif(p_tipo, ''), 'memoria');
  v_ja int;
  v_pontos int;
  v_passos int;
begin
  if v_uid is null then raise exception 'Não autenticado.'; end if;

  if not exists (select 1 from public.jogos_trilha where chave = v_tipo) then
    raise exception 'Jogo inválido.';
  end if;

  if v_tipo in ('reflexo', 'corrida') then
    raise exception 'Esse jogo é de recorde — jogue pelo ⚡/🏕️!';
  end if;

  if public.eh_teste() then
    return json_build_object('pontos', 0, 'estrelas', v_estrelas, 'passos', 0, 'extra', false, 'teste', true);
  end if;

  -- RODÍZIO (só com o interruptor ligado): jogo comum só no seu dia/liberado.
  if public.rodizio_ligado()
     and not exists (select 1 from public.jogos_do_dia(v_hoje) d where d.chave = v_tipo)
     and not exists (select 1 from public.jogos_liberados l where l.chave = v_tipo and l.data = v_hoje)
     and not ((now() at time zone 'America/Sao_Paulo')::time < time '00:10'
              and (exists (select 1 from public.jogos_do_dia(v_hoje - 1) d where d.chave = v_tipo)
                   or exists (select 1 from public.jogos_liberados l where l.chave = v_tipo and l.data = v_hoje - 1))) then
    raise exception 'Esse jogo abre outro dia! Feche e abra o app pra ver os 🥇 Jogos do Dia de hoje.';
  end if;

  perform pg_advisory_xact_lock(hashtext(v_uid::text || ':' || v_hoje::text));

  select count(*) into v_ja
  from public.trilha_jogos where usuario_id = v_uid and data = v_hoje;

  v_pontos := v_estrelas * 5;

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
grant execute on function public.registrar_jogo(text, int) to authenticated;

-- 2) status_jogos_do_dia: devolve 'ativo' (o app mostra/esconde os cadeados)
create or replace function public.status_jogos_do_dia()
returns json language plpgsql stable security definer set search_path = '' as $$
declare
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_on boolean := public.rodizio_ligado();
  v_trio json; v_lib json; v_prox json; v_exig json;
begin
  if auth.uid() is null then raise exception 'Não autenticado.'; end if;

  if not v_on then
    -- rodízio desligado: tudo aberto; bônus (+50) exige todos os jogos ativos
    -- do dia a dia (sem arcade e sem os requer_webgl)
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
    'exigidos', v_exig, 'valor_bonus', 20);
end;
$$;
grant execute on function public.status_jogos_do_dia() to authenticated;
revoke execute on function public.status_jogos_do_dia() from public, anon;

-- 3) Bônus de completar o dia: +20 (rodízio ligado) ou +50 (desligado)
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

  v_valor := case when v_on then 20 else 50 end;

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

-- 4) Lembrete das 18h: usa o mesmo conjunto do bônus (nos dois modos)
create or replace function public.lembrar_jogos_do_dia()
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_on boolean := public.rodizio_ligado();
  v_total int;
  r record;
begin
  if coalesce((select valor from public.config_clube where chave = 'lembrete_jogos_dia'), '') = v_hoje::text then
    return;
  end if;

  create temp table if not exists _abertos_lembrete (chave text primary key) on commit drop;
  delete from _abertos_lembrete;
  if v_on then
    insert into _abertos_lembrete
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
    insert into _abertos_lembrete
      select j.chave from public.jogos_trilha j
      where j.ativo and j.chave not in ('reflexo', 'corrida') and not j.requer_webgl;
  end if;

  select count(*) into v_total from _abertos_lembrete;
  if v_total = 0 then return; end if;

  for r in
    select p.id
    from public.profiles p
    where p.status = 'ativo' and p.papel = 'desbravador' and coalesce(p.teste, false) = false
      and (
        select count(distinct t.tipo) from public.trilha_jogos t
        where t.usuario_id = p.id and t.data = v_hoje
          and t.tipo in (select chave from _abertos_lembrete)
      ) < v_total
  loop
    insert into public.notificacoes (titulo, corpo, tipo, link, para, para_usuario)
    values ('🎮 Ainda dá tempo de jogar!',
      'Complete os jogos de hoje e ganhe o bônus do dia! 🎁',
      'geral', '/trilha', 'pessoal', r.id);
  end loop;

  insert into public.config_clube (chave, valor) values ('lembrete_jogos_dia', v_hoje::text)
  on conflict (chave) do update set valor = excluded.valor;
end;
$$;
revoke all on function public.lembrar_jogos_do_dia() from public, anon, authenticated, service_role;

-- 5) Premiação diária: só roda com o rodízio LIGADO
create or replace function public.premiar_melhores_do_dia()
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_dia date := ((now() at time zone 'America/Sao_Paulo') - interval '12 hours')::date;
  rjogo record;
  r record;
  v_marca text;
  v_nomes text := null;
  v_premiados uuid[] := array[]::uuid[];
  v_so_desb boolean := coalesce((select valor = 'sim' from public.config_clube
                                 where chave = 'reflexo_so_desbravador'), false);
begin
  -- interruptor desligado = sem trio, sem +10 (os jogos estavam todos abertos)
  if not public.rodizio_ligado() then return; end if;

  if v_dia >= (now() at time zone 'America/Sao_Paulo')::date then
    raise exception 'Cedo demais: esta função julga o dia que FECHOU — rode entre 00:00 e 11:59.';
  end if;

  perform pg_advisory_xact_lock(hashtext('melhores-do-dia:' || v_dia::text));

  insert into public.jogos_liberados (chave, data)
  select c.valor, (now() at time zone 'America/Sao_Paulo')::date
  from public.config_clube c
  join public.jogos_trilha j on j.chave = c.valor and j.ativo
  where c.chave = 'jogo_da_semana' and c.valor not in ('reflexo', 'corrida')
  on conflict (chave, data) do nothing;

  for rjogo in select d.chave, d.nome from public.jogos_do_dia(v_dia) d loop
    v_marca := rjogo.chave || ' ' || to_char(v_dia, 'DD/MM/YYYY');

    if exists (
      select 1 from public.pontos
      where origem = 'melhor_dia' and motivo like '%(' || v_marca || ')%'
    ) then
      continue;
    end if;

    select t.usuario_id, p.nome, t.estrelas into r
    from public.trilha_jogos t
    join public.profiles p on p.id = t.usuario_id
    where t.data = v_dia and t.tipo = rjogo.chave
      and p.status = 'ativo' and p.papel <> 'pais' and coalesce(p.teste, false) = false
      and (not v_so_desb or p.papel = 'desbravador')
      and not (t.usuario_id = any(v_premiados))
    order by t.estrelas desc, t.created_at asc nulls last, t.usuario_id
    limit 1;
    if not found then continue; end if;

    v_premiados := v_premiados || r.usuario_id;
    insert into public.pontos (usuario_id, origem, pontos, motivo)
    values (r.usuario_id, 'melhor_dia', 10,
      '🥇 Melhor do dia no ' || rjogo.nome || ' — ' || r.estrelas || '★ (' || v_marca || ')');
    v_nomes := coalesce(v_nomes || ' · ', '') || coalesce(r.nome, 'Alguém') || ' no ' || rjogo.nome;
  end loop;

  if v_nomes is not null then
    insert into public.notificacoes (titulo, corpo, tipo, link, para)
    values ('🥇 Melhores do dia!',
      'Ontem: ' || v_nomes || ' — +10 pontos cada! Os Jogos do Dia de hoje já estão valendo. 🏃',
      'geral', '/trilha', 'todos');
  end if;
end;
$$;
revoke all on function public.premiar_melhores_do_dia() from public, anon, authenticated, service_role;

notify pgrst, 'reload schema';
