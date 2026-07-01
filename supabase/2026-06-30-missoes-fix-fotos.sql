-- =====================================================================
--  Filhos da Conquista — Corrige as missões de FOTO (tira o quiz sem sentido)
--  Missão de foto = fazer a tarefa e enviar a foto. Sem alternativas.
--  Rode SÓ se você já aplicou o 2026-06-30-missoes.sql antes.
-- =====================================================================

update public.desafios set opcoes = '[]'::jsonb where pede_foto = true;

notify pgrst, 'reload schema';
