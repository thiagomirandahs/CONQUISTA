-- =====================================================================
--  Filhos da Conquista — 4 jogos novos (leva 1) — 2026-07-15
--
--  COMO APLICAR: Supabase -> SQL Editor -> New query -> cole -> Run.
--  Idempotente. Só adiciona linhas no catálogo de jogos.
--
--  Entram DESLIGADOS: a liderança liga em Gestão -> 🎮 Jogos da Trilha.
--  A criança pode jogar cada um 1x por dia (1º do dia +10, extras +5).
-- =====================================================================

insert into public.jogos_trilha (chave, nome, emoji, ativo, ordem) values
  ('morse',   'Código Morse', '📻', false, 5),
  ('bussola', 'Bússola',      '🧭', false, 6),
  ('forca',   'Forca',        '🎯', false, 7),
  ('contas',  'Conta Rápida', '🔢', false, 8)
on conflict (chave) do nothing;

notify pgrst, 'reload schema';
