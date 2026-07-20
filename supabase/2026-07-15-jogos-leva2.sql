-- =====================================================================
--  Filhos da Conquista — 4 jogos novos (leva 2) — 2026-07-15
--
--  COMO APLICAR: Supabase -> SQL Editor -> New query -> cole -> Run.
--  Idempotente. Só adiciona linhas no catálogo de jogos.
--
--  Entram DESLIGADOS: a liderança liga em Gestão -> 🎮 Jogos da Trilha.
-- =====================================================================

insert into public.jogos_trilha (chave, nome, emoji, ativo, ordem) values
  ('nos',      'Quiz dos Nós', '🪢', false,  9),
  ('semaforo', 'Semáfora',     '🚩', false, 10),
  ('cobra',    'Cobrinha',     '🐍', false, 11),
  ('anagrama', 'Anagrama',     '🔤', false, 12)
on conflict (chave) do nothing;

notify pgrst, 'reload schema';
