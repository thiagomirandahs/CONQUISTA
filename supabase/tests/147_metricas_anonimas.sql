-- Métricas de uso anônimas (migration 545): anon registra sem identificar ninguém, só o admin da
-- plataforma lê, a tabela é fechada, há limite por sessão e a limpeza apaga o que passou de 40 dias.
begin;
\ir _lib.sql
\ir _fixtures.sql

\o /dev/null
select t.signup('adm147', '{"tipo":"fundador","nome":"Admin 147"}'::jsonb);
insert into public.platform_admins (user_id, papel) values (t.id('adm147'), 'operacao');
\o

-- anon registra: site, app e apk; a mesma sessão não duplica
select t.como_anon();
select public.metrica_registrar('11111111-1111-1111-1111-111111111111', 'site');
select public.metrica_registrar('11111111-1111-1111-1111-111111111111', 'site');
select public.metrica_registrar('22222222-2222-2222-2222-222222222222', 'app', true, true);
select public.metrica_registrar('33333333-3333-3333-3333-333333333333', 'apk', true, true);
-- entradas inválidas são ignoradas em silêncio
select public.metrica_registrar(null, 'site');
select public.metrica_registrar('44444444-4444-4444-4444-444444444444', 'hacker');
reset role;

select t.eq('3 sessões gravadas (repetida não duplica; inválidas ignoradas)', (select count(*) from public.metricas_sessoes), 3::bigint);
select t.eq('a tabela não guarda nada que identifique: só 7 colunas anônimas',
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'metricas_sessoes'
     and column_name in ('sessao','origem','dia','primeiro_em','ultimo_em','paginas','logado')), 7::bigint);
select t.eq('...e nenhuma outra coluna existe',
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'metricas_sessoes'), 7::bigint);

-- limite por sessão: sinal em < 20 s sem página nova não mexe; com página nova conta
update public.metricas_sessoes set ultimo_em = now() - interval '5 seconds' where sessao = '11111111-1111-1111-1111-111111111111';
select t.como_anon();
select public.metrica_registrar('11111111-1111-1111-1111-111111111111', 'site');
reset role;
select t.eq('sinal repetido em < 20 s não regrava', (select count(*) from public.metricas_sessoes where sessao = '11111111-1111-1111-1111-111111111111' and ultimo_em < now() - interval '4 seconds'), 1::bigint);
select t.como_anon();
select public.metrica_registrar('11111111-1111-1111-1111-111111111111', 'site', true);
reset role;
select t.eq('página nova conta (2 páginas)', (select paginas from public.metricas_sessoes where sessao = '11111111-1111-1111-1111-111111111111')::bigint, 2::bigint);

-- a tabela é fechada para quem entra pelo PostgREST
select t.como_anon();
select t.bloqueado('anon não lê a tabela', 'select count(*) from public.metricas_sessoes');
reset role;
select t.como('lider_a');
select t.bloqueado('nem a liderança de um clube lê a tabela', 'select count(*) from public.metricas_sessoes');
select t.throws('...nem a leitura agregada do admin', 'select public.admin_metricas()', 'Sem permissão');
reset role;

-- admin lê: agora = 3 (site 1, app 1, apk 1), 2 logados nos apps
select t.como('adm147');
select set_config('t147.m', public.admin_metricas()::text, true);
reset role;
select t.eq('agora: total 3', (current_setting('t147.m')::jsonb #>> '{agora,total}')::bigint, 3::bigint);
select t.eq('agora: 1 no site', (current_setting('t147.m')::jsonb #>> '{agora,site}')::bigint, 1::bigint);
select t.eq('agora: 1 no app e 1 no apk', (current_setting('t147.m')::jsonb #>> '{agora,app}')::bigint + (current_setting('t147.m')::jsonb #>> '{agora,apk}')::bigint, 2::bigint);
select t.eq('agora: 2 logados nos apps', (current_setting('t147.m')::jsonb #>> '{agora,app_logados}')::bigint, 2::bigint);
select t.eq('visitas hoje: 1 visitante no site (2 páginas)', (current_setting('t147.m')::jsonb #>> '{visitas,hoje,site,visitantes}')::bigint, 1::bigint);
select t.eq('visitas hoje: 2 sessões de app', (current_setting('t147.m')::jsonb #>> '{visitas,hoje,app,sessoes}')::bigint, 2::bigint);
select t.eq('série de 14 dias, com dias zerados', jsonb_array_length(current_setting('t147.m')::jsonb -> 'serie')::bigint, 14::bigint);

-- quem parou de dar sinal sai do "agora" mas continua nas visitas
update public.metricas_sessoes set ultimo_em = now() - interval '10 minutes' where sessao = '11111111-1111-1111-1111-111111111111';
select t.como('adm147');
select set_config('t147.m2', public.admin_metricas()::text, true);
reset role;
select t.eq('sessão parada há 10 min sai do agora', (current_setting('t147.m2')::jsonb #>> '{agora,site}')::bigint, 0::bigint);
select t.eq('...mas segue nas visitas de hoje', (current_setting('t147.m2')::jsonb #>> '{visitas,hoje,site,visitantes}')::bigint, 1::bigint);

-- limpeza: 40 dias
update public.metricas_sessoes set ultimo_em = now() - interval '41 days' where sessao = '33333333-3333-3333-3333-333333333333';
select t.eq('a limpeza apaga 1 sessão antiga', public.metricas_limpar()::bigint, 1::bigint);
select t.eq('...e preserva as outras', (select count(*) from public.metricas_sessoes), 2::bigint);
select t.como_anon();
select t.bloqueado('anon não chama a limpeza', 'select public.metricas_limpar()');
reset role;

select t.fim();
rollback;
