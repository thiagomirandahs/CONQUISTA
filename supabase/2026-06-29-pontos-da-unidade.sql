-- =====================================================================
--  Filhos da Conquista — Pontos avulsos direto para a UNIDADE (time)
--
--  COMO APLICAR: Supabase -> SQL Editor -> New query -> cole -> Run.
--  Idempotente. (Já está dentro de supabase/schema.sql também.)
--
--  Depois disto, a liderança (instrutor/diretoria) pode lançar pontos
--  de time para uma unidade (ex.: "+50 por vencer a gincana"), sem
--  precisar de atividade nem distribuir entre os desbravadores.
--  O ranking da unidade passa a ser:  pontos do time + média dos membros.
-- =====================================================================

-- 1) Coluna que aponta o lançamento para uma unidade (em vez de uma pessoa).
alter table public.pontos
  add column if not exists unidade_id uuid references public.unidades(id) on delete cascade;

-- 2) Regras: pontos de time (unidade_id preenchido) só a liderança lança/apaga;
--    pontos individuais continuam com a regra de sempre (pode_apontar).
drop policy if exists "lancar pontos" on public.pontos;
create policy "lancar pontos" on public.pontos for insert to authenticated with check (
  case when unidade_id is not null then public.pode_gerir()
       else public.pode_apontar(usuario_id) end
);
drop policy if exists "apagar pontos" on public.pontos;
create policy "apagar pontos" on public.pontos for delete to authenticated using (
  case when unidade_id is not null then public.pode_gerir()
       else public.pode_apontar(usuario_id) end
);

notify pgrst, 'reload schema';
