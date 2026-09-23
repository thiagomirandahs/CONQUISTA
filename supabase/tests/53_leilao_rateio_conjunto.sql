-- =============================================================================
--  Fase 8.3 — O RATEIO DO LANCE CONJUNTO, de ponta a ponta.
--
--  O bug que este arquivo fecha foi encontrado pelo red-team da fase 8.2, e vale descrevê-lo com
--  precisão porque metade dele é correta:
--
--    · a COBRANÇA no fechamento sempre esteve certa: método dos maiores restos, ponderado pelos
--      pontos de cada unidade, somando exatamente o valor do lance;
--    · a RESERVA não. `leilao_saldo_unidade` subtrai `sum(l.valor)` do lance inteiro de CADA
--      unidade participante. Num lance conjunto de N unidades, o mesmo valor é reservado N vezes.
--
--  O red-team chegou a 1.800.000 reservados de uma unidade com 27 pontos próprios — 66.000x —
--  usando só chamadas legítimas da API. E o efeito não é só um número feio na tela: como a
--  confirmação decide por `soma dos saldos >= valor`, e os saldos vêm dessa mesma conta inflada,
--  uma unidade que entra em dois lances conjuntos fica com saldo zero e passa a bloquear lances
--  legítimos de que ela participaria.
--
--  A regra que este teste trava: **RESERVA e COBRANÇA saem da MESMA conta.** Não "parecidas" —
--  a mesma função. Duas contas equivalentes hoje divergem no primeiro ajuste que alguém fizer
--  numa delas.
--
--  O que NÃO muda, e está testado aqui para provar que não mudou:
--    · o peso do rateio continua sendo os pontos da unidade (quem tem mais, paga mais);
--    · o teto por unidade no fechamento (ninguém é cobrado além do que tem) continua valendo;
--    · lance solo continua reservando e cobrando o valor cheio;
--    · o desempate do resto continua sendo maior fração, depois menor uuid.
-- =============================================================================
begin;
\ir _lib.sql
\ir _fixtures.sql

\o /dev/null
alter default privileges in schema t grant select on tables to public;

-- Três unidades no clube A, com pontos DIFERENTES de propósito: o rateio é ponderado, então
-- pesos iguais esconderiam metade dos erros possíveis.
insert into public.unidades (nome, cor, club_id) values ('Teste A3', '#555555', t.id('clube_a'));
insert into t.ids (chave, id) select 'A3', id from public.unidades where nome = 'Teste A3';
select t.mk('membro_a3', 'Membro A3', 'desbravador', 'ativo', 'clube_a', 'A3', date '2014-08-08');

-- A1 já tem 15 dos fixtures (5 da unidade + 10 do membro). Fechando em 300 / 200 / 100.
insert into public.pontos (unidade_id, origem, pontos, motivo, club_id)
values (t.id('A1'), 'unidade', 285, 'saldo A1', t.id('clube_a')),
       (t.id('A2'), 'unidade', 200, 'saldo A2', t.id('clube_a')),
       (t.id('A3'), 'unidade', 100, 'saldo A3', t.id('clube_a'));

insert into public.club_features (club_id, feature, enabled) values (t.id('clube_a'), 'leilao', true)
on conflict (club_id, feature) do update set enabled = true;

-- Um leilão com vários itens: alguns cenários precisam de itens separados.
insert into public.leiloes (titulo, fecha_em, criado_por, club_id)
values ('Leilão do rateio', now() + interval '1 day', t.id('lider_a'), t.id('clube_a'));
insert into t.ids select 'leilao', id from public.leiloes where titulo = 'Leilão do rateio';
insert into public.leilao_itens (leilao_id, nome, preco_base, incremento_minimo, ordem, club_id)
select t.id('leilao'), 'Item ' || g, 10, 1, g, t.id('clube_a') from generate_series(1, 5) g;
insert into t.ids select 'item' || ordem, id from public.leilao_itens where leilao_id = t.id('leilao');

-- Monta um lance CONJUNTO já confirmado por todos (o estado que o fechamento vai cobrar).
create function t.lance_conjunto(p_item text, p_valor int, p_unidades text[]) returns uuid
language plpgsql as $$
declare v_id uuid; u text;
begin
  insert into public.leilao_lances (item_id, criado_por, valor, status, club_id)
  values (t.id(p_item), t.id('membro_a'), p_valor, 'ativo', t.id('clube_a')) returning id into v_id;
  foreach u in array p_unidades loop
    insert into public.leilao_lance_unidades (lance_id, unidade_id, confirmado, club_id)
    values (v_id, t.id(u), true, t.id('clube_a'));
  end loop;
  return v_id;
end $$;

-- Quanto cada unidade tem, de verdade, sem passar pelo gate de requisição.
-- security definer: `_pontos_temporada_unidade_interno` nao e concedida a `authenticated` (e a
-- variante sem gate, usada pelo cron). O teste precisa do peso REAL para conferir o rateio.
create function t.pontos(p_unidade text) returns int language sql stable security definer set search_path = '' as $$
  select public._pontos_temporada_unidade_interno(t.id(p_unidade));
$$;
-- O saldo DISPONÍVEL como o app o vê (o que a reserva desconta).
-- Esta NAO e security definer de proposito: ela tem de passar pelo gate de requisicao, porque e
-- exatamente o numero que o app enxerga.
create function t.saldo(p_unidade text) returns int language sql stable as $$
  select public.leilao_saldo_unidade(t.id(p_unidade));
$$;
-- A soma das parcelas de um lance. security definer porque `_leilao_rateio` e interna — nao e
-- concedida a `authenticated`, e nao deve ser: ela le pontos de qualquer unidade.
create function t.rateio_total(p_lance uuid) returns int
language sql stable security definer set search_path = '' as $$
  select coalesce(sum(parcela), 0)::int from public._leilao_rateio(p_lance);
$$;
-- O que foi de fato cobrado de uma unidade no leilão.
create function t.cobrado(p_unidade text) returns int language sql stable security definer set search_path = '' as $$
  select coalesce(-sum(pontos), 0)::int from public.pontos
   where unidade_id = t.id(p_unidade) and origem = 'leilao' and pontos < 0;
$$;
\o

select t.eq('linha de base: A1 tem 300 pontos', t.n($q$select t.pontos('A1')$q$), 300);
select t.eq('linha de base: A2 tem 200', t.n($q$select t.pontos('A2')$q$), 200);
select t.eq('linha de base: A3 tem 100', t.n($q$select t.pontos('A3')$q$), 100);

-- =============================================================================
--  1. A REPRODUÇÃO — a reserva multiplicada
-- =============================================================================
-- Um lance conjunto de 120 entre A1 e A2. A obrigação econômica do par é 120, não 240.
\o /dev/null
create table t.l1 as select t.lance_conjunto('item1', 120, array['A1','A2']) id;
\o
select t.como('membro_a');
select t.pedir_clube('clube_a');

-- É AQUI que o bug aparecia: cada unidade via 120 descontados, somando 240 de reserva para uma
-- dívida de 120.
select t.eq('a reserva TOTAL do lance conjunto é o valor do lance, não valor x nº de unidades',
  t.n($q$select (t.pontos('A1') - t.saldo('A1')) + (t.pontos('A2') - t.saldo('A2'))$q$), 120);
select t.eq('...e a parte de A1 é a que ela vai mesmo pagar (300 de 500 = 72)',
  t.n($q$select t.pontos('A1') - t.saldo('A1')$q$), 72);
select t.eq('...e a de A2 idem (200 de 500 = 48)',
  t.n($q$select t.pontos('A2') - t.saldo('A2')$q$), 48);
select t.eq('a unidade de fora não é afetada', t.n($q$select t.saldo('A3')$q$), 100);
reset role;

-- O cenário exato do red-team: a MESMA unidade em dois lances conjuntos, com parceiras ricas.
-- Antes, os dois valores cheios eram descontados dela e o saldo ia a zero.
\o /dev/null
create table t.l2 as select t.lance_conjunto('item2', 150, array['A3','A1']) id;
\o
select t.como('membro_a');
select t.pedir_clube('clube_a');
-- 150 entre A3 (100) e A1 (300): 37,5 e 112,5 — as duas fracoes empatam em 0,5, entao o +1 vai
-- para o MENOR uuid. O valor exato de A3 depende de quem ganha esse desempate, por isso o assert
-- e sobre a REGRA (37 ou 38) e nao sobre um numero fixo: os uuids dos fixtures mudam a cada run.
select t.ok('A3 em dois lances: a reserva dela é a parte dela, nao o valor cheio dos dois',
  t.n($q$select t.pontos('A3') - t.saldo('A3')$q$) in (37, 38));
select t.ok('...e o saldo dela continua positivo (antes zerava e bloqueava lance legítimo)',
  t.n($q$select t.saldo('A3')$q$) > 0);
-- A soma das duas parcelas DESTE lance e 150 exatos, independente de quem levou o resto.
select t.eq('a reserva total do segundo lance também fecha em 150',
  t.n($q$select t.rateio_total((select id from t.l2))$q$), 150);
reset role;

-- =============================================================================
--  2. RESERVA = COBRANÇA. É a invariante central desta fase.
-- =============================================================================
\o /dev/null
-- guarda o que estava reservado de cada unidade ANTES de encerrar
create table t.reservado as
  select 'A1' u, t.pontos('A1') - t.saldo('A1') v
  union all select 'A2', t.pontos('A2') - t.saldo('A2')
  union all select 'A3', t.pontos('A3') - t.saldo('A3');
\o
select t.como('lider_a');
select t.pedir_clube('clube_a');
select t.permitido('a liderança encerra o leilão', $q$select public.encerrar_leilao(t.id('leilao'))$q$, 0);
reset role;

select t.eq('A1: o que foi COBRADO é exatamente o que estava RESERVADO',
  t.n($q$select t.cobrado('A1')$q$), t.n($q$select v from t.reservado where u = 'A1'$q$));
select t.eq('A2: idem', t.n($q$select t.cobrado('A2')$q$), t.n($q$select v from t.reservado where u = 'A2'$q$));
select t.eq('A3: idem', t.n($q$select t.cobrado('A3')$q$), t.n($q$select v from t.reservado where u = 'A3'$q$));
select t.eq('a soma cobrada é a soma dos dois lances (120 + 150), nem um ponto a mais',
  t.n($q$select t.cobrado('A1') + t.cobrado('A2') + t.cobrado('A3')$q$), 270);

-- =============================================================================
--  3. DIVISÃO NÃO EXATA e o resto de 1 ponto
-- =============================================================================
-- 100 entre três unidades de pesos 300/200/100 (soma 600) = 50 / 33,33 / 16,66.
-- Base: 50 + 33 + 16 = 99. Sobra 1, e ele vai para a MAIOR fração — A3 (0,666) ganha de A2 (0,333).
\o /dev/null
reset role;
delete from public.pontos where origem = 'leilao';
update public.leiloes set status = 'aberto', encerrado_em = null where id = t.id('leilao');
update public.leilao_lances set status = 'superado' where club_id = t.id('clube_a');
update public.leilao_itens set vencedor_lance_id = null where leilao_id = t.id('leilao');
create table t.l3 as select t.lance_conjunto('item3', 100, array['A1','A2','A3']) id;
\o
select t.como('membro_a');
select t.pedir_clube('clube_a');
select t.eq('divisão não exata: as três parcelas somam EXATAMENTE o valor do lance',
  t.n($q$select (t.pontos('A1') - t.saldo('A1')) + (t.pontos('A2') - t.saldo('A2')) + (t.pontos('A3') - t.saldo('A3'))$q$), 100);
select t.eq('A1 (peso 300/600) fica com 50', t.n($q$select t.pontos('A1') - t.saldo('A1')$q$), 50);
select t.eq('A2 (peso 200/600 = 33,33) fica com 33 — fração 0,33 perde o desempate',
  t.n($q$select t.pontos('A2') - t.saldo('A2')$q$), 33);
select t.eq('A3 (peso 100/600 = 16,66) fica com 17 — a MAIOR fração absorve o resto',
  t.n($q$select t.pontos('A3') - t.saldo('A3')$q$), 17);
reset role;

-- Empate de FRAÇÃO: duas unidades de peso idêntico dividindo um valor ímpar. O desempate tem de
-- ser determinístico, e é o menor uuid — não "qualquer uma", não a ordem de inserção.
\o /dev/null
reset role;
update public.leilao_lances set status = 'superado' where club_id = t.id('clube_a');
insert into public.unidades (nome, cor, club_id) values ('Teste A4', '#666666', t.id('clube_a'));
insert into t.ids (chave, id) select 'A4', id from public.unidades where nome = 'Teste A4';
insert into public.pontos (unidade_id, origem, pontos, motivo, club_id)
values (t.id('A4'), 'unidade', 100, 'saldo A4', t.id('clube_a'));
create table t.l4 as select t.lance_conjunto('item4', 101, array['A3','A4']) id;
\o
select t.como('membro_a');
select t.pedir_clube('clube_a');
select t.eq('empate de fração: as duas parcelas ainda somam o valor exato',
  t.n($q$select (t.pontos('A3') - t.saldo('A3')) + (t.pontos('A4') - t.saldo('A4'))$q$), 101);
select t.eq('o resto vai para a unidade de MENOR uuid — regra fixa, não sorteio',
  t.txt($q$select case when t.id('A3') < t.id('A4') then 'A3' else 'A4' end$q$),
  t.txt($q$select case when (t.pontos('A3') - t.saldo('A3')) > (t.pontos('A4') - t.saldo('A4')) then 'A3' else 'A4' end$q$));
select t.eq('e a regra é ESTÁVEL: consultar de novo dá o mesmo resultado',
  t.n($q$select t.pontos('A3') - t.saldo('A3')$q$), t.n($q$select t.pontos('A3') - t.saldo('A3')$q$));
reset role;

-- =============================================================================
--  4. Lance SOLO não mudou — a regra econômica legítima continua de pé
-- =============================================================================
\o /dev/null
reset role;
update public.leilao_lances set status = 'superado' where club_id = t.id('clube_a');
create table t.l5 as select t.lance_conjunto('item5', 80, array['A1']) id;
\o
select t.como('membro_a');
select t.pedir_clube('clube_a');
select t.eq('lance solo reserva o valor CHEIO da unidade que o deu',
  t.n($q$select t.pontos('A1') - t.saldo('A1')$q$), 80);
reset role;

-- =============================================================================
--  5. CANCELAMENTO libera a reserva
-- =============================================================================
select t.como('lider_a');
select t.pedir_clube('clube_a');
select t.permitido('a liderança cancela o leilão', $q$select public.cancelar_leilao(t.id('leilao'))$q$, 0);
reset role;
select t.como('membro_a');
select t.pedir_clube('clube_a');
select t.eq('cancelado: a reserva some e o saldo volta ao total', t.n($q$select t.saldo('A1')$q$), 300);
select t.eq('...e ninguém foi cobrado', t.n($q$select t.cobrado('A1') + t.cobrado('A2') + t.cobrado('A3')$q$), 0);
reset role;

-- =============================================================================
--  6. CRON x ENCERRAMENTO MANUAL — a área que já divergiu antes
-- =============================================================================
-- Monta DOIS leilões idênticos, em clubes diferentes, com o mesmo lance conjunto. Um fecha pela
-- liderança, o outro pelo cron (sem sessão nenhuma). O resultado tem de ser o mesmo número.
\o /dev/null
reset role;
insert into public.unidades (nome, cor, club_id) values ('Teste B2', '#777777', t.id('clube_b'));
insert into t.ids (chave, id) select 'B2', id from public.unidades where nome = 'Teste B2';
insert into public.pontos (unidade_id, origem, pontos, motivo, club_id)
values (t.id('B1'), 'unidade', 273, 'saldo B1', t.id('clube_b')),
       (t.id('B2'), 'unidade', 200, 'saldo B2', t.id('clube_b'));
insert into public.club_features (club_id, feature, enabled) values (t.id('clube_b'), 'leilao', true)
on conflict (club_id, feature) do update set enabled = true;

-- clube A: leilão que a liderança encerra
update public.leiloes set status = 'aberto', encerrado_em = null where id = t.id('leilao');
update public.leilao_lances set status = 'superado' where club_id = t.id('clube_a');
create table t.manual as select t.lance_conjunto('item1', 120, array['A1','A2']) id;

-- clube B: leilão VENCIDO, que o cron vai fechar
insert into public.leiloes (titulo, fecha_em, criado_por, club_id)
values ('Leilão B vencido', now() - interval '1 minute', t.id('lider_b'), t.id('clube_b'));
insert into t.ids select 'leilao_b', id from public.leiloes where titulo = 'Leilão B vencido';
insert into public.leilao_itens (leilao_id, nome, preco_base, incremento_minimo, ordem, club_id)
values (t.id('leilao_b'), 'Item B', 10, 1, 1, t.id('clube_b'));
insert into t.ids select 'item_b', id from public.leilao_itens where leilao_id = t.id('leilao_b');
do $$
declare v uuid;
begin
  insert into public.leilao_lances (item_id, criado_por, valor, status, club_id)
  values (t.id('item_b'), t.id('membro_b'), 120, 'ativo', t.id('clube_b')) returning id into v;
  insert into public.leilao_lance_unidades (lance_id, unidade_id, confirmado, club_id)
  values (v, t.id('B1'), true, t.id('clube_b')), (v, t.id('B2'), true, t.id('clube_b'));
end $$;
\o

-- Os dois cenários são espelhados: A1=300/A2=200 e B1=300/B2=200, mesmo valor de lance.
select t.eq('os dois cenários partem dos mesmos pesos (A1=B1)', t.n($q$select t.pontos('A1')$q$), t.n($q$select t.pontos('B1')$q$));
select t.eq('...e (A2=B2)', t.n($q$select t.pontos('A2')$q$), t.n($q$select t.pontos('B2')$q$));

select t.como('lider_a');
select t.pedir_clube('clube_a');
select t.permitido('clube A: a liderança encerra', $q$select public.encerrar_leilao(t.id('leilao'))$q$, 0);
reset role;

-- O cron roda SEM sessão: auth.uid() é nulo. É exatamente aqui que as duas vias já divergiram
-- antes (a função de pontos por clube devolve 0 sem sessão — por isso o fechamento usa a variante
-- interna, e este teste é a guarda de que ela continua sendo usada).
select t.como_cron();
select t.permitido('clube B: o cron fecha o leilão vencido', $q$select public.fechar_leiloes_vencidos()$q$, 0);
reset role;

select t.eq('cron e manual cobram EXATAMENTE o mesmo da unidade de maior peso',
  t.n($q$select t.cobrado('A1')$q$), t.n($q$select t.cobrado('B1')$q$));
select t.eq('...e da de menor peso', t.n($q$select t.cobrado('A2')$q$), t.n($q$select t.cobrado('B2')$q$));
select t.eq('o total cobrado pelo cron é o valor do lance, sem multiplicação',
  t.n($q$select t.cobrado('B1') + t.cobrado('B2')$q$), 120);
select t.eq('o cron não registrou falha nenhuma',
  t.n($q$select count(*) from public.cron_falhas where rotina = 'fechar_leiloes_vencidos'$q$), 0);
select t.eq('o leilão do cron ficou encerrado',
  t.txt($q$select status from public.leiloes where id = t.id('leilao_b')$q$), 'encerrado');

-- =============================================================================
--  7. IDEMPOTÊNCIA e RETRY do fechamento
-- =============================================================================
-- Fechar duas vezes não pode cobrar duas vezes. O manual recusa (status já mudou); o cron nem vê
-- o leilão (o `where status = 'aberto'` já o exclui).
\o /dev/null
create table t.cobrado_antes as select t.cobrado('A1') a1, t.cobrado('B1') b1;
\o
select t.como('lider_a');
select t.pedir_clube('clube_a');
select t.throws('encerrar de novo é recusado', $q$select public.encerrar_leilao(t.id('leilao'))$q$, 'já foi encerrado');
reset role;
select t.como_cron();
select t.permitido('o cron roda de novo sem erro', $q$select public.fechar_leiloes_vencidos()$q$, 0);
select t.permitido('...e mais uma vez', $q$select public.fechar_leiloes_vencidos()$q$, 0);
reset role;
select t.eq('nenhum ponto a mais foi cobrado de A1', t.n($q$select t.cobrado('A1')$q$), t.n($q$select a1 from t.cobrado_antes$q$));
select t.eq('nenhum ponto a mais foi cobrado de B1', t.n($q$select t.cobrado('B1')$q$), t.n($q$select b1 from t.cobrado_antes$q$));

-- =============================================================================
--  8. O TETO POR UNIDADE — regra econômica legítima, tem de continuar valendo
-- =============================================================================
-- Unidade pobre num lance conjunto caro: a parcela dela é limitada ao que ela tem. O teto só
-- REDUZ a cobrança, então a soma cobrada nunca passa do valor do lance.
\o /dev/null
reset role;
delete from public.pontos where origem = 'leilao';
update public.leiloes set status = 'aberto', encerrado_em = null where id = t.id('leilao');
update public.leilao_lances set status = 'superado' where club_id = t.id('clube_a');
update public.leilao_itens set vencedor_lance_id = null where leilao_id = t.id('leilao');
-- A3 tem 100; num lance de 100 com A1 (300) o rateio daria 25 a A3 — dentro do que ela tem.
create table t.l6 as select t.lance_conjunto('item2', 100, array['A1','A3']) id;
\o
select t.como('lider_a');
select t.pedir_clube('clube_a');
select t.permitido('encerra o leilão do teto', $q$select public.encerrar_leilao(t.id('leilao'))$q$, 0);
reset role;
select t.eq('a soma cobrada é o valor do lance', t.n($q$select t.cobrado('A1') + t.cobrado('A3')$q$), 100);
select t.ok('nenhuma unidade foi cobrada além do que tinha',
  t.n($q$select count(*) from public.unidades u
       where u.club_id = t.id('clube_a')
         and coalesce((select -sum(p.pontos) from public.pontos p
                        where p.unidade_id = u.id and p.origem = 'leilao' and p.pontos < 0), 0)
             > public._pontos_temporada_unidade_interno(u.id)
               + coalesce((select -sum(p2.pontos) from public.pontos p2
                            where p2.unidade_id = u.id and p2.origem = 'leilao' and p2.pontos < 0), 0)$q$) = 0);
select t.ok('...e nenhuma unidade ficou com pontos negativos',
  t.n($q$select count(*) from public.unidades u where u.club_id = t.id('clube_a')
       and public._pontos_temporada_unidade_interno(u.id) < 0$q$) = 0);

-- =============================================================================
--  9. O CICLO INTEIRO pelas RPCs reais: lance -> confirmação -> cobrança
-- =============================================================================
-- Até aqui os lances foram montados à mão, para controlar o cenário. Esta seção percorre o
-- caminho que o app percorre — dar_lance, confirmar_lance_conjunto, encerrar — porque é onde a
-- reserva e a confirmação conversam: a confirmação decide por `soma dos saldos >= valor`, e os
-- saldos são justamente o número que estava inflado.
\o /dev/null
reset role;
delete from public.pontos where origem = 'leilao';
update public.leiloes set status = 'aberto', encerrado_em = null where id = t.id('leilao');
update public.leilao_lances set status = 'superado' where club_id = t.id('clube_a');
update public.leilao_itens set vencedor_lance_id = null where leilao_id = t.id('leilao');
\o

select t.como('membro_a');
select t.pedir_clube('clube_a');
-- membro_a é da A1 (300). Convida A2 (200) e A3 (100) para um lance de 550 no item 3.
-- Sozinha, A1 não teria os 550; juntas, as três têm 600. É o caso de uso do lance conjunto.
select t.permitido('A1 abre um lance conjunto de 550 com A2 e A3',
  $q$select public.dar_lance(t.id('item3'), 550, array[t.id('A2'), t.id('A3')])$q$, 0);
\o /dev/null
reset role;
create table t.lc as select id from public.leilao_lances
 where item_id = t.id('item3') and status = 'pendente' order by created_at desc limit 1;
\o
select t.eq('o lance nasce PENDENTE, esperando as duas confirmarem',
  t.txt($q$select status from public.leilao_lances where id = (select id from t.lc)$q$), 'pendente');
select t.como('membro_a');
select t.pedir_clube('clube_a');
select t.eq('...e ainda não reserva nada (ninguém confirmou)',
  t.n($q$select t.pontos('A1') - t.saldo('A1')$q$), 0);
reset role;

-- A primeira confirmação não ativa: ainda falta uma.
select t.como('membro_a2');
select t.pedir_clube('clube_a');
select t.eq('A2 confirma: o lance continua pendente, falta 1',
  t.txt($q$select (public.confirmar_lance_conjunto((select id from t.lc)) ->> 'ativado')$q$), 'false');

-- RETRY / IDEMPOTÊNCIA: confirmar de novo não pode contar duas vezes nem ativar sozinho.
select t.throws('A2 confirmando DE NOVO é recusado (não conta duas vezes)',
  $q$select public.confirmar_lance_conjunto((select id from t.lc))$q$, 'não precisa confirmar');
reset role;
select t.eq('...e o lance segue pendente, com exatamente uma confirmação faltando',
  t.n($q$select count(*) from public.leilao_lance_unidades
       where lance_id = (select id from t.lc) and confirmado = false$q$), 1);

-- Quem propôs já entra confirmado e não confirma de novo.
select t.como('membro_a');
select t.pedir_clube('clube_a');
select t.throws('a unidade que PROPÔS não confirma de novo',
  $q$select public.confirmar_lance_conjunto((select id from t.lc))$q$, 'não precisa confirmar');
reset role;

-- A última confirmação ativa o lance.
select t.como('membro_a3');
select t.pedir_clube('clube_a');
select t.eq('A3 confirma: o lance ATIVA',
  t.txt($q$select (public.confirmar_lance_conjunto((select id from t.lc)) ->> 'ativado')$q$), 'true');
reset role;
select t.eq('o lance ficou ativo', t.txt($q$select status from public.leilao_lances where id = (select id from t.lc)$q$), 'ativo');

-- E agora a reserva aparece — repartida, não multiplicada.
select t.como('membro_a');
select t.pedir_clube('clube_a');
select t.eq('a reserva total do lance ativado é 550, não 1.650 (3 x 550)',
  t.n($q$select (t.pontos('A1') - t.saldo('A1')) + (t.pontos('A2') - t.saldo('A2')) + (t.pontos('A3') - t.saldo('A3'))$q$), 550);
select t.ok('nenhuma unidade ficou com saldo negativo por causa da reserva',
  t.n($q$select least(t.saldo('A1'), least(t.saldo('A2'), t.saldo('A3')))$q$) >= 0);
reset role;

-- E a cobrança fecha igual à reserva.
\o /dev/null
reset role;
create table t.res9 as
  select 'A1' u, t.pontos('A1') - public.leilao_saldo_unidade(t.id('A1')) v
  union all select 'A2', t.pontos('A2') - public.leilao_saldo_unidade(t.id('A2'))
  union all select 'A3', t.pontos('A3') - public.leilao_saldo_unidade(t.id('A3'));
\o
select t.como('lider_a');
select t.pedir_clube('clube_a');
select t.permitido('encerra', $q$select public.encerrar_leilao(t.id('leilao'))$q$, 0);
reset role;
select t.eq('cobrado = reservado em A1', t.n($q$select t.cobrado('A1')$q$), t.n($q$select v from t.res9 where u='A1'$q$));
select t.eq('cobrado = reservado em A2', t.n($q$select t.cobrado('A2')$q$), t.n($q$select v from t.res9 where u='A2'$q$));
select t.eq('cobrado = reservado em A3', t.n($q$select t.cobrado('A3')$q$), t.n($q$select v from t.res9 where u='A3'$q$));
select t.eq('a soma cobrada é o valor do lance',
  t.n($q$select t.cobrado('A1') + t.cobrado('A2') + t.cobrado('A3')$q$), 550);

-- =============================================================================
--  10. CONCORRÊNCIA e reentrância na confirmação
-- =============================================================================
-- A trava é o `for update` na linha do leilão, que serializa as confirmações; e o
-- `status <> 'pendente'` impede uma segunda chegada de reativar o que já ativou.
\o /dev/null
reset role;
delete from public.pontos where origem = 'leilao';
update public.leiloes set status = 'aberto', encerrado_em = null where id = t.id('leilao');
update public.leilao_lances set status = 'superado' where club_id = t.id('clube_a');
update public.leilao_itens set vencedor_lance_id = null where leilao_id = t.id('leilao');
\o
select t.como('membro_a');
select t.pedir_clube('clube_a');
select t.permitido('novo lance conjunto A1+A2', $q$select public.dar_lance(t.id('item4'), 200, array[t.id('A2')])$q$, 0);
reset role;
\o /dev/null
create table t.lc2 as select id from public.leilao_lances
 where item_id = t.id('item4') and status = 'pendente' order by created_at desc limit 1;
\o
select t.como('membro_a2');
select t.pedir_clube('clube_a');
select t.eq('A2 confirma e ativa', t.txt($q$select (public.confirmar_lance_conjunto((select id from t.lc2)) ->> 'ativado')$q$), 'true');
select t.throws('a segunda chegada da mesma confirmação é recusada',
  $q$select public.confirmar_lance_conjunto((select id from t.lc2))$q$, 'não precisa confirmar');
reset role;
select t.eq('existe UM lance ativo neste item, não dois',
  t.n($q$select count(*) from public.leilao_lances where item_id = t.id('item4') and status = 'ativo'$q$), 1);
select t.como('membro_a');
select t.pedir_clube('clube_a');
select t.eq('e a reserva do item é 200, não 400',
  t.n($q$select (t.pontos('A1') - t.saldo('A1')) + (t.pontos('A2') - t.saldo('A2'))$q$), 200);
reset role;

select t.fim();
rollback;
