-- =============================================================================
-- 450 — A trava do modo manutenção (400) passa a cobrir as tabelas criadas depois dela
-- =============================================================================
-- A Comunidade (430–432) e a manutenção (400) foram feitas em paralelo; as tabelas da Comunidade
-- nasceram sem o gatilho zz_manutencao_guarda. A função da 400 é idempotente: instala a guarda em
-- toda tabela do public que ainda não tem (respeitando as exceções de telemetria/limite de tentativa).
-- Regra (CLAUDE.md): toda migration que cria tabela chama public._manutencao_instalar_guarda().
-- =============================================================================
select public._manutencao_instalar_guarda();
