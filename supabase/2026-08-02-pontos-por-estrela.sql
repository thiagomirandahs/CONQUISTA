-- =====================================================================
--  Filhos da Conquista — Ponto acompanha a estrela (jogos) 2026-08-02
--
--  COMO APLICAR: Supabase -> SQL Editor -> New query -> cole -> Run. Idempotente.
--
--  MUDANÇA (pedido do dono): nos jogos normais, o ponto agora ACOMPANHA o
--  desempenho — quem vai melhor ganha mais ponto (não é mais fixo por jogar):
--     1⭐ = +5   ·   2⭐ = +10   ·   3⭐ = +15
--  (antes era 10 no 1º do dia e 5 nos extras, igual pra quem ia bem ou mal.)
--
--  Continua 1x por dia por jogo; conta de teste não pontua; jogos de recorde
--  (⚡ Reflexo, 🏕️ Corrida) não passam por aqui (valem pelo recorde da semana).
-- =====================================================================

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

  -- MODO TESTE: não grava nada (nem o jogo do dia, nem pontos) — dá pra repetir.
  if public.eh_teste() then
    return json_build_object('pontos', 0, 'estrelas', v_estrelas, 'passos', 0, 'extra', false, 'teste', true);
  end if;

  perform pg_advisory_xact_lock(hashtext(v_uid::text || ':' || v_hoje::text));

  select count(*) into v_ja
  from public.trilha_jogos where usuario_id = v_uid and data = v_hoje;

  -- >>> ponto acompanha a estrela: 1⭐=5, 2⭐=10, 3⭐=15 <<<
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

notify pgrst, 'reload schema';
