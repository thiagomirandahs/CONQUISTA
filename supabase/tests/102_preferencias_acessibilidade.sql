-- Migration 420: preferências de acessibilidade (tamanho de letra e alto contraste) salvas na conta.
-- Cada pessoa grava SÓ a própria preferência (a RPC não recebe id), os valores são validados,
-- ninguém lê a preferência de outra pessoa pelo SELECT direto, e o anônimo não executa nada.
begin;
\ir _lib.sql
\ir _fixtures.sql

-- ---------- padrão ----------
select t.eq('coluna nasce vazia ({})', (select preferencias::text from public.profiles where id = t.id('membro_a')), '{}');

-- ---------- grava a própria ----------
select t.como('membro_a');
select t.eq('desbravador salva a própria preferência',
  (public.salvar_preferencias_acessibilidade('grande', true))->>'fonte', 'grande');
select t.eq('meu_perfil devolve a preferência salva',
  (select (p.preferencias->>'alto_contraste') from public.meu_perfil() p), 'true');
select t.como('lider_a');
select public.salvar_preferencias_acessibilidade('enorme', false);
reset role;
select t.eq('a da diretoria não sobrescreveu a do desbravador',
  (select preferencias->>'fonte' from public.profiles where id = t.id('membro_a')), 'grande');
select t.eq('a da diretoria ficou na linha dela',
  (select preferencias->>'fonte' from public.profiles where id = t.id('lider_a')), 'enorme');
select t.eq('só 2 perfis têm preferência gravada',
  (select count(*) from public.profiles where preferencias <> '{}'::jsonb), 2);

-- ---------- valores validados ----------
select t.como('membro_a');
select t.throws('fonte fora da lista é recusada', 'select public.salvar_preferencias_acessibilidade(''gigante'', false)', 'Tamanho de letra');
select t.throws('fonte nula é recusada', 'select public.salvar_preferencias_acessibilidade(null, false)', 'Tamanho de letra');
select t.throws('alto contraste nulo é recusado', 'select public.salvar_preferencias_acessibilidade(''normal'', null)', 'alto contraste');
select t.throws('texto injetado na fonte é recusado', 'select public.salvar_preferencias_acessibilidade(''normal''''; drop table x'', false)', 'Tamanho de letra');
reset role;
select t.eq('valores recusados não mudaram nada',
  (select preferencias->>'fonte' from public.profiles where id = t.id('membro_a')), 'grande');

-- ---------- sem atalho pela tabela ----------
select t.como('membro_a');
select t.throws('não grava preferencias por UPDATE direto',
  format('update public.profiles set preferencias = ''{"fonte":"x"}'' where id = %L', t.id('membro_a')));
select t.como('lider_a');
select t.throws('colega do clube não lê a preferência do outro pelo SELECT direto',
  format('select preferencias from public.profiles where id = %L', t.id('membro_a')));
select t.eq('meu_perfil de outra pessoa só devolve a própria linha',
  (select p.id from public.meu_perfil() p), t.id('lider_a'));

-- ---------- anônimo ----------
select t.como_anon();
select t.throws('anônimo não executa a RPC', 'select public.salvar_preferencias_acessibilidade(''normal'', false)');
reset role;
select t.ok('anon sem EXECUTE na RPC',
  not has_function_privilege('anon', 'public.salvar_preferencias_acessibilidade(text, boolean)', 'execute'));
select t.ok('RPC é security definer com search_path vazio',
  (select p.prosecdef and p.proconfig @> array['search_path=""']
     from pg_proc p where p.oid = 'public.salvar_preferencias_acessibilidade(text, boolean)'::regprocedure));

select t.fim();
rollback;
