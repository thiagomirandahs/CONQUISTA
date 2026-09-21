-- Prioridade 1: o fechamento AUTOMÁTICO (pg_cron, sem auth.uid()) deve cobrar
-- exatamente o mesmo que o botão "Encerrar agora" (com a sessão da liderança).
begin;
\ir _lib.sql
\ir _fixtures.sql

-- saldo: A1 = 5 + 10 (membro) + 495 = 510 | A2 = 300
insert into public.pontos (unidade_id, origem, pontos, motivo)
values (t.id('A1'), 'unidade', 495, 'saldo A1'), (t.id('A2'), 'unidade', 300, 'saldo A2');

-- leilão do clube A com 2 itens: item 1 = lance SOLO de A1 (100); item 2 = lance CONJUNTO A1+A2 (200)
insert into public.leiloes (titulo, fecha_em, criado_por) values ('Leilão teste', now() + interval '1 day', t.id('lider_a'));
insert into t.ids select 'leilao', id from public.leiloes where titulo = 'Leilão teste';
insert into public.leilao_itens (leilao_id, nome, preco_base, ordem)
values (t.id('leilao'), 'Item 1', 10, 1), (t.id('leilao'), 'Item 2', 10, 2);
insert into t.ids select 'item1', id from public.leilao_itens where leilao_id = t.id('leilao') and nome = 'Item 1';
insert into t.ids select 'item2', id from public.leilao_itens where leilao_id = t.id('leilao') and nome = 'Item 2';
insert into public.leilao_lances (item_id, criado_por, valor, status) values (t.id('item1'), t.id('membro_a'), 100, 'ativo');
insert into public.leilao_lances (item_id, criado_por, valor, status) values (t.id('item2'), t.id('membro_a'), 200, 'ativo');
insert into public.leilao_lance_unidades (lance_id, unidade_id, confirmado)
select l.id, t.id('A1'), true from public.leilao_lances l where l.item_id in (t.id('item1'), t.id('item2'));
insert into public.leilao_lance_unidades (lance_id, unidade_id, confirmado)
select l.id, t.id('A2'), true from public.leilao_lances l where l.item_id = t.id('item2');

create function t.cobrancas() returns text language sql as $$
  select coalesce(string_agg(u.nome || ':' || x.s, ',' order by u.nome), '(nenhuma)')
  from (select unidade_id, sum(pontos) s from public.pontos where origem = 'leilao' group by 1) x
  join public.unidades u on u.id = x.unidade_id;
$$;

-- (A) fechamento pelo CRON: postgres, sem sessão de usuário
savepoint sp_cron;
update public.leiloes set fecha_em = now() - interval '1 minute' where id = t.id('leilao');
select t.como_cron();
select public.fechar_leiloes_vencidos();
reset role;
select t.cobrancas() as cobr_cron,
       (select status from public.leiloes where id = t.id('leilao')) as st_cron,
       (select count(*) from public.leilao_lances where status = 'vencedor' and item_id in (t.id('item1'), t.id('item2'))) as venc_cron
\gset
rollback to savepoint sp_cron;

-- (B) fechamento MANUAL: botão "Encerrar agora" (liderança do clube A)
savepoint sp_manual;
select t.como('lider_a');
select public.encerrar_leilao(t.id('leilao'));
reset role;
select t.cobrancas() as cobr_manual,
       (select status from public.leiloes where id = t.id('leilao')) as st_manual,
       (select count(*) from public.leilao_lances where status = 'vencedor' and item_id in (t.id('item1'), t.id('item2'))) as venc_manual
\gset
rollback to savepoint sp_manual;

-- esperado: A1 paga 100 + 126 (rateio 510:300 de 200, maiores restos) = 226 | A2 paga 74
select t.eq('cron: cobra os pontos dos vencedores (não zero)', :'cobr_cron', 'Teste A1:-226,Teste A2:-74');
select t.eq('manual: cobra os pontos dos vencedores', :'cobr_manual', 'Teste A1:-226,Teste A2:-74');
select t.eq('cron == manual (exatamente o mesmo rateio)', :'cobr_cron', :'cobr_manual');
select t.eq('cron: leilão vira encerrado', :'st_cron', 'encerrado');
select t.eq('manual: leilão vira encerrado', :'st_manual', 'encerrado');
select t.eq('cron: os 2 lances viram vencedores', :'venc_cron'::bigint, 2);
select t.eq('cron e manual elegem os mesmos vencedores', :'venc_cron'::bigint, :'venc_manual'::bigint);

-- o núcleo do fechamento e o cron NÃO são chamáveis por usuário/anônimo
select t.ok('anon não executa fechar_leiloes_vencidos', not has_function_privilege('anon', 'public.fechar_leiloes_vencidos()', 'execute'));
select t.ok('authenticated não executa fechar_leiloes_vencidos', not has_function_privilege('authenticated', 'public.fechar_leiloes_vencidos()', 'execute'));
select t.ok('anon não executa _leilao_fechar_core', not has_function_privilege('anon', 'public._leilao_fechar_core(uuid)', 'execute'));
select t.ok('authenticated não executa _leilao_fechar_core', not has_function_privilege('authenticated', 'public._leilao_fechar_core(uuid)', 'execute'));

-- saldo de unidade: só quem é membro do clube da unidade enxerga; outro clube/anônimo = nada
select t.como('membro_a');
select t.eq('membro do clube A vê o saldo de A1', t.n(format('select public.pontos_temporada_unidade(%L)', t.id('A1'))), 510);
select t.como('lider_a');
select t.eq('liderança do clube A vê o saldo de A2', t.n(format('select public.pontos_temporada_unidade(%L)', t.id('A2'))), 300);
select t.como('membro_b');
select t.eq('membro do clube B NÃO vê saldo de unidade do clube A', t.nv(format('select public.pontos_temporada_unidade(%L)', t.id('A1'))), 0);
select t.como('lider_b');
select t.eq('liderança do clube B NÃO vê saldo de unidade do clube A', t.nv(format('select public.pontos_temporada_unidade(%L)', t.id('A1'))), 0);
select t.como('pais_a');
select t.eq('responsável NÃO vê saldo de unidade', t.nv(format('select public.pontos_temporada_unidade(%L)', t.id('A1'))), 0);
select t.como_anon();
select t.eq('anônimo NÃO vê saldo de unidade', t.nv(format('select public.pontos_temporada_unidade(%L)', t.id('A1'))), 0);

-- encerrar de novo depois de fechado é recusado (sem cobrança dupla)
select t.como('lider_a');
select public.encerrar_leilao(t.id('leilao'));
select t.throws('encerrar duas vezes é recusado', format('select public.encerrar_leilao(%L)', t.id('leilao')), 'já foi encerrado');
reset role;
select t.eq('sem cobrança duplicada após o 2º encerrar', t.cobrancas(), 'Teste A1:-226,Teste A2:-74');

select t.fim();
rollback;
