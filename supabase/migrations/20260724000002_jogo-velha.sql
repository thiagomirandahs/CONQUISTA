-- =====================================================================
--  Filhos da Conquista — Jogo novo: Jogo da Velha (2026-07-24)
--
--  COMO APLICAR: Supabase -> SQL Editor -> New query -> cole -> Run.
--  Idempotente. Só adiciona a linha no catálogo de jogos.
--
--  Entra DESLIGADO: a liderança liga em Gestão -> 🎮 Jogos da Trilha.
--  (O 🎨 Ateliê de Desenho não precisa de SQL: ele mora no Mural.)
-- =====================================================================

insert into public.jogos_trilha (chave, nome, emoji, ativo, ordem) values
  ('velha', 'Jogo da Velha', '⭕', false, 18)
on conflict (chave) do nothing;

notify pgrst, 'reload schema';
