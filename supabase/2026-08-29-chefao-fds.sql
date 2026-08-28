-- =====================================================================
--  Filhos da Conquista — ⚔️ Chefão do Fim de Semana (2026-08-29)
--
--  Evento COOPERATIVO de sábado+domingo: o clube inteiro une forças pra
--  derrotar um chefão gigante (Golias, A Tempestade...). Cada PONTO que a
--  criança já ganha no fim de semana (jogos, missões, Bíblia) vira DANO numa
--  barra de vida que todo mundo vê caindo ao vivo. Ninguém perde — todos
--  contra o monstro. Golpe especial 1x/hora. Se zerar a vida até domingo,
--  vitória coletiva com bônus. Some domingo à noite.
--
--  COMO FUNCIONA (nada de ponto novo pra "dano" — só CANALIZA o que já existe):
--   * dano = soma dos pontos POSITIVOS do fim de semana (exclui prêmios
--     'campeao'/'chefao' pra não inflar) + os golpes especiais.
--   * a barra e o placar por unidade saem de chefao_estado() (1 chamada).
--   * a liderança configura o chefão (nome/emoji/vida/versículo/data/ligar)
--     em chefao_config() — nasce DESLIGADO.
--   * premiação no domingo 23:56 BRT (pg_cron), idempotente.
--
--  SEGURANÇA: golpe limitado a 1x/hora no servidor; só membro ativo; pontos
--  de dano vêm das RPCs anti-fraude que já existem; config só pela liderança
--  (pode_gerir). Cooperativo: mostra dano por UNIDADE, nunca "quem fez menos".
--
--  COMO APLICAR: Supabase -> SQL Editor -> New query -> cole -> Run. Idempotente.
--  Depende de: config_clube, pontos(data/unidade_id), profiles(unidade_id),
--  unidades, pode_gerir(), eh_membro_ativo() e pg_cron ativos.
-- =====================================================================

set lock_timeout = '10s';

-- 0) Interruptor (nasce DESLIGADO)
insert into public.config_clube (chave, valor) values ('chefao_ativo', 'nao')
on conflict (chave) do nothing;

-- 1) Golpes especiais (também serve de "quem participou" e placar por unidade)
create table if not exists public.chefao_golpes (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references public.profiles(id) on delete cascade,
  criado_em timestamptz not null default now(),
  dano int not null default 25
);
create index if not exists chefao_golpes_tempo on public.chefao_golpes (criado_em desc);
create index if not exists chefao_golpes_user on public.chefao_golpes (usuario_id, criado_em desc);
alter table public.chefao_golpes enable row level security;
-- leitura/escrita só pelas RPCs security definer (sem policy = ninguém direto)

-- 2) Estado ao vivo do chefão (1 chamada devolve tudo pra tela)
create or replace function public.chefao_estado()
returns json language plpgsql security definer set search_path = '' as $$
declare
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
  if not public.eh_membro_ativo() then return json_build_object('ativo', false); end if;

  v_ativo := coalesce((select valor from public.config_clube where chave = 'chefao_ativo'), 'nao') = 'sim';
  v_inicio := (select valor from public.config_clube where chave = 'chefao_inicio');
  if not v_ativo or v_inicio is null then return json_build_object('ativo', false); end if;

  v_vida := greatest(1, coalesce((select valor from public.config_clube where chave = 'chefao_vida'), '3000')::int);
  v_ini := (v_inicio || ' 00:00:00')::timestamp at time zone 'America/Sao_Paulo';
  v_fim := v_ini + interval '2 days'; -- sáb 00:00 -> seg 00:00 (cobre sáb+dom)
  v_no_evento := now() >= v_ini and now() < v_fim;

  select coalesce(sum(p.pontos), 0) into v_dano_pontos
  from public.pontos p
  join public.profiles pr on pr.id = p.usuario_id
  where p.data >= v_ini and p.data < v_fim and p.pontos > 0
    and p.origem not in ('campeao', 'chefao')
    and pr.status = 'ativo' and pr.papel <> 'pais' and coalesce(pr.teste, false) = false;

  select coalesce(sum(g.dano), 0) into v_dano_golpes
  from public.chefao_golpes g
  where g.criado_em >= v_ini and g.criado_em < v_fim;

  v_dano := v_dano_pontos + v_dano_golpes;

  -- placar por unidade (pontos + golpes somados por unidade)
  with dano_uni as (
    select pr.unidade_id as uid, sum(p.pontos)::int as dano
    from public.pontos p join public.profiles pr on pr.id = p.usuario_id
    where p.data >= v_ini and p.data < v_fim and p.pontos > 0 and p.origem not in ('campeao', 'chefao')
      and pr.status = 'ativo' and pr.papel <> 'pais' and coalesce(pr.teste, false) = false
      and pr.unidade_id is not null
    group by pr.unidade_id
    union all
    select pr.unidade_id as uid, sum(g.dano)::int as dano
    from public.chefao_golpes g join public.profiles pr on pr.id = g.usuario_id
    where g.criado_em >= v_ini and g.criado_em < v_fim and pr.unidade_id is not null
    group by pr.unidade_id
  )
  select coalesce(json_agg(json_build_object('unidade', u.nome, 'dano', t.dano) order by t.dano desc), '[]'::json)
    into v_por_unidade
  from (select uid, sum(dano)::int as dano from dano_uni group by uid) t
  join public.unidades u on u.id = t.uid;

  select max(criado_em) into v_meu_ultimo from public.chefao_golpes
  where usuario_id = v_uid and criado_em >= v_ini and criado_em < v_fim;

  return json_build_object(
    'ativo', true,
    'nome', coalesce((select valor from public.config_clube where chave = 'chefao_nome'), 'Chefão'),
    'emoji', coalesce((select valor from public.config_clube where chave = 'chefao_emoji'), '🗿'),
    'versiculo', (select valor from public.config_clube where chave = 'chefao_versiculo'),
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
grant execute on function public.chefao_estado() to authenticated;
revoke execute on function public.chefao_estado() from public, anon;

-- 3) Golpe especial (1x por hora, dano fixo — NÃO gera ponto)
create or replace function public.chefao_golpe()
returns json language plpgsql security definer set search_path = '' as $$
declare
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
  if not public.eh_membro_ativo() then raise exception 'Só membros ativos entram na batalha.'; end if;

  v_ativo := coalesce((select valor from public.config_clube where chave = 'chefao_ativo'), 'nao') = 'sim';
  v_inicio := (select valor from public.config_clube where chave = 'chefao_inicio');
  if not v_ativo or v_inicio is null then raise exception 'Não tem chefão agora. 🙂'; end if;

  v_vida := greatest(1, coalesce((select valor from public.config_clube where chave = 'chefao_vida'), '3000')::int);
  v_ini := (v_inicio || ' 00:00:00')::timestamp at time zone 'America/Sao_Paulo';
  v_fim := v_ini + interval '2 days';
  if now() < v_ini or now() >= v_fim then raise exception 'A batalha não está rolando agora. 🙂'; end if;

  -- trava anti-flood: 1 golpe por hora
  select max(criado_em) into v_ultimo from public.chefao_golpes
  where usuario_id = v_uid and criado_em >= v_ini and criado_em < v_fim;
  if v_ultimo is not null and now() - v_ultimo < interval '1 hour' then
    raise exception 'Seu golpe especial recarrega 1x por hora — volta já já! ⏳';
  end if;

  insert into public.chefao_golpes (usuario_id, dano) values (v_uid, v_dano_golpe);

  -- dano total atualizado pra devolver a barra na hora
  select coalesce((select sum(p.pontos) from public.pontos p
      join public.profiles pr on pr.id = p.usuario_id
      where p.data >= v_ini and p.data < v_fim and p.pontos > 0 and p.origem not in ('campeao','chefao')
        and pr.status = 'ativo' and pr.papel <> 'pais' and coalesce(pr.teste, false) = false), 0)
    + coalesce((select sum(g.dano) from public.chefao_golpes g
      where g.criado_em >= v_ini and g.criado_em < v_fim), 0)
  into v_dano;

  return json_build_object('ok', true, 'dano_golpe', v_dano_golpe,
    'vida_atual', greatest(0, v_vida - v_dano), 'venceu', v_dano >= v_vida);
end;
$$;
grant execute on function public.chefao_golpe() to authenticated;
revoke execute on function public.chefao_golpe() from public, anon;

-- 4) Config do chefão (só liderança). Nasce desligado; ligar quando quiser.
create or replace function public.chefao_config(
  p_nome text, p_emoji text, p_vida int, p_versiculo text, p_inicio date, p_ativo boolean)
returns json language plpgsql security definer set search_path = '' as $$
declare
  v_antes boolean := coalesce((select valor from public.config_clube where chave = 'chefao_ativo'), 'nao') = 'sim';
begin
  if not public.pode_gerir() then raise exception 'Só a liderança configura o chefão.'; end if;
  if p_ativo then
    if coalesce(trim(p_nome), '') = '' then raise exception 'Dê um nome ao chefão.'; end if;
    if p_inicio is null then raise exception 'Escolha a data de início (o sábado).'; end if;
    if coalesce(p_vida, 0) < 100 or coalesce(p_vida, 0) > 500000 then
      raise exception 'A vida do chefão deve ficar entre 100 e 500000.';
    end if;
  end if;

  insert into public.config_clube (chave, valor) values
    ('chefao_nome', coalesce(trim(p_nome), 'Chefão')),
    ('chefao_emoji', coalesce(nullif(trim(p_emoji), ''), '🗿')),
    ('chefao_vida', coalesce(p_vida, 3000)::text),
    ('chefao_versiculo', nullif(trim(coalesce(p_versiculo, '')), '')),
    ('chefao_inicio', case when p_inicio is null then null else p_inicio::text end),
    ('chefao_ativo', case when p_ativo then 'sim' else 'nao' end)
  on conflict (chave) do update set valor = excluded.valor;

  -- ligar de novo pra uma NOVA data limpa o "já pago" da rodada anterior
  if p_ativo then
    delete from public.config_clube where chave = 'chefao_pago'
      and valor is distinct from p_inicio::text;
  end if;

  -- avisa o clube (push/sino) SÓ quando LIGA (não a cada edição)
  if p_ativo and not v_antes then
    insert into public.notificacoes (titulo, corpo, tipo, link, para)
    values ('⚔️ ' || coalesce(trim(p_nome), 'Um chefão') || ' apareceu!',
      'Um chefão surgiu pro fim de semana — o clube TODO precisa se unir pra derrotá-lo! Jogue, cumpra missões, leia a Bíblia e dê o golpe especial. 🗡️',
      'geral', '/chefao', 'todos');
  end if;

  return json_build_object('ok', true, 'ativo', p_ativo);
end;
$$;
grant execute on function public.chefao_config(text, text, int, text, date, boolean) to authenticated;
revoke execute on function public.chefao_config(text, text, int, text, date, boolean) from public, anon;

-- 5) Premiação (domingo à noite, via pg_cron). Idempotente (marca chefao_pago).
create or replace function public.chefao_premiar()
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_ativo boolean;
  v_inicio text;
  v_vida int;
  v_nome text;
  v_ini timestamptz;
  v_fim timestamptz;
  v_dano int;
  v_top_uid uuid;
  r record;
begin
  v_ativo := coalesce((select valor from public.config_clube where chave = 'chefao_ativo'), 'nao') = 'sim';
  v_inicio := (select valor from public.config_clube where chave = 'chefao_inicio');
  if not v_ativo or v_inicio is null then return; end if;
  -- já pagou esta rodada?
  if (select valor from public.config_clube where chave = 'chefao_pago') is not distinct from v_inicio then return; end if;

  v_vida := greatest(1, coalesce((select valor from public.config_clube where chave = 'chefao_vida'), '3000')::int);
  v_nome := coalesce((select valor from public.config_clube where chave = 'chefao_nome'), 'Chefão');
  v_ini := (v_inicio || ' 00:00:00')::timestamp at time zone 'America/Sao_Paulo';
  v_fim := v_ini + interval '2 days';

  perform pg_advisory_xact_lock(hashtext('chefao:' || v_inicio));

  select coalesce((select sum(p.pontos) from public.pontos p
      join public.profiles pr on pr.id = p.usuario_id
      where p.data >= v_ini and p.data < v_fim and p.pontos > 0 and p.origem not in ('campeao','chefao')
        and pr.status = 'ativo' and pr.papel <> 'pais' and coalesce(pr.teste, false) = false), 0)
    + coalesce((select sum(g.dano) from public.chefao_golpes g
      where g.criado_em >= v_ini and g.criado_em < v_fim), 0)
  into v_dano;

  if v_dano >= v_vida then
    -- VITÓRIA: +15 pra cada membro ativo que deu ao menos 1 golpe
    for r in
      select distinct g.usuario_id
      from public.chefao_golpes g
      join public.profiles pr on pr.id = g.usuario_id
      where g.criado_em >= v_ini and g.criado_em < v_fim
        and pr.status = 'ativo' and pr.papel <> 'pais' and coalesce(pr.teste, false) = false
    loop
      insert into public.pontos (usuario_id, origem, pontos, motivo)
      values (r.usuario_id, 'chefao', 15, '⚔️ Derrotou o ' || v_nome || '! (' || to_char(v_ini, 'DD/MM') || ')');
    end loop;

    -- unidade que mais contribuiu: +30 pro time
    with dano_uni as (
      select pr.unidade_id as uid, sum(p.pontos)::int as dano
      from public.pontos p join public.profiles pr on pr.id = p.usuario_id
      where p.data >= v_ini and p.data < v_fim and p.pontos > 0 and p.origem not in ('campeao','chefao')
        and pr.status = 'ativo' and pr.papel <> 'pais' and coalesce(pr.teste, false) = false
        and pr.unidade_id is not null
      group by pr.unidade_id
      union all
      select pr.unidade_id, sum(g.dano)::int
      from public.chefao_golpes g join public.profiles pr on pr.id = g.usuario_id
      where g.criado_em >= v_ini and g.criado_em < v_fim and pr.unidade_id is not null
      group by pr.unidade_id
    )
    select uid into v_top_uid from (select uid, sum(dano) as d from dano_uni group by uid) t order by t.d desc limit 1;
    if v_top_uid is not null then
      insert into public.pontos (unidade_id, origem, pontos, motivo)
      values (v_top_uid, 'chefao', 30, '⚔️ Time que mais golpeou o ' || v_nome || '!');
    end if;

    insert into public.notificacoes (titulo, corpo, tipo, link, para)
    values ('⚔️ Chefão derrotado!',
      'O clube uniu forças e derrotou o ' || v_nome || '! Quem lutou levou +15, e o time campeão +30. 🎉',
      'geral', '/chefao', 'todos');
  else
    -- fugiu (gentil, sem "vocês falharam")
    insert into public.notificacoes (titulo, corpo, tipo, link, para)
    values ('🌙 O ' || v_nome || ' recuou...',
      'O ' || v_nome || ' fugiu por pouco! Foi muita luta junto — semana que vem tem mais aventura. 💪',
      'geral', '/chefao', 'todos');
  end if;

  -- encerra a rodada (marca pago + desliga)
  insert into public.config_clube (chave, valor) values ('chefao_pago', v_inicio)
  on conflict (chave) do update set valor = excluded.valor;
  update public.config_clube set valor = 'nao' where chave = 'chefao_ativo';
end;
$$;
revoke all on function public.chefao_premiar() from public, anon, authenticated, service_role;

-- 6) Agenda o fecho: domingo 23:56 BRT (= segunda 02:56 UTC), logo após a rodada
do $$ begin
  if exists (select 1 from cron.job where jobname = 'chefao-fim') then
    perform cron.unschedule('chefao-fim');
  end if;
  perform cron.schedule('chefao-fim', '56 2 * * 1', 'select public.chefao_premiar()');
exception when undefined_table or undefined_function then
  raise notice 'pg_cron não disponível — ative em Database > Extensions e re-rode só o bloco do cron.';
end $$;

notify pgrst, 'reload schema';
