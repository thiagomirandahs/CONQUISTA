-- =====================================================================
--  Filhos da Conquista — Liderança pode apagar entregas de atividades
--
--  COMO APLICAR: Supabase -> SQL Editor -> New query -> cole -> Run.
--  Sem isto, ver as entregas já funciona; só o botão "Apagar" precisa disto.
-- =====================================================================

drop policy if exists "apagar entrega" on public.entregas;
create policy "apagar entrega" on public.entregas for delete to authenticated
  using (public.pode_gerir());

notify pgrst, 'reload schema';
