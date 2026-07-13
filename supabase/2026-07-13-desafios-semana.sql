-- =====================================================================
--  Filhos da Conquista — Desafios da Semana (2026-07-13)
--
--  COMO APLICAR: Supabase -> SQL Editor -> New query -> cole -> Run.
--  Idempotente. NÃO cria tabela nem apaga nada.
--
--  Uma "corrida" paralela que ZERA toda segunda: dá chance da unidade que
--  está atrás no ranking geral ganhar a semana. Como tudo que a criança faz
--  já vira linha em public.pontos (com data e origem), basta FILTRAR pela
--  semana atual — igual a Temporada faz com temporada_inicio().
--
--  ranking_semana() devolve o mesmo formato do ranking_totais() (pra reusar
--  o cálculo de média no cliente), + 'inicio' (a segunda 00:00 de Brasília),
--  só que contando apenas os pontos com data >= inicio da semana.
--
--  Semana = de segunda 00:00 (America/Sao_Paulo) até agora. date_trunc('week')
--  no Postgres começa na SEGUNDA, então bate certinho.
-- =====================================================================

create or replace function public.ranking_semana()
returns json language sql security definer set search_path = '' as $$
  with ini as (
    -- segunda-feira 00:00 no horário de Brasília, como timestamptz
    select (date_trunc('week', (now() at time zone 'America/Sao_Paulo'))
            at time zone 'America/Sao_Paulo') as ts
  )
  select json_build_object(
    'inicio', (select ts from ini),
    'pessoas', coalesce((
      select json_agg(json_build_object('id', usuario_id, 'total', total))
      from (
        select usuario_id, sum(pontos)::int as total
        from public.pontos
        where usuario_id is not null and data >= (select ts from ini)
        group by usuario_id
      ) p), '[]'::json),
    'times', coalesce((
      select json_agg(json_build_object('id', unidade_id, 'total', total))
      from (
        select unidade_id, sum(pontos)::int as total
        from public.pontos
        where usuario_id is null and unidade_id is not null and data >= (select ts from ini)
        group by unidade_id
      ) t), '[]'::json)
  );
$$;
grant execute on function public.ranking_semana() to authenticated;

notify pgrst, 'reload schema';
