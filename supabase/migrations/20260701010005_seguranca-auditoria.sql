-- =====================================================================
--  Filhos da Conquista — Correções de segurança (auditoria 2026-06-29)
--
--  COMO APLICAR no projeto que JÁ ESTÁ no ar:
--    Supabase -> SQL Editor -> New query -> cole TUDO -> Run.
--    É idempotente: pode rodar mais de uma vez sem problema.
--
--  (Estas mudanças também já estão dentro de supabase/schema.sql, então
--   um banco novo criado a partir do schema já nasce corrigido.)
-- =====================================================================

-- ---------------------------------------------------------------------
-- A1) Apontamentos: conselheiro NÃO pode pontuar a si mesmo nem outros
--     líderes — só desbravadores da sua própria unidade.
-- ---------------------------------------------------------------------
create or replace function public.pode_apontar(alvo uuid)
returns boolean language sql security definer set search_path = public as $$
  select public.pode_gerir() or exists (
    select 1 from public.profiles eu
    join public.profiles d on d.unidade_id = eu.unidade_id
    where eu.id = auth.uid() and eu.papel = 'conselheiro' and eu.status = 'ativo'
      and d.id = alvo and d.papel = 'desbravador'
  );
$$;

-- ---------------------------------------------------------------------
-- A2) Remover privilégios amplos do papel público 'anon'.
--     Visitante deslogado só precisa LER as unidades (tela de cadastro).
--     O 'authenticated' continua com tudo, sempre filtrado pelo RLS.
-- ---------------------------------------------------------------------
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
alter default privileges in schema public revoke all on tables from anon;

grant select on public.unidades to anon;

-- Recarrega o schema exposto pela API
notify pgrst, 'reload schema';
