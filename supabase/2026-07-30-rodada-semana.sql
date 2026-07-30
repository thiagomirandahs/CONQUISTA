-- =====================================================================
--  Filhos da Conquista — RODADA DA SEMANA (premiação automática) 2026-07-30
--
--  COMO APLICAR: Supabase -> SQL Editor -> New query -> cole tudo -> Run.
--  Idempotente: pode rodar de novo sem duplicar nada.
--
--  O QUE FAZ (todo domingo 23:55 de Brasília, sozinho):
--    🌟 +30  pro CAMPEÃO DAS ESTRELAS da semana (quem mais fez estrelas nos jogos)
--    ⚡ +20  pro 1º do REFLEXO da semana        (já existia; aqui só garantimos o cron)
--    🎲 +20  pro melhor no JOGO DA SEMANA        (um jogo sorteado, que roda toda semana)
--    🔄 sorteia o jogo da semana seguinte e avisa o clube
--
--  "Zerar": NADA de pontos é apagado. Como as estrelas/recordes são contados por
--  semana, a disputa recomeça sozinha toda segunda — o que as crianças já
--  juntaram no ranking continua intacto.
--
--  Empate: todos os empatados ganham o prêmio (igual ao reflexo já faz).
--
--  Liderança: os prêmios seguem o MESMO interruptor "só desbravadores" do reflexo
--  (Gestão -> 🎮 Jogos da Trilha). Ligado = a liderança joga mas não leva os
--  prêmios; desligado = todo mundo concorre.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0) Semente: já deixa UM jogo da semana valendo a partir de agora (um jogo
--    ativo que não seja o reflexo). Não sobrescreve se já houver um definido.
-- ---------------------------------------------------------------------
insert into public.config_clube (chave, valor)
select 'jogo_da_semana', j.chave
from public.jogos_trilha j
where j.ativo = true and j.chave <> 'reflexo'
order by random()
limit 1
on conflict (chave) do nothing;

-- ---------------------------------------------------------------------
-- 1) A função que premia a rodada da semana e sorteia o próximo jogo.
--    security definer + search_path travado; roda só pelo agendador.
-- ---------------------------------------------------------------------
create or replace function public.premiar_rodada_semana()
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
    (select valor = 'sim' from public.config_clube where chave = 'reflexo_so_desbravador'), false);
  v_max int;
  v_nomes text;
  v_jogo text;
  v_nome_jogo text;
  v_prox text;
  v_nome_prox text;
  r record;
begin
  -- IDEMPOTÊNCIA: se a rodada desta semana já foi processada, não faz nada.
  -- (A função roda inteira numa transação: ou grava tudo, ou nada. Assim, uma
  -- 2ª execução na mesma semana é um no-op — e não premia o jogo errado depois
  -- do sorteio ter trocado o jogo da semana.)
  if coalesce((select valor from public.config_clube where chave = 'rodada_semana_feita'), '') = v_marca then
    return;
  end if;

  -- ===================================================================
  -- 🌟 CAMPEÃO DAS ESTRELAS DA SEMANA (+30)
  -- ===================================================================
  if not exists (
    select 1 from public.pontos
    where origem = 'campeao' and motivo like '%(estrelas ' || v_marca || ')%'
  ) then
    select max(soma) into v_max from (
      select sum(t.estrelas) as soma
      from public.trilha_jogos t
      join public.profiles p on p.id = t.usuario_id
      where t.data >= v_ini and t.data < v_fim
        and p.status = 'ativo' and p.papel <> 'pais' and coalesce(p.teste, false) = false
        and (not v_so_desb or p.papel = 'desbravador')
      group by t.usuario_id
    ) q;

    if v_max is not null and v_max > 0 then
      v_nomes := null;
      for r in
        select t.usuario_id, min(p.nome) as nome
        from public.trilha_jogos t
        join public.profiles p on p.id = t.usuario_id
        where t.data >= v_ini and t.data < v_fim
          and p.status = 'ativo' and p.papel <> 'pais' and coalesce(p.teste, false) = false
          and (not v_so_desb or p.papel = 'desbravador')
        group by t.usuario_id
        having sum(t.estrelas) = v_max
      loop
        insert into public.pontos (usuario_id, origem, pontos, motivo)
        values (r.usuario_id, 'campeao', 30,
          '🌟 Campeão das estrelas da semana (estrelas ' || v_marca || ')');
        v_nomes := coalesce(v_nomes || ', ', '') || coalesce(r.nome, 'Alguém');
      end loop;

      if v_nomes is not null then
        insert into public.notificacoes (titulo, corpo, tipo, link, para)
        values ('🌟 Campeão das estrelas!',
          v_nomes || ' foi quem mais fez estrelas nos jogos essa semana e levou +30 pontos!',
          'geral', '/trilha', 'todos');
      end if;
    end if;
  end if;

  -- ===================================================================
  -- 🎲 CAMPEÃO DO JOGO DA SEMANA (+20)  — o jogo que estava valendo
  -- ===================================================================
  select valor into v_jogo from public.config_clube where chave = 'jogo_da_semana';

  if v_jogo is not null and v_jogo <> '' then
    select nome into v_nome_jogo from public.jogos_trilha where chave = v_jogo;

    if not exists (
      select 1 from public.pontos
      where origem = 'campeao' and motivo like '%(jogo ' || v_jogo || ' ' || v_marca || ')%'
    ) then
      select max(soma) into v_max from (
        select sum(t.estrelas) as soma
        from public.trilha_jogos t
        join public.profiles p on p.id = t.usuario_id
        where t.tipo = v_jogo and t.data >= v_ini and t.data < v_fim
          and p.status = 'ativo' and p.papel <> 'pais' and coalesce(p.teste, false) = false
          and (not v_so_desb or p.papel = 'desbravador')
        group by t.usuario_id
      ) q;

      if v_max is not null and v_max > 0 then
        v_nomes := null;
        for r in
          select t.usuario_id, min(p.nome) as nome
          from public.trilha_jogos t
          join public.profiles p on p.id = t.usuario_id
          where t.tipo = v_jogo and t.data >= v_ini and t.data < v_fim
            and p.status = 'ativo' and p.papel <> 'pais' and coalesce(p.teste, false) = false
            and (not v_so_desb or p.papel = 'desbravador')
          group by t.usuario_id
          having sum(t.estrelas) = v_max
        loop
          insert into public.pontos (usuario_id, origem, pontos, motivo)
          values (r.usuario_id, 'campeao', 20,
            '🎲 Campeão do jogo da semana: ' || coalesce(v_nome_jogo, v_jogo)
            || ' (jogo ' || v_jogo || ' ' || v_marca || ')');
          v_nomes := coalesce(v_nomes || ', ', '') || coalesce(r.nome, 'Alguém');
        end loop;

        if v_nomes is not null then
          insert into public.notificacoes (titulo, corpo, tipo, link, para)
          values ('🎲 Campeão do jogo da semana!',
            v_nomes || ' foi o melhor no ' || coalesce(v_nome_jogo, v_jogo) || ' e levou +20 pontos!',
            'geral', '/trilha', 'todos');
        end if;
      end if;
    end if;
  end if;

  -- ===================================================================
  -- 🔄 SORTEIA O JOGO DA PRÓXIMA SEMANA
  -- ===================================================================
  -- de preferência, um jogo ativo diferente do reflexo E do desta semana
  select chave into v_prox
  from public.jogos_trilha
  where ativo = true and chave <> 'reflexo' and chave <> coalesce(v_jogo, '')
  order by random() limit 1;

  -- se não sobrou opção diferente, aceita repetir (contanto que não seja reflexo)
  if v_prox is null then
    select chave into v_prox
    from public.jogos_trilha
    where ativo = true and chave <> 'reflexo'
    order by random() limit 1;
  end if;

  if v_prox is not null then
    insert into public.config_clube (chave, valor) values ('jogo_da_semana', v_prox)
    on conflict (chave) do update set valor = excluded.valor;

    select nome into v_nome_prox from public.jogos_trilha where chave = v_prox;
    insert into public.notificacoes (titulo, corpo, tipo, link, para)
    values ('🎲 Novo jogo da semana!',
      'Essa semana o jogo que vale prêmio é o ' || coalesce(v_nome_prox, v_prox)
      || '! Quem fizer mais estrelas nele até domingo leva +20. 🏆',
      'geral', '/trilha', 'todos');
  end if;

  -- rodada desta semana concluída (trava de idempotência lá do início)
  insert into public.config_clube (chave, valor) values ('rodada_semana_feita', v_marca)
  on conflict (chave) do update set valor = excluded.valor;
end;
$$;

-- Ninguém chama pela API e se premia — só o agendador roda.
revoke all on function public.premiar_rodada_semana() from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------
-- 2) Agenda (pg_cron usa UTC). Domingo 23:xx BRT = segunda 02:xx UTC.
--    Reflexo às 23:50 e a rodada (estrelas + jogo da semana) às 23:55.
-- ---------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron NÃO está ativo — ative em Database > Extensions (procure pg_cron) e re-rode este script.';
    return;
  end if;

  -- reflexo: garante que o job existe (mesmo se nunca foi agendado)
  if exists (select 1 from cron.job where jobname = 'campeao-recorde-semana') then
    perform cron.unschedule('campeao-recorde-semana');
  end if;
  perform cron.schedule('campeao-recorde-semana', '50 2 * * 1', 'select public.premiar_campeao_semana()');

  -- rodada da semana: estrelas + jogo da semana + sorteio do próximo
  if exists (select 1 from cron.job where jobname = 'rodada-semana') then
    perform cron.unschedule('rodada-semana');
  end if;
  perform cron.schedule('rodada-semana', '55 2 * * 1', 'select public.premiar_rodada_semana()');

  raise notice 'Agendado: campeao-recorde-semana (dom 23:50) e rodada-semana (dom 23:55).';
end $$;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------
-- CONFERIR (opcional): rode isto pra ver se os 2 jobs ficaram ativos:
--   select jobname, schedule, active from cron.job order by jobname;
-- E qual é o jogo da semana agora:
--   select valor from public.config_clube where chave = 'jogo_da_semana';
-- ---------------------------------------------------------------------
