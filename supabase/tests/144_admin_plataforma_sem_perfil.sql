-- Admin da plataforma SEM linha em profiles (migration 539): cria desafio da Rede, salva termo da triagem e a FK de moderação aceita o admin.
-- E o comportamento antigo se mantém: apagar o usuário zera o "quem fez" (ON DELETE SET NULL), sem apagar o registro.
begin;
\ir _lib.sql
\ir _fixtures.sql

\o /dev/null
select t.signup('adm144', '{"tipo":"fundador","nome":"Admin 144"}'::jsonb);
select t.signup('adm144b', '{"tipo":"fundador","nome":"Admin 144 B"}'::jsonb);
insert into public.platform_admins (user_id, papel) values (t.id('adm144'), 'operacao');
delete from public.profiles where id in (t.id('adm144'), t.id('adm144b'));
\o

select t.eq('as 3 FKs apontam para auth.users com ON DELETE SET NULL',
  (select count(*) from pg_constraint c where c.contype = 'f' and c.confrelid = 'auth.users'::regclass and c.confdeltype = 'n'
     and c.conname in ('rede_desafios_criado_por_fkey', 'comunidade_termos_criado_por_fkey', 'comunidade_moderacao_log_por_fkey')), 3::bigint);

select t.como('adm144');
select set_config('t144.d', public.admin_rede_desafio_salvar(null, 'Desafio sem perfil', 'x', 10, now(), now() + interval '7 days', true)::text, true) is not null;
select public.admin_comunidade_termo_salvar('zztermoteste', 'exata', 'ofensa', true) is not null;
reset role;
select t.eq('desafio criado pelo admin sem perfil (criado_por = o admin)', (select (criado_por = t.id('adm144'))::text from public.rede_desafios where titulo = 'Desafio sem perfil'), 'true');
select t.eq('termo da triagem salvo pelo admin sem perfil (o termo é normalizado, então acha pelo autor)', (select count(*) from public.comunidade_termos where criado_por = t.id('adm144')), 1::bigint);

-- apagar o usuário: a linha fica, o autor vira nulo
delete from auth.users where id = t.id('adm144');
select t.eq('desafio continua existindo com criado_por nulo', (select (criado_por is null)::text from public.rede_desafios where titulo = 'Desafio sem perfil'), 'true');

-- o log de moderação (imutável) aceita um admin sem perfil como autor
insert into public.comunidade_moderacao_log (club_id, alvo_tipo, alvo_id, acao, por, via, motivo)
values (t.id('clube_a'), 'post', gen_random_uuid(), 'restaurar', t.id('adm144b'), 'plataforma', 'teste 144');
select t.eq('log de moderação com o admin como autor', (select count(*) from public.comunidade_moderacao_log where motivo = 'teste 144' and por = t.id('adm144b')), 1::bigint);
select t.fim();
rollback;
