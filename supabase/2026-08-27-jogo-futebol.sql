-- =====================================================================
--  Filhos da Conquista — Pênaltis (jogo de futebol) 2026-08-27
--
--  COMO APLICAR: Supabase -> SQL Editor -> New query -> cole -> Run. Idempotente.
--
--  ⚽ Pênaltis: cobre 5 chutes arrastando pra mirar o canto; o goleiro se joga.
--  É jogo NORMAL (dá estrelas 1x por dia, igual aos de lógica): 5 gols = 3⭐,
--  3-4 = 2⭐, senão 1⭐. Só adiciona a linha no catálogo — entra DESLIGADO; a
--  liderança liga em Gestão -> 🎮 Jogos da Trilha.
-- =====================================================================

insert into public.jogos_trilha (chave, nome, emoji, ativo, ordem) values
  ('futebol', 'Pênaltis', '⚽', false, 22)
on conflict (chave) do nothing;

notify pgrst, 'reload schema';
