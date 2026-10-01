-- PUSH: erro permanente além do 404/410 e poda segura de inscrição morta (migration 534).
-- Prova: (1) o status real (400/401/403/413/502/504) passa a ser gravado, e o que está fora da lista continua 'desconhecido';
-- (2) a lista de candidatas só pega aparelho que NUNCA entregou, com >= 3 falhas permanentes em >= 2 dias, E só quando o provedor
-- funciona para outros aparelhos (entrega nos últimos 7 dias no mesmo host) — jamais por falha temporária (rede/timeout/5xx);
-- (3) quem já entregou alguma vez, quem falhou pouco, quem está num host sem prova de saúde e aparelho de OUTRO usuário nunca entram;
-- (4) o padrão da poda é ENSAIO (não apaga nada); com p_aplicar apaga SÓ as candidatas e preserva as demais inscrições da MESMA pessoa;
-- (5) a lista é anonimizada (hash curto, sem endpoint) e nenhuma das funções é executável por anon/authenticated.
begin;
\ir _lib.sql
\ir _fixtures.sql

\o /dev/null
-- evento + destinatários (as tentativas exigem esse encadeamento)
insert into public.push_eventos (id, chave_evento, club_id, destinatarios)
values (md5('ev139')::uuid, 'teste:139', t.id('clube_a'), 2);
insert into public.push_evento_destinatarios (id, evento_id, user_id)
values (913901, md5('ev139')::uuid, t.id('membro_a')), (913902, md5('ev139')::uuid, t.id('membro_a2'));

-- aparelhos do membro A: um MORTO (desconhecido x3 em 3 dias), um SAUDÁVEL (entrega recente), um que já entregou e depois falhou,
-- um com falhas só TEMPORÁRIAS, um com 1 falha só. Membro A2: um morto (para provar que a poda não olha só o dono).
insert into public.push_subscriptions (user_id, endpoint, p256dh, auth) values
  (t.id('membro_a'),  'https://fcm.googleapis.com/wp/morto-a',  'k', 'a'),
  (t.id('membro_a'),  'https://fcm.googleapis.com/wp/saudavel', 'k', 'a'),
  (t.id('membro_a'),  'https://fcm.googleapis.com/wp/ja-entregou', 'k', 'a'),
  (t.id('membro_a'),  'https://fcm.googleapis.com/wp/temporario', 'k', 'a'),
  (t.id('membro_a'),  'https://fcm.googleapis.com/wp/pouca-falha', 'k', 'a'),
  (t.id('membro_a'),  'https://web.push.apple.com/wp/morto-sem-par', 'k', 'a'),
  (t.id('membro_a2'), 'https://fcm.googleapis.com/wp/morto-a2', 'k', 'a');
-- identidade alternativa: dispositivo_id carimbado pelo cliente (o histórico foi gravado com ele)
update public.push_subscriptions set dispositivo_id = md5('aparelho139:a2')::uuid where endpoint = 'https://fcm.googleapis.com/wp/morto-a2';

create function t.falha(p_endpoint text, p_codigo text, p_dias_atras int, p_dest bigint default 913901, p_disp uuid default null) returns void
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.push_tentativas (destinatario_id, dispositivo_id, canal, estado, codigo, quando)
  values (p_dest, coalesce(p_disp, md5(p_endpoint)::uuid), 'web', 'falhou', p_codigo, now() - make_interval(days => p_dias_atras));
end $$;
create function t.entrega(p_endpoint text, p_dias_atras int) returns void
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.push_tentativas (destinatario_id, dispositivo_id, canal, estado, codigo, quando)
  values (913901, md5(p_endpoint)::uuid, 'web', 'entregue', '201', now() - make_interval(days => p_dias_atras));
end $$;

select t.falha('https://fcm.googleapis.com/wp/morto-a', 'desconhecido', 3);
select t.falha('https://fcm.googleapis.com/wp/morto-a', '403', 2);
select t.falha('https://fcm.googleapis.com/wp/morto-a', '401', 0);

select t.entrega('https://fcm.googleapis.com/wp/saudavel', 1);

select t.entrega('https://fcm.googleapis.com/wp/ja-entregou', 20);
select t.falha('https://fcm.googleapis.com/wp/ja-entregou', '403', 3);
select t.falha('https://fcm.googleapis.com/wp/ja-entregou', '403', 2);
select t.falha('https://fcm.googleapis.com/wp/ja-entregou', '403', 1);

select t.falha('https://fcm.googleapis.com/wp/temporario', 'rede', 3);
select t.falha('https://fcm.googleapis.com/wp/temporario', 'timeout', 2);
select t.falha('https://fcm.googleapis.com/wp/temporario', '503', 1);
select t.falha('https://fcm.googleapis.com/wp/temporario', '504', 0);

select t.falha('https://fcm.googleapis.com/wp/pouca-falha', '403', 0);

select t.falha('https://web.push.apple.com/wp/morto-sem-par', '403', 3);
select t.falha('https://web.push.apple.com/wp/morto-sem-par', '403', 2);
select t.falha('https://web.push.apple.com/wp/morto-sem-par', '403', 1);

-- o morto do membro A2 foi gravado com o dispositivo_id carimbado (não o md5 do endpoint)
select t.falha('x', 'desconhecido', 3, 913902, md5('aparelho139:a2')::uuid);
select t.falha('x', '400', 2, 913902, md5('aparelho139:a2')::uuid);
select t.falha('x', '413', 1, 913902, md5('aparelho139:a2')::uuid);
\o

-- ---------------------------------------------------------------- 1) vocabulário
select t.ok('o vocabulário aceita os status novos (400/401/403/413/502/504)',
  t.n($q$select count(*) from public.push_tentativas where codigo in ('401', '403', '413', '504')$q$) > 0);
select t.throws('um status fora do vocabulário continua barrado pela constraint',
  $q$insert into public.push_tentativas (destinatario_id, dispositivo_id, canal, estado, codigo) values (913901, md5('z')::uuid, 'web', 'falhou', '418')$q$);

\o /dev/null
insert into public.push_tentativas (id, destinatario_id, dispositivo_id, canal, estado)
values (913911, 913901, md5('conc1')::uuid, 'web', 'enviando'), (913912, 913901, md5('conc2')::uuid, 'web', 'enviando'),
       (913913, 913901, md5('conc3')::uuid, 'web', 'enviando');
\o
select t.como_service();
select t.eq('push_concluir grava 403 como 403, 502 como 502 e um código estranho como desconhecido',
  public.push_concluir('[{"id":913911,"ok":false,"codigo":"403","ms":10},{"id":913912,"ok":false,"codigo":"502","ms":10},{"id":913913,"ok":false,"codigo":"418","ms":10}]'::jsonb)::bigint, 3::bigint);
reset role;
select t.eq('403 gravado', t.txt($q$select codigo from public.push_tentativas where id = 913911$q$), '403');
select t.eq('502 gravado', t.txt($q$select codigo from public.push_tentativas where id = 913912$q$), '502');
select t.eq('código fora da lista vira desconhecido (vocabulário fechado: nada de texto do provedor)',
  t.txt($q$select codigo from public.push_tentativas where id = 913913$q$), 'desconhecido');
\o /dev/null
delete from public.push_tentativas where id in (913911, 913912, 913913);
\o

-- ---------------------------------------------------------------- 2) candidatas
select t.como_service();
select t.eq('a lista tem EXATAMENTE as 2 mortas provadas (a do membro A e a do A2, pela identidade alternativa)',
  t.n($q$select count(*) from public.push_inscricoes_mortas()$q$), 2);
select t.eq('...e todas do canal web no host que comprovadamente funciona',
  t.n($q$select count(*) from public.push_inscricoes_mortas() where canal = 'web' and host = 'fcm.googleapis.com'$q$), 2);
select t.ok('a morta com 3 falhas em 3 dias aparece com contagem e período',
  t.n($q$select count(*) from public.push_inscricoes_mortas() where ref = left(md5('https://fcm.googleapis.com/wp/morto-a'), 8) and falhas = 3 and dias = 3$q$) = 1);
select t.eq('quem JÁ ENTREGOU alguma vez não entra (mesmo com 3 falhas seguidas depois)',
  t.n($q$select count(*) from public.push_inscricoes_mortas() where ref = left(md5('https://fcm.googleapis.com/wp/ja-entregou'), 8)$q$), 0);
select t.eq('falha só TEMPORÁRIA (rede/timeout/503/504) nunca conta como morte',
  t.n($q$select count(*) from public.push_inscricoes_mortas() where ref = left(md5('https://fcm.googleapis.com/wp/temporario'), 8)$q$), 0);
select t.eq('1 falha só não é morte',
  t.n($q$select count(*) from public.push_inscricoes_mortas() where ref = left(md5('https://fcm.googleapis.com/wp/pouca-falha'), 8)$q$), 0);
select t.eq('host sem NENHUMA prova de saúde (nenhum outro aparelho entrega ali) não vira poda: pode ser problema nosso',
  t.n($q$select count(*) from public.push_inscricoes_mortas() where host = 'web.push.apple.com'$q$), 0);
select t.eq('os limites são ajustáveis, mas nunca abaixo de 2 falhas/2 dias (min_falhas=1 vale como 2)',
  t.n($q$select count(*) from public.push_inscricoes_mortas(1, 1) where ref = left(md5('https://fcm.googleapis.com/wp/pouca-falha'), 8)$q$), 0);
select t.ok('a lista é anonimizada: ref de 8 caracteres e nenhuma coluna com endpoint/token/credencial',
  t.n($q$select count(*) from public.push_inscricoes_mortas() where length(ref) = 8$q$) = 2
  and pg_get_function_result('public.push_inscricoes_mortas(integer,integer)'::regprocedure) !~* 'endpoint|token|credencial');
reset role;

-- ---------------------------------------------------------------- 3) poda
select t.como_service();
select t.eq('o padrão é ENSAIO: conta 2 candidatas e remove 0',
  t.n($q$select sum(candidatas) * 100 + sum(removidas) from public.push_podar_inscricoes_mortas()$q$), 200);
reset role;
select t.eq('...e depois do ensaio todas as 7 inscrições continuam lá',
  t.n($q$select count(*) from public.push_subscriptions where endpoint like '%/wp/%'$q$), 7);

select t.como_service();
select t.eq('com p_aplicar remove exatamente as 2 candidatas',
  t.n($q$select sum(removidas) from public.push_podar_inscricoes_mortas(true)$q$), 2);
reset role;
select t.eq('as 5 demais inscrições ficaram (saudável, já-entregou, temporário, pouca-falha, apple)',
  t.n($q$select count(*) from public.push_subscriptions where endpoint like '%/wp/%'$q$), 5);
select t.eq('a MORTA saiu e as outras inscrições da MESMA pessoa (membro A) foram preservadas',
  t.n($q$select count(*) from public.push_subscriptions where user_id = t.id('membro_a') and endpoint like '%/wp/%'$q$), 5);
select t.eq('a morta do membro A2 também saiu',
  t.n($q$select count(*) from public.push_subscriptions where endpoint = 'https://fcm.googleapis.com/wp/morto-a2'$q$), 0);
select t.como_service();
select t.eq('idempotente: rodar de novo não acha mais nada',
  t.n($q$select coalesce(sum(candidatas), 0) + coalesce(sum(removidas), 0) from public.push_podar_inscricoes_mortas(true)$q$), 0);
reset role;
select t.ok('o histórico de tentativas é preservado (a poda não apaga auditoria)',
  t.n($q$select count(*) from public.push_tentativas where destinatario_id in (913901, 913902) and estado = 'falhou'$q$) >= 15);

-- ---------------------------------------------------------------- 4) token FCM (APK)
\o /dev/null
insert into public.push_tokens (token, user_id, plataforma) values
  ('tok139-morto', t.id('membro_a'), 'android'), ('tok139-vivo', t.id('membro_a2'), 'android');
insert into public.push_tentativas (destinatario_id, dispositivo_id, canal, estado, codigo, quando) values
  (913901, md5('tok139-morto')::uuid, 'fcm', 'falhou', '404', now() - interval '3 days'),
  (913901, md5('tok139-morto')::uuid, 'fcm', 'falhou', 'desconhecido', now() - interval '2 days'),
  (913901, md5('tok139-morto')::uuid, 'fcm', 'falhou', '403', now() - interval '1 day'),
  (913901, md5('tok139-vivo')::uuid, 'fcm', 'entregue', '200', now() - interval '1 day');
\o
select t.como_service();
select t.eq('token FCM morto (nunca entregou, 3 falhas permanentes, canal saudável) é candidato',
  t.n($q$select count(*) from public.push_inscricoes_mortas() where canal = 'fcm'$q$), 1);
select t.eq('...e a poda remove só ele',
  t.n($q$select removidas from public.push_podar_inscricoes_mortas(true) where canal = 'fcm'$q$), 1);
reset role;
select t.eq('o token vivo do mesmo usuário fica', t.n($q$select count(*) from public.push_tokens where token like 'tok139-%'$q$), 1);

-- ---------------------------------------------------------------- 5) permissões
select t.como_anon();
select t.bloqueado('anon não executa a lista', $q$select * from public.push_inscricoes_mortas()$q$);
select t.bloqueado('anon não executa a poda', $q$select * from public.push_podar_inscricoes_mortas(true)$q$);
reset role;
select t.como('membro_a');
select t.bloqueado('usuário comum não executa a lista', $q$select * from public.push_inscricoes_mortas()$q$);
select t.bloqueado('usuário comum não executa a poda', $q$select * from public.push_podar_inscricoes_mortas(true)$q$);
select t.bloqueado('ninguém executa a função interna que devolve a credencial crua', $q$select * from public._push_mortas(3, 2)$q$);
reset role;
select t.como_service();
select t.bloqueado('nem o service_role executa a interna (só as duas públicas)', $q$select * from public._push_mortas(3, 2)$q$);
reset role;

select t.fim();
rollback;
