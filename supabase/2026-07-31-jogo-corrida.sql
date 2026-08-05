-- =====================================================================
--  Filhos da Conquista — Corrida do Acampamento (jogo de recorde) 2026-07-31
--
--  COMO APLICAR: Supabase -> SQL Editor -> New query -> cole -> Run. Idempotente.
--
--  🏕️ Jogo estilo "dinossauro": corre e pula os obstáculos do acampamento.
--  É ARCADE (igual ao Reflexo): cada corrida vira RECORDE da semana e o maior
--  ganha +20 no domingo (a premiar_campeao_semana já cobre todos os jogos que
--  gravam recorde). Entra DESLIGADO — a liderança liga em Gestão -> 🎮 Jogos.
-- =====================================================================

insert into public.jogos_trilha (chave, nome, emoji, ativo, ordem) values
  ('corrida', 'Corrida do Acampamento', '🏕️', false, 20)
on conflict (chave) do nothing;

notify pgrst, 'reload schema';
