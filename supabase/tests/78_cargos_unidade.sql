-- Migration 230: cargos DA UNIDADE (capitão, secretário, conselheiro associado...) no vínculo.
begin;
\ir _lib.sql
\ir _fixtures.sql

select t.mk('capitao_a', 'Capitao A', 'desbravador', 'ativo', 'clube_a', 'A1', date '2013-02-02');

-- ==================== 1) só a diretoria define ====================
select t.como('instrutor_a');
select t.throws('instrutor não define cargo de unidade', format('select public.unidade_definir_cargo(%L, %L)', t.id('membro_a'), 'capitao'), 'Sem permissão');
select t.como('conselheiro_a');
select t.throws('conselheiro não define cargo de unidade', format('select public.unidade_definir_cargo(%L, %L)', t.id('membro_a'), 'capitao'), 'Sem permissão');
select t.como('membro_a');
select t.throws('desbravador não define cargo de unidade', format('select public.unidade_definir_cargo(%L, %L)', t.id('membro_a'), 'capitao'), 'Sem permissão');
select t.ok('sem UPDATE direto no vínculo', not has_table_privilege('authenticated', 'public.organization_memberships', 'update'));
reset role;
select t.ok('anon sem EXECUTE', not has_function_privilege('anon', 'public.unidade_definir_cargo(uuid, text)', 'execute')
  and not has_function_privilege('anon', 'public.cargos_unidade_do_clube()', 'execute'));

select t.como('lider_a');
select t.permitido('diretoria define capitão', format('select public.unidade_definir_cargo(%L, %L)', t.id('membro_a'), 'capitao'));
select t.permitido('diretoria define conselheiro da unidade', format('select public.unidade_definir_cargo(%L, %L)', t.id('conselheiro_a'), 'conselheiro'));
select t.throws('cargo inválido recusado', format('select public.unidade_definir_cargo(%L, %L)', t.id('capitao_a'), 'general'), 'inválido');
select t.throws('desbravador não vira conselheiro da unidade', format('select public.unidade_definir_cargo(%L, %L)', t.id('capitao_a'), 'conselheiro_associado'), 'liderança');
select t.throws('sem unidade não recebe cargo', format('select public.unidade_definir_cargo(%L, %L)', t.id('instrutor_a'), 'capelao'), 'unidade');

-- ==================== 2) cargo único por unidade ====================
select t.throws('segundo capitão na mesma unidade recusado', format('select public.unidade_definir_cargo(%L, %L)', t.id('capitao_a'), 'capitao'), 'já tem alguém');
select t.permitido('secretário na mesma unidade ok', format('select public.unidade_definir_cargo(%L, %L)', t.id('capitao_a'), 'secretario'));
select t.permitido('capitão em OUTRA unidade ok', format('select public.unidade_definir_cargo(%L, %L)', t.id('membro_a2'), 'capitao'));
select t.eq('leitura: 4 cargos no clube A', t.n('select count(*) from public.cargos_unidade_do_clube()'), 4);
select t.como('membro_a');
select t.eq('membro comum também vê a diretoria da unidade', t.n('select count(*) from public.cargos_unidade_do_clube()'), 4);
select t.como('lider_a');
select t.permitido('voltar a Desbravador limpa o cargo', format('select public.unidade_definir_cargo(%L, %L)', t.id('capitao_a'), 'desbravador'));
reset role;
select t.ok('cargo limpo', (select cargo_unidade from public.organization_memberships where user_id = t.id('capitao_a')) is null);
select t.throws('índice único segura mesmo por fora da RPC',
  format($q$update public.organization_memberships set cargo_unidade = 'capitao' where user_id = %L$q$, t.id('capitao_a')), 'uq_cargo_por_unidade');
-- trocar de unidade derruba o cargo
update public.organization_memberships set unidade_id = t.id('A2') where user_id = t.id('membro_a') and organizational_unit_id = t.id('clube_a');
select t.ok('trocar de unidade limpa o cargo', (select cargo_unidade from public.organization_memberships where user_id = t.id('membro_a') and organizational_unit_id = t.id('clube_a')) is null);

-- ==================== 3) outro clube não altera nem lê ====================
select t.como('lider_b');
select t.throws('diretoria de B não mexe em membro de A', format('select public.unidade_definir_cargo(%L, %L)', t.id('membro_a2'), 'secretario'), 'não encontrado');
select t.eq('diretoria de B não vê cargos de A', t.n('select count(*) from public.cargos_unidade_do_clube()'), 0);
select t.pedir_clube('clube_a');
select t.throws('B pedindo o clube A (sem vínculo) continua sem acesso', format('select public.unidade_definir_cargo(%L, %L)', t.id('membro_a2'), 'secretario'), null);
reset role;
select t.eq('capitão de A2 continua intacto', t.txt(format('select cargo_unidade from public.organization_memberships where user_id = %L', t.id('membro_a2'))), 'capitao');
-- o cargo não dá acesso de gestão
select t.como('membro_a2');
select t.throws('capitão não ganha gestão', format('select public.unidade_definir_cargo(%L, %L)', t.id('membro_a2'), 'secretario'), 'Sem permissão');

select t.fim();
rollback;
