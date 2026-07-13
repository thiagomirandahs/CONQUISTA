-- =====================================================================
--  Filhos da Conquista — Ranking por jogo (2026-07-13)
--
--  COMO APLICAR: Supabase -> SQL Editor -> New query -> cole -> Run.
--  Idempotente. Substitui a função ranking_trilha() (2026-07-07).
--
--  Antes o ranking somava TODOS os jogos num placar só. Agora devolve um
--  placar POR JOGO (memoria, genius, caca, desliza) + um "geral" com tudo
--  somado. A tela deixa a criança trocar de jogo no seletor.
--
--  Formato devolvido (JSON):
--    { "geral":   [ {id,nome,foto,passos,estrelas}, ... ],
--      "memoria": [ ... ], "genius": [ ... ], "caca": [ ... ], ... }
--  Jogo sem ninguém que jogou simplesmente não aparece como chave.
--
--  Continua security definer (agrega no banco, driblando o RLS que esconde
--  os jogos dos outros) e só conta quem está ativo e não é 'pais'.
-- =====================================================================

create or replace function public.ranking_trilha()
returns json language sql security definer set search_path = '' as $$
  with base as (
    select p.id, p.nome, p.foto,
           coalesce(nullif(j.tipo, ''), 'memoria') as tipo,
           coalesce(j.estrelas, 0)                 as estrelas
    from public.trilha_jogos j
    join public.profiles p on p.id = j.usuario_id
    where p.status = 'ativo' and p.papel <> 'pais'
  ),
  agg as (
    -- um placar por jogo
    select tipo, id, nome, foto,
           count(*)::int        as passos,
           sum(estrelas)::int   as estrelas
    from base
    group by tipo, id, nome, foto
    union all
    -- e o "geral" (todos os jogos somados)
    select 'geral' as tipo, id, nome, foto,
           count(*)::int        as passos,
           sum(estrelas)::int   as estrelas
    from base
    group by id, nome, foto
  )
  select coalesce(json_object_agg(tipo, linhas), '{}'::json)
  from (
    select tipo,
           json_agg(
             json_build_object(
               'id', id, 'nome', nome, 'foto', foto,
               'passos', passos, 'estrelas', estrelas
             )
             order by estrelas desc, passos desc, nome
           ) as linhas
    from agg
    group by tipo
  ) x;
$$;
grant execute on function public.ranking_trilha() to authenticated;

notify pgrst, 'reload schema';
