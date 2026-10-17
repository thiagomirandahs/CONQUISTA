-- Primeira temporada do Ranking Global.
-- Execute depois das migrations do Ranking Global (base, registro e motor semanal).
-- Este script é idempotente e publica a primeira semana imediatamente.

with temporada as (
  insert into public.ranking_global_temporadas
    (codigo, inicio, fim, status, max_semanas, estrelas_por_desafio)
  values
    ('2026-2027', current_date, current_date + 364, 'aberta', 40, 3)
  on conflict (codigo) do update set
    status = 'aberta',
    inicio = least(public.ranking_global_temporadas.inicio, excluded.inicio),
    fim = greatest(public.ranking_global_temporadas.fim, excluded.fim)
  returning id
), t as (
  select distinct id from (
    select id from temporada
    union all
    select id from public.ranking_global_temporadas where codigo = '2026-2027'
  ) temporadas
), jogos as (
  select chave, row_number() over (order by ordem_min nulls last, chave) as ordem
  from (
    select j.chave, min(j.ordem) as ordem_min
    from public.jogos_trilha j
    where j.ativo and j.chave in ('memoria', 'caca', 'desliza')
    group by j.chave
  ) catalogo
  limit 3
)
insert into public.ranking_global_desafios
  (temporada_id, semana, chave, familia, dificuldade, estrelas_max,
   disponivel_de, disponivel_ate, ativo)
select t.id, 1, jogos.chave, 'jogo',
       case when jogos.ordem = 1 then 'facil' when jogos.ordem = 2 then 'media' else 'dificil' end,
       3, now(), current_date + 6 + time '23:59:59', true
from t cross join jogos
on conflict (temporada_id, semana, chave) do update set
  ativo = true,
  disponivel_de = excluded.disponivel_de,
  disponivel_ate = excluded.disponivel_ate;

-- Confirmação sem expor dados pessoais.
select t.codigo, t.status, d.semana, count(d.id)::int as desafios_publicados
from public.ranking_global_temporadas t
left join public.ranking_global_desafios d on d.temporada_id = t.id and d.ativo
where t.codigo = '2026-2027'
group by t.codigo, t.status, d.semana
order by d.semana;
