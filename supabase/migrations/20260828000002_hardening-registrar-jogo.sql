-- =====================================================================
--  Filhos da Conquista — HARDENING: registrar_jogo exige membro ativo
--  (2026-08-28)
--
--  ⚠️ APOSENTADO após o 2026-08-29-anticheat-partidas.sql (que redefine
--  registrar_jogo com sessão de partida). NÃO re-rode depois do anticheat:
--  recria a versão de 2 args e deixa a RPC ambígua. Ver GUIA-MIGRATIONS.md.
--
--  COMO APLICAR: Supabase -> SQL Editor -> New query -> cole -> Run.
--  Idempotente. Rodar DEPOIS do 2026-08-28-rodizio-interruptor.sql (se ainda
--  não rodou aquele, pode rodar este mesmo assim — ele inclui o rodizio_ligado()
--  por segurança e o interruptor atualizado também carrega esta guarda).
--
--  RISCO CORRIGIDO: registrar_jogo é SECURITY DEFINER e só checava
--  auth.uid(). Uma conta PENDENTE, rejeitada/desativada ou de RESPONSÁVEL
--  (papel 'pais') podia chamar a função direto pela API e gerar linhas em
--  trilha_jogos + PONTOS DE VERDADE (moeda do leilão/ranking) sem ser membro.
--
--  O QUE MUDA: logo após validar auth.uid(), a função exige
--  public.eh_membro_ativo() (regra central de 2026-07-14-portal-pais.sql:
--  status = 'ativo' e papel <> 'pais'). Nada mais muda: pontos por estrela,
--  modo teste, bloqueio dos arcade, rodízio com interruptor e travas seguem
--  idênticos à versão mais nova (2026-08-28-rodizio-interruptor.sql).
--  Também formaliza REVOKE de public/anon + GRANT só pra authenticated.
--
--  DEPENDE de (já rodados): portal-pais (eh_membro_ativo), modo-teste/reflexo
--  (eh_teste), jogos-do-dia (jogos_do_dia/jogos_liberados).
-- =====================================================================

-- Garantia de ordem: se o interruptor ainda não rodou, cria o rodizio_ligado()
-- (sem seed — ausente = ligado, o mesmo comportamento de antes do interruptor).
create or replace function public.rodizio_ligado()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select valor from public.config_clube where chave = 'rodizio_jogos'), 'sim') = 'sim';
$$;
grant execute on function public.rodizio_ligado() to authenticated;

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

  -- HARDENING: só MEMBRO ATIVO joga (pendente/rejeitado/desativado/pais não
  -- geram trilha nem pontos, nem chamando a API na mão). A função é SECURITY
  -- DEFINER — a autorização PRECISA viver aqui dentro.
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

-- Só usuário logado executa (funções nascem com EXECUTE pra PUBLIC no Postgres)
revoke execute on function public.registrar_jogo(text, int) from public, anon;
grant execute on function public.registrar_jogo(text, int) to authenticated;

notify pgrst, 'reload schema';
