-- =====================================================================
--  Filhos da Conquista — Jogos da mente (leva 1) — 2026-07-24
--
--  COMO APLICAR: Supabase -> SQL Editor -> New query -> cole -> Run.
--  Idempotente. Só adiciona linhas no catálogo de jogos.
--
--  4 jogos pra estimular MEMÓRIA e RACIOCÍNIO LÓGICO. Entram DESLIGADOS:
--  a liderança liga em Gestão -> 🎮 Jogos da Trilha.
-- =====================================================================

insert into public.jogos_trilha (chave, nome, emoji, ativo, ordem) values
  ('mudou',   'O Que Mudou?',      '👀', false, 14),
  ('hanoi',   'Torre de Hanói',    '🗼', false, 15),
  ('termo',   'Termo do Clube',    '🟩', false, 16),
  ('proximo', 'Qual é o Próximo?', '➡️', false, 17)
on conflict (chave) do nothing;

notify pgrst, 'reload schema';
