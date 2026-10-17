-- Ranking global: nome autorizado para exibição (sem foto, papel ou outros dados).
-- Rodar depois das duas migrations anteriores.

create or replace function public.ranking_global(p_temporada_id uuid default null)
returns jsonb
language sql stable security definer
set search_path = public, pg_catalog
as $$
  with t as (
    select coalesce(p_temporada_id, (select id from public.ranking_global_temporadas
      where status in ('aberta','encerrada','homologada') order by inicio desc limit 1)) id
  ), melhores as (
    select distinct on (r.usuario_id, d.id) r.usuario_id, d.semana, r.estrelas,
      r.aproveitamento, r.primeira_tentativa
    from public.ranking_global_resultados r
    join public.ranking_global_desafios d on d.id = r.desafio_id
    join t on t.id = d.temporada_id
    where r.validado_em is not null
    order by r.usuario_id, d.id, r.estrelas desc, r.aproveitamento desc, r.tentativa
  ), semanas as (
    select usuario_id, semana, sum(estrelas)::int estrelas,
      avg(aproveitamento)::numeric(5,2) aproveitamento,
      sum(case when primeira_tentativa then 1 else 0 end)::int primeiras
    from melhores group by usuario_id, semana
  ), numeradas as (
    select s.*, row_number() over (partition by usuario_id
      order by estrelas desc, aproveitamento desc, primeiras desc, semana) n
    from semanas s
  ), totais as (
    select n.usuario_id, sum(n.estrelas)::int estrelas,
      avg(n.aproveitamento)::numeric(5,2) aproveitamento,
      sum(n.primeiras)::int primeiras, count(*)::int semanas
    from numeradas n join t on true
    where n.n <= (select max_semanas from public.ranking_global_temporadas where id=t.id)
    group by n.usuario_id
  ), ordem as (
    select row_number() over (order by x.estrelas desc, x.aproveitamento desc,
      x.primeiras desc, x.usuario_id) posicao, x.*, p.nome
    from totais x left join public.profiles p on p.id=x.usuario_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'posicao',posicao, 'usuario_id',usuario_id, 'nome',coalesce(nome,'Desbravador'),
    'estrelas',estrelas, 'aproveitamento',aproveitamento,
    'primeiras_tentativas',primeiras, 'semanas',semanas) order by posicao),'[]'::jsonb)
  from ordem;
$$;

revoke all on function public.ranking_global(uuid) from public, anon;
grant execute on function public.ranking_global(uuid) to authenticated;
