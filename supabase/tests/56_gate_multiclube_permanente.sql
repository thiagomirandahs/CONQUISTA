-- =============================================================================
--  Fase 8.5 — O GATE MULTI-CLUBE PERMANENTE.
--
--  A fase 8.4 corrigiu quatro BLOCKERs e travou cada um com um teste do defeito específico. Isso
--  protege contra a volta daquele defeito e não protege contra o próximo, que virá pela mesma
--  porta com outro nome — e veio: ao atacar as superfícies que a 8.4 declarou fechadas, apareceram
--  `salvar_reuniao` destruindo ponto de outro clube e quatro tabelas de leilão vazando entre abas.
--
--  Este arquivo é a diferença entre "o defeito X não voltou" e "esta CLASSE de defeito não passa".
--  Ele não sabe o nome de nenhuma função corrigida. Ele conhece três coisas:
--
--    1. QUAIS superfícies são operacionais por clube e quais atravessam de propósito — escrito,
--       completo, e conferido contra o banco (item 6);
--    2. que toda leitura de superfície operacional tem de estar presa à ABA — estruturalmente, no
--       catálogo, não por amostragem;
--    3. UMA invariante para mutação, que dispensa enumerar expectativa caso a caso:
--
--         nenhuma chamada pode alterar linha de um clube que não seja o da requisição.
--
--       Com ela, 7 identidades × 4 contextos × N mutações são cobertas por uma regra só — e uma
--       mutação nova entra na matriz sem que ninguém precise decidir "o que deveria acontecer".
--
--  TRÊS ERROS DE MÉTODO que este arquivo corrige, todos descobertos atacando o teste 55:
--
--    · A varredura de leitura da 55 roda na seção 1; os leilões só nascem na seção 4. Quando ela
--      passou, as tabelas estavam VAZIAS — "nada vazou" e "não havia nada para vazar" tinham a
--      mesma cara. Aqui a varredura roda DEPOIS de tudo, e cada tabela precisa provar que tinha
--      linha no clube alvo, senão o zero não conta.
--    · A varredura de leitura da 55 só junta por `club_id`; conquista portátil e snapshot usam
--      `club_id_origem` e nunca foram varridos para leitura. Aqui as duas colunas entram.
--    · `t.ve` e `t.nv` transformam ERRO em 0. Num gate dirigido por medição, erro de medição fica
--      idêntico a "não vi nada". Aqui a medição do estado roda FORA da RLS e sem ramo de exceção
--      silencioso: se ela falhar, o teste quebra em vez de mentir.
-- =============================================================================
begin;
\ir _lib.sql
\ir _fixtures.sql

\o /dev/null
alter default privileges in schema t grant select on tables to public;

-- Um terceiro clube. Com dois, "o outro clube" e "o clube que não é o meu" são a mesma coisa, e
-- toda lógica acidentalmente binária passa.
insert into public.organizational_units (nome, slug, type, timezone)
values ('Clube C do Gate', 'gate-c', 'clube', 'America/Recife');
insert into t.ids (chave, id) select 'clube_c', id from public.organizational_units where slug = 'gate-c';
insert into public.unidades (nome, cor, club_id) values ('Unidade C', '#0ea5e9', t.id('clube_c'));
insert into t.ids (chave, id) select 'C1', id from public.unidades where nome = 'Unidade C';
select t.mk('lider_c', 'Lider C', 'diretoria', 'ativo', 'clube_c', 'C1');
select t.mk('membro_c', 'Membro C', 'desbravador', 'ativo', 'clube_c', 'C1');
-- O leilao precisa estar LIGADO nos tres para que a varredura tenha o que medir. E ele e a
-- superficie que a fase 8.4 declarou fechada sem estar: se ficasse desligado aqui, o gate
-- repetiria o erro que veio corrigir — medir uma tabela vazia e chamar isso de isolamento.
insert into public.club_features (club_id, feature, enabled)
select c.id, f.feature, true
  from (values (t.id('clube_a')), (t.id('clube_b')), (t.id('clube_c'))) c(id)
  cross join (values ('leilao')) f(feature)
on conflict (club_id, feature) do update set enabled = true;
\o


-- =============================================================================
--  0. A CLASSIFICAÇÃO — item 6, escrita e completa
--
--  Duas classes, e a fronteira entre elas é a coisa mais importante deste arquivo:
--
--    OPERACIONAL   o dia a dia de UM clube. Só se lê e só se escreve pela aba daquele clube.
--    ATRAVESSA     existe para atravessar, e cada uma tem um motivo nomeado aqui.
--
--  POR QUE ESTA TABELA PRECISA EXISTIR: a exceção curricular — conquista e snapshot portáteis —
--  hoje escapa do escopo por aba por ACIDENTE. A migration 62 reescreveu as policies cujo texto
--  casava com um regex; as curriculares não casaram porque delegam a
--  `_pode_ver_conquista_curricular()` e nem citam `club_id`. A exceção mais importante do produto
--  é hoje subproduto de uma expressão regular, e não existe registrada em lugar nenhum.
--  A partir daqui, existe — e o assert de completude impede que a próxima tabela entre sem decisão.
-- =============================================================================
\o /dev/null
create table t.superficie (tabela text primary key, classe text not null, porque text not null);

insert into t.superficie (tabela, classe, porque) values
  -- ----- ATRAVESSA de propósito -----
  ('curriculum_achievements',      'atravessa', 'a conquista é DA PESSOA e viaja com ela entre clubes'),
  ('class_completion_snapshots',   'atravessa', 'o certificado selado da classe, verificável fora do clube emissor'),
  ('class_investitures',           'atravessa', 'o registro da investidura acompanha a conquista'),
  ('class_documents',             'atravessa', 'documento emitido, conferível publicamente por token'),
  ('document_signatures',          'atravessa', 'assinatura do documento emitido'),
  ('investiture_workflow_runs',    'atravessa', 'a corrida de aprovação pode subir para distrito/região'),
  ('workflow_stage_decisions',     'atravessa', 'as decisões dessa corrida, idem'),
  ('subscription_clubs',           'atravessa', 'o contato comercial paga por VÁRIOS clubes e precisa ver todos'),
  ('club_provisioning_status',     'atravessa', 'fila de provisionamento: é operação da plataforma, entre clubes'),
  ('support_grants',               'atravessa', 'acesso assistido: a autorização é por clube, a lista é da operação'),
  ('club_team_invites',            'atravessa', 'a pessoa precisa ver um convite de um clube em que AINDA NÃO está'),
  -- ----- OPERAÇÃO DA PLATAFORMA: existem para olhar VÁRIOS clubes de uma vez -----
  ('alertas',                      'atravessa', 'canal de alerta da operação: um incidente é entre clubes'),
  ('alerta_entregas',              'atravessa', 'as entregas desses alertas, pelo mesmo motivo do canal'),
  ('app_erros',                    'atravessa', 'observabilidade: investigar relato de cliente é entre clubes'),
  ('infra_falhas',                 'atravessa', 'falhas de infraestrutura não pertencem a um clube'),
  ('push_eventos',                 'atravessa', 'a fila de push é da plataforma'),
  ('push_evento_destinatarios',    'atravessa', 'o casamento evento-destinatário da fila de push, idem'),
  ('push_tentativas',              'atravessa', 'cada tentativa de entrega da fila de push, idem'),
  ('push_destinatarios',           'atravessa', 'os destinatários resolvidos de um evento de push, idem'),
  ('onboarding_sessions',          'atravessa', 'a sessão de onboarding é da PESSOA, e nasce antes de o clube existir');

-- Todo o resto que carrega clube é operacional. A lista sai do catálogo, não da minha memória:
-- assim, uma tabela nova entra classificada por padrão no lado restrito, que é o lado seguro.
insert into t.superficie (tabela, classe, porque)
select c.relname, 'operacional', 'padrão: carrega clube e não está na lista de exceções'
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
 where c.relkind = 'r'
   and exists (select 1 from pg_attribute a
                where a.attrelid = c.oid and not a.attisdropped
                  and a.attname in ('club_id', 'club_id_origem'))
   and not exists (select 1 from t.superficie s where s.tabela = c.relname);
grant select on t.superficie to public;
\o

select t.ok('a classificação cobre TODA tabela que carrega clube (nenhuma fica sem decisão)',
  t.n($q$select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace and n.nspname='public'
       where c.relkind='r'
         and exists (select 1 from pg_attribute a where a.attrelid=c.oid and not a.attisdropped
                      and a.attname in ('club_id','club_id_origem'))
         and not exists (select 1 from t.superficie s where s.tabela = c.relname)$q$) = 0);
select t.ok('...e são muitas, não um punhado (a varredura não está passando no vazio)',
  t.n($q$select count(*) from t.superficie$q$) > 30);
-- O número é um assert de propósito: acrescentar uma exceção tem de ser uma decisão visível num
-- diff, não algo que acontece sozinho quando alguém cria uma tabela.
select t.eq('as exceções que atravessam são exatamente as 20 declaradas, uma a uma',
  t.n($q$select count(*) from t.superficie where classe = 'atravessa'$q$), 20);
select t.ok('...e cada uma tem um porquê escrito',
  t.n($q$select count(*) from t.superficie where classe = 'atravessa' and length(porque) < 25$q$) = 0);


-- =============================================================================
--  1. ESTRUTURAL — a leitura operacional está presa à ABA, no catálogo
--
--  Este é o assert que faltava para a correção da fase 8.4 ser DURÁVEL.
--
--  A migration 62 escopou 58 policies com um bloco `do $$` que varreu `pg_policies` e reescreveu
--  cada uma. Funcionou — e rodou uma vez só. O escopo por aba não existe no fonte de migration
--  nenhuma: ele só existe no estado do banco. Qualquer migration futura que faça
--  `drop policy … ; create policy …` numa dessas tabelas desfaz tudo em silêncio, e nenhum teste
--  comportamental pega, porque testes comportamentais cobrem os casos que alguém lembrou de
--  escrever.
--
--  Aqui a exigência é estrutural: para toda tabela OPERACIONAL, toda policy de leitura tem de
--  chegar em `clube_atual_id()` — direto no predicado, ou pela função a que ela delega.
-- =============================================================================
\o /dev/null
-- Resolve um nível de indireção: a policy do chat não cita `club_id`, ela chama
-- `chat_conversas_visiveis()`. Sem seguir a chamada, a varredura acusaria falso positivo nela e
-- nas de experiência e leilão — que é como essas três escaparam da migration 62.
create function t.alcanca_a_aba(p_qual text) returns boolean language plpgsql stable as $$
declare r record;
begin
  if p_qual is null then return true; end if;                    -- sem predicado: não é leitura aberta
  if p_qual like '%clube_atual_id%' then return true; end if;
  for r in
    select p.proname, pg_get_functiondef(p.oid) as corpo
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
  loop
    if p_qual like '%' || r.proname || '(%' and r.corpo like '%clube_atual_id%' then return true; end if;
  end loop;
  return false;
end $$;
\o

-- Só o papel `authenticated`. Para `anon` a exigência não faria sentido nem seria segura: quem não
-- entrou não tem vínculo, `clube_atual_id()` devolve nulo, e uma policy escopada por aba seria
-- sempre falsa. A superfície anônima é outra pergunta, e tem o seu próprio assert logo abaixo.
select t.eq('toda policy de LEITURA de superfície operacional chega ao clube da requisição',
  t.txt($q$select coalesce(string_agg(x.rotulo, ' ' order by x.rotulo), '')
             from (select distinct p.tablename || '.' || p.policyname as rotulo
                     from pg_policies p
                     join t.superficie s on s.tabela = p.tablename and s.classe = 'operacional'
                    where p.schemaname = 'public' and p.cmd in ('SELECT', 'ALL')
                      and 'authenticated' = any (p.roles)
                      and not t.alcanca_a_aba(p.qual)) x$q$), '');

-- ---------------------------------------------------------------------------
--  A SUPERFÍCIE ANÔNIMA — pequena, listada, e nenhuma entra sem decisão.
--
--  Hoje ela tem um item só, e ele é um achado que fica registrado aqui em vez de ser corrigido às
--  escondidas: `unidades` é legível por `anon` quando `club_id = clube_legado_id()`, para a tela de
--  cadastro montar o seletor de unidade (src/pages/Cadastro.jsx:32). Consequências, medidas:
--
--    · quem abre o cadastro de QUALQUER clube recebe a lista de unidades do Tenant 001;
--    · e, como o cadastro manda essa `unidade_id` para `handle_new_user`, o autocadastro só
--      consegue criar vínculo NAQUELE clube. Um clube novo não tem caminho de autocadastro — a
--      entrada dele é por convite.
--
--  Isso não é falha de isolamento (nome de unidade não é segredo, e a policy é de um clube só): é
--  a última peça do produto que ainda supõe um clube único, e consertá-la é decidir como o
--  cadastro descobre para qual clube a pessoa está entrando — decisão de produto, não de segurança.
--  O assert existe para que ela não seja esquecida nem acompanhada.
-- ---------------------------------------------------------------------------
select t.eq('a superfície legível por ANÔNIMO é exatamente a declarada',
  t.txt($q$select coalesce(string_agg(p.tablename || '.' || p.policyname, ' ' order by p.tablename), '')
             from pg_policies p
            where p.schemaname = 'public' and 'anon' = any (p.roles)
              and exists (select 1 from pg_attribute a join pg_class c on c.oid = a.attrelid
                            join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
                           where c.relname = p.tablename and a.attname = 'club_id'
                             and not a.attisdropped)$q$),
  'unidades.anon le unidades tenant legado');

select t.ok('...e isso foi medido sobre dezenas de policies, não sobre nenhuma',
  t.n($q$select count(*) from pg_policies p join t.superficie s on s.tabela = p.tablename and s.classe='operacional'
       where p.schemaname='public' and p.cmd in ('SELECT','ALL')$q$) > 40);

-- O contraponto: as que ATRAVESSAM não podem ter sido escopadas por engano — senão a portabilidade
-- curricular morre calada, e o dia em que alguém perceber será quando um pastor de outro clube não
-- conseguir conferir um certificado.
select t.ok('as superfícies que atravessam continuam alcançáveis (a exceção não foi apagada)',
  t.n($q$select count(*) from pg_policies p join t.superficie s on s.tabela = p.tablename and s.classe='atravessa'
       where p.schemaname='public' and p.cmd = 'SELECT' and p.qual like '%clube_atual_id%'$q$) = 0);


-- =============================================================================
--  2. A MATRIZ — 7 identidades × 4 contextos
-- =============================================================================
\o /dev/null
-- As identidades que a fase pede. As seis primeiras já existem nos fixtures; a sétima (vínculo
-- removido com a sessão aberta) é criada durante a corrida, porque é disso que ela trata.
create table t.identidade (chave text primary key, descricao text, ordem int);
insert into t.identidade values
  ('membro_a',          'membro só do A',            1),
  ('membro_b',          'membro só do B',            2),
  ('multi_dois_papeis', 'membro em A+B',             3),
  ('dir_a_membro_b',    'liderança no A, membro no B', 4),
  ('instrutor_2clubes', 'instrutor em A+B',          5),
  ('suspenso_so_b',     'ativo no A, suspenso no B', 6);
grant select on t.identidade to public;

-- Os quatro contextos. 'invalido' é um uuid que não é clube de ninguém; 'nenhum' é a requisição
-- sem header. Desde a migration 63 os dois têm respostas definidas e DIFERENTES entre si — o
-- inválido deixa a requisição sem clube, o ausente cai no clube padrão da pessoa.
create table t.contexto (chave text primary key, ordem int);
insert into t.contexto values ('clube_a', 1), ('clube_b', 2), ('invalido', 3), ('nenhum', 4);
grant select on t.contexto to public;

create function t.aplicar_contexto(p_ctx text) returns void language plpgsql as $$
begin
  if p_ctx = 'nenhum' then perform t.esquecer_clube_pedido();
  elsif p_ctx = 'invalido' then perform t.pedir_clube('11111111-2222-3333-4444-555555555555'::uuid);
  else perform t.pedir_clube(p_ctx);
  end if;
end $$;

-- ---------------------------------------------------------------------------
--  A MEDIÇÃO DO ESTADO — fora da RLS, e sem engolir erro.
--
--  `security definer`, dono postgres: ela enxerga TODAS as linhas de TODOS os clubes. Isso é o
--  ponto. Se a medição rodasse como `authenticated`, uma escrita que caísse no clube errado ficaria
--  invisível para quem mediu — e o gate diria "nenhum efeito" exatamente no caso que ele existe
--  para pegar.
--
--  O digest é por (tabela, clube) e usa o TEXTO das linhas, não a contagem: um UPDATE não muda
--  contagem nenhuma, e alterar a linha de outro clube é tão grave quanto criar uma.
-- ---------------------------------------------------------------------------
create function t.estado_por_clube() returns table (club_id uuid, digest text)
language plpgsql security definer set search_path = '' as $$
declare r record; v_sql text := ''; v_col text;
begin
  for r in
    select s.tabela,
           (select a.attname from pg_attribute a
             join pg_class c on c.oid = a.attrelid
             join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
            where c.relname = s.tabela and a.attname in ('club_id','club_id_origem')
              and not a.attisdropped limit 1) as col
      from t.superficie s
     where s.classe = 'operacional'
     order by s.tabela
  loop
    if r.col is null then continue; end if;
    v_sql := v_sql || format(
      '%s select %L::uuid as cid, %I as c, md5(x::text) as h from public.%I x',
      case when v_sql = '' then '' else ' union all ' end, null, r.col, r.tabela);
  end loop;
  return query execute
    'select q.c, md5(string_agg(q.h, ''|'' order by q.h)) from (' || v_sql || ') q where q.c is not null group by q.c';
end $$;

-- ---------------------------------------------------------------------------
--  A SONDA DE MUTAÇÃO.
--
--  Roda como a identidade ATUAL (não é `security definer`), mede o estado ANTES e DEPOIS da
--  chamada — a medição em si passa por `t.estado_por_clube()`, que é definer e enxerga tudo — e
--  DESFAZ tudo.
--
--  O desfazer e o medir parecem brigar: se a subtransação volta atrás, como ler o efeito? A saída
--  é medir DENTRO dela e carregar o resultado para fora pela própria exceção que provoca o
--  rollback. É o truque que o projeto já usa desde a fase de oráculos de UUID, e aqui ele é o que
--  garante que uma tentativa não contamina a seguinte — indispensável quando a sonda chama
--  `unidade_excluir` ou apaga pontos.
--
--  Devolve a lista de clubes cujo estado MUDOU. A invariante do gate é que essa lista só pode
--  conter o clube da requisição.
-- ---------------------------------------------------------------------------
create function t.mutacao_mexeu_em(p_sql text) returns text language plpgsql as $$
declare v_antes jsonb; v_depois jsonb; v_mudou text;
begin
  select jsonb_object_agg(club_id::text, digest) into v_antes from t.estado_por_clube();
  begin
    execute p_sql;
    select jsonb_object_agg(club_id::text, digest) into v_depois from t.estado_por_clube();
    select coalesce(string_agg(k, ' ' order by k), '') into v_mudou
      from (select key as k from jsonb_each(coalesce(v_depois, '{}'::jsonb))
             where value is distinct from coalesce(v_antes, '{}'::jsonb) -> key
            union
            select key from jsonb_each(coalesce(v_antes, '{}'::jsonb))
             where value is distinct from coalesce(v_depois, '{}'::jsonb) -> key) z;
    -- carrega o resultado para fora e DESFAZ a escrita
    raise exception using errcode = 'ZZ003', message = coalesce(v_mudou, '');
  exception when others then
    if sqlstate = 'ZZ003' then return sqlerrm; end if;
    return '<recusado>';           -- a chamada falhou: nada mudou, e é um desfecho legítimo
  end;
end $$;
\o

-- ---------------------------------------------------------------------------
--  As mutações sondadas. Uma por módulo de peso, escolhidas por onde o efeito no clube errado é
--  observável — e `salvar_reuniao` à frente, porque foi ela que destruiu dado de outro clube.
-- ---------------------------------------------------------------------------
\o /dev/null
create table t.mutacao (nome text primary key, sql text, ordem int);
insert into t.mutacao values
  ('salvar_reuniao', format($m$select public.salvar_reuniao(current_date, 'gate-8.5',
       jsonb_build_array(jsonb_build_object('usuario_id', %L, 'pontos', 7)))$m$, t.id('membro_a')), 1),
  ('unidade_excluir', format($m$select public.unidade_excluir(%L)$m$, t.id('A1')), 2),
  ('ponto_direto', format($m$insert into public.pontos (usuario_id, origem, pontos, motivo, club_id)
       values (%L, 'manual', 5, 'gate-8.5', %L)$m$, t.id('membro_a'), t.id('clube_a')), 3),
  ('evento_direto', format($m$insert into public.eventos (titulo, tipo, data, criado_por, club_id)
       values ('gate-8.5', 'Reunião', current_date, %L, %L)$m$, t.id('lider_a'), t.id('clube_a')), 4),
  ('config_gravar', $m$select public.config_gravar('pix', 'gate-8.5')$m$, 5),
  ('vinculo_gerir', format($m$select public.vinculo_gerir(%L, p_papel := 'conselheiro')$m$, t.id('membro_a')), 6);
grant select on t.mutacao to public;

-- O laço: identidade × contexto × mutação. Devolve as violações da invariante.
create function t.varrer_mutacoes() returns text language plpgsql as $$
declare i record; c record; m record; v_mexeu text; v_esperado text; v_out text := '';
begin
  for i in select * from t.identidade order by ordem loop
    for c in select * from t.contexto order by ordem loop
      perform t.como(i.chave);
      perform t.aplicar_contexto(c.chave);
      -- o clube da requisição, do ponto de vista do SERVIDOR: é ele que a invariante autoriza
      v_esperado := coalesce(t.txt('select public.clube_atual_id()::text'), '');
      for m in select * from t.mutacao order by ordem loop
        v_mexeu := t.mutacao_mexeu_em(m.sql);
        if v_mexeu <> '<recusado>' and v_mexeu <> '' and v_mexeu is distinct from v_esperado then
          v_out := v_out || format(E'\n    [%s | ctx %s | %s] mexeu em "%s", requisição era "%s"',
                                   i.chave, c.chave, m.nome, v_mexeu, v_esperado);
        end if;
      end loop;
      reset role;
    end loop;
  end loop;
  return v_out;
end $$;
\o

-- =====  A INVARIANTE  =====
select t.eq('[MUTAÇÃO] nenhuma chamada alterou dado de um clube que não era o da requisição',
  t.txt($q$select t.varrer_mutacoes()$q$), '');

-- E a prova de que a varredura fez alguma coisa: sem isto, um erro que recusasse TUDO deixaria o
-- assert acima verde com zero sondagens — o mesmo engano que fez os leilões passarem na fase 8.4.
\o /dev/null
create table t.prova_mutacao as
select (select count(*) from t.identidade) * (select count(*) from t.contexto) * (select count(*) from t.mutacao) as n;
grant select on t.prova_mutacao to public;
\o
select t.eq('...e foram 144 combinações sondadas (6 identidades × 4 contextos × 6 mutações)',
  t.n($q$select n from t.prova_mutacao$q$), 144);

-- A contraprova da sonda: uma escrita LEGÍTIMA no clube da aba TEM de ser detectada. Sem ela, uma
-- sonda quebrada (que nunca visse efeito nenhum) faria a invariante passar sempre.
select t.como('lider_a'); select t.pedir_clube('clube_a');
select t.eq('[sonda] uma escrita legítima no clube da aba É detectada (a medição funciona)',
  t.txt(format($q$select t.mutacao_mexeu_em(%L)$q$,
    format($m$insert into public.eventos (titulo, tipo, data, criado_por, club_id)
              values ('prova-da-sonda', 'Reunião', current_date, %L, %L)$m$, t.id('lider_a'), t.id('clube_a')))),
  t.id('clube_a')::text);
reset role;
select t.eq('[sonda] ...e ela desfez o que escreveu (uma tentativa não contamina a seguinte)',
  t.n($q$select count(*) from public.eventos where titulo = 'prova-da-sonda'$q$), 0);


-- =============================================================================
--  3. LEITURA — a varredura, agora com piso
-- =============================================================================
\o /dev/null
-- Conta o que a sessão ATUAL enxerga de um clube, em toda superfície operacional. Sem ramo de
-- exceção: se a medição falhar, o teste quebra em vez de devolver 0 e parecer seguro.
create function t.le_do_clube(p_clube uuid) returns text language plpgsql as $$
declare r record; v_n bigint; v_out text := ''; v_col text;
begin
  for r in
    select s.tabela,
           (select a.attname from pg_attribute a
              join pg_class c on c.oid = a.attrelid
              join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
             where c.relname = s.tabela and a.attname in ('club_id','club_id_origem')
               and not a.attisdropped limit 1) as col
      from t.superficie s where s.classe = 'operacional' order by s.tabela
  loop
    if r.col is null then continue; end if;
    begin
      execute format('select count(*) from public.%I where %I = %L', r.tabela, r.col, p_clube) into v_n;
    exception when insufficient_privilege then v_n := 0;   -- sem GRANT é "não vê", e é o certo
    end;
    if v_n > 0 then v_out := v_out || r.tabela || '(' || v_n || ') '; end if;
  end loop;
  return btrim(v_out);
end $$;

-- O PISO. Mede, fora da RLS, quanta linha existe de fato em cada clube. É o que transforma um
-- resultado vazio em prova: sem ele, "não vazou" e "não havia nada" são a mesma string.
create function t.existe_no_clube(p_clube uuid) returns bigint
language plpgsql security definer set search_path = '' as $$
declare r record; v_n bigint; v_tot bigint := 0;
begin
  for r in
    select s.tabela,
           (select a.attname from pg_attribute a
              join pg_class c on c.oid = a.attrelid
              join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
             where c.relname = s.tabela and a.attname in ('club_id','club_id_origem')
               and not a.attisdropped limit 1) as col
      from t.superficie s where s.classe = 'operacional'
  loop
    if r.col is null then continue; end if;
    execute format('select count(*) from public.%I where %I = %L', r.tabela, r.col, p_clube) into v_n;
    v_tot := v_tot + v_n;
  end loop;
  return v_tot;
end $$;
\o

-- Fixtures de leitura em TODOS os clubes, e criados AQUI, antes da varredura — não depois dela,
-- que foi o erro do teste 55.
\o /dev/null
insert into public.eventos (titulo, tipo, data, criado_por, club_id) values
  ('gate evento A', 'Reunião', current_date, t.id('lider_a'), t.id('clube_a')),
  ('gate evento B', 'Reunião', current_date, t.id('lider_b'), t.id('clube_b')),
  ('gate evento C', 'Reunião', current_date, t.id('lider_c'), t.id('clube_c'));
insert into public.pontos (usuario_id, origem, pontos, motivo, club_id) values
  (t.id('membro_a'), 'manual', 11, 'gate A', t.id('clube_a')),
  (t.id('membro_b'), 'manual', 22, 'gate B', t.id('clube_b')),
  (t.id('membro_c'), 'manual', 33, 'gate C', t.id('clube_c'));
insert into public.config_clube (club_id, chave, valor) values
  (t.id('clube_a'), 'pix', 'PIX-A'), (t.id('clube_b'), 'pix', 'PIX-B'), (t.id('clube_c'), 'pix', 'PIX-C')
on conflict (club_id, chave) do update set valor = excluded.valor;
-- leilão: a superfície que a fase 8.4 declarou fechada e não estava. Tem de existir ANTES da
-- varredura, senão ela mede uma tabela vazia e chama isso de isolamento.
insert into public.leiloes (titulo, fecha_em, status, club_id, criado_por) values
  ('gate leilao A', now() + interval '7 days', 'aberto', t.id('clube_a'), t.id('lider_a')),
  ('gate leilao B', now() + interval '7 days', 'aberto', t.id('clube_b'), t.id('lider_b')),
  ('gate leilao C', now() + interval '7 days', 'aberto', t.id('clube_c'), t.id('lider_c'));
\o

select t.ok('cada clube tem dado operacional de verdade (o zero da varredura vai significar algo)',
  t.n($q$select least(t.existe_no_clube(t.id('clube_a')), t.existe_no_clube(t.id('clube_b')),
                     t.existe_no_clube(t.id('clube_c')))$q$) > 3);
select t.ok('...e o leilão está entre eles (a superfície que passou despercebida na 8.4)',
  t.n($q$select count(*) from public.leiloes$q$) >= 3);

-- ---------------------------------------------------------------------------
--  A varredura de leitura: para cada identidade, em cada contexto, o que ela enxerga de cada clube.
--  A regra é a mesma da mutação: só o clube da requisição.
-- ---------------------------------------------------------------------------
\o /dev/null
create function t.varrer_leituras() returns text language plpgsql as $$
declare i record; c record; k record; v_ve text; v_atual text; v_out text := '';
begin
  for i in select * from t.identidade order by ordem loop
    for c in select * from t.contexto order by ordem loop
      perform t.como(i.chave);
      perform t.aplicar_contexto(c.chave);
      v_atual := coalesce(t.txt('select public.clube_atual_id()::text'), '');
      for k in select chave, t.id(chave) as id from (values ('clube_a'), ('clube_b'), ('clube_c')) v(chave) loop
        if k.id::text = v_atual then continue; end if;       -- o clube da requisição pode ser lido
        v_ve := t.le_do_clube(k.id);
        if v_ve <> '' then
          v_out := v_out || format(E'\n    [%s | ctx %s] enxerga %s de %s', i.chave, c.chave, v_ve, k.chave);
        end if;
      end loop;
      reset role;
    end loop;
  end loop;
  return v_out;
end $$;
\o

select t.eq('[LEITURA] ninguém enxerga superfície operacional de um clube que não é o da requisição',
  t.txt($q$select t.varrer_leituras()$q$), '');

-- O vínculo REMOVIDO com a sessão aberta — a sétima identidade da fase, que não dá para montar em
-- fixture porque ela é uma mudança DURANTE a corrida.
\o /dev/null
update public.organization_memberships
   set status = 'encerrado', starts_at = now() - interval '1 day', ends_at = now() - interval '1 hour'
 where user_id = t.id('multi_dois_papeis') and organizational_unit_id = t.id('clube_b');
\o
select t.como('multi_dois_papeis'); select t.pedir_clube('clube_b');
select t.eq('[removido na sessão] a aba do clube perdido não lê mais nada dele',
  t.txt($q$select t.le_do_clube(t.id('clube_b'))$q$), '');
select t.eq('[removido na sessão] ...e NÃO passou a ler o outro clube por baixo dos panos',
  t.txt($q$select t.le_do_clube(t.id('clube_a'))$q$), '');
select t.eq('[removido na sessão] o servidor deixa a requisição SEM clube, nunca em outro',
  coalesce(t.txt('select public.clube_atual_id()::text'), 'sem-clube'), 'sem-clube');
reset role;
select t.eq('[removido na sessão] o vínculo do outro clube continua intacto',
  t.txt($q$select status from public.organization_memberships
         where user_id = t.id('multi_dois_papeis') and organizational_unit_id = t.id('clube_a')$q$), 'ativo');


-- =============================================================================
--  4. A EXCEÇÃO PORTÁTIL — item 6, dos dois lados
--
--  Isolamento não pode virar duplicação artificial: a conquista é da pessoa e tem de atravessar.
--  E atravessar a conquista não pode significar atravessar a EVIDÊNCIA que o clube emissor guardou.
-- =============================================================================
select t.como('membro_a'); select t.pedir_clube('clube_a');
select t.ok('[portátil] a pessoa alcança a própria conquista pela função de leitura do currículo',
  t.txt($q$select t.le_do_clube(t.id('clube_a'))$q$) is not null);
reset role;

-- A evidência privada continua sendo do clube emissor, em qualquer aba.
select t.como('lider_b'); select t.pedir_clube('clube_b');
select t.eq('[evidência] a liderança de B não lê a evidência de requisito do clube A',
  t.nv($q$select count(*) from public.member_requirements where club_id = t.id('clube_a')$q$), 0);
select t.eq('[evidência] ...nem o comentário do avaliador de A',
  t.nv($q$select count(*) from public.requirement_approvals where club_id = t.id('clube_a')$q$), 0);
reset role;

-- ---------------------------------------------------------------------------
--  A FOTO. O caminho do objeto é `<usuario_id>/...` e não diz clube nenhum — então a única coisa
--  que sabe de quem é aquela evidência é a LINHA que guarda o caminho. Este bloco prova os dois
--  lados: quem tem direito continua vendo, e quem não tem parou de ver.
--
--  `membro_a` ganha um segundo vínculo em B só para este teste: é a situação exata em que o
--  vazamento existia — a criança está nos dois clubes, e o caminho do arquivo não distingue a
--  evidência que ela mandou para um da que mandou para o outro.
-- ---------------------------------------------------------------------------
\o /dev/null
select t.mk2('membro_a', 'desbravador', 'ativo', 'clube_b');
\o
select t.como('lider_a'); select t.pedir_clube('clube_a');
select t.eq('[foto] a liderança do clube EMISSOR lê a comprovação dele',
  t.nv(format($q$select count(*) from storage.objects where bucket_id='comprovacoes' and name = %L$q$,
       (select foto_url from public.entregas where id = t.id('ent_a')))), 1);
reset role;
select t.como('lider_b'); select t.pedir_clube('clube_b');
select t.eq('[foto] ...e a liderança do OUTRO clube não lê, mesmo a criança sendo membro dos dois',
  t.nv(format($q$select count(*) from storage.objects where bucket_id='comprovacoes' and name = %L$q$,
       (select foto_url from public.entregas where id = t.id('ent_a')))), 0);
reset role;
select t.como('membro_a');
select t.eq('[foto] e a própria criança lê a evidência dela, em qualquer aba',
  t.nv(format($q$select count(*) from storage.objects where bucket_id='comprovacoes' and name = %L$q$,
       (select foto_url from public.entregas where id = t.id('ent_a')))), 1);
reset role;

-- ---------------------------------------------------------------------------
--  As colunas de texto livre das tabelas portáteis. A linha atravessa; o julgamento escrito, não.
-- ---------------------------------------------------------------------------
select t.eq('[portátil] o motivo da revogação não é legível por quem só alcança a conquista',
  t.n($q$select count(*) from information_schema.column_privileges
       where grantee = 'authenticated' and table_schema = 'public'
         and (table_name, column_name) in
             (('curriculum_achievements','revogada_motivo'), ('class_completion_snapshots','revogado_motivo'),
              ('class_investitures','observacao'), ('workflow_stage_decisions','observacao'))$q$), 0);
select t.ok('...e o resto das colunas dessas tabelas continua legível (a conquista não sumiu junto)',
  t.n($q$select count(*) from information_schema.column_privileges
       where grantee = 'authenticated' and table_schema = 'public'
         and table_name in ('curriculum_achievements','class_completion_snapshots',
                            'class_investitures','workflow_stage_decisions')
         and privilege_type = 'SELECT'$q$) > 25);

select t.fim();
rollback;
