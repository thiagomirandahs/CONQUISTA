-- REDE DBV (migration 515) — DOIS ALCANCES (Meu Clube x Comunidade), quem publica, conquistas seguras,
-- menores protegidos entre clubes e auditoria do admin da plataforma.
-- Prova: alcance 'clube' por padrao (app antigo = 'clube'); desbravador/conselheiro/tesoureiro/pais NAO publicam na
-- Comunidade, diretoria e instrutor publicam; repost nunca cria 'comunidade'; foto na Comunidade exige aprovacao e o servidor
-- confere tamanho/tipo; tipos novos sem video; o clube B nao ve o alcance 'clube' do A (post, curtir, salvar, comentar, comentarios,
-- denunciar); feed 'comunidade' so traz 'comunidade' ('todos' = 'comunidade'); autor que saiu do clube some (G6); desbravador nao
-- comenta conteudo de outro clube (G4); comentarios paginam sem repetir (G10); crianca de outro clube nao aparece na busca/perfil e
-- chega reduzida (1o nome + inicial, sem unidade, sem foto) em comentario; admin da plataforma so ve/modera item 'comunidade'
-- denunciado/em analise e TUDO fica no log append-only; conquista so pelo registro real (classe/especialidade concluida do PROPRIO
-- clube, por quem gere atividades), com nome reduzido e sem relatorio/evidencia; anon sem execucao; backfill da migration.
begin;
\ir _lib.sql
\ir _fixtures.sql

\o /dev/null
select t.como_cron();
insert into public.club_features (club_id, feature, enabled)
values (t.id('clube_a'), 'comunidade', true), (t.id('clube_b'), 'comunidade', true)
on conflict (club_id, feature) do update set enabled = true;
set local session_replication_role = replica;
update public.profiles set created_at = now() - interval '60 days'
 where id in (t.id('lider_a'), t.id('instrutor_a'), t.id('tesoureiro_a'), t.id('conselheiro_a'), t.id('membro_a'), t.id('membro_a2'),
              t.id('pais_a'), t.id('lider_b'), t.id('membro_b'));
update public.profiles set nome = 'Ana Clara Souza Lima' where id = t.id('membro_a2');
set local session_replication_role = origin;
select t.signup('admin_122', '{"tipo":"fundador","nome":"Admin Cento Vinte Dois"}'::jsonb);
update public.profiles set created_at = now() - interval '60 days' where id = t.id('admin_122');
insert into public.platform_admins (user_id, papel) values (t.id('admin_122'), 'operacao');
create function t.recuar(p_min int) returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.comunidade_posts set created_at = created_at - make_interval(mins => p_min);
  update public.comunidade_comentarios set created_at = created_at - make_interval(mins => p_min);
  update public.comunidade_bloqueios set created_at = created_at - make_interval(mins => p_min);
end $$;
insert into t.ids values ('f1', gen_random_uuid()), ('f2', gen_random_uuid()), ('f3', gen_random_uuid()), ('f4', gen_random_uuid()),
  ('f5', gen_random_uuid()), ('f6', gen_random_uuid());
create function t.cam(p_clube text, p_pessoa text, p_foto text, p_ext text default 'webp') returns text language sql as $$
  select t.id(p_clube)::text || '/' || t.id(p_pessoa)::text || '/' || t.id(p_foto)::text || '.' || p_ext;
$$;
create function t.obj(p_path text, p_bytes int default 120000, p_mime text default 'image/webp') returns void
language sql security definer set search_path = '' as $$
  insert into storage.objects (bucket_id, name, metadata) values ('comunidade', p_path, jsonb_build_object('size', p_bytes, 'mimetype', p_mime));
$$;
create function t.pub_count(p_chave text, p_so_com boolean) returns text language sql security definer set search_path = '' as $$
  select count(*)::text from public.comunidade_posts where autor_id = t.id(p_chave) and status = 'publicado' and (not p_so_com or alcance = 'comunidade');
$$;
create function t.pagina_toda(p_post uuid) returns text language plpgsql as $$
declare v_ant timestamptz; v_id uuid; r jsonb; v_ids text[] := '{}'; i int;
begin
  for i in 1 .. 10 loop
    r := public.comunidade_comentarios(p_post, v_ant, 2, v_id);
    v_ids := v_ids || coalesce((select array_agg(e ->> 'id') from jsonb_array_elements(r -> 'itens') e), '{}');
    exit when r -> 'proximo' is null or r ->> 'proximo' is null;
    v_ant := (r ->> 'proximo')::timestamptz; v_id := (r ->> 'proximo_id')::uuid;
  end loop;
  return array_length(v_ids, 1) || '|' || (select count(distinct x) from unnest(v_ids) x);
end $$;
grant usage on schema t to public;
reset role;
\o

-- =============================================================================
--  1. Estrutura, grants, anon
-- =============================================================================
select t.eq('posts: alcance NOT NULL, padrao clube, so clube|comunidade',
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'comunidade_posts'
      and column_name = 'alcance' and is_nullable = 'NO' and column_default like '%clube%'), 1::bigint);
select t.throws('alcance inventado e recusado pelo banco', format($q$insert into public.comunidade_posts (club_id, autor_id, autor_papel, legenda, status, alcance)
  values (%L, %L, 'diretoria', 'x', 'publicado', 'mundo')$q$, t.id('clube_a'), t.id('lider_a')), 'alcance_valido');
select t.throws('story nasce SO clube: alcance comunidade e impossivel', format($q$insert into public.rede_stories (club_id, autor_id, autor_papel, foto_path, status, alcance)
  values (%L, %L, 'diretoria', 'x/y/z.webp', 'publicado', 'comunidade')$q$, t.id('clube_a'), t.id('lider_a')), 'so_clube');
select t.eq('plataforma_acesso_log: RLS ligado, sem grant para anon/authenticated, com a guarda de manutencao',
  (select count(*) from pg_class c where c.oid = 'public.plataforma_acesso_log'::regclass and c.relrowsecurity
      and not exists (select 1 from information_schema.role_table_grants g where g.table_schema = 'public' and g.table_name = c.relname
                        and g.grantee in ('anon', 'authenticated', 'PUBLIC'))
      and exists (select 1 from pg_trigger g where g.tgrelid = c.oid and g.tgname = 'zz_manutencao_guarda')), 1::bigint);
select t.eq('helpers internos novos sem EXECUTE para anon/authenticated, security definer, search_path vazio',
  (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace
      and p.proname in ('_rede_item_visivel', '_rede_pode_ver_item', '_rede_leitor_do_clube', '_rede_nome_reduzido', '_rede_unidades_acima',
                        '_plataforma_acesso_registrar', '_plataforma_pode_item', '_comunidade_publicar_interno', '_plataforma_log_imutavel')
      and not has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute')
      and (p.prosecdef or p.proname = '_rede_nome_reduzido') and coalesce(p.proconfig, '{}') @> array['search_path=""']), 9::bigint);
select t.eq('RPCs novas: authenticated executa, anon NAO, search_path vazio',
  (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace
      and p.proname in ('rede_publicar', 'rede_publicar_conquista', 'comunidade_comentarios')
      and has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute')
      and p.prosecdef and coalesce(p.proconfig, '{}') @> array['search_path=""']), 3::bigint);
select t.eq('so existe UMA rede_publicar e UMA comunidade_comentarios (assinatura antiga substituida, sem ambiguidade)',
  (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('rede_publicar', 'comunidade_comentarios')), 2::bigint);
select t.como_anon();
select t.throws('anon nao publica conquista', format($q$select public.rede_publicar_conquista('classe', %L)$q$, gen_random_uuid()));
select t.throws('anon nao publica com alcance', $q$select public.rede_publicar('aviso', 'oi', null, null, null, null, 'comunidade')$q$);
select t.throws('anon nao lista comentarios', format($q$select public.comunidade_comentarios(%L, null, 10, null)$q$, gen_random_uuid()));
reset role;
select t.eq('_rede_nome_reduzido: 3 nomes', public._rede_nome_reduzido('ana clara souza lima'), 'Ana C.');
select t.eq('_rede_nome_reduzido: pula "de"', public._rede_nome_reduzido('Maria de Souza'), 'Maria S.');
select t.eq('_rede_nome_reduzido: so um nome', public._rede_nome_reduzido('Joao'), 'Joao');
select t.eq('_rede_nome_reduzido: vazio', public._rede_nome_reduzido('  '), 'Desbravador(a)');

-- =============================================================================
--  2. Quem publica (D2) e tipos (D3)
-- =============================================================================
select t.como('membro_a');
select t.throws('desbravador NAO publica na Comunidade (erro claro)', $q$select public.rede_publicar('aviso', 'oi', null, null, null, null, 'comunidade')$q$, 'diretoria e os instrutores');
-- app antigo: 6 argumentos, sem p_alcance
select t.eq('app antigo (sem p_alcance) publica no clube', t.txt($q$select public.rede_publicar('livre', 'Ola do clube!', null, null, null, null)->>'ok'$q$), 'true');
reset role;
insert into t.ids (chave, id) select 'post_clube_a', id from public.comunidade_posts where autor_id = t.id('membro_a');
select t.eq('...e nasceu com alcance clube', (select alcance from public.comunidade_posts where id = t.id('post_clube_a')), 'clube');
select t.recuar(5);
select t.como('conselheiro_a');
select t.throws('conselheiro NAO publica na Comunidade', $q$select public.rede_publicar('aviso', 'oi', null, null, null, null, 'comunidade')$q$, 'diretoria e os instrutores');
select t.como('tesoureiro_a');
select t.throws('tesoureiro NAO publica na Comunidade', $q$select public.rede_publicar('aviso', 'oi', null, null, null, null, 'comunidade')$q$, 'diretoria e os instrutores');
select t.como('pais_a');
select t.throws('responsavel NAO publica', $q$select public.rede_publicar('aviso', 'oi', null, null, null, null, 'comunidade')$q$, 'não publicam');
select t.como('conselheiro_a');
select t.eq('...mas conselheiro publica no Meu Clube', t.txt($q$select public.rede_publicar('atividade', 'Hoje teve unidade!')->>'ok'$q$), 'true');
select t.como('lider_a');
select t.eq('diretoria publica na Comunidade', t.txt($q$select public.rede_publicar('aviso', 'Reuniao de sabado', null, null, null, null, 'comunidade')->>'ok'$q$), 'true');
select t.throws('alcance inventado', $q$select public.rede_publicar('aviso', 'x', null, null, null, null, 'mundo')$q$, 'Alcance inválido');
select t.throws('video nao existe', $q$select public.rede_publicar('video', 'x')$q$, 'Tipo de publicação inválido');
select t.throws('tipo legado (livre) so no Meu Clube', $q$select public.rede_publicar('livre', 'x', null, null, null, null, 'comunidade')$q$, 'só existe no Meu Clube');
select t.throws('conquista por texto livre e recusada (qualquer alcance)', $q$select public.rede_publicar('conquista', 'Sou campeao', null, null, null, 'classe')$q$, 'registro real');
select t.throws('conquista por texto livre e recusada (mesmo pela diretoria, na Comunidade)', $q$select public.rede_publicar('conquista', 'Sou campeao', null, null, null, null, 'comunidade')$q$, 'registro real');
select t.eq('tipo evento no clube', t.txt($q$select public.rede_publicar('evento', 'Acampamento em outubro')->>'ok'$q$), 'true');
reset role;
insert into t.ids (chave, id) select 'post_com_a', id from public.comunidade_posts where autor_id = t.id('lider_a') and alcance = 'comunidade';
select t.eq('a publicacao da diretoria na Comunidade esta como comunidade', (select alcance from public.comunidade_posts where id = t.id('post_com_a')), 'comunidade');
select t.recuar(5);

-- repost: nunca vira comunidade
select t.como('lider_a');
select t.eq('repost (comunidade_publicar) cria alcance clube', t.txt(format($q$select public.comunidade_publicar(null, null, %L)->'post'->>'alcance'$q$, t.id('post_com_a'))), 'clube');
reset role;
select t.eq('nenhum repost jamais tem alcance comunidade', (select count(*) from public.comunidade_posts where repost_de is not null and alcance = 'comunidade'), 0::bigint);
select t.recuar(5);

-- foto: servidor confere tipo/tamanho; na Comunidade exige aprovacao
select t.obj(t.cam('clube_a', 'lider_a', 'f1'));
select t.obj(t.cam('clube_a', 'lider_a', 'f2'));
select t.obj(t.cam('clube_a', 'lider_a', 'f3'), 400000);
select t.obj(t.cam('clube_a', 'lider_a', 'f4'), 100000, 'image/png');
select t.como('lider_a');
select t.throws('foto_clube exige descricao (alt)', format($q$select public.rede_publicar('foto_clube', 'Acampamento', %L, null, null, null, 'comunidade')$q$, t.cam('clube_a', 'lider_a', 'f1')), 'Descreva a foto');
select t.throws('foto acima de 300 KB e recusada', format($q$select public.rede_publicar('foto_clube', 'x', %L, 'Grupo', null, null, 'comunidade')$q$, t.cam('clube_a', 'lider_a', 'f3')), 'grande demais');
select t.throws('foto que nao e JPEG/WebP e recusada', format($q$select public.rede_publicar('foto_clube', 'x', %L, 'Grupo', null, null, 'comunidade')$q$, t.cam('clube_a', 'lider_a', 'f4')), 'JPEG ou WebP');
select t.throws('extensao fora de jpg/webp e recusada', format($q$select public.rede_publicar('foto_clube', 'x', %L, 'Grupo', null, null, 'comunidade')$q$, t.cam('clube_a', 'lider_a', 'f5', 'png')), 'Foto inválida');
select t.eq('foto na COMUNIDADE entra EM ANALISE', t.txt(format($q$select public.rede_publicar('foto_clube', 'Acampamento', %L, 'Grupo no acampamento', null, null, 'comunidade')->>'status'$q$, t.cam('clube_a', 'lider_a', 'f1'))), 'em_analise');
select t.eq('foto no MEU CLUBE segue direta (legado)', t.txt(format($q$select public.rede_publicar('foto_clube', 'Acampamento 2', %L, 'Outro grupo')->>'status'$q$, t.cam('clube_a', 'lider_a', 'f2'))), 'publicado');
reset role;
insert into t.ids (chave, id) select 'post_foto_com', id from public.comunidade_posts where foto_path = t.cam('clube_a', 'lider_a', 'f1');
insert into t.ids (chave, id) select 'post_foto_clube', id from public.comunidade_posts where foto_path = t.cam('clube_a', 'lider_a', 'f2');
select t.eq('...e a foto da Comunidade avisou a diretoria do clube', (select count(*) from public.notificacoes where para_usuario = t.id('lider_a') and titulo like '%Foto aguardando%'), 1::bigint);

-- =============================================================================
--  3. Visibilidade: clube B nao ve o alcance 'clube' do A; feed por alcance
-- =============================================================================
select t.como('lider_b');
select t.throws('B nao abre o post "clube" do A', format($q$select public.comunidade_post(%L)$q$, t.id('post_clube_a')), 'não está disponível');
select t.throws('...nem curte', format($q$select public.comunidade_curtir(%L, true)$q$, t.id('post_clube_a')), 'não está disponível');
select t.throws('...nem salva', format($q$select public.rede_salvar(%L, true)$q$, t.id('post_clube_a')), 'não está disponível');
select t.throws('...nem comenta', format($q$select public.comunidade_comentar(%L, 'oi')$q$, t.id('post_clube_a')), 'não está disponível');
select t.throws('...nem lista comentarios', format($q$select public.comunidade_comentarios(%L)$q$, t.id('post_clube_a')), 'não está disponível');
select t.throws('...nem denuncia (sem oraculo de UUID entre clubes)', format($q$select public.comunidade_denunciar('post', %L, 'outro')$q$, t.id('post_clube_a')), 'não está disponível');
select t.eq('B ve o post da Comunidade do A', t.txt(format($q$select public.comunidade_post(%L)->>'alcance'$q$, t.id('post_com_a'))), 'comunidade');
select t.eq('feed comunidade do B: traz so comunidade (nenhum "clube" do A)', t.n(format($q$select count(*) from jsonb_array_elements(public.rede_feed('comunidade')->'itens') e where e->>'clube_id' = %L and e->>'alcance' <> 'comunidade'$q$, t.id('clube_a'))), 0::bigint);
select t.eq('...e traz o post da diretoria A', t.n(format($q$select count(*) from jsonb_array_elements(public.rede_feed('comunidade')->'itens') e where e->>'id' = %L$q$, t.id('post_com_a'))), 1::bigint);
select t.eq('"todos" (app antigo) = comunidade', t.n($q$select count(*) from jsonb_array_elements(public.rede_feed('todos')->'itens') e where e->>'alcance' = 'clube'$q$), 0::bigint);
select t.eq('...e o feed legado tambem so traz comunidade', t.n($q$select count(*) from jsonb_array_elements(public.comunidade_feed()->'itens') e where e->>'alcance' = 'clube'$q$), 0::bigint);
select t.eq('"meu_clube" do B nao traz nada do A', t.n(format($q$select count(*) from jsonb_array_elements(public.rede_feed('meu_clube')->'itens') e where e->>'clube_id' = %L$q$, t.id('clube_a'))), 0::bigint);
select t.throws('filtro inventado', $q$select public.rede_feed('mundo')$q$, 'Filtro inválido');
select t.como('lider_a');
select t.eq('"meu_clube" do A traz clube + comunidade do proprio A', t.n(format($q$select count(*) from jsonb_array_elements(public.rede_feed('meu_clube', null, null, 20)->'itens') e where e->>'id' in (%L, %L)$q$, t.id('post_clube_a'), t.id('post_com_a'))), 2::bigint);
select t.eq('"comunidade" do A traz so o alcance comunidade', t.n(format($q$select count(*) from jsonb_array_elements(public.rede_feed('comunidade', null, null, 20)->'itens') e where e->>'alcance' <> 'comunidade'$q$)), 0::bigint);
select t.como('membro_a');
select t.eq('desbravador do A le o post do proprio clube (comunidade)', t.txt(format($q$select public.comunidade_post(%L)->>'id'$q$, t.id('post_com_a'))), t.id('post_com_a')::text);
select t.eq('...e o proprio post "clube"', t.txt(format($q$select public.comunidade_post(%L)->>'id'$q$, t.id('post_clube_a'))), t.id('post_clube_a')::text);

-- G4: desbravador so comenta no PROPRIO clube
select t.como('membro_b');
select t.eq('desbravador de outro clube pode CURTIR conteudo da Comunidade', t.txt(format($q$select public.comunidade_curtir(%L, true)->>'eu_curti'$q$, t.id('post_com_a'))), 'true');
select t.throws('...mas NAO comenta (G4)', format($q$select public.comunidade_comentar(%L, 'Legal!')$q$, t.id('post_com_a')), 'seu clube');
select t.como('membro_a');
select t.eq('desbravador comenta no PROPRIO clube', t.txt(format($q$select public.comunidade_comentar(%L, 'Vou sim!')->>'ok'$q$, t.id('post_com_a'))), 'true');
select t.como('lider_b');
select t.eq('adulto de outro clube comenta no post de ADULTO da Comunidade', t.txt(format($q$select public.comunidade_comentar(%L, 'Boa!')->>'ok'$q$, t.id('post_com_a'))), 'true');

-- G10: paginacao de comentarios com empate de timestamp
reset role;
insert into public.comunidade_comentarios (post_id, club_id, autor_id, autor_papel, texto, status)
select t.id('post_com_a'), t.id('clube_a'), t.id('lider_a'), 'diretoria', 'empate ' || g, 'publicado' from generate_series(1, 3) g;
select t.como('lider_a');
select t.eq('comentarios: 5 no total, 5 distintos (sem repetir nem pular no empate)', t.pagina_toda(t.id('post_com_a')), '5|5');

-- G6: autor que saiu do clube some do feed
select t.recuar(5);
select t.como('instrutor_a');
select t.eq('instrutor publica na Comunidade', t.txt($q$select public.rede_publicar('atividade', 'Oficina de nos no sabado', null, null, null, null, 'comunidade')->>'ok'$q$), 'true');
reset role;
insert into t.ids (chave, id) select 'post_instr', id from public.comunidade_posts where autor_id = t.id('instrutor_a') and alcance = 'comunidade';
select t.como('lider_b');
select t.eq('B ve o post do instrutor', t.n(format($q$select count(*) from jsonb_array_elements(public.rede_feed('comunidade')->'itens') e where e->>'id' = %L$q$, t.id('post_instr'))), 1::bigint);
reset role;
update public.organization_memberships set status = 'suspenso' where user_id = t.id('instrutor_a') and organizational_unit_id = t.id('clube_a');
select t.como('lider_b');
select t.eq('autor saiu do clube: o post some do feed (G6)', t.n(format($q$select count(*) from jsonb_array_elements(public.rede_feed('comunidade')->'itens') e where e->>'id' = %L$q$, t.id('post_instr'))), 0::bigint);
select t.throws('...e nao abre mais', format($q$select public.comunidade_post(%L)$q$, t.id('post_instr')), 'não está disponível');
reset role;
update public.organization_memberships set status = 'ativo' where user_id = t.id('instrutor_a') and organizational_unit_id = t.id('clube_a');

-- =============================================================================
--  4. Menores: nada de crianca identificavel fora do proprio clube
-- =============================================================================
select t.como('lider_b');
select t.eq('crianca do A em comentario, visto do B: nome reduzido', t.txt(format($q$select e->'autor'->>'nome' from jsonb_array_elements(public.comunidade_comentarios(%L)->'itens') e where e->'autor'->>'id' = %L$q$, t.id('post_com_a'), t.id('membro_a'))), 'Membro A.');
select t.eq('...sem unidade', coalesce(t.txt(format($q$select e->'autor'->>'unidade' from jsonb_array_elements(public.comunidade_comentarios(%L)->'itens') e where e->'autor'->>'id' = %L$q$, t.id('post_com_a'), t.id('membro_a'))), 'nula'), 'nula');
select t.eq('...sem foto de rosto', coalesce(t.txt(format($q$select e->'autor'->>'foto' from jsonb_array_elements(public.comunidade_comentarios(%L)->'itens') e where e->'autor'->>'id' = %L$q$, t.id('post_com_a'), t.id('membro_a'))), 'nula'), 'nula');
select t.eq('...o adulto segue com nome + sobrenome', t.txt(format($q$select e->'autor'->>'nome' from jsonb_array_elements(public.comunidade_comentarios(%L)->'itens') e where e->'autor'->>'id' = %L limit 1$q$, t.id('post_com_a'), t.id('lider_a'))), 'Lider A');
select t.eq('crianca de outro clube NAO aparece na busca', t.n($q$select count(*) from jsonb_array_elements(public.rede_buscar('membro')->'pessoas') e where e->>'nome' like 'Membro A%'$q$), 0::bigint);
select t.eq('...nem na lista de pessoas do clube A', t.n(format($q$select count(*) from jsonb_array_elements(public.rede_buscar(null, %L)->'pessoas') e where e->>'nome' like 'Membro A%%'$q$, t.id('clube_a'))), 0::bigint);
select t.ok('...mas o adulto do clube A aparece na lista', t.n(format($q$select count(*) from jsonb_array_elements(public.rede_buscar(null, %L)->'pessoas') e where e->>'nome' = 'Lider A'$q$, t.id('clube_a'))) = 1);
select t.throws('perfil da crianca de outro clube: indisponivel', format($q$select public.rede_perfil(%L)$q$, t.id('membro_a')), 'não está disponível');
select t.throws('...e as publicacoes do perfil tambem', format($q$select public.rede_perfil_posts(%L)$q$, t.id('membro_a')), 'não está disponível');
select t.eq('perfil de ADULTO de outro clube abre', t.txt(format($q$select public.rede_perfil(%L)->>'nome'$q$, t.id('lider_a'))), 'Lider A');
select t.eq('...e conta so o que este leitor pode ver (alcance comunidade)', t.txt(format($q$select public.rede_perfil(%L)->>'publicacoes'$q$, t.id('lider_a'))),
  t.pub_count('lider_a', true));
select t.como('lider_a');
select t.eq('quem e do clube ve a crianca com nome completo e unidade', t.txt(format($q$select e->'autor'->>'nome' || '|' || coalesce(e->'autor'->>'unidade', 'nula') from jsonb_array_elements(public.comunidade_comentarios(%L)->'itens') e where e->'autor'->>'id' = %L$q$, t.id('post_com_a'), t.id('membro_a'))), 'Membro A|Teste A1');
select t.eq('...acha a crianca na busca', t.n($q$select count(*) from jsonb_array_elements(public.rede_buscar('membro a')->'pessoas') e where e->>'nome' = 'Membro A'$q$), 1::bigint);
select t.eq('...e abre o perfil dela', t.txt(format($q$select public.rede_perfil(%L)->>'nome'$q$, t.id('membro_a'))), 'Membro A');
select t.eq('...o proprio perfil conta tudo o que publicou', t.txt($q$select public.rede_perfil()->>'publicacoes'$q$), t.pub_count('lider_a', false));

-- =============================================================================
--  5. Admin da plataforma: so Comunidade denunciada/em analise, tudo no log
-- =============================================================================
select t.como('admin_122');
select t.eq('admin nao le o log direto (sem grant)', t.nv($q$select count(*) from public.plataforma_acesso_log$q$), 0::bigint);
select t.eq('admin NAO abre foto "clube" (Meu Clube) publicada', t.nv(format($q$select count(*) from storage.objects where bucket_id = 'comunidade' and name = %L$q$, t.cam('clube_a', 'lider_a', 'f2'))), 0::bigint);
select t.eq('admin ABRE foto da Comunidade EM ANALISE', t.n(format($q$select count(*) from storage.objects where bucket_id = 'comunidade' and name = %L$q$, t.cam('clube_a', 'lider_a', 'f1'))), 1::bigint);
reset role;
select t.eq('...e a leitura ficou registrada (quem, o que, item)', (select count(*) from public.plataforma_acesso_log
  where admin_user_id = t.id('admin_122') and o_que = 'foto' and item_tipo = 'post' and item_id = t.id('post_foto_com') and item_club_id = t.id('clube_a')), 1::bigint);
select t.throws('o log e append-only (update)', $q$update public.plataforma_acesso_log set o_que = 'x'$q$, 'não se altera');
select t.throws('o log e append-only (delete)', $q$delete from public.plataforma_acesso_log$q$, 'não se altera');
select t.throws('o log e append-only (truncate)', $q$truncate public.plataforma_acesso_log$q$, 'não se altera');
-- a diretoria aprova: sai de "em analise" e nao esta denunciada -> o admin perde o acesso
select t.como('lider_a');
select t.eq('diretoria aprova a foto da Comunidade', t.txt(format($q$select public.comunidade_moderar('post', %L, 'aprovar_foto')->>'status'$q$, t.id('post_foto_com'))), 'publicado');
select t.como('admin_122');
select t.eq('aprovada e sem denuncia: admin NAO abre mais', t.nv(format($q$select count(*) from storage.objects where bucket_id = 'comunidade' and name = %L$q$, t.cam('clube_a', 'lider_a', 'f1'))), 0::bigint);
-- denuncias: uma no alcance clube (o admin nao pode ver) e uma na Comunidade (pode)
select t.como('instrutor_a');
select t.eq('denuncia do post "clube" (A)', t.txt(format($q$select public.comunidade_denunciar('post', %L, 'outro')->>'ok'$q$, t.id('post_clube_a'))), 'true');
select t.como('lider_b');
select t.eq('denuncia da foto na Comunidade (B denuncia o A)', t.txt(format($q$select public.comunidade_denunciar('post', %L, 'imagem')->>'ok'$q$, t.id('post_foto_com'))), 'true');
select t.como('admin_122');
select t.eq('painel: a denuncia da Comunidade aparece', t.n(format($q$select count(*) from jsonb_array_elements(public.admin_comunidade_painel()->'fila'->'denuncias') e where e->>'id' = %L$q$, t.id('post_foto_com'))), 1::bigint);
select t.eq('painel: a denuncia do alcance clube NAO aparece', t.n(format($q$select count(*) from jsonb_array_elements(public.admin_comunidade_painel()->'fila'->'denuncias') e where e->>'id' = %L$q$, t.id('post_clube_a'))), 0::bigint);
select t.eq('denunciada na Comunidade: admin volta a abrir a foto', t.n(format($q$select count(*) from storage.objects where bucket_id = 'comunidade' and name = %L$q$, t.cam('clube_a', 'lider_a', 'f1'))), 1::bigint);
select t.throws('admin NAO modera conteudo do alcance clube (nem denunciado)', format($q$select public.admin_comunidade_moderar('post', %L, 'remover', 'teste')$q$, t.id('post_clube_a')), 'não encontrado');
select t.throws('...nem publicado e sem denuncia na Comunidade', format($q$select public.admin_comunidade_moderar('post', %L, 'remover', 'teste')$q$, t.id('post_com_a')), 'não encontrado');
select t.eq('admin modera o denunciado da Comunidade', t.txt(format($q$select public.admin_comunidade_moderar('post', %L, 'remover', 'teste')->>'status'$q$, t.id('post_foto_com'))), 'removido');
reset role;
select t.ok('painel registrado no log', (select count(*) from public.plataforma_acesso_log where admin_user_id = t.id('admin_122') and o_que = 'painel_comunidade') >= 1);
select t.eq('moderacao registrada no log', (select count(*) from public.plataforma_acesso_log where admin_user_id = t.id('admin_122') and o_que = 'moderar_remover' and item_id = t.id('post_foto_com')), 1::bigint);
select t.eq('a moderacao tambem segue na auditoria da plataforma', (select count(*) from public.platform_admin_audit where acao = 'comunidade_moderar' and alvo_id = t.id('post_foto_com')), 1::bigint);
select t.como('lider_a');
select t.throws('diretoria nao abre o painel da plataforma', $q$select public.admin_comunidade_painel()$q$, 'Sem permissão');
reset role;

-- =============================================================================
--  6. Conquista segura (D6)
-- =============================================================================
set local session_replication_role = replica;
insert into public.member_classes (usuario_id, club_id, class_id, status, concluida_em, investida_em)
select t.id('membro_a'), t.id('clube_a'), c.id, 'investida', now(), now() from (select id from public.classes where ativo order by ordem limit 1) c;
insert into public.member_classes (usuario_id, club_id, class_id, status)
select t.id('membro_a2'), t.id('clube_a'), c.id, 'em_andamento' from (select id from public.classes where ativo order by ordem limit 1) c;
insert into public.member_classes (usuario_id, club_id, class_id, status, concluida_em, investida_em)
select t.id('membro_b'), t.id('clube_b'), c.id, 'investida', now(), now() from (select id from public.classes where ativo order by ordem limit 1) c;
insert into public.member_specialties (usuario_id, club_id, specialty_id, status, concluida_em)
select t.id('membro_a2'), t.id('clube_a'), s.id, 'concluida', now() from (select id from public.specialties order by created_at limit 1) s;
set local session_replication_role = origin;
insert into t.ids (chave, id) select 'mc_ok', id from public.member_classes where usuario_id = t.id('membro_a') and club_id = t.id('clube_a');
insert into t.ids (chave, id) select 'mc_andamento', id from public.member_classes where usuario_id = t.id('membro_a2') and club_id = t.id('clube_a');
insert into t.ids (chave, id) select 'mc_b', id from public.member_classes where usuario_id = t.id('membro_b') and club_id = t.id('clube_b');
insert into t.ids (chave, id) select 'ms_ok', id from public.member_specialties where usuario_id = t.id('membro_a2') and club_id = t.id('clube_a');
select t.recuar(10);

select t.como('lider_a');
select t.throws('origem inexistente e rejeitada', format($q$select public.rede_publicar_conquista('classe', %L)$q$, gen_random_uuid()), 'Não encontramos');
select t.throws('classe ainda em andamento nao e conquista', format($q$select public.rede_publicar_conquista('classe', %L)$q$, t.id('mc_andamento')), 'Não encontramos');
select t.throws('registro de OUTRO clube e rejeitado', format($q$select public.rede_publicar_conquista('classe', %L)$q$, t.id('mc_b')), 'Não encontramos');
select t.throws('tipo de origem inventado', format($q$select public.rede_publicar_conquista('investidura', %L)$q$, t.id('mc_ok')), 'Origem da conquista inválida');
select t.throws('texto livre nao existe: alcance inventado', format($q$select public.rede_publicar_conquista('classe', %L, 'mundo')$q$, t.id('mc_ok')), 'Alcance inválido');
select t.como('lider_b');
select t.throws('diretoria de OUTRO clube nao publica conquista do A', format($q$select public.rede_publicar_conquista('classe', %L)$q$, t.id('mc_ok')), 'Não encontramos');
select t.como('membro_a');
select t.throws('o proprio desbravador nao publica a sua conquista', format($q$select public.rede_publicar_conquista('classe', %L)$q$, t.id('mc_ok')), 'Só a diretoria');
select t.como('conselheiro_a');
select t.throws('conselheiro nao publica conquista', format($q$select public.rede_publicar_conquista('classe', %L)$q$, t.id('mc_ok')), 'Só a diretoria');
select t.como('tesoureiro_a');
select t.throws('tesoureiro nao publica conquista', format($q$select public.rede_publicar_conquista('classe', %L)$q$, t.id('mc_ok')), 'Só a diretoria');
reset role;
select t.eq('nada foi publicado pelas tentativas', (select count(*) from public.comunidade_posts where tipo = 'conquista'), 0::bigint);

select t.como('lider_a');
select t.ok('classe real: publica (payload sem relatorio/evidencia/parecer/documento/pdf)',
  t.txt(format($q$select public.rede_publicar_conquista('classe', %L)::text$q$, t.id('mc_ok'))) !~* '(evidenc|relat[oó]rio|parecer|documento|pdf|anexo|foto_path)');
reset role;
select t.eq('...1 post de conquista, alcance clube (padrao), categoria classe, com a origem', (select count(*) from public.comunidade_posts
  where tipo = 'conquista' and alcance = 'clube' and conquista_categoria = 'classe' and conquista_origem_tipo = 'classe'
    and conquista_origem_id = t.id('mc_ok') and autor_id = t.id('lider_a') and status = 'publicado'), 1::bigint);
select t.ok('...texto montado pelo servidor: nome reduzido + classe + clube',
  (select legenda like 'Membro A. concluiu a classe % no clube Filhos da Conquista%' from public.comunidade_posts where conquista_origem_id = t.id('mc_ok')));
select t.como('lider_a');
select t.throws('a mesma conquista nao se publica duas vezes no mesmo alcance', format($q$select public.rede_publicar_conquista('classe', %L)$q$, t.id('mc_ok')), 'já foi publicada');
select t.como('membro_a2');
select t.throws('criança nao publica a propria conquista de especialidade', format($q$select public.rede_publicar_conquista('especialidade', %L)$q$, t.id('ms_ok')), 'Só a diretoria');
select t.como('instrutor_a');
select t.eq('instrutor publica conquista de especialidade NA COMUNIDADE', t.txt(format($q$select public.rede_publicar_conquista('especialidade', %L, 'comunidade')->>'ok'$q$, t.id('ms_ok'))), 'true');
reset role;
select t.ok('...nome reduzido (nunca sobrenome), especialidade e clube',
  (select legenda like 'Ana C. concluiu a especialidade % no clube Filhos da Conquista%' and legenda !~ '(Souza|Lima|Clara)'
     from public.comunidade_posts where conquista_origem_id = t.id('ms_ok')));
select t.eq('...alcance comunidade, categoria especialidade', (select alcance || '|' || conquista_categoria from public.comunidade_posts where conquista_origem_id = t.id('ms_ok')), 'comunidade|especialidade');
insert into t.ids (chave, id) select 'post_conq_esp', id from public.comunidade_posts where conquista_origem_id = t.id('ms_ok');
select t.como('lider_b');
select t.ok('outro clube ve a conquista da Comunidade com a crianca reduzida', t.txt(format($q$select e->>'legenda' from jsonb_array_elements(public.rede_feed('comunidade')->'itens') e where e->>'id' = %L$q$, t.id('post_conq_esp'))) ~ '^Ana C\. concluiu');
select t.eq('...e o JSON do post so tem as chaves esperadas (nada de relatorio/evidencia)', t.n(format($q$select count(*) from jsonb_array_elements(public.rede_feed('comunidade')->'itens') e, jsonb_object_keys(e) k
   where e->>'id' = %L and k not in ('id','tipo','alcance','legenda','foto','foto_expirada','foto_alt','desafio','conquista','status','autor','clube_id','crianca','meu','criado_em','curtidas','comentarios','eu_curti','eu_salvei','repost')$q$, t.id('post_conq_esp'))), 0::bigint);
select t.eq('...e a classe (alcance clube) segue invisivel para o B', t.n(format($q$select count(*) from jsonb_array_elements(public.rede_feed('todos', null, null, 20)->'itens') e where e->>'legenda' like 'Membro A. concluiu%%'$q$)), 0::bigint);
reset role;

-- =============================================================================
--  7. Backfill da migration (so roda quando a coluna ainda nao existe)
-- =============================================================================
create function t.un122(p_chave text, p_tipo text, p_nome text) returns void language plpgsql as $$
begin
  insert into public.organizational_units (id, type, nome, slug, parent_id, metadata)
  values (public.curriculo_uuid('t122:' || p_chave), p_tipo, p_nome, null, null, '{"test_only":true}');
  insert into t.ids (chave, id) values (p_chave, public.curriculo_uuid('t122:' || p_chave));
end $$;
select t.un122('d122', 'distrito', 'Distrito 122');
set local session_replication_role = replica;
insert into public.comunidade_posts (club_id, autor_id, autor_papel, legenda, status, tipo) values
  (t.id('clube_a'), t.id('lider_a'), 'diretoria', 'bf-diretoria', 'publicado', 'livre'),
  (t.id('clube_a'), t.id('instrutor_a'), 'instrutor', 'bf-instrutor', 'publicado', 'livre'),
  (t.id('clube_a'), t.id('membro_a'), 'desbravador', 'bf-desbravador', 'publicado', 'livre'),
  (t.id('clube_a'), t.id('conselheiro_a'), 'conselheiro', 'bf-conselheiro', 'publicado', 'livre'),
  (t.id('clube_a'), t.id('tesoureiro_a'), 'tesoureiro', 'bf-tesoureiro', 'publicado', 'livre'),
  (t.id('d122'), t.id('lider_a'), 'diretoria', 'bf-coordenacao', 'publicado', 'livre');
set local session_replication_role = origin;
-- volta ao estado "antes da 515": sem a coluna; a migration reaplicada refaz o backfill e e idempotente
alter table public.comunidade_posts drop column alcance cascade;
\ir ../cq_migrations/20260930000515_rede-alcance-meu-clube-e-comunidade.sql
select t.eq('backfill: diretoria de clube -> comunidade', (select alcance from public.comunidade_posts where legenda = 'bf-diretoria'), 'comunidade');
select t.eq('backfill: instrutor de clube -> comunidade', (select alcance from public.comunidade_posts where legenda = 'bf-instrutor'), 'comunidade');
select t.eq('backfill: desbravador -> clube', (select alcance from public.comunidade_posts where legenda = 'bf-desbravador'), 'clube');
select t.eq('backfill: conselheiro -> clube', (select alcance from public.comunidade_posts where legenda = 'bf-conselheiro'), 'clube');
select t.eq('backfill: tesoureiro -> clube', (select alcance from public.comunidade_posts where legenda = 'bf-tesoureiro'), 'clube');
select t.eq('backfill: unidade de coordenacao (sem capacidade de clube) -> clube', (select alcance from public.comunidade_posts where legenda = 'bf-coordenacao'), 'clube');
-- reaplicar de novo NAO mexe no que a diretoria publicou depois como 'clube' (idempotente)
update public.comunidade_posts set alcance = 'clube' where legenda = 'bf-diretoria';
\ir ../cq_migrations/20260930000515_rede-alcance-meu-clube-e-comunidade.sql
select t.eq('idempotente: reaplicar nao reclassifica', (select alcance from public.comunidade_posts where legenda = 'bf-diretoria'), 'clube');

select t.fim();
rollback;
