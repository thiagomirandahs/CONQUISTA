-- Achados da revisão de REGRESSÃO da rodada 2 (Tenant 001):
--   1) instrutor "promovendo" alguém a diretoria/instrutor/tesoureiro (ou mexendo em quem já tem esses cargos): o cargo era
--      revertido EM SILÊNCIO, mas a unidade da pessoa era apagada e a tela mostrava sucesso -> agora é ERRO CLARO e nada muda;
--   2) falha de cron por clube virava só WARNING: o job aparecia como sucesso -> agora fica registrada em cron_falhas.
begin;
\ir _lib.sql
\ir _fixtures.sql

-- ---------- 1) instrutor: erro claro, sem efeito colateral ----------
select t.como('instrutor_a');
select t.throws('instrutor NÃO promove desbravador a tesoureiro (erro claro, não silêncio)', format($q$update public.profiles set papel = 'tesoureiro', unidade_id = null where id = %L$q$, t.id('membro_a')), 'diretoria');
select t.throws('instrutor NÃO promove a diretoria', format($q$update public.profiles set papel = 'diretoria' where id = %L$q$, t.id('membro_a')), 'diretoria');
select t.throws('instrutor NÃO desativa o tesoureiro', format($q$update public.profiles set status = 'inativo' where id = %L$q$, t.id('tesoureiro_a')), 'diretoria');
select t.throws('instrutor NÃO rebaixa a diretoria', format($q$update public.profiles set papel = 'desbravador' where id = %L$q$, t.id('lider_a')), 'diretoria');
select t.permitido('instrutor AINDA muda a unidade de um desbravador (operação de sempre)', format($q$update public.profiles set unidade_id = %L where id = %L$q$, t.id('A2'), t.id('membro_a')));
select t.permitido('instrutor AINDA promove desbravador a conselheiro (só os cargos de liderança são da diretoria)', format($q$update public.profiles set papel = 'conselheiro' where id = %L$q$, t.id('membro_a2')));
select t.permitido('instrutor AINDA muda a unidade do tesoureiro (não mexe em cargo/status)', format($q$update public.profiles set unidade_id = %L where id = %L$q$, t.id('A1'), t.id('tesoureiro_a')));
reset role;
select t.eq('nada mudou nas tentativas recusadas: o membro A segue desbravador (só a unidade mudou, como permitido)', (select papel || '/' || (unidade_id = t.id('A2'))::text from public.profiles where id = t.id('membro_a')), 'desbravador/true');
select t.eq('o tesoureiro segue ativo e a diretoria segue diretoria', (select count(*) from public.profiles where (id = t.id('tesoureiro_a') and papel = 'tesoureiro' and status = 'ativo') or (id = t.id('lider_a') and papel = 'diretoria')), 2);
select t.como('lider_a');
select t.permitido('a DIRETORIA promove a tesoureiro normalmente', format($q$update public.profiles set papel = 'tesoureiro' where id = %L$q$, t.id('membro_a')));
select t.permitido('a DIRETORIA desativa um instrutor normalmente', format($q$update public.profiles set status = 'inativo' where id = %L$q$, t.id('instrutor_a')));
select t.como('membro_a');
select t.permitido('o membro edita o próprio perfil (nome) sem erro, e o cargo não muda', format($q$update public.profiles set nome = 'Nome novo', papel = 'diretoria' where id = %L$q$, t.id('membro_a')));
reset role;
select t.eq('...o auto-cargo foi ignorado (segue o que a diretoria definiu)', (select papel from public.profiles where id = t.id('membro_a')), 'tesoureiro');

-- ---------- 2) falha de cron por clube fica REGISTRADA ----------
select t.eq('a tabela cron_falhas existe, é interna (RLS ligado, sem acesso de usuário)',
  (select count(*) from pg_class c where c.relnamespace = 'public'::regnamespace and c.relname = 'cron_falhas' and c.relrowsecurity)
  + (select count(*) from information_schema.role_table_grants where table_schema = 'public' and table_name = 'cron_falhas' and grantee in ('authenticated', 'anon')), 1);
insert into public.organizational_units (type, nome, slug, pais, timezone, metadata, created_at)
values ('clube', 'Clube Lixo', 'clube-lixo-teste', 'BR', 'America/Recife', '{"test_only":true}', '2000-01-01');
select id as clube_lixo from public.organizational_units where slug = 'clube-lixo-teste' \gset
insert into public.config_clube (club_id, chave, valor) values
  (:'clube_lixo', 'chefao_ativo', 'sim'), (:'clube_lixo', 'chefao_inicio', to_char(current_date - 3, 'YYYY-MM-DD')), (:'clube_lixo', 'chefao_vida', 'abc')
on conflict (club_id, chave) do update set valor = excluded.valor;
select t.como_cron();
select t.permitido('o cron do chefão segue sem estourar com um clube quebrado', $q$select public.chefao_premiar()$q$);
reset role;
select t.eq('...e a falha do clube quebrado ficou REGISTRADA (rotina, clube e motivo)', (select count(*) from public.cron_falhas where rotina = 'chefao_premiar' and club_id = :'clube_lixo' and erro is not null), 1);
select t.eq('...só uma falha (os outros clubes rodaram)', (select count(*) from public.cron_falhas), 1);
select t.eq('a rotina de registro não é executável por usuário', (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = '_cron_registrar_falha' and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute'))), 0);

select t.fim();
rollback;
