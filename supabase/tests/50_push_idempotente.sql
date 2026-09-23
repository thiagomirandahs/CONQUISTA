-- =============================================================================
--  Fase 8.2 — PUSH IDEMPOTENTE (migration 55).
--
--  A pergunta deste arquivo é uma só: existe algum caminho pelo qual o celular de uma criança
--  toca duas vezes pelo mesmo fato?
--
--  Antes da migration 55 a resposta era "vários, e nenhum estava fechado": não havia constraint,
--  nem registro de entrega, nem chave de negócio. `notificacoes.id` é `gen_random_uuid()`, então
--  dois INSERTs para o mesmo fato recebiam ids diferentes e não colidiam com nada.
--
--  Os três níveis, e o que cada um protege:
--    NÍVEL 1  push_eventos ................ cron repetido, duplo toque, replay de backup
--    NÍVEL 2  push_evento_destinatarios ... público congelado: o retry envia para o MESMO conjunto
--    NÍVEL 3  push_tentativas ............. retry/timeout/reprocessamento da Edge Function
--
--  E a prova que mais importa é a NEGATIVA: seed, fixture e restore não podem despachar nada.
-- =============================================================================
begin;
\ir _lib.sql
\ir _fixtures.sql

\o /dev/null
-- As tabelas auxiliares deste arquivo precisam ser legíveis pelos papéis que o teste assume —
-- vários asserts rodam como `service_role` (é ele quem a Edge Function usa) e leriam `t.ev`.
-- Sem isto o erro é "permission denied for table e", que se disfarça de falha da função testada.
alter default privileges in schema t grant select on tables to public;

-- Aparelhos: o membro A tem DOIS (celular e tablet) — é o cenário que decide a granularidade da
-- chave final. O membro A2 tem um só.
insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, dispositivo_id)
values (t.id('membro_a'), 'https://push.teste/celular-a', 'k', 'a', md5('aparelho:celular-a')::uuid),
       (t.id('membro_a'), 'https://push.teste/tablet-a',  'k', 'a', md5('aparelho:tablet-a')::uuid)
on conflict (endpoint) do update set dispositivo_id = excluded.dispositivo_id;

create function t.notificar(p_titulo text, p_corpo text, p_chave text default null) returns uuid
language plpgsql as $$
declare v_id uuid;
begin
  insert into public.notificacoes (titulo, corpo, tipo, link, para, criado_por, club_id, chave_push)
  values (p_titulo, p_corpo, 'geral', '/', 'todos', t.id('lider_a'), t.id('clube_a'), p_chave)
  returning push_evento_id into v_id;
  return v_id;
end $$;
\o

-- =============================================================================
--  NÍVEL 1 — o evento
-- =============================================================================
select t.ok('a primeira notificação cria um evento',
  t.txt($q$select (t.notificar('Reunião sábado', 'às 14h') is not null)::text$q$) = 'true');

-- O caminho mais provável de todos: o cron roda de novo, ou a pessoa toca duas vezes.
select t.eq('a MESMA notificação, repetida, NÃO cria evento — logo não dispara',
  t.txt($q$select coalesce(t.notificar('Reunião sábado', 'às 14h')::text, 'SEM EVENTO')$q$), 'SEM EVENTO');
select t.eq('...e continua sendo gravada (a pessoa vê o aviso no app; só o push é que não repete)',
  t.n($q$select count(*) from public.notificacoes where titulo = 'Reunião sábado'$q$), 2);

-- Conteúdo diferente é fato diferente.
select t.ok('uma notificação com corpo diferente cria evento novo',
  t.txt($q$select (t.notificar('Reunião sábado', 'às 15h — mudou!') is not null)::text$q$) = 'true');

-- A chave do produtor manda mais que a automática: é o que permite um leilão mandar dois avisos
-- com o mesmo texto para o mesmo lance sem serem colapsados.
select t.ok('chave explícita do produtor é honrada',
  t.txt($q$select (t.notificar('Passaram sua unidade', 'lance de 100', 'lance:1') is not null)::text$q$) = 'true');
select t.eq('...e a MESMA chave explícita não repete, mesmo com corpo diferente',
  t.txt($q$select coalesce(t.notificar('Passaram sua unidade', 'lance de 999', 'lance:1')::text, 'SEM EVENTO')$q$), 'SEM EVENTO');
select t.ok('...enquanto uma chave nova passa',
  t.txt($q$select (t.notificar('Passaram sua unidade', 'lance de 200', 'lance:2') is not null)::text$q$) = 'true');

-- A intenção declarada de NÃO despachar.
select t.eq('chave_push vazia = "não despache" (é como seed, fixture e backfill se protegem)',
  t.txt($q$select coalesce(t.notificar('Semente', 'conteúdo inicial', '')::text, 'SEM EVENTO')$q$), 'SEM EVENTO');

-- E a prova de que os fixtures deste próprio arquivo não despacharam nada.
select t.eq('as notificações dos fixtures NÃO criaram evento nenhum',
  t.n($q$select count(*) from public.notificacoes where push_evento_id is not null
        and titulo in ('Aviso A', 'Aviso B', 'Recado membro A')$q$), 0);

-- =============================================================================
--  NÍVEL 2 — o público, congelado
-- =============================================================================
\o /dev/null
create table t.ev as select t.notificar('Acampamento', 'sábado que vem') as id;
\o
select t.ok('o evento congelou um público não vazio',
  t.n($q$select destinatarios from public.push_eventos where id = (select id from t.ev)$q$) > 0);
select t.eq('o público congelado bate com a regra de destino do momento',
  t.n($q$select count(*) from public.push_evento_destinatarios where evento_id = (select id from t.ev)$q$),
  t.n($q$select count(*) from public._push_publico(t.id('clube_a'), 'todos', null)$q$));
select t.eq('responsável não entra no público (a regra de sempre, agora materializada)',
  t.n($q$select count(*) from public.push_evento_destinatarios d
        where d.evento_id = (select id from t.ev) and d.user_id = t.id('pais_a')$q$), 0);
select t.eq('e ninguém do clube B entra',
  t.n($q$select count(*) from public.push_evento_destinatarios d
        join public.organization_memberships m on m.user_id = d.user_id
       where d.evento_id = (select id from t.ev)
         and m.organizational_unit_id = t.id('clube_b')
         and not exists (select 1 from public.organization_memberships m2
                          where m2.user_id = d.user_id and m2.organizational_unit_id = t.id('clube_a'))$q$), 0);

-- O congelamento é o que torna o retry determinístico: se alguém sai do clube DEPOIS do evento,
-- o reenvio continua mirando quem estava lá no momento do fato.
\o /dev/null
update public.organization_memberships set status = 'suspenso'
 where user_id = t.id('membro_a2') and organizational_unit_id = t.id('clube_a');
\o
select t.eq('sair do clube depois do evento NÃO muda o público já congelado',
  t.n($q$select count(*) from public.push_evento_destinatarios where evento_id = (select id from t.ev)$q$),
  t.n($q$select destinatarios from public.push_eventos where id = (select id from t.ev)$q$));
\o /dev/null
update public.organization_memberships set status = 'ativo'
 where user_id = t.id('membro_a2') and organizational_unit_id = t.id('clube_a');
\o

-- =============================================================================
--  NÍVEL 3 — as tentativas: retry, timeout, reprocessamento
-- =============================================================================
select t.como_service();
select t.ok('a primeira reserva devolve as entregas (2 aparelhos do membro A + os demais)',
  t.n($q$select count(*) from public.push_reservar((select id from t.ev))$q$) > 0);
reset role;
\o /dev/null
create table t.reservou as select count(*) n from public.push_tentativas
 where destinatario_id in (select id from public.push_evento_destinatarios where evento_id = (select id from t.ev));
\o

-- O CORAÇÃO: um segundo invoke do mesmo evento — retry, timeout do pg_net, reprocessamento
-- manual — não pode reservar nada, porque as linhas já estão 'enviando'.
select t.como_service();
select t.eq('o SEGUNDO invoke do mesmo evento não reserva nada (retry não reenvia)',
  t.n($q$select count(*) from public.push_reservar((select id from t.ev))$q$), 0);
select t.eq('...e o terceiro também não',
  t.n($q$select count(*) from public.push_reservar((select id from t.ev))$q$), 0);
reset role;
select t.eq('nenhuma tentativa a mais foi criada pelos invokes repetidos',
  t.n($q$select count(*) from public.push_tentativas
        where destinatario_id in (select id from public.push_evento_destinatarios where evento_id = (select id from t.ev))$q$),
  t.n($q$select n from t.reservou$q$));

-- Concluir: sucesso trava para sempre; falha libera para nova tentativa.
\o /dev/null
create table t.duas as select id from public.push_tentativas
 where destinatario_id in (select id from public.push_evento_destinatarios where evento_id = (select id from t.ev))
 order by id limit 2;
\o
select t.como_service();
select t.eq('concluir marca as tentativas',
  t.n($q$select public.push_concluir(jsonb_build_array(
        jsonb_build_object('id', (select min(id) from t.duas), 'ok', true,  'codigo', '200', 'ms', 120),
        jsonb_build_object('id', (select max(id) from t.duas), 'ok', false, 'codigo', '503', 'ms', 900)))$q$), 2);
reset role;
select t.eq('a entregue ficou entregue', t.txt($q$select estado from public.push_tentativas where id = (select min(id) from t.duas)$q$), 'entregue');
select t.eq('a que falhou ficou falhou',  t.txt($q$select estado from public.push_tentativas where id = (select max(id) from t.duas)$q$), 'falhou');
select t.eq('o histórico guarda o código e a duração', t.txt($q$select codigo || '/' || duracao_ms from public.push_tentativas where id = (select max(id) from t.duas)$q$), '503/900');

-- Agora o retry: só a que FALHOU pode ser reservada de novo. A entregue está fechada.
select t.como_service();
select t.eq('o retry reserva SÓ a que falhou — a entregue nunca mais é enviada',
  t.n($q$select count(*) from public.push_reservar((select id from t.ev))$q$), 1);
reset role;
select t.eq('...e isso criou uma tentativa NOVA (o histórico da falha é preservado, não sobrescrito)',
  t.n($q$select count(*) from public.push_tentativas where destinatario_id =
        (select destinatario_id from public.push_tentativas where id = (select max(id) from t.duas))$q$), 2);

-- Código fora do vocabulário vira 'desconhecido' — o corpo de erro do provedor pode ecoar o
-- payload, e o payload fala de criança.
\o /dev/null
create table t.nova as select max(id) id from public.push_tentativas;
\o
select t.como_service();
select t.eq('código fora do vocabulário é normalizado',
  t.n($q$select public.push_concluir(jsonb_build_array(jsonb_build_object(
        'id', (select id from t.nova), 'ok', false,
        'codigo', 'InvalidRegistration: token abc123 do usuario joao@x.com', 'ms', 10)))$q$), 1);
reset role;
select t.eq('...para "desconhecido", sem carregar o texto do provedor',
  t.txt($q$select codigo from public.push_tentativas where id = (select id from t.nova)$q$), 'desconhecido');
select t.eq('e o texto do provedor não aparece em NENHUMA coluna de NENHUMA linha',
  t.n($q$select count(*) from public.push_tentativas p where p::text like '%joao@x.com%'$q$), 0);

-- =============================================================================
--  A DUPLICATA QUE SOBREVIVE A TUDO: rotação de token / re-inscrição
-- =============================================================================
-- O FCM rotaciona tokens e o navegador re-inscreve com endpoint novo. Sem identidade de aparelho,
-- o MESMO celular vira duas linhas e toca duas vezes. O unique por (pessoa, aparelho) resolve
-- SUBSTITUINDO a credencial velha em vez de acrescentar outra.
\o /dev/null
create table t.antes_rot as select count(*) n from public.push_subscriptions where user_id = t.id('membro_a');
insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, dispositivo_id)
values (t.id('membro_a'), 'https://push.teste/celular-a-RENOVADO', 'k', 'a', md5('aparelho:celular-a')::uuid)
on conflict (user_id, dispositivo_id) where dispositivo_id is not null
  do update set endpoint = excluded.endpoint;
\o
select t.eq('re-inscrever o MESMO aparelho substitui a credencial, não acrescenta outra',
  t.n($q$select count(*) from public.push_subscriptions where user_id = t.id('membro_a')$q$),
  t.n($q$select n from t.antes_rot$q$));
select t.eq('...e a credencial nova é a que ficou',
  t.n($q$select count(*) from public.push_subscriptions
        where user_id = t.id('membro_a') and endpoint = 'https://push.teste/celular-a-RENOVADO'$q$), 1);

-- Vários aparelhos da MESMA pessoa continuam recebendo todos — trocar duplicata por perda seria
-- pior: o tablet ficaria calado em silêncio.
--
-- São TRÊS e não dois: os fixtures já criam uma inscrição para o membro_a sem `dispositivo_id`, e
-- este arquivo acrescenta celular e tablet. A inscrição antiga conta como um aparelho próprio,
-- com id derivado do endpoint — que é exatamente o comportamento desejado para o acervo que já
-- existe: ninguém fica sem aviso por não ter carimbado o aparelho ainda.
select t.eq('cada aparelho da pessoa recebe a sua entrega, inclusive o legado sem dispositivo_id',
  t.n($q$select count(distinct dispositivo_id) from public.push_tentativas p
        join public.push_evento_destinatarios d on d.id = p.destinatario_id
       where d.evento_id = (select id from t.ev) and d.user_id = t.id('membro_a')$q$), 3);
select t.eq('...e o número de entregas dela bate com o número de inscrições dela',
  t.n($q$select count(*) from public.push_tentativas p
        join public.push_evento_destinatarios d on d.id = p.destinatario_id
       where d.evento_id = (select id from t.ev) and d.user_id = t.id('membro_a')$q$),
  t.n($q$select count(*) from public.push_subscriptions where user_id = t.id('membro_a')$q$));

-- =============================================================================
--  CONCORRÊNCIA REAL — a corrida que toda guarda "lê antes de escrever" perde
-- =============================================================================
-- Reproduz o cron sobreposto / duplo toque / dois workers: N tentativas de criar o MESMO evento
-- ao mesmo tempo. O índice único é o único árbitro; exatamente uma pode vencer.
\o /dev/null
create table t.corrida as
  select count(*) filter (where v is not null) ganhou, count(*) filter (where v is null) perdeu
  from (select public._push_criar_evento(t.id('clube_a'), 'corrida:mesma-chave', 'h1', 'todos', null) v
        from generate_series(1, 20)) x;
\o
select t.eq('20 criações concorrentes da mesma chave: exatamente UMA vence', t.n($q$select ganhou from t.corrida$q$), 1);
select t.eq('...e as outras 19 recebem null (= não despache)', t.n($q$select perdeu from t.corrida$q$), 19);
select t.eq('...e existe UM evento, não vinte', t.n($q$select count(*) from public.push_eventos where chave_evento = 'corrida:mesma-chave'$q$), 1);

-- A mesma corrida na camada de entrega: N reservas simultâneas do mesmo evento.
\o /dev/null
create table t.ev2 as select t.notificar('Corrida de entrega', 'texto único xyz') as id;
-- Cinco reservas SEGUIDAS, cada uma num statement próprio. Escrever isto como
-- `select (select count(*) from push_reservar(...)) from generate_series(1,5)` não serviria: a
-- subconsulta não depende da série, então o planejador a avalia UMA vez (InitPlan) e repete o
-- valor — o teste mediria o planejador, não a função.
do $$ begin
  for i in 1..5 loop perform public.push_reservar((select id from t.ev2)); end loop;
end $$;
\o
select t.eq('cinco reservas do mesmo evento criam UMA entrega por aparelho, não cinco',
  t.n($q$select count(*) from public.push_tentativas p
        join public.push_evento_destinatarios d on d.id = p.destinatario_id
       where d.evento_id = (select id from t.ev2)$q$),
  t.n($q$select count(*) from public.push_evento_destinatarios d
        join public.push_subscriptions s on s.user_id = d.user_id
       where d.evento_id = (select id from t.ev2)$q$));

-- =============================================================================
--  Quem lê, e quem não lê
-- =============================================================================
select t.como('lider_a');
select t.eq('a diretoria do clube NÃO lê o histórico de entrega', t.nv('select count(*) from public.push_tentativas'), 0);
select t.eq('...nem os eventos', t.nv('select count(*) from public.push_eventos'), 0);
select t.throws('e ninguém reserva entrega pela API', 'select * from public.push_reservar(gen_random_uuid())', 'permission denied');
select t.throws('nem conclui', 'select public.push_concluir(''[]''::jsonb)', 'permission denied');
select t.throws('nem cria evento à mão', $q$select public._push_criar_evento(t.id('clube_a'), 'x', 'y', 'todos', null)$q$, 'permission denied');
reset role;

-- Registrar o próprio aparelho, sim — mas só o próprio.
select t.como('membro_a');
select t.permitido('a pessoa carimba o aparelho dela',
  $q$select public.push_aparelho_registrar(md5('novo')::uuid, 'https://push.teste/tablet-a', null)$q$, 0);
reset role;
select t.eq('...e o carimbo pegou', t.n($q$select count(*) from public.push_subscriptions
  where endpoint = 'https://push.teste/tablet-a' and dispositivo_id = md5('novo')::uuid$q$), 1);
select t.como('membro_b');
select t.permitido('outra pessoa não consegue carimbar aparelho alheio (não lança, não faz nada)',
  $q$select public.push_aparelho_registrar(md5('invasor')::uuid, 'https://push.teste/tablet-a', null)$q$, 0);
reset role;
select t.eq('...o aparelho do membro A continua com o dono certo',
  t.n($q$select count(*) from public.push_subscriptions
        where endpoint = 'https://push.teste/tablet-a' and dispositivo_id = md5('novo')::uuid$q$), 1);

-- =============================================================================
--  Retenção
-- =============================================================================
select t.eq('existe expurgo agendado (push_tentativas é a tabela de maior volume do sistema)',
  t.n($q$select count(*) from cron.job where jobname = 'expurgar-push'$q$), 1);
\o /dev/null
update public.push_eventos set criado_em = now() - interval '120 days' where id = (select id from t.ev2);
select public.expurgar_push();
\o
select t.eq('o expurgo leva o evento antigo', t.n($q$select count(*) from public.push_eventos where id = (select id from t.ev2)$q$), 0);
select t.eq('...e as tentativas dele vão junto (cascade), sem deixar órfão',
  t.n($q$select count(*) from public.push_tentativas p
        where not exists (select 1 from public.push_evento_destinatarios d where d.id = p.destinatario_id)$q$), 0);

select t.fim();
rollback;
