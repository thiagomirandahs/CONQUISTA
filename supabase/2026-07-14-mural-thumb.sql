-- =====================================================================
--  Filhos da Conquista — Miniatura do Mural (2026-07-14)
--
--  COMO APLICAR: Supabase -> SQL Editor -> New query -> cole -> Run.
--  Idempotente e leve: só adiciona 1 coluna. Nada é apagado.
--
--  O Mural passa a guardar uma MINIATURA (~400px) além da foto cheia. O grid
--  do álbum e as capas mostram a miniatura (~15-25KB) em vez da foto inteira
--  (~200-500KB) — economiza MUITA internet. A foto cheia continua no lightbox.
--  Fotos antigas ficam com thumb = null e o app cai pra foto cheia (fallback).
-- =====================================================================

alter table public.fotos add column if not exists thumb text;

notify pgrst, 'reload schema';
