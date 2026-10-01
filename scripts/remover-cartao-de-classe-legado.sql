-- =============================================================================
--  Remove o "Cartão de Classe" legado — recurso ANTERIOR ao motor curricular novo
--  (classes/especialidades da migration 36+). Achado pela Etapa 1 da migração
--  (inventário read-only do Conquista real): as tabelas existem no schema real,
--  com 0 linhas de dado, e uma policy de cada uma depende de public.pode_gerir(),
--  que as migrations 05/20/26 dropam SEM cascade — sem esta remoção, a janela
--  aborta bem no início.
--
--  AUTORIZAÇÃO E PROVA (Etapa 3, ensaio sobre o backup real, RUN 1 e RUN 2):
--    - RUN 1 reproduziu o abort exato (migration 05/20/26: "cannot drop function
--      pode_gerir() because policy ... depends on it") aplicando as migrations
--      SEM esta remoção.
--    - Auditoria de dependência (pg_depend + varredura de texto no corpo de toda
--      função de public): só as 2 policies e as 3 funções abaixo (do próprio
--      Cartão de Classe) dependem de classe_requisitos/requisito_cumprido.
--      Nenhuma FK de/para essas tabelas. Nenhuma outra função cita esses nomes.
--      O motor curricular novo usa OUTRAS tabelas (class_requirements,
--      member_classes, etc., só criadas pela migration 36+), sem relação.
--    - classe_requisitos e requisito_cumprido têm 0 linhas na produção real
--      (conferido na Etapa 1 pela API e de novo nesta cópia).
--
--  Rode ANTES da migration 20260921000001 (no mesmo pré-janela do
--  scripts/pre-janela-conquista.sql). Não é reversível de graça — é uma remoção
--  de verdade, não um "if not exists"; por isso fica em arquivo separado, para
--  quem aplicar a janela real decidir conscientemente rodá-lo.
-- =============================================================================

drop policy if exists "gerir classe_requisitos" on public.classe_requisitos;
drop policy if exists "ler requisito_cumprido" on public.requisito_cumprido;

-- as 3 funções do Cartão de Classe, pela assinatura REAL (evita chute de tipo de parâmetro)
do $$
declare r record;
begin
  for r in select p.oid::regprocedure as assinatura
             from pg_proc p
            where p.pronamespace = 'public'::regnamespace
              and p.proname in ('avaliar_requisito', 'marcar_requisito', 'desmarcar_requisito')
  loop
    execute format('drop function if exists %s', r.assinatura);
  end loop;
end $$;

drop table if exists public.requisito_cumprido;
drop table if exists public.classe_requisitos;
