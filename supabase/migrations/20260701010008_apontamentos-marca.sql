-- =====================================================================
--  Filhos da Conquista — Apontamentos não zeram mais ao reabrir
--
--  Guarda O QUE foi marcado (presença, bíblia, uniforme, igreja, atividade)
--  de cada desbravador, pra a tela pré-carregar o que já foi salvo e você
--  poder ajustar só um atraso sem apagar o resto.
--
--  COMO APLICAR: Supabase -> SQL Editor -> New query -> cole -> Run.
-- =====================================================================

alter table public.pontos add column if not exists marca jsonb;

notify pgrst, 'reload schema';
