-- =====================================================================
--  Filhos da Conquista — Ranking da Trilha do Acampamento (2026-07-07)
--
--  COMO APLICAR: Supabase -> SQL Editor -> New query -> cole -> Run.
--  Idempotente. Precisa da tabela trilha_jogos (2026-07-02-trilha.sql).
--
--  Monta o placar da Trilha: soma as ESTRELAS de cada um (1-3 por jogo,
--  quanto menos tentativas, mais estrelas) e conta os jogos (progresso).
--  Como o RLS esconde os jogos dos outros, essa função (security definer)
--  agrega no banco e devolve o ranking pronto pra todos verem.
-- =====================================================================

create or replace function public.ranking_trilha()
returns json language sql security definer set search_path = '' as $$
  select coalesce(
    json_agg(row_to_json(r) order by r.estrelas desc, r.passos desc, r.nome),
    '[]'::json)
  from (
    select p.id, p.nome, p.foto,
           count(*)::int              as passos,
           coalesce(sum(j.estrelas), 0)::int as estrelas
    from public.trilha_jogos j
    join public.profiles p on p.id = j.usuario_id
    where p.status = 'ativo' and p.papel <> 'pais'
    group by p.id, p.nome, p.foto
  ) r;
$$;
grant execute on function public.ranking_trilha() to authenticated;

notify pgrst, 'reload schema';
