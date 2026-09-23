-- =============================================================================
--  Fase 8.1 — o que a migration 51 prometeu, provado ESTRUTURALMENTE.
--
--  Um teste de desempenho que mede tempo num banco de teste vazio não prova nada: com 10 linhas
--  qualquer plano é rápido. O que dá para travar aqui, e é o que importa, é a FORMA:
--
--    1. o índice do mural existe, com as colunas e a ordem certas;
--    2. o planejador realmente o escolhe para "as N fotos mais recentes deste clube";
--    3. a policy do chat NÃO chama mais a função uma vez por linha — o plano tem de mostrar
--       o subplano hasheado (avaliado uma vez) em vez de um Filter com chamada por linha;
--    4. a superfície nova (`chat_conversas_visiveis`) está fechada para quem não é `authenticated`,
--       e é honesta: devolve só as conversas de quem chama, sem parâmetro para manipular.
--
--  O ganho NUMÉRICO vive em supabase/carga/bench-chat.sql, que roda sobre o dataset sintético.
--  Aqui trava-se a estrutura, que é o que uma migration futura pode quebrar sem perceber.
-- =============================================================================
begin;
\ir _lib.sql
\ir _fixtures.sql

\o /dev/null
-- Devolve o plano de uma consulta como TEXTO, para poder ser inspecionado com `like`.
-- Sem `analyze`: interessa a forma escolhida pelo planejador, não o tempo neste banco minúsculo.
create function t.plano(p_sql text) returns text language plpgsql as $$
declare v text; linha text;
begin
  v := '';
  for linha in execute 'explain (costs off) ' || p_sql loop v := v || linha || E'\n'; end loop;
  return v;
exception when others then return 'ERRO: ' || sqlerrm;
end $$;
\o

-- =============================================================================
--  1. O índice do mural: existe, e com a definição exata que foi medida.
-- =============================================================================
select t.eq('idx_fotos_club_recente existe',
  t.n($q$select count(*) from pg_indexes where schemaname='public' and tablename='fotos' and indexname='idx_fotos_club_recente'$q$), 1);
select t.eq('...e é (club_id, created_at DESC) — a ordem é o que torna a ordenação gratuita',
  t.txt($q$select indexdef from pg_indexes where indexname='idx_fotos_club_recente'$q$),
  'CREATE INDEX idx_fotos_club_recente ON public.fotos USING btree (club_id, created_at DESC)');

-- =============================================================================
--  2. O planejador o escolhe de verdade.
--
--  Com dez linhas o planejador prefere ler a tabela inteira — e está certo. Forçar
--  `enable_seqscan = off` provaria só que o índice é USÁVEL, não que ele é ESCOLHIDO, que é a
--  pergunta. Então o teste dá volume: 3.000 fotos no clube A, espalhadas no tempo, e ANALYZE
--  para o planejador ter estatística. Aí a escolha é uma decisão de custo real, como em produção.
-- =============================================================================
\o /dev/null
insert into public.fotos (url, legenda, autor_id, club_id, created_at)
select 'https://exemplo.test/vol-' || g || '.jpg', 'volume', t.id('membro_a'), t.id('clube_a'),
       now() - (g || ' minutes')::interval
  from generate_series(1, 3000) g;
analyze public.fotos;
\o
select t.ok('com volume, o planejador ESCOLHE idx_fotos_club_recente para o mural',
  t.plano($q$select id, url, created_at from public.fotos where club_id = (select id from t.ids where chave='clube_a') order by created_at desc limit 30$q$)
  like '%idx_fotos_club_recente%');
select t.ok('...e não sobra nenhum Sort (o índice já entrega na ordem pedida)',
  t.plano($q$select id, url, created_at from public.fotos where club_id = (select id from t.ids where chave='clube_a') order by created_at desc limit 30$q$)
  not like '%Sort%');

-- =============================================================================
--  3. O chat: a policy virou conjunto, não chamada por linha.
--
--  A assinatura de "por linha" no plano é a função aparecendo dentro de um Filter/Index Cond
--  aplicado a cada linha. A assinatura de "uma vez só" é o SubPlan hasheado. O teste procura
--  as duas coisas, para que a regressão seja detectada nos dois sentidos.
-- =============================================================================
-- `hashed SubPlan` é a assinatura exata de "avaliado uma vez e guardado numa tabela hash".
-- Se a policy voltar a ser uma chamada por linha, essa palavra some do plano e o nome da função
-- aparece dentro do Filter — os dois asserts pegam a regressão pelos dois lados.
select t.como('membro_a');
select t.ok('o plano da leitura de mensagens tem "hashed SubPlan" (conjunto avaliado uma vez)',
  t.plano($q$select id, texto from public.chat_mensagens limit 10$q$) like '%hashed SubPlan%');
select t.ok('...e NÃO chama chat_pode_ver por linha',
  t.plano($q$select id, texto from public.chat_mensagens limit 10$q$) not like '%chat_pode_ver%');
select t.ok('o plano da leitura de conversas também tem "hashed SubPlan"',
  t.plano($q$select id from public.chat_conversas limit 10$q$) like '%hashed SubPlan%');
select t.ok('...e também não chama chat_pode_ver por linha',
  t.plano($q$select id from public.chat_conversas limit 10$q$) not like '%chat_pode_ver%');
reset role;

-- As três policies precisam apontar para a MESMA fonte de verdade. Se uma delas ficar para trás
-- numa migration futura, a matriz de acesso se desencontra sem ninguém notar.
select t.eq('as 3 policies de leitura do chat usam chat_conversas_visiveis',
  t.n($q$select count(*) from pg_policies
       where tablename in ('chat_conversas','chat_mensagens','chat_participantes')
         and cmd = 'SELECT' and qual like '%chat_conversas_visiveis%'$q$), 3);

-- =============================================================================
--  4. Red-team da superfície nova.
-- =============================================================================
-- Sem parâmetro não há o que manipular: a função responde sobre auth.uid() e nada mais. Isso
-- é uma escolha de desenho — uma versão que aceitasse p_user_id seria um oráculo pronto.
select t.eq('chat_conversas_visiveis não aceita parâmetro nenhum',
  t.txt($q$select pg_get_function_identity_arguments(p.oid) from pg_proc p
           join pg_namespace n on n.oid = p.pronamespace
          where n.nspname='public' and p.proname='chat_conversas_visiveis'$q$), '');
select t.eq('é SECURITY DEFINER com search_path travado (padrão da casa)',
  t.txt($q$select p.prosecdef::text || '/' || coalesce(array_to_string(p.proconfig, ','), 'SEM search_path')
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname='public' and p.proname='chat_conversas_visiveis'$q$), 'true/search_path=""');

select t.como_anon();
select t.throws('anônimo não executa chat_conversas_visiveis',
  'select public.chat_conversas_visiveis()', 'permission denied');
reset role;

-- A função é honesta: o que ela devolve é exatamente o que a pessoa enxerga nas conversas.
-- Se um dia divergir, a policy passa a autorizar mais (ou menos) do que a matriz diz.
select t.como('membro_a');
select t.eq('para o membro A, o conjunto tem o mesmo tamanho do que ele lê em chat_conversas',
  t.n('select count(*) from public.chat_conversas_visiveis()'),
  t.n('select count(*) from public.chat_conversas'));
select t.como('lider_b');
select t.eq('para o líder B, idem — e são conversas de outro clube',
  t.n('select count(*) from public.chat_conversas_visiveis()'),
  t.n('select count(*) from public.chat_conversas'));
select t.eq('o líder B não alcança nenhuma conversa do clube A pelo conjunto',
  t.n($q$select count(*) from public.chat_conversas_visiveis() v
           join public.chat_conversas c on c.id = v
          where c.club_id = (select id from t.ids where chave='clube_a')$q$), 0);
reset role;

-- Quem não tem vínculo nenhum recebe conjunto vazio — não erro, não "tudo".
select t.signup('sem_clube_46', '{"nome":"Sem Clube"}'::jsonb);
select t.como('sem_clube_46');
select t.eq('pessoa sem vínculo: conjunto vazio', t.n('select count(*) from public.chat_conversas_visiveis()'), 0);
select t.eq('...e nenhuma mensagem', t.n('select count(*) from public.chat_mensagens'), 0);
reset role;

select t.fim();
rollback;
