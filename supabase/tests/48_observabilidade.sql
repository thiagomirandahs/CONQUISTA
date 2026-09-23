-- =============================================================================
--  Fase 8.1 — observabilidade mínima (blocker B7, migration 53).
--
--  Um sistema de telemetria é, por construção, um lugar onde dados de pessoas se acumulam. Num
--  produto cujo público é majoritariamente menor de idade, o teste mais importante não é "grava?"
--  e sim "NÃO grava o que não devia, e quem não devia NÃO lê?".
--
--  Por isso a maior parte dos asserts aqui é negativa:
--    - a tabela não tem nenhuma coluna capaz de carregar conteúdo (mensagem, foto, evidência);
--    - o cliente não escolhe de quem é o erro — user_id e club_id vêm do servidor;
--    - a diretoria do clube NÃO lê a telemetria (é operação da plataforma, papel separado);
--    - ninguém escreve direto na tabela, só pela função;
--    - existe teto por sessão, para um laço quebrado não virar um milhão de linhas.
-- =============================================================================
begin;
\ir _lib.sql
\ir _fixtures.sql

-- =============================================================================
--  1. A forma da tabela: o que ela é CAPAZ de guardar
-- =============================================================================
-- Se um dia alguém acrescentar uma coluna `mensagem` ou `payload`, este assert quebra — que é
-- exatamente a conversa que se quer ter antes de aceitar uma coluna dessas.
select t.eq('app_erros tem só as colunas previstas (nada de mensagem/payload/conteúdo)',
  t.txt($q$select string_agg(column_name, ',' order by column_name) from information_schema.columns
           where table_schema='public' and table_name='app_erros'$q$),
  'agente,club_id,codigo,contexto,correlacao,id,origem,quando,rota,user_id');

-- =============================================================================
--  2. Quem escreve
-- =============================================================================
select t.como('membro_a');
select t.pedir_clube('clube_a');
select t.throws('ninguém escreve direto na tabela (nem quem está logado)',
  $q$insert into public.app_erros (origem, correlacao) values ('ui', 'abcdefgh1234')$q$,
  'permission denied');
select t.permitido('...a escrita é pela função, e ela funciona',
  $q$select public.registrar_erro('ui', 'correlacao-teste-01', '/avaliar/123', 'Não consegui salvar.', 'PGRST204', 'Mozilla/5.0')$q$, 0);
reset role;
select t.eq('a linha entrou', t.n($q$select count(*) from public.app_erros where correlacao='correlacao-teste-01'$q$), 1);

-- O ponto central: o cliente NÃO diz de quem é o erro. Mesmo que quisesse, não há parâmetro —
-- o servidor preenche a partir do JWT e do header de clube.
select t.eq('a função não aceita user_id nem club_id como parâmetro',
  t.txt($q$select pg_get_function_identity_arguments(p.oid) from pg_proc p
           join pg_namespace n on n.oid=p.pronamespace
          where n.nspname='public' and p.proname='registrar_erro'$q$),
  'p_origem text, p_correlacao text, p_rota text, p_contexto text, p_codigo text, p_agente text');
select t.eq('o user_id gravado é o de quem chamou, vindo do JWT',
  t.txt($q$select (user_id = (select id from t.ids where chave='membro_a'))::text
           from public.app_erros where correlacao='correlacao-teste-01'$q$), 'true');
select t.eq('o club_id gravado é o clube em uso na requisição, vindo do header',
  t.txt($q$select (club_id = (select id from t.ids where chave='clube_a'))::text
           from public.app_erros where correlacao='correlacao-teste-01'$q$), 'true');

-- =============================================================================
--  3. O que a função corta
-- =============================================================================
select t.como('membro_a');
-- querystring é onde token costuma andar: some antes de gravar.
select t.permitido('grava uma rota com querystring',
  $q$select public.registrar_erro('ui', 'correlacao-teste-02', '/entrar?token=SEGREDO&x=1', 'ctx', 'X', 'ua')$q$, 0);
reset role;
select t.eq('a querystring foi descartada — o token não entrou no banco',
  t.txt($q$select rota from public.app_erros where correlacao='correlacao-teste-02'$q$), '/entrar');
select t.eq('...e o segredo não aparece em NENHUMA coluna de NENHUMA linha',
  t.n($q$select count(*) from public.app_erros e where e::text like '%SEGREDO%'$q$), 0);

-- Origem fora do vocabulário é recusada em silêncio: a tabela não vira depósito de qualquer coisa.
select t.como('membro_a');
select t.permitido('origem inválida não lança, mas também não grava',
  $q$select public.registrar_erro('qualquer-coisa', 'correlacao-teste-03', '/x', 'c', 'X', 'ua')$q$, 0);
select t.permitido('correlação curta demais idem (não dá pra poluir com id de 1 caractere)',
  $q$select public.registrar_erro('ui', 'abc', '/x', 'c', 'X', 'ua')$q$, 0);
reset role;
select t.eq('nenhuma das duas entrou',
  t.n($q$select count(*) from public.app_erros where correlacao in ('correlacao-teste-03','abc')$q$), 0);

-- Textos longos são truncados, não recusados: perder o registro seria pior que cortá-lo.
select t.como('membro_a');
select t.permitido('texto gigante é aceito',
  $q$select public.registrar_erro('ui', 'correlacao-teste-04', repeat('a', 500), repeat('b', 500), repeat('c', 500), repeat('d', 500))$q$, 0);
reset role;
select t.eq('...e truncado nos limites declarados (rota 120, contexto 200, código 80, agente 120)',
  t.txt($q$select length(rota)||'/'||length(contexto)||'/'||length(codigo)||'/'||length(agente)
           from public.app_erros where correlacao='correlacao-teste-04'$q$), '120/200/80/120');

-- =============================================================================
--  4. O teto por sessão
-- =============================================================================
-- Um laço de render quebrado poderia escrever sem parar a partir do navegador — o que seria, por
-- si só, um jeito de derrubar o banco de fora. O teto é a defesa.
select t.como('membro_a');
select t.permitido('dispara 30 erros na mesma correlação',
  $q$do $do$ begin for i in 1..30 loop perform public.registrar_erro('ui', 'correlacao-teto-xx', '/x', 'c', 'E', 'ua'); end loop; end $do$$q$, 0);
reset role;
select t.eq('gravou no máximo 20 — o resto foi descartado em silêncio',
  t.n($q$select count(*) from public.app_erros where correlacao='correlacao-teto-xx'$q$), 20);

-- =============================================================================
--  5. Quem LÊ — a parte que mais importa
-- =============================================================================
-- Telemetria é operação da plataforma (fase 5), papel deliberadamente separado das diretorias.
-- A diretoria de um clube não precisa, e não deve, ler o erro que aconteceu com outra pessoa.
select t.como('membro_a');
select t.eq('quem gerou o erro não lê a tabela', t.nv('select count(*) from public.app_erros'), 0);
select t.como('lider_a');
select t.eq('a DIRETORIA do clube não lê a telemetria', t.nv('select count(*) from public.app_erros'), 0);
select t.eq('...nem as falhas de infraestrutura', t.nv('select count(*) from public.infra_falhas'), 0);
-- O painel não lança: ele devolve VAZIO. A checagem está no `where` da função, então quem não é
-- da operação simplesmente não encontra linha nenhuma. Falha fechada, e sem revelar pela mensagem
-- de erro que existe um painel — o que já seria uma informação.
select t.eq('o painel de erros devolve vazio para quem não é da operação',
  t.nv('select count(*) from public.painel_erros(24)'), 0);
reset role;

-- Já a operação da plataforma lê — é para isso que existe.
\o /dev/null
insert into public.platform_admins (user_id, papel) values (t.id('lider_b'), 'suporte')
  on conflict do nothing;
\o
select t.como('lider_b');
select t.ok('a operação da plataforma lê os erros', t.nv('select count(*) from public.app_erros') > 0);
select t.ok('...e o painel agrupa por rota/contexto/código', t.nv('select count(*) from public.painel_erros(24)') > 0);
select t.eq('o painel responde a primeira pergunta de um relato: quantas pessoas isso atingiu?',
  t.txt($q$select (pessoas >= 1)::text from public.painel_erros(24) order by ocorrencias desc limit 1$q$), 'true');
reset role;

-- =============================================================================
--  6. Retenção
-- =============================================================================
select t.eq('existe expurgo agendado (telemetria não é acervo)',
  t.n($q$select count(*) from cron.job where jobname = 'expurgar-app-erros'$q$), 1);
\o /dev/null
update public.app_erros set quando = now() - interval '120 days' where correlacao = 'correlacao-teste-01';
select public.expurgar_app_erros();
\o
select t.eq('o expurgo apaga o que passou de 90 dias',
  t.n($q$select count(*) from public.app_erros where correlacao='correlacao-teste-01'$q$), 0);
select t.ok('...e não toca no que é recente',
  t.n($q$select count(*) from public.app_erros where correlacao='correlacao-teste-04'$q$) = 1);

select t.fim();
rollback;
