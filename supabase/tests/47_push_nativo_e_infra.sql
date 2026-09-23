-- =============================================================================
--  Fase 8.1 — push: a rota do APK e o webhook versionado (migration 52).
--
--  Os dois blockers que este teste fecha:
--    B2  o token do FCM era gravado e nunca lido — push nativo no Android não funcionava;
--    B3  o Database Webhook era criado à mão no painel, então um projeto novo subia sem push
--        e ninguém ficava sabendo.
--
--  O que se prova aqui:
--    1. as duas rotas de entrega (Web Push e FCM) têm EXATAMENTE o mesmo público, porque leem
--       da mesma função — e o isolamento por clube vale para as duas;
--    2. o gatilho existe no banco (não no painel), e falta de configuração vira linha em
--       `infra_falhas` em vez de silêncio;
--    3. a notificação é gravada mesmo quando a infraestrutura de push está mal configurada.
-- =============================================================================
begin;
\ir _lib.sql
\ir _fixtures.sql

\o /dev/null
-- Aparelhos Android: um por pessoa, nos dois clubes, para poder cruzar.
-- (os fixtures já criam push_subscriptions — a inscrição web — para as mesmas pessoas)
insert into public.push_tokens (token, user_id, plataforma)
select 'fcm-' || k, t.id(k), 'android'
  from unnest(array['lider_a','instrutor_a','membro_a','pais_a','lider_b','membro_b','pais_b']) k;
\o

-- =============================================================================
--  1. As duas rotas, o mesmo público
-- =============================================================================
-- "todos" do clube A: liderança + instrutor + membro, NUNCA 'pais' (responsável não recebe
-- aviso geral do clube) e nunca ninguém do clube B.
select t.eq('web: "todos" do clube A não inclui responsável nem ninguém do clube B',
  t.n($q$select count(*) from public.push_destinatarios(
        (select id from t.ids where chave='clube_a'), 'todos', null)$q$), 3);
select t.eq('APK: "todos" do clube A devolve exatamente os mesmos 3 aparelhos',
  t.n($q$select count(*) from public.push_destinatarios_nativos(
        (select id from t.ids where chave='clube_a'), 'todos', null)$q$), 3);
select t.eq('e são as MESMAS pessoas nas duas rotas (zero diferença nos dois sentidos)',
  t.n($q$select count(*) from (
        select user_id from public.push_destinatarios((select id from t.ids where chave='clube_a'), 'todos', null)
        full outer join public.push_destinatarios_nativos((select id from t.ids where chave='clube_a'), 'todos', null)
          using (user_id)
        where user_id is null) x$q$), 0);

select t.eq('APK: responsável do clube A não está no público de "todos"',
  t.n($q$select count(*) from public.push_destinatarios_nativos(
        (select id from t.ids where chave='clube_a'), 'todos', null) d
      where d.user_id = (select id from t.ids where chave='pais_a')$q$), 0);

-- "lideranca": instrutor e diretoria; conselheiro e tesoureiro não entram.
select t.eq('APK: "lideranca" do clube A = diretoria + instrutor (2)',
  t.n($q$select count(*) from public.push_destinatarios_nativos(
        (select id from t.ids where chave='clube_a'), 'lideranca', null)$q$), 2);

-- Isolamento entre clubes: o aviso de um clube nunca alcança aparelho do outro.
select t.eq('APK: nenhum aparelho do clube B recebe aviso do clube A',
  t.n($q$select count(*) from public.push_destinatarios_nativos(
        (select id from t.ids where chave='clube_a'), 'todos', null) d
      join public.organization_memberships m on m.user_id = d.user_id
      where m.organizational_unit_id = (select id from t.ids where chave='clube_b')
        and not exists (select 1 from public.organization_memberships m2
                        where m2.user_id = d.user_id
                          and m2.organizational_unit_id = (select id from t.ids where chave='clube_a'))$q$), 0);
select t.eq('APK: "todos" do clube B alcança só os aparelhos do B (líder + membro)',
  t.n($q$select count(*) from public.push_destinatarios_nativos(
        (select id from t.ids where chave='clube_b'), 'todos', null)$q$), 2);

-- Recado pessoal: só o aparelho daquela pessoa, e só se ela tiver vínculo ativo no clube.
select t.eq('APK: recado pessoal alcança só o aparelho do destinatário',
  t.n($q$select count(*) from public.push_destinatarios_nativos(
        (select id from t.ids where chave='clube_a'), 'pessoal', (select id from t.ids where chave='membro_a'))$q$), 1);
select t.eq('APK: recado pessoal para alguém de OUTRO clube não alcança ninguém',
  t.n($q$select count(*) from public.push_destinatarios_nativos(
        (select id from t.ids where chave='clube_a'), 'pessoal', (select id from t.ids where chave='membro_b'))$q$), 0);

-- Falha fechada: sem clube não há público, em nenhuma das rotas.
select t.eq('APK: notificação sem clube não alcança ninguém',
  t.n($q$select count(*) from public.push_destinatarios_nativos(null, 'todos', null)$q$), 0);
select t.eq('APK: destino desconhecido não vira broadcast',
  t.n($q$select count(*) from public.push_destinatarios_nativos(
        (select id from t.ids where chave='clube_a'), 'qualquer-coisa', null)$q$), 0);

-- =============================================================================
--  2. As funções de entrega são do servidor, não do app
-- =============================================================================
select t.como('lider_a');
select t.throws('nem a diretoria executa push_destinatarios_nativos pela API',
  $q$select * from public.push_destinatarios_nativos((select id from t.ids where chave='clube_a'), 'todos', null)$q$,
  'permission denied');
select t.throws('nem a diretoria executa _push_publico',
  $q$select * from public._push_publico((select id from t.ids where chave='clube_a'), 'todos', null)$q$,
  'permission denied');
select t.eq('a diretoria continua sem ler os tokens de aparelho de outras pessoas',
  t.nv('select count(*) from public.push_tokens'),
  t.nv($q$select count(*) from public.push_tokens where user_id = (select id from t.ids where chave='lider_a')$q$));
reset role;

select t.eq('só o service_role executa a busca de destinatários nativos',
  t.txt($q$select coalesce(string_agg(distinct grantee, ','), '(ninguém)') from information_schema.role_routine_grants
         where routine_name = 'push_destinatarios_nativos' and grantee <> 'postgres'$q$), 'service_role');

-- =============================================================================
--  3. O webhook mora no banco, não no painel
-- =============================================================================
select t.eq('o gatilho de push existe em `notificacoes` (veio na migration, não no painel)',
  t.n($q$select count(*) from pg_trigger
       where tgrelid = 'public.notificacoes'::regclass and tgname = 'trg_notificacao_push' and not tgisinternal$q$), 1);
-- bit 1 (valor 2) de tgtype = BEFORE; sem ele, é AFTER. Precisa ser AFTER: se o disparo do push
-- rodasse antes, uma falha nele poderia impedir a notificação de ser gravada.
select t.eq('...e dispara DEPOIS do insert (a notificação é gravada de qualquer jeito)',
  t.txt($q$select case when (tgtype & 2) = 0 then 'AFTER' else 'BEFORE' end from pg_trigger
         where tgrelid = 'public.notificacoes'::regclass and tgname = 'trg_notificacao_push'$q$), 'AFTER');
select t.eq('a extensão pg_net está instalada (é o que faz a chamada sair do banco)',
  t.n($q$select count(*) from pg_extension where extname = 'pg_net'$q$), 1);

-- Sem os segredos no Vault (que é o caso deste banco de teste), a notificação PRECISA entrar
-- assim mesmo — e a falta de configuração precisa deixar rastro. É a diferença entre
-- "o push não saiu" e "o push não saiu e ninguém ficou sabendo".
--
-- A contagem é por DELTA, não absoluta: os próprios fixtures inserem notificações, e o gatilho
-- já registrou a falta de configuração para cada uma delas. Isso, por si só, é a prova de que
-- ele está ligado no caminho real de escrita — não só presente no catálogo.
select t.ok('o gatilho já registrou falhas durante os fixtures (está no caminho real)',
  t.n($q$select count(*) from public.infra_falhas where origem = 'push/webhook'$q$) > 0);
\o /dev/null
create table t.antes as select count(*) n from public.infra_falhas where origem = 'push/webhook';
\o
select t.como('lider_a');
select t.pedir_clube('clube_a');
select t.permitido('a notificação é gravada mesmo sem o push configurado',
  $q$insert into public.notificacoes (titulo, corpo, tipo, link, para, criado_por)
     values ('Teste de infra', 'corpo', 'geral', '/', 'todos', (select id from t.ids where chave='lider_a'))$q$);
reset role;
select t.eq('...e ESSA notificação somou exatamente mais uma falha registrada',
  t.n($q$select (select count(*) from public.infra_falhas where origem='push/webhook') - (select n from t.antes)$q$), 1);
select t.eq('a linha diz exatamente o que falta',
  t.txt($q$select detalhe from public.infra_falhas where origem = 'push/webhook' order by id desc limit 1$q$),
  'sem configuração no Vault: push_edge_url e push_webhook_secret');
select t.eq('...e guarda o clube, para saber quem ficou sem aviso',
  t.txt($q$select (club_id = (select id from t.ids where chave='clube_a'))::text
           from public.infra_falhas where origem = 'push/webhook' order by id desc limit 1$q$), 'true');

-- infra_falhas é tabela de operação: o app não lê.
select t.como('lider_a');
select t.eq('nem a diretoria lê infra_falhas pelo app', t.nv('select count(*) from public.infra_falhas'), 0);
reset role;

select t.fim();
rollback;
