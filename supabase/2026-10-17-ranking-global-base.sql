-- Ranking global: base da temporada anual (fase 1)
--
-- Esta migration NÃO altera public.pontos nem public.ranking_totais.
-- Pontos continuam pertencendo ao ranking do clube; estrelas globais ficam
-- nestas tabelas, com resultado por desafio e temporada.
--
-- Regras da proposta:
--   • até 3 estrelas por desafio, 3 desafios por semana (9/semana);
--   • a temporada considera no máximo as 40 melhores semanas (360 estrelas);
--   • desempate: estrelas, aproveitamento médio das 40 melhores semanas e
--     acertos na primeira tentativa. A posição final só será fechada depois
--     da revisão de integridade da temporada.

create table if not exists public.ranking_global_temporadas (
  id uuid primary key default gen_random_uuid(),
  codigo text not null unique,
  inicio date not null,
  fim date not null,
  status text not null default 'planejamento'
    check (status in ('planejamento', 'aberta', 'encerrada', 'homologada')),
  max_semanas smallint not null default 40 check (max_semanas between 1 and 53),
  estrelas_por_desafio smallint not null default 3 check (estrelas_por_desafio between 1 and 3),
  created_at timestamptz not null default now(),
  check (fim >= inicio)
);

create table if not exists public.ranking_global_desafios (
  id uuid primary key default gen_random_uuid(),
  temporada_id uuid not null references public.ranking_global_temporadas(id) on delete cascade,
  semana smallint not null check (semana between 1 and 53),
  chave text not null,
  familia text not null default 'quiz',
  dificuldade text not null default 'media'
    check (dificuldade in ('facil', 'media', 'dificil')),
  estrelas_max smallint not null default 3 check (estrelas_max between 1 and 3),
  disponivel_de timestamptz,
  disponivel_ate timestamptz,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  unique (temporada_id, semana, chave),
  check (disponivel_ate is null or disponivel_de is null or disponivel_ate > disponivel_de)
);

create table if not exists public.ranking_global_resultados (
  id uuid primary key default gen_random_uuid(),
  desafio_id uuid not null references public.ranking_global_desafios(id) on delete cascade,
  usuario_id uuid not null references auth.users(id) on delete cascade,
  tentativa smallint not null check (tentativa between 1 and 2),
  estrelas smallint not null check (estrelas between 0 and 3),
  aproveitamento numeric(5,2) not null check (aproveitamento between 0 and 100),
  primeira_tentativa boolean not null default false,
  validado_em timestamptz,
  created_at timestamptz not null default now(),
  unique (desafio_id, usuario_id, tentativa)
);

create index if not exists idx_global_desafios_temporada_semana
  on public.ranking_global_desafios (temporada_id, semana, ativo);
create index if not exists idx_global_resultados_usuario_desafio
  on public.ranking_global_resultados (usuario_id, desafio_id, estrelas desc, aproveitamento desc);

alter table public.ranking_global_temporadas enable row level security;
alter table public.ranking_global_desafios enable row level security;
alter table public.ranking_global_resultados enable row level security;

drop policy if exists "ranking global temporadas leitura autenticada" on public.ranking_global_temporadas;
create policy "ranking global temporadas leitura autenticada"
  on public.ranking_global_temporadas for select to authenticated using (true);

drop policy if exists "ranking global desafios leitura autenticada" on public.ranking_global_desafios;
create policy "ranking global desafios leitura autenticada"
  on public.ranking_global_desafios for select to authenticated using (true);

drop policy if exists "ranking global resultados proprio" on public.ranking_global_resultados;
create policy "ranking global resultados proprio"
  on public.ranking_global_resultados for select to authenticated using (usuario_id = auth.uid());

-- A gravação será feita por RPC na próxima etapa, depois de ligar o desafio ao
-- jogo e validar servidor/antifraude. Não liberar insert direto para o cliente.
revoke all on public.ranking_global_resultados from anon, authenticated;
grant select on public.ranking_global_temporadas, public.ranking_global_desafios to authenticated;

-- Consulta da classificação. O melhor resultado de cada desafio é contado uma
-- vez; os demais resultados servem apenas para auditoria/critério de primeira
-- tentativa. A função não grava nada.
create or replace function public.ranking_global(p_temporada_id uuid default null)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  with t as (
    select coalesce(
      p_temporada_id,
      (select id from public.ranking_global_temporadas
       where status in ('aberta', 'encerrada', 'homologada')
       order by inicio desc limit 1)
    ) as id
  ), melhores as (
    select distinct on (r.usuario_id, d.id)
      r.usuario_id, d.id as desafio_id, d.semana, r.estrelas,
      r.aproveitamento, r.primeira_tentativa
    from public.ranking_global_resultados r
    join public.ranking_global_desafios d on d.id = r.desafio_id
    join t on t.id = d.temporada_id
    where r.validado_em is not null
    order by r.usuario_id, d.id, r.estrelas desc, r.aproveitamento desc, r.tentativa asc
  ), por_semana as (
    select usuario_id, semana, sum(estrelas)::int estrelas,
      avg(aproveitamento)::numeric(5,2) aproveitamento,
      sum(case when primeira_tentativa then 1 else 0 end)::int primeiras
    from melhores group by usuario_id, semana
  ), semanas_selecionadas as (
    select *, row_number() over (
      partition by usuario_id
      order by estrelas desc, aproveitamento desc, primeiras desc, semana
    ) as n
    from por_semana
  ), totais as (
    select usuario_id, sum(estrelas)::int estrelas,
      avg(aproveitamento)::numeric(5,2) aproveitamento,
      sum(primeiras)::int primeiras, count(*)::int semanas
    from semanas_selecionadas s
    join t on true
    where s.n <= (select max_semanas from public.ranking_global_temporadas where id = t.id)
    group by usuario_id
  ), ordenado as (
    select row_number() over (order by estrelas desc, aproveitamento desc, primeiras desc, usuario_id) posicao,
      usuario_id, estrelas, aproveitamento, primeiras, semanas
    from totais
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'posicao', posicao, 'usuario_id', usuario_id, 'estrelas', estrelas,
    'aproveitamento', aproveitamento, 'primeiras_tentativas', primeiras,
    'semanas', semanas
  ) order by posicao), '[]'::jsonb) from ordenado;
$$;

revoke all on function public.ranking_global(uuid) from public, anon;
grant execute on function public.ranking_global(uuid) to authenticated;
