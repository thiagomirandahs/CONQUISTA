-- Duelos entre unidades POR CLUBE (desafios_unidade = catálogo do clube; duelos = entre unidades do MESMO clube):
--   * cada clube tem o SEU catálogo de desafios (clube novo nasce com os 4 padrão; o Tenant 001 mantém os dele);
--   * membro lê/cria/acompanha duelos do próprio clube; liderança julga/cancela/apaga só no próprio clube;
--   * nunca cruza clubes: nem unidade adversária, nem desafio, nem julgamento, nem o aviso do push;
--   * as regras de antes seguem valendo (teto de 3 abertos, sem duelo repetido, prêmio só uma vez);
--   * ninguém descobre se um UUID de outro clube existe (mesma mensagem de "não encontrado").
begin;
\ir _lib.sql
\ir _fixtures.sql

-- segunda unidade no clube B (o fixture só tem B1) e um membro nela
insert into public.unidades (nome, cor, club_id) values ('Teste B2', '#444444', t.id('clube_b'));
insert into t.ids (chave, id) select 'B2', id from public.unidades where nome = 'Teste B2';
select t.mk('membro_b2', 'Membro B2', 'desbravador', 'ativo', 'clube_b', 'B2', date '2014-07-07');
insert into t.ids select 'des_a_missoes', id from public.desafios_unidade where club_id = t.id('clube_a') and titulo = 'Maratona de missões';
insert into t.ids select 'des_a_presenca', id from public.desafios_unidade where club_id = t.id('clube_a') and titulo = 'Presença total';
insert into t.ids select 'des_a_solidaria', id from public.desafios_unidade where club_id = t.id('clube_a') and titulo = 'Unidade solidária';
insert into t.ids select 'des_a_uniforme', id from public.desafios_unidade where club_id = t.id('clube_a') and titulo = 'Uniforme impecável';
insert into t.ids select 'des_b_missoes', id from public.desafios_unidade where club_id = t.id('clube_b') and titulo = 'Maratona de missões';

-- ---------- estrutura e provisionamento ----------
select t.eq('desafios_unidade e duelos têm club_id obrigatório',
  (select count(*) from pg_attribute a where a.attrelid in ('public.desafios_unidade'::regclass, 'public.duelos'::regclass)
     and a.attname = 'club_id' and a.attnotnull), 2);
select t.eq('o Tenant 001 mantém os 4 desafios que já tinha', (select count(*) from public.desafios_unidade where club_id = t.id('clube_a')), 4);
select t.eq('clube novo (B) nasce com os 4 desafios padrão', (select count(*) from public.desafios_unidade where club_id = t.id('clube_b')), 4);
select t.eq('nenhum desafio ficou sem clube', (select count(*) from public.desafios_unidade where club_id is null), 0);
select t.ok('os gatilhos que fechavam duelos ao clube legado sumiram',
  not exists (select 1 from pg_trigger where tgrelid = 'public.duelos'::regclass and not tgisinternal and tgname in ('trg_exigir_clube_legado', 'trg_exigir_unidades_legado')));

-- ---------- catálogo: leitura ----------
select t.como('membro_a');
select t.eq('membro A lê os 4 desafios do clube A e nenhum do B', t.n('select count(*) from public.desafios_unidade'), 4);
select t.como('membro_b');
select t.eq('membro B lê os 4 desafios do clube B', t.n('select count(*) from public.desafios_unidade'), 4);
select t.eq('...e nenhum do clube A', t.nv(format('select count(*) from public.desafios_unidade where club_id = %L', t.id('clube_a'))), 0);
select t.como('pais_a');
select t.eq('responsável NÃO lê o catálogo de duelos', t.nv('select count(*) from public.desafios_unidade'), 0);
select t.como_anon();
select t.eq('anon não lê o catálogo', t.nv('select count(*) from public.desafios_unidade'), 0);

-- ---------- catálogo: escrita (o front insere sem club_id: vale o clube de quem chama) ----------
select t.como('lider_a');
select t.permitido('líder A cria desafio (sem club_id, como o front faz)', $q$insert into public.desafios_unidade (titulo, descricao, pontos, dias, tipo, meta) values ('Desafio novo A', 'x', 10, 5, 'manual', 1)$q$);
select t.como('lider_b');
select t.permitido('líder B cria desafio no PRÓPRIO clube', $q$insert into public.desafios_unidade (titulo, descricao, pontos, dias, tipo, meta) values ('Desafio novo B', 'x', 10, 5, 'manual', 1)$q$);
select t.bloqueado('líder B NÃO cria desafio no clube A (club_id forjado)', format($q$insert into public.desafios_unidade (club_id, titulo, pontos, dias, tipo, meta) values (%L, 'Invasor', 10, 5, 'manual', 1)$q$, t.id('clube_a')));
select t.bloqueado('líder B NÃO edita desafio do clube A', format($q$update public.desafios_unidade set pontos = 9999 where id = %L$q$, t.id('des_a_missoes')));
select t.bloqueado('líder B NÃO apaga desafio do clube A', format($q$delete from public.desafios_unidade where id = %L$q$, t.id('des_a_missoes')));
select t.bloqueado('líder B NÃO move desafio dele para o clube A', format($q$update public.desafios_unidade set club_id = %L where titulo = 'Desafio novo B'$q$, t.id('clube_a')));
select t.como('membro_a');
select t.bloqueado('membro NÃO cria desafio', $q$insert into public.desafios_unidade (titulo, pontos, dias, tipo, meta) values ('hack', 1, 1, 'manual', 1)$q$);
reset role;
select t.eq('pontos do desafio do clube A intactos', (select pontos from public.desafios_unidade where id = t.id('des_a_missoes')), 60);

-- ---------- criar duelo ----------
select t.como('membro_a');
select t.permitido('membro A (unidade A1) desafia a unidade A2', format($q$select public.criar_duelo(%L, %L)$q$, t.id('des_a_missoes'), t.id('A2')));
select t.throws('membro A NÃO desafia unidade do clube B (mesma resposta de "não existe")', format($q$select public.criar_duelo(%L, %L)$q$, t.id('des_a_presenca'), t.id('B1')), 'Unidade não encontrada');
select t.throws('membro A NÃO usa desafio do clube B', format($q$select public.criar_duelo(%L, %L)$q$, t.id('des_b_missoes'), t.id('A2')), 'Desafio inválido');
select t.como('membro_b');
select t.throws('membro B NÃO usa desafio do clube A', format($q$select public.criar_duelo(%L, %L)$q$, t.id('des_a_missoes'), t.id('B2')), 'Desafio inválido');
select t.throws('membro B NÃO desafia unidade do clube A', format($q$select public.criar_duelo(%L, %L)$q$, t.id('des_b_missoes'), t.id('A1')), 'Unidade não encontrada');
select t.permitido('membro B (unidade B1) desafia a unidade B2 do PRÓPRIO clube', format($q$select public.criar_duelo(%L, %L)$q$, t.id('des_b_missoes'), t.id('B2')));
select t.como('pais_a');
select t.throws('responsável NÃO cria duelo', format($q$select public.criar_duelo(%L, %L)$q$, t.id('des_a_presenca'), t.id('A2')));
reset role;
select id as duelo_a from public.duelos where club_id = t.id('clube_a') and unidade_a = t.id('A1') \gset
select id as duelo_b from public.duelos where club_id = t.id('clube_b') \gset
insert into t.ids values ('duelo_a', :'duelo_a'), ('duelo_b', :'duelo_b');
select t.eq('o duelo do clube A nasceu no clube A', (select count(*) from public.duelos where id = t.id('duelo_a') and club_id = t.id('clube_a')), 1);
select t.eq('o duelo do clube B nasceu no clube B', (select count(*) from public.duelos where id = t.id('duelo_b') and club_id = t.id('clube_b')), 1);
select t.eq('só 1 duelo por clube foi criado (as tentativas cruzadas não deixaram rastro)', (select count(*) from public.duelos where club_id in (t.id('clube_a'), t.id('clube_b'))), 2);
select t.eq('o aviso do duelo A foi para o clube A (todos)', (select count(*) from public.notificacoes where titulo like '%Novo duelo%' and club_id = t.id('clube_a') and corpo like '%Teste A1%'), 1);
select t.eq('o aviso do duelo B foi para o clube B — e nenhum aviso de duelo vazou para o clube A', (select count(*) from public.notificacoes where titulo like '%Novo duelo%' and club_id = t.id('clube_b') and corpo like '%Teste B1%'), 1);
select t.eq('...o clube A só recebeu o aviso do próprio duelo', (select count(*) from public.notificacoes where titulo like '%Novo duelo%' and club_id = t.id('clube_a')), 1);

-- ---------- leitura de duelos ----------
select t.como('membro_a2');
select t.eq('membro A2 lê o duelo do clube A', t.n('select count(*) from public.duelos'), 1);
select t.como('membro_b');
select t.eq('membro B lê só o duelo do clube B', t.n('select count(*) from public.duelos'), 1);
select t.eq('...e não o do clube A', t.nv(format('select count(*) from public.duelos where id = %L', t.id('duelo_a'))), 0);
select t.como('pais_a');
select t.eq('responsável não lê duelos', t.nv('select count(*) from public.duelos'), 0);

-- ---------- progresso do duelo ----------
select t.como('membro_a');
select t.eq('membro A vê o progresso do duelo do clube A (tipo missoes)', t.txt(format($q$select public.progresso_duelo(%L)->>'tipo'$q$, t.id('duelo_a'))), 'missoes');
select t.como('membro_b');
select t.throws('membro B NÃO acompanha duelo do clube A (não encontrado)', format($q$select public.progresso_duelo(%L)$q$, t.id('duelo_a')), 'não encontrado');
select t.eq('membro B vê o progresso do duelo do clube B', t.txt(format($q$select public.progresso_duelo(%L)->>'tipo'$q$, t.id('duelo_b'))), 'missoes');
select t.como('pais_a');
select t.eq('responsável recebe só o tipo manual (nada de membros)', t.txt(format($q$select public.progresso_duelo(%L)->>'tipo'$q$, t.id('duelo_a'))), 'manual');

-- ---------- cancelar ----------
select t.como('lider_b');
select t.throws('líder B NÃO cancela duelo do clube A (não encontrado)', format($q$select public.cancelar_duelo(%L)$q$, t.id('duelo_a')), 'não encontrado');
select t.como('membro_b2');
select t.throws('membro que não lançou NÃO cancela duelo do clube dele', format($q$select public.cancelar_duelo(%L)$q$, t.id('duelo_b')), 'Só quem lançou');
select t.como('membro_b');
select t.permitido('quem lançou cancela o próprio duelo', format($q$select public.cancelar_duelo(%L)$q$, t.id('duelo_b')));
select t.throws('cancelar de novo: já encerrado', format($q$select public.cancelar_duelo(%L)$q$, t.id('duelo_b')), 'já foi encerrado');

-- ---------- julgar ----------
select t.como('membro_a');
select t.throws('membro NÃO julga', format($q$select public.julgar_duelo(%L, 'a')$q$, t.id('duelo_a')), 'Só a liderança');
select t.como('lider_b');
select t.throws('líder B NÃO julga duelo do clube A (não encontrado, sem prêmio)', format($q$select public.julgar_duelo(%L, 'ambos')$q$, t.id('duelo_a')), 'não encontrado');
select t.como('instrutor_a');
select t.permitido('instrutor A (liderança do clube A) julga: unidade A1 vence', format($q$select public.julgar_duelo(%L, 'a')$q$, t.id('duelo_a')));
select t.throws('julgar de novo: já encerrado (prêmio uma vez só)', format($q$select public.julgar_duelo(%L, 'a')$q$, t.id('duelo_a')), 'já foi encerrado');
reset role;
select t.eq('o prêmio (60) entrou UMA vez, na unidade A1 e no clube A',
  (select count(*) from public.pontos where unidade_id = t.id('A1') and club_id = t.id('clube_a') and motivo like 'Duelo vencido:%' and pontos = 60), 1);
select t.eq('nenhum ponto de duelo caiu em outro clube', (select count(*) from public.pontos where motivo like 'Duelo vencido:%' and club_id <> t.id('clube_a')), 0);

-- ---------- regras de antes (compat Tenant 001) ----------
select t.como('membro_a');
select t.permitido('duelo repetido do mesmo desafio: o primeiro (encerrado) já saiu, criar de novo é permitido', format($q$select public.criar_duelo(%L, %L)$q$, t.id('des_a_missoes'), t.id('A2')));
select t.throws('duelo aberto repetido é recusado', format($q$select public.criar_duelo(%L, %L)$q$, t.id('des_a_missoes'), t.id('A2')), 'Já existe um duelo aberto');
select t.permitido('2º duelo aberto (outro desafio)', format($q$select public.criar_duelo(%L, %L)$q$, t.id('des_a_presenca'), t.id('A2')));
select t.como('conselheiro_a');
select t.permitido('3º duelo aberto da unidade A1 (lançado por outra pessoa da unidade: o teto por pessoa é 3/24h)', format($q$select public.criar_duelo(%L, %L)$q$, t.id('des_a_solidaria'), t.id('A2')));
select t.throws('o 4º duelo aberto da unidade é recusado (teto de 3 abertos)', format($q$select public.criar_duelo(%L, %L)$q$, t.id('des_a_uniforme'), t.id('A2')), '3 duelos');

-- ---------- escrita direta e integridade ----------
select t.como('membro_b');
select t.bloqueado('membro NÃO insere duelo direto', format($q$insert into public.duelos (desafio_id, titulo, pontos, unidade_a, unidade_b, prazo) values (%L, 'x', 1, %L, %L, current_date)$q$, t.id('des_b_missoes'), t.id('B1'), t.id('B2')));
select t.como('lider_b');
select t.bloqueado('líder B NÃO apaga duelo do clube A', format($q$delete from public.duelos where id = %L$q$, t.id('duelo_a')));
select t.como('lider_a');
select t.permitido('líder A apaga duelo do próprio clube', format($q$delete from public.duelos where id = %L$q$, t.id('duelo_a')));
reset role;
select t.throws('gatilho: duelo entre unidades de clubes DIFERENTES é impossível (mesmo como dono do banco)',
  format($q$insert into public.duelos (desafio_id, titulo, pontos, unidade_a, unidade_b, prazo) values (%L, 'x', 1, %L, %L, current_date)$q$, t.id('des_a_missoes'), t.id('A1'), t.id('B1')), 'mesmo clube');
select t.throws('gatilho: desafio de OUTRO clube é impossível',
  format($q$insert into public.duelos (desafio_id, titulo, pontos, unidade_a, unidade_b, prazo) values (%L, 'x', 1, %L, %L, current_date)$q$, t.id('des_b_missoes'), t.id('A1'), t.id('A2')), 'desafio');

select t.fim();
rollback;
