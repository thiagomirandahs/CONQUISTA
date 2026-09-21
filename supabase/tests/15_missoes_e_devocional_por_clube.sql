-- Missões do dia, devocional e catálogos POR CLUBE:
--   * missoes_feitas / devocional carregam club_id (o do dono do registro); o Tenant 001 mantém o que tem;
--   * o membro registra a missão/devocional NO PRÓPRIO clube, os pontos caem no clube dele;
--   * a liderança do clube vê/avalia só as missões pendentes do PRÓPRIO clube (UUID de outro clube = "não encontrada");
--   * cadastro pendente e responsável não pontuam; ninguém grava direto nas tabelas;
--   * catálogos (desafios = missões do dia, versiculos = devocional) são do CLUBE: a liderança edita o do próprio clube (painel
--     Conteúdo do app), clube novo nasce com uma CÓPIA do conteúdo do clube legado, e cada membro recebe a missão/versículo do clube dele.
begin;
\ir _lib.sql
\ir _fixtures.sql

select t.mk('membro_a2b', 'Membro A (foto)', 'desbravador', 'ativo', 'clube_a', 'A1', date '2014-08-08');
select t.mk('membro_b2', 'Membro B (foto)', 'desbravador', 'ativo', 'clube_b', 'B1', date '2014-09-09');
select t.mk('pend_a', 'Pendente A', 'desbravador', 'pendente', 'clube_a', 'A1', date '2014-10-10');

-- clube novo (B) nasceu com uma CÓPIA do conteúdo do clube legado; o do clube A ficou como estava
select t.eq('todo desafio/versículo tem clube', (select count(*) from public.desafios where club_id is null) + (select count(*) from public.versiculos where club_id is null), 0);
select t.eq('o clube B ganhou a mesma quantidade de desafios do clube A', (select count(*) from public.desafios where club_id = t.id('clube_b')), (select count(*) from public.desafios where club_id = t.id('clube_a')));
select t.eq('...e de versículos', (select count(*) from public.versiculos where club_id = t.id('clube_b')), (select count(*) from public.versiculos where club_id = t.id('clube_a')));
select t.ok('o clube legado mantém o conteúdo que já tinha (100 desafios / 20 versículos no banco recém-criado)', (select count(*) from public.desafios where club_id = t.id('clube_a')) >= 100 and (select count(*) from public.versiculos where club_id = t.id('clube_a')) >= 20);

-- catálogo controlado POR CLUBE: 1 missão ativa (SEM foto: o quiz vale a pontuação) e 1 versículo ativo em cada clube
update public.desafios set ativo = false where club_id in (t.id('clube_a'), t.id('clube_b'));
insert into public.desafios (club_id, tema, texto, pergunta, opcoes, correta, classe, pede_foto, ativo) values
  (t.id('clube_a'), 'Teste', 'texto da missão A', 'Pergunta?', '["a","b"]'::jsonb, 0, null, false, true),
  (t.id('clube_b'), 'Teste', 'texto da missão B', 'Pergunta?', '["a","b"]'::jsonb, 0, null, false, true);
update public.versiculos set ativo = false where club_id in (t.id('clube_a'), t.id('clube_b'));
insert into public.versiculos (club_id, texto, referencia, pergunta, opcoes, correta, ativo, livro_abrev, capitulo, versiculo_num) values
  (t.id('clube_a'), 'versículo do A', 'Gn 1:1', 'Quem?', '["x","y"]'::jsonb, 1, true, 'gn', 1, 1),
  (t.id('clube_b'), 'versículo do B', 'Gn 1:2', 'Quem?', '["x","y"]'::jsonb, 1, true, 'gn', 1, 2);

-- ---------- estrutura ----------
select t.eq('missoes_feitas e devocional têm club_id obrigatório',
  (select count(*) from pg_attribute a where a.attrelid in ('public.missoes_feitas'::regclass, 'public.devocional'::regclass)
     and a.attname = 'club_id' and a.attnotnull), 2);
select t.ok('o gate do clube legado saiu de missoes_feitas e devocional',
  not exists (select 1 from pg_trigger where tgrelid in ('public.missoes_feitas'::regclass, 'public.devocional'::regclass) and not tgisinternal and tgname = 'trg_exigir_clube_legado'));

-- ---------- missão sem foto: cada um no SEU clube ----------
select t.como('membro_a');
select t.eq('membro A registra a missão (acertou: 10 pontos)', t.txt($q$select public.registrar_missao(null, 0)->>'pontos'$q$), '10');
select t.throws('a missão de hoje só vale uma vez', $q$select public.registrar_missao(null, 0)$q$, 'já fez a missão');
select t.como('membro_b');
select t.eq('membro B registra a missão no clube B (errou: 5 pontos)', t.txt($q$select public.registrar_missao(null, 1)->>'pontos'$q$), '5');
select t.como('pais_a');
select t.throws('responsável NÃO registra missão', $q$select public.registrar_missao(null, 0)$q$);
select t.como('pend_a');
select t.throws('cadastro pendente NÃO registra missão', $q$select public.registrar_missao(null, 0)$q$);
reset role;
select t.eq('a missão do A ficou no clube A', (select count(*) from public.missoes_feitas where usuario_id = t.id('membro_a') and club_id = t.id('clube_a')), 1);
select t.eq('a missão do B ficou no clube B', (select count(*) from public.missoes_feitas where usuario_id = t.id('membro_b') and club_id = t.id('clube_b')), 1);
select t.eq('os 10 pontos da missão entraram no clube A', (select coalesce(sum(pontos), 0) from public.pontos where usuario_id = t.id('membro_a') and origem = 'missao' and club_id = t.id('clube_a')), 10);
select t.eq('os 5 pontos da missão entraram no clube B', (select coalesce(sum(pontos), 0) from public.pontos where usuario_id = t.id('membro_b') and origem = 'missao' and club_id = t.id('clube_b')), 5);
select t.eq('pendente e responsável não pontuaram', (select count(*) from public.pontos where usuario_id in (t.id('pais_a'), t.id('pend_a')) and origem = 'missao'), 0);

-- ---------- leitura das missões feitas ----------
select t.como('membro_a');
select t.eq('membro A lê só a própria missão', t.n('select count(*) from public.missoes_feitas'), 1);
select t.como('membro_b');
select t.eq('membro B lê só a própria missão', t.n('select count(*) from public.missoes_feitas'), 1);
select t.como('lider_a');
select t.eq('líder A lê as missões do clube A (e nenhuma do B)', t.nv(format('select count(*) from public.missoes_feitas where club_id = %L', t.id('clube_b'))), 0);
select t.ok('...mas lê a do membro A', t.n(format('select count(*) from public.missoes_feitas where usuario_id = %L', t.id('membro_a'))) = 1);
select t.como('lider_b');
select t.eq('líder B NÃO lê a missão do membro do clube A', t.nv(format('select count(*) from public.missoes_feitas where usuario_id = %L', t.id('membro_a'))), 0);
select t.como('pais_a');
select t.eq('responsável não lê missões', t.nv('select count(*) from public.missoes_feitas'), 0);
select t.como_anon();
select t.eq('anon não lê missões', t.nv('select count(*) from public.missoes_feitas'), 0);
select t.como('membro_b');
select t.bloqueado('membro NÃO grava missão direto (nem no próprio clube)', format($q$insert into public.missoes_feitas (usuario_id, data, status, pontos_dados, club_id) values (%L, current_date - 1, 'aprovada', 999, %L)$q$, t.id('membro_b'), t.id('clube_b')));
select t.bloqueado('membro NÃO edita a missão para aprovada', $q$update public.missoes_feitas set status = 'aprovada', pontos_dados = 999$q$);

-- ---------- missão com foto: pendente -> liderança do clube avalia ----------
reset role;
update public.desafios set pede_foto = true;
select t.como('membro_a2b');
select t.eq('membro A envia a missão com foto: fica pendente', t.txt($q$select public.registrar_missao('caminho/foto-a.jpg', 0)->>'status'$q$), 'pendente');
select t.como('membro_b2');
select t.eq('membro B envia a missão com foto: fica pendente no clube B', t.txt($q$select public.registrar_missao('caminho/foto-b.jpg', 0)->>'status'$q$), 'pendente');
reset role;
select id as pend_mis_a from public.missoes_feitas where usuario_id = t.id('membro_a2b') \gset
select id as pend_mis_b from public.missoes_feitas where usuario_id = t.id('membro_b2') \gset
insert into t.ids values ('mis_a', :'pend_mis_a'), ('mis_b', :'pend_mis_b');

select t.como('lider_a');
select t.eq('líder A vê só a pendente do clube A', t.n('select count(*) from public.missoes_pendentes()'), 1);
select t.como('lider_b');
select t.eq('líder B vê só a pendente do clube B', t.n('select count(*) from public.missoes_pendentes()'), 1);
select t.como('membro_a');
select t.throws('membro NÃO lista pendentes', $q$select * from public.missoes_pendentes()$q$, 'Sem permissão');
select t.throws('membro NÃO avalia', format($q$select public.avaliar_missao(%L, true)$q$, t.id('mis_a')), 'Sem permissão');
select t.como('lider_b');
select t.throws('líder B NÃO avalia missão do clube A (mesma resposta de "não encontrada")', format($q$select public.avaliar_missao(%L, true)$q$, t.id('mis_a')), 'não encontrada');
select t.como('lider_a');
select t.throws('líder A NÃO avalia missão do clube B', format($q$select public.avaliar_missao(%L, true)$q$, t.id('mis_b')), 'não encontrada');
select t.permitido('líder A aprova a missão do clube A', format($q$select public.avaliar_missao(%L, true)$q$, t.id('mis_a')));
select t.throws('avaliar de novo: já avaliada (pontos uma vez só)', format($q$select public.avaliar_missao(%L, true)$q$, t.id('mis_a')), 'já avaliada');
select t.como('lider_b');
select t.permitido('líder B reprova a missão do clube B', format($q$select public.avaliar_missao(%L, false)$q$, t.id('mis_b')));
reset role;
select t.eq('a aprovação pontuou o membro do A no clube A (10)', (select coalesce(sum(pontos), 0) from public.pontos where usuario_id = t.id('membro_a2b') and origem = 'missao' and club_id = t.id('clube_a')), 10);
select t.eq('a reprovação não pontuou o membro do B', (select count(*) from public.pontos where usuario_id = t.id('membro_b2') and origem = 'missao'), 0);
select t.eq('o aviso "Missão aprovada" foi para o membro, no clube A', (select count(*) from public.notificacoes where para_usuario = t.id('membro_a2b') and titulo like '%aprovada%' and club_id = t.id('clube_a')), 1);
select t.eq('o aviso "Missão não aprovada" foi para o membro, no clube B', (select count(*) from public.notificacoes where para_usuario = t.id('membro_b2') and titulo like '%não aprovada%' and club_id = t.id('clube_b')), 1);

-- ---------- devocional ----------
select t.como('membro_a');
select t.eq('membro A faz o devocional (+5)', t.txt($q$select public.registrar_devocional(1)->>'pontos'$q$), '5');
select t.throws('devocional só uma vez ao dia', $q$select public.registrar_devocional(1)$q$, 'já fez o devocional');
select t.eq('devocional_feito_hoje() = true para quem fez', t.txt('select public.devocional_feito_hoje()::text'), 'true');
select t.como('membro_b');
select t.eq('membro B faz o devocional no clube B (+5)', t.txt($q$select public.registrar_devocional(0)->>'pontos'$q$), '5');
select t.como('pais_a');
select t.throws('responsável NÃO faz devocional', $q$select public.registrar_devocional(1)$q$);
select t.como('pend_a');
select t.throws('cadastro pendente NÃO faz devocional', $q$select public.registrar_devocional(1)$q$);
reset role;
select t.eq('devocional do A no clube A', (select count(*) from public.devocional where usuario_id = t.id('membro_a') and club_id = t.id('clube_a')), 1);
select t.eq('devocional do B no clube B', (select count(*) from public.devocional where usuario_id = t.id('membro_b') and club_id = t.id('clube_b')), 1);
select t.eq('pontos de devocional caíram no clube certo', (select count(*) from public.pontos where origem = 'devocional' and ((usuario_id = t.id('membro_a') and club_id = t.id('clube_a')) or (usuario_id = t.id('membro_b') and club_id = t.id('clube_b')))), 2);
select t.como('membro_b');
select t.eq('membro B lê só o próprio devocional', t.n('select count(*) from public.devocional'), 1);
select t.bloqueado('membro NÃO grava devocional direto', format($q$insert into public.devocional (usuario_id, data, club_id) values (%L, current_date - 1, %L)$q$, t.id('membro_b'), t.id('clube_b')));
select t.como('lider_b');
select t.eq('líder B NÃO lê o devocional do clube A', t.nv(format('select count(*) from public.devocional where usuario_id = %L', t.id('membro_a'))), 0);
select t.como('lider_a');
select t.ok('líder A lê o devocional do membro do clube A', t.n(format('select count(*) from public.devocional where usuario_id = %L', t.id('membro_a'))) = 1);

-- ---------- resumos pessoais (não cruzam) ----------
select t.como('membro_a');
select t.eq('meu_resumo_missoes(): feito hoje', t.txt($q$select public.meu_resumo_missoes()->>'feito'$q$), 'true');
select t.eq('meu_resumo_devocional(): feito hoje', t.txt($q$select public.meu_resumo_devocional()->>'feito'$q$), 'true');
select t.como('membro_b2');
select t.eq('resumo do membro B2 reflete a reprovação da liderança do clube B', t.txt($q$select public.meu_resumo_missoes()->>'status'$q$), 'reprovada');

-- ---------- catálogos de conteúdo: POR CLUBE ----------
select t.como('membro_a');
select t.eq('membro NÃO lê o catálogo bruto de missões (tem a resposta certa)', t.nv('select count(*) from public.desafios'), 0);
select t.eq('membro A recebe a missão do dia do clube A', t.txt($q$select texto from public.missao_do_dia()$q$), 'texto da missão A');
select t.eq('membro A recebe o versículo do dia do clube A', t.txt($q$select texto from public.versiculo_do_dia()$q$), 'versículo do A');
select t.como('membro_b');
select t.eq('membro B recebe a missão do dia do clube B (não a do A)', t.txt($q$select texto from public.missao_do_dia()$q$), 'texto da missão B');
select t.eq('membro B recebe o versículo do dia do clube B', t.txt($q$select texto from public.versiculo_do_dia()$q$), 'versículo do B');
select t.como('lider_a');
select t.ok('líder A lê o catálogo do clube A (e nenhuma linha do B)', t.n('select count(*) from public.desafios') >= 100 and t.nv(format('select count(*) from public.desafios where club_id = %L', t.id('clube_b'))) = 0);
select t.permitido('líder A edita um desafio do clube A (painel Conteúdo: update por id)', $q$update public.desafios set tema = 'editado' where texto = 'texto da missão A'$q$);
select t.permitido('líder A cria um desafio (sem club_id, como o painel faz)', $q$insert into public.desafios (tema, texto, pergunta, opcoes, correta, pede_foto, ativo) values ('novo', 'desafio novo A', 'P?', '["a","b"]'::jsonb, 0, false, false)$q$);
select t.permitido('líder A cria um versículo', $q$insert into public.versiculos (texto, referencia, pergunta, opcoes, correta, ativo, livro_abrev, capitulo, versiculo_num) values ('novo v', 'Gn 2:1', 'Q?', '["x","y"]'::jsonb, 0, false, 'gn', 2, 1)$q$);
select t.permitido('líder A apaga o desafio que criou', $q$delete from public.desafios where texto = 'desafio novo A'$q$);
select t.bloqueado('líder A NÃO altera o desafio do clube B', format($q$update public.desafios set correta = 1 where club_id = %L$q$, t.id('clube_b')));
select t.bloqueado('líder A NÃO cria desafio no clube B (club_id forjado)', format($q$insert into public.desafios (club_id, tema, texto, pergunta, opcoes, correta) values (%L, 'x', 'invasor', 'P?', '[]'::jsonb, 0)$q$, t.id('clube_b')));
select t.bloqueado('líder A NÃO apaga versículo do clube B', format($q$delete from public.versiculos where club_id = %L$q$, t.id('clube_b')));
select t.como('lider_b');
select t.eq('líder B NÃO lê o catálogo do clube A', t.nv(format('select count(*) from public.desafios where club_id = %L', t.id('clube_a'))), 0);
select t.permitido('líder B edita o versículo do clube B', $q$update public.versiculos set texto = 'versículo do B (editado)' where texto = 'versículo do B'$q$);
select t.bloqueado('líder B NÃO altera o desafio do clube A', format($q$update public.desafios set correta = 1 where club_id = %L$q$, t.id('clube_a')));
select t.como('membro_a');
select t.bloqueado('membro NÃO cria desafio', $q$insert into public.desafios (tema, texto, pergunta, opcoes, correta) values ('x', 'hack', 'P?', '[]'::jsonb, 0)$q$);
select t.bloqueado('membro NÃO apaga versículo', $q$delete from public.versiculos$q$);
select t.como_anon();
select t.throws('anon NÃO chama a missão do dia', $q$select * from public.missao_do_dia()$q$);
select t.eq('anon não lê o catálogo', t.nv('select count(*) from public.desafios'), 0);
reset role;

select t.fim();
rollback;
