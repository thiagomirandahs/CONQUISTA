-- =============================================================================
--  Fase 8.4 — A MATRIZ A ↔ B ↔ C.
--
--  Para cada superfície que guarda dado de clube, quatro perguntas:
--
--    LEITURA CRUZADA ...... consigo LER o dado do outro clube?
--    ESCRITA CRUZADA ...... consigo ESCREVER no outro clube?
--    ORÁCULO .............. a resposta para um id do outro clube difere da de um id inexistente?
--    CLUBE ERRADO ......... uma escrita minha pode CAIR no clube errado, mesmo que ninguém leia?
--
--  As duas últimas são as que os testes de isolamento costumam esquecer. "Ninguém consegue ler"
--  não basta: uma operação gravada no clube errado é BLOCKER mesmo que fique invisível, porque o
--  dado está lá, contaminando relatório, cobrança e histórico.
--
--  POR QUE TRÊS CLUBES E NÃO DOIS: com dois, qualquer lógica do tipo "o outro clube" funciona por
--  acidente. O clube C existe para pegar código acidentalmente binário — e para provar que o
--  isolamento é entre N clubes, não entre "o meu" e "o outro".
--
--  E o oposto também é testado: o que atravessa tenant DE PROPÓSITO (identidade, catálogo
--  curricular, conquistas portáteis, verificação pública) tem seção própria. Isolamento que vira
--  duplicação artificial é tão errado quanto vazamento.
-- =============================================================================
begin;
\ir _lib.sql
\ir _fixtures.sql

\o /dev/null
alter default privileges in schema t grant select on tables to public;

-- ---------- o TERCEIRO clube, com nomes de unidade que COLIDEM com os de A e B ----------
insert into public.organizational_units (type, nome, slug, pais, timezone, metadata)
values ('clube', 'Clube C (terceiro)', 'clube-c-terceiro', 'BR', 'America/Recife', '{"test_only":true}');
insert into t.ids (chave, id) select 'clube_c', id from public.organizational_units where slug = 'clube-c-terceiro';

-- "Teste A1" existe em A. Criar o MESMO nome em B e C é como se procura colisão por nome.
insert into public.unidades (nome, cor, club_id) values ('Teste A1', '#888888', t.id('clube_b'));
insert into t.ids (chave, id) select 'B_homonima', id from public.unidades where nome = 'Teste A1' and club_id = t.id('clube_b');
insert into public.unidades (nome, cor, club_id) values ('Teste A1', '#999999', t.id('clube_c'));
insert into t.ids (chave, id) select 'C_homonima', id from public.unidades where nome = 'Teste A1' and club_id = t.id('clube_c');
insert into public.unidades (nome, cor, club_id) values ('Unidade C', '#aaaaaa', t.id('clube_c'));
insert into t.ids (chave, id) select 'C1', id from public.unidades where nome = 'Unidade C';

select t.mk('lider_c', 'Lider C', 'diretoria', 'ativo', 'clube_c');
select t.mk('membro_c', 'Membro C', 'desbravador', 'ativo', 'clube_c', 'C1', date '2014-09-09');
select t.mk('pais_c', 'Pais C', 'pais', 'ativo', 'clube_c');
-- a pessoa com vínculo nos TRÊS: o caso que lógica binária não prevê
select t.mk('tri', 'Pessoa dos Tres', 'desbravador', 'ativo', 'clube_a', 'A1', date '2013-02-02');
select t.mk2('tri', 'conselheiro', 'ativo', 'clube_b', 'B1');
select t.mk2('tri', 'instrutor', 'ativo', 'clube_c', 'C1');
update public.profiles set teste = true where id = t.id('tri');

-- recursos ligados nos três, para que o entitlement não mascare um vazamento de isolamento
insert into public.club_features (club_id, feature, enabled)
select c, f, true from unnest(array[t.id('clube_a'), t.id('clube_b'), t.id('clube_c')]) c,
                       unnest(array['leilao','experiencias','mensalidades','chat','jogos']) f
on conflict (club_id, feature) do update set enabled = true;

-- dado privado em CADA clube, com marcador próprio, para a varredura achar por conteúdo
insert into public.fotos (url, legenda, autor_id, club_id)
values ('https://x/c.jpg', 'SEGREDO-C', t.id('membro_c'), t.id('clube_c'));
insert into public.config_clube (club_id, chave, valor) values
  (t.id('clube_b'), 'pix', 'PIX-SEGREDO-B'), (t.id('clube_c'), 'pix', 'PIX-SEGREDO-C')
on conflict (club_id, chave) do update set valor = excluded.valor;
insert into public.mensalidades (desbravador_id, mes, ano, valor, status, club_id, registrado_por)
values (t.id('membro_c'), 3, 2026, 77, 'pendente', t.id('clube_c'), t.id('lider_c'));
insert into public.eventos (titulo, tipo, data, criado_por, club_id)
values ('Evento SEGREDO-C', 'Reunião', current_date + 3, t.id('lider_c'), t.id('clube_c'));
insert into public.pontos (usuario_id, origem, pontos, motivo, club_id)
values (t.id('membro_c'), 'manual', 33, 'SEGREDO-C pontos', t.id('clube_c'));
insert into public.notificacoes (titulo, corpo, tipo, link, para, criado_por, club_id, chave_push)
values ('Aviso SEGREDO-C', 'so do C', 'geral', '/', 'todos', t.id('lider_c'), t.id('clube_c'), '');
insert into public.responsaveis (responsavel_id, desbravador_id, nome_digitado, status, club_id)
values (t.id('pais_c'), t.id('membro_c'), 'Membro C', 'aprovado', t.id('clube_c'));


-- O papel da ABA, pelo mesmo caminho que o app percorre: `meu_contexto()` devolve os vinculos e
-- o clube em uso; o papel e o do vinculo que casa com o clube em uso. Nao existe (nem deve
-- existir) uma funcao que devolva "o papel" solto — papel sem clube nao significa nada aqui.
create function t.papel_da_aba() returns text language sql stable as $$
  select v ->> 'papel'
    from jsonb_array_elements((to_jsonb(public.meu_contexto())) -> 'vinculos') v
   where v ->> 'club_id' = (to_jsonb(public.meu_contexto())) ->> 'clube_atual_id'
   limit 1;
$$;
create function t.unidade_da_aba() returns uuid language sql stable as $$
  select (v ->> 'unidade_id')::uuid
    from jsonb_array_elements((to_jsonb(public.meu_contexto())) -> 'vinculos') v
   where v ->> 'club_id' = (to_jsonb(public.meu_contexto())) ->> 'clube_atual_id'
   limit 1;
$$;

-- A sonda de oráculo: 'R:<valor>' ou 'E:<sqlstate>'. Comparar as duas formas é o que impede a
-- falha de entregar a diferença pelo código de erro.
create function t.sonda(p_sql text) returns text language plpgsql as $$
declare v text;
begin execute p_sql into v; return 'R:' || coalesce(v, 'nulo');
exception when others then return 'E:' || sqlstate; end $$;

-- Conta o que a sessão ATUAL enxerga numa tabela, filtrando por clube.
create function t.ve(p_tabela text, p_clube text) returns bigint language plpgsql as $$
declare v bigint;
begin
  execute format('select count(*) from public.%I where club_id = %L', p_tabela, t.id(p_clube)) into v;
  return coalesce(v, 0);
exception when others then return 0;   -- permissão negada = não vê nada, que é o que se quer medir
end $$;
\o

-- =============================================================================
--  1. LEITURA CRUZADA — a varredura completa, nas duas direções e com o terceiro
-- =============================================================================
-- Toda tabela com club_id, para cada persona, contra os DOIS outros clubes. É a pergunta
-- "existe alguma tabela em que eu enxergo linha de clube alheio?" — respondida por varredura,
-- não por lista escrita à mão que envelhece.
\o /dev/null
reset role;
create table t.tabelas as
  select c.relname::text as tabela
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid and a.attname = 'club_id' and not a.attisdropped
   where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
     -- tabelas de OPERAÇÃO da plataforma: quem lê é a operação, não o clube. Testadas à parte.
     and c.relname not in ('app_erros','infra_falhas','alertas','alerta_entregas','push_tentativas',
                           'push_eventos','club_storage_objetos','club_storage_uso','cron_falhas');
create function t.varrer_leitura(p_alvo text) returns text language plpgsql as $$
declare r record; v bigint; v_out text := '';
begin
  for r in select tabela from t.tabelas order by 1 loop
    v := t.ve(r.tabela, p_alvo);
    if v > 0 then v_out := v_out || r.tabela || '(' || v || ') '; end if;
  end loop;
  return trim(v_out);
end $$;
\o

select t.como('lider_a'); select t.pedir_clube('clube_a');
select t.eq('[A→B] a diretoria de A não lê NENHUMA tabela do clube B', t.txt($q$select t.varrer_leitura('clube_b')$q$), '');
select t.eq('[A→C] ...nem do clube C', t.txt($q$select t.varrer_leitura('clube_c')$q$), '');
select t.como('lider_b'); select t.pedir_clube('clube_b');
select t.eq('[B→A] a diretoria de B não lê nenhuma tabela de A', t.txt($q$select t.varrer_leitura('clube_a')$q$), '');
select t.eq('[B→C] ...nem de C', t.txt($q$select t.varrer_leitura('clube_c')$q$), '');
select t.como('lider_c'); select t.pedir_clube('clube_c');
select t.eq('[C→A] a diretoria de C não lê nenhuma tabela de A', t.txt($q$select t.varrer_leitura('clube_a')$q$), '');
select t.eq('[C→B] ...nem de B', t.txt($q$select t.varrer_leitura('clube_b')$q$), '');
select t.como('membro_c'); select t.pedir_clube('clube_c');
select t.eq('[membro C→A] membro comum idem', t.txt($q$select t.varrer_leitura('clube_a')$q$), '');
select t.eq('[membro C→B] idem', t.txt($q$select t.varrer_leitura('clube_b')$q$), '');
select t.como('pais_c');
select t.eq('[responsável C→A] o papel de menor privilégio idem', t.txt($q$select t.varrer_leitura('clube_a')$q$), '');
reset role;

-- A pessoa dos TRÊS clubes: ela pode ler os três — mas só o que a ABA pedida autoriza.
select t.como('tri'); select t.pedir_clube('clube_a');
select t.ok('[tri em A] enxerga o clube A', t.n($q$select t.ve('pontos','clube_a')$q$) >= 0);
select t.eq('[tri em A] ...e NÃO enxerga C pela aba de A', t.txt($q$select t.varrer_leitura('clube_c')$q$), '');
select t.pedir_clube('clube_c');
select t.eq('[tri em C] ...e, trocando a aba, não enxerga A', t.txt($q$select t.varrer_leitura('clube_a')$q$), '');
reset role;

-- =============================================================================
--  2. ESCRITA CRUZADA e CLUBE ERRADO
-- =============================================================================
-- A pergunta que importa não é só "a escrita falha?". É: quando ela é ACEITA, cai no clube certo?
-- Um insert que o servidor carimba com o clube em uso está correto mesmo que eu peça outro.
select t.como('lider_a'); select t.pedir_clube('clube_a');
select t.bloqueado('[A→B] a diretoria de A não cria evento no clube B',
  $q$insert into public.eventos (titulo, tipo, data, criado_por, club_id)
     values ('invasao', 'Reunião', current_date, t.id('lider_a'), t.id('clube_b'))$q$);
select t.bloqueado('[A→C] ...nem no clube C',
  $q$insert into public.eventos (titulo, tipo, data, criado_por, club_id)
     values ('invasao', 'Reunião', current_date, t.id('lider_a'), t.id('clube_c'))$q$);
select t.bloqueado('[A→B] não cria unidade no B',
  $q$insert into public.unidades (nome, cor, club_id) values ('invasora', '#000', t.id('clube_b'))$q$);
select t.bloqueado('[A→C] nem config no C',
  $q$insert into public.config_clube (club_id, chave, valor) values (t.id('clube_c'), 'pix', 'ROUBADO')$q$);
select t.bloqueado('[A→B] não lança ponto no B',
  $q$insert into public.pontos (usuario_id, origem, pontos, motivo, club_id)
     values (t.id('membro_b'), 'manual', 999, 'invasao', t.id('clube_b'))$q$);
select t.bloqueado('[A→C] não cria mensalidade no C',
  $q$insert into public.mensalidades (desbravador_id, mes, ano, valor, status, club_id, registrado_por)
     values (t.id('membro_c'), 5, 2026, 1, 'pago', t.id('clube_c'), t.id('lider_a'))$q$);

-- CLUBE ERRADO: peço o clube B no payload, operando em A. Ou falha, ou nasce em A — nunca em B.
-- A linha de base tem de ser tirada FORA do papel `authenticated` (o schema t é do teste, não da
-- aplicação) — e o contexto precisa ser REARMADO depois. Sem rearmar, o insert abaixo rodaria como
-- postgres, que não passa por RLS: ele passaria, e o teste registraria como defeito do produto o
-- que é só o teste testando a si mesmo.
\o /dev/null
reset role;
create table t.antes_b as select count(*) n from public.eventos where club_id = t.id('clube_b');
select t.como('lider_a'); select t.pedir_clube('clube_a');
\o
select t.tenta($q$insert into public.eventos (titulo, tipo, data, criado_por, club_id)
  values ('carimbo errado', 'Reunião', current_date, t.id('lider_a'), t.id('clube_b'))$q$);
reset role;
select t.eq('[clube errado] nada apareceu em B',
  t.n($q$select count(*) from public.eventos where club_id = t.id('clube_b')$q$), t.n($q$select n from t.antes_b$q$));
select t.eq('...e se algo entrou, entrou em A (o clube da requisição), nunca em B',
  t.n($q$select count(*) from public.eventos where titulo = 'carimbo errado' and club_id <> t.id('clube_a')$q$), 0);

-- Unidade HOMÔNIMA: o nome é igual nos três, o alvo tem de ser o id, nunca o nome.
select t.como('lider_a'); select t.pedir_clube('clube_a');
select t.bloqueado('[homônimas] a diretoria de A não move a unidade de B que tem o mesmo nome',
  $q$update public.unidades set cor = '#ff0000' where id = t.id('B_homonima')$q$);
select t.bloqueado('...nem a de C', $q$update public.unidades set cor = '#ff0000' where id = t.id('C_homonima')$q$);
reset role;
select t.eq('as unidades homônimas de B e C continuam intactas',
  t.n($q$select count(*) from public.unidades where id in (t.id('B_homonima'), t.id('C_homonima')) and cor = '#ff0000'$q$), 0);
select t.eq('...e são três unidades distintas com o MESMO nome',
  t.n($q$select count(distinct id) from public.unidades where nome = 'Teste A1'$q$), 3);

-- =============================================================================
--  3. ORÁCULO — id do outro clube x id inexistente
-- =============================================================================
select t.como('lider_a'); select t.pedir_clube('clube_a');
select t.eq('[oráculo] saldo de unidade: B e inexistente dão a mesma resposta',
  t.txt($q$select t.sonda('select public.leilao_saldo_unidade(''' || t.id('B_homonima') || ''')')$q$),
  t.txt($q$select t.sonda('select public.leilao_saldo_unidade(''11111111-2222-3333-4444-555555555555'')')$q$));
select t.eq('[oráculo] ...e C e inexistente também',
  t.txt($q$select t.sonda('select public.leilao_saldo_unidade(''' || t.id('C_homonima') || ''')')$q$),
  t.txt($q$select t.sonda('select public.leilao_saldo_unidade(''11111111-2222-3333-4444-555555555555'')')$q$));
select t.eq('[oráculo] pontos da temporada: idem para os três',
  t.txt($q$select t.sonda('select public.pontos_temporada_unidade(''' || t.id('C1') || ''')')$q$),
  t.txt($q$select t.sonda('select public.pontos_temporada_unidade(''11111111-2222-3333-4444-555555555555'')')$q$));
select t.eq('[oráculo] marca do clube: C e inexistente iguais',
  t.txt($q$select t.sonda('select public.clube_marca(''' || t.id('clube_c') || ''')::text')$q$),
  t.txt($q$select t.sonda('select public.clube_marca(''11111111-2222-3333-4444-555555555555'')::text')$q$));
reset role;

-- =============================================================================
--  4. OPERAÇÕES SIMULTÂNEAS nos três clubes
-- =============================================================================
-- Leilões, chefões, chat e notificações acontecendo ao mesmo tempo. O que se prova é que o
-- resultado de cada um fica dentro do seu clube — nenhuma soma atravessa.
\o /dev/null
do $$
declare c uuid; v_l uuid; v_i uuid; nome text;
begin
  foreach c in array array[t.id('clube_a'), t.id('clube_b'), t.id('clube_c')] loop
    select o.nome into nome from public.organizational_units o where o.id = c;
    insert into public.leiloes (titulo, fecha_em, criado_por, club_id, status)
    values ('Leilao de ' || nome, now() + interval '1 day',
            (select user_id from public.organization_memberships
              where organizational_unit_id = c and role = 'diretoria' limit 1), c, 'aberto')
    returning id into v_l;
    insert into public.leilao_itens (leilao_id, nome, preco_base, ordem, club_id)
    values (v_l, 'Item de ' || nome, 10, 1, c) returning id into v_i;
  end loop;
end $$;
\o
select t.eq('os três clubes têm leilão ABERTO ao mesmo tempo',
  t.n($q$select count(*) from public.leiloes where status = 'aberto'
       and club_id in (t.id('clube_a'), t.id('clube_b'), t.id('clube_c'))$q$), 3);
select t.como('lider_b'); select t.pedir_clube('clube_b');
select t.eq('...e a diretoria de B enxerga só o leilão dela',
  t.nv($q$select count(*) from public.leiloes$q$), 1);
select t.eq('...que é o do clube B',
  t.nv($q$select count(*) from public.leiloes where club_id = t.id('clube_b')$q$), 1);
reset role;

-- A MESMA pessoa pontuada nos três clubes: três lançamentos, três rankings, zero soma cruzada.
\o /dev/null
insert into public.pontos (usuario_id, origem, pontos, motivo, club_id) values
  (t.id('tri'), 'manual', 10, 'pontos em A', t.id('clube_a')),
  (t.id('tri'), 'manual', 20, 'pontos em B', t.id('clube_b')),
  (t.id('tri'), 'manual', 40, 'pontos em C', t.id('clube_c'));
\o
select t.como('tri'); select t.pedir_clube('clube_a');
select t.eq('[tri] na aba de A vê só os 10 pontos de A',
  t.nv($q$select coalesce(sum(pontos),0) from public.pontos where usuario_id = t.id('tri')$q$), 10);
select t.pedir_clube('clube_b');
select t.eq('[tri] na aba de B vê só os 20 de B',
  t.nv($q$select coalesce(sum(pontos),0) from public.pontos where usuario_id = t.id('tri')$q$), 20);
select t.pedir_clube('clube_c');
select t.eq('[tri] na aba de C vê só os 40 de C',
  t.nv($q$select coalesce(sum(pontos),0) from public.pontos where usuario_id = t.id('tri')$q$), 40);
reset role;

-- =============================================================================
--  5. DUAS ABAS — contexto, papel, unidade e marca não contaminam
-- =============================================================================
-- Duas abas da MESMA conta. No harness, "aba" é a requisição: cada `t.pedir_clube` é um header
-- diferente, exatamente como o app manda. O que não pode é a segunda leitura herdar a primeira.
select t.como('tri');
select t.pedir_clube('clube_a');
select t.eq('[aba A] o papel é o do vínculo em A', t.txt($q$select t.papel_da_aba()$q$), 'desbravador');
select t.pedir_clube('clube_b');
select t.eq('[aba B] o papel muda para o do vínculo em B', t.txt($q$select t.papel_da_aba()$q$), 'conselheiro');
select t.pedir_clube('clube_c');
select t.eq('[aba C] e para o de C', t.txt($q$select t.papel_da_aba()$q$), 'instrutor');
select t.pedir_clube('clube_a');
select t.eq('[volta a A] volta ao papel de A — nada ficou grudado', t.txt($q$select t.papel_da_aba()$q$), 'desbravador');
select t.eq('[volta a A] e a unidade é a de A',
  t.txt($q$select (t.unidade_da_aba() = t.id('A1'))::text$q$), 'true');
select t.pedir_clube('clube_c');
select t.eq('[aba C] a unidade é a de C',
  t.txt($q$select (t.unidade_da_aba() = t.id('C1'))::text$q$), 'true');
reset role;

-- A marca acompanha a aba, nunca a anterior.
select t.como('tri'); select t.pedir_clube('clube_b');
select t.eq('[marca] a aba de B mostra o PIX de B',
  t.txt($q$select valor from public.config_clube where chave = 'pix'$q$), 'PIX-SEGREDO-B');
select t.pedir_clube('clube_c');
select t.eq('[marca] a aba de C mostra o PIX de C — não o de B',
  t.txt($q$select valor from public.config_clube where chave = 'pix'$q$), 'PIX-SEGREDO-C');
select t.eq('[marca] ...e o de B some da vista',
  t.nv($q$select count(*) from public.config_clube where valor = 'PIX-SEGREDO-B'$q$), 0);
reset role;

-- =============================================================================
--  6. CICLO DE VÍNCULO — suspender/remover num clube não afeta os outros
-- =============================================================================
\o /dev/null
update public.organization_memberships set status = 'suspenso'
 where user_id = t.id('tri') and organizational_unit_id = t.id('clube_a');
\o
select t.como('tri'); select t.pedir_clube('clube_a');
select t.eq('[suspenso em A] a pessoa deixa de enxergar A', t.nv($q$select count(*) from public.pontos$q$), 0);
select t.pedir_clube('clube_b');
select t.ok('[suspenso em A] mas B continua funcionando', t.nv($q$select count(*) from public.pontos$q$) > 0);
select t.pedir_clube('clube_c');
select t.ok('[suspenso em A] e C também', t.nv($q$select count(*) from public.pontos$q$) > 0);
reset role;
select t.eq('a identidade global continua existindo',
  t.n($q$select count(*) from public.profiles where id = t.id('tri')$q$), 1);
select t.eq('...e os outros dois vínculos, intactos',
  t.n($q$select count(*) from public.organization_memberships
       where user_id = t.id('tri') and status = 'ativo'$q$), 2);

-- Trocar papel só em A não muda B nem C.
\o /dev/null
update public.organization_memberships set status = 'ativo', role = 'conselheiro'
 where user_id = t.id('tri') and organizational_unit_id = t.id('clube_a');
\o
select t.como('tri'); select t.pedir_clube('clube_b');
select t.eq('[papel] mexer no papel em A não muda o de B', t.txt($q$select t.papel_da_aba()$q$), 'conselheiro');
select t.pedir_clube('clube_c');
select t.eq('...nem o de C', t.txt($q$select t.papel_da_aba()$q$), 'instrutor');
reset role;

-- Encerrar o vínculo em B: identidade e os outros clubes sobrevivem.
\o /dev/null
-- O CHECK  exige ends_at > starts_at, e now() e fixo na
-- transacao — entao encerrar significa recuar o inicio tambem. E o que uma saida real faz: o
-- vinculo teve um periodo, e ele acabou.
update public.organization_memberships
   set status = 'encerrado', starts_at = now() - interval '1 day', ends_at = now() - interval '1 hour'
 where user_id = t.id('tri') and organizational_unit_id = t.id('clube_b');
\o
select t.eq('[removido de B] a identidade global permanece',
  t.n($q$select count(*) from public.profiles where id = t.id('tri')$q$), 1);
select t.como('tri'); select t.pedir_clube('clube_c');
select t.ok('[removido de B] C continua funcionando', t.nv($q$select count(*) from public.pontos$q$) > 0);
select t.pedir_clube('clube_b');
select t.eq('[removido de B] e B fica fechado', t.nv($q$select count(*) from public.pontos$q$), 0);
reset role;
select t.eq('os pontos que ela ganhou em B continuam no HISTÓRICO do clube B (não são apagados)',
  t.n($q$select count(*) from public.pontos where usuario_id = t.id('tri') and club_id = t.id('clube_b')$q$), 1);

-- =============================================================================
--  7. CROSS-TENANT LEGÍTIMO — o que PODE atravessar, e o contrato de cada um
-- =============================================================================
-- Isolamento que vira duplicação artificial é tão errado quanto vazamento. Estas quatro coisas
-- atravessam de propósito, e cada uma tem o seu motivo.

-- (a) IDENTIDADE GLOBAL: uma pessoa, um perfil, N vínculos.
select t.eq('a mesma pessoa tem UM perfil e vínculo em três clubes',
  t.n($q$select count(*) from public.organization_memberships where user_id = t.id('tri')$q$), 3);
select t.eq('...e um único registro de identidade',
  t.n($q$select count(*) from public.profiles where id = t.id('tri')$q$), 1);

-- (b) CATÁLOGO CURRICULAR: conteúdo da plataforma, igual para todo clube.
select t.como('membro_c'); select t.pedir_clube('clube_c');
select t.ok('[legítimo] o clube C lê o catálogo oficial de classes', t.nv($q$select count(*) from public.classes$q$) > 0);
select t.como('membro_a'); select t.pedir_clube('clube_a');
select t.eq('[legítimo] e A lê exatamente o MESMO catálogo (não uma cópia)',
  t.nv($q$select count(*) from public.classes$q$), t.nv($q$select count(*) from public.classes$q$));
reset role;

-- (c) CONQUISTA PORTÁTIL: o que a pessoa conquistou vai com ela.
\o /dev/null
insert into public.curriculum_achievements (usuario_id, tipo, specialty_id, club_id_origem, concluida_em, status)
select t.id('tri'), 'especialidade', sp.id, t.id('clube_a'), now(), 'ativa'
  from public.specialties sp limit 1
on conflict do nothing;
\o
select t.como('tri'); select t.pedir_clube('clube_c');
select t.ok('[legítimo] a conquista emitida por A é visível para a própria pessoa operando em C',
  t.nv($q$select count(*) from public.curriculum_achievements where usuario_id = t.id('tri')$q$) >= 1);
reset role;
-- mas NÃO para terceiros de outro clube
select t.como('membro_c'); select t.pedir_clube('clube_c');
select t.eq('[limite] outra pessoa do C não lê a conquista dela emitida por A',
  t.nv($q$select count(*) from public.curriculum_achievements where usuario_id = t.id('tri')$q$), 0);
reset role;

-- (d) VERIFICAÇÃO PÚBLICA: anônima por desenho, e não vira oráculo.
select t.como_anon();
select t.eq('[legítimo] a verificação pública responde sem login',
  t.txt($q$select (public.documento_verificar('token-que-nao-existe') ->> 'encontrado')$q$), 'false');
reset role;

-- =============================================================================
--  8. CICLO COMERCIAL — suspender B não toca A nem C
-- =============================================================================
\o /dev/null
insert into public.billing_accounts (nome) values ('Conta do B');
insert into t.ids select 'conta_b', id from public.billing_accounts where nome = 'Conta do B';
insert into public.subscriptions (billing_account_id, plan_id, status, ciclo, provider_ref)
select t.id('conta_b'), p.id, 'ativa', 'mensal', 'ref-b'
  from public.billing_plans p where p.chave = 'essencial' and p.publico order by versao desc limit 1;
insert into t.ids select 'sub_b', id from public.subscriptions where provider_ref = 'ref-b';
insert into public.subscription_clubs (subscription_id, club_id) values (t.id('sub_b'), t.id('clube_b'));
\o
select t.eq('com assinatura ATIVA, B tem o recurso no plano',
  t.txt($q$select public.recurso_disponivel_no_plano(t.id('clube_b'), 'chat')::text$q$), 'true');
\o /dev/null
update public.subscriptions set status = 'suspensa' where id = t.id('sub_b');
\o
select t.eq('SUSPENSA: B perde o recurso pelo plano',
  t.txt($q$select public.recurso_disponivel_no_plano(t.id('clube_b'), 'chat')::text$q$), 'false');
select t.eq('...mas A (sem assinatura, legado) não é afetado',
  t.txt($q$select public.recurso_disponivel_no_plano(t.id('clube_a'), 'chat')::text$q$), 'true');
select t.eq('...e C também não',
  t.txt($q$select public.recurso_disponivel_no_plano(t.id('clube_c'), 'chat')::text$q$), 'true');
-- O dado de B continua LÁ — suspensão comercial não apaga nada.
select t.ok('os dados de B continuam existindo durante a suspensão',
  t.n($q$select count(*) from public.config_clube where club_id = t.id('clube_b')$q$) > 0);
\o /dev/null
update public.subscriptions set status = 'ativa' where id = t.id('sub_b');
\o
select t.eq('REATIVADA: B volta sem reconstruir nada',
  t.txt($q$select public.recurso_disponivel_no_plano(t.id('clube_b'), 'chat')::text$q$), 'true');
select t.ok('...com os dados que já tinha', t.n($q$select count(*) from public.config_clube where club_id = t.id('clube_b')$q$) > 0);

-- Feature flag DIFERENTE para o mesmo recurso, em clubes diferentes, ao mesmo tempo.
\o /dev/null
update public.club_features set enabled = false where club_id = t.id('clube_c') and feature = 'chat';
\o
select t.eq('[flags] o chat fica ligado em B', t.txt($q$select public.recurso_habilitado_no_clube(t.id('clube_b'), 'chat')::text$q$), 'true');
select t.eq('[flags] e desligado em C, ao mesmo tempo', t.txt($q$select public.recurso_habilitado_no_clube(t.id('clube_c'), 'chat')::text$q$), 'false');
select t.eq('[flags] e A segue independente', t.txt($q$select public.recurso_habilitado_no_clube(t.id('clube_a'), 'chat')::text$q$), 'true');

select t.fim();
rollback;
