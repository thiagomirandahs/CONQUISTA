-- =============================================================================
-- 350 — Prêmio do recorde da semana: uma execução por clube de cada vez
-- =============================================================================
-- Investigação do gate 30 (28/09): o prêmio NÃO tinha bug de regra (o vermelho era o teste rodando
-- segunda de manhã — ver o comentário no teste 30). Mas a auditoria achou uma janela real:
-- _premiar_campeao_semana_clube faz "já premiei esta semana?" (SELECT) e depois INSERT, sem trava.
-- Duas execuções simultâneas (cron + uma chamada manual do service_role) podiam as duas passar no
-- SELECT e pagar +20 duas vezes. Correção mínima: trava transacional por clube no começo. A segunda
-- execução espera a primeira terminar, aí vê o prêmio já dado e pula. Clubes diferentes não se
-- bloqueiam (a chave da trava é o club_id). Corpo da regra: idêntico ao da migration 35.
-- =============================================================================
create or replace function public._premiar_campeao_semana_clube(p_club_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_seg date := (date_trunc('week', ((now() at time zone 'America/Sao_Paulo') - interval '12 hours')))::date;
  rjogo record; r record;
  v_max int; v_nome_jogo text; v_marca text; v_nomes text;
begin
  -- uma execução por clube de cada vez (a chave é o club_id; clubes diferentes não se esperam)
  perform pg_advisory_xact_lock(hashtextextended('premiar_campeao_semana:' || p_club_id::text, 0));
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
$function$;


revoke execute on function public._premiar_campeao_semana_clube(uuid) from public, anon, authenticated;
