-- =====================================================================
--  Filhos da Conquista — Moderação de recordes (2026-07-27)
--
--  COMO APLICAR: Supabase -> SQL Editor -> New query -> cole -> Run.
--  Idempotente.
--
--  A liderança (instrutor/diretoria) ganha um 🗑️ no ranking do ⚡ pra apagar
--  um recorde suspeito da semana (ex.: forjado pelo console do navegador).
--  A criança pode cravar um novo jogando de verdade.
-- =====================================================================

drop policy if exists "apagar recordes" on public.recordes;
create policy "apagar recordes" on public.recordes for delete to authenticated
  using (public.pode_gerir());

notify pgrst, 'reload schema';
