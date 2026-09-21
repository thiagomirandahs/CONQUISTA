-- Achados da revisão red-team da rodada 2 (cada um foi REPRODUZIDO antes de corrigir):
--   1) ALTO  — um diretor de qualquer clube travava o fechamento automático de leilões de TODOS os clubes
--              (ponto gigante estourava o int do somatório; e um leilão com erro derrubava o laço inteiro do cron);
--   2) MÉDIO — o bucket público "imagens" aceitava qualquer arquivo de qualquer tamanho;
--   3) BAIXO/MÉDIO — o aparelho de push continuava ligado ao usuário anterior (vazava avisos de um clube para o aparelho
--              de quem entrou depois); endpoint de push aceitava http:// (SSRF cego pela Edge Function);
--   4) BAIXO — authenticated/anon tinham TRUNCATE/TRIGGER/REFERENCES em todas as tabelas (TRUNCATE ignora RLS e atinge todos os clubes).
begin;
\ir _lib.sql
\ir _fixtures.sql

-- ---------- 1a) pontos: teto que impede estourar o somatório ----------
select t.como('lider_b');
select t.bloqueado('líder B NÃO lança ponto gigante (2.147.483.000)', format($q$insert into public.pontos (unidade_id, origem, pontos, motivo, lancado_por) values (%L, 'unidade', 2147483000, 'x', %L)$q$, t.id('B1'), t.id('lider_b')));
select t.bloqueado('líder B NÃO lança ponto acima do teto (1.000.001)', format($q$insert into public.pontos (unidade_id, origem, pontos, motivo, lancado_por) values (%L, 'unidade', 1000001, 'x', %L)$q$, t.id('B1'), t.id('lider_b')));
select t.bloqueado('líder B NÃO lança ponto abaixo do piso (-1.000.001)', format($q$insert into public.pontos (unidade_id, origem, pontos, motivo, lancado_por) values (%L, 'unidade', -1000001, 'x', %L)$q$, t.id('B1'), t.id('lider_b')));
select t.permitido('valor legítimo grande segue permitido (prêmio de chefão de 500.000)', format($q$insert into public.pontos (unidade_id, origem, pontos, motivo, lancado_por) values (%L, 'unidade', 500000, 'prêmio grande', %L)$q$, t.id('B1'), t.id('lider_b')));
reset role;
select t.throws('nem o dono do banco grava ponto fora do teto', format($q$insert into public.pontos (unidade_id, origem, pontos, motivo) values (%L, 'unidade', 2147483000, 'x')$q$, t.id('B1')));
select t.ok('o somatório de pontos da temporada nunca estoura int (cálculo em bigint, limitado)', (select public._pontos_temporada_unidade_interno(t.id('B1')) is not null));
select t.eq('unidade SEM pontos soma 0 (o limite não pode virar o teto quando não há linhas)', public._pontos_temporada_unidade_interno(t.id('A2')), 0);
select t.como('membro_a2');
select t.eq('quem não tem ponto nenhum vê total 0 (não o teto)', t.txt('select public.meu_total_pontos()::text'), '0');
select t.eq('o ranking do clube não devolve total absurdo para quem não pontuou', t.n($q$select count(*) from json_array_elements(public.ranking_totais()->'pessoas') x where (x->>'total')::bigint > 100000$q$), 0);
reset role;

-- ---------- 1b) leilão: valores razoáveis ----------
select t.como('lider_b');
select t.permitido('líder B liga o leilão do PRÓPRIO clube', format($q$insert into public.club_features (club_id, feature, enabled) values (%L, 'leilao', true) on conflict (club_id, feature) do update set enabled = true$q$, t.id('clube_b')));
select t.throws('item com preço-base absurdo é recusado', $q$select public.criar_leilao('x', now() + interval '1 day', '[{"nome":"i","preco_base":900000000}]'::jsonb)$q$, 'alto demais');
select t.permitido('leilão legítimo do clube B', $q$select public.criar_leilao('Leilão B', now() + interval '1 day', '[{"nome":"Item B","preco_base":10}]'::jsonb)$q$);
reset role;
select id as item_b from public.leilao_itens where club_id = t.id('clube_b') limit 1 \gset
select t.como('membro_b');
select t.throws('lance absurdo é recusado', format($q$select public.dar_lance(%L, 2000000000)$q$, :'item_b'), 'inválido');

-- ---------- 1c) o cron isola a falha de um leilão: um clube com erro NÃO trava o dos outros ----------
select t.como_cron();  -- sem claim de usuário (o default do club_id do leilão seria o clube de quem estava logado)
insert into public.leiloes (titulo, fecha_em, criado_por) values ('Leilão A', now() + interval '1 day', t.id('lider_a'));
insert into public.leilao_itens (leilao_id, nome, preco_base, ordem) select id, 'Item A', 10, 1 from public.leiloes where titulo = 'Leilão A';
-- os dois vencem; o do B é o mais antigo (é o 1º da fila); e o fechamento do B vai FALHAR
update public.leiloes set fecha_em = now() - interval '1 minute';
update public.leiloes set created_at = now() - interval '2 days' where club_id = t.id('clube_b');
create function t.boom() returns trigger language plpgsql as $$ begin raise exception 'boom do teste'; end $$;
select format($f$create trigger t_boom before update on public.leiloes for each row when (new.status = 'encerrado' and new.club_id = %L) execute function t.boom()$f$, t.id('clube_b')) \gexec
select t.como_cron();
select t.permitido('o cron NÃO estoura quando o fechamento de um leilão falha', $q$select public.fechar_leiloes_vencidos()$q$);
select t.eq('...e o leilão do clube A (depois do que falhou na fila) foi encerrado', (select status from public.leiloes where titulo = 'Leilão A'), 'encerrado');
select t.eq('...enquanto o do clube B (que falhou) segue aberto para o próximo ciclo', (select status from public.leiloes where club_id = t.id('clube_b')), 'aberto');
reset role;
drop trigger t_boom on public.leiloes;

-- ---------- 2) bucket público de imagens: só imagem e com teto de tamanho ----------
select t.eq('bucket "imagens" tem tipos permitidos (só imagem) e limite de tamanho (<= 20 MB)',
  (select count(*) from storage.buckets where id = 'imagens' and allowed_mime_types is not null and file_size_limit is not null and file_size_limit <= 20 * 1024 * 1024
     and not exists (select 1 from unnest(allowed_mime_types) m where m !~ '^image/')), 1);
select t.ok('...e os formatos que o app usa continuam permitidos (jpeg, png, webp, gif, heic)',
  (select allowed_mime_types @> array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic'] from storage.buckets where id = 'imagens'));

-- ---------- 3) push: o aparelho segue o usuário que está logado; endpoint só https ----------
select t.como('membro_a');
select t.permitido('membro A registra o aparelho', $q$select public.push_registrar('https://push.exemplo.test/aparelho-1', 'chave-a', 'auth-a')$q$);
select t.como('membro_b');
select t.permitido('o MESMO aparelho passa a ser do membro B (entrou depois neste aparelho)', $q$select public.push_registrar('https://push.exemplo.test/aparelho-1', 'chave-b', 'auth-b')$q$);
select t.throws('endpoint http:// é recusado (SSRF cego)', $q$select public.push_registrar('http://169.254.169.254/x', 'k', 'a')$q$, 'https');
select t.bloqueado('insert direto com http:// também é recusado (CHECK na tabela)', format($q$insert into public.push_subscriptions (user_id, endpoint, p256dh, auth) values (%L, 'http://interno.local/x', 'k', 'a')$q$, t.id('membro_b')));
select t.como_anon();
select t.throws('anon NÃO registra aparelho', $q$select public.push_registrar('https://push.exemplo.test/x', 'k', 'a')$q$);
reset role;
select t.eq('o aparelho agora é do membro B (e só dele)', (select count(*) from public.push_subscriptions where endpoint = 'https://push.exemplo.test/aparelho-1' and user_id = t.id('membro_b')), 1);
select t.eq('...o clube A NÃO recebe mais push nesse aparelho', (select count(*) from public.push_destinatarios(t.id('clube_a'), 'todos', null) where endpoint = 'https://push.exemplo.test/aparelho-1'), 0);
select t.eq('...e o clube B recebe', (select count(*) from public.push_destinatarios(t.id('clube_b'), 'todos', null) where endpoint = 'https://push.exemplo.test/aparelho-1'), 1);

-- o mesmo para o app Android (token do FCM)
select t.como('membro_a');
select t.permitido('membro A registra o token do aparelho Android', $q$select public.push_token_registrar('fcm-token-do-aparelho-0001-abcdef', 'android')$q$);
select t.como('membro_b');
select t.permitido('o MESMO aparelho Android passa a ser do membro B', $q$select public.push_token_registrar('fcm-token-do-aparelho-0001-abcdef', 'android')$q$);
select t.throws('token curto demais é recusado', $q$select public.push_token_registrar('x', 'android')$q$, 'inválido');
select t.como_anon();
select t.throws('anon NÃO registra token', $q$select public.push_token_registrar('fcm-token-do-aparelho-0002-abcdef', 'android')$q$);
reset role;
select t.eq('o token agora é do membro B (e só dele)', (select count(*) from public.push_tokens where token = 'fcm-token-do-aparelho-0001-abcdef' and user_id = t.id('membro_b')), 1);

-- ---------- 4) privilégios de tabela: sem TRUNCATE/TRIGGER/REFERENCES para usuário ----------
select t.eq('authenticated e anon NÃO têm TRUNCATE/TRIGGER/REFERENCES em nenhuma tabela do public',
  (select count(*) from information_schema.role_table_grants where table_schema = 'public' and grantee in ('authenticated', 'anon') and privilege_type in ('TRUNCATE', 'TRIGGER', 'REFERENCES')), 0);
select t.como('lider_b');
select t.throws('líder B NÃO consegue TRUNCATE em tabela (ignoraria o RLS e atingiria todos os clubes)', $q$truncate public.notificacoes$q$, 'permission denied');
reset role;

select t.fim();
rollback;
