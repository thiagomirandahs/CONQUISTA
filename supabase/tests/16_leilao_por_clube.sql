-- Leilão POR CLUBE (recurso opcional por clube: club_features 'leilao'):
--   * leiloes/itens/lances/lance_unidades carregam club_id; cada clube tem o SEU leilão aberto (1 por clube);
--   * só clube com o recurso ligado cria leilão; a liderança do clube liga/desliga o dele;
--   * dar lance / confirmar / recusar / encerrar / cancelar só no PRÓPRIO clube (UUID de outro clube = "não encontrado");
--   * unidade convidada num lance conjunto tem de ser do mesmo clube;
--   * o fechamento AUTOMÁTICO (cron, sem sessão) cobra em cada clube exatamente o mesmo que "Encerrar agora";
--   * o aviso "Leilão aberto" vai só para o clube do leilão.
begin;
\ir _lib.sql
\ir _fixtures.sql

insert into public.unidades (nome, cor, club_id) values ('Teste B2', '#444444', t.id('clube_b'));
insert into t.ids (chave, id) select 'B2', id from public.unidades where nome = 'Teste B2';
select t.mk('membro_b2', 'Membro B2', 'desbravador', 'ativo', 'clube_b', 'B2', date '2014-07-07');

-- saldos: A1 = 5 + 10 (membro) + 495 = 510 | A2 = 300 | B1 = 7 + 20 (membro) + 500 = 527 | B2 = 300
insert into public.pontos (unidade_id, origem, pontos, motivo)
values (t.id('A1'), 'unidade', 495, 'saldo A1'), (t.id('A2'), 'unidade', 300, 'saldo A2'),
       (t.id('B1'), 'unidade', 500, 'saldo B1'), (t.id('B2'), 'unidade', 300, 'saldo B2');

-- leilão do clube A (recurso ligado no Tenant 001): item 1 = lance SOLO de A1 (100); item 2 = CONJUNTO A1+A2 (200)
insert into public.leiloes (titulo, fecha_em, criado_por) values ('Leilão A', now() + interval '1 day', t.id('lider_a'));
insert into t.ids select 'leilao_a', id from public.leiloes where titulo = 'Leilão A';
insert into public.leilao_itens (leilao_id, nome, preco_base, ordem) values (t.id('leilao_a'), 'Item A1', 10, 1), (t.id('leilao_a'), 'Item A2', 10, 2);
insert into t.ids select 'item_a1', id from public.leilao_itens where leilao_id = t.id('leilao_a') and nome = 'Item A1';
insert into t.ids select 'item_a2', id from public.leilao_itens where leilao_id = t.id('leilao_a') and nome = 'Item A2';
insert into public.leilao_lances (item_id, criado_por, valor, status) values (t.id('item_a1'), t.id('membro_a'), 100, 'ativo'), (t.id('item_a2'), t.id('membro_a'), 200, 'ativo');
insert into public.leilao_lance_unidades (lance_id, unidade_id, confirmado)
select l.id, t.id('A1'), true from public.leilao_lances l where l.item_id in (t.id('item_a1'), t.id('item_a2'));
insert into public.leilao_lance_unidades (lance_id, unidade_id, confirmado)
select l.id, t.id('A2'), true from public.leilao_lances l where l.item_id = t.id('item_a2');

-- ---------- estrutura ----------
select t.eq('as 4 tabelas do leilão têm club_id obrigatório',
  (select count(*) from pg_attribute a where a.attrelid in ('public.leiloes'::regclass, 'public.leilao_itens'::regclass, 'public.leilao_lances'::regclass, 'public.leilao_lance_unidades'::regclass)
     and a.attname = 'club_id' and a.attnotnull), 4);
select t.eq('itens, lances e lance_unidades do clube A herdaram o clube do leilão',
  (select count(*) from public.leilao_itens where club_id = t.id('clube_a')) + (select count(*) from public.leilao_lances where club_id = t.id('clube_a')) + (select count(*) from public.leilao_lance_unidades where club_id = t.id('clube_a')), 2 + 2 + 3);
select t.ok('o gatilho que fechava o leilão ao clube legado saiu',
  not exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'exigir_leilao_habilitado' and prosrc like '%clube_legado_id%'));
select t.eq('o índice "um leilão aberto" agora é POR CLUBE', (select count(*) from pg_indexes where schemaname = 'public' and tablename = 'leiloes' and indexdef like '%(club_id)%' and indexdef like '%aberto%'), 1);

-- ---------- recurso ligado por clube ----------
select t.como('lider_b');
select t.throws('clube B sem o recurso: líder B NÃO cria leilão', $q$select public.criar_leilao('Leilão B', now() + interval '2 days', '[{"nome":"Item B1","preco_base":10},{"nome":"Item B2","preco_base":10}]'::jsonb)$q$, 'habilitado');
select t.permitido('líder B liga o recurso leilão no PRÓPRIO clube', format($q$insert into public.club_features (club_id, feature, enabled) values (%L, 'leilao', true) on conflict (club_id, feature) do update set enabled = true$q$, t.id('clube_b')));
select t.bloqueado('líder B NÃO liga o recurso no clube A (já ligado lá, mas nem mexe)', format($q$update public.club_features set enabled = false where club_id = %L$q$, t.id('clube_a')));
select t.como('membro_b');
select t.throws('membro NÃO cria leilão', $q$select public.criar_leilao('x', now() + interval '2 days', '[{"nome":"i","preco_base":1}]'::jsonb)$q$, 'liderança');
select t.como('lider_b');
select t.permitido('agora o líder B cria o leilão do clube B (2 itens)', $q$select public.criar_leilao('Leilão B', now() + interval '2 days', '[{"nome":"Item B1","preco_base":10},{"nome":"Item B2","preco_base":10}]'::jsonb)$q$);
select t.throws('um segundo leilão aberto no mesmo clube é recusado', $q$select public.criar_leilao('Outro B', now() + interval '2 days', '[{"nome":"i","preco_base":1}]'::jsonb)$q$, 'já existe um leilão aberto');
select t.como('lider_a');
select t.throws('o clube A também só pode ter 1 aberto (já tem o do fixture)', $q$select public.criar_leilao('Outro A', now() + interval '2 days', '[{"nome":"i","preco_base":1}]'::jsonb)$q$, 'já existe um leilão aberto');
reset role;
insert into t.ids select 'leilao_b', id from public.leiloes where titulo = 'Leilão B';
insert into t.ids select 'item_b1', id from public.leilao_itens where leilao_id = t.id('leilao_b') and nome = 'Item B1';
insert into t.ids select 'item_b2', id from public.leilao_itens where leilao_id = t.id('leilao_b') and nome = 'Item B2';
select t.eq('os DOIS clubes têm leilão aberto ao mesmo tempo', (select count(*) from public.leiloes where status = 'aberto' and club_id in (t.id('clube_a'), t.id('clube_b'))), 2);
select t.eq('o leilão do B nasceu no clube B, com itens no clube B', (select count(*) from public.leiloes l join public.leilao_itens i on i.leilao_id = l.id where l.club_id = t.id('clube_b') and i.club_id = t.id('clube_b')), 2);
select t.eq('aviso "Leilão aberto" do B foi só para o clube B', (select count(*) from public.notificacoes where titulo like '%Leilão aberto%' and club_id = t.id('clube_b') and corpo like '%Leilão B%'), 1);
select t.eq('aviso do leilão A não vazou para o clube B', (select count(*) from public.notificacoes where titulo like '%Leilão aberto%' and club_id = t.id('clube_b') and corpo like '%Leilão A%'), 0);
select t.eq('...e o clube A só tem o aviso do próprio leilão', (select count(*) from public.notificacoes where titulo like '%Leilão aberto%' and club_id = t.id('clube_a')), 1);

-- ---------- leitura ----------
select t.como('membro_a');
select t.eq('membro A vê só o leilão do clube A', t.n('select count(*) from public.leiloes'), 1);
select t.eq('...com os 2 itens do clube A', t.n('select count(*) from public.leilao_itens'), 2);
select t.como('membro_b');
select t.eq('membro B vê só o leilão do clube B', t.n('select count(*) from public.leiloes'), 1);
select t.eq('...com os 2 itens do clube B (e nenhum lance do A)', t.n('select count(*) from public.leilao_itens') * 10 + t.nv(format('select count(*) from public.leilao_lances where club_id = %L', t.id('clube_a'))), 20);
select t.como('pais_b');
select t.eq('responsável não lê leilão', t.nv('select count(*) from public.leiloes') + t.nv('select count(*) from public.leilao_itens'), 0);
select t.como_anon();
select t.eq('anon não lê leilão', t.nv('select count(*) from public.leiloes'), 0);
select t.como('membro_b');
select t.bloqueado('membro NÃO grava lance direto', format($q$insert into public.leilao_lances (item_id, criado_por, valor, status) values (%L, %L, 5, 'ativo')$q$, t.id('item_b1'), t.id('membro_b')));
select t.bloqueado('membro NÃO edita o leilão', $q$update public.leiloes set fecha_em = now() + interval '30 days'$q$);

-- ---------- lances ----------
select t.permitido('membro B (unidade B1) dá lance solo de 100 no item B1', format($q$select public.dar_lance(%L, 100)$q$, t.id('item_b1')));
select t.throws('membro B NÃO dá lance em item do clube A (não encontrado)', format($q$select public.dar_lance(%L, 50)$q$, t.id('item_a1')), 'não encontrado');
select t.throws('membro B NÃO convida unidade do clube A para um lance conjunto', format($q$select public.dar_lance(%L, 60, array[%L]::uuid[])$q$, t.id('item_b2'), t.id('A1')), 'não existe');
select t.como('membro_a');
select t.throws('membro A NÃO dá lance em item do clube B (não encontrado)', format($q$select public.dar_lance(%L, 999)$q$, t.id('item_b1')), 'não encontrado');
select t.como('membro_b');
select t.eq('membro B abre um lance CONJUNTO B1+B2 de 200 (fica pendente)', t.txt(format($q$select public.dar_lance(%L, 200, array[%L]::uuid[])->>'pendente'$q$, t.id('item_b2'), t.id('B2'))), 'true');
reset role;
select id as lance_conj from public.leilao_lances where item_id = t.id('item_b2') and status = 'pendente' \gset
insert into t.ids values ('lance_conj', :'lance_conj');
select t.como('membro_a');
select t.throws('membro A NÃO confirma lance do clube B (não encontrado)', format($q$select public.confirmar_lance_conjunto(%L)$q$, t.id('lance_conj')), 'não encontrado');
select t.throws('membro A NÃO recusa lance do clube B (não encontrado)', format($q$select public.recusar_lance_conjunto(%L)$q$, t.id('lance_conj')), 'não encontrado');
select t.como('membro_b2');
select t.eq('membro B2 confirma: todos confirmaram, o lance conjunto vira ativo (saldo coletivo)', t.txt(format($q$select public.confirmar_lance_conjunto(%L)->>'ativado'$q$, t.id('lance_conj'))), 'true');
reset role;
select t.eq('lance do A intacto (2 lances ativos)', (select count(*) from public.leilao_lances where club_id = t.id('clube_a') and status = 'ativo'), 2);
select t.eq('lances do B: 1 solo + 1 conjunto ativos', (select count(*) from public.leilao_lances where club_id = t.id('clube_b') and status = 'ativo'), 2);
select t.eq('as linhas de lance_unidades do B são todas do clube B', (select count(*) from public.leilao_lance_unidades where club_id = t.id('clube_b')), 3);

-- ---------- encerrar/cancelar: só no próprio clube ----------
select t.como('lider_a');
select t.throws('líder A NÃO encerra o leilão do clube B (não encontrado)', format($q$select public.encerrar_leilao(%L)$q$, t.id('leilao_b')), 'não encontrado');
select t.throws('líder A NÃO cancela o leilão do clube B (não encontrado)', format($q$select public.cancelar_leilao(%L)$q$, t.id('leilao_b')), 'não encontrado');
select t.como('membro_a');
select t.throws('membro NÃO encerra', format($q$select public.encerrar_leilao(%L)$q$, t.id('leilao_a')), 'liderança');

reset role;
create function t.cobrancas() returns text language sql as $$
  select coalesce(string_agg(u.nome || ':' || x.s, ',' order by u.nome), '(nenhuma)')
  from (select unidade_id, sum(pontos) s from public.pontos where origem = 'leilao' group by 1) x
  join public.unidades u on u.id = x.unidade_id;
$$;

-- (A) fechamento pelo CRON: os dois leilões vencidos, sem sessão de usuário
savepoint sp_cron;
update public.leiloes set fecha_em = now() - interval '1 minute' where id in (t.id('leilao_a'), t.id('leilao_b'));
select t.como_cron();
select public.fechar_leiloes_vencidos();
reset role;
select t.cobrancas() as cobr_cron,
       (select count(*) from public.leiloes where id in (t.id('leilao_a'), t.id('leilao_b')) and status = 'encerrado') as enc_cron
\gset
rollback to savepoint sp_cron;

-- (B) fechamento MANUAL: cada liderança encerra o SEU leilão ("Encerrar agora")
savepoint sp_manual;
select t.como('lider_a');
select public.encerrar_leilao(t.id('leilao_a'));
select t.como('lider_b');
select public.encerrar_leilao(t.id('leilao_b'));
reset role;
select t.cobrancas() as cobr_manual,
       (select count(*) from public.leiloes where id in (t.id('leilao_a'), t.id('leilao_b')) and status = 'encerrado') as enc_manual
\gset
rollback to savepoint sp_manual;

-- esperado: A1 226 + A2 74 (como no teste 01) | B1 100 + 127 = 227 + B2 73 (rateio 527:300 de 200, maiores restos)
select t.eq('cron: cobra cada clube só das próprias unidades', :'cobr_cron', 'Teste A1:-226,Teste A2:-74,Teste B1:-227,Teste B2:-73');
select t.eq('manual: cobra exatamente o mesmo, clube a clube', :'cobr_manual', 'Teste A1:-226,Teste A2:-74,Teste B1:-227,Teste B2:-73');
select t.eq('cron == manual', :'cobr_cron', :'cobr_manual');
select t.eq('cron: os dois leilões encerraram', :'enc_cron'::bigint, 2);
select t.eq('manual: os dois leilões encerraram', :'enc_manual'::bigint, 2);

-- líder B cancela o próprio; o cancelamento não mexe no A
select t.como('lider_b');
select t.permitido('líder B cancela o leilão do próprio clube', format($q$select public.cancelar_leilao(%L)$q$, t.id('leilao_b')));
reset role;
select t.eq('o leilão do clube A segue aberto', (select status from public.leiloes where id = t.id('leilao_a')), 'aberto');
select t.eq('...e o do B está cancelado', (select status from public.leiloes where id = t.id('leilao_b')), 'cancelado');

select t.fim();
rollback;
