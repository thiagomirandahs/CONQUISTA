-- CHAT, BICHINHO e BÍBLIA POR CLUBE:
--   chat: conversas/mensagens/participantes carregam o clube; cada clube tem o SEU chat geral; chat de unidade
--     só da unidade; conversa direta só entre gente do MESMO clube; a liderança modera só o clube dela;
--   bichinho: o bichinho é de quem adotou; "bichinhos do clube" só mostra gente do clube;
--   bíblia: o conteúdo é da plataforma (igual para todos); as leituras são de cada pessoa, no clube dela;
--   responsável e cadastro pendente não usam o chat; ninguém grava direto nas tabelas.
begin;
\ir _lib.sql
\ir _fixtures.sql

select t.mk('membro_b2', 'Membro B2', 'desbravador', 'ativo', 'clube_b', 'B1', date '2014-09-09');
select t.mk('pend_a', 'Pendente A', 'desbravador', 'pendente', 'clube_a', 'A1', date '2014-10-10');

-- ---------- estrutura ----------
select t.eq('chat_conversas / mensagens / participantes têm club_id obrigatório',
  (select count(*) from pg_attribute a where a.attrelid in ('public.chat_conversas'::regclass, 'public.chat_mensagens'::regclass, 'public.chat_participantes'::regclass)
     and a.attname = 'club_id' and a.attnotnull), 3);
select t.eq('bichinhos, biblia_leituras e biblia_leitura_atual têm club_id obrigatório',
  (select count(*) from pg_attribute a where a.attrelid in ('public.bichinhos'::regclass, 'public.biblia_leituras'::regclass, 'public.biblia_leitura_atual'::regclass)
     and a.attname = 'club_id' and a.attnotnull), 3);
select t.eq('cada clube tem UM chat geral (o legado manteve o dele; o B nasceu com o dele)', (select count(*) from public.chat_conversas where tipo = 'geral' and club_id in (t.id('clube_a'), t.id('clube_b'))), 2);
select t.ok('não sobrou NENHUM gate "só clube legado" em tabela pública',
  not exists (select 1 from pg_trigger where tgrelid::regclass::text like 'public.%' and not tgisinternal and tgname in ('trg_exigir_clube_legado', 'trg_exigir_unidades_legado', 'trg_exigir_leilao_leiloes')));
select t.ok('as funções dos gates antigos foram removidas',
  not exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname in ('exigir_clube_legado', 'exigir_unidades_do_clube_legado', 'exigir_leilao_habilitado')));

-- ---------- chat geral ----------
select t.como('membro_a');
select t.permitido('membro A fala no chat geral do clube A', $q$select public.chat_enviar_geral('oi pessoal do A')$q$);
select t.como('membro_b');
select t.permitido('membro B fala no chat geral do clube B', $q$select public.chat_enviar_geral('oi pessoal do B')$q$);
select t.como('lider_a');
select t.permitido('líder A também fala no chat geral (liderança pode)', $q$select public.chat_enviar_geral('aviso da liderança A')$q$);
select t.como('pais_a');
select t.throws('responsável NÃO fala no chat', $q$select public.chat_enviar_geral('oi')$q$);
select t.como('pend_a');
select t.throws('cadastro pendente NÃO fala no chat', $q$select public.chat_enviar_geral('oi')$q$);
reset role;
select t.eq('as mensagens do A ficaram no chat geral do clube A', (select count(*) from public.chat_mensagens m join public.chat_conversas c on c.id = m.conversa_id where c.tipo = 'geral' and c.club_id = t.id('clube_a') and m.club_id = t.id('clube_a') and m.texto in ('oi pessoal do A', 'aviso da liderança A')), 2);
select t.eq('a mensagem do B ficou no chat geral do clube B', (select count(*) from public.chat_mensagens m join public.chat_conversas c on c.id = m.conversa_id where c.tipo = 'geral' and c.club_id = t.id('clube_b') and m.club_id = t.id('clube_b') and m.texto = 'oi pessoal do B'), 1);

select t.como('membro_a');
select t.eq('membro A lê só o chat do clube A (2 mensagens)', t.n('select count(*) from public.chat_mensagens'), 2);
select t.eq('...e não vê nenhuma conversa do clube B', t.nv(format('select count(*) from public.chat_conversas where club_id = %L', t.id('clube_b'))), 0);
select t.como('membro_b');
select t.eq('membro B lê só a mensagem do clube B', t.n('select count(*) from public.chat_mensagens'), 1);
select t.como('pais_b');
select t.eq('responsável não lê o chat', t.nv('select count(*) from public.chat_mensagens') + t.nv('select count(*) from public.chat_conversas'), 0);
select t.como_anon();
select t.eq('anon não lê o chat', t.nv('select count(*) from public.chat_mensagens'), 0);
select t.como('membro_b');
select t.bloqueado('membro NÃO grava mensagem direto', format($q$insert into public.chat_mensagens (conversa_id, autor_id, texto, club_id) values ((select id from public.chat_conversas where tipo = 'geral' limit 1), %L, 'burlando', %L)$q$, t.id('membro_b'), t.id('clube_b')));

-- ---------- chat da unidade ----------
select t.como('membro_a');
select t.permitido('membro A (unidade A1) fala no chat da unidade', $q$select public.chat_enviar_unidade('segredo da A1')$q$);
select t.como('membro_a2');
select t.eq('membro A2 (outra unidade do mesmo clube) NÃO lê o chat da A1', t.nv($q$select count(*) from public.chat_mensagens where texto = 'segredo da A1'$q$), 0);
select t.como('conselheiro_a');
select t.eq('conselheiro da A1 lê o chat da A1', t.n($q$select count(*) from public.chat_mensagens where texto = 'segredo da A1'$q$), 1);
select t.como('lider_a');
select t.eq('líder A (liderança) lê o chat de qualquer unidade do clube A', t.n($q$select count(*) from public.chat_mensagens where texto = 'segredo da A1'$q$), 1);
select t.como('lider_b');
select t.eq('líder B NÃO lê o chat da unidade do clube A', t.nv($q$select count(*) from public.chat_mensagens where texto = 'segredo da A1'$q$), 0);
select t.como('membro_b');
select t.permitido('membro B (unidade B1) fala no chat da própria unidade', $q$select public.chat_enviar_unidade('segredo da B1')$q$);
reset role;
select t.eq('as conversas de unidade nasceram no clube certo', (select count(*) from public.chat_conversas where tipo = 'unidade' and ((unidade_id = t.id('A1') and club_id = t.id('clube_a')) or (unidade_id = t.id('B1') and club_id = t.id('clube_b')))), 2);

-- ---------- conversa direta ----------
select t.como('membro_a');
select t.permitido('membro A manda direta para o membro A2 (mesmo clube)', format($q$select public.chat_enviar_direta(%L, 'oi A2')$q$, t.id('membro_a2')));
select t.throws('membro A NÃO manda direta para gente do clube B (mesma resposta de "indisponível")', format($q$select public.chat_enviar_direta(%L, 'oi B')$q$, t.id('membro_b')), 'não está disponível');
select t.como('membro_b');
select t.throws('membro B NÃO manda direta para gente do clube A', format($q$select public.chat_enviar_direta(%L, 'oi A')$q$, t.id('membro_a')), 'não está disponível');
select t.permitido('membro B manda direta para o membro B2', format($q$select public.chat_enviar_direta(%L, 'oi B2')$q$, t.id('membro_b2')));
select t.como('membro_a2');
select t.eq('membro A2 lê a direta que recebeu', t.n($q$select count(*) from public.chat_mensagens where texto = 'oi A2'$q$), 1);
select t.como('membro_a');
select t.eq('membro A NÃO lê a direta entre B e B2', t.nv($q$select count(*) from public.chat_mensagens where texto = 'oi B2'$q$), 0);
select t.como('lider_a');
select t.ok('a liderança do clube lê as diretas do PRÓPRIO clube (moderação)', t.n($q$select count(*) from public.chat_mensagens where texto = 'oi A2'$q$) = 1);
select t.eq('...mas nunca as do clube B', t.nv($q$select count(*) from public.chat_mensagens where texto = 'oi B2'$q$), 0);
reset role;
select t.throws('gatilho: participante de OUTRO clube em conversa é impossível (mesmo como dono do banco)',
  format($q$insert into public.chat_participantes (conversa_id, usuario_id) values ((select id from public.chat_conversas where tipo = 'direta' and club_id = %L limit 1), %L)$q$, t.id('clube_a'), t.id('membro_b')), 'clube');

-- ---------- moderação ----------
select id as msg_a from public.chat_mensagens where texto = 'oi pessoal do A' \gset
insert into t.ids values ('msg_a', :'msg_a');
select t.como('lider_b');
select t.throws('líder B NÃO apaga mensagem do clube A (mesma resposta de "não encontrada")', format($q$select public.chat_apagar_mensagem(%L)$q$, t.id('msg_a')), 'não encontrada');
select t.como('membro_a');
select t.throws('membro NÃO apaga mensagem', format($q$select public.chat_apagar_mensagem(%L)$q$, t.id('msg_a')), 'liderança');
select t.como('lider_a');
select t.permitido('líder A apaga mensagem do PRÓPRIO clube', format($q$select public.chat_apagar_mensagem(%L)$q$, t.id('msg_a')));
select t.eq('a lista de conversas da liderança (chat_todas_conversas): só o clube A (geral, unidade A1, direta A/A2)', t.n('select count(*) from public.chat_todas_conversas()'), 3);
select t.como('lider_b');
select t.eq('a lista de conversas do líder B: só o clube B (geral, unidade B1, direta B/B2)', t.n('select count(*) from public.chat_todas_conversas()'), 3);
-- a VIEW que o app lê (chat_mensagens_visiveis): mensagem apagada some para o membro e a liderança DO CLUBE ainda vê o texto
select t.como('membro_a');
select t.eq('membro A: a mensagem apagada vem SEM texto pela view do app', t.txt(format($q$select coalesce(texto, '(oculto)') from public.chat_mensagens_visiveis where id = %L$q$, t.id('msg_a'))), '(oculto)');
select t.como('lider_a');
select t.eq('líder A: a mesma mensagem apagada vem COM texto (moderação)', t.txt(format($q$select coalesce(texto, '(oculto)') from public.chat_mensagens_visiveis where id = %L$q$, t.id('msg_a'))), 'oi pessoal do A');
reset role;
select id as msg_b from public.chat_mensagens where texto = 'oi pessoal do B' \gset
insert into t.ids values ('msg_b', :'msg_b');
select t.como('lider_b');
select t.permitido('líder B apaga mensagem do PRÓPRIO clube', format($q$select public.chat_apagar_mensagem(%L)$q$, t.id('msg_b')));
select t.eq('líder B: a mensagem apagada do clube B vem COM texto (a liderança do B modera; o helper legado não vale mais)', t.txt(format($q$select coalesce(texto, '(oculto)') from public.chat_mensagens_visiveis where id = %L$q$, t.id('msg_b'))), 'oi pessoal do B');
select t.eq('líder B NÃO enxerga a mensagem do clube A pela view', t.nv(format('select count(*) from public.chat_mensagens_visiveis where id = %L', t.id('msg_a'))), 0);
select t.como('membro_b');
select t.eq('membro B: a mensagem apagada do B vem SEM texto', t.txt(format($q$select coalesce(texto, '(oculto)') from public.chat_mensagens_visiveis where id = %L$q$, t.id('msg_b'))), '(oculto)');
select t.como('membro_a');
select t.eq('membro comum não recebe a lista de moderação', t.n('select count(*) from public.chat_todas_conversas()'), 0);
reset role;
select t.eq('as mensagens apagadas são uma de cada clube (cada liderança apagou a do PRÓPRIO clube)', (select count(*) from public.chat_mensagens where apagada and ((id = t.id('msg_a') and club_id = t.id('clube_a')) or (id = t.id('msg_b') and club_id = t.id('clube_b')))), 2);

-- ---------- bichinho ----------
select t.como('membro_a');
select t.permitido('membro A adota um cachorro', $q$select public.bichinho_adotar('Rex', 'cachorro')$q$);
select t.eq('membro A cuida do bichinho: +2 pontos', t.txt($q$select public.bichinho_cuidar('alimentar')->>'pontos_ganhos'$q$), '2');
select t.como('membro_b');
select t.permitido('membro B adota um gato', $q$select public.bichinho_adotar('Mimi', 'gato')$q$);
select t.como('pais_a');
select t.eq('responsável não vê os bichinhos do clube', t.nv('select count(*) from public.pets_do_clube()'), 0);
select t.como('membro_a');
select t.eq('"bichinhos do clube" do A: só o Rex', t.txt($q$select string_agg(pet_nome, ',') from public.pets_do_clube()$q$), 'Rex');
select t.eq('meu_bichinho() do A é o Rex', t.txt($q$select public.meu_bichinho()->>'nome'$q$), 'Rex');
select t.como('membro_b');
select t.eq('"bichinhos do clube" do B: só a Mimi', t.txt($q$select string_agg(pet_nome, ',') from public.pets_do_clube()$q$), 'Mimi');
select t.eq('membro B NÃO lê o bichinho do A pela tabela', t.nv(format('select count(*) from public.bichinhos where usuario_id = %L', t.id('membro_a'))), 0);
select t.bloqueado('membro NÃO grava bichinho direto', format($q$insert into public.bichinhos (usuario_id, especie, nome, club_id) values (%L, 'gato', 'Falso', %L)$q$, t.id('membro_b2'), t.id('clube_b')));
select t.como('lider_a');
select t.eq('líder A lê os bichinhos do clube A (1) e nenhum do B', t.n('select count(*) from public.bichinhos'), 1);
select t.como('lider_b');
select t.eq('líder B lê só o bichinho do clube B', t.n('select count(*) from public.bichinhos'), 1);
reset role;
select t.eq('os bichinhos ficaram cada um no seu clube', (select count(*) from public.bichinhos where (usuario_id = t.id('membro_a') and club_id = t.id('clube_a')) or (usuario_id = t.id('membro_b') and club_id = t.id('clube_b'))), 2);
select t.eq('o +2 do bichinho entrou no clube A', (select count(*) from public.pontos where origem = 'bichinho' and usuario_id = t.id('membro_a') and club_id = t.id('clube_a')), 1);

-- ---------- bíblia ----------
select t.como('membro_a');
select t.permitido('membro A começa a ler Gênesis 1', $q$select public.biblia_iniciar_leitura('gn', 1)$q$);
select t.como('membro_b');
select t.permitido('membro B começa a ler Gênesis 1', $q$select public.biblia_iniciar_leitura('gn', 1)$q$);
reset role;
update public.biblia_leitura_atual set aberto_em = now() - interval '10 minutes';
select t.eq('as leituras em andamento ficaram no clube de cada um', (select count(*) from public.biblia_leitura_atual where (usuario_id = t.id('membro_a') and club_id = t.id('clube_a')) or (usuario_id = t.id('membro_b') and club_id = t.id('clube_b'))), 2);
select t.como('membro_a');
select t.eq('membro A confirma a leitura: +2 pontos', t.txt($q$select public.biblia_confirmar_leitura('gn', 1)->>'pontos_ganhos'$q$), '2');
select t.como('membro_b');
select t.eq('membro B confirma a leitura: +2 pontos', t.txt($q$select public.biblia_confirmar_leitura('gn', 1)->>'pontos_ganhos'$q$), '2');
select t.eq('membro B lê só a própria leitura', t.n('select count(*) from public.biblia_leituras'), 1);
select t.eq('minha_leitura_biblia() traz 1 capítulo', t.txt($q$select public.minha_leitura_biblia()->>'total_lidos'$q$), '1');
select t.bloqueado('membro NÃO grava leitura direto', format($q$insert into public.biblia_leituras (usuario_id, livro_abrev, capitulo, club_id) values (%L, 'gn', 2, %L)$q$, t.id('membro_b'), t.id('clube_b')));
select t.como('lider_b');
select t.eq('líder B NÃO lê a leitura do membro do clube A', t.nv(format('select count(*) from public.biblia_leituras where usuario_id = %L', t.id('membro_a'))), 0);
select t.como('lider_a');
select t.eq('líder A lê a leitura do membro do clube A', t.n(format('select count(*) from public.biblia_leituras where usuario_id = %L', t.id('membro_a'))), 1);
select t.como('membro_b');
select t.eq('a Bíblia (livros e versículos) é igual para todos: membro B lê o catálogo', t.n('select count(*) from public.biblia_livros') > 60 and true, true);
select t.como_anon();
select t.eq('anon não lê leituras', t.nv('select count(*) from public.biblia_leituras'), 0);
reset role;
select t.eq('os pontos da Bíblia caíram no clube de cada um', (select count(*) from public.pontos where origem = 'biblia' and ((usuario_id = t.id('membro_a') and club_id = t.id('clube_a')) or (usuario_id = t.id('membro_b') and club_id = t.id('clube_b')))), 2);

select t.fim();
rollback;
