-- =============================================================================
--  Fase 8.2 — PAGINAÇÃO KEYSET (migration 58).
--
--  A fase pede que se prove: primeira página, próxima página, item inserido ENTRE páginas,
--  exclusão, EMPATE DE TIMESTAMP e fim da coleção. É exatamente o que está abaixo, nessa ordem.
--
--  O empate de timestamp é o caso que separa keyset que funciona de keyset que parece funcionar:
--  `now()` no Postgres é o instante de INÍCIO DA TRANSAÇÃO, então toda rotina que grava várias
--  linhas num laço produz `created_at` idêntico byte a byte. Um cursor só com a data PULA linhas
--  (com `<`) ou entra em LAÇO INFINITO (com `<=`). Aqui o cursor é a tupla (created_at, id).
-- =============================================================================
begin;
\ir _lib.sql
\ir _fixtures.sql

\o /dev/null
alter default privileges in schema t grant select on tables to public;

-- 25 mensagens na conversa geral do clube A, em instantes DISTINTOS.
insert into public.chat_conversas (tipo, club_id, unidade_id) values ('geral', t.id('clube_a'), null)
on conflict do nothing;
reset role;
create table t.conv as select id from public.chat_conversas where tipo='geral' and club_id=t.id('clube_a') limit 1;
insert into public.chat_mensagens (conversa_id, autor_id, club_id, texto, created_at)
select (select id from t.conv), t.id('membro_a'), t.id('clube_a'), 'msg ' || lpad(g::text,3,'0'),
       timestamptz '2026-01-01 10:00:00' + (g || ' minutes')::interval
  from generate_series(1, 25) g;

-- Percorre a coleção inteira pelo cursor e devolve os textos na ordem em que foram lidos.
-- É a função que responde "alguma linha foi pulada ou repetida?" — que é a única pergunta que
-- importa numa paginação.
create function t.percorrer(p_limite int) returns text language plpgsql as $$
declare v jsonb; v_d timestamptz := null; v_i uuid := null; v_out text := ''; v_volta int := 0; m jsonb;
begin
  loop
    v_volta := v_volta + 1;
    if v_volta > 100 then return 'LACO INFINITO'; end if;   -- a falha clássica do cursor com <=
    v := public.chat_pagina((select id from t.conv), p_limite, v_d, v_i);
    for m in select * from jsonb_array_elements(v->'mensagens') loop
      v_out := v_out || coalesce(m->>'texto','(nulo)') || '|';
      v_d := (m->>'created_at')::timestamptz; v_i := (m->>'id')::uuid;
    end loop;
    exit when not (v->>'tem_mais')::boolean;
    exit when jsonb_array_length(v->'mensagens') = 0;
  end loop;
  return rtrim(v_out, '|');   -- sem o separador final, senao string_to_array devolve um elemento vazio
end $$;
\o

select t.como('membro_a');
select t.pedir_clube('clube_a');

-- =============================================================================
--  1. Primeira página
-- =============================================================================
select t.eq('a primeira página traz exatamente o limite pedido',
  t.n($q$select jsonb_array_length(public.chat_pagina((select id from t.conv), 10) -> 'mensagens')$q$), 10);
select t.eq('...as mais RECENTES primeiro (é um chat, não um arquivo)',
  t.txt($q$select public.chat_pagina((select id from t.conv), 10) -> 'mensagens' -> 0 ->> 'texto'$q$), 'msg 025');
select t.eq('...e ela avisa que há mais',
  t.txt($q$select (public.chat_pagina((select id from t.conv), 10) ->> 'tem_mais')$q$), 'true');

-- =============================================================================
--  2. Próxima página, e a coleção inteira sem pular nem repetir
-- =============================================================================
select t.eq('percorrendo de 10 em 10, lê as 25 mensagens, sem repetir nenhuma',
  t.n($q$select array_length(string_to_array(t.percorrer(10), '|'), 1)$q$), 25);
select t.eq('...e sem pular nenhuma (as 25 distintas)',
  t.n($q$select count(distinct x) from unnest(string_to_array(t.percorrer(10), '|')) x$q$), 25);
select t.eq('de 1 em 1 dá o mesmo resultado (o tamanho da página não muda o conjunto)',
  t.txt($q$select t.percorrer(1)$q$), t.txt($q$select t.percorrer(10)$q$));
select t.eq('...e de 200 em 200 também',
  t.txt($q$select t.percorrer(200)$q$), t.txt($q$select t.percorrer(10)$q$));

-- =============================================================================
--  3. EMPATE DE TIMESTAMP — o caso que quebra keyset ingênuo
-- =============================================================================
-- 10 mensagens com created_at IDÊNTICO, que é o que `now()` produz num laço.
\o /dev/null
-- preparo roda como postgres: a sessao esta como membro_a e a RLS recusa escrita direta — o que
-- esta certo, e por isso o preparo nao pode fingir ser o app.
reset role;
insert into public.chat_mensagens (conversa_id, autor_id, club_id, texto, created_at)
select (select id from t.conv), t.id('membro_a'), t.id('clube_a'), 'empate ' || lpad(g::text,2,'0'),
       timestamptz '2026-01-01 09:00:00'
  from generate_series(1, 10) g;
\o
select t.como('membro_a'); select t.pedir_clube('clube_a');
select t.eq('com 10 mensagens no MESMO instante, a coleção inteira ainda é lida (35)',
  t.n($q$select array_length(string_to_array(t.percorrer(3), '|'), 1)$q$), 35);
select t.eq('...nenhuma repetida',
  t.n($q$select count(distinct x) from unnest(string_to_array(t.percorrer(3), '|')) x$q$), 35);
select t.eq('...e nenhuma das 10 empatadas ficou de fora',
  t.n($q$select count(*) from unnest(string_to_array(t.percorrer(3), '|')) x where x like 'empate%'$q$), 10);
-- A página que cai DENTRO do bloco empatado é a prova fina: com cursor só de data, aqui o
-- percurso pularia o resto do bloco ou nunca sairia dele.
select t.eq('a paginação NÃO entra em laço infinito dentro do bloco empatado',
  t.txt($q$select case when t.percorrer(2) = 'LACO INFINITO' then 'LACO' else 'ok' end$q$), 'ok');

-- =============================================================================
--  4. Item inserido ENTRE páginas
-- =============================================================================
-- Keyset tem uma propriedade que OFFSET não tem: a linha nova entra no TOPO, e quem está
-- descendo o histórico não vê a página deslizar. Com OFFSET, inserir uma linha empurra tudo e a
-- próxima página REPETE a última lida.
\o /dev/null
-- reset role, mas as claims do JWT CONTINUAM valendo: t.como() define papel E claims, e
-- reset role so devolve o papel. Entao a pagina abaixo e exatamente a que membro_a enxerga,
-- criada num papel que pode escrever no schema do teste.
reset role;
create table t.p1 as select public.chat_pagina((select id from t.conv), 5) v;
reset role;
create table t.cursor1 as
  select ((select v from t.p1) -> 'mensagens' -> 4 ->> 'created_at')::timestamptz d,
         ((select v from t.p1) -> 'mensagens' -> 4 ->> 'id')::uuid i;
-- chega mensagem nova DEPOIS de a pessoa ter lido a página 1
reset role;
insert into public.chat_mensagens (conversa_id, autor_id, club_id, texto, created_at)
values ((select id from t.conv), t.id('membro_a'), t.id('clube_a'), 'CHEGOU DEPOIS', now());
\o
select t.como('membro_a'); select t.pedir_clube('clube_a');
select t.eq('a mensagem nova NÃO aparece na página 2 (o cursor olha para trás, não para o topo)',
  t.n($q$select count(*) from jsonb_array_elements(
        public.chat_pagina((select id from t.conv), 5, (select d from t.cursor1), (select i from t.cursor1)) -> 'mensagens') m
      where m ->> 'texto' = 'CHEGOU DEPOIS'$q$), 0);
select t.eq('...e a página 2 não repete nada da página 1',
  t.n($q$select count(*) from jsonb_array_elements(
        public.chat_pagina((select id from t.conv), 5, (select d from t.cursor1), (select i from t.cursor1)) -> 'mensagens') m2
      join jsonb_array_elements((select v from t.p1) -> 'mensagens') m1
        on m1 ->> 'id' = m2 ->> 'id'$q$), 0);
select t.eq('a mensagem nova aparece, sim, em quem recarrega do topo',
  t.txt($q$select public.chat_pagina((select id from t.conv), 1) -> 'mensagens' -> 0 ->> 'texto'$q$), 'CHEGOU DEPOIS');

-- =============================================================================
--  5. Exclusão entre páginas
-- =============================================================================
\o /dev/null
reset role;
create table t.antes_del as select array_length(string_to_array(t.percorrer(4), '|'), 1) n;
reset role;
delete from public.chat_mensagens where texto = 'msg 013';
\o
select t.como('membro_a'); select t.pedir_clube('clube_a');
select t.eq('apagar uma mensagem no meio: a coleção encolhe em exatamente 1 e nada quebra',
  t.n($q$select (select n from t.antes_del) - array_length(string_to_array(t.percorrer(4), '|'), 1)$q$), 1);
select t.eq('...e a apagada não aparece mais',
  t.n($q$select count(*) from unnest(string_to_array(t.percorrer(4), '|')) x where x = 'msg 013'$q$), 0);

-- =============================================================================
--  6. Fim da coleção
-- =============================================================================
select t.eq('na última página, tem_mais é false',
  t.txt($q$select (public.chat_pagina((select id from t.conv), 500) ->> 'tem_mais')$q$), 'false');
\o /dev/null
reset role;   -- preparo e do servidor, nao do app
reset role;
create table t.ultimo as
  select (public.chat_pagina((select id from t.conv), 500) -> 'mensagens' -> -1 ->> 'created_at')::timestamptz d,
         (public.chat_pagina((select id from t.conv), 500) -> 'mensagens' -> -1 ->> 'id')::uuid i;
\o
select t.como('membro_a'); select t.pedir_clube('clube_a');
select t.eq('passando do fim, devolve lista vazia — não erro, não a primeira página de novo',
  t.n($q$select jsonb_array_length(public.chat_pagina((select id from t.conv), 10,
        (select d from t.ultimo), (select i from t.ultimo)) -> 'mensagens')$q$), 0);
select t.eq('...e tem_mais é false',
  t.txt($q$select (public.chat_pagina((select id from t.conv), 10,
        (select d from t.ultimo), (select i from t.ultimo)) ->> 'tem_mais')$q$), 'false');

-- =============================================================================
--  7. O limite é do SERVIDOR, não do cliente
-- =============================================================================
-- O teto de hoje é o `max_rows = 1000` do PostgREST, que trunca e devolve 200 — toda tela que
-- "funciona" acima disso mostra dado incompleto sem avisar. A função tem teto próprio, abaixo dele.
select t.ok('pedir 99999 devolve no máximo 200',
  t.n($q$select jsonb_array_length(public.chat_pagina((select id from t.conv), 99999) -> 'mensagens')$q$) <= 200);
select t.eq('pedir 0 ou negativo devolve ao menos 1, nunca a coleção inteira',
  t.n($q$select jsonb_array_length(public.chat_pagina((select id from t.conv), -5) -> 'mensagens')$q$), 1);

-- =============================================================================
--  8. A autorização é a MESMA do resto do chat
-- =============================================================================
select t.como('membro_b');
select t.pedir_clube('clube_b');
select t.eq('membro de outro clube recebe lista vazia, não erro (não vira oráculo)',
  t.n($q$select jsonb_array_length(public.chat_pagina((select id from t.conv), 10) -> 'mensagens')$q$), 0);
select t.eq('...e a resposta é IDÊNTICA à de uma conversa que não existe',
  t.txt($q$select public.chat_pagina((select id from t.conv), 10)::text$q$),
  t.txt($q$select public.chat_pagina('11111111-2222-3333-4444-555555555555'::uuid, 10)::text$q$));
select t.como('pais_a');
select t.eq('responsável não lê o chat por esta via tampouco (a regra é a mesma da matriz 45)',
  t.n($q$select jsonb_array_length(public.chat_pagina((select id from t.conv), 10) -> 'mensagens')$q$), 0);
reset role;

-- E a moderação continua vendo o texto original da mensagem apagada — a paginação não pode ter
-- mudado o recorte de moderação, que é camada independente.
\o /dev/null
select t.como('membro_a');
select public.chat_enviar_geral('palavra ruim para moderar');
reset role;
create table t.mod as select id from public.chat_mensagens where texto = 'palavra ruim para moderar';
select t.como('lider_a');
select public.chat_apagar_mensagem((select id from t.mod));
reset role;
\o
select t.como('lider_a');
select t.pedir_clube('clube_a');
select t.eq('a liderança lê o texto original da apagada, mesmo paginando',
  t.n($q$select count(*) from jsonb_array_elements(public.chat_pagina((select id from t.conv), 200) -> 'mensagens') m
      where m ->> 'texto' = 'palavra ruim para moderar'$q$), 1);
select t.como('membro_a2');
select t.pedir_clube('clube_a');
select t.eq('...e um membro comum não lê (o texto vem nulo, não o original)',
  t.n($q$select count(*) from jsonb_array_elements(public.chat_pagina((select id from t.conv), 200) -> 'mensagens') m
      where m ->> 'texto' = 'palavra ruim para moderar'$q$), 0);
reset role;

-- =============================================================================
--  9. A aba "Ano" de Mensalidades — o truncamento silencioso que era erro de DINHEIRO
-- =============================================================================
-- Medido na fase 8.2: 1.320 mensalidades de um ano devolviam 1.000 linhas com HTTP 200. A tela
-- mostrava 320 pagamentos como NAO PAGOS, sem nenhum aviso. A correcao nao foi paginar: foi
-- devolver uma linha por PESSOA com os doze meses dentro, que e a forma que a tela ja montava.
\o /dev/null
reset role;
insert into public.mensalidades (desbravador_id, mes, ano, valor, status, club_id, registrado_por)
select t.id('membro_a'), m, 2031, 50, 'pago', t.id('clube_a'), t.id('lider_a')
  from generate_series(1, 12) m on conflict do nothing;
\o
select t.como('lider_a'); select t.pedir_clube('clube_a');
-- Uma linha por pessoa: o numero de linhas e igual ao numero de pessoas DISTINTAS. Era isto que
-- multiplicava por 12 e estourava o teto do PostgREST.
select t.eq('a aba Ano devolve UMA linha por pessoa, nao uma por mes',
  t.n($q$select count(*) from public.mensalidades_ano(2031)$q$),
  t.n($q$select count(distinct desbravador_id) from public.mensalidades_ano(2031)$q$));
select t.ok('...e a lista nao esta vazia (senao o assert acima passaria no vazio)',
  t.n($q$select count(*) from public.mensalidades_ano(2031)$q$) > 0);
select t.eq('nenhuma linha carrega mais de 12 meses',
  t.n($q$select count(*) from public.mensalidades_ano(2031)
       where (select count(*) from jsonb_object_keys(meses)) > 12$q$), 0);
select t.eq('...e os doze meses vem dentro da linha',
  t.n($q$select count(*) from jsonb_object_keys(
        (select meses from public.mensalidades_ano(2031) where desbravador_id = t.id('membro_a')))$q$), 12);
select t.eq('quem nao pagou aparece com o objeto vazio, nao sumindo da lista',
  t.txt($q$select meses::text from public.mensalidades_ano(2031) where desbravador_id = t.id('membro_a2')$q$), '{}');
select t.como('membro_a'); select t.pedir_clube('clube_a');
select t.eq('membro comum nao le mensalidade de ninguem (dinheiro e da gestao)',
  t.n($q$select count(*) from public.mensalidades_ano(2031)$q$), 0);
select t.como('lider_b'); select t.pedir_clube('clube_b');
select t.eq('a lideranca do outro clube nao ve as mensalidades do clube A',
  t.n($q$select count(*) from public.mensalidades_ano(2031) x
      join public.organization_memberships v on v.user_id = x.desbravador_id
     where v.organizational_unit_id = t.id('clube_a')$q$), 0);
reset role;

select t.fim();
rollback;
