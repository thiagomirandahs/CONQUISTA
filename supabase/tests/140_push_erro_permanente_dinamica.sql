-- PUSH (migration 534), parte 2: o que muda COM O TEMPO e entre aparelhos/clubes/usuários.
-- Prova: (1) tetos de retry por evento (1 tentativa para erro DEFINITIVO, 3 para o resto) e Retry-After respeitado;
-- (2) push_concluir idempotente (o mesmo resultado 2x não muda nada) e saneado (id/retry_s lixo ignorados, clamp 24 h);
-- (3) push_remover_inscricao: só ESTA credencial, idempotente, não derruba inscrição re-registrada depois da tentativa, outros aparelhos
--     da pessoa e inscrição de outro usuário intactos; (4) registrada_em: servidor decide, upsert idêntico não renova, chaves/usuário novos renovam;
-- (5) inscrição RECRIADA / endpoint reutilizado por OUTRO usuário: falha antiga nunca condena a nova;
-- (6) multiclube: p_club_id restringe lista/poda/resumo e nada de um clube derruba aparelho de outro;
-- (7) a poda não roda sozinha (nenhum cron) e as funções novas são só do service_role, SECURITY DEFINER com search_path vazio.
begin;
\ir _lib.sql
\ir _fixtures.sql

\o /dev/null
insert into public.push_eventos (id, chave_evento, club_id, destinatarios) values
  (md5('ev140a')::uuid, 'teste:140a', t.id('clube_a'), 2),
  (md5('ev140b')::uuid, 'teste:140b', t.id('clube_b'), 1);
insert into public.push_evento_destinatarios (id, evento_id, user_id) values
  (914001, md5('ev140a')::uuid, t.id('membro_a')),
  (914002, md5('ev140a')::uuid, t.id('membro_a2')),
  (914003, md5('ev140b')::uuid, t.id('membro_b'));

delete from public.push_subscriptions where endpoint like 'https://push.teste/%';   -- inscrições dos fixtures: fora do cenário
insert into public.push_subscriptions (user_id, endpoint, p256dh, auth) values
  (t.id('membro_a'),  'https://fcm.googleapis.com/wp/d1-temp',   'k', 'a'),
  (t.id('membro_a'),  'https://fcm.googleapis.com/wp/d2-perm',   'k', 'a'),
  (t.id('membro_a'),  'https://fcm.googleapis.com/wp/d3-limpo',  'k', 'a'),
  (t.id('membro_a2'), 'https://fcm.googleapis.com/wp/d4-outro',  'k', 'a'),
  (t.id('membro_b'),  'https://fcm.googleapis.com/wp/b1-morto',  'k', 'a');
set session_replication_role = replica;
update public.push_subscriptions set registrada_em = now() - interval '30 days' where endpoint like '%/wp/%';
reset session_replication_role;
\o

-- ---------------------------------------------------------------- 1) reservar: tetos, Retry-After, idempotência
select t.como_service();
select t.eq('1ª reserva do evento A: 4 aparelhos (3 do membro A + 1 do A2); o de outro clube nunca entra',
  t.n($q$select count(*) from public.push_reservar(md5('ev140a')::uuid)$q$), 4);
select t.eq('2ª reserva simultânea/seguinte do MESMO evento: nada (idempotência/concorrência: tudo já está enviando)',
  t.n($q$select count(*) from public.push_reservar(md5('ev140a')::uuid)$q$), 0);
reset role;

-- fecha o ciclo: d1 = 503 (temporário), d2 = 403 (definitivo), d3 = entregue, d4 = 429 com Retry-After de 1 h
\o /dev/null
create table t.tent as
  select id, dispositivo_id from public.push_tentativas
   where destinatario_id in (914001, 914002) order by id;
grant select on t.tent to public;
\o
select t.como_service();
select t.eq('push_concluir fecha as 4 tentativas',
  public.push_concluir((select jsonb_agg(jsonb_build_object('id', x.id, 'ok', x.ok, 'codigo', x.codigo, 'ms', 5, 'retry_s', x.retry_s))
    from (select p.id,
                 (p.dispositivo_id = md5('https://fcm.googleapis.com/wp/d3-limpo')::uuid) as ok,
                 case p.dispositivo_id when md5('https://fcm.googleapis.com/wp/d1-temp')::uuid then '503'
                      when md5('https://fcm.googleapis.com/wp/d2-perm')::uuid then '403'
                      when md5('https://fcm.googleapis.com/wp/d3-limpo')::uuid then '200'
                      else '429' end as codigo,
                 case p.dispositivo_id when md5('https://fcm.googleapis.com/wp/d4-outro')::uuid then 3600 else null end as retry_s
            from t.tent p) x))::bigint, 4::bigint);
select t.eq('IDEMPOTÊNCIA: processar o MESMO resultado de novo não altera nada (0 linhas)',
  public.push_concluir((select jsonb_agg(jsonb_build_object('id', id, 'ok', false, 'codigo', '500', 'ms', 9)) from t.tent))::bigint, 0::bigint);
reset role;
select t.eq('...e o estado final continua o da 1ª resposta (entregue não vira falha)',
  t.n($q$select count(*) from public.push_tentativas where estado = 'entregue' and dispositivo_id = md5('https://fcm.googleapis.com/wp/d3-limpo')::uuid$q$), 1);
select t.ok('Retry-After de 3600 s virou retry_apos ~1 h à frente (e só nas falhas)',
  t.n($q$select count(*) from public.push_tentativas where retry_apos between now() + interval '59 minutes' and now() + interval '61 minutes'$q$) = 1
  and t.n($q$select count(*) from public.push_tentativas where retry_apos is not null and estado = 'entregue'$q$) = 0);

select t.como_service();
select t.eq('re-despacho do evento: só o TEMPORÁRIO sem espera volta (d1). d2 (definitivo 403), d3 (entregue) e d4 (aguardando Retry-After) não',
  t.n($q$select count(*) from public.push_reservar(md5('ev140a')::uuid)$q$), 1);
reset role;
select t.eq('...e foi justamente o d1 (503)',
  t.n($q$select count(*) from public.push_tentativas where dispositivo_id = md5('https://fcm.googleapis.com/wp/d1-temp')::uuid and estado = 'enviando'$q$), 1);

-- d1 falha 2x mais (503, 504) => 3 falhas: o teto por evento e aparelho (3) fecha
\o /dev/null
update public.push_tentativas set estado = 'falhou', codigo = '503'
 where dispositivo_id = md5('https://fcm.googleapis.com/wp/d1-temp')::uuid and estado = 'enviando';
\o
select t.como_service();
select t.eq('2ª falha temporária ainda permite a 3ª tentativa', t.n($q$select count(*) from public.push_reservar(md5('ev140a')::uuid)$q$), 1);
reset role;
\o /dev/null
update public.push_tentativas set estado = 'falhou', codigo = '504'
 where dispositivo_id = md5('https://fcm.googleapis.com/wp/d1-temp')::uuid and estado = 'enviando';
\o
select t.como_service();
select t.eq('SEM RETRY INFINITO: depois de 3 falhas o aparelho não é mais reservado neste evento',
  t.n($q$select count(*) from public.push_reservar(md5('ev140a')::uuid)$q$), 0);
reset role;

-- Retry-After vencido libera de novo (d4)
\o /dev/null
update public.push_tentativas set retry_apos = now() - interval '1 minute'
 where dispositivo_id = md5('https://fcm.googleapis.com/wp/d4-outro')::uuid;
\o
select t.como_service();
select t.eq('Retry-After vencido: o aparelho volta a ser reservado (e só ele)',
  t.n($q$select count(*) from public.push_reservar(md5('ev140a')::uuid)$q$), 1);
reset role;

-- sanidade do push_concluir
\o /dev/null
insert into public.push_tentativas (id, destinatario_id, dispositivo_id, canal, estado) values
  (914101, 914001, md5('c1')::uuid, 'web', 'enviando'), (914102, 914001, md5('c2')::uuid, 'web', 'enviando'),
  (914103, 914001, md5('c3')::uuid, 'web', 'enviando');
\o
select t.como_service();
select t.eq('id lixo/retry_s lixo são ignorados sem erro; retry_s gigante é limitado a 24 h; retry_s negativo vira sem espera',
  public.push_concluir('[{"id":"abc","ok":false,"codigo":"500"},{"id":914101,"ok":false,"codigo":"429","retry_s":999999999},{"id":914102,"ok":false,"codigo":"429","retry_s":"-5"},{"id":914103,"ok":false,"codigo":"408","retry_s":"x"}]'::jsonb)::bigint, 3::bigint);
reset role;
select t.ok('retry_s 999999999 -> 24 h exatas (teto)',
  t.n($q$select count(*) from public.push_tentativas where id = 914101 and retry_apos between now() + interval '23 hours 59 minutes' and now() + interval '24 hours 1 minute'$q$) = 1);
select t.eq('retry_s negativo/ilegível não cria espera', t.n($q$select count(*) from public.push_tentativas where id in (914102, 914103) and retry_apos is not null$q$), 0);
select t.eq('408 é um código aceito do vocabulário', t.txt($q$select codigo from public.push_tentativas where id = 914103$q$), '408');

-- ---------------------------------------------------------------- 2) remover (a ação imediata da Edge Function)
\o /dev/null
insert into public.push_tentativas (id, destinatario_id, dispositivo_id, canal, estado) values
  (914201, 914001, md5('https://fcm.googleapis.com/wp/d2-perm')::uuid, 'web', 'enviando');
\o
select t.como_service();
select t.eq('credencial que NÃO é a do aparelho da tentativa não é removida',
  public.push_remover_inscricao(914201, 'https://fcm.googleapis.com/wp/d3-limpo')::bigint, 0::bigint);
select t.eq('remove EXATAMENTE a inscrição da tentativa (d2)',
  public.push_remover_inscricao(914201, 'https://fcm.googleapis.com/wp/d2-perm')::bigint, 1::bigint);
select t.eq('IDEMPOTÊNCIA: a 2ª chamada com a mesma tentativa devolve 0 (já concluída ou inexistente)',
  public.push_remover_inscricao(914201, 'https://fcm.googleapis.com/wp/d2-perm')::bigint, 0::bigint);
reset role;
select t.eq('MÚLTIPLOS DISPOSITIVOS: os outros 2 aparelhos do membro A seguem lá (d1, d3)',
  t.n($q$select count(*) from public.push_subscriptions where user_id = t.id('membro_a') and endpoint like '%/wp/d%'$q$), 2);
select t.eq('...e o aparelho de outro usuário (membro A2) também',
  t.n($q$select count(*) from public.push_subscriptions where endpoint = 'https://fcm.googleapis.com/wp/d4-outro'$q$), 1);

-- RESPOSTA ATRASADA x inscrição nova: a tentativa começa, a pessoa se re-inscreve (chaves novas, mesmo endpoint), a resposta velha (410) chega
\o /dev/null
insert into public.push_tentativas (id, destinatario_id, dispositivo_id, canal, estado, quando) values
  (914202, 914002, md5('https://fcm.googleapis.com/wp/d3-limpo')::uuid, 'web', 'enviando', now() - interval '1 minute');
update public.push_subscriptions set p256dh = 'chave-nova', auth = 'auth-nova' where endpoint = 'https://fcm.googleapis.com/wp/d3-limpo';
\o
select t.como_service();
select t.eq('RECRIADA depois da tentativa: a resposta antiga (410) NÃO apaga a inscrição nova',
  public.push_remover_inscricao(914202, 'https://fcm.googleapis.com/wp/d3-limpo')::bigint, 0::bigint);
reset role;
select t.eq('...a inscrição nova continua', t.n($q$select count(*) from public.push_subscriptions where endpoint = 'https://fcm.googleapis.com/wp/d3-limpo'$q$), 1);

-- token FCM
\o /dev/null
insert into public.push_tokens (token, user_id, plataforma) values ('tok140', t.id('membro_a'), 'android');
set session_replication_role = replica;
update public.push_tokens set registrada_em = now() - interval '5 days' where token = 'tok140';
reset session_replication_role;
insert into public.push_tentativas (id, destinatario_id, dispositivo_id, canal, estado) values
  (914203, 914001, md5('tok140')::uuid, 'fcm', 'enviando');
\o
select t.como_service();
select t.eq('token FCM: remove só ele', public.push_remover_inscricao(914203, 'tok140')::bigint, 1::bigint);
reset role;
select t.eq('...e foi removido', t.n($q$select count(*) from public.push_tokens where token = 'tok140'$q$), 0);

-- ---------------------------------------------------------------- 3) registrada_em (o relógio da inscrição vigente)
select t.como('membro_a');
insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, registrada_em)
values (t.id('membro_a'), 'https://fcm.googleapis.com/wp/reg1', 'k1', 'a1', now() - interval '400 days');
reset role;
select t.ok('o servidor decide registrada_em: o cliente não consegue "envelhecer" a própria inscrição na criação',
  t.n($q$select count(*) from public.push_subscriptions where endpoint = 'https://fcm.googleapis.com/wp/reg1' and registrada_em > now() - interval '1 minute'$q$) = 1);
\o /dev/null
set session_replication_role = replica;
update public.push_subscriptions set registrada_em = now() - interval '10 days' where endpoint = 'https://fcm.googleapis.com/wp/reg1';
reset session_replication_role;
create table t.reg as select registrada_em r from public.push_subscriptions where endpoint = 'https://fcm.googleapis.com/wp/reg1';
\o
select t.como('membro_a');
\o /dev/null
update public.push_subscriptions set p256dh = 'k1', auth = 'a1' where endpoint = 'https://fcm.googleapis.com/wp/reg1';
\o
reset role;
select t.ok('upsert/UPDATE idêntico NÃO renova registrada_em (uma inscrição quebrada continua envelhecendo)',
  t.n($q$select count(*) from public.push_subscriptions where endpoint = 'https://fcm.googleapis.com/wp/reg1' and registrada_em = (select r from t.reg)$q$) = 1);
\o /dev/null
update public.push_subscriptions set dispositivo_id = md5('aparelho140')::uuid where endpoint = 'https://fcm.googleapis.com/wp/reg1';
\o
select t.ok('carimbar o aparelho (dispositivo_id) também não renova',
  t.n($q$select count(*) from public.push_subscriptions where endpoint = 'https://fcm.googleapis.com/wp/reg1' and registrada_em = (select r from t.reg)$q$) = 1);
select t.como('membro_a');
\o /dev/null
update public.push_subscriptions set p256dh = 'k2', auth = 'a2', registrada_em = now() - interval '400 days' where endpoint = 'https://fcm.googleapis.com/wp/reg1';
\o
reset role;
select t.ok('chaves novas RENOVAM (e o cliente não força a data)',
  t.n($q$select count(*) from public.push_subscriptions where endpoint = 'https://fcm.googleapis.com/wp/reg1' and registrada_em > (select r from t.reg) and registrada_em > now() - interval '1 minute'$q$) = 1);

-- ---------------------------------------------------------------- 4) inscrição recriada / endpoint reutilizado por OUTRO usuário
-- "morto-r": falhas antigas (3 dias distintos de 403) que EXISTIAM quando a inscrição era do membro A; depois o endpoint foi reutilizado.
\o /dev/null
insert into public.push_subscriptions (user_id, endpoint, p256dh, auth) values
  (t.id('membro_a'), 'https://fcm.googleapis.com/wp/recriada', 'k', 'a'),
  (t.id('membro_a'), 'https://fcm.googleapis.com/wp/reusada',  'k', 'a'),
  (t.id('membro_a'), 'https://fcm.googleapis.com/wp/morta-de-verdade', 'k', 'a');
set session_replication_role = replica;
update public.push_subscriptions set registrada_em = now() - interval '30 days' where endpoint like '%/recriada' or endpoint like '%/reusada' or endpoint like '%/morta-de-verdade';
reset session_replication_role;
insert into public.push_tentativas (destinatario_id, dispositivo_id, canal, estado, codigo, quando)
select 914001, md5(e)::uuid, 'web', 'falhou', '403', now() - make_interval(days => d)
  from unnest(array['https://fcm.googleapis.com/wp/recriada', 'https://fcm.googleapis.com/wp/reusada', 'https://fcm.googleapis.com/wp/morta-de-verdade']) e,
       generate_series(2, 4) d;
-- um aparelho saudável no mesmo host, entregando agora (prova de saúde do provedor)
insert into public.push_tentativas (destinatario_id, dispositivo_id, canal, estado, codigo, quando)
values (914001, md5('https://fcm.googleapis.com/wp/d1-temp')::uuid, 'web', 'entregue', '201', now());
\o
select t.como_service();
select t.eq('antes da recriação: as 3 (recriada, reusada, morta-de-verdade) são candidatas',
  t.n($q$select count(*) from public.push_inscricoes_mortas() where ref in
    (left(md5('https://fcm.googleapis.com/wp/recriada'), 8), left(md5('https://fcm.googleapis.com/wp/reusada'), 8), left(md5('https://fcm.googleapis.com/wp/morta-de-verdade'), 8))$q$), 3);
reset role;
-- a pessoa se re-inscreve (mesmo endpoint, chaves novas) e o outro endpoint passa a ser de OUTRO usuário
\o /dev/null
update public.push_subscriptions set p256dh = 'chave-nova', auth = 'auth-nova' where endpoint = 'https://fcm.googleapis.com/wp/recriada';
update public.push_subscriptions set user_id = t.id('membro_a2') where endpoint = 'https://fcm.googleapis.com/wp/reusada';
\o
select t.como_service();
select t.eq('SUBSCRIPTION RECRIADA / ENDPOINT REUTILIZADO por outro usuário: a falha antiga NÃO condena a nova; só a morta de verdade segue candidata',
  t.n($q$select count(*) from public.push_inscricoes_mortas() where ref in
    (left(md5('https://fcm.googleapis.com/wp/recriada'), 8), left(md5('https://fcm.googleapis.com/wp/reusada'), 8), left(md5('https://fcm.googleapis.com/wp/morta-de-verdade'), 8))$q$), 1);
select t.eq('...a poda remove só a morta de verdade',
  t.n($q$select removidas from public.push_podar_inscricoes_mortas(true) where canal = 'web'$q$), 1);
reset role;
select t.eq('...e a recriada e a reutilizada continuam',
  t.n($q$select count(*) from public.push_subscriptions where endpoint in ('https://fcm.googleapis.com/wp/recriada', 'https://fcm.googleapis.com/wp/reusada')$q$), 2);

-- falha de OUTRO usuário no mesmo aparelho-id (destinatário de outra pessoa) também não conta para a inscrição atual
\o /dev/null
set session_replication_role = replica;
update public.push_subscriptions set registrada_em = now() - interval '60 hours' where endpoint like '%/reusada';   -- A2 a registrou há 2,5 dias
reset session_replication_role;
insert into public.push_tentativas (destinatario_id, dispositivo_id, canal, estado, codigo, quando)
select 914002, md5('https://fcm.googleapis.com/wp/reusada')::uuid, 'web', 'falhou', '403', now() - make_interval(days => d) from generate_series(0, 2) d;
\o
select t.como_service();
select t.eq('falhas do NOVO dono (A2), posteriores ao registro dele, contam (3); as 3 do dono anterior (A) não somam',
  t.n($q$select count(*) from public.push_inscricoes_mortas() where ref = left(md5('https://fcm.googleapis.com/wp/reusada'), 8) and falhas = 3$q$), 1);
reset role;

-- ---------------------------------------------------------------- 5) multiclube
-- b1 (membro_b, clube B) falha 3 dias com 403 em eventos do clube B; host saudável existe (d1 entregou agora)
\o /dev/null
set session_replication_role = replica;
update public.push_subscriptions set registrada_em = now() - interval '30 days' where endpoint like '%/b1-morto';
reset session_replication_role;
insert into public.push_tentativas (destinatario_id, dispositivo_id, canal, estado, codigo, quando, club_id)
select 914003, md5('https://fcm.googleapis.com/wp/b1-morto')::uuid, 'web', 'falhou', '403', now() - make_interval(days => d), t.id('clube_b') from generate_series(0, 2) d;
-- e as falhas do aparelho de A2 (reusada) foram em eventos do clube A
update public.push_tentativas set club_id = t.id('clube_a') where destinatario_id = 914002 and dispositivo_id = md5('https://fcm.googleapis.com/wp/reusada')::uuid;
\o
select t.como_service();
select t.eq('sem filtro a lista vê as 2 (clube A e clube B)', t.n($q$select count(*) from public.push_inscricoes_mortas()$q$), 2);
select t.eq('p_club_id = A lista só a do clube A', t.n($q$select count(*) from public.push_inscricoes_mortas(3, 2, t.id('clube_a'))$q$), 1);
select t.eq('p_club_id = B lista só a do clube B', t.n($q$select count(*) from public.push_inscricoes_mortas(3, 2, t.id('clube_b'))$q$), 1);
select t.eq('o resumo de erros respeita o clube (B: só 403)', t.n($q$select count(*) from public.push_resumo_erros(72, t.id('clube_b')) where codigo <> '403'$q$), 0);
select t.ok('o resumo de erros não carrega credencial nem usuário',
  pg_get_function_result('public.push_resumo_erros(integer,uuid)'::regprocedure) !~* 'endpoint|token|user|credencial|club');
select t.ok('a lista não devolve club_id (nada que identifique o clube)',
  pg_get_function_result('public.push_inscricoes_mortas(integer,integer,uuid)'::regprocedure) !~* 'club|user');
select t.eq('ENSAIO por clube: A tem 1 candidata, remove 0',
  t.n($q$select sum(candidatas) * 10 + sum(removidas) from public.push_podar_inscricoes_mortas(false, 3, 2, t.id('clube_a'))$q$), 10);
select t.eq('poda do clube A remove 1 (a do A) e NÃO toca a do clube B',
  t.n($q$select sum(removidas) from public.push_podar_inscricoes_mortas(true, 3, 2, t.id('clube_a'))$q$), 1);
reset role;
select t.eq('...a inscrição morta do clube B segue lá', t.n($q$select count(*) from public.push_subscriptions where endpoint like '%/b1-morto'$q$), 1);

-- ---------------------------------------------------------------- 6) a poda não roda sozinha; permissões e hardening
select t.eq('NENHUM agendamento (pg_cron) chama poda/lista de inscrições',
  t.n($q$select count(*) from cron.job where command ilike '%push_podar%' or command ilike '%push_inscricoes_mortas%' or command ilike '%push_remover%'$q$), 0);
select t.eq('os padrões são seguros: p_aplicar false',
  t.n($q$select count(*) from pg_proc p where p.proname = 'push_podar_inscricoes_mortas' and pg_get_function_arguments(p.oid) like 'p_aplicar boolean DEFAULT false%'$q$), 1);
select t.eq('as 6 funções novas/alteradas são SECURITY DEFINER com search_path vazio',
  t.n($q$select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.prosecdef
            and p.proname in ('push_reservar','push_concluir','push_remover_inscricao','_push_mortas','push_inscricoes_mortas','push_podar_inscricoes_mortas','push_resumo_erros')
            and p.proconfig @> array['search_path=""']$q$), 7);
select t.eq('só o service_role executa as 6 públicas (anon/authenticated/public: nenhuma)',
  t.n($q$select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public'
            and p.proname in ('push_reservar','push_concluir','push_remover_inscricao','push_inscricoes_mortas','push_podar_inscricoes_mortas','push_resumo_erros')
            and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute')
                 or has_function_privilege('public', p.oid, 'execute') or not has_function_privilege('service_role', p.oid, 'execute'))$q$), 0);

select t.como_anon();
select t.bloqueado('anon não remove inscrição', $q$select public.push_remover_inscricao(1, 'x')$q$);
select t.bloqueado('anon não vê o resumo', $q$select * from public.push_resumo_erros()$q$);
reset role;
select t.como('membro_a');
select t.bloqueado('usuário comum não remove inscrição de ninguém', $q$select public.push_remover_inscricao(914201, 'https://fcm.googleapis.com/wp/d1-temp')$q$);
select t.bloqueado('usuário comum não vê o resumo', $q$select * from public.push_resumo_erros()$q$);
select t.bloqueado('usuário comum não reserva push', $q$select * from public.push_reservar(md5('ev140a')::uuid)$q$);
select t.bloqueado('usuário comum não conclui push', $q$select public.push_concluir('[]'::jsonb)$q$);
reset role;

select t.fim();
rollback;
