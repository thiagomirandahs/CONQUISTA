-- =====================================================================
--  Filhos da Conquista — Identidade da Unidade (2026-07-13)
--
--  COMO APLICAR: Supabase -> SQL Editor -> New query -> cole -> Run.
--  Idempotente e leve: só adiciona 3 colunas de texto/imagem na tabela
--  unidades. Nada é apagado.
--
--  Dá "alma" pras unidades: lema, grito e uma bandeira (imagem). O emblema
--  e o conselheiro (conselheiro_id / papel='conselheiro') já existiam. As
--  policies "ler unidades publico" (todos leem) e "gerir unidades" (liderança
--  edita) já cobrem essas colunas — não precisa mexer em RLS.
-- =====================================================================

alter table public.unidades add column if not exists lema text;
alter table public.unidades add column if not exists grito text;
alter table public.unidades add column if not exists bandeira text; -- URL da imagem no Storage

notify pgrst, 'reload schema';
