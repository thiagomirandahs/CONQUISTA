-- =============================================================================
--  Fase 8.2 — o CONTRATO das funções que atravessavam tenant (migration 56).
--
--  A Fase 8 listou seis `security definer` que aceitam UUID arbitrário e chamou o problema de
--  "vazamento de baixo valor + oráculo de existência". O red-team desta fase atacou cada uma no
--  banco, com SQL executado, e refutou essa classificação em TODAS — severidade de média a alta.
--  E encontrou uma sétima que a lista não tinha.
--
--  Este arquivo é a resposta ao "não aceite apenas 'é necessário para o sistema'": cada uma tem
--  aqui o seu contrato, e o contrato é executável.
--
--  As duas formas de fechar:
--    · sem chamador no app  -> sai da superfície da API (continua servindo às funções internas)
--    · com chamador no app  -> fechada pelo CLUBE DA REQUISIÇÃO, não por "algum vínculo"
--
--  E o invariante que vale para as duas: a resposta para um alvo de OUTRO clube tem de ser
--  indistinguível da resposta para um uuid que não existe. Nem valor, nem erro, nem código.
-- =============================================================================
begin;
\ir _lib.sql
\ir _fixtures.sql

\o /dev/null
alter default privileges in schema t grant select on tables to public;
-- 'sem_vinculo' é o pior caso de chamador: conta real, logada, sem pertencer a clube nenhum.
select t.signup('sem_vinculo', '{"nome":"Sem Vinculo"}'::jsonb);
insert into t.ids (chave, id) values ('uuid_fantasma', '11111111-2222-3333-4444-555555555555');

-- Sonda no estilo do teste 24: devolve 'R:<valor>' ou 'E:<sqlstate>' — é o que permite comparar
-- DUAS respostas sem que a forma da falha entregue a diferença.
create function t.sonda(p_sql text) returns text language plpgsql as $$
declare v text;
begin execute p_sql into v; return 'R:' || coalesce(v, 'nulo');
exception when others then return 'E:' || sqlstate; end $$;
\o

-- =============================================================================
--  (A) As quatro que saíram da superfície da API
-- =============================================================================
-- O contrato é o ESTADO FINAL do ACL, não a existência da migration 56. Isso importa: os grants
-- nasceram no lote 20260921 e o teste 09 reaplica esse lote — um `revoke` isolado poderia ser
-- desfeito sem ninguém notar. Conferindo o estado, uma reaplicação futura quebra este assert.
select t.eq('dependencias_pendentes saiu da API',
  has_function_privilege('authenticated', 'public.dependencias_pendentes(text,uuid,uuid,uuid)', 'execute'), false);
select t.eq('especialidade_ja_concluida_pela_pessoa saiu da API',
  has_function_privilege('authenticated', 'public.especialidade_ja_concluida_pela_pessoa(uuid,uuid)', 'execute'), false);
select t.eq('unidade_ancestral saiu da API',
  has_function_privilege('authenticated', 'public.unidade_ancestral(uuid,text)', 'execute'), false);
select t.eq('_experiencia_no_publico saiu da API',
  has_function_privilege('authenticated', 'public._experiencia_no_publico(uuid,uuid)', 'execute'), false);
select t.eq('...e nenhuma delas voltou por anon',
  t.n($q$select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public'
         and p.proname in ('dependencias_pendentes','especialidade_ja_concluida_pela_pessoa',
                           'unidade_ancestral','_experiencia_no_publico')
         and has_function_privilege('anon', p.oid, 'execute')$q$), 0);

-- E o que elas entregavam, do ponto de vista de quem atacava.
select t.como('membro_b');   -- desbravador MENOR do clube B
select t.pedir_clube('clube_b');
select t.throws('membro do clube B não pergunta mais pela conquista curricular de uma criança do clube A',
  $q$select public.especialidade_ja_concluida_pela_pessoa(
       (select id from t.ids where chave='membro_a'), '00000000-0000-4000-a000-000000000102'::uuid)$q$,
  'permission denied');
select t.throws('...nem mapeia a árvore organizacional do outro clube',
  $q$select public.unidade_ancestral((select id from t.ids where chave='clube_a'), 'distrito')$q$,
  'permission denied');
select t.throws('...nem nomeia itens de currículo que a RLS esconde dele',
  $q$select public.dependencias_pendentes('specialty', '00000000-0000-4000-a000-000000000102'::uuid,
       (select id from t.ids where chave='membro_a'), (select id from t.ids where chave='clube_a'))$q$,
  'permission denied');
reset role;

-- O papel de MENOR privilégio do produto, e a conta sem clube nenhum: as duas portas fechadas.
select t.como('pais_a');
select t.throws('responsável não lê conquista curricular de ninguém por esta via',
  $q$select public.especialidade_ja_concluida_pela_pessoa(
       (select id from t.ids where chave='membro_b'), '00000000-0000-4000-a000-000000000102'::uuid)$q$,
  'permission denied');
select t.como('sem_vinculo');
select t.throws('conta sem vínculo nenhum também não',
  $q$select public.especialidade_ja_concluida_pela_pessoa(
       (select id from t.ids where chave='membro_a'), '00000000-0000-4000-a000-000000000102'::uuid)$q$,
  'permission denied');
select t.throws('...e nem confirma terceiros pelo público de uma experiência',
  $q$select public._experiencia_no_publico(gen_random_uuid(), (select id from t.ids where chave='membro_a'))$q$,
  'permission denied');
reset role;

-- A regra NÃO foi para o frontend: continua no servidor, dentro das fachadas que o app usa.
select t.ok('as fachadas que o app chama continuam existindo e usando a regra',
  t.n($q$select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname <> 'dependencias_pendentes'
         and p.prosrc like '%dependencias_pendentes%'$q$) >= 5);
-- (especialidades são recurso que SÓ a plataforma liga desde a migration 83: liga aqui como o SQL
-- Editor faria, numa sessão sem usuário, para provar que a fachada continua servindo)
select t.como_cron();
insert into public.club_features (club_id, feature, enabled) values ((select id from t.ids where chave = 'clube_a'), 'especialidades', true)
on conflict (club_id, feature) do update set enabled = true;
select t.como('membro_a');
select t.pedir_clube('clube_a');
select t.permitido('e a tela de especialidades continua funcionando pela fachada',
  $q$select public.especialidades_disponiveis()$q$, 0);
reset role;

-- =============================================================================
--  (B) leilao_saldo_unidade e pontos_temporada_unidade — fechadas pelo clube DA REQUISIÇÃO
-- =============================================================================
\o /dev/null
-- A1 é unidade do clube A; B1 é do clube B. `instrutor_2clubes` tem vínculo ativo nos DOIS —
-- é a pessoa que provava o furo: com header do clube A, lia a unidade do clube B.
insert into public.club_features (club_id, feature, enabled)
values (t.id('clube_a'), 'leilao', true), (t.id('clube_b'), 'leilao', true)
on conflict (club_id, feature) do update set enabled = true;
insert into public.pontos (unidade_id, origem, pontos, motivo, club_id)
values (t.id('B1'), 'unidade', 777, 'saldo do clube B', t.id('clube_b'));
\o

select t.como('instrutor_2clubes');
select t.pedir_clube('clube_a');
select t.ok('na aba do clube A, a pessoa lê a unidade DO CLUBE A',
  t.n($q$select public.pontos_temporada_unidade((select id from t.ids where chave='A1'))$q$) >= 0);
select t.eq('...e NÃO lê a unidade do clube B, mesmo tendo vínculo ativo lá',
  t.txt($q$select public.pontos_temporada_unidade((select id from t.ids where chave='B1'))::text$q$), '0');
select t.eq('...nem o saldo de leilão dela',
  t.txt($q$select public.leilao_saldo_unidade((select id from t.ids where chave='B1'))::text$q$), '0');

-- Trocar de aba é o caminho legítimo — e aí sim o acesso existe. Isso prova que o gate é o clube
-- DA REQUISIÇÃO, e não uma proibição cega que quebraria o multiclube.
select t.pedir_clube('clube_b');
select t.ok('trocando para a aba do clube B, a MESMA pessoa passa a ler a unidade B1',
  t.n($q$select public.pontos_temporada_unidade((select id from t.ids where chave='B1'))$q$) > 0);
reset role;

-- O INVARIANTE DE ORÁCULO: alvo de outro clube e uuid inexistente têm de ser indistinguíveis.
-- Era aqui que a função antiga vazava por ERRO: a soma rodava fora do gate, então uma unidade
-- real sobre-reservada levantava 22003 e um uuid aleatório devolvia 0.
select t.como('membro_a');
select t.pedir_clube('clube_a');
select t.eq('unidade de outro clube e uuid inexistente respondem IGUAL (saldo de leilão)',
  t.txt($q$select t.sonda('select public.leilao_saldo_unidade(''' || (select id from t.ids where chave='B1') || ''')')$q$),
  t.txt($q$select t.sonda('select public.leilao_saldo_unidade(''' || (select id from t.ids where chave='uuid_fantasma') || ''')')$q$));
select t.eq('...e também nos pontos da temporada',
  t.txt($q$select t.sonda('select public.pontos_temporada_unidade(''' || (select id from t.ids where chave='B1') || ''')')$q$),
  t.txt($q$select t.sonda('select public.pontos_temporada_unidade(''' || (select id from t.ids where chave='uuid_fantasma') || ''')')$q$));
reset role;

-- E o mesmo invariante SOB SOBRE-RESERVA, que é o estado em que a versão antiga levantava erro.
\o /dev/null
do $$
declare v_leilao uuid; v_item uuid; v_lance uuid;
begin
  insert into public.leiloes (club_id, titulo, status, criado_por)
  values (t.id('clube_b'), 'Leilao B', 'aberto', t.id('lider_b')) returning id into v_leilao;
  insert into public.leilao_itens (leilao_id, titulo, club_id)
  values (v_leilao, 'Item B', t.id('clube_b')) returning id into v_item;
  insert into public.leilao_lances (item_id, criado_por, valor, status, club_id)
  values (v_item, t.id('membro_b'), 2000000000, 'ativo', t.id('clube_b')) returning id into v_lance;
  insert into public.leilao_lance_unidades (lance_id, unidade_id, confirmado, club_id)
  values (v_lance, t.id('B1'), true, t.id('clube_b'));
exception when others then raise notice '[51] cenario de sobre-reserva nao montado: %', sqlerrm;
end $$;
\o
select t.como('membro_a');
select t.pedir_clube('clube_a');
select t.eq('com a unidade alheia SOBRE-RESERVADA, a resposta continua indistinguível de uuid inexistente',
  t.txt($q$select t.sonda('select public.leilao_saldo_unidade(''' || (select id from t.ids where chave='B1') || ''')')$q$),
  t.txt($q$select t.sonda('select public.leilao_saldo_unidade(''' || (select id from t.ids where chave='uuid_fantasma') || ''')')$q$));
reset role;

-- O ENTITLEMENT: com o recurso desligado, a RLS mostra zero e a função tem de concordar.
-- Antes ela devolvia o saldo mesmo assim — um bypass das três camadas da fase 5.
\o /dev/null
update public.club_features set enabled = false where club_id = t.id('clube_a') and feature = 'leilao';
\o
select t.como('membro_a');
select t.pedir_clube('clube_a');
select t.eq('recurso "leilao" desligado no clube: o saldo responde 0, como a RLS',
  t.txt($q$select public.leilao_saldo_unidade((select id from t.ids where chave='A1'))::text$q$), '0');
select t.eq('...e a RLS realmente não mostra nada (o controle da comparação)',
  t.nv('select count(*) from public.leiloes'), 0);
reset role;
\o /dev/null
update public.club_features set enabled = true where club_id = t.id('clube_a') and feature = 'leilao';
\o

-- Quem não tem vínculo nenhum não lê nada, em nenhuma das duas.
select t.como('sem_vinculo');
select t.eq('conta sem vínculo: saldo de leilão = 0',
  t.txt($q$select public.leilao_saldo_unidade((select id from t.ids where chave='A1'))::text$q$), '0');
select t.eq('conta sem vínculo: pontos da temporada = 0',
  t.txt($q$select public.pontos_temporada_unidade((select id from t.ids where chave='A1'))::text$q$), '0');
select t.como('pais_a');
select t.pedir_clube('clube_a');
select t.eq('responsável (menor privilégio) também não lê saldo de unidade',
  t.txt($q$select public.leilao_saldo_unidade((select id from t.ids where chave='A1'))::text$q$), '0');
reset role;

-- =============================================================================
--  (C) A varredura: nenhuma OUTRA função ficou aceitando uuid arbitrário sem gate
-- =============================================================================
-- A lista da fase 8 tinha seis nomes e faltava `pontos_temporada_unidade` — ela "parecia" segura
-- porque TEM um gate; o gate é que não era o certo (perguntava "você é de algum clube?" em vez de
-- "você é DESTE clube, nesta requisição?"). Este assert não deixa a lista envelhecer: toda função
-- concedida a `authenticated` que receba `uuid` e seja SECURITY DEFINER precisa citar
-- `clube_atual_id()`, `auth.uid()` ou uma das funções de autorização do projeto.
select t.eq('toda RPC security definer aberta a authenticated que recebe uuid tem gate de autorização',
  t.n($q$
    select count(*) from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.prosecdef
       and has_function_privilege('authenticated', p.oid, 'execute')
       and pg_get_function_identity_arguments(p.oid) like '%uuid%'
       and p.prosrc !~ 'clube_atual_id|auth\.uid|escopo_atual_id|pode_gerir_no_clube|membro_ativo_no_clube|eh_admin_plataforma|_exigir_|compartilha_clube_com|_pode_ver'
       -- ------------------------------------------------------------------
       -- EXCEÇÕES DECLARADAS. Cada uma com o motivo, porque lista de exceção sem motivo é
       -- onde problema se esconde. Acrescentar um nome aqui é uma decisão, não um detalhe.
       -- ------------------------------------------------------------------
       and p.proname not in (
         -- superfície ANÔNIMA por desenho: verificação pública de documento, com token de 100
         -- bits, e o catálogo de recursos que o app oferece (o mesmo para todo clube)
         'documento_verificar', 'recursos_catalogo_listar',
         -- o gate existe, só está um nível abaixo: ela delega a chat_conversas_visiveis(), que
         -- usa auth.uid(). A regex não enxerga delegação; a matriz de acesso do chat (teste 45,
         -- 62 asserts) é que prova o comportamento.
         'chat_pode_ver',
         -- CATÁLOGO DA PLATAFORMA: currículo oficial versionado. A resposta é a mesma para todo
         -- clube e não contém dado de tenant nenhum — "esta classe está publicada?" e "o que
         -- mudou entre a v1 e a v2?" não dependem de quem pergunta. Revogá-las foi tentado nesta
         -- fase e derrubou nove arquivos de teste: são API documentada (33, 34, 37, 38, 39).
         'classe_esta_publicada', 'especialidade_esta_publicada',
         'comparar_versoes_curriculares', 'requisito_origem'
       )
  $q$), 0);

select t.fim();
rollback;
