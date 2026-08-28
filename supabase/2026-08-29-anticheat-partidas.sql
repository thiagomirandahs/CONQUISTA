-- =====================================================================
--  Filhos da Conquista — HARDENING etapa 2C: sessão de partida (anti-cheat)
--  (2026-08-29)
--
--  COMO APLICAR: Supabase -> SQL Editor -> New query -> cole -> Run. Idempotente.
--  Rodar DEPOIS do app novo estar no ar (o front novo já envia a partida).
--  É a DEFINIÇÃO MAIS NOVA de registrar_jogo/registrar_recorde — datado 08-29
--  de propósito, pra num replay por ORDEM DE NOME ele rodar por ÚLTIMO e dar a
--  palavra final (as versões de 2 args em arquivos 07-27/08-28 estão aposentadas;
--  não re-rode aquelas depois desta, senão recria a sobrecarga de 2 args e a RPC
--  fica ambígua). Ver supabase/GUIA-MIGRATIONS.md.
--
--  RISCO CORRIGIDO: registrar_jogo/registrar_recorde recebiam p_estrelas /
--  p_pontos direto do cliente — um usuário logado podia chamar a RPC pelo
--  console SEM jogar (limitado a 1x/dia, mas 3⭐ de graça todo dia, e recorde
--  arbitrário até o teto). Um jogo no navegador nunca é 100% à prova de
--  fraude; o objetivo aqui é: barrar chamada trivial pelo console, detectar
--  valores impossíveis e deixar trilha de auditoria — SEM atrapalhar quem
--  joga de verdade.
--
--  COMO FUNCIONA:
--   * iniciar_jogo(p_tipo): chamado quando a criança ABRE o jogo. Valida
--     membro ativo + jogo aberto NAQUELE momento (rodízio) e devolve uma
--     PARTIDA (id + validade). Horário 100% do banco.
--   * registrar_jogo(..., p_partida): consome a partida ATOMICAMENTE
--     (uma vez só), confere dono/jogo/validade e a DURAÇÃO MÍNIMA plausível
--     — POR JOGO (examinei um a um: Conta Rápida tem timer de 30s, Pescaria
--     45s, mas no Gênius dá pra perder em 3s legítimos; nada de tempo global).
--   * registrar_recorde(..., p_partida): arcade repete à vontade, então a
--     partida NÃO é consumida — cada envio confere o tempo DESDE O ENVIO
--     ANTERIOR (duração da corrida) + teto de plausibilidade (pontos/segundo
--     impossíveis = rejeita e marca 'suspeita' na auditoria).
--   * TRANSIÇÃO: config exigir_partida começa 'nao' — quem ainda estiver com
--     o app antigo em cache joga normal (sem partida). Depois de alguns dias,
--     ligue a exigência (linha comentada no fim) e chamada sem partida passa
--     a ser recusada.
--   * Auditoria em public.partidas (liderança lê; sem dados pessoais além do
--     id do usuário). Registros antigos de jogos/recordes não mudam em nada.
-- =====================================================================

-- 0) Interruptor da exigência (nasce DESLIGADO = período de transição)
insert into public.config_clube (chave, valor) values ('exigir_partida', 'nao')
on conflict (chave) do nothing;

-- 1) A tabela de partidas (auditoria incluída)
create table if not exists public.partidas (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references public.profiles(id) on delete cascade,
  jogo text not null references public.jogos_trilha(chave),
  iniciado_em timestamptz not null default now(),
  validade_em timestamptz not null,
  consumida_em timestamptz,           -- jogos de estrela: consumida 1x
  ultima_submissao_em timestamptz,    -- arcade: marca cada envio (tempo por corrida)
  resultado int,
  suspeita boolean not null default false,
  motivo_suspeita text
);
create index if not exists partidas_usuario_inicio on public.partidas (usuario_id, iniciado_em desc);
alter table public.partidas enable row level security;
grant select on public.partidas to authenticated;
drop policy if exists "auditoria partidas lideranca" on public.partidas;
create policy "auditoria partidas lideranca" on public.partidas for select to authenticated
  using (public.pode_gerir());
-- escrever: só pelas funções (sem policy de insert/update/delete)

-- 2) Duração mínima POR JOGO (segundos) — bem CONSERVADORA de propósito:
--    é ~metade do término legítimo mais rápido que cada jogo permite
--    (perder rápido conta!). Jogo novo sem entrada aqui herda o mínimo de 3s.
create or replace function public._min_segundos_jogo(p_jogo text)
returns int language sql immutable as $$
  select case p_jogo
    when 'contas' then 25   -- timer FIXO de 30s
    when 'pesca' then 40    -- rodada FIXA de 45s
    when 'mudou' then 15    -- 5 rodadas com 2,5s+ de memorização cada
    when 'cobra' then 10    -- impossível morrer sem antes comer (leva tempo)
    when 'velha' then 8     -- melhor de 3 com pausas do robô
    when 'nos' then 7       -- 6 perguntas com aviso de 1,3s entre elas
    when 'futebol' then 7   -- 5 cobranças com banner entre elas
    when 'basquete' then 7  -- 5 arremessos com voo + banner
    when 'arco' then 7      -- 5 flechas com voo + banner
    when 'memoria' then 6 when 'caca' then 6 when 'desliza' then 6
    when 'morse' then 6 when 'bussola' then 6 when 'semaforo' then 6
    when 'proximo' then 6 when 'hanoi' then 6 when 'dardos' then 6
    when 'socorro' then 5 when 'carrinho' then 5 when 'caverna' then 5
    when 'minado' then 4 when 'anagrama' then 4
    -- genius/forca/termo: dá pra terminar (perdendo/na sorte) em ~3-4s legítimos
    else 3 end;
$$;

-- Teto de plausibilidade dos arcades: pontos por segundo impossíveis = fraude.
-- Margem de 2x sobre o máximo real observável, pra nunca punir criança boa.
create or replace function public._max_pontos_arcade(p_jogo text, p_segundos numeric)
returns int language sql immutable as $$
  select case p_jogo
    when 'reflexo' then ceil(p_segundos / 2.0)::int + 3   -- cada nível leva >= ~2s
    when 'corrida' then ceil(p_segundos * 1.5)::int + 3   -- <= ~1,3 obstáculos/s
    else ceil(p_segundos * 2)::int + 5 end;
$$;

-- 3) iniciar_jogo: abre a partida (validações NO MOMENTO DO INÍCIO)
create or replace function public.iniciar_jogo(p_tipo text)
returns json language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_arcade boolean;
  v_validade timestamptz;
  v_id uuid;
begin
  if v_uid is null then raise exception 'Não autenticado.'; end if;
  if not public.eh_membro_ativo() then
    raise exception 'Apenas membros ativos do clube podem jogar.';
  end if;
  if not exists (select 1 from public.jogos_trilha where chave = p_tipo) then
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
     and not exists (select 1 from public.jogos_liberados l where l.chave = p_tipo and l.data = v_hoje) then
    raise exception 'Esse jogo abre outro dia! Feche e abra o app pra ver os 🥇 Jogos do Dia de hoje.';
  end if;

  -- arcade: janela pros replays, mas CURTA — 15 min não cabe o "esperar ocioso
  -- e cravar 500 forjado" (reflexo precisaria de ~16,5 min) e ainda sobra muito
  -- pra qualquer partida real (uma corrida dura segundos). Estrela: 45 min.
  v_validade := now() + case when v_arcade then interval '15 minutes' else interval '45 minutes' end;

  insert into public.partidas (usuario_id, jogo, validade_em)
  values (v_uid, p_tipo, v_validade)
  returning id into v_id;

  return json_build_object('id', v_id, 'jogo', p_tipo, 'validade_em', v_validade);
end;
$$;
grant execute on function public.iniciar_jogo(text) to authenticated;
revoke execute on function public.iniciar_jogo(text) from public, anon;

-- 4) registrar_jogo com partida (BASE: versão do hardening etapa 1 —
--    membro ativo + estrela×5 + teste + arcade bloqueado + rodízio; NADA
--    daquilo mudou). A assinatura antiga é DERRUBADA (o parâmetro novo tem
--    default: o app antigo chamando com 2 argumentos continua funcionando).
drop function if exists public.registrar_jogo(text, int);

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

  -- já jogou este jogo hoje? avisa ANTES de consumir a partida
  if exists (select 1 from public.trilha_jogos
             where usuario_id = v_uid and data = v_hoje and tipo = v_tipo) then
    raise exception 'Você já jogou esse jogo hoje! Escolha outro 🙂';
  end if;

  if p_partida is not null then
    -- consome a partida ATOMICAMENTE (dono + jogo + não consumida + na validade)
    update public.partidas
       set consumida_em = now(), resultado = v_estrelas
     where id = p_partida and usuario_id = v_uid and jogo = v_tipo
       and consumida_em is null and now() <= validade_em
     returning iniciado_em into v_ini;
    if not found then
      raise exception 'Partida inválida ou expirada — abra o jogo de novo. 🙂';
    end if;
    -- duração mínima PLAUSÍVEL (horário 100% do banco). SÓ vale pra quem
    -- reivindica 2★/3★ — DERROTA rápida legítima (1★, ex.: pisar na mina na 2ª
    -- casa do Campo Minado) NUNCA é bloqueada. O abuso mira 3★ de graça, e esse
    -- segue barrado. (O 'raise' desfaz a transação — por isso não gravamos
    -- 'suspeita' aqui: seria rollback. A auditoria fica nas partidas iniciadas
    -- e consumidas, que essas sim commitam.)
    v_seg := extract(epoch from (now() - v_ini));
    if v_estrelas >= 2 and v_seg < public._min_segundos_jogo(v_tipo) then
      raise exception 'Rápido demais — jogue de verdade! 🙂';
    end if;
    -- rodízio foi validado no INÍCIO da partida (iniciar_jogo) — não re-checa
  else
    -- SEM partida: só durante a transição (app antigo em cache)
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
revoke execute on function public.registrar_jogo(text, int, uuid) from public, anon;
grant execute on function public.registrar_jogo(text, int, uuid) to authenticated;

-- 5) registrar_recorde com partida (BASE: versão de 2026-07-27, a mais nova —
--    membro ativo + teste + interruptor "só desbravadores"; NADA daquilo mudou).
--    Arcade repete à vontade: a partida NÃO é consumida — cada envio mede o
--    tempo desde o envio anterior e aplica o teto de plausibilidade.
drop function if exists public.registrar_recorde(text, int);

create or replace function public.registrar_recorde(p_jogo text, p_pontos int, p_partida uuid default null)
returns json language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_seg date := (date_trunc('week', (now() at time zone 'America/Sao_Paulo')))::date;
  v_pts int := greatest(0, least(coalesce(p_pontos, 0), 500));
  v_antigo int;
  p record;
  v_dur numeric;
  v_exigir boolean := coalesce((select valor from public.config_clube where chave = 'exigir_partida'), 'nao') = 'sim';
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

  -- Liderança barrada: joga normal, mas o recorde não entra na competição
  if public.reflexo_so_desbravador()
     and not exists (select 1 from public.profiles where id = v_uid and papel = 'desbravador') then
    return json_build_object('recorde', v_pts, 'melhorou', false, 'fora', true);
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
revoke execute on function public.registrar_recorde(text, int, uuid) from public, anon;
grant execute on function public.registrar_recorde(text, int, uuid) to authenticated;

-- 6) DEFESA EM PROFUNDIDADE: o prêmio de domingo só olha jogos de RECORDE.
--    (Mesmo que sobre algum recorde antigo semeado em jogo não-arcade, ele não
--    vira +20.) Base: 2026-07-27-reflexo-so-desbravador.sql, com o filtro
--    "and jogo in ('reflexo','corrida')" no laço.
create or replace function public.premiar_campeao_semana()
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_seg date := (date_trunc('week', ((now() at time zone 'America/Sao_Paulo') - interval '12 hours')))::date;
  rjogo record; r record;
  v_max int; v_nome_jogo text; v_marca text; v_nomes text;
begin
  for rjogo in select distinct jogo from public.recordes
               where semana = v_seg and jogo in ('reflexo', 'corrida') loop
    v_marca := rjogo.jogo || ' ' || to_char(v_seg, 'DD/MM/YYYY');
    if exists (select 1 from public.pontos
               where origem = 'campeao' and motivo like '%(' || v_marca || ')%') then
      continue;
    end if;
    select nome into v_nome_jogo from public.jogos_trilha where chave = rjogo.jogo;
    select max(r2.pontos) into v_max
    from public.recordes r2
    join public.profiles p on p.id = r2.usuario_id
    where r2.jogo = rjogo.jogo and r2.semana = v_seg and r2.pontos > 0
      and p.status = 'ativo' and p.papel <> 'pais' and coalesce(p.teste, false) = false
      and (not public.reflexo_so_desbravador() or p.papel = 'desbravador');
    if v_max is null or v_max <= 0 then continue; end if;
    v_nomes := null;
    for r in
      select r2.usuario_id, p.nome
      from public.recordes r2
      join public.profiles p on p.id = r2.usuario_id
      where r2.jogo = rjogo.jogo and r2.semana = v_seg and r2.pontos = v_max
        and p.status = 'ativo' and p.papel <> 'pais' and coalesce(p.teste, false) = false
        and (not public.reflexo_so_desbravador() or p.papel = 'desbravador')
    loop
      insert into public.pontos (usuario_id, origem, pontos, motivo)
      values (r.usuario_id, 'campeao', 20,
        '🏆 Recorde da semana no ' || coalesce(v_nome_jogo, rjogo.jogo) || ' (' || v_marca || ')');
      v_nomes := coalesce(v_nomes || ', ', '') || coalesce(r.nome, 'Alguém');
    end loop;
    if v_nomes is null then continue; end if;
    insert into public.notificacoes (titulo, corpo, tipo, link, para)
    values ('🏆 Recorde da semana!',
      v_nomes || ' fez o maior recorde no ' || coalesce(v_nome_jogo, rjogo.jogo) || ' e levou +20 pontos!',
      'geral', '/trilha', 'todos');
  end loop;
end;
$$;
revoke all on function public.premiar_campeao_semana() from public, anon, authenticated, service_role;

-- 7) TRANSIÇÃO: 'exigir_partida' nasce 'nao' pra não quebrar app antigo em
--    cache (que chama com 2 args, sem partida). ENQUANTO estiver 'nao', uma
--    chamada de console com p_partida=null pula piso/teto — ou seja, a proteção
--    só vale de verdade DEPOIS de ligar. Ligue em 1-2 DIAS (não semanas), assim
--    que os aparelhos abriram o app novo pelo menos uma vez:
-- update public.config_clube set valor = 'sim' where chave = 'exigir_partida';

notify pgrst, 'reload schema';
