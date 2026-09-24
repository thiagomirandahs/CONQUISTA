-- =============================================================================
--  Fase 9.1 — jogos, ajudas, duelo e lembretes contam SÓ o que aconteceu no clube.
--
--  A criança desbravadora em A e em B é uma pessoa só, mas o que ela faz na aba A é de A. Várias
--  rotinas liam `pontos`, `trilha_jogos`, `chefao_golpes` e `ajudas` pela PESSOA, sem o clube, e
--  o que ela fazia em um clube aparecia (e valia pontos) no outro:
--
--    · chefão          o dano do chefão de B somava pontos e golpes feitos em A — B podia ser dado
--                      como derrotado, e ela levava em B um prêmio pelo que fez em A. As três
--                      funções (estado, golpe, prêmio) calculavam o dano cada uma do seu jeito;
--                      agora usam uma conta só (_chefao_dano), e o "golpe recarregando" é por clube.
--    · duelo           o progresso de um lado (progresso_lado) contava missões, jogos, devocional e
--                      presença feitos em A no duelo de B — e a liderança julga o duelo por esse
--                      número.
--    · bônus do dia    os jogos feitos em A completavam os jogos do dia de B, e o bônus era pago em
--                      B sem ela ter jogado lá.
--    · trilha_jogos    DECISÃO: o índice único passa a ser (usuario, clube, data, tipo). O próprio
--                      bônus diário já dizia "jogos e prêmios são independentes por clube — a pessoa
--                      pode completar os dois e ganhar os dois"; com o índice por pessoa isso era
--                      impossível: quem jogou a memória em A ouvia "Você já jogou esse jogo hoje" em
--                      B, e o bônus de B nunca completava. registrar_jogo e meu_progresso_trilha
--                      passam a olhar o clube da aba. Jogo e ponto já eram gravados no clube da aba.
--    · ajuda           na aba B apareciam os pedidos de ajuda feitos em A (nome e foto de gente de
--                      A); resolver em B uma ajuda de A gravava +5 em B; o teto de 3 por dia e o
--                      aviso "você foi ajudado" não olhavam o clube; e pedir ajuda em B cancelava o
--                      pedido aberto em A.
--    · lembretes       "Sentimos sua falta" e "Ainda dá tempo de jogar" liam os jogos de todos os
--                      clubes, faziam o dedupe sem o clube e saíam SEM club_id (o gatilho carimbava
--                      o clube mais novo da pessoa: o lembrete de A aparecia na aba B).
--    · partidas        o token anti-trapaça aberto na aba A podia ser consumido pela aba B.
--    · presença        o front grava a presença como 'naHora' / 'atrasado' / 'faltou'; meus_filhos
--                      e o duelo de presença contavam 'presente' e davam sempre zero. Contam agora
--                      naHora e atrasado (e 'presente', que ainda existe em dado antigo e testes).
--
--  Nenhuma assinatura muda. Aplicada pelo SQL Editor numa transação só, como postgres.
-- =============================================================================


-- -----------------------------------------------------------------------------
--  1. Chefão: uma conta de dano só, por clube
-- -----------------------------------------------------------------------------
-- Quem conta: membro ATIVO e vigente do clube (não 'pais', não conta de teste). O que conta: os
-- pontos positivos ganhos NESTE clube na janela da batalha (menos os próprios prêmios de chefão e
-- de campeão) e os golpes dados NESTE clube. Uma linha por pessoa, com a unidade dela NESTE clube.
create or replace function public._chefao_dano(p_club uuid, p_ini timestamptz, p_fim timestamptz)
returns table (usuario_id uuid, unidade_id uuid, dano numeric)
language sql stable security definer set search_path = '' as $$
  with membros as (
    select distinct on (m.user_id) m.user_id, m.unidade_id
      from public.organization_memberships m
      join public.profiles pr on pr.id = m.user_id
     where m.organizational_unit_id = p_club and m.status = 'ativo' and m.role <> 'pais'
       and m.starts_at <= now() and (m.ends_at is null or m.ends_at > now())
       and coalesce(pr.teste, false) = false
     order by m.user_id, (m.unidade_id is not null) desc, m.created_at desc, m.id desc
  ), feito as (
    select p.usuario_id as uid, sum(p.pontos)::numeric as d
      from public.pontos p
     where p.club_id = p_club and p.usuario_id is not null
       and p.data >= p_ini and p.data < p_fim and p.pontos > 0
       and p.origem not in ('campeao', 'chefao')
     group by p.usuario_id
    union all
    select g.usuario_id, sum(g.dano)::numeric
      from public.chefao_golpes g
     where g.club_id = p_club and g.criado_em >= p_ini and g.criado_em < p_fim
     group by g.usuario_id
  )
  select mb.user_id, mb.unidade_id, sum(f.d)
    from feito f
    join membros mb on mb.user_id = f.uid
   group by mb.user_id, mb.unidade_id;
$$;
revoke all on function public._chefao_dano(uuid, timestamptz, timestamptz) from public, anon, authenticated;

create or replace function public._chefao_premiar_clube(p_club_id uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_ativo boolean;
  v_inicio text;
  v_vida int;
  v_nome text;
  v_ini timestamptz;
  v_fim timestamptz;
  v_dano numeric;   -- dano total do clube: a MESMA conta que a tela mostra (_chefao_dano)
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

  select coalesce(sum(d.dano), 0) into v_dano from public._chefao_dano(p_club_id, v_ini, v_fim) d;

  if v_dano >= v_vida then
    -- VITÓRIA: reparte a vida (v_vida) proporcional ao dano de cada um NESTE clube
    for r in select d.usuario_id as uid, d.dano as dano_user
               from public._chefao_dano(p_club_id, v_ini, v_fim) d
              where d.dano > 0
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
returns json
language plpgsql security definer set search_path = '' as $$
declare
  v_club uuid := public.clube_atual_id();
  v_uid uuid := auth.uid();
  v_ativo boolean;
  v_inicio text;
  v_vida int;
  v_ini timestamptz;
  v_fim timestamptz;
  v_dano int;
  v_por_unidade json;
  v_meu_ultimo timestamptz;
  v_no_evento boolean;
begin
  if v_uid is null then raise exception 'Não autenticado.'; end if;
  if not public.membro_ativo_no_clube(v_club) then return json_build_object('ativo', false); end if;

  v_ativo := coalesce(public.config_valor(v_club, 'chefao_ativo'), 'nao') = 'sim';
  v_inicio := public.config_valor(v_club, 'chefao_inicio');
  if not v_ativo or v_inicio is null then return json_build_object('ativo', false); end if;

  v_vida := greatest(1, coalesce(public.config_valor(v_club, 'chefao_vida'), '3000')::int);
  v_ini := (v_inicio || ' 00:00:00')::timestamp at time zone 'America/Sao_Paulo';
  v_fim := v_ini + interval '2 days'; -- sáb 00:00 -> seg 00:00 (cobre sáb+dom)
  v_no_evento := now() >= v_ini and now() < v_fim;

  -- a MESMA conta do prêmio: a barra da tela e o "derrotado" do cron não divergem mais
  select coalesce(sum(d.dano), 0)::int into v_dano from public._chefao_dano(v_club, v_ini, v_fim) d;

  -- placar por unidade — a unidade do VÍNCULO neste clube
  select coalesce(json_agg(json_build_object('unidade', u.nome, 'dano', t.dano) order by t.dano desc), '[]'::json)
    into v_por_unidade
    from (select d.unidade_id as uid, sum(d.dano)::int as dano
            from public._chefao_dano(v_club, v_ini, v_fim) d
           where d.unidade_id is not null
           group by d.unidade_id) t
    join public.unidades u on u.id = t.uid;

  -- o recarregamento do golpe é POR CLUBE, como em chefao_golpe: golpear em A não pode deixar o
  -- botão de B "recarregando" (a tela e o servidor divergiam)
  select max(g.criado_em) into v_meu_ultimo from public.chefao_golpes g
   where g.usuario_id = v_uid and g.club_id = v_club and g.criado_em >= v_ini and g.criado_em < v_fim;

  return json_build_object(
    'ativo', true,
    'nome', coalesce(public.config_valor(v_club, 'chefao_nome'), 'Chefão'),
    'emoji', coalesce(public.config_valor(v_club, 'chefao_emoji'), '🗿'),
    'versiculo', public.config_valor(v_club, 'chefao_versiculo'),
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

create or replace function public.chefao_golpe()
returns json
language plpgsql security definer set search_path = '' as $$
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

  v_ativo := coalesce(public.config_valor(v_club, 'chefao_ativo'), 'nao') = 'sim';
  v_inicio := public.config_valor(v_club, 'chefao_inicio');
  if not v_ativo or v_inicio is null then raise exception 'Não tem chefão agora. 🙂'; end if;

  v_vida := greatest(1, coalesce(public.config_valor(v_club, 'chefao_vida'), '3000')::int);
  v_ini := (v_inicio || ' 00:00:00')::timestamp at time zone 'America/Sao_Paulo';
  v_fim := v_ini + interval '2 days';
  if now() < v_ini or now() >= v_fim then raise exception 'A batalha não está rolando agora. 🙂'; end if;

  -- trava anti-flood: 1 golpe por hora, POR CLUBE (golpear no B não gasta o recarregamento do A)
  select max(criado_em) into v_ultimo from public.chefao_golpes
  where usuario_id = v_uid and club_id = v_club and criado_em >= v_ini and criado_em < v_fim;
  if v_ultimo is not null and now() - v_ultimo < interval '1 hour' then
    raise exception 'Seu golpe especial recarrega 1x por hora — volta já já! ⏳';
  end if;

  insert into public.chefao_golpes (usuario_id, dano, club_id) values (v_uid, v_dano_golpe, v_club);

  -- dano total atualizado pra devolver a barra na hora — a mesma conta da tela e do prêmio
  select coalesce(sum(d.dano), 0)::int into v_dano from public._chefao_dano(v_club, v_ini, v_fim) d;

  return json_build_object('ok', true, 'dano_golpe', v_dano_golpe,
    'vida_atual', greatest(0, v_vida - v_dano), 'venceu', v_dano >= v_vida);
end;
$$;


-- -----------------------------------------------------------------------------
--  2. Duelo: o progresso de um lado conta só o que foi feito no clube do duelo
-- -----------------------------------------------------------------------------
-- progresso_duelo só chama isto para um duelo do clube da aba (d.club_id = clube_atual_id()),
-- então "o clube do duelo" é clube_atual_id().
create or replace function public.progresso_lado(p_uni uuid, p_tipo text, p_meta integer, p_desde timestamptz)
returns json
language sql security definer set search_path = '' as $$
  select case when public.membro_ativo_no_clube(public.clube_atual_id())
               and exists (select 1 from public.unidades un where un.id = p_uni and un.club_id = public.clube_atual_id()) then (
    with membros as (
      select distinct p.id, p.nome, p.foto
      from public.organization_memberships m
      join public.profiles p on p.id = m.user_id
      where m.organizational_unit_id = public.clube_atual_id() and m.unidade_id = p_uni and m.status = 'ativo'
        and m.starts_at <= now() and (m.ends_at is null or m.ends_at > now())
        and m.role in ('desbravador', 'conselheiro')
    ),
    conta as (
      select m.nome, m.foto,
        (select count(*) from public.pontos pt
          where pt.usuario_id = m.id and pt.club_id = public.clube_atual_id() and pt.data >= p_desde
            and case
                  when p_tipo = 'missoes'    then pt.origem = 'missao'
                  when p_tipo = 'jogos'      then pt.origem = 'trilha'
                  when p_tipo = 'devocional' then pt.origem = 'devocional'
                  -- a chamada grava naHora/atrasado/faltou; 'presente' ficou de dado antigo
                  when p_tipo = 'presenca'   then pt.origem = 'apontamento'
                                                  and pt.marca->>'presenca' in ('naHora', 'atrasado', 'presente')
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


-- -----------------------------------------------------------------------------
--  3. Jogos do dia: "já jogou" e o bônus são POR CLUBE
-- -----------------------------------------------------------------------------
-- O índice novo é mais frouxo que o antigo (acrescenta uma coluna): criá-lo nunca falha com os
-- dados que já existem.
create unique index if not exists trilha_jogos_usuario_clube_data_tipo_key
  on public.trilha_jogos (usuario_id, club_id, data, tipo);
drop index if exists public.trilha_jogos_usuario_data_tipo_key;

create or replace function public.registrar_jogo(p_tipo text, p_estrelas integer, p_partida uuid default null)
returns json
language plpgsql security definer set search_path = '' as $$
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

  -- "já jogou hoje" é NESTE clube: os jogos do dia de cada clube são independentes
  if exists (select 1 from public.trilha_jogos
             where usuario_id = v_uid and club_id = v_club and data = v_hoje and tipo = v_tipo) then
    raise exception 'Você já jogou esse jogo hoje! Escolha outro 🙂';
  end if;

  if p_partida is not null then
    -- a partida tem de ter sido aberta NESTE clube (o token de uma aba não vale na outra)
    update public.partidas
       set consumida_em = now(), resultado = v_estrelas
     where id = p_partida and usuario_id = v_uid and jogo = v_tipo and club_id = v_club
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
  from public.trilha_jogos where usuario_id = v_uid and club_id = v_club and data = v_hoje;

  v_pontos := v_estrelas * 10;   -- 1⭐=10, 2⭐=20, 3⭐=30

  insert into public.trilha_jogos (usuario_id, data, tipo, estrelas, club_id)
  values (v_uid, v_hoje, v_tipo, v_estrelas, v_club);

  insert into public.pontos (usuario_id, origem, pontos, motivo, club_id)
  values (v_uid, 'trilha', v_pontos,
          'Jogo ' || v_tipo || ' ' || to_char(v_hoje, 'DD/MM') || ' (' || v_estrelas || '⭐)', v_club);

  select count(*) into v_passos from public.trilha_jogos where usuario_id = v_uid and club_id = v_club;
  return json_build_object('pontos', v_pontos, 'estrelas', v_estrelas, 'passos', v_passos,
    'ja_jogou_hoje', v_ja, 'extra', v_ja > 0);
end;
$$;

-- A tela da trilha pergunta "o que eu já joguei hoje?" para marcar os jogos feitos. A resposta é
-- do clube da aba — senão a aba B mostraria como feito (e travaria) o que foi jogado em A.
create or replace function public.meu_progresso_trilha()
returns json
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_club uuid := public.clube_atual_id();
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_passos int := 0;
  v_hoje_tipos json;
begin
  if v_uid is null or v_club is null then
    return json_build_object('feito', false, 'passos', 0, 'hoje', '[]'::json);
  end if;

  select count(*) into v_passos from public.trilha_jogos where usuario_id = v_uid and club_id = v_club;

  select coalesce(json_agg(tipo), '[]'::json) into v_hoje_tipos
  from public.trilha_jogos where usuario_id = v_uid and club_id = v_club and data = v_hoje;

  return json_build_object(
    'feito', exists (select 1 from public.trilha_jogos where usuario_id = v_uid and club_id = v_club and data = v_hoje),
    'passos', v_passos,
    'hoje', v_hoje_tipos
  );
end;
$$;

create or replace function public.bonus_todos_jogos()
returns json
language plpgsql security definer set search_path = '' as $$
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

  v_valor := case when v_on then 30 else 50 end;

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

  -- só os jogos feitos NESTE clube: jogar tudo em A não completa os jogos do dia de B
  select count(distinct t.tipo) into v_feitos
  from public.trilha_jogos t
  where t.usuario_id = v_uid and t.club_id = v_club and t.data = v_hoje
    and t.tipo in (select chave from _abertos_hoje);

  if v_total = 0 or v_feitos < v_total then
    return json_build_object('completo', false, 'total', v_total, 'feitos', v_feitos, 'ganhou', 0);
  end if;

  if coalesce((select teste from public.profiles where id = v_uid), false) then
    return json_build_object('completo', true, 'total', v_total, 'feitos', v_feitos, 'ganhou', 0, 'teste', true);
  end if;

  perform pg_advisory_xact_lock(hashtext(v_uid::text || ':bonus_dia:' || v_hoje::text));

  -- por CLUBE: jogos e prêmios são independentes por clube — a pessoa pode completar os dois e
  -- ganhar os dois (e, desde esta migration, consegue de verdade: o índice de trilha_jogos também
  -- é por clube)
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

-- recorde: a partida também tem de ser deste clube
create or replace function public.registrar_recorde(p_jogo text, p_pontos integer, p_partida uuid default null)
returns json
language plpgsql security definer set search_path = '' as $$
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
  -- SÓ arcade tem recorde (sem isto, dava pra semear recorde em jogo comum e receber o prêmio de
  -- domingo por jogo)
  if p_jogo not in ('reflexo', 'corrida') then
    raise exception 'Esse jogo não é de recorde.';
  end if;

  if p_partida is not null then
    select * into p from public.partidas
     where id = p_partida and usuario_id = v_uid and jogo = p_jogo and club_id = v_club
       and now() <= validade_em
     for update;
    if not found then
      raise exception 'Partida inválida ou expirada — abra o jogo de novo. 🙂';
    end if;
    -- duração DESTA corrida = desde o envio anterior (ou desde o início)
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
  -- clube em uso)
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


-- -----------------------------------------------------------------------------
--  4. Ajuda entre amigos: só as ajudas do clube da aba
-- -----------------------------------------------------------------------------
create or replace function public.ajudas_recebidas()
returns json
language sql stable security definer set search_path = '' as $$
  select case when public.membro_ativo_no_clube(public.clube_atual_id()) then coalesce((
    select json_agg(json_build_object(
      'id', a.id, 'jogo', a.jogo, 'enunciado', a.enunciado,
      'de_nome', p.nome, 'de_foto', p.foto, 'criado_em', a.criado_em
    ) order by a.criado_em)
    from public.ajudas a join public.profiles p on p.id = a.de_id
    -- só as pedidas NESTE clube: na aba B não aparece nome e foto de quem pediu em A
    where a.para_id = auth.uid() and a.status = 'aberto' and a.club_id = public.clube_atual_id()
  ), '[]'::json) else '[]'::json end;
$$;

create or replace function public.resolver_ajuda(p_id uuid, p_tentativa text)
returns json
language plpgsql security definer set search_path = '' as $$
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

  -- a ajuda tem de ser DESTE clube: uma ajuda pedida em A não se resolve (nem pontua) na aba B.
  -- Para quem está na aba B, uma ajuda de A "sumiu" — a mesma resposta de uma que não existe.
  select * into v_a from public.ajudas
   where id = p_id and para_id = v_uid and status = 'aberto' and club_id = v_club;
  if not found then return json_build_object('ok', false, 'erro', 'sumiu'); end if;

  if public.norm_txt(p_tentativa) <> public.norm_txt(v_a.resposta) then
    return json_build_object('ok', false);  -- errou; pode tentar de novo
  end if;

  update public.ajudas set status = 'resolvido', resolvido_por = v_uid, resolvido_em = now() where id = p_id;

  -- +5 pro ajudante, no máximo 3 ajudas premiadas por dia NESTE clube (conta teste não pontua).
  -- O ponto e o teto são do clube da AJUDA.
  select coalesce(teste, false) into v_teste from public.profiles where id = v_uid;
  if not coalesce(v_teste, false) then
    select count(*) into v_ja from public.pontos
    where usuario_id = v_uid and origem = 'ajuda' and club_id = v_a.club_id
      and (data at time zone 'America/Sao_Paulo')::date = v_hoje;
    if v_ja < 3 then
      select nome into v_nome from public.profiles where id = v_a.de_id;
      select nome into v_nomejogo from public._jogos_do_clube(v_a.club_id) where chave = v_a.jogo;
      insert into public.pontos (usuario_id, origem, pontos, motivo, club_id)
      values (v_uid, 'ajuda', 5, '🤝 Ajudou ' || coalesce(v_nome, 'um amigo') || ' no ' || coalesce(v_nomejogo, v_a.jogo), v_a.club_id);
      v_ganhou := 5;
    end if;
  end if;

  -- avisa quem pediu (com o nome do ajudante), no clube da ajuda
  select nome into v_nome from public.profiles where id = v_uid;
  insert into public.notificacoes (titulo, corpo, tipo, link, para, para_usuario, criado_por, club_id)
  values ('🎉 Você foi ajudado!',
    coalesce(v_nome, 'Um amigo') || ' resolveu seu desafio! Abra o jogo pra ver a resposta.',
    'geral', '/trilha', 'pessoal', v_a.de_id, v_uid, v_a.club_id);

  return json_build_object('ok', true, 'ganhou', v_ganhou);
end;
$$;

create or replace function public.pedir_ajuda(p_para uuid, p_jogo text, p_enunciado jsonb, p_resposta text)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_club uuid := public.clube_atual_id();
  v_uid uuid := auth.uid();
  v_id uuid;
  v_nome text;
  v_nomejogo text;
  v_ja_aberto boolean;
begin
  if v_uid is null then raise exception 'Não autenticado.'; end if;
  if not public.membro_ativo_no_clube(v_club) then raise exception 'Sem permissão.'; end if;
  if p_jogo not in ('anagrama', 'forca', 'termo') then raise exception 'Jogo inválido.'; end if;
  if p_para = v_uid then raise exception 'Escolha um amigo (não você mesmo).'; end if;
  if not exists (select 1 from public.organization_memberships m
                  where m.user_id = p_para and m.organizational_unit_id = v_club
                    and m.role <> 'pais' and m.status = 'ativo'
                    and m.starts_at <= now() and (m.ends_at is null or m.ends_at > now())) then
    raise exception 'Amigo inválido.';
  end if;
  if coalesce(trim(p_resposta), '') = '' then raise exception 'Desafio sem resposta.'; end if;

  perform pg_advisory_xact_lock(hashtext(v_uid::text || ':pedir_ajuda'));

  -- ANTI-FLOOD: no máximo 5 pedidos a cada 5 minutos, somando os clubes (é a caixa de colegas
  -- que se protege, e o ritmo de quem pede é um só)
  if (select count(*) from public.ajudas where de_id = v_uid and criado_em > now() - interval '5 minutes') >= 5 then
    raise exception 'Você pediu ajuda demais agora. Espere um pouquinho 🙂';
  end if;

  -- já havia pedido ABERTO pra ESTE mesmo amigo, NESTE clube? então NÃO re-notifica
  v_ja_aberto := exists (select 1 from public.ajudas
                          where de_id = v_uid and para_id = p_para and status = 'aberto' and club_id = v_club);

  -- só 1 pedido aberto por vez, POR CLUBE: pedir ajuda na aba B não cancela o pedido aberto em A
  update public.ajudas set status = 'cancelado' where de_id = v_uid and status = 'aberto' and club_id = v_club;
  insert into public.ajudas (club_id, de_id, para_id, jogo, enunciado, resposta)
  values (v_club, v_uid, p_para, p_jogo, p_enunciado, p_resposta)
  returning id into v_id;

  if not v_ja_aberto then
    select nome into v_nome from public.profiles where id = v_uid;
    select nome into v_nomejogo from public._jogos_do_clube(v_club) where chave = p_jogo;
    -- notificação direcionada ao amigo (feita aqui dentro pois o cliente não pode inserir notificação)
    insert into public.notificacoes (club_id, titulo, corpo, tipo, link, para, para_usuario, criado_por)
    values (v_club, '🆘 Pedido de ajuda!',
      coalesce(v_nome, 'Um amigo') || ' precisou da sua ajuda no ' || coalesce(v_nomejogo, p_jogo) || '! Abra os 🎮 Jogos e ajude.',
      'geral', '/trilha', 'pessoal', p_para, v_uid);
  end if;

  return v_id;
end;
$$;


-- -----------------------------------------------------------------------------
--  5. Lembretes diários (cron): leituras, dedupe e aviso no clube do cron
-- -----------------------------------------------------------------------------
create or replace function public._lembrar_ausentes_clube(p_club_id uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  r record;
begin
  -- idempotência: no máximo 1x por dia, por clube
  if coalesce(public.config_valor(p_club_id, 'lembrete_ausencia_dia'), '') = v_hoje::text then
    return;
  end if;
  for r in
    select distinct m.user_id as id
    from public.organization_memberships m
    join public.profiles p on p.id = m.user_id
    where m.status = 'ativo' and m.role = 'desbravador' and m.organizational_unit_id = p_club_id
      and m.starts_at <= now() and (m.ends_at is null or m.ends_at > now())
      and coalesce(p.teste, false) = false
      -- 2+ dias sem jogar NESTE clube: nada ontem nem hoje aqui (jogar em B não é "estar" em A)
      and not exists (select 1 from public.trilha_jogos t
                       where t.usuario_id = m.user_id and t.club_id = p_club_id and t.data >= v_hoje - 1)
      -- não repetir: não lembrado NESTE clube nos últimos 2 dias (o dedupe global fazia o clube
      -- mais antigo nunca mandar o próprio lembrete)
      and not exists (
        select 1 from public.notificacoes n
        where n.para_usuario = m.user_id and n.club_id = p_club_id and n.titulo = '🎮 Sentimos sua falta!'
          and (n.created_at at time zone 'America/Sao_Paulo')::date >= v_hoje - 1
      )
  loop
    -- club_id explícito: sem ele, o gatilho carimbava o clube mais novo da pessoa
    insert into public.notificacoes (titulo, corpo, tipo, link, para, para_usuario, club_id)
    values ('🎮 Sentimos sua falta!',
      'Já faz uns dias que você não joga! Vem ganhar pontos — tem jogo novo te esperando. 🎁',
      'geral', '/trilha', 'pessoal', r.id, p_club_id);
  end loop;
  insert into public.config_clube (club_id, chave, valor) values (p_club_id, 'lembrete_ausencia_dia', v_hoje::text)
  on conflict (club_id, chave) do update set valor = excluded.valor;
end;
$$;

create or replace function public._lembrar_jogos_do_dia_clube(p_club_id uuid)
returns void
language plpgsql security definer set search_path = '' as $$
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
    select distinct m.user_id as id
    from public.organization_memberships m
    join public.profiles p on p.id = m.user_id
    where m.status = 'ativo' and m.role = 'desbravador' and m.organizational_unit_id = p_club_id
      and m.starts_at <= now() and (m.ends_at is null or m.ends_at > now())
      and coalesce(p.teste, false) = false
      and (
        -- os jogos do dia DESTE clube, feitos NESTE clube
        select count(distinct t.tipo) from public.trilha_jogos t
        where t.usuario_id = m.user_id and t.club_id = p_club_id and t.data = v_hoje
          and t.tipo in (select chave from _abertos_lembrete)
      ) < v_total
  loop
    insert into public.notificacoes (titulo, corpo, tipo, link, para, para_usuario, club_id)
    values ('🎮 Ainda dá tempo de jogar!',
      'Complete os jogos de hoje e ganhe o bônus do dia! 🎁',
      'geral', '/trilha', 'pessoal', r.id, p_club_id);
  end loop;
  insert into public.config_clube (club_id, chave, valor) values (p_club_id, 'lembrete_jogos_dia', v_hoje::text)
  on conflict (club_id, chave) do update set valor = excluded.valor;
end;
$$;


-- -----------------------------------------------------------------------------
--  6. Presença: o que a chamada grava de verdade
-- -----------------------------------------------------------------------------
create or replace function public.meus_filhos()
returns json
language sql security definer set search_path = '' as $$
  select coalesce(json_agg(f order by f->>'nome'), '[]'::json) from (
    select json_build_object(
      'id', c.id, 'nome', c.nome, 'foto', c.foto, 'unidade', u.nome,
      'pontos', coalesce((select sum(pontos)::int from public.pontos where usuario_id = c.id and club_id = r.club_id), 0),
      -- a chamada grava naHora/atrasado/faltou; 'presente' ficou de dado antigo
      'presencas', coalesce((select count(*) from public.pontos
                    where usuario_id = c.id and club_id = r.club_id and origem = 'apontamento'
                      and marca->>'presenca' in ('naHora', 'atrasado', 'presente')), 0),
      'faltas', coalesce((select count(*) from public.pontos
                    where usuario_id = c.id and club_id = r.club_id and origem = 'apontamento' and marca->>'presenca' = 'faltou'), 0),
      'mensalidades_pendentes', coalesce((
                    select json_agg(json_build_object('mes', m.mes, 'ano', m.ano, 'valor', m.valor) order by m.ano, m.mes)
                    from public.mensalidades m where m.desbravador_id = c.id and m.club_id = r.club_id and m.status = 'pendente'), '[]'::json)
    ) as f
    from public.responsaveis r
    join public.profiles c on c.id = r.desbravador_id
    left join public.unidades u on u.id = public.unidade_no_clube(c.id, r.club_id)
    where r.responsavel_id = auth.uid() and r.status = 'aprovado'
      and r.club_id = public.clube_atual_id()
  ) t;
$$;
