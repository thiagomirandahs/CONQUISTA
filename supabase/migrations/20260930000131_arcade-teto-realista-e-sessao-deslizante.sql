-- =============================================================================
--  131 — Arcade (reflexo/corrida): teto anti-cheat realista + sessão de replays deslizante
--
--  PROBLEMA (produção, clube real): criança chegou ao nível 122 no ⚡ reflexo em ~80 s
--  (≈0,65 s/nível). O teto antigo (reflexo = ceil(s/2)+3 → 43 em 80 s) supunha "cada nível leva
--  >= ~2 s", mas 2 s é o LIMITE do cronômetro da rodada, não o tempo de quem joga: não há mínimo
--  por nível — é tocar no alvo assim que o acha. registrar_recorde recusava ('Esse resultado não
--  bate com o tempo de jogo') e a tela dizia "sem internet?". Corridas boas se perdiam.
--
--  CONTAS DO TETO NOVO (duração s = segundos desde o envio anterior da MESMA partida, ou desde o
--  início — inclui tela de "pronto", resultado e carregamento, então só folga a favor da criança):
--
--  reflexo = ceil(s * 2.5) + 8
--    Mecânica (JogoReflexo.jsx / ReflexoPhaser.jsx): rodada = achar 1 emoji entre min(12, 1+nível)
--    e tocar; prazo max(2000, 4000 - 25*nível) ms; não existe tempo mínimo por nível. Busca visual
--    + toque de uma criança muito boa: ~0,4-0,6 s por nível com a grade cheia (produção: 0,65 s);
--    nos primeiros níveis (1-4 itens) dá ~0,25 s. 2,5 níveis/s = 0,4 s/nível sustentado em toda
--    a corrida, + 8 de folga para a arrancada fácil. 80 s → 208 (o caso real, 122, passa folgado).
--
--  corrida = ceil(s * 1.8) + 5
--    Clássico (JogoCorrida.jsx): física em passos fixos de 1/60 s presa ao relógio real; o próximo
--    obstáculo nasce a gap = max(vel*34, 96) + rand(0..80) px e anda vel px/passo, com vel >= 4,6
--    (então vel*34 > 96 sempre) → no MÍNIMO 34 passos entre obstáculos = 0,567 s → teto físico
--    60/34 = 1,765 obstáculos/s (com o sorteio sempre 0 e sem contar os ~2,7 s até o 1º obstáculo).
--    Phaser (CorridaPhaser.jsx): gap = max(300, speed*0.95) + rand(0..170) px com speed <= 760 px/s
--    → >= 0,95 s por obstáculo → <= 1,05/s. Teto 1,8/s + 5 cobre o máximo TEÓRICO das duas
--    versões (o antigo 1,5/s ficava abaixo do máximo possível do clássico).
--
--  Mantidos: teto absoluto 500 (least(p_pontos, 500) no registrar_recorde), "rápido demais" < 3 s,
--  e o "else" (outros jogos) inalterado.
--
--  Nota de segurança honesta: com o teto novo, "esperar ocioso e cravar 500" exige ~197 s de
--  partida no reflexo (antes ~16,5 min). O teto por tempo nunca foi a trava principal contra
--  forja: ela continua sendo o limite absoluto de 500, a partida por dono/clube/jogo e o botão da
--  liderança "apagar recorde da semana". Preferimos não punir criança boa.
--
--  SESSÃO DESLIZANTE: a partida arcade valia 15 min fixos desde o início (iniciar_jogo) e não é
--  consumida — quem ficava rejogando por mais de 15 min (ou numa corrida longa) levava 'Partida
--  inválida ou expirada' e perdia o recorde. Mudança mínima: no registrar_recorde a partida vale
--  enquanto houver atividade — até validade_em OU até 30 min depois do último envio aceito (ou do
--  início), limitada a 6 h desde o início. Nada muda em iniciar_jogo nem na tabela. Todo o resto do
--  registrar_recorde é cópia fiel da 081.
-- =============================================================================

create or replace function public._max_pontos_arcade(p_jogo text, p_segundos numeric)
returns int language sql immutable as $$
  select case p_jogo
    when 'reflexo' then ceil(p_segundos * 2.5)::int + 8   -- <= 0,4 s/nível sustentado (ver 131)
    when 'corrida' then ceil(p_segundos * 1.8)::int + 5   -- teto físico 60/34 ≈ 1,765 obst./s (ver 131)
    else ceil(p_segundos * 2)::int + 5 end;
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
       -- 131: sessão deslizante (replays/corrida longa não expiram enquanto há atividade)
       and (now() <= validade_em
            or (now() <= coalesce(ultima_submissao_em, iniciado_em) + interval '30 minutes'
                and now() <= iniciado_em + interval '6 hours'))
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

