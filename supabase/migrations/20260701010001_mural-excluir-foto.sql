-- =====================================================================
--  Filhos da Conquista — Mural por categorias: permitir excluir foto
--
--  COMO APLICAR: Supabase -> SQL Editor -> New query -> cole -> Run.
--  Idempotente. (Já está dentro de supabase/schema.sql também.)
--
--  Sem isto, ADICIONAR e VER fotos no mural já funciona normalmente;
--  só o botão "Excluir" da foto é que precisa desta regra.
-- =====================================================================

-- Autor da foto (ou liderança: instrutor/diretoria) pode apagá-la.
drop policy if exists "apagar foto" on public.fotos;
create policy "apagar foto" on public.fotos for delete to authenticated
  using (autor_id = auth.uid() or public.pode_gerir());

notify pgrst, 'reload schema';
