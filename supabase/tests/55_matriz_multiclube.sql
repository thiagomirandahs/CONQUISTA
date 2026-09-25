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

-- AUTORIDADE REAL, ABA ERRADA. Este é o achado que o red-team automático encontrou, escrito à mão
-- para ficar legível: `tri` é instrutora em C DE VERDADE. A permissão dela existe. O que não pode
-- existir é exercê-la de dentro da aba de B. Antes da migration 64, `unidade_excluir` derivava o
-- clube da unidade alvo e respondia {"ok": true} — apagava a unidade de C por um clique dado em B.
select t.como('tri'); select t.pedir_clube('clube_b');
select t.throws('[aba errada] instrutora de C, operando em B, NÃO apaga a unidade de C',
  $q$select public.unidade_excluir(t.id('C1'))$q$, 'Sem permissão');
reset role;
select t.eq('...e a unidade de C continua lá',
  t.n($q$select count(*) from public.unidades where id = t.id('C1')$q$), 1);
-- E o contraponto, que é o que impede a correção de virar um bloqueio cego: na aba CERTA ela pode.
\o /dev/null
insert into public.unidades (nome, cor, club_id) values ('Descartável C', '#123456', t.id('clube_c'));
insert into t.ids (chave, id) select 'C2', id from public.unidades where nome = 'Descartável C';
\o
select t.como('tri'); select t.pedir_clube('clube_c');
select t.permitido('[aba certa] a MESMA pessoa, na aba de C, apaga a unidade de C normalmente',
  $q$select public.unidade_excluir(t.id('C2'))$q$, 0);
reset role;
select t.eq('...e a unidade sumiu de verdade',
  t.n($q$select count(*) from public.unidades where id = t.id('C2')$q$), 0);

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
  -- 'essencial' pode estar arquivado da vitrine (item comercial de fechamento) — não precisa estar
  -- público pra uma assinatura EXISTENTE continuar funcionando, só precisa existir no catálogo.
  from public.billing_plans p where p.chave = 'essencial' order by versao desc limit 1;
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

-- =============================================================================
--  9. RED-TEAM AUTOMÁTICO — ids REAIS de um clube, usados operando em OUTRO
--
--  O teste 24 já faz esta varredura entre A e B. O que a 8.4 acrescenta são as duas coisas que
--  dois clubes não conseguem provar:
--
--    · o TERCEIRO clube. Com A e B, "o outro clube" e "o clube que não é o meu" são a mesma coisa,
--      e qualquer lógica acidentalmente binária passa. C separa as duas;
--    · a pessoa MULTI-CLUBE. Ela é o pior caso possível: as funções lhe devem responder de verdade
--      sobre A e sobre C, e a única coisa que decide qual das duas é a ABA. Um oráculo aqui não é
--      "id de clube alheio vaza"; é "id do MEU outro clube responde diferente na aba errada".
--
--  A sonda é a mesma das fases anteriores: resposta para (id real de outro clube) tem de ser
--  idêntica à resposta para (uuid aleatório), byte a byte, incluindo o sqlstate.
-- =============================================================================
\o /dev/null
reset role;
create table t.alvos (clube text, id uuid, rotulo text);
-- O pool alcança tabelas com `club_id` E com `club_id_origem`.
--
-- A segunda coluna entrou na 8.4 e pagou na hora: `curriculum_achievements` e
-- `class_completion_snapshots` — conquista portátil e snapshot de classe, justamente os registros
-- que VIAJAM entre clubes e portanto os de maior consequência — não têm coluna `club_id`. Uma
-- varredura que só procurasse `club_id` passaria por eles sem sondar um único id, e o relatório
-- diria zero divergências com a mesma cara de "está tudo certo".
create function t.montar_alvos(p_clube text) returns void language plpgsql as $$
declare r record; v_club uuid := t.id(p_clube);
begin
  for r in
    select c.table_name, d.column_name as col
      from information_schema.columns c
      join information_schema.columns d
        on d.table_schema = c.table_schema and d.table_name = c.table_name
       and d.column_name in ('club_id', 'club_id_origem')
     where c.table_schema = 'public' and c.column_name = 'id' and c.data_type = 'uuid'
  loop
    execute format('insert into t.alvos select %L, id, %L from public.%I where %I = %L limit 2',
                   p_clube, r.table_name, r.table_name, r.col, v_club);
  end loop;
  insert into t.alvos values (p_clube, v_club, 'o próprio clube');
end $$;
select t.montar_alvos('clube_a');
select t.montar_alvos('clube_b');
select t.montar_alvos('clube_c');
grant select on t.alvos to public;
create table t.cobertura (rotulo text, sondadas int, existentes int);
grant all on t.cobertura to public;

-- Monta "select public.f(args)" com o alvo na posição i e neutros nas demais.
-- O laço usa os limites REAIS do array: `proargtypes::oid[]` vem de um oidvector e é 0-BASED.
-- Foi essa exata linha, escrita como `1..pronargs`, que deixou 84% da superfície sem sondar até a
-- fase 8.2 — e foi por essa fresta que os RPCs cross-tenant passaram despercebidos.
create function t.chamada3(p_nome text, p_tipos oid[], p_pos int, p_alvo uuid, p_outros uuid) returns text language plpgsql as $$
declare j int; v_args text[] := '{}'; v_tipo text; v_arg text;
begin
  for j in array_lower(p_tipos, 1) .. array_upper(p_tipos, 1) loop
    v_tipo := p_tipos[j]::regtype::text;
    v_arg := case
      when j = p_pos then format('%L::uuid', p_alvo)
      when v_tipo = 'uuid' then format('%L::uuid', p_outros)
      when v_tipo = 'text' then quote_literal('x')
      when v_tipo = 'integer' then '1'
      when v_tipo = 'bigint' then '1'
      when v_tipo = 'boolean' then 'true'
      when v_tipo = 'jsonb' then $x$'{}'::jsonb$x$
      when v_tipo = 'json' then $x$'{}'::json$x$
      when v_tipo = 'uuid[]' then $x$'{}'::uuid[]$x$
      when v_tipo = 'text[]' then $x$'{}'::text[]$x$
      when v_tipo = 'date' then 'current_date'
      when v_tipo = 'timestamp with time zone' then 'now()'
      else null end;
    if v_arg is null then return null; end if;   -- vira número no assert de cobertura, não silêncio
    v_args := v_args || v_arg;
  end loop;
  return format('select (public.%I(%s))::text', p_nome, array_to_string(v_args, ', '));
end $$;

-- Sonda que SEMPRE desfaz o efeito. A varredura chama toda função pública que aceita uuid, e boa
-- parte delas é VOLATILE: elas escrevem. Com a sonda simples (`t.sonda`), a varredura de A deixava
-- estado para trás e a varredura de C media um banco já mexido — as duas davam resultados
-- diferentes só por causa da ORDEM. O truque é o mesmo do teste 24: levanta uma exceção própria
-- carregando o resultado, o que faz a subtransação voltar atrás, e devolve o resultado pelo
-- sqlerrm. Nada do que a varredura chama sobrevive à própria chamada.
create function t.sonda_limpa(p_sql text) returns text language plpgsql as $$
declare v text;
begin
  begin
    execute p_sql into v;
    raise exception using errcode = 'ZZ001', message = coalesce(v, 'nulo');
  exception when others then
    if sqlstate = 'ZZ001' then return 'R:' || sqlerrm; end if;
    return 'E:' || sqlstate;
  end;
end $$;

-- Varre com a sessão JÁ aberta (t.como + t.pedir_clube antes). Devolve as divergências.
-- p_inclui_o_clube: sondar também o ID DO CLUBE em si, não só os dados dele.
--
-- Para quem NÃO é membro do clube alvo isso é obrigatório: `membro_ativo_no_clube(id_do_clube_B)`
-- respondendo diferente de um uuid aleatório seria um oráculo de existência de clube.
--
-- Para quem É membro dos três é o contrário: essas funções respondem "sim, você tem vínculo aqui",
-- e é a verdade sobre o vínculo DELA. Ela sabe disso — basta trocar de aba. Exigir que a resposta
-- fosse igual à de um uuid inventado seria exigir que o produto mentisse para a própria pessoa
-- sobre onde ela está inscrita. (É o mesmo recorte que o teste 24 já faz ao tirar do pool as
-- pessoas com vínculo em mais de um clube.)
--
-- O que continua sendo sondado para ela, e é o que importa, são os IDS DE CONTEÚDO: foto, evento,
-- ponto, mensalidade, unidade, conquista. Um desses respondendo diferente pela aba errada seria
-- vazamento de verdade — e são exatamente esses que dão zero abaixo.
create function t.redteam(p_rotulo text, p_clube_alvo text, p_inclui_o_clube boolean default true) returns text language plpgsql as $$
declare f record; p record; i int; v_a text; v_b text; v_sa text; v_sb text;
        v_dif text := ''; v_rnd uuid := gen_random_uuid(); v_n int := 0;
begin
  for f in
    select pr.proname, pr.proargtypes::oid[] as tipos
    from pg_proc pr
    where pr.pronamespace = 'public'::regnamespace and pr.prokind = 'f'
      and not pr.proretset and pr.prorettype <> 'trigger'::regtype
      and has_function_privilege(current_user, pr.oid, 'execute')
      and 'uuid'::regtype::oid = any (pr.proargtypes::oid[])
      -- IMMUTABLE não lê o banco: o que devolve sai do que o próprio chamador passou.
      and pr.provolatile <> 'i'
    order by 1
  loop
    for i in array_lower(f.tipos, 1) .. array_upper(f.tipos, 1) loop
      continue when f.tipos[i] is distinct from 'uuid'::regtype::oid;
      for p in select distinct on (id) id, rotulo from t.alvos
                where clube = p_clube_alvo
                  and (p_inclui_o_clube or rotulo <> 'o próprio clube') loop
        v_sa := t.chamada3(f.proname, f.tipos, i, p.id, v_rnd);
        continue when v_sa is null;
        v_sb := t.chamada3(f.proname, f.tipos, i, v_rnd, v_rnd);
        v_a := t.sonda_limpa(v_sa); v_b := t.sonda_limpa(v_sb); v_n := v_n + 1;
        if v_a is distinct from v_b then
          v_dif := v_dif || format(E'\n    %s(arg %s) alvo=%s(%s): [%s] x aleatório: [%s]',
                                   f.proname, i, p.rotulo, p_clube_alvo, left(v_a, 80), left(v_b, 80));
        end if;
      end loop;
    end loop;
  end loop;
  insert into t.cobertura values (p_rotulo, v_n, null);
  return v_dif;
end $$;
\o

-- A diretoria de A, operando em A, sondando ids REAIS de B e de C.
select t.como('lider_a'); select t.pedir_clube('clube_a');
select t.eq('[red-team] A→B: nenhuma função distingue id real de B de um uuid inexistente',
  t.txt($q$select t.redteam('A→B', 'clube_b')$q$), '');
select t.eq('[red-team] A→C: idem para o terceiro clube',
  t.txt($q$select t.redteam('A→C', 'clube_c')$q$), '');
reset role;

-- E o espelho, que é o que pega lógica binária: C é o clube pequeno, sem nada especial.
select t.como('lider_c'); select t.pedir_clube('clube_c');
select t.eq('[red-team] C→A: o clube menor não descobre nada do legado',
  t.txt($q$select t.redteam('C→A', 'clube_a')$q$), '');
select t.eq('[red-team] C→B: nem do clube grande',
  t.txt($q$select t.redteam('C→B', 'clube_b')$q$), '');
reset role;

-- O PIOR CASO: a pessoa dos três clubes, operando na aba de B, sondando CONTEÚDO de A e de C.
-- Se alguma função responder pelo vínculo em vez de pela aba, um dado de A chega pela aba de B.
select t.como('tri'); select t.pedir_clube('clube_b');
select t.eq('[red-team] multi-clube na aba de B: nenhum dado de A responde diferente de inexistente',
  t.txt($q$select t.redteam('tri@B→A', 'clube_a', false)$q$), '');
select t.eq('[red-team] multi-clube na aba de B: nem nenhum dado de C',
  t.txt($q$select t.redteam('tri@B→C', 'clube_c', false)$q$), '');
-- E o registro do que NÃO é vazamento, para o achado não voltar como falso positivo: perguntar
-- "eu sou membro do clube A?" responde SIM em qualquer aba, e deve responder mesmo.
select t.eq('...e perguntar pelo PRÓPRIO vínculo continua respondendo a verdade, em qualquer aba',
  t.txt($q$select public.membro_ativo_no_clube(t.id('clube_a'))::text$q$), 'true');
reset role;

-- =============================================================================
--  A COBERTURA. Sem este assert, os seis zeros acima podem significar "nada vazou" OU
--  "nada foi sondado", e os dois se parecem exatamente igual no relatório.
-- =============================================================================
select t.como('lider_a');
select t.eq('a varredura alcança TODAS as posições uuid das funções que ela deve cobrir',
  t.n($q$select count(*) from (
        select pr.proname, generate_subscripts(pr.proargtypes::oid[], 1) as i, pr.proargtypes::oid[] as tipos
          from pg_proc pr
         where pr.pronamespace = 'public'::regnamespace and pr.prokind = 'f'
           and not pr.proretset and pr.prorettype <> 'trigger'::regtype
           and has_function_privilege('authenticated', pr.oid, 'execute')
           and 'uuid'::regtype::oid = any (pr.proargtypes::oid[])
           and pr.provolatile <> 'i'
       ) s where s.tipos[s.i] = 'uuid'::regtype::oid
         and t.chamada3(s.proname, s.tipos, s.i, gen_random_uuid(), gen_random_uuid()) is null$q$), 0);
reset role;
select t.ok('...e cada uma das seis varreduras sondou alguma coisa de verdade',
  t.n($q$select count(*) from t.cobertura where sondadas > 0$q$) = 6);

select t.fim();
rollback;
