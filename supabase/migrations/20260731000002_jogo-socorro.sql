-- =====================================================================
--  Filhos da Conquista — Primeiros Socorros (jogo de quiz) 2026-07-31
--
--  COMO APLICAR: Supabase -> SQL Editor -> New query -> cole -> Run. Idempotente.
--
--  🚑 "O que fazer PRIMEIRO?": cenas reais da especialidade de Primeiros
--  Socorros (queimadura, corte, engasgo, picada, desmaio...). A criança escolhe
--  a ação certa e o jogo explica o porquê. Dá estrelas como os outros jogos.
--  Entra DESLIGADO — a liderança liga em Gestão -> 🎮 Jogos da Trilha.
-- =====================================================================

insert into public.jogos_trilha (chave, nome, emoji, ativo, ordem) values
  ('socorro', 'Primeiros Socorros', '🚑', false, 21)
on conflict (chave) do nothing;

notify pgrst, 'reload schema';
