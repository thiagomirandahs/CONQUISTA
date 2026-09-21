-- =====================================================================
--  Filhos da Conquista — Agenda: período do evento (data_fim) + contagem
--  (2026-08-31)
--
--  Eventos de vários dias (ex.: acampamento de 4 a 7): coluna opcional data_fim.
--  A contagem regressiva no app funciona SÓ com a data de início (não precisa
--  disto); esta coluna só serve pra mostrar "4 a 7" e manter o evento como
--  "🔴 Acontecendo agora!" durante o período. Idempotente. Nada é apagado.
--
--  COMO APLICAR: Supabase -> SQL Editor -> New query -> cole -> Run.
-- =====================================================================

alter table public.eventos add column if not exists data_fim date;

notify pgrst, 'reload schema';
