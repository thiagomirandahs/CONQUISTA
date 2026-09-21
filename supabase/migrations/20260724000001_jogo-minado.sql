-- =====================================================================
--  Filhos da Conquista — Jogo novo: Campo Minado (2026-07-24)
--
--  COMO APLICAR: Supabase -> SQL Editor -> New query -> cole -> Run.
--  Idempotente. Só adiciona a linha no catálogo de jogos.
--
--  Entra DESLIGADO: a liderança liga em Gestão -> 🎮 Jogos da Trilha.
-- =====================================================================

insert into public.jogos_trilha (chave, nome, emoji, ativo, ordem) values
  ('minado', 'Campo Minado', '💣', false, 13)
on conflict (chave) do nothing;

notify pgrst, 'reload schema';
