-- Hardening final: o bucket "imagens" (avatar, mural, emblema — fotos de crianças) deixa de ser PÚBLICO.
--   * `imagens` é PRIVADO (a leitura é por URL assinada, que o Storage só entrega a quem passa na policy SELECT);
--   * a policy SELECT é por CLUBE: colegas do clube veem avatar/mural/emblema do PRÓPRIO clube; o responsável vê a foto do filho;
--     comprovante antigo e qualquer outra coisa: só o dono e a liderança; NUNCA entre clubes, nem para anon;
--   * a policy INSERT só aceita o formato/escopo que o app usa (avatar próprio, mural próprio de membro ativo, emblema por liderança do
--     clube da unidade) — antes qualquer usuário de qualquer clube subia em qualquer caminho;
--   * nasce o bucket `publico` (reservado para asset REALMENTE público): leitura por URL, escrita só da liderança do clube, na pasta do clube.
-- Clube A = Tenant 001 (legado); clube B = Tenant 002 (teste). Asserts espelhados. O Storage bloqueia UPDATE/DELETE direto por SQL, então
-- a visibilidade é provada pela listagem (a MESMA policy SELECT que governa createSignedUrl) e o envio pela policy INSERT.
begin;
\ir _lib.sql
\ir _fixtures.sql

-- ---------- preparo (como postgres): pessoas extras, objetos e uma foto de mural órfã em cada clube ----------
select t.mk('pend_a', 'Pend A', 'desbravador', 'pendente', 'clube_a', 'A1');
select gen_random_uuid() as fantasma_a \gset
select gen_random_uuid() as fantasma_b \gset
insert into public.fotos (url, legenda, autor_id, club_id) values
  ('https://proj.supabase.co/storage/v1/object/public/imagens/mural/orfa-a.jpg', 'órfã A', null, t.id('clube_a')),
  ('https://proj.supabase.co/storage/v1/object/public/imagens/mural/orfa-b.jpg', 'órfã B', null, t.id('clube_b'));
-- O Storage ATUAL grava o dono só em `owner_id` (texto) e deixa `owner` nulo; objetos antigos (Tenant 001) têm `owner`. Os dois formatos
-- precisam valer igual: metade dos objetos abaixo usa `owner` (antigo) e a outra metade `owner_id` (atual).
insert into storage.objects (bucket_id, name, owner) values
  ('imagens', 'perfis/' || t.id('membro_a')  || '-1.jpg',                t.id('membro_a')),
  ('imagens', 'perfis/' || t.id('pend_a')    || '-1.jpg',                t.id('pend_a')),
  ('imagens', 'mural/'  || t.id('membro_a')  || '-1.jpg',                t.id('membro_a')),
  ('imagens', 'mural/'  || t.id('membro_a')  || '-1-thumb.jpg',          t.id('membro_a')),
  ('imagens', 'mural/orfa-a.jpg',                                        :'fantasma_a'),
  ('imagens', 'unidades/xyz-emblema-1.png',                              t.id('lider_a')),
  ('imagens', 'qualquer/coisa.jpg',                                      t.id('membro_a')),
  ('imagens', 'mural/'  || t.id('membro_b')  || '-1.jpg',                t.id('membro_b')),
  ('imagens', 'unidades/' || t.id('B1') || '-emblema-1.png',             t.id('lider_b'));
insert into storage.objects (bucket_id, name, owner_id) values
  ('imagens', 'perfis/' || t.id('membro_a2') || '-1.jpg',                t.id('membro_a2')::text),
  ('imagens', 'perfis/' || t.id('pais_a')    || '-1.jpg',                t.id('pais_a')::text),
  ('imagens', 'unidades/' || t.id('A1') || '-emblema-1.png',             t.id('lider_a')::text),
  ('imagens', 'missoes/' || t.id('membro_a') || '-1.jpg',                t.id('membro_a')::text),
  ('imagens', 'perfis/' || t.id('membro_b')  || '-1.jpg',                t.id('membro_b')::text),
  ('imagens', 'mural/orfa-b.jpg',                                        :'fantasma_b'),
  ('imagens', 'missoes/' || t.id('membro_b') || '-1.jpg',                t.id('membro_b')::text);
create function t.vis(p_nome text) returns bigint language sql as $$
  select t.nv(format('select count(*) from storage.objects where bucket_id = ''imagens'' and name = %L', p_nome));
$$;
create function t.total_imagens() returns bigint language sql as $$
  select t.n($q$select count(*) from storage.objects where bucket_id = 'imagens'$q$);
$$;

-- ---------- 0) configuração dos buckets ----------
select t.eq('bucket "imagens" é PRIVADO (não abre por URL pública)', (select count(*) from storage.buckets where id = 'imagens' and not public), 1);
select t.eq('bucket "imagens" segue só com imagem e teto de tamanho', (select count(*) from storage.buckets where id = 'imagens' and file_size_limit <= 20 * 1024 * 1024
  and allowed_mime_types is not null and not exists (select 1 from unnest(allowed_mime_types) m where m !~ '^image/')), 1);
select t.eq('bucket "comprovacoes" continua privado', (select count(*) from storage.buckets where id = 'comprovacoes' and not public), 1);
select t.eq('bucket "publico" existe, é público, só aceita imagem e tem teto de 5 MB', (select count(*) from storage.buckets where id = 'publico' and public
  and file_size_limit <= 5 * 1024 * 1024 and allowed_mime_types is not null and not exists (select 1 from unnest(allowed_mime_types) m where m !~ '^image/')), 1);
select t.ok('nenhuma policy de storage.objects dá leitura ao papel anon', not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and cmd in ('SELECT', 'ALL') and 'anon' = any (roles)));

-- ---------- 1) Tenant 001: quem vê o quê no bucket imagens ----------
select t.como('membro_a');
select t.eq('membro A vê o PRÓPRIO avatar', t.vis('perfis/' || t.id('membro_a') || '-1.jpg'), 1);
select t.eq('membro A vê o avatar de um COLEGA do clube (para o ranking)', t.vis('perfis/' || t.id('membro_a2') || '-1.jpg'), 1);
select t.eq('membro A NÃO vê o avatar do responsável (pais não aparecem para os colegas)', t.vis('perfis/' || t.id('pais_a') || '-1.jpg'), 0);
select t.eq('membro A NÃO vê o avatar de cadastro pendente', t.vis('perfis/' || t.id('pend_a') || '-1.jpg'), 0);
select t.eq('membro A vê a foto do mural e a miniatura', t.vis('mural/' || t.id('membro_a') || '-1.jpg') + t.vis('mural/' || t.id('membro_a') || '-1-thumb.jpg'), 2);
select t.eq('membro A vê a foto de mural ÓRFÃ (autor excluído) do PRÓPRIO clube', t.vis('mural/orfa-a.jpg'), 1);
select t.eq('membro A vê o emblema da unidade do clube', t.vis('unidades/' || t.id('A1') || '-emblema-1.png'), 1);
select t.eq('membro A vê o PRÓPRIO comprovante antigo e o arquivo solto', t.vis('missoes/' || t.id('membro_a') || '-1.jpg') + t.vis('qualquer/coisa.jpg'), 2);
select t.eq('membro A NÃO vê nada do clube B (avatar, mural, órfã, emblema, comprovante)',
  t.vis('perfis/' || t.id('membro_b') || '-1.jpg') + t.vis('mural/' || t.id('membro_b') || '-1.jpg') + t.vis('mural/orfa-b.jpg')
  + t.vis('unidades/' || t.id('B1') || '-emblema-1.png') + t.vis('missoes/' || t.id('membro_b') || '-1.jpg'), 0);
select t.eq('membro A: a listagem inteira tem exatamente 8 arquivos (sem erro de policy)', t.total_imagens(), 8);
select t.como('membro_a2');
select t.eq('membro A2 vê o avatar e o mural do colega, a órfã e o emblema do clube', t.vis('perfis/' || t.id('membro_a') || '-1.jpg') + t.vis('mural/' || t.id('membro_a') || '-1.jpg') + t.vis('mural/orfa-a.jpg') + t.vis('unidades/' || t.id('A1') || '-emblema-1.png'), 4);
select t.eq('membro A2 NÃO vê o comprovante antigo nem o arquivo solto do colega (privados)', t.vis('missoes/' || t.id('membro_a') || '-1.jpg') + t.vis('qualquer/coisa.jpg'), 0);
select t.eq('membro A2: a listagem inteira tem exatamente 6 arquivos', t.total_imagens(), 6);
select t.como('lider_a');
select t.eq('líder A vê TUDO do clube A (11), inclusive avatar de pendente/responsável e o comprovante antigo', t.total_imagens(), 11);
select t.eq('líder A NÃO vê nada do clube B', t.vis('perfis/' || t.id('membro_b') || '-1.jpg') + t.vis('mural/orfa-b.jpg') + t.vis('unidades/' || t.id('B1') || '-emblema-1.png') + t.vis('missoes/' || t.id('membro_b') || '-1.jpg'), 0);
select t.como('pais_a');
select t.eq('responsável vê a foto do FILHO vinculado e a própria, nada além', t.vis('perfis/' || t.id('membro_a') || '-1.jpg') + t.vis('perfis/' || t.id('pais_a') || '-1.jpg'), 2);
select t.eq('responsável NÃO vê mural, emblema, colegas nem comprovantes (a listagem tem só 2)', t.total_imagens(), 2);
select t.como('pend_a');
select t.eq('cadastro pendente vê só o PRÓPRIO avatar', t.total_imagens(), 1);

-- ---------- 2) Tenant 002: o espelho ----------
select t.como('membro_b');
select t.eq('membro B vê o próprio avatar, mural, comprovante, o emblema e a órfã do clube B (5)', t.total_imagens(), 5);
select t.eq('membro B NÃO vê nada do clube A', t.vis('perfis/' || t.id('membro_a') || '-1.jpg') + t.vis('mural/' || t.id('membro_a') || '-1.jpg') + t.vis('mural/orfa-a.jpg') + t.vis('unidades/' || t.id('A1') || '-emblema-1.png'), 0);
select t.como('lider_b');
select t.eq('líder B vê os 5 do clube B', t.total_imagens(), 5);
select t.eq('líder B NÃO vê nada do clube A (nem avatar, nem a órfã, nem o emblema)', t.vis('perfis/' || t.id('membro_a') || '-1.jpg') + t.vis('mural/orfa-a.jpg') + t.vis('unidades/' || t.id('A1') || '-emblema-1.png') + t.vis('missoes/' || t.id('membro_a') || '-1.jpg'), 0);
select t.como('pais_b');
select t.eq('responsável B vê só a foto do filho do clube B (a listagem tem 1)', t.total_imagens(), 1);
select t.como_anon();
select t.eq('anon não lista NADA no bucket imagens', t.nv($q$select count(*) from storage.objects where bucket_id = 'imagens'$q$), 0);
reset role;

-- ---------- 2b) alterar/apagar (policies UPDATE/DELETE): o dono OU a liderança do clube do dono — nos dois formatos de dono ----------
select t.eq('dono_do_objeto lê o formato antigo (owner) e o atual (owner_id), e ignora lixo',
  (public.dono_do_objeto(t.id('membro_a'), null) = t.id('membro_a'))::text || (public.dono_do_objeto(null, t.id('membro_a')::text) = t.id('membro_a'))::text
  || coalesce(public.dono_do_objeto(null, 'nao-e-uuid')::text, 'nulo') || coalesce(public.dono_do_objeto(null, null)::text, 'nulo'), 'truetruenulonulo');
select t.como('membro_a');
select t.eq('membro A altera/apaga o PRÓPRIO arquivo (owner_id) e o antigo (owner)', t.txt(format($q$select public.pode_alterar_imagem(null, %L)::text || public.pode_alterar_imagem(%L, null)::text$q$, t.id('membro_a')::text, t.id('membro_a'))), 'truetrue');
select t.eq('membro A NÃO altera/apaga arquivo de colega, do clube B, nem sem dono', t.txt(format($q$select public.pode_alterar_imagem(null, %L)::text || public.pode_alterar_imagem(%L, null)::text || public.pode_alterar_imagem(null, null)::text$q$, t.id('membro_a2')::text, t.id('membro_b'))), 'falsefalsefalse');
select t.como('lider_a');
select t.eq('líder A altera/apaga arquivo de membro do PRÓPRIO clube (nos dois formatos)', t.txt(format($q$select public.pode_alterar_imagem(null, %L)::text || public.pode_alterar_imagem(%L, null)::text$q$, t.id('membro_a')::text, t.id('membro_a2'))), 'truetrue');
select t.eq('líder A NÃO altera/apaga arquivo do clube B (nem owner nem owner_id)', t.txt(format($q$select public.pode_alterar_imagem(null, %L)::text || public.pode_alterar_imagem(%L, null)::text$q$, t.id('membro_b')::text, t.id('membro_b'))), 'falsefalse');
select t.como('lider_b');
select t.eq('líder B NÃO altera/apaga arquivo do clube A', t.txt(format($q$select public.pode_alterar_imagem(null, %L)::text || public.pode_alterar_imagem(%L, null)::text$q$, t.id('membro_a')::text, t.id('membro_a'))), 'falsefalse');
reset role;

-- ---------- 3) quem pode ENVIAR (policy INSERT: predicado que a policy usa) ----------
create function t.sobe(p_nome text) returns text language sql as $$ select t.txt(format('select public.pode_subir_imagem(%L)::text', p_nome)); $$;
select t.como('membro_a');
select t.eq('membro A sobe o PRÓPRIO avatar', t.sobe('perfis/' || t.id('membro_a') || '-9.jpg'), 'true');
select t.eq('membro A NÃO sobe avatar em nome de outra pessoa', t.sobe('perfis/' || t.id('membro_a2') || '-9.jpg'), 'false');
select t.eq('membro A sobe foto e miniatura do PRÓPRIO mural', t.sobe('mural/' || t.id('membro_a') || '-9.jpg') || t.sobe('mural/' || t.id('membro_a') || '-9-thumb.jpg'), 'truetrue');
select t.eq('membro A NÃO sobe mural em nome de outra pessoa', t.sobe('mural/' || t.id('membro_a2') || '-9.jpg'), 'false');
select t.eq('membro A sobe o comprovante do fallback antigo (missoes/atividades) em seu nome', t.sobe('missoes/' || t.id('membro_a') || '-9.jpg') || t.sobe('atividades/' || t.id('membro_a') || '-9.mp4'), 'truetrue');
select t.eq('membro A NÃO troca emblema de unidade (só liderança do clube da unidade)', t.sobe('unidades/' || t.id('A1') || '-emblema-9.png'), 'false');
select t.eq('membro A NÃO sobe em caminho solto nem em pasta aninhada', t.sobe('qualquer/coisa-9.jpg') || t.sobe('perfis/' || t.id('membro_a') || '-9/x/y.jpg') || t.sobe(t.id('membro_a') || '/foto.jpg'), 'falsefalsefalse');
select t.como('lider_a');
select t.eq('líder A troca o emblema/bandeira das unidades do PRÓPRIO clube', t.sobe('unidades/' || t.id('A1') || '-emblema-9.png') || t.sobe('unidades/' || t.id('A2') || '-bandeira-9.jpg'), 'truetrue');
select t.eq('líder A NÃO mexe na unidade do clube B', t.sobe('unidades/' || t.id('B1') || '-emblema-9.png'), 'false');
select t.como('lider_b');
select t.eq('líder B troca o emblema da unidade do PRÓPRIO clube', t.sobe('unidades/' || t.id('B1') || '-emblema-9.png'), 'true');
select t.eq('líder B NÃO mexe na unidade do clube A', t.sobe('unidades/' || t.id('A1') || '-emblema-9.png'), 'false');
select t.como('pais_a');
select t.eq('responsável sobe o PRÓPRIO avatar, mas NÃO posta no mural nem grava comprovante', t.sobe('perfis/' || t.id('pais_a') || '-9.jpg') || t.sobe('mural/' || t.id('pais_a') || '-9.jpg') || t.sobe('missoes/' || t.id('pais_a') || '-9.jpg'), 'truefalsefalse');
select t.como('pend_a');
select t.eq('cadastro pendente sobe o avatar do cadastro, mas não posta no mural', t.sobe('perfis/' || t.id('pend_a') || '-9.jpg') || t.sobe('mural/' || t.id('pend_a') || '-9.jpg'), 'truefalse');
select t.como('membro_b');
select t.eq('membro B NÃO sobe nada em nome do clube A', t.sobe('perfis/' || t.id('membro_a') || '-9.jpg') || t.sobe('mural/' || t.id('membro_a') || '-9.jpg'), 'falsefalse');
select t.eq('membro B sobe o PRÓPRIO mural', t.sobe('mural/' || t.id('membro_b') || '-9.jpg'), 'true');
select t.como_anon();
select t.eq('anon não sobe nada (o predicado nem é executável por anon)', t.sobe('perfis/' || t.id('membro_a') || '-9.jpg'), 'ERRO: permission denied for function pode_subir_imagem');
reset role;

-- os nomes recusados também são barrados de VERDADE pelo INSERT em storage.objects (RLS do Storage)
select t.como('membro_a');
select t.bloqueado('INSERT direto: membro A NÃO grava avatar de outra pessoa', format($q$insert into storage.objects (bucket_id, name, owner) values ('imagens', %L, %L)$q$, 'perfis/' || t.id('membro_a2') || '-8.jpg', t.id('membro_a')));
select t.bloqueado('INSERT direto: membro A NÃO grava em caminho solto', format($q$insert into storage.objects (bucket_id, name, owner) values ('imagens', 'qualquer/x-8.jpg', %L)$q$, t.id('membro_a')));
select t.bloqueado('INSERT direto: membro A NÃO troca emblema', format($q$insert into storage.objects (bucket_id, name, owner) values ('imagens', %L, %L)$q$, 'unidades/' || t.id('A1') || '-emblema-8.png', t.id('membro_a')));
select t.como('lider_b');
select t.bloqueado('INSERT direto: líder B NÃO grava emblema em unidade do clube A', format($q$insert into storage.objects (bucket_id, name, owner) values ('imagens', %L, %L)$q$, 'unidades/' || t.id('A1') || '-emblema-8.png', t.id('lider_b')));
reset role;

-- ---------- 4) bucket "publico": só a liderança do PRÓPRIO clube escreve, na pasta do clube ----------
select t.como('lider_a');
select t.eq('líder A grava asset público na pasta do clube A', t.txt(format($q$select public.pode_gerir_pasta_publica(%L)::text$q$, t.id('clube_a') || '/logo.png')), 'true');
select t.eq('líder A NÃO grava na pasta do clube B nem na raiz nem em pasta aninhada', t.txt(format($q$select (public.pode_gerir_pasta_publica(%L) or public.pode_gerir_pasta_publica('logo.png') or public.pode_gerir_pasta_publica(%L))::text$q$, t.id('clube_b') || '/logo.png', t.id('clube_a') || '/a/b.png')), 'false');
select t.bloqueado('INSERT direto: líder A NÃO grava no bucket publico do clube B', format($q$insert into storage.objects (bucket_id, name, owner) values ('publico', %L, %L)$q$, t.id('clube_b') || '/logo.png', t.id('lider_a')));
select t.como('membro_a');
select t.eq('membro comum NÃO grava no bucket publico (nem no do próprio clube)', t.txt(format($q$select public.pode_gerir_pasta_publica(%L)::text$q$, t.id('clube_a') || '/logo.png')), 'false');
select t.como('lider_b');
select t.eq('líder B grava na pasta do clube B e NÃO na do A', t.txt(format($q$select public.pode_gerir_pasta_publica(%L)::text || public.pode_gerir_pasta_publica(%L)::text$q$, t.id('clube_b') || '/logo.png', t.id('clube_a') || '/logo.png')), 'truefalse');
select t.como('tesoureiro_a');
select t.eq('tesoureiro NÃO grava no bucket publico (só instrutor/diretoria)', t.txt(format($q$select public.pode_gerir_pasta_publica(%L)::text$q$, t.id('clube_a') || '/logo.png')), 'false');
select t.como_anon();
select t.eq('anon não lista o bucket publico (a leitura é só por URL)', t.nv($q$select count(*) from storage.objects where bucket_id = 'publico'$q$), 0);
reset role;

select t.fim();
rollback;
