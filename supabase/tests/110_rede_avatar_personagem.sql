-- REDE DBV (migration 500) — AVATAR-PERSONAGEM entre clubes e a flag de consentimento só do dono.
-- Prova: quem escolheu o personagem no app do clube aparece com o PERSONAGEM na rede (feed, perfil,
-- stories, busca, comentário) para membro de OUTRO clube, sem passar pelo gate de imagem; quando é
-- personagem, `foto` vem null MESMO com a autorização de imagem arquivada (a escolha da pessoa vale);
-- quem usa foto continua gateado (sem autorização = null; arquivada = foto; responsável desligou = null);
-- `imagem_autorizada` só no próprio perfil (null para os outros); o ARQUIVO da foto de perfil continua
-- só abrindo com autorização, e um caminho forjado perfis/<uuid>-x.jpg (que não é o de profiles.foto)
-- nunca abre; grants e search_path continuam fechados; anon sem nada.
-- 515 (AJUSTE DE REGRA, menores): as duas criancas (membro_a/membro_a2) so sao vistas com foto/nome completo por quem e do CLUBE delas.
-- Os asserts de feed/perfil/busca passaram a ser lidos por instrutor_a (mesmo clube; feed "Meu clube", pois o post nasce 'clube') e
-- o leitor de OUTRO clube (membro_b) ganhou asserts de NEGACAO (nao ve crianca nem o arquivo do rosto, com ou sem autorizacao).
begin;
\ir _lib.sql
\ir _fixtures.sql

\o /dev/null
select t.como_cron();
set local session_replication_role = replica;
-- membro_a: usa FOTO (rosto). membro_a2: escolheu o PERSONAGEM no app do clube, mas tem uma foto antiga gravada.
update public.profiles set nome = 'Ana de Souza Lima',
       foto = 'http://x/storage/v1/object/public/imagens/perfis/' || t.id('membro_a') || '-1.jpg', avatar_tipo = 'foto'
 where id = t.id('membro_a');
update public.profiles set nome = 'Caio Pereira Dias',
       foto = 'http://x/storage/v1/object/public/imagens/perfis/' || t.id('membro_a2') || '-1.jpg',
       avatar_tipo = 'personagem',
       avatar = '{"pele":"#f1c27d","cabelo":"curto","corCabelo":"#2b1d0e","roupa":"lisa","corRoupa":"#1e3a8a","acessorio":"nenhum","corAcessorio":"#1e3a8a"}'::jsonb
 where id = t.id('membro_a2');
update public.profiles set nome = 'Bruno Costa Neto' where id = t.id('membro_b');
set local session_replication_role = origin;
select t.mk('admin_110', 'Admin Plataforma', 'diretoria', 'ativo', 'clube_b');
insert into public.platform_admins (user_id, papel) values (t.id('admin_110'), 'operacao');
-- arquivos no bucket privado: o legítimo de cada um + um FORJADO no padrão perfis/<uuid>-x.jpg
insert into storage.objects (bucket_id, name) values
  ('imagens', 'perfis/' || t.id('membro_a') || '-1.jpg'),
  ('imagens', 'perfis/' || t.id('membro_a2') || '-1.jpg'),
  ('imagens', 'perfis/' || t.id('membro_a') || '-x.jpg');
create function t.arq(p_chave text, p_suf text default '-1.jpg') returns text language sql as $$
  select 'perfis/' || t.id(p_chave) || p_suf;
$$;
create function t.autor_no_feed(p_chave text, p_campo text) returns text language plpgsql as $$
declare v text;
begin
  execute format($q$select e->'autor'->>%L from jsonb_array_elements(public.rede_feed('meu_clube')->'itens') e
                    where e->'autor'->>'id' = %L limit 1$q$, p_campo, t.id(p_chave)::text) into v;
  return v;
exception when others then return 'ERRO: ' || sqlerrm;
end $$;
grant usage on schema t to public;
reset role;
\o

-- =============================================================================
--  1. Estrutura: grants e search_path continuam como na 490/471
-- =============================================================================
select t.eq('_comunidade_autor_json sem EXECUTE para anon/authenticated, security definer, search_path vazio',
  (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = '_comunidade_autor_json'
      and not has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute')
      and p.prosecdef and coalesce(p.proconfig, '{}') @> array['search_path=""']), 1::bigint);
select t.eq('rede_perfil: authenticated executa, anon não, search_path vazio',
  (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'rede_perfil'
      and has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute')
      and p.prosecdef and coalesce(p.proconfig, '{}') @> array['search_path=""']), 1::bigint);
select t.como_anon();
select t.throws('anon não abre perfil', $q$select public.rede_perfil()$q$);
reset role;

-- =============================================================================
--  2. Rede ligada nos dois clubes; cada um publica
-- =============================================================================
select t.como('admin_110');
select public.admin_recurso_do_clube_definir(t.id('clube_a'), 'comunidade', true);
select public.admin_recurso_do_clube_definir(t.id('clube_b'), 'comunidade', true);
select t.como('membro_a');
select t.eq('membro com foto publica', t.txt($q$select public.rede_publicar('livre', 'Olá da Ana!')->>'status'$q$), 'publicado');
select t.como('membro_a2');
select t.eq('membro com personagem publica', t.txt($q$select public.rede_publicar('livre', 'Olá do Caio!')->>'status'$q$), 'publicado');
reset role;

-- =============================================================================
--  3. Membro do MESMO clube (instrutor_a): personagem aparece; foto continua gateada
-- =============================================================================
select t.como('instrutor_a');
select t.eq('feed: quem escolheu o personagem vem com avatar_tipo = personagem', t.autor_no_feed('membro_a2', 'avatar_tipo'), 'personagem');
select t.ok('...e o JSON das peças (sem rosto)', t.autor_no_feed('membro_a2', 'avatar') like '%"cabelo"%');
select t.eq('...e foto NULA (tem foto antiga gravada, mas escolheu o personagem)', coalesce(t.autor_no_feed('membro_a2', 'foto'), 'nula'), 'nula');
select t.eq('feed: quem usa foto SEM autorização: foto nula', coalesce(t.autor_no_feed('membro_a', 'foto'), 'nula'), 'nula');
select t.eq('...sem avatar_tipo', coalesce(t.autor_no_feed('membro_a', 'avatar_tipo'), 'nulo'), 'nulo');
select t.eq('...sem avatar', coalesce(t.autor_no_feed('membro_a', 'avatar'), 'nulo'), 'nulo');
select t.eq('perfil de outro clube (personagem): avatar_tipo', t.txt(format($q$select public.rede_perfil(%L)->>'avatar_tipo'$q$, t.id('membro_a2'))), 'personagem');
select t.ok('...com as peças', t.txt(format($q$select public.rede_perfil(%L)->>'avatar'$q$, t.id('membro_a2'))) like '%"roupa"%');
select t.eq('...e foto nula', t.txt(format($q$select coalesce(public.rede_perfil(%L)->>'foto', 'nula')$q$, t.id('membro_a2'))), 'nula');
select t.eq('perfil de outro clube (foto, sem autorização): foto nula', t.txt(format($q$select coalesce(public.rede_perfil(%L)->>'foto', 'nula')$q$, t.id('membro_a'))), 'nula');
select t.eq('imagem_autorizada de OUTRA pessoa não vem (é flag de consentimento do dono)',
  t.txt(format($q$select coalesce(public.rede_perfil(%L)->>'imagem_autorizada', 'oculta')$q$, t.id('membro_a'))), 'oculta');
select t.eq('...nem para quem usa personagem', t.txt(format($q$select coalesce(public.rede_perfil(%L)->>'imagem_autorizada', 'oculta')$q$, t.id('membro_a2'))), 'oculta');
select t.eq('busca: personagem vem para outro clube', t.txt($q$select e->>'avatar_tipo' from jsonb_array_elements(public.rede_buscar('caio')->'pessoas') e$q$), 'personagem');
select t.eq('...e sem foto', t.txt($q$select coalesce(e->>'foto', 'nula') from jsonb_array_elements(public.rede_buscar('caio')->'pessoas') e$q$), 'nula');
select t.como('membro_b');
select t.eq('ARQUIVO da foto (sem autorização) não abre para outro clube', t.nv(format($q$select count(*) from storage.objects where bucket_id = 'imagens' and name = %L$q$, t.arq('membro_a'))), 0::bigint);
select t.eq('ARQUIVO da foto antiga de quem usa personagem também não', t.nv(format($q$select count(*) from storage.objects where bucket_id = 'imagens' and name = %L$q$, t.arq('membro_a2'))), 0::bigint);

-- 515: a criança de OUTRO clube não existe para quem é de fora (nem perfil, nem busca, nem no feed da Comunidade)
select t.throws('OUTRO clube: perfil da criança indisponível', format($q$select public.rede_perfil(%L)$q$, t.id('membro_a2')), 'não está disponível');
select t.eq('OUTRO clube: a criança não aparece na busca', t.n($q$select jsonb_array_length(public.rede_buscar('caio')->'pessoas')$q$), 0::bigint);
select t.eq('OUTRO clube: o post da criança não está no feed da Comunidade', t.txt($q$select count(*)::text from jsonb_array_elements(public.rede_feed('todos')->'itens') e$q$), '0');
-- o próprio dono vê a própria flag
select t.como('membro_a');
select t.eq('meu perfil: imagem_autorizada = false (explica por que a foto não aparece)', t.txt($q$select public.rede_perfil()->>'imagem_autorizada'$q$), 'false');
select t.eq('...e foto nula também para mim (o que os outros veem)', t.txt($q$select coalesce(public.rede_perfil()->>'foto', 'nula')$q$), 'nula');
select t.como('membro_a2');
select t.eq('meu perfil (personagem): avatar_tipo', t.txt($q$select public.rede_perfil()->>'avatar_tipo'$q$), 'personagem');
select t.eq('...imagem_autorizada vem (é meu)', t.txt($q$select public.rede_perfil()->>'imagem_autorizada'$q$), 'false');

-- =============================================================================
--  4. Diretoria arquiva a autorização dos dois: foto aparece só para quem usa FOTO
-- =============================================================================
select t.como('lider_a');
select public.rede_marcar_autorizacao_imagem(t.id('membro_a'), true);
select public.rede_marcar_autorizacao_imagem(t.id('membro_a2'), true);
select t.como('instrutor_a');
select t.ok('feed: com autorização, a foto de quem usa foto aparece', t.autor_no_feed('membro_a', 'foto') like '%perfis/%');
select t.ok('perfil: idem', t.txt(format($q$select public.rede_perfil(%L)->>'foto'$q$, t.id('membro_a'))) like '%perfis/%');
select t.eq('...e o ARQUIVO abre para quem é do clube dele', t.n(format($q$select count(*) from storage.objects where bucket_id = 'imagens' and name = %L$q$, t.arq('membro_a'))), 1::bigint);
select t.como('membro_b');
select t.eq('...mas NUNCA para outro clube (515: rosto de menor só dentro do clube), nem com autorização', t.nv(format($q$select count(*) from storage.objects where bucket_id = 'imagens' and name = %L$q$, t.arq('membro_a'))), 0::bigint);
select t.eq('caminho FORJADO perfis/<uuid>-x.jpg (não é o de profiles.foto) NÃO abre, mesmo com autorização',
  t.nv(format($q$select count(*) from storage.objects where bucket_id = 'imagens' and name = %L$q$, t.arq('membro_a', '-x.jpg'))), 0::bigint);
select t.como('instrutor_a');
select t.eq('personagem + autorização arquivada: foto CONTINUA nula (a escolha da pessoa vale)', coalesce(t.autor_no_feed('membro_a2', 'foto'), 'nula'), 'nula');
select t.eq('...e o personagem continua', t.autor_no_feed('membro_a2', 'avatar_tipo'), 'personagem');
select t.eq('...no perfil também', t.txt(format($q$select coalesce(public.rede_perfil(%L)->>'foto', 'nula')$q$, t.id('membro_a2'))), 'nula');
select t.como('instrutor_a');
select t.eq('imagem_autorizada de outra pessoa segue oculta mesmo arquivada',
  t.txt(format($q$select coalesce(public.rede_perfil(%L)->>'imagem_autorizada', 'oculta')$q$, t.id('membro_a'))), 'oculta');
select t.como('membro_a');
select t.eq('meu perfil: imagem_autorizada = true', t.txt($q$select public.rede_perfil()->>'imagem_autorizada'$q$), 'true');

-- =============================================================================
--  5. Troca de personagem para foto: passa a valer o gate (e vice-versa)
-- =============================================================================
select t.como('membro_a2');
select public.salvar_avatar(null, 'foto');   -- volta para a foto no app do clube
select t.como('instrutor_a');
select t.ok('voltou para foto (autorização arquivada): a foto aparece', t.autor_no_feed('membro_a2', 'foto') like '%perfis/%');
select t.eq('...sem personagem', coalesce(t.autor_no_feed('membro_a2', 'avatar_tipo'), 'nulo'), 'nulo');
select t.como('membro_a2');
select public.salvar_avatar('{"pele":"#f1c27d","cabelo":"curto","corCabelo":"#2b1d0e","roupa":"lisa","corRoupa":"#1e3a8a"}'::jsonb, 'personagem');
select t.como('instrutor_a');
select t.eq('escolheu o personagem de novo: foto some na hora', coalesce(t.autor_no_feed('membro_a2', 'foto'), 'nula'), 'nula');
select t.eq('...e o personagem volta', t.autor_no_feed('membro_a2', 'avatar_tipo'), 'personagem');

-- =============================================================================
--  6. O responsável desliga: foto some; personagem não depende disso
-- =============================================================================
select t.como('pais_a');
select t.eq('responsável desliga a imagem do filho', t.txt(format($q$select public.rede_responsavel_imagem(%L, true)->>'imagem_autorizada'$q$, t.id('membro_a'))), 'false');
select t.como('instrutor_a');
select t.eq('desligado: foto some do feed', coalesce(t.autor_no_feed('membro_a', 'foto'), 'nula'), 'nula');
select t.como('membro_b');
select t.eq('...e o arquivo deixa de abrir', t.nv(format($q$select count(*) from storage.objects where bucket_id = 'imagens' and name = %L$q$, t.arq('membro_a'))), 0::bigint);
select t.como('instrutor_a');
select t.eq('o personagem do outro continua aparecendo', t.autor_no_feed('membro_a2', 'avatar_tipo'), 'personagem');

-- =============================================================================
--  7. Recurso desligado: tudo bloqueado (o personagem não abre porta nenhuma)
-- =============================================================================
select t.como('admin_110');
select public.admin_recurso_do_clube_definir(t.id('clube_b'), 'comunidade', false);
select t.como('membro_b');
select t.throws('desligado: rede_perfil bloqueado', format($q$select public.rede_perfil(%L)$q$, t.id('membro_a2')), 'não está liberada');
select t.throws('desligado: feed bloqueado', $q$select public.rede_feed('todos')$q$, 'não está liberada');
reset role;

select t.fim();
rollback;
