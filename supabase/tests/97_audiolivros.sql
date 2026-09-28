-- Migration 370: audiolivros das Classes. Catálogo sem dado de pessoa: qualquer autenticado lê os
-- livros ativos, o anônimo não lê nada, e só o admin da plataforma troca vídeo ou desativa livro.
-- Também prova que o catálogo inicial entrou NA ORDEM CERTA (3 playlists estavam invertidas no YouTube).
begin;
\ir _lib.sql
\ir _fixtures.sql

\o /dev/null
select t.signup('admin97', '{"tipo":"fundador","nome":"Admin 97"}'::jsonb);
insert into public.platform_admins (user_id, papel, motivo) values (t.id('admin97'), 'operacao', 'teste 97');
\o

-- ---------- catálogo inicial ----------
select t.eq('6 livros no catálogo', (select count(*) from public.audiolivros), 6);
select t.eq('120 capítulos (Vaso de Barro sem o capítulo 16 repetido)', (select count(*) from public.audiolivro_capitulos), 120);
select t.eq('O Livro Amargo começa no capítulo 1 (no YouTube começava no Apêndice)',
  (select c.titulo from public.audiolivro_capitulos c join public.audiolivros a on a.id = c.audiolivro_id where a.titulo = 'O Livro Amargo' and c.ordem = 1), 'Capítulo 1');
select t.eq('...e termina no Apêndice',
  (select c.titulo from public.audiolivro_capitulos c join public.audiolivros a on a.id = c.audiolivro_id where a.titulo = 'O Livro Amargo' order by c.ordem desc limit 1), 'Apêndice');
select t.eq('O Fim do Começo: primeiro vídeo é o do capítulo 1',
  (select c.video_id from public.audiolivro_capitulos c join public.audiolivros a on a.id = c.audiolivro_id where a.titulo = 'O Fim do Começo' and c.ordem = 1), 'YouNzy6J5EM');
select t.eq('Um Simples Lanche termina no Epílogo',
  (select c.titulo from public.audiolivro_capitulos c join public.audiolivros a on a.id = c.audiolivro_id where a.titulo = 'Um Simples Lanche' order by c.ordem desc limit 1), 'Epílogo');

-- ---------- leitura ----------
select t.como('membro_a');
select t.eq('desbravador lê os 6 livros', json_array_length(public.audiolivros_listar())::bigint, 6);
select t.eq('desbravador não lê a tabela direto', t.nv('select count(*) from public.audiolivros'), 0);
select t.throws('desbravador não usa a lista do admin', 'select public.admin_audiolivros_listar()');
select t.como_anon();
select t.throws('anônimo não executa a lista', 'select public.audiolivros_listar()');

-- ---------- escrita: só admin ----------
reset role;
select id as cap from public.audiolivro_capitulos order by id limit 1 \gset
select id as livro from public.audiolivros where titulo = 'Vaso de Barro' \gset
select t.como('lider_a');
select t.throws('diretoria de clube não troca vídeo', format('select public.admin_audiolivro_capitulo_trocar(%L, %L)', :'cap', 'AAAAAAAAAAA'));
select t.throws('diretoria de clube não desativa livro', format('select public.admin_audiolivro_ativar(%L, false)', :'livro'));

select t.como('admin97');
select t.throws('admin: ID de vídeo inválido é recusado', format('select public.admin_audiolivro_capitulo_trocar(%L, %L)', :'cap', 'https://x'), 'Link do YouTube');
select public.admin_audiolivro_capitulo_trocar(:'cap', 'AAAAAAAAAAA');
select public.admin_audiolivro_ativar(:'livro', false);
select t.eq('admin vê os 6 (inclusive o inativo)', json_array_length(public.admin_audiolivros_listar())::bigint, 6);
reset role;
select t.eq('vídeo trocado', (select video_id from public.audiolivro_capitulos where id = :'cap'), 'AAAAAAAAAAA');
select t.eq('troca ficou na auditoria', (select count(*) from public.platform_admin_audit where acao = 'audiolivro_capitulo_trocar'), 1);

select t.como('membro_a');
select t.eq('livro desativado some para o desbravador', json_array_length(public.audiolivros_listar())::bigint, 5);
reset role;

select t.fim();
rollback;
