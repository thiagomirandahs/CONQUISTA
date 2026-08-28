-- =====================================================================
--  Filhos da Conquista — 🥇 Jogos do Dia (rodízio diário + prêmio) 2026-08-28
--
--  ⚠️ Redefine registrar_jogo (2 args). APOSENTADO após o
--  2026-08-29-anticheat-partidas.sql — NÃO re-rode depois dele (recria a
--  sobrecarga de 2 args e a RPC fica ambígua). Ver GUIA-MIGRATIONS.md.
--
--  COMO APLICAR: Supabase -> SQL Editor -> New query -> cole -> Run.
--  Idempotente. Nada é apagado. Usa o pg_cron (já ativo pelo ⚡ semanal).
--
--  A ideia (do dono): todos os jogos ficam VISÍVEIS, mas cada dia só 3 deles
--  estão ABERTOS (os "Jogos do Dia"). Os trancados mostram quando vão abrir.
--  A liderança pode LIBERAR qualquer jogo manualmente quando quiser. Quem
--  fizer o melhor resultado em cada jogo do dia ganha +10 AUTOMÁTICO no
--  comecinho do dia seguinte (00:05 de Brasília).
--
--  Como funciona:
--   * RODÍZIO JUSTO em ciclo: os jogos ativos entram numa ordem fixa
--     (embaralhada por md5) e uma "janela" de 3 avança por dia. Cada jogo
--     abre de tempos em tempos (a cada ~n/3 dias) e o dia em que abre é
--     CALCULÁVEL — o app mostra "abre sáb 30/08" nos trancados.
--   * Arcade (⚡ reflexo / 🏕️ corrida) fica FORA do rodízio: continuam sempre
--     abertos (o prêmio deles já é o +20 semanal por recorde).
--   * "Melhor do dia" = mais ESTRELAS naquele jogo; empate = quem jogou
--     PRIMEIRO. Cada criança leva no máx. 1 prêmio/dia (o 2º vai pro próximo
--     da fila — espalha a alegria). Jogos liberados manualmente não dão o
--     +10 (são um "extra" da liderança), mas dão os pontos normais.
--   * TRAVA NO SERVIDOR: registrar_jogo recusa jogo comum fora do dia (e não
--     liberado) — não adianta tentar pelo console.
--   * Bônus "completou o dia": passa a ser jogar os JOGOS ABERTOS de hoje
--     (o trio + liberados). Valor ajustado de +50 pra +20 (eram ~20 jogos,
--     agora são 3 — senão inflaciona; o dono pode mudar depois).
--   * Limitação conhecida (ok): ligar/desligar jogo em Gestão muda o rodízio
--     (as datas previstas mudam). Evitar mexer nos interruptores à noite.
--   * Recovery manual: se o robô falhar, rodar
--     `select public.premiar_melhores_do_dia();` ATÉ 11:59 de Brasília julga
--     o dia anterior (âncora now-12h, mesmo padrão do ⚡ semanal).
-- =====================================================================

-- 0) Desempate por horário: quando cada jogada foi registrada.
--    (Linhas antigas ganham o timestamp de agora — só importa daqui pra frente.)
alter table public.trilha_jogos add column if not exists created_at timestamptz default now();

-- 0b) Jogos que EXIGEM WebGL (motor Phaser, sem versão clássica) não podem ser
--     EXIGIDOS no bônus de "completar o dia" — nem todo celular os roda. Eles
--     continuam no rodízio (dão pontos e concorrem ao +10) normalmente.
alter table public.jogos_trilha add column if not exists requer_webgl boolean not null default false;
update public.jogos_trilha set requer_webgl = true
  where chave in ('futebol', 'basquete', 'pesca', 'caverna', 'arco');

-- 1) O trio do dia (determinístico, janela deslizante sobre a ordem fixa)
create or replace function public.jogos_do_dia(p_data date default null)
returns table (chave text, nome text, emoji text)
language sql stable security definer set search_path = '' as $$
  with ativos as (
    select j.chave, j.nome, j.emoji,
           row_number() over (order by md5('rodizio|' || j.chave)) - 1 as pos,
           count(*) over () as n
    from public.jogos_trilha j
    where j.ativo and j.chave not in ('reflexo', 'corrida')
  ), base as (
    select (coalesce(p_data, (now() at time zone 'America/Sao_Paulo')::date)
            - date '2026-01-05')::int as d
  )
  select a.chave, a.nome, a.emoji
  from ativos a, base b
  where ((a.pos - (b.d * 3) % a.n) % a.n + a.n) % a.n < least(3, a.n)
  order by ((a.pos - (b.d * 3) % a.n) % a.n + a.n) % a.n;
$$;
grant execute on function public.jogos_do_dia(date) to authenticated;
revoke execute on function public.jogos_do_dia(date) from public, anon;

-- 2) Liberações manuais da liderança (valem pra UM dia)
create table if not exists public.jogos_liberados (
  chave text not null references public.jogos_trilha(chave) on delete cascade,
  data date not null,
  liberado_por uuid references public.profiles(id) on delete set null,
  criado_em timestamptz default now(),
  primary key (chave, data)
);
alter table public.jogos_liberados enable row level security;
drop policy if exists "ler liberacoes" on public.jogos_liberados;
create policy "ler liberacoes" on public.jogos_liberados for select to authenticated
  using (public.eh_membro_ativo());
-- escrever: só pelas funções abaixo (sem policy de insert/delete)

create or replace function public.liberar_jogo(p_chave text)
returns json language plpgsql security definer set search_path = '' as $$
declare
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  if auth.uid() is null then raise exception 'Não autenticado.'; end if;
  if not public.pode_gerir() then raise exception 'Só a liderança pode liberar jogos.'; end if;
  -- só jogo ATIVO e do rodízio (arcade já vive aberto; inativo não aparece no app)
  if not exists (select 1 from public.jogos_trilha
                 where chave = p_chave and ativo and chave not in ('reflexo', 'corrida')) then
    raise exception 'Jogo inválido ou fora do rodízio.';
  end if;
  insert into public.jogos_liberados (chave, data, liberado_por)
  values (p_chave, v_hoje, auth.uid())
  on conflict (chave, data) do nothing;
  return json_build_object('ok', true);
end;
$$;
grant execute on function public.liberar_jogo(text) to authenticated;
revoke execute on function public.liberar_jogo(text) from public, anon;

create or replace function public.trancar_jogo(p_chave text)
returns json language plpgsql security definer set search_path = '' as $$
declare
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  if auth.uid() is null then raise exception 'Não autenticado.'; end if;
  if not public.pode_gerir() then raise exception 'Só a liderança pode trancar jogos.'; end if;
  delete from public.jogos_liberados where chave = p_chave and data = v_hoje;
  return json_build_object('ok', true);
end;
$$;
grant execute on function public.trancar_jogo(text) to authenticated;
revoke execute on function public.trancar_jogo(text) from public, anon;

-- 3) Status pro app: trio de hoje + liberados + quando cada trancado abre
create or replace function public.status_jogos_do_dia()
returns json language plpgsql stable security definer set search_path = '' as $$
declare
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_trio json; v_lib json; v_prox json; v_exig json;
begin
  if auth.uid() is null then raise exception 'Não autenticado.'; end if;

  select coalesce(json_agg(d.chave), '[]'::json) into v_trio
  from public.jogos_do_dia(v_hoje) d;

  select coalesce(json_agg(l.chave), '[]'::json) into v_lib
  from public.jogos_liberados l where l.data = v_hoje;

  -- conjunto EXIGIDO pro bônus do dia: os abertos MENOS os requer_webgl —
  -- tem que bater com o bonus_todos_jogos/lembrete lá embaixo
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

  -- próxima data em que cada jogo ativo do rodízio abre (até 21 dias à frente)
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

  return json_build_object('hoje', v_trio, 'liberados', v_lib, 'proximos', v_prox,
    'exigidos', v_exig, 'valor_bonus', 20);
end;
$$;
grant execute on function public.status_jogos_do_dia() to authenticated;
revoke execute on function public.status_jogos_do_dia() from public, anon;

-- 4) TRAVA no servidor: jogo comum só no seu dia (ou liberado). BASE = a versão
--    EM VIGOR de 2026-08-02 (ponto acompanha a estrela: 1⭐=5/2⭐=10/3⭐=15 +
--    modo teste não grava nada). Só ENTRAM: bloqueio explícito dos arcade e a
--    guarda do rodízio (com tolerância de 10min na virada de meia-noite).
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

  -- Arcade NUNCA passa por aqui (pontua só pelo recorde semanal). Fecha o furo
  -- de farmar ponto diário pelo console com tipo 'reflexo'/'corrida'.
  if v_tipo in ('reflexo', 'corrida') then
    raise exception 'Esse jogo é de recorde — jogue pelo ⚡/🏕️!';
  end if;

  -- MODO TESTE: não grava nada (nem jogada, nem pontos) — dá pra repetir e
  -- testar QUALQUER jogo, mesmo trancado (por isso vem ANTES da guarda).
  if public.eh_teste() then
    return json_build_object('pontos', 0, 'estrelas', v_estrelas, 'passos', 0, 'extra', false, 'teste', true);
  end if;

  -- RODÍZIO: jogo comum só está aberto no SEU dia (ou liberado pela liderança).
  -- Tolerância da virada: até 00:10, partida começada ontem ainda vale.
  if not exists (select 1 from public.jogos_do_dia(v_hoje) d where d.chave = v_tipo)
     and not exists (select 1 from public.jogos_liberados l where l.chave = v_tipo and l.data = v_hoje)
     and not ((now() at time zone 'America/Sao_Paulo')::time < time '00:10'
              and (exists (select 1 from public.jogos_do_dia(v_hoje - 1) d where d.chave = v_tipo)
                   or exists (select 1 from public.jogos_liberados l where l.chave = v_tipo and l.data = v_hoje - 1))) then
    raise exception 'Esse jogo abre outro dia! Feche e abra o app pra ver os 🥇 Jogos do Dia de hoje.';
  end if;

  perform pg_advisory_xact_lock(hashtext(v_uid::text || ':' || v_hoje::text));

  select count(*) into v_ja
  from public.trilha_jogos where usuario_id = v_uid and data = v_hoje;

  -- ponto acompanha a estrela (regra de 2026-08-02): 1⭐=5, 2⭐=10, 3⭐=15
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

-- 4b) Moderação: a liderança pode APAGAR uma jogada forjada (o +10 é pago por
--     robô sem revisão — este é o freio de emergência, igual ao 🗑️ dos recordes).
drop policy if exists "apagar trilha_jogos" on public.trilha_jogos;
create policy "apagar trilha_jogos" on public.trilha_jogos for delete to authenticated
  using (public.pode_gerir());

-- 5) Premiação automática: +10 pro melhor de cada jogo do dia
create or replace function public.premiar_melhores_do_dia()
returns void language plpgsql security definer set search_path = '' as $$
declare
  -- Âncora -12h: rodando 00:05 (ou manual até 11:59), julga o dia QUE FECHOU.
  v_dia date := ((now() at time zone 'America/Sao_Paulo') - interval '12 hours')::date;
  rjogo record;
  r record;
  v_marca text;
  v_nomes text := null;
  v_premiados uuid[] := array[]::uuid[];  -- máx. 1 prêmio por criança/dia
  -- mesmo interruptor das outras premiações: liderança joga mas fica fora
  v_so_desb boolean := coalesce((select valor = 'sim' from public.config_clube
                                 where chave = 'reflexo_so_desbravador'), false);
begin
  -- só julga dia FECHADO (rodada manual depois do meio-dia premiaria o dia em
  -- andamento e queimaria a idempotência — o cron das 00:05 pularia os jogos)
  if v_dia >= (now() at time zone 'America/Sao_Paulo')::date then
    raise exception 'Cedo demais: esta função julga o dia que FECHOU — rode entre 00:00 e 11:59.';
  end if;

  perform pg_advisory_xact_lock(hashtext('melhores-do-dia:' || v_dia::text));

  -- Jogo da semana (se configurado) fica LIBERADO hoje: abre a semana inteira.
  -- Como "liberado", dá pontos normais mas não concorre ao +10 diário.
  insert into public.jogos_liberados (chave, data)
  select c.valor, (now() at time zone 'America/Sao_Paulo')::date
  from public.config_clube c
  join public.jogos_trilha j on j.chave = c.valor and j.ativo
  where c.chave = 'jogo_da_semana' and c.valor not in ('reflexo', 'corrida')
  on conflict (chave, data) do nothing;

  for rjogo in select d.chave, d.nome from public.jogos_do_dia(v_dia) d loop
    v_marca := rjogo.chave || ' ' || to_char(v_dia, 'DD/MM/YYYY');

    -- não premia o mesmo jogo/dia duas vezes (re-execução segura)
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

-- 6) Bônus "completou o dia": agora são os jogos ABERTOS hoje (trio + liberados).
--    Valor ajustado 50 -> 20 (eram ~20 jogos, agora 3).
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

  -- jogos abertos hoje (trio do rodízio + liberados pela liderança, sem arcade)
  create temp table if not exists _abertos_hoje (chave text primary key) on commit drop;
  delete from _abertos_hoje;
  -- jogos requer_webgl ficam FORA do exigido (nem todo celular os roda) —
  -- continuam no trio (dão pontos e concorrem ao +10), só não travam o bônus.
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
    values (v_uid, 'bonus_dia', 20, '🎮 Completou os Jogos do Dia (' || v_marca || ')');
    v_ganhou := 20;
  end if;

  return json_build_object('completo', true, 'total', v_total, 'feitos', v_feitos, 'ganhou', v_ganhou, 'ja', v_ja);
end;
$$;
grant execute on function public.bonus_todos_jogos() to authenticated;
revoke execute on function public.bonus_todos_jogos() from public, anon;

-- 7) Lembrete das 18h: agora conta só os jogos abertos hoje
create or replace function public.lembrar_jogos_do_dia()
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_total int;
  r record;
begin
  if coalesce((select valor from public.config_clube where chave = 'lembrete_jogos_dia'), '') = v_hoje::text then
    return;
  end if;

  create temp table if not exists _abertos_lembrete (chave text primary key) on commit drop;
  delete from _abertos_lembrete;
  -- mesmo conjunto exigido do bônus (sem os requer_webgl)
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
    values ('🥇 Os Jogos do Dia estão valendo!',
      'Ainda dá tempo: complete os Jogos do Dia pra ganhar o bônus — e o melhor de cada um leva +10 amanhã! 🏃',
      'geral', '/trilha', 'pessoal', r.id);
  end loop;

  insert into public.config_clube (chave, valor) values ('lembrete_jogos_dia', v_hoje::text)
  on conflict (chave) do update set valor = excluded.valor;
end;
$$;
revoke all on function public.lembrar_jogos_do_dia() from public, anon, authenticated, service_role;

-- 8) Agenda a premiação: todo dia 00:05 de Brasília = 03:05 UTC
do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron não está ativo — ative em Database > Extensions e re-rode este script.';
    return;
  end if;
  if exists (select 1 from cron.job where jobname = 'melhores-do-dia') then
    perform cron.unschedule('melhores-do-dia');
  end if;
  perform cron.schedule('melhores-do-dia', '5 3 * * *', 'select public.premiar_melhores_do_dia()');
end $$;

notify pgrst, 'reload schema';
