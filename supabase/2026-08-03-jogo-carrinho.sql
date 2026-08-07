-- =====================================================================
--  Filhos da Conquista — Carrinho na Estrada (jogo de estrelas) 2026-08-03
--
--  COMO APLICAR: Supabase -> SQL Editor -> New query -> cole -> Run. Idempotente.
--
--  🚗 Corrida pegando itens: arraste o dedo, pegue os itens bons (⭐⛽🍎💧🪙) e
--  desvie dos perigos (🪨🚧🛢️🐄🌵). 3 vidas. Dá estrelas como os jogos normais
--  (1x por dia). Entra DESLIGADO — a liderança liga em Gestão -> 🎮 Jogos.
-- =====================================================================

insert into public.jogos_trilha (chave, nome, emoji, ativo, ordem) values
  ('carrinho', 'Carrinho na Estrada', '🚗', false, 22)
on conflict (chave) do nothing;

notify pgrst, 'reload schema';
