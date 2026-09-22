-- =====================================================================
-- DesbravaClube — Limpeza final: jogos/chefão/leilão/ranking param de ler
-- profiles.papel/status/unidade_id para decisão de negócio
--
-- A migration 34 já tinha corrigido o que decide AUTORIZAÇÃO (quem pode
-- gerir, aprovar, editar). Esta corrige o que faltava: o motor de
-- jogos/prêmios, chefão, leilão e ranking ainda liam profiles.papel/status/
-- unidade_id (o ESPELHO do clube primário) em vez do vínculo — documentado
-- como limite honesto em AUDITORIA-MULTITENANT.md ("Multi-clube real").
--
-- organization_memberships passa a ser a ÚNICA fonte operacional de papel,
-- unidade e status por clube, em TODO código operacional (não só o de
-- autorização). profiles continua com papel/status/unidade_id só como
-- espelho de compatibilidade do clube primário (migration 34) — teste de
-- contrato (29_sem_profiles_papel_operacional.sql) trava isso pra sempre,
-- com uma lista de exceções expresas (o próprio mecanismo do espelho).
--
-- Levantamento (consulta a pg_proc, não a grep em arquivo — pega o texto
-- LIVE de cada função, já considerando toda redefinição de migrations
-- anteriores): 11 funções ainda liam profiles.papel/.status/.unidade_id
-- pra decisão de negócio. Nenhuma view nem policy de RLS fazia isso.
--
-- Transformação, sempre a mesma: onde a função já sabe o clube (parâmetro
-- p_club_id, ou clube_atual_id() já lido numa variável), troca
-- "profiles pr ... pr.papel/pr.status/pr.unidade_id" por um join em
-- organization_memberships m ON m.user_id = <pessoa> AND
-- m.organizational_unit_id = <o clube já conhecido>, usando m.role/m.status/
-- m.unidade_id. profiles continua junto SÓ pra identidade (nome, foto,
-- teste) — nunca duplicada por clube, nunca fonte de papel/unidade/status.
-- =====================================================================

-- ---------- 1) ranking por unidade (chamada quente: soma pontos da unidade) ----------
create or replace function public._pontos_temporada_unidade_interno(p_unidade_id uuid)
returns integer
language sql stable security definer set search_path = '' as $$
  select coalesce((
    select coalesce((
             select least(coalesce(sum(p.pontos), 0), 1000000000)::int from public.pontos p
             join public.organization_memberships m on m.user_id = p.usuario_id and m.organizational_unit_id = u.club_id
             where p.club_id = u.club_id and m.unidade_id = u.id and m.status = 'ativo'
               and coalesce(p.data, '-infinity'::timestamptz) >= public.temporada_inicio_clube(u.club_id)
           ), 0)
         + coalesce((
             select least(coalesce(sum(p2.pontos), 0), 1000000000)::int from public.pontos p2
             where p2.club_id = u.club_id and p2.unidade_id = u.id and p2.usuario_id is null
               and coalesce(p2.data, '-infinity'::timestamptz) >= public.temporada_inicio_clube(u.club_id)
           ), 0)
    from public.unidades u where u.id = p_unidade_id
  ), 0);
$$;

-- ---------- 2) chefão: dano total do clube (cron) e placar (tela) ----------
create or replace function public._chefao_premiar_clube(p_club_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_ativo boolean;
  v_inicio text;
  v_vida int;
  v_nome text;
  v_ini timestamptz;
  v_fim timestamptz;
  v_dano numeric;   -- dano total do clube (pontos + golpes de membros ativos)
  v_premio int;
  r record;
begin
  v_ativo := coalesce(public.config_valor(p_club_id, 'chefao_ativo'), 'nao') = 'sim';
  v_inicio := public.config_valor(p_club_id, 'chefao_inicio');
  if not v_ativo or v_inicio is null then return; end if;
  if public.config_valor(p_club_id, 'chefao_pago') is not distinct from v_inicio then return; end if;

  v_vida := greatest(1, coalesce(public.config_valor(p_club_id, 'chefao_vida'), '3000')::int);
  v_nome := coalesce(public.config_valor(p_club_id, 'chefao_nome'), 'Chefão');
  v_ini := (v_inicio || ' 00:00:00')::timestamp at time zone 'America/Sao_Paulo';
  v_fim := v_ini + interval '2 days';

  perform pg_advisory_xact_lock(hashtext('chefao:' || p_club_id::text || ':' || v_inicio));

  -- dano total (mesmos filtros do dano por pessoa abaixo → as proporções fecham)
  select coalesce((select sum(p.pontos) from public.pontos p
      join public.organization_memberships m on m.user_id = p.usuario_id and m.organizational_unit_id = p_club_id
      join public.profiles pr on pr.id = p.usuario_id
      where p.data >= v_ini and p.data < v_fim and p.pontos > 0 and p.origem not in ('campeao','chefao')
        and m.status = 'ativo' and m.role <> 'pais' and coalesce(pr.teste, false) = false), 0)
    + coalesce((select sum(g.dano) from public.chefao_golpes g
      join public.organization_memberships m on m.user_id = g.usuario_id and m.organizational_unit_id = p_club_id
      join public.profiles pr on pr.id = g.usuario_id
      where g.criado_em >= v_ini and g.criado_em < v_fim
        and m.status = 'ativo' and m.role <> 'pais' and coalesce(pr.teste, false) = false), 0)
  into v_dano;

  if v_dano >= v_vida then
    -- VITÓRIA: reparte a vida (v_vida) proporcional ao dano de cada um
    for r in
      select uid, sum(dano)::numeric as dano_user from (
        select p.usuario_id as uid, sum(p.pontos)::numeric as dano
        from public.pontos p
        join public.organization_memberships m on m.user_id = p.usuario_id and m.organizational_unit_id = p_club_id
        join public.profiles pr on pr.id = p.usuario_id
        where p.data >= v_ini and p.data < v_fim and p.pontos > 0 and p.origem not in ('campeao','chefao')
          and m.status = 'ativo' and m.role <> 'pais' and coalesce(pr.teste, false) = false
        group by p.usuario_id
        union all
        select g.usuario_id, sum(g.dano)::numeric
        from public.chefao_golpes g
        join public.organization_memberships m on m.user_id = g.usuario_id and m.organizational_unit_id = p_club_id
        join public.profiles pr on pr.id = g.usuario_id
        where g.criado_em >= v_ini and g.criado_em < v_fim
          and m.status = 'ativo' and m.role <> 'pais' and coalesce(pr.teste, false) = false
        group by g.usuario_id
      ) t
      group by uid
    loop
      v_premio := round(v_vida * r.dano_user / v_dano)::int;
      if v_premio > 0 then
        insert into public.pontos (usuario_id, origem, pontos, motivo, club_id)
        values (r.uid, 'chefao', v_premio,
          '⚔️ Derrotou o ' || v_nome || '! ' || round(r.dano_user)::int || ' de dano → +' || v_premio
          || ' (' || to_char(v_ini, 'DD/MM') || ')', p_club_id);
      end if;
    end loop;

    insert into public.notificacoes (titulo, corpo, tipo, link, para, club_id)
    values ('⚔️ Chefão derrotado!',
      'O clube uniu forças e derrotou o ' || v_nome || '! Cada um levou pontos proporcionais ao dano que causou. 🎉',
      'geral', '/chefao', 'todos', p_club_id);
  else
    -- fugiu (gentil, sem "vocês falharam"); ninguém perde os pontos já ganhos
    insert into public.notificacoes (titulo, corpo, tipo, link, para, club_id)
    values ('🌙 O ' || v_nome || ' recuou...',
      'O ' || v_nome || ' fugiu por pouco! Foi muita luta junto — semana que vem tem mais aventura. 💪',
      'geral', '/chefao', 'todos', p_club_id);
  end if;

  insert into public.config_clube (club_id, chave, valor) values (p_club_id, 'chefao_pago', v_inicio)
  on conflict (club_id, chave) do update set valor = excluded.valor;
  update public.config_clube set valor = 'nao' where club_id = p_club_id and chave = 'chefao_ativo';
end;
$$;

create or replace function public.chefao_estado()
returns json language plpgsql security definer set search_path = '' as $$
declare
  v_club uuid := public.clube_atual_id();
  v_uid uuid := auth.uid();
  v_ativo boolean;
  v_inicio text;
  v_vida int;
  v_ini timestamptz;
  v_fim timestamptz;
  v_dano_pontos int;
  v_dano_golpes int;
  v_dano int;
  v_por_unidade json;
  v_meu_ultimo timestamptz;
  v_no_evento boolean;
begin
  if v_uid is null then raise exception 'Não autenticado.'; end if;
  if not public.membro_ativo_no_clube(v_club) then return json_build_object('ativo', false); end if;

  v_ativo := coalesce(public.config_valor(public.clube_atual_id(), 'chefao_ativo'), 'nao') = 'sim';
  v_inicio := public.config_valor(public.clube_atual_id(), 'chefao_inicio');
  if not v_ativo or v_inicio is null then return json_build_object('ativo', false); end if;

  v_vida := greatest(1, coalesce(public.config_valor(public.clube_atual_id(), 'chefao_vida'), '3000')::int);
  v_ini := (v_inicio || ' 00:00:00')::timestamp at time zone 'America/Sao_Paulo';
  v_fim := v_ini + interval '2 days'; -- sáb 00:00 -> seg 00:00 (cobre sáb+dom)
  v_no_evento := now() >= v_ini and now() < v_fim;

  select coalesce(sum(p.pontos), 0) into v_dano_pontos
  from public.pontos p
  join public.organization_memberships m on m.user_id = p.usuario_id and m.organizational_unit_id = v_club
  join public.profiles pr on pr.id = p.usuario_id
  where p.data >= v_ini and p.data < v_fim and p.pontos > 0
    and p.origem not in ('campeao', 'chefao')
    and m.status = 'ativo' and m.role <> 'pais' and coalesce(pr.teste, false) = false and p.club_id = v_club;

  select coalesce(sum(g.dano), 0) into v_dano_golpes
  from public.chefao_golpes g
  where g.club_id = v_club and g.criado_em >= v_ini and g.criado_em < v_fim;

  v_dano := v_dano_pontos + v_dano_golpes;

  -- placar por unidade (pontos + golpes somados por unidade) — a unidade agora é a do VÍNCULO
  -- nesse clube (não a de profiles, que é só a do clube primário da pessoa)
  with dano_uni as (
    select m.unidade_id as uid, sum(p.pontos)::int as dano
    from public.pontos p
    join public.organization_memberships m on m.user_id = p.usuario_id and m.organizational_unit_id = v_club
    join public.profiles pr on pr.id = p.usuario_id
    where p.data >= v_ini and p.data < v_fim and p.pontos > 0 and p.origem not in ('campeao', 'chefao')
      and m.status = 'ativo' and m.role <> 'pais' and coalesce(pr.teste, false) = false and p.club_id = v_club
      and m.unidade_id is not null
    group by m.unidade_id
    union all
    select m.unidade_id as uid, sum(g.dano)::int as dano
    from public.chefao_golpes g
    join public.organization_memberships m on m.user_id = g.usuario_id and m.organizational_unit_id = v_club
    where g.club_id = v_club and g.criado_em >= v_ini and g.criado_em < v_fim and m.unidade_id is not null
    group by m.unidade_id
  )
  select coalesce(json_agg(json_build_object('unidade', u.nome, 'dano', t.dano) order by t.dano desc), '[]'::json)
    into v_por_unidade
  from (select uid, sum(dano)::int as dano from dano_uni group by uid) t
  join public.unidades u on u.id = t.uid;

  select max(criado_em) into v_meu_ultimo from public.chefao_golpes
  where usuario_id = v_uid and criado_em >= v_ini and criado_em < v_fim;

  return json_build_object(
    'ativo', true,
    'nome', coalesce(public.config_valor(public.clube_atual_id(), 'chefao_nome'), 'Chefão'),
    'emoji', coalesce(public.config_valor(public.clube_atual_id(), 'chefao_emoji'), '🗿'),
    'versiculo', public.config_valor(public.clube_atual_id(), 'chefao_versiculo'),
    'inicio', v_inicio,
    'fase', case when now() < v_ini then 'antes' when now() < v_fim then 'rolando' else 'acabou' end,
    'vida_total', v_vida,
    'dano', v_dano,
    'vida_atual', greatest(0, v_vida - v_dano),
    'venceu', v_dano >= v_vida,
    'no_evento', v_no_evento,
    'por_unidade', v_por_unidade,
    'golpe_pronto', v_no_evento and v_dano < v_vida
      and (v_meu_ultimo is null or now() - v_meu_ultimo >= interval '1 hour'),
    'proximo_golpe_em', case when v_meu_ultimo is null then null else v_meu_ultimo + interval '1 hour' end,
    'ja_golpeei', v_meu_ultimo is not null
  );
end;
$$;

-- ---------- 3) lembretes diários (cron, por clube) ----------
create or replace function public._lembrar_ausentes_clube(p_club_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  r record;
begin
  -- idempotência: no máximo 1x por dia
  if coalesce(public.config_valor(p_club_id, 'lembrete_ausencia_dia'), '') = v_hoje::text then
    return;
  end if;
  for r in
    select m.user_id as id
    from public.organization_memberships m
    join public.profiles p on p.id = m.user_id
    where m.status = 'ativo' and m.role = 'desbravador' and m.organizational_unit_id = p_club_id
      and coalesce(p.teste, false) = false
      -- 2+ dias sem jogar: nada ontem nem hoje
      and not exists (select 1 from public.trilha_jogos t where t.usuario_id = m.user_id and t.data >= v_hoje - 1)
      -- não repetir: não lembrado nos últimos 2 dias
      and not exists (
        select 1 from public.notificacoes n
        where n.para_usuario = m.user_id and n.titulo = '🎮 Sentimos sua falta!'
          and (n.created_at at time zone 'America/Sao_Paulo')::date >= v_hoje - 1
      )
  loop
    insert into public.notificacoes (titulo, corpo, tipo, link, para, para_usuario)
    values ('🎮 Sentimos sua falta!',
      'Já faz uns dias que você não joga! Vem ganhar pontos — tem jogo novo te esperando. 🎁',
      'geral', '/trilha', 'pessoal', r.id);
  end loop;
  insert into public.config_clube (club_id, chave, valor) values (p_club_id, 'lembrete_ausencia_dia', v_hoje::text)
  on conflict (club_id, chave) do update set valor = excluded.valor;
end;
$$;

create or replace function public._lembrar_jogos_do_dia_clube(p_club_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_on boolean := public._rodizio_ligado_clube(p_club_id);
  v_total int;
  r record;
begin
  if coalesce(public.config_valor(p_club_id, 'lembrete_jogos_dia'), '') = v_hoje::text then
    return;
  end if;
  create temp table if not exists _abertos_lembrete (chave text primary key) on commit drop;
  delete from _abertos_lembrete;
  if v_on then
    insert into _abertos_lembrete
      select q.chave from (
        select d.chave from public._jogos_do_dia_clube(p_club_id, v_hoje) d
        union
        select l.chave from public._jogos_liberados_do_clube(p_club_id) l
        join public._jogos_do_clube(p_club_id) j on j.chave = l.chave
        where l.data = v_hoje and j.ativo and l.chave not in ('reflexo', 'corrida')
      ) q
      join public._jogos_do_clube(p_club_id) jt on jt.chave = q.chave
      where not jt.requer_webgl;
  else
    insert into _abertos_lembrete
      select j.chave from public._jogos_do_clube(p_club_id) j
      where j.ativo and j.chave not in ('reflexo', 'corrida') and not j.requer_webgl;
  end if;
  select count(*) into v_total from _abertos_lembrete;
  if v_total = 0 then return; end if;
  for r in
    select m.user_id as id
    from public.organization_memberships m
    join public.profiles p on p.id = m.user_id
    where m.status = 'ativo' and m.role = 'desbravador' and m.organizational_unit_id = p_club_id
      and coalesce(p.teste, false) = false
      and (
        select count(distinct t.tipo) from public.trilha_jogos t
        where t.usuario_id = m.user_id and t.data = v_hoje
          and t.tipo in (select chave from _abertos_lembrete)
      ) < v_total
  loop
    insert into public.notificacoes (titulo, corpo, tipo, link, para, para_usuario)
    values ('🎮 Ainda dá tempo de jogar!',
      'Complete os jogos de hoje e ganhe o bônus do dia! 🎁',
      'geral', '/trilha', 'pessoal', r.id);
  end loop;
  insert into public.config_clube (club_id, chave, valor) values (p_club_id, 'lembrete_jogos_dia', v_hoje::text)
  on conflict (club_id, chave) do update set valor = excluded.valor;
end;
$$;

-- ---------- 4) prêmios de jogos (cron: recorde da semana, melhor do dia, rodada da semana) ----------
create or replace function public._premiar_campeao_semana_clube(p_club_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_seg date := (date_trunc('week', ((now() at time zone 'America/Sao_Paulo') - interval '12 hours')))::date;
  rjogo record; r record;
  v_max int; v_nome_jogo text; v_marca text; v_nomes text;
begin
  for rjogo in select distinct jogo from public.recordes
               where club_id = p_club_id and semana = v_seg and jogo in ('reflexo', 'corrida') loop
    v_marca := rjogo.jogo || ' ' || to_char(v_seg, 'DD/MM/YYYY');
    if exists (select 1 from public.pontos
               where club_id = p_club_id and origem = 'campeao' and motivo like '%(' || v_marca || ')%') then
      continue;
    end if;
    select nome into v_nome_jogo from public._jogos_do_clube(p_club_id) where chave = rjogo.jogo;
    select max(r2.pontos) into v_max
    from public.recordes r2
    join public.organization_memberships m on m.user_id = r2.usuario_id and m.organizational_unit_id = p_club_id
    join public.profiles p on p.id = r2.usuario_id
    where r2.club_id = p_club_id and r2.jogo = rjogo.jogo and r2.semana = v_seg and r2.pontos > 0
      and m.status = 'ativo' and m.role <> 'pais' and coalesce(p.teste, false) = false
      and (not public._reflexo_so_desbravador_clube(p_club_id) or m.role = 'desbravador');
    if v_max is null or v_max <= 0 then continue; end if;
    v_nomes := null;
    for r in
      select r2.usuario_id, p.nome
      from public.recordes r2
      join public.organization_memberships m on m.user_id = r2.usuario_id and m.organizational_unit_id = p_club_id
      join public.profiles p on p.id = r2.usuario_id
      where r2.club_id = p_club_id and r2.jogo = rjogo.jogo and r2.semana = v_seg and r2.pontos = v_max
        and m.status = 'ativo' and m.role <> 'pais' and coalesce(p.teste, false) = false
        and (not public._reflexo_so_desbravador_clube(p_club_id) or m.role = 'desbravador')
    loop
      insert into public.pontos (usuario_id, origem, pontos, motivo, club_id)
      values (r.usuario_id, 'campeao', 20,
        '🏆 Recorde da semana no ' || coalesce(v_nome_jogo, rjogo.jogo) || ' (' || v_marca || ')', p_club_id);
      v_nomes := coalesce(v_nomes || ', ', '') || coalesce(r.nome, 'Alguém');
    end loop;
    if v_nomes is null then continue; end if;
    insert into public.notificacoes (titulo, corpo, tipo, link, para, club_id)
    values ('🏆 Recorde da semana!',
      v_nomes || ' fez o maior recorde no ' || coalesce(v_nome_jogo, rjogo.jogo) || ' e levou +20 pontos!',
      'geral', '/trilha', 'todos', p_club_id);
  end loop;
end;
$$;

create or replace function public._premiar_melhores_do_dia_clube(p_club_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_dia date := ((now() at time zone 'America/Sao_Paulo') - interval '12 hours')::date;
  rjogo record;
  r record;
  v_marca text;
  v_nomes text := null;
  v_premiados uuid[] := array[]::uuid[];
  v_so_desb boolean := coalesce((public.config_valor(p_club_id, 'reflexo_so_desbravador') = 'sim'), false);
begin
  -- interruptor desligado = sem trio, sem +10 (os jogos estavam todos abertos)
  if not public._rodizio_ligado_clube(p_club_id) then return; end if;

  perform pg_advisory_xact_lock(hashtext('melhores-do-dia:' || p_club_id::text || ':' || v_dia::text));

  insert into public.jogos_liberados (club_id, chave, data)
  select p_club_id, c.valor, (now() at time zone 'America/Sao_Paulo')::date
  from public.config_clube c
  join public._jogos_do_clube(p_club_id) j on j.chave = c.valor and j.ativo
  where c.club_id = p_club_id and c.chave = 'jogo_da_semana' and c.valor not in ('reflexo', 'corrida')
  on conflict (club_id, chave, data) do nothing;

  for rjogo in select d.chave, d.nome from public._jogos_do_dia_clube(p_club_id, v_dia) d loop
    v_marca := rjogo.chave || ' ' || to_char(v_dia, 'DD/MM/YYYY');

    if exists (
      select 1 from public.pontos
      where club_id = p_club_id and origem = 'melhor_dia' and motivo like '%(' || v_marca || ')%'
    ) then
      continue;
    end if;

    select t.usuario_id, p.nome, t.estrelas into r
    from public.trilha_jogos t
    join public.organization_memberships m on m.user_id = t.usuario_id and m.organizational_unit_id = p_club_id
    join public.profiles p on p.id = t.usuario_id
    where t.club_id = p_club_id and t.data = v_dia and t.tipo = rjogo.chave
      and m.status = 'ativo' and m.role <> 'pais' and coalesce(p.teste, false) = false
      and (not v_so_desb or m.role = 'desbravador')
      and not (t.usuario_id = any(v_premiados))
    order by t.estrelas desc, t.created_at asc nulls last, t.usuario_id
    limit 1;
    if not found then continue; end if;

    v_premiados := v_premiados || r.usuario_id;
    insert into public.pontos (usuario_id, origem, pontos, motivo, club_id)
    values (r.usuario_id, 'melhor_dia', 10,
      '🥇 Melhor do dia no ' || rjogo.nome || ' — ' || r.estrelas || '★ (' || v_marca || ')', p_club_id);
    v_nomes := coalesce(v_nomes || ' · ', '') || coalesce(r.nome, 'Alguém') || ' no ' || rjogo.nome;
  end loop;

  if v_nomes is not null then
    insert into public.notificacoes (titulo, corpo, tipo, link, para, club_id)
    values ('🥇 Melhores do dia!',
      'Ontem: ' || v_nomes || ' — +10 pontos cada! Os Jogos do Dia de hoje já estão valendo. 🏃',
      'geral', '/trilha', 'todos', p_club_id);
  end if;
end;
$$;

create or replace function public._premiar_rodada_semana_clube(p_club_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  -- segunda-feira da semana que FECHOU (âncora -12h: vale rodando dom 23:55 ou
  -- seg de manhã, sempre julga a semana passada)
  v_seg date := (date_trunc('week', ((now() at time zone 'America/Sao_Paulo') - interval '12 hours')))::date;
  v_ini date := v_seg;         -- início (segunda, inclusivo)
  v_fim date := v_seg + 7;     -- fim (segunda seguinte, exclusivo)
  v_marca text := to_char(v_seg, 'DD/MM/YYYY');
  -- mesmo interruptor do reflexo (lido direto da config, sem depender da função)
  v_so_desb boolean := coalesce(
    (public.config_valor(p_club_id, 'reflexo_so_desbravador') = 'sim'), false);
  v_max int;
  v_nomes text;
  v_jogo text;
  v_nome_jogo text;
  v_prox text;
  v_nome_prox text;
  r record;
begin
  -- TRAVA DE CONCORRÊNCIA: se duas execuções acontecerem juntas (cron + rodar
  -- à mão, ou o cron disparar 2x), a 2ª espera a 1ª terminar e só então segue —
  -- aí já enxerga o que foi pago e não repete. (Mesmo truque do registrar_jogo.)
  perform pg_advisory_xact_lock(hashtext('rodada_semana:' || p_club_id::text));

  -- ===================================================================
  -- 🌟 CAMPEÃO DAS ESTRELAS DA SEMANA (+30)
  --    Idempotência: só paga se ainda não existe o lançamento desta semana.
  --    (exclui 'reflexo' da soma — ele pontua por recorde, não por estrela)
  -- ===================================================================
  if not exists (
    select 1 from public.pontos
    where club_id = p_club_id and origem = 'campeao'
      and motivo = '🌟 Campeão das estrelas da semana (' || v_marca || ')'
  ) then
    select max(soma) into v_max from (
      select sum(t.estrelas) as soma
      from public.trilha_jogos t
      join public.organization_memberships m on m.user_id = t.usuario_id and m.organizational_unit_id = p_club_id
      join public.profiles p on p.id = t.usuario_id
      where t.club_id = p_club_id and t.data >= v_ini and t.data < v_fim and t.tipo not in ('reflexo', 'corrida')
        and m.status = 'ativo' and m.role <> 'pais' and coalesce(p.teste, false) = false
        and (not v_so_desb or m.role = 'desbravador')
      group by t.usuario_id
    ) q;

    if v_max is not null and v_max > 0 then
      v_nomes := null;
      for r in
        select t.usuario_id, min(p.nome) as nome
        from public.trilha_jogos t
        join public.organization_memberships m on m.user_id = t.usuario_id and m.organizational_unit_id = p_club_id
        join public.profiles p on p.id = t.usuario_id
        where t.club_id = p_club_id and t.data >= v_ini and t.data < v_fim and t.tipo not in ('reflexo', 'corrida')
          and m.status = 'ativo' and m.role <> 'pais' and coalesce(p.teste, false) = false
          and (not v_so_desb or m.role = 'desbravador')
        group by t.usuario_id
        having sum(t.estrelas) = v_max
      loop
        insert into public.pontos (usuario_id, origem, pontos, motivo, club_id)
        values (r.usuario_id, 'campeao', 30,
          '🌟 Campeão das estrelas da semana (' || v_marca || ')', p_club_id);
        v_nomes := coalesce(v_nomes || ', ', '') || coalesce(r.nome, 'Alguém');
      end loop;

      if v_nomes is not null then
        insert into public.notificacoes (titulo, corpo, tipo, link, para, club_id)
        values ('🌟 Campeão das estrelas!',
          v_nomes || ' foi quem mais fez estrelas nos jogos essa semana e levou +30 pontos!',
          'geral', '/trilha', 'todos', p_club_id);
      end if;
    end if;
  end if;

  -- ===================================================================
  -- 🎲 JOGO DA SEMANA — o jogo que estava valendo (lido da config)
  -- ===================================================================
  v_jogo := public.config_valor(p_club_id, 'jogo_da_semana');

  -- (a) premia o melhor no jogo da semana (+20). Idempotência por SEMANA e
  --     baseada nos pontos já lançados: mesmo que o jogo já tenha rodado pra
  --     o próximo, isto não paga o jogo errado nem paga de novo.
  if v_jogo is not null and v_jogo <> ''
     and not exists (
       select 1 from public.pontos
       where club_id = p_club_id and origem = 'campeao'
         and motivo like '🎲 Campeão do jogo da semana:%(' || v_marca || ')'
     ) then
    select nome into v_nome_jogo from public._jogos_do_clube(p_club_id) where chave = v_jogo;

    select max(soma) into v_max from (
      select sum(t.estrelas) as soma
      from public.trilha_jogos t
      join public.organization_memberships m on m.user_id = t.usuario_id and m.organizational_unit_id = p_club_id
      join public.profiles p on p.id = t.usuario_id
      where t.club_id = p_club_id and t.tipo = v_jogo and t.data >= v_ini and t.data < v_fim
        and m.status = 'ativo' and m.role <> 'pais' and coalesce(p.teste, false) = false
        and (not v_so_desb or m.role = 'desbravador')
      group by t.usuario_id
    ) q;

    if v_max is not null and v_max > 0 then
      v_nomes := null;
      for r in
        select t.usuario_id, min(p.nome) as nome
        from public.trilha_jogos t
        join public.organization_memberships m on m.user_id = t.usuario_id and m.organizational_unit_id = p_club_id
        join public.profiles p on p.id = t.usuario_id
        where t.club_id = p_club_id and t.tipo = v_jogo and t.data >= v_ini and t.data < v_fim
          and m.status = 'ativo' and m.role <> 'pais' and coalesce(p.teste, false) = false
          and (not v_so_desb or m.role = 'desbravador')
        group by t.usuario_id
        having sum(t.estrelas) = v_max
      loop
        insert into public.pontos (usuario_id, origem, pontos, motivo, club_id)
        values (r.usuario_id, 'campeao', 20,
          '🎲 Campeão do jogo da semana: ' || coalesce(v_nome_jogo, v_jogo) || ' (' || v_marca || ')', p_club_id);
        v_nomes := coalesce(v_nomes || ', ', '') || coalesce(r.nome, 'Alguém');
      end loop;

      if v_nomes is not null then
        insert into public.notificacoes (titulo, corpo, tipo, link, para, club_id)
        values ('🎲 Campeão do jogo da semana!',
          v_nomes || ' foi o melhor no ' || coalesce(v_nome_jogo, v_jogo) || ' e levou +20 pontos!',
          'geral', '/trilha', 'todos', p_club_id);
      end if;
    end if;
  end if;

  -- (b) sorteia o jogo da PRÓXIMA semana (uma vez por semana). Se já rodou o
  --     sorteio desta semana, não mexe. Pior caso de re-sorteio só troca o jogo
  --     de novo — nunca mexe em pontos.
  if coalesce(public.config_valor(p_club_id, 'jogo_semana_rodada'), '') <> v_marca then
    -- de preferência um jogo ativo diferente do reflexo E do desta semana
    select chave into v_prox
    from public._jogos_do_clube(p_club_id)
    where ativo = true and chave not in ('reflexo', 'corrida') and chave <> coalesce(v_jogo, '')
    order by random() limit 1;

    -- se não sobrou opção diferente, aceita repetir (só não jogos de recorde)
    if v_prox is null then
      select chave into v_prox
      from public._jogos_do_clube(p_club_id)
      where ativo = true and chave not in ('reflexo', 'corrida')
      order by random() limit 1;
    end if;

    if v_prox is not null then
      insert into public.config_clube (club_id, chave, valor) values (p_club_id, 'jogo_da_semana', v_prox)
      on conflict (club_id, chave) do update set valor = excluded.valor;

      select nome into v_nome_prox from public._jogos_do_clube(p_club_id) where chave = v_prox;
      insert into public.notificacoes (titulo, corpo, tipo, link, para, club_id)
      values ('🎲 Novo jogo da semana!',
        'Essa semana o jogo que vale prêmio é o ' || coalesce(v_nome_prox, v_prox)
        || '! Quem fizer mais estrelas nele até domingo leva +20. 🏆',
        'geral', '/trilha', 'todos', p_club_id);
    end if;

    -- marca que o sorteio desta semana já foi feito
    insert into public.config_clube (club_id, chave, valor) values (p_club_id, 'jogo_semana_rodada', v_marca)
    on conflict (club_id, chave) do update set valor = excluded.valor;
  end if;
end;
$$;

-- ---------- 5) leilão: papel/unidade de quem dá lance; aviso de quem foi superado ----------
create or replace function public.dar_lance(p_item_id uuid, p_valor integer, p_unidades_extra uuid[] default null::uuid[])
returns json language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_club uuid := public.clube_atual_id();
  v_minha_unidade uuid;
  v_leilao_id uuid; v_leilao_status text; v_fecha_em timestamptz;
  v_preco_base int; v_incremento int; v_nome_item text;
  v_maior_valor int;
  v_unidades uuid[];
  v_u uuid;
  v_saldo int;
  v_ja_reservado_aqui int;
  v_lance_id uuid;
  v_nome_unidade text;
  v_pendente boolean;
  v_meu_papel text;
  v_superadas uuid[];   -- unidades que estavam na frente (serão avisadas)
begin
  if v_uid is null then raise exception 'Não autenticado.'; end if;
  if not public.leilao_habilitado(v_club) then raise exception 'O leilão não está habilitado para o seu clube.'; end if;
  if p_valor is null or p_valor <= 0 or p_valor > 1000000 then raise exception 'Lance inválido.'; end if;

  select unidade_id, role into v_minha_unidade, v_meu_papel
  from public.organization_memberships where user_id = v_uid and organizational_unit_id = v_club and status = 'ativo';
  if v_minha_unidade is null then
    raise exception 'Você precisa estar numa unidade (com cadastro aprovado) pra dar lance.';
  end if;
  if v_meu_papel not in ('desbravador', 'conselheiro') then
    raise exception 'Só desbravadores e conselheiros podem dar lance no leilão.';
  end if;

  select array_agg(distinct u) into v_unidades
  from unnest(array[v_minha_unidade] || coalesce(p_unidades_extra, '{}'::uuid[])) as u;
  v_pendente := array_length(v_unidades, 1) > 1;

  select it.leilao_id, it.preco_base, it.incremento_minimo, it.nome
    into v_leilao_id, v_preco_base, v_incremento, v_nome_item
  from public.leilao_itens it where it.id = p_item_id and it.club_id = v_club;
  if v_leilao_id is null then raise exception 'Item não encontrado.'; end if;

  select status, fecha_em into v_leilao_status, v_fecha_em
  from public.leiloes where id = v_leilao_id for update;
  if v_leilao_status <> 'aberto' then raise exception 'Esse leilão já encerrou.'; end if;
  if now() >= v_fecha_em then raise exception 'O tempo desse leilão acabou.'; end if;

  foreach v_u in array v_unidades loop
    if not exists (select 1 from public.unidades where id = v_u and club_id = v_club) then
      raise exception 'Uma das unidades convidadas não existe.';
    end if;
  end loop;

  select coalesce(max(valor), 0) into v_maior_valor
  from public.leilao_lances where item_id = p_item_id and status = 'ativo';

  if p_valor < v_preco_base then
    raise exception 'O lance mínimo desse item é % pontos.', v_preco_base;
  end if;
  if v_maior_valor > 0 and p_valor < v_maior_valor + v_incremento then
    raise exception 'Alguém já deu um lance maior. Dê pelo menos % pontos.', v_maior_valor + v_incremento;
  end if;

  if not v_pendente and exists (
    select 1 from public.leilao_lances l
    join public.leilao_lance_unidades lu on lu.lance_id = l.id
    where l.item_id = p_item_id and l.status = 'ativo' and lu.unidade_id = v_minha_unidade
  ) then
    raise exception 'Sua unidade já está na frente desse item.';
  end if;

  if v_pendente then
    insert into public.leilao_lances (item_id, criado_por, valor, status)
    values (p_item_id, v_uid, p_valor, 'pendente')
    returning id into v_lance_id;

    insert into public.leilao_lance_unidades (lance_id, unidade_id, confirmado)
    select v_lance_id, u, u = v_minha_unidade from unnest(v_unidades) as u;

    return json_build_object('id', v_lance_id, 'valor', p_valor, 'item', v_nome_item, 'pendente', true);
  end if;

  select public.leilao_saldo_unidade(v_minha_unidade) into v_saldo;
  select coalesce(sum(l.valor), 0) into v_ja_reservado_aqui
  from public.leilao_lances l
  join public.leilao_lance_unidades lu on lu.lance_id = l.id
  where l.item_id = p_item_id and l.status = 'ativo' and lu.unidade_id = v_minha_unidade;
  v_saldo := v_saldo + v_ja_reservado_aqui;
  if v_saldo < p_valor then
    select nome into v_nome_unidade from public.unidades where id = v_minha_unidade;
    raise exception 'Sua unidade (%) não tem % pontos disponíveis agora (tem %).',
      coalesce(v_nome_unidade, '?'), p_valor, v_saldo;
  end if;

  -- NOVO: guarda quais unidades estavam na frente (serão superadas agora)
  select array_agg(distinct lu.unidade_id) into v_superadas
  from public.leilao_lances l
  join public.leilao_lance_unidades lu on lu.lance_id = l.id
  where l.item_id = p_item_id and l.status = 'ativo' and lu.unidade_id <> v_minha_unidade;

  update public.leilao_lances set status = 'superado'
   where item_id = p_item_id and status = 'ativo';

  insert into public.leilao_lances (item_id, criado_por, valor, status)
  values (p_item_id, v_uid, p_valor, 'ativo')
  returning id into v_lance_id;

  insert into public.leilao_lance_unidades (lance_id, unidade_id, confirmado)
  values (v_lance_id, v_minha_unidade, true);

  -- NOVO: avisa os membros das unidades que acabaram de ser ultrapassadas (do MESMO clube do leilão)
  if v_superadas is not null and array_length(v_superadas, 1) > 0 then
    select nome into v_nome_unidade from public.unidades where id = v_minha_unidade;
    insert into public.notificacoes (titulo, corpo, tipo, link, para, para_usuario)
    select '⚡ Passaram sua unidade no leilão!',
      coalesce(v_nome_unidade, 'Outra unidade') || ' deu um lance de ' || p_valor || ' no '
        || v_nome_item || '. Sua unidade caiu — dê um lance maior pra voltar à frente! 🏆',
      'geral', '/leilao', 'pessoal', m.user_id
    from public.organization_memberships m
    where m.organizational_unit_id = v_club and m.unidade_id = any(v_superadas) and m.unidade_id <> v_minha_unidade
      and m.status = 'ativo' and m.role in ('desbravador', 'conselheiro');
  end if;

  return json_build_object('id', v_lance_id, 'valor', p_valor, 'item', v_nome_item, 'pendente', false);
end;
$$;

-- ---------- 6) desafios da semana: progresso da unidade num duelo ----------
create or replace function public.progresso_lado(p_uni uuid, p_tipo text, p_meta integer, p_desde timestamp with time zone)
returns json language sql security definer set search_path = '' as $$
  select case when public.membro_ativo_no_clube(public.clube_atual_id())
               and exists (select 1 from public.unidades un where un.id = p_uni and un.club_id = public.clube_atual_id()) then (
    with membros as (
      select p.id, p.nome, p.foto
      from public.organization_memberships m
      join public.profiles p on p.id = m.user_id
      where m.organizational_unit_id = public.clube_atual_id() and m.unidade_id = p_uni and m.status = 'ativo'
        and m.role in ('desbravador', 'conselheiro')
    ),
    conta as (
      select m.nome, m.foto,
        (select count(*) from public.pontos pt
          where pt.usuario_id = m.id and pt.data >= p_desde
            and case
                  when p_tipo = 'missoes'    then pt.origem = 'missao'
                  when p_tipo = 'jogos'      then pt.origem = 'trilha'
                  when p_tipo = 'devocional' then pt.origem = 'devocional'
                  when p_tipo = 'presenca'   then pt.origem = 'apontamento' and pt.marca->>'presenca' = 'presente'
                  else false
                end
        )::int as feito
      from membros m
    )
    select json_build_object(
      'membros', coalesce(json_agg(json_build_object(
          'nome', nome, 'foto', foto, 'feito', feito, 'cumpriu', feito >= p_meta
        ) order by feito desc, nome), '[]'::json),
      'cumpriram', (select count(*) from conta where feito >= p_meta),
      'total', (select count(*) from conta)
    ) from conta
  ) else json_build_object('membros', '[]'::json, 'cumpriram', 0, 'total', 0) end;
$$;

-- ---------- 7) ranking de jogos (trilha) ----------
create or replace function public.ranking_trilha()
returns json language sql security definer set search_path = '' as $$
  select case when public.membro_ativo_no_clube(public.clube_atual_id()) then (
    with base as (
      select p.id, p.nome, p.foto,
             coalesce(nullif(j.tipo, ''), 'memoria') as tipo,
             coalesce(j.estrelas, 0)                 as estrelas
      from public.trilha_jogos j
      join public.organization_memberships m on m.user_id = j.usuario_id and m.organizational_unit_id = public.clube_atual_id()
      join public.profiles p on p.id = j.usuario_id
      where j.club_id = public.clube_atual_id() and m.status = 'ativo' and m.role <> 'pais'
    ),
    agg as (
      select tipo, id, nome, foto, count(*)::int as passos, sum(estrelas)::int as estrelas
      from base group by tipo, id, nome, foto
      union all
      select 'geral' as tipo, id, nome, foto, count(*)::int as passos, sum(estrelas)::int as estrelas
      from base group by id, nome, foto
    )
    select coalesce(json_object_agg(tipo, linhas), '{}'::json)
    from (
      select tipo, json_agg(json_build_object('id', id, 'nome', nome, 'foto', foto,
             'passos', passos, 'estrelas', estrelas) order by estrelas desc, passos desc, nome) as linhas
      from agg group by tipo
    ) x
  ) else '{}'::json end;
$$;

-- ---------------------------------------------------------------------
-- 8) achado extra nesta auditoria: pontos.club_id, quando só usuario_id é
-- informado (a maioria dos lançamentos individuais), era sempre INFERIDO por
-- clube_vinculo_do_usuario(pessoa) — "o" clube dela, sem saber DE QUAL clube
-- é este ponto específico. Com multi-clube real, isso podia fazer um prêmio
-- do clube B cair no clube A (o "clube mais relevante" da pessoa), mesmo a
-- RPC/rotina já sabendo exatamente em qual clube o ponto nasceu.
-- Agora: quem grava o ponto já sabendo o clube passa club_id explícito — o
-- gatilho CONFERE (a pessoa precisa ter vínculo real nesse clube; nunca
-- confia cego) em vez de tentar adivinhar. Sem club_id explícito, o
-- comportamento de sempre (inferir) continua igual — ninguém quebra.
-- ---------------------------------------------------------------------
create or replace function public.definir_club_ponto() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_club_unidade uuid; v_club_pessoa uuid;
begin
  if new.unidade_id is not null then
    select club_id into v_club_unidade from public.unidades where id = new.unidade_id;
    -- unidade inexistente: para o cliente é a MESMA resposta de "unidade de outro clube" (antes caía no clube legado
    -- e só a chave estrangeira reclamava — dava para distinguir uma unidade que existe em outro clube)
    if v_club_unidade is null and public._sessao_de_cliente() then
      perform public._recusar_linha('pontos', 'Unidade inexistente.');
    end if;
  end if;
  if new.usuario_id is not null then
    if new.club_id is not null then
      -- clube já veio explícito de quem gravou (RPC/rotina que já sabe o clube certo): só CONFERE
      -- o vínculo, nunca tenta "adivinhar" outro (a pessoa pode ter vínculo em vários clubes).
      if not exists (
        select 1 from public.organization_memberships m
        where m.user_id = new.usuario_id and m.organizational_unit_id = new.club_id
      ) then
        perform public._recusar_linha('pontos', 'Pessoa sem vínculo com o clube informado.');
      end if;
      v_club_pessoa := new.club_id;
    else
      v_club_pessoa := public.clube_vinculo_do_usuario(new.usuario_id);
      if v_club_pessoa is null and public._sessao_de_cliente() then
        perform public._recusar_linha('pontos', 'Pessoa sem clube.');
      end if;
    end if;
  end if;
  if v_club_unidade is not null and v_club_pessoa is not null and v_club_unidade <> v_club_pessoa then
    perform public._recusar_linha('pontos', 'A pessoa e a unidade do ponto são de clubes diferentes.');
  end if;
  new.club_id := coalesce(v_club_unidade, v_club_pessoa, public.clube_legado_id());
  return new;
end;
$$;

-- registrar_jogo: já resolve v_club (clube_atual_id()) pra várias checagens — passa a informar
-- também no ponto, em vez de deixar o gatilho inferir "o" clube da pessoa.
create or replace function public.registrar_jogo(p_tipo text, p_estrelas integer, p_partida uuid default null::uuid)
returns json language plpgsql security definer set search_path = '' as $$
declare
  v_club uuid := public.clube_atual_id();
  v_uid uuid := auth.uid();
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_estrelas int := greatest(1, least(3, coalesce(p_estrelas, 1)));
  v_tipo text := coalesce(nullif(p_tipo, ''), 'memoria');
  v_ja int;
  v_pontos int;
  v_passos int;
  v_ini timestamptz;
  v_seg numeric;
  v_exigir boolean := coalesce(public.config_valor(public.clube_atual_id(), 'exigir_partida'), 'nao') = 'sim';
begin
  if v_uid is null then raise exception 'Não autenticado.'; end if;
  if not public.membro_ativo_no_clube(v_club) then
    raise exception 'Apenas membros ativos do clube podem jogar.';
  end if;
  if not exists (select 1 from public._jogos_do_clube(v_club) where chave = v_tipo) then
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
       and not exists (select 1 from public._jogos_liberados_do_clube(v_club) l where l.chave = v_tipo and l.data = v_hoje)
       and not ((now() at time zone 'America/Sao_Paulo')::time < time '00:10'
                and (exists (select 1 from public.jogos_do_dia(v_hoje - 1) d where d.chave = v_tipo)
                     or exists (select 1 from public._jogos_liberados_do_clube(v_club) l where l.chave = v_tipo and l.data = v_hoje - 1))) then
      raise exception 'Esse jogo abre outro dia! Feche e abra o app pra ver os 🥇 Jogos do Dia de hoje.';
    end if;
  end if;

  perform pg_advisory_xact_lock(hashtext(v_uid::text || ':' || v_hoje::text));

  select count(*) into v_ja
  from public.trilha_jogos where usuario_id = v_uid and data = v_hoje;

  v_pontos := v_estrelas * 10;   -- <<< era * 5 (agora 1⭐=10, 2⭐=20, 3⭐=30)

  insert into public.trilha_jogos (usuario_id, data, tipo, estrelas, club_id)
  values (v_uid, v_hoje, v_tipo, v_estrelas, v_club);

  insert into public.pontos (usuario_id, origem, pontos, motivo, club_id)
  values (v_uid, 'trilha', v_pontos,
          'Jogo ' || v_tipo || ' ' || to_char(v_hoje, 'DD/MM') || ' (' || v_estrelas || '⭐)', v_club);

  select count(*) into v_passos from public.trilha_jogos where usuario_id = v_uid;
  return json_build_object('pontos', v_pontos, 'estrelas', v_estrelas, 'passos', v_passos,
    'ja_jogou_hoje', v_ja, 'extra', v_ja > 0);
end;
$$;

create or replace function public.avaliar_missao(p_id uuid, p_aprovar boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare v_row record; v_club uuid := public.clube_atual_id();
begin
  if v_club is null or not public.pode_gerir_no_clube(v_club) then
    raise exception 'Sem permissão (apenas diretoria/instrutor).';
  end if;
  -- missão de outro clube = mesma resposta de "não encontrada" (sem revelar que o UUID existe)
  select * into v_row from public.missoes_feitas where id = p_id and status = 'pendente' and club_id = v_club;
  if not found then raise exception 'Missão não encontrada ou já avaliada.'; end if;
  if p_aprovar then
    update public.missoes_feitas set status = 'aprovada' where id = p_id;
    insert into public.pontos (usuario_id, origem, pontos, motivo, club_id)
    values (v_row.usuario_id, 'missao', coalesce(v_row.pontos_dados, 10), 'Missão ' || to_char(v_row.data, 'DD/MM') || ' (aprovada)', v_club);
  else
    update public.missoes_feitas set status = 'reprovada' where id = p_id;
  end if;
end;
$$;

create or replace function public.biblia_confirmar_leitura(p_livro_abrev text, p_capitulo integer)
returns json language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_club uuid := public.clube_atual_id();
  v_atual record;
  v_segundos int;
  v_pontos_hoje int;
  v_pontos_ganhos int := 0;
  v_limite boolean := false;
  v_total int;
begin
  if v_uid is null then raise exception 'Não autenticado.'; end if;
  -- Revalida o cadastro ativo aqui também (não só no abrir), pra quem foi
  -- desativado entre abrir e confirmar não pontuar.
  if not exists (select 1 from public.profiles where id = v_uid and status = 'ativo') then
    raise exception 'Você precisa estar com o cadastro ativo pra ganhar pontos lendo.';
  end if;

  -- Já lido? nada a fazer (não pontua de novo).
  if exists (select 1 from public.biblia_leituras
             where usuario_id = v_uid and livro_abrev = p_livro_abrev and capitulo = p_capitulo) then
    select count(*) into v_total from public.biblia_leituras where usuario_id = v_uid;
    return json_build_object('lido', true, 'ja_lido', true, 'pontos_ganhos', 0, 'total_capitulos_lidos', v_total);
  end if;

  -- Trava a linha da leitura em andamento (evita 2 confirmações em corrida).
  select * into v_atual from public.biblia_leitura_atual where usuario_id = v_uid for update;

  -- Não abriu, ou abriu OUTRO capítulo depois: não vale.
  if not found or v_atual.livro_abrev <> p_livro_abrev or v_atual.capitulo <> p_capitulo then
    return json_build_object('invalido', true);
  end if;

  v_segundos := public._biblia_segundos_min(p_livro_abrev, p_capitulo);
  if now() - v_atual.aberto_em < make_interval(secs => v_segundos) then
    return json_build_object('muito_rapido', true,
      'faltam', greatest(0, ceil(v_segundos - extract(epoch from (now() - v_atual.aberto_em)))::int));
  end if;

  -- Passou no tempo: marca como lido (permanente) e limpa a leitura atual.
  insert into public.biblia_leituras (usuario_id, livro_abrev, capitulo)
  values (v_uid, p_livro_abrev, p_capitulo)
  on conflict (usuario_id, livro_abrev, capitulo) do nothing;
  delete from public.biblia_leitura_atual where usuario_id = v_uid;

  -- Pontua (+2, teto 20/dia). Conta de teste não pontua.
  if not public.eh_teste() then
    select coalesce(sum(pontos), 0) into v_pontos_hoje from public.pontos
    where usuario_id = v_uid and origem = 'biblia'
      and (data at time zone 'America/Sao_Paulo')::date = (now() at time zone 'America/Sao_Paulo')::date;
    if v_pontos_hoje < 20 then
      v_pontos_ganhos := least(2, 20 - v_pontos_hoje);
      insert into public.pontos (usuario_id, origem, pontos, motivo, club_id)
      values (v_uid, 'biblia', v_pontos_ganhos,
              'Leu ' || (select nome from public.biblia_livros where abrev = p_livro_abrev) || ' ' || p_capitulo, v_club);
    else
      -- Leu de verdade mas já bateu o teto do dia: conta o progresso, avisa
      -- que o limite foi atingido (pra tela não parecer que "roubou" ponto).
      v_limite := true;
    end if;
  end if;

  select count(*) into v_total from public.biblia_leituras where usuario_id = v_uid;
  return json_build_object('lido', true, 'ja_lido', false, 'pontos_ganhos', v_pontos_ganhos,
                           'limite_diario', v_limite, 'total_capitulos_lidos', v_total);
end;
$$;

create or replace function public.bichinho_cuidar(p_acao text)
returns json language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_club uuid := public.clube_atual_id();
  b record;
  v_h numeric;
  v_fome int; v_hig int; v_fel int;
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_conta boolean := false;
  v_ativo boolean;
  v_pontos int := 0;
  v_sono interval;
begin
  if v_uid is null then raise exception 'Não autenticado.'; end if;
  if p_acao not in ('alimentar', 'banho', 'brincar') then raise exception 'Ação inválida.'; end if;

  select * into b from public.bichinhos where usuario_id = v_uid for update;
  if not found then raise exception 'Você ainda não tem um bichinho. Adote um! 🐾'; end if;

  if b.dormindo_desde is not null then
    v_sono := greatest(interval '0', now() - b.dormindo_desde);
    update public.bichinhos set
      dormindo_desde = null,
      atualizado_em = b.atualizado_em + v_sono,
      ultimo_cuidado_em = b.ultimo_cuidado_em + v_sono,
      pontuado_em = case when b.pontuado_em is null then null else b.pontuado_em + v_sono end
    where usuario_id = v_uid
    returning * into b;
  end if;

  if b.vivo and b.pontuado_em is not null and now() - b.ultimo_cuidado_em > interval '72 hours' then
    update public.bichinhos set vivo = false, morto_em = b.ultimo_cuidado_em + interval '72 hours'
      where usuario_id = v_uid;
    return json_build_object('morreu', true);
  end if;
  if not b.vivo then return json_build_object('morreu', true); end if;

  v_h := extract(epoch from (now() - b.atualizado_em)) / 3600.0;
  v_fome := greatest(0, b.fome       - floor(3 * v_h))::int;
  v_hig  := greatest(0, b.higiene    - floor(3 * v_h))::int;
  v_fel  := greatest(0, b.felicidade - floor(3 * v_h))::int;
  if p_acao = 'alimentar' then v_fome := 100;
  elsif p_acao = 'banho' then v_hig := 100;
  else v_fel := 100; end if;

  v_conta := (b.pontuado_em is null or now() - b.pontuado_em >= interval '20 hours');
  v_ativo := exists (select 1 from public.profiles where id = v_uid and status = 'ativo');

  update public.bichinhos set
    fome = v_fome, higiene = v_hig, felicidade = v_fel,
    atualizado_em = now(), ultimo_cuidado_em = now(),
    cuidados_total = b.cuidados_total + 1,
    dias_cuidados = b.dias_cuidados + (case when v_conta then 1 else 0 end),
    ofensiva = case
      when not v_conta then b.ofensiva
      when b.pontuado_em is not null and now() - b.pontuado_em < interval '48 hours' then b.ofensiva + 1
      else 1 end,
    pontuado_em = case when v_conta then now() else b.pontuado_em end
  where usuario_id = v_uid;

  if v_conta and v_ativo and not public.eh_teste() then
    v_pontos := 2;
    insert into public.pontos (usuario_id, origem, pontos, motivo, club_id)
    values (v_uid, 'bichinho', 2, 'Cuidou do bichinho ' || to_char(v_hoje, 'DD/MM'), v_club);
  end if;

  return json_build_object('ok', true, 'pontos_ganhos', v_pontos, 'contou', v_conta,
    'fome', v_fome, 'higiene', v_hig, 'felicidade', v_fel);
end;
$$;

create or replace function public.bonus_todos_jogos()
returns json language plpgsql security definer set search_path = '' as $$
declare
  v_club uuid := public.clube_atual_id();
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
  if not public.membro_ativo_no_clube(v_club) then
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
        select l.chave from public._jogos_liberados_do_clube(v_club) l
        join public._jogos_do_clube(v_club) j on j.chave = l.chave
        where l.data = v_hoje and j.ativo and l.chave not in ('reflexo', 'corrida')
      ) q
      join public._jogos_do_clube(v_club) jt on jt.chave = q.chave
      where not jt.requer_webgl;
  else
    insert into _abertos_hoje
      select j.chave from public._jogos_do_clube(v_club) j
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

  -- por CLUBE: completar os jogos do dia no B não pode "gastar" o bônus diário do A (jogos e
  -- prêmios são independentes por clube — a pessoa pode completar os dois e ganhar os dois)
  v_ja := exists (
    select 1 from public.pontos
    where usuario_id = v_uid and origem = 'bonus_dia' and club_id = v_club
      and (data at time zone 'America/Sao_Paulo')::date = v_hoje
  );
  if not v_ja then
    insert into public.pontos (usuario_id, origem, pontos, motivo, club_id)
    values (v_uid, 'bonus_dia', v_valor, '🎮 Completou os jogos do dia (' || v_marca || ')', v_club);
    v_ganhou := v_valor;
  end if;

  return json_build_object('completo', true, 'total', v_total, 'feitos', v_feitos, 'ganhou', v_ganhou, 'ja', v_ja);
end;
$$;

create or replace function public.registrar_devocional(p_resposta integer)
returns json language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_club uuid := public.clube_atual_id();
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_idx int := (v_hoje - date '2026-01-01');
  v_correta int; v_acertou boolean := false;
  v_livro_abrev text; v_capitulo int;
begin
  if v_uid is null then raise exception 'Não autenticado.'; end if;
  if not public.membro_ativo_no_clube(v_club) then
    raise exception 'Sem permissão: só quem é membro ativo do clube pontua.';
  end if;
  with v as (
    select vs.correta, vs.livro_abrev, vs.capitulo, row_number() over (order by vs.created_at, vs.id) - 1 as i
    from public.versiculos vs where vs.club_id = v_club and vs.ativo
  ), n as (select count(*) c from v)
  select v.correta, v.livro_abrev, v.capitulo into v_correta, v_livro_abrev, v_capitulo
  from v cross join n where n.c > 0 and v.i = (v_idx % nullif(n.c, 0));
  v_acertou := (p_resposta is not null and v_correta is not null and p_resposta = v_correta);
  insert into public.devocional (usuario_id, data, acertou_quiz, club_id)
  values (v_uid, v_hoje, v_acertou, v_club);
  insert into public.pontos (usuario_id, origem, pontos, motivo, club_id)
  values (v_uid, 'devocional', 5, 'Devocional ' || to_char(v_hoje, 'DD/MM'), v_club);
  return json_build_object('acertou', v_acertou, 'pontos', 5, 'livro_abrev', v_livro_abrev, 'capitulo', v_capitulo);
exception when unique_violation then
  raise exception 'Você já fez o devocional de hoje! 🙂';
end;
$$;

create or replace function public.registrar_missao(p_foto_url text, p_resposta integer)
returns json language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_club uuid := public.clube_atual_id();
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_idx int := (v_hoje - date '2026-01-01');
  v_classe text; v_correta int; v_pede_foto boolean := false;
  v_acertou boolean := false; v_pontos int;
begin
  if v_uid is null then raise exception 'Não autenticado.'; end if;
  if not public.membro_ativo_no_clube(v_club) then
    raise exception 'Sem permissão: só quem é membro ativo do clube pontua.';
  end if;
  select public.classe_por_nascimento(nascimento) into v_classe from public.profiles where id = v_uid;
  with d as (
    select ds.correta, ds.pede_foto, row_number() over (order by ds.created_at, ds.id) - 1 as i
    from public.desafios ds where ds.club_id = v_club and ds.ativo and (ds.classe = v_classe or ds.classe is null)
  ), n as (select count(*) c from d)
  select d.correta, d.pede_foto into v_correta, v_pede_foto
  from d cross join n where n.c > 0 and d.i = (v_idx % nullif(n.c, 0));

  v_acertou := (p_resposta is not null and v_correta is not null and p_resposta = v_correta);
  v_pontos := case when v_acertou then 10 else 5 end;

  if public.eh_teste() then
    return json_build_object('acertou', v_acertou, 'pontos', 0, 'status', 'aprovada', 'teste', true);
  end if;

  if v_pede_foto then
    insert into public.missoes_feitas (usuario_id, data, foto_url, acertou_quiz, status, pontos_dados, club_id)
    values (v_uid, v_hoje, p_foto_url, false, 'pendente', 10, v_club);
    return json_build_object('status', 'pendente');
  else
    insert into public.missoes_feitas (usuario_id, data, foto_url, acertou_quiz, status, pontos_dados, club_id)
    values (v_uid, v_hoje, p_foto_url, v_acertou, 'aprovada', v_pontos, v_club);
    insert into public.pontos (usuario_id, origem, pontos, motivo, club_id)
    values (v_uid, 'missao', v_pontos, 'Missão ' || to_char(v_hoje, 'DD/MM') || case when v_acertou then ' (acertou)' else '' end, v_club);
    return json_build_object('acertou', v_acertou, 'pontos', v_pontos, 'status', 'aprovada');
  end if;
exception when unique_violation then raise exception 'Você já fez a missão de hoje! Volte amanhã. 🙂';
end;
$$;

create or replace function public.resolver_ajuda(p_id uuid, p_tentativa text)
returns json language plpgsql security definer set search_path = '' as $$
declare
  v_club uuid := public.clube_atual_id();
  v_uid uuid := auth.uid();
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_a public.ajudas%rowtype;
  v_nome text;
  v_nomejogo text;
  v_teste boolean;
  v_ja int;
  v_ganhou int := 0;
begin
  if v_uid is null then raise exception 'Não autenticado.'; end if;
  if not public.membro_ativo_no_clube(v_club) then raise exception 'Sem permissão.'; end if;

  perform pg_advisory_xact_lock(hashtext(v_uid::text || ':resolver_ajuda:' || v_hoje::text));

  select * into v_a from public.ajudas where id = p_id and para_id = v_uid and status = 'aberto';
  if not found then return json_build_object('ok', false, 'erro', 'sumiu'); end if;

  if public.norm_txt(p_tentativa) <> public.norm_txt(v_a.resposta) then
    return json_build_object('ok', false);  -- errou; pode tentar de novo
  end if;

  update public.ajudas set status = 'resolvido', resolvido_por = v_uid, resolvido_em = now() where id = p_id;

  -- +5 pro ajudante, no máximo 3 ajudas premiadas por dia (conta teste não pontua)
  select coalesce(teste, false) into v_teste from public.profiles where id = v_uid;
  if not coalesce(v_teste, false) then
    select count(*) into v_ja from public.pontos
    where usuario_id = v_uid and origem = 'ajuda'
      and (data at time zone 'America/Sao_Paulo')::date = v_hoje;
    if v_ja < 3 then
      select nome into v_nome from public.profiles where id = v_a.de_id;
      select nome into v_nomejogo from public._jogos_do_clube(v_club) where chave = v_a.jogo;
      insert into public.pontos (usuario_id, origem, pontos, motivo, club_id)
      values (v_uid, 'ajuda', 5, '🤝 Ajudou ' || coalesce(v_nome, 'um amigo') || ' no ' || coalesce(v_nomejogo, v_a.jogo), v_club);
      v_ganhou := 5;
    end if;
  end if;

  -- avisa quem pediu (com o nome do ajudante)
  select nome into v_nome from public.profiles where id = v_uid;
  insert into public.notificacoes (titulo, corpo, tipo, link, para, para_usuario, criado_por)
  values ('🎉 Você foi ajudado!',
    coalesce(v_nome, 'Um amigo') || ' resolveu seu desafio! Abra o jogo pra ver a resposta.',
    'geral', '/trilha', 'pessoal', v_a.de_id, v_uid);

  return json_build_object('ok', true, 'ganhou', v_ganhou);
end;
$$;

-- ---------------------------------------------------------------------
-- 9) achados da re-auditoria (o primeiro levantamento usava \b, que no dialeto
-- de regex do Postgres é BACKSPACE literal, não limite de palavra — \y é o
-- certo; \b nunca bateu com nada, então funções com alias p./pr. escaparam da
-- 1ª rodada). Mais 4 funções de negócio, achadas com o padrão corrigido.
-- ---------------------------------------------------------------------
create or replace function public.atividade_jogos()
returns json language plpgsql stable security definer set search_path = '' as $$
declare
  v_club uuid := public.clube_atual_id();
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_seg date := (date_trunc('week', (now() at time zone 'America/Sao_Paulo')))::date;
begin
  if not public.pode_gerir_no_clube(v_club) then raise exception 'Sem permissão (apenas liderança).'; end if;
  return json_build_object(
    'hoje',   (select count(distinct usuario_id) from public.trilha_jogos where club_id = v_club and data = v_hoje),
    'semana', (select count(distinct usuario_id) from public.trilha_jogos where club_id = v_club and data >= v_seg),
    'total',  (select count(*) from public.organization_memberships m
               join public.profiles p on p.id = m.user_id
               where m.organizational_unit_id = v_club and m.status = 'ativo' and m.role = 'desbravador' and coalesce(p.teste, false) = false),
    'ausentes', coalesce((
      select json_agg(json_build_object('id', p.id, 'nome', p.nome, 'foto', p.foto, 'ultimo', u.ultimo)
                      order by u.ultimo nulls first, p.nome)
      from public.organization_memberships m
      join public.profiles p on p.id = m.user_id
      left join (select usuario_id, max(data) ultimo from public.trilha_jogos where club_id = v_club group by usuario_id) u on u.usuario_id = p.id
      where m.organizational_unit_id = v_club and m.status = 'ativo' and m.role = 'desbravador' and coalesce(p.teste, false) = false
        and (u.ultimo is null or u.ultimo < v_hoje - 1)
    ), '[]'::json)
  );
end;
$$;

-- aniversariantes: antes mandava 1 aviso, pro clube "mais relevante" da pessoa (clube_do_usuario,
-- limit 1) — agora manda 1 aviso PRA CADA clube em que ela tem vínculo ativo (cada comunidade
-- que ela faz parte celebra — nenhum vaza pro clube errado, nenhum some se ela tem 2 clubes).
create or replace function public.notif_aniversariantes_hoje() returns void
language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  for r in
    select p.nome, m.organizational_unit_id as club_id
    from public.profiles p
    join public.organization_memberships m on m.user_id = p.id and m.status = 'ativo'
    join public.organizational_units u on u.id = m.organizational_unit_id and u.type = 'clube'
    where p.nascimento is not null
      and to_char(p.nascimento, 'MM-DD') = to_char((now() at time zone 'America/Sao_Paulo'), 'MM-DD')
  loop
    insert into public.notificacoes (titulo, corpo, tipo, link, para, club_id)
    values ('🎂 Aniversário hoje!',
            'Hoje é aniversário de ' || coalesce(r.nome, 'um membro') || '. Mande os parabéns! 🥳',
            'aniversario', '/unidades', 'todos', r.club_id);
  end loop;
end;
$$;

create or replace function public.recordes_semana(p_jogo text)
returns json language sql stable security definer set search_path = '' as $$
  select case when public.membro_ativo_no_clube(public.clube_atual_id()) then coalesce((
    select json_agg(json_build_object(
      'id', t.usuario_id, 'nome', t.nome, 'foto', t.foto, 'pontos', t.pontos
    ) order by t.pontos desc, t.atualizado_em)
    from (
      select r.usuario_id, p.nome, p.foto, r.pontos, r.atualizado_em
      from public.recordes r
      join public.organization_memberships m on m.user_id = r.usuario_id and m.organizational_unit_id = public.clube_atual_id()
      join public.profiles p on p.id = r.usuario_id
      where r.club_id = public.clube_atual_id() and r.jogo = p_jogo
        and r.semana = (date_trunc('week', (now() at time zone 'America/Sao_Paulo')))::date
        and r.pontos > 0
        and m.status = 'ativo' and m.role <> 'pais' and coalesce(p.teste, false) = false
        and (not public.reflexo_so_desbravador() or m.role = 'desbravador')
      order by r.pontos desc, r.atualizado_em
      limit 20
    ) t
  ), '[]'::json) else '[]'::json end;
$$;

-- ---------------------------------------------------------------------
-- 10) achado maior da re-auditoria: um gatilho GENÉRICO, usado em 9 tabelas de
-- gameplay (trilha_jogos, recordes, partidas, chefao_golpes, bichinhos,
-- biblia_leituras, biblia_leitura_atual, missoes_feitas, devocional), também
-- sempre INFERIA o club_id por clube_vinculo_do_usuario(pessoa) — "o" clube
-- dela, nunca o clube da REQUISIÇÃO atual. Com multi-clube real, jogar/cuidar
-- do bichinho/etc. operando no clube B podia gravar o dado no clube A (o
-- clube "mais relevante" da pessoa) — não só o prêmio (item 8 acima), o
-- PRÓPRIO registro da jogada. Mesmo remédio: quem grava já sabendo o clube
-- (toda RPC client-facing já resolve clube_atual_id() pra outras checagens)
-- passa club_id explícito; o gatilho CONFERE o vínculo, nunca confia cego.
-- ---------------------------------------------------------------------
create or replace function public.definir_club_por_usuario() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_user uuid := (to_jsonb(new) ->> tg_argv[0])::uuid; v_club uuid;
begin
  if new.club_id is not null then
    if not exists (
      select 1 from public.organization_memberships m
      where m.user_id = v_user and m.organizational_unit_id = new.club_id
    ) then
      raise exception 'Usuário sem vínculo com o clube informado.';
    end if;
    return new;
  end if;
  v_club := public.clube_vinculo_do_usuario(v_user);
  if v_club is null then
    raise exception 'Usuário sem clube.';
  end if;
  new.club_id := v_club;
  return new;
end;
$$;

-- recordes: a chave única (usuario_id, jogo, semana) é de QUANDO só existia 1 clube por pessoa —
-- com multi-clube real, o recorde de reflexo/corrida da MESMA semana no clube B sobrescrevia o do
-- clube A (mesmo usuario_id+jogo+semana, "on conflict" caía na linha errada). club_id entra na
-- chave: cada clube tem o próprio recorde da semana, independente.
alter table public.recordes drop constraint if exists recordes_usuario_id_jogo_semana_key;
alter table public.recordes drop constraint if exists recordes_usuario_id_jogo_semana_club_key;
alter table public.recordes add constraint recordes_usuario_id_jogo_semana_club_key unique (usuario_id, jogo, semana, club_id);

create or replace function public.registrar_recorde(p_jogo text, p_pontos integer, p_partida uuid default null::uuid)
returns json language plpgsql security definer set search_path = '' as $$
declare
  v_club uuid := public.clube_atual_id();
  v_uid uuid := auth.uid();
  v_seg date := (date_trunc('week', (now() at time zone 'America/Sao_Paulo')))::date;
  v_pts int := greatest(0, least(coalesce(p_pontos, 0), 500));
  v_antigo int;
  p record;
  v_dur numeric;
  v_exigir boolean := coalesce(public.config_valor(public.clube_atual_id(), 'exigir_partida'), 'nao') = 'sim';
begin
  if v_uid is null then raise exception 'Não autenticado.'; end if;
  if not public.membro_ativo_no_clube(v_club) then
    return json_build_object('recorde', v_pts, 'melhorou', false);
  end if;
  if public.eh_teste() then
    return json_build_object('recorde', v_pts, 'melhorou', false, 'teste', true);
  end if;
  if not exists (select 1 from public._jogos_do_clube(v_club) where chave = p_jogo) then
    raise exception 'Jogo inválido.';
  end if;
  -- SÓ arcade tem recorde. Sem isto, dava pra semear um recorde mínimo em cada
  -- jogo NÃO-arcade e o prêmio de domingo (premiar_campeao_semana) pagaria +20
  -- por jogo (~+440/semana). A UI só cria recorde de reflexo/corrida, então
  -- isto não muda nada pro jogador legítimo.
  if p_jogo not in ('reflexo', 'corrida') then
    raise exception 'Esse jogo não é de recorde.';
  end if;

  if p_partida is not null then
    select * into p from public.partidas
     where id = p_partida and usuario_id = v_uid and jogo = p_jogo
       and now() <= validade_em
     for update;
    if not found then
      raise exception 'Partida inválida ou expirada — abra o jogo de novo. 🙂';
    end if;
    -- duração DESTA corrida = desde o envio anterior (ou desde o início).
    -- (raise desfaz a transação, então não gravamos 'suspeita' — seria rollback.)
    v_dur := extract(epoch from (now() - coalesce(p.ultima_submissao_em, p.iniciado_em)));
    if v_dur < 3 then
      raise exception 'Rápido demais — jogue de verdade! 🙂';
    end if;
    if v_pts > public._max_pontos_arcade(p_jogo, v_dur) then
      raise exception 'Esse resultado não bate com o tempo de jogo. 🙂';
    end if;
    update public.partidas
       set ultima_submissao_em = now(),
           resultado = greatest(coalesce(resultado, 0), v_pts)
     where id = p_partida;
  elsif v_exigir then
    raise exception 'Feche e abra o app pra atualizar, aí é só jogar de novo. 🙂';
  end if;

  -- Liderança barrada: joga normal, mas o recorde não entra na competição (papel do VÍNCULO no
  -- clube em uso — não "o" papel global da pessoa)
  if public.reflexo_so_desbravador()
     and not exists (
       select 1 from public.organization_memberships m
       where m.user_id = v_uid and m.organizational_unit_id = v_club and m.status = 'ativo' and m.role = 'desbravador'
     ) then
    return json_build_object('recorde', v_pts, 'melhorou', false, 'fora', true);
  end if;

  select pontos into v_antigo from public.recordes
  where usuario_id = v_uid and jogo = p_jogo and semana = v_seg and club_id = v_club;

  insert into public.recordes (usuario_id, jogo, semana, pontos, club_id)
  values (v_uid, p_jogo, v_seg, v_pts, v_club)
  on conflict (usuario_id, jogo, semana, club_id)
  do update set pontos = greatest(public.recordes.pontos, excluded.pontos),
                atualizado_em = now();

  return json_build_object(
    'recorde', greatest(coalesce(v_antigo, 0), v_pts),
    'melhorou', v_pts > coalesce(v_antigo, 0)
  );
end;
$$;

create or replace function public.chefao_golpe()
returns json language plpgsql security definer set search_path = '' as $$
declare
  v_club uuid := public.clube_atual_id();
  v_uid uuid := auth.uid();
  v_dano_golpe int := 25;
  v_ativo boolean;
  v_inicio text;
  v_vida int;
  v_ini timestamptz;
  v_fim timestamptz;
  v_ultimo timestamptz;
  v_dano int;
begin
  if v_uid is null then raise exception 'Não autenticado.'; end if;
  if not public.membro_ativo_no_clube(v_club) then raise exception 'Só membros ativos entram na batalha.'; end if;

  v_ativo := coalesce(public.config_valor(public.clube_atual_id(), 'chefao_ativo'), 'nao') = 'sim';
  v_inicio := public.config_valor(public.clube_atual_id(), 'chefao_inicio');
  if not v_ativo or v_inicio is null then raise exception 'Não tem chefão agora. 🙂'; end if;

  v_vida := greatest(1, coalesce(public.config_valor(public.clube_atual_id(), 'chefao_vida'), '3000')::int);
  v_ini := (v_inicio || ' 00:00:00')::timestamp at time zone 'America/Sao_Paulo';
  v_fim := v_ini + interval '2 days';
  if now() < v_ini or now() >= v_fim then raise exception 'A batalha não está rolando agora. 🙂'; end if;

  -- trava anti-flood: 1 golpe por hora
  -- por CLUBE: com multi-clube real, golpear no B não pode gastar o recarregamento do A
  select max(criado_em) into v_ultimo from public.chefao_golpes
  where usuario_id = v_uid and club_id = v_club and criado_em >= v_ini and criado_em < v_fim;
  if v_ultimo is not null and now() - v_ultimo < interval '1 hour' then
    raise exception 'Seu golpe especial recarrega 1x por hora — volta já já! ⏳';
  end if;

  insert into public.chefao_golpes (usuario_id, dano, club_id) values (v_uid, v_dano_golpe, v_club);

  -- dano total atualizado pra devolver a barra na hora (papel/status do VÍNCULO no clube em uso)
  select coalesce((select sum(p.pontos) from public.pontos p
      join public.organization_memberships m on m.user_id = p.usuario_id and m.organizational_unit_id = v_club
      join public.profiles pr on pr.id = p.usuario_id
      where p.data >= v_ini and p.data < v_fim and p.pontos > 0 and p.origem not in ('campeao','chefao')
        and m.status = 'ativo' and m.role <> 'pais' and coalesce(pr.teste, false) = false and p.club_id = v_club), 0)
    + coalesce((select sum(g.dano) from public.chefao_golpes g
      where g.club_id = v_club and g.criado_em >= v_ini and g.criado_em < v_fim), 0)
  into v_dano;

  return json_build_object('ok', true, 'dano_golpe', v_dano_golpe,
    'vida_atual', greatest(0, v_vida - v_dano), 'venceu', v_dano >= v_vida);
end;
$$;

create or replace function public.bichinho_adotar(p_nome text, p_especie text)
returns json language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_club uuid := public.clube_atual_id();
  v_nome text := trim(coalesce(p_nome, ''));
begin
  if v_uid is null then raise exception 'Não autenticado.'; end if;
  if not exists (select 1 from public.profiles where id = v_uid and status = 'ativo') then
    raise exception 'Seu cadastro precisa estar ativo pra adotar um bichinho.';
  end if;
  if p_especie not in ('cachorro', 'gato', 'coelho', 'passaro') then raise exception 'Espécie inválida.'; end if;
  if length(v_nome) < 1 then raise exception 'Dê um nome pro bichinho.'; end if;
  if length(v_nome) > 20 then raise exception 'Nome muito longo (máx. 20 letras).'; end if;

  perform pg_advisory_xact_lock(hashtext('bichinho:' || v_uid::text));

  if exists (select 1 from public.bichinhos b where b.usuario_id = v_uid and b.vivo
             and (b.dormindo_desde is not null or now() - b.ultimo_cuidado_em <= interval '72 hours')) then
    raise exception 'Você já tem um bichinho vivo! Cuide bem dele. 🐾';
  end if;

  insert into public.bichinhos
    (usuario_id, especie, nome, fome, higiene, felicidade, atualizado_em, ultimo_cuidado_em,
     pontuado_em, dias_cuidados, cuidados_total, ofensiva, vivo, morto_em, nascido_em, dormindo_desde, club_id)
  values (v_uid, p_especie, v_nome, 100, 100, 100, now(), now(), null, 0, 0, 0, true, null, now(), null, v_club)
  on conflict (usuario_id) do update set
    especie = excluded.especie, nome = excluded.nome, fome = 100, higiene = 100, felicidade = 100,
    atualizado_em = now(), ultimo_cuidado_em = now(), pontuado_em = null,
    dias_cuidados = 0, cuidados_total = 0, ofensiva = 0, vivo = true, morto_em = null, nascido_em = now(),
    dormindo_desde = null, club_id = excluded.club_id;

  return json_build_object('ok', true);
end;
$$;

create or replace function public.biblia_iniciar_leitura(p_livro_abrev text, p_capitulo integer)
returns json language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_club uuid := public.clube_atual_id();
  v_max int;
  v_req int;
  v_aberto timestamptz;
  v_restante int;
begin
  if v_uid is null then raise exception 'Não autenticado.'; end if;
  if not exists (select 1 from public.profiles where id = v_uid and status = 'ativo') then
    raise exception 'Você precisa estar com o cadastro ativo pra ler a Bíblia no app.';
  end if;
  select capitulos into v_max from public.biblia_livros where abrev = p_livro_abrev;
  if v_max is null then raise exception 'Livro inválido.'; end if;
  if p_capitulo < 1 or p_capitulo > v_max then raise exception 'Capítulo inválido.'; end if;

  -- Já lido antes? pode reler à vontade, sem tempo e sem pontos de novo.
  if exists (select 1 from public.biblia_leituras
             where usuario_id = v_uid and livro_abrev = p_livro_abrev and capitulo = p_capitulo) then
    return json_build_object('ja_lido', true, 'segundos', 0);
  end if;

  v_req := public._biblia_segundos_min(p_livro_abrev, p_capitulo);

  -- Marca ESTE como a leitura em andamento (troca qualquer outra que
  -- estivesse aberta — só dá pra ler um capítulo de cada vez). Se já era o
  -- mesmo capítulo, PRESERVA o aberto_em (retoma o tempo já corrido).
  insert into public.biblia_leitura_atual (usuario_id, livro_abrev, capitulo, aberto_em, club_id)
  values (v_uid, p_livro_abrev, p_capitulo, now(), v_club)
  on conflict (usuario_id) do update
    set livro_abrev = excluded.livro_abrev,
        capitulo = excluded.capitulo,
        club_id = excluded.club_id,
        aberto_em = case
          when biblia_leitura_atual.livro_abrev = excluded.livro_abrev
           and biblia_leitura_atual.capitulo = excluded.capitulo
          then biblia_leitura_atual.aberto_em
          else now()
        end
  returning aberto_em into v_aberto;

  v_restante := greatest(0, v_req - floor(extract(epoch from (now() - v_aberto)))::int);
  return json_build_object('ja_lido', false, 'segundos', v_restante);
end;
$$;

create or replace function public.iniciar_jogo(p_tipo text)
returns json language plpgsql security definer set search_path = '' as $$
declare
  v_club uuid := public.clube_atual_id();
  v_uid uuid := auth.uid();
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_arcade boolean;
  v_validade timestamptz;
  v_id uuid;
begin
  if v_uid is null then raise exception 'Não autenticado.'; end if;
  if not public.membro_ativo_no_clube(v_club) then
    raise exception 'Apenas membros ativos do clube podem jogar.';
  end if;
  if not exists (select 1 from public._jogos_do_clube(v_club) where chave = p_tipo) then
    raise exception 'Jogo inválido.';
  end if;

  -- anti-flood: ninguém precisa de 60 aberturas de jogo num dia
  if (select count(*) from public.partidas
      where usuario_id = v_uid and iniciado_em > now() - interval '24 hours') >= 60 then
    raise exception 'Muitas partidas hoje — respira e volta daqui a pouco. 🙂';
  end if;

  v_arcade := p_tipo in ('reflexo', 'corrida');

  -- jogo comum precisa estar ABERTO agora (rodízio/liberação); a partida
  -- "congela" essa autorização — o fim da partida não re-checa (resolve a
  -- virada de meia-noite sem janela de trapaça, pois o início foi validado)
  if not v_arcade and public.rodizio_ligado()
     and not exists (select 1 from public.jogos_do_dia(v_hoje) d where d.chave = p_tipo)
     and not exists (select 1 from public._jogos_liberados_do_clube(v_club) l where l.chave = p_tipo and l.data = v_hoje) then
    raise exception 'Esse jogo abre outro dia! Feche e abra o app pra ver os 🥇 Jogos do Dia de hoje.';
  end if;

  -- arcade: janela pros replays, mas CURTA — 15 min não cabe o "esperar ocioso
  -- e cravar 500 forjado" (reflexo precisaria de ~16,5 min) e ainda sobra muito
  -- pra qualquer partida real (uma corrida dura segundos). Estrela: 45 min.
  v_validade := now() + case when v_arcade then interval '15 minutes' else interval '45 minutes' end;

  insert into public.partidas (usuario_id, jogo, validade_em, club_id)
  values (v_uid, p_tipo, v_validade, v_club)
  returning id into v_id;

  return json_build_object('id', v_id, 'jogo', p_tipo, 'validade_em', v_validade);
end;
$$;

notify pgrst, 'reload schema';

insert into public.migracoes_aplicadas (arquivo)
values ('2026-09-21-jogos-sem-papel-de-profiles.sql')
on conflict (arquivo) do update set aplicada_em = now();
