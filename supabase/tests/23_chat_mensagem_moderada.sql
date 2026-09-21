-- Hardening final: o TEXTO de uma mensagem de chat moderada (apagada) só pode ser lido pela liderança DO CLUBE.
--   Antes: a view do app escondia o texto, mas a policy de leitura da TABELA `chat_mensagens` só decide quem vê a
--          CONVERSA — qualquer membro do chat geral lia `texto` da mensagem apagada direto pela API (PostgREST).
--   Agora: o texto original mora em `chat_mensagens_apagadas` (RLS: só liderança do clube da mensagem; ninguém grava
--          direto) e a linha da mensagem guarda só o marcador "(mensagem apagada)".
-- Clube A = Tenant 001 (legado); clube B = Tenant 002 (teste). Os asserts são espelhados A <-> B.
begin;
\ir _lib.sql
\ir _fixtures.sql

-- ---------- preparo: uma mensagem ofensiva em cada clube + uma normal que NÃO pode ser afetada ----------
select t.como('membro_a');
select t.permitido('membro A escreve no chat geral do clube A', $q$select public.chat_enviar_geral('palavras ruins do A')$q$);
select t.como('lider_a');
select t.permitido('líder A escreve uma mensagem normal', $q$select public.chat_enviar_geral('aviso normal do A')$q$);
select t.como('membro_b');
select t.permitido('membro B escreve no chat geral do clube B', $q$select public.chat_enviar_geral('palavras ruins do B')$q$);
reset role;
select id as msg_a from public.chat_mensagens where texto = 'palavras ruins do A' and club_id = (select id from t.ids where chave = 'clube_a') \gset
select id as msg_b from public.chat_mensagens where texto = 'palavras ruins do B' and club_id = (select id from t.ids where chave = 'clube_b') \gset
select id as msg_ok from public.chat_mensagens where texto = 'aviso normal do A' \gset
insert into t.ids values ('msg_a', :'msg_a'), ('msg_b', :'msg_b'), ('msg_ok', :'msg_ok');

select t.como('membro_a2');
select t.eq('linha de base: antes de apagar, outro membro do clube lê o texto normalmente', t.txt(format($q$select texto from public.chat_mensagens where id = %L$q$, t.id('msg_a'))), 'palavras ruins do A');

-- ---------- a moderação de cada clube apaga a mensagem do PRÓPRIO clube ----------
select t.como('lider_a');
select t.permitido('líder A apaga a mensagem ofensiva do clube A', format($q$select public.chat_apagar_mensagem(%L)$q$, t.id('msg_a')));
select t.como('lider_b');
select t.permitido('líder B apaga a mensagem ofensiva do clube B', format($q$select public.chat_apagar_mensagem(%L)$q$, t.id('msg_b')));
reset role;

-- ---------- 1) NENHUM membro lê o texto original pela TABELA (o vazamento que existia) ----------
select t.como('membro_a2');
select t.eq('membro A2 (outra unidade do clube A): a tabela devolve só o marcador, não o texto original', t.txt(format($q$select texto from public.chat_mensagens where id = %L$q$, t.id('msg_a'))), '(mensagem apagada)');
select t.eq('membro A2: a linha continua marcada como apagada (o app segue mostrando "removida pela liderança")', t.txt(format($q$select apagada::text from public.chat_mensagens where id = %L$q$, t.id('msg_a'))), 'true');
select t.eq('membro A2: o texto original não aparece em NENHUMA coluna de NENHUMA linha visível', t.n($q$select count(*) from public.chat_mensagens m where m::text like '%ruins do A%'$q$), 0);
select t.eq('membro A2: pela view do app o texto da apagada é nulo', t.txt(format($q$select coalesce(texto, '(oculto)') from public.chat_mensagens_visiveis where id = %L$q$, t.id('msg_a'))), '(oculto)');
select t.eq('membro A2: a mensagem NORMAL segue intacta', t.txt(format($q$select texto from public.chat_mensagens where id = %L$q$, t.id('msg_ok'))), 'aviso normal do A');
select t.como('membro_a');
select t.eq('o AUTOR da mensagem também só vê o marcador (a moderação já decidiu esconder)', t.txt(format($q$select texto from public.chat_mensagens where id = %L$q$, t.id('msg_a'))), '(mensagem apagada)');
select t.como('membro_b');
select t.eq('membro B: o texto ofensivo do PRÓPRIO clube também não vaza pela tabela', t.n($q$select count(*) from public.chat_mensagens m where m::text like '%ruins do B%'$q$), 0);
select t.eq('membro B nunca enxerga a mensagem do clube A (nem o marcador)', t.nv(format('select count(*) from public.chat_mensagens where id = %L', t.id('msg_a'))), 0);

-- ---------- 2) o texto original só existe para a liderança DO CLUBE ----------
select t.como('lider_a');
select t.eq('líder A lê o original pela view (moderação)', t.txt(format($q$select texto from public.chat_mensagens_visiveis where id = %L$q$, t.id('msg_a'))), 'palavras ruins do A');
select t.eq('líder A lê o original pela trilha de moderação', t.txt(format($q$select texto_original from public.chat_mensagens_apagadas where mensagem_id = %L$q$, t.id('msg_a'))), 'palavras ruins do A');
select t.eq('líder A vê SÓ as apagadas do próprio clube (1)', t.n('select count(*) from public.chat_mensagens_apagadas'), 1);
select t.eq('líder A NÃO vê o original do clube B por nenhum caminho (view)', t.nv(format('select count(*) from public.chat_mensagens_visiveis where id = %L', t.id('msg_b'))), 0);
select t.eq('líder A NÃO vê o original do clube B por nenhum caminho (trilha)', t.nv(format('select count(*) from public.chat_mensagens_apagadas where mensagem_id = %L', t.id('msg_b'))), 0);
select t.como('lider_b');
select t.eq('líder B lê o original do PRÓPRIO clube (espelho)', t.txt(format($q$select texto from public.chat_mensagens_visiveis where id = %L$q$, t.id('msg_b'))), 'palavras ruins do B');
select t.eq('líder B vê SÓ as apagadas do próprio clube (1)', t.n('select count(*) from public.chat_mensagens_apagadas'), 1);
select t.eq('líder B NÃO lê o original do clube A (trilha)', t.nv(format('select count(*) from public.chat_mensagens_apagadas where mensagem_id = %L', t.id('msg_a'))), 0);
select t.eq('líder B NÃO lê o original do clube A (view)', t.nv(format('select count(*) from public.chat_mensagens_visiveis where id = %L', t.id('msg_a'))), 0);
select t.como('membro_a');
select t.eq('membro comum não lê a trilha de moderação', t.nv('select count(*) from public.chat_mensagens_apagadas'), 0);
select t.como('pais_a');
select t.eq('responsável não lê a trilha de moderação', t.nv('select count(*) from public.chat_mensagens_apagadas'), 0);
select t.como('pend_a');
select t.eq('cadastro pendente não lê a trilha de moderação', t.nv('select count(*) from public.chat_mensagens_apagadas'), 0);
select t.como_anon();
select t.eq('anon não lê a trilha de moderação', t.nv('select count(*) from public.chat_mensagens_apagadas'), 0);
select t.eq('anon não lê o chat', t.nv('select count(*) from public.chat_mensagens'), 0);

-- ---------- 3) ninguém adultera a trilha direto (nem a liderança): só a RPC grava ----------
select t.como('lider_a');
select t.bloqueado('líder A NÃO insere na trilha direto', format($q$insert into public.chat_mensagens_apagadas (mensagem_id, club_id, texto_original) values (%L, %L, 'x')$q$, t.id('msg_ok'), t.id('clube_a')));
select t.bloqueado('líder A NÃO edita o original guardado', $q$update public.chat_mensagens_apagadas set texto_original = 'adulterado'$q$);
select t.bloqueado('líder A NÃO apaga a trilha', $q$delete from public.chat_mensagens_apagadas$q$);
select t.bloqueado('líder A NÃO devolve o texto original à mensagem (a linha do chat não é editável)', format($q$update public.chat_mensagens set texto = 'reposto' where id = %L$q$, t.id('msg_a')));
select t.como('membro_a');
select t.bloqueado('membro NÃO insere na trilha', format($q$insert into public.chat_mensagens_apagadas (mensagem_id, club_id, texto_original) values (%L, %L, 'x')$q$, t.id('msg_ok'), t.id('clube_a')));
reset role;
select t.ok('authenticated só tem SELECT na trilha (a RLS filtra); anon não tem nada',
  has_table_privilege('authenticated', 'public.chat_mensagens_apagadas', 'select')
  and not has_table_privilege('authenticated', 'public.chat_mensagens_apagadas', 'insert')
  and not has_table_privilege('authenticated', 'public.chat_mensagens_apagadas', 'update')
  and not has_table_privilege('authenticated', 'public.chat_mensagens_apagadas', 'delete')
  and not has_table_privilege('anon', 'public.chat_mensagens_apagadas', 'select'));
select t.ok('a trilha tem RLS ligada e club_id obrigatório', (select relrowsecurity from pg_class where oid = 'public.chat_mensagens_apagadas'::regclass)
  and exists (select 1 from pg_attribute where attrelid = 'public.chat_mensagens_apagadas'::regclass and attname = 'club_id' and attnotnull));
select t.throws('até o dono do banco: a trilha não aceita o clube de OUTRO clube (FK composta mensagem+clube)', format($q$insert into public.chat_mensagens_apagadas (mensagem_id, club_id, texto_original) values (%L, %L, 'x')$q$, t.id('msg_ok'), t.id('clube_b')));
select t.ok('a trilha NÃO está na publicação do Realtime (senão o texto original vazaria pelo websocket)',
  not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'chat_mensagens_apagadas'));

-- ---------- 4) apagar é idempotente e não perde o original (2ª chamada não grava o marcador por cima) ----------
select t.como('lider_a');
select t.permitido('apagar de novo a mesma mensagem não falha', format($q$select public.chat_apagar_mensagem(%L)$q$, t.id('msg_a')));
select t.eq('o original guardado continua sendo o texto de verdade após apagar 2 vezes', t.txt(format($q$select texto_original from public.chat_mensagens_apagadas where mensagem_id = %L$q$, t.id('msg_a'))), 'palavras ruins do A');
select t.como('lider_b');
select t.throws('líder B NÃO apaga mensagem do clube A (resposta de "não encontrada")', format($q$select public.chat_apagar_mensagem(%L)$q$, t.id('msg_a')), 'não encontrada');
select t.como('membro_a');
select t.throws('membro NÃO apaga mensagem', format($q$select public.chat_apagar_mensagem(%L)$q$, t.id('msg_ok')), 'liderança');
reset role;
select t.eq('a mensagem normal continua NÃO apagada e com o texto', (select texto || '/' || apagada::text from public.chat_mensagens where id = t.id('msg_ok')), 'aviso normal do A/false');
select t.eq('a trilha tem exatamente 2 linhas (uma por clube), cada uma no clube da mensagem', (select count(*) from public.chat_mensagens_apagadas a join public.chat_mensagens m on m.id = a.mensagem_id and m.club_id = a.club_id), 2);

select t.fim();
rollback;
