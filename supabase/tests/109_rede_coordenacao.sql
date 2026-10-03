-- REDE DBV para a COORDENAÇÃO (migration 490).
-- Prova: coordenador SEM clube entra na rede pela unidade de coordenação (distrito), só se algum clube
-- da área tem o recurso ligado ("ainda não está liberada na sua área"); identidade "Nome Sobrenome" +
-- "Coordenação · <unidade>" + selo; foto do perfil sem autorização de imagem (adulto); publica post e
-- story direto (triagem e limites valem); comenta em post de criança SÓ se o clube dela está na sua
-- área (coordenador de outro distrito não comenta); "Minha área" = subárvore; denúncia de conteúdo de
-- coordenação vai para a fila do ADMIN da plataforma (nunca para a diretoria de um clube); o contexto
-- é o clube quando há clube com a rede e o app não pediu coordenação; anon sem nada.
begin;
\ir _lib.sql
\ir _fixtures.sql

\o /dev/null
select t.como_cron();
set local session_replication_role = replica;
update public.profiles set created_at = now() - interval '60 days'
 where id in (t.id('membro_a'), t.id('membro_b'), t.id('lider_a'), t.id('lider_b'));
set local session_replication_role = origin;
select t.signup('c109_dist', '{"tipo":"fundador","nome":"Carla Mendes da Silva"}'::jsonb);
select t.signup('c109_outro', '{"tipo":"fundador","nome":"Otavio Rocha"}'::jsonb);
update public.profiles set created_at = now() - interval '60 days', foto = 'https://x.test/storage/v1/object/imagens/perfis/foto-carla.webp'
 where id = t.id('c109_dist');
update public.profiles set created_at = now() - interval '60 days' where id = t.id('c109_outro');
select t.mk('admin_109', 'Admin Plataforma', 'diretoria', 'ativo', 'clube_b');
insert into public.platform_admins (user_id, papel) values (t.id('admin_109'), 'operacao');
create function t.un109(p_chave text, p_tipo text, p_nome text, p_pai text) returns void language plpgsql as $$
begin
  insert into public.organizational_units (id, type, nome, slug, parent_id, metadata)
  values (public.curriculo_uuid('t109:' || p_chave), p_tipo, p_nome, null,
          case when p_pai is not null then t.id(p_pai) end, '{"test_only":true}');
  insert into t.ids (chave, id) values (p_chave, public.curriculo_uuid('t109:' || p_chave));
end $$;
select t.un109('campo109', 'campo', 'Associação 109', null);
select t.un109('r109', 'regiao', 'Região 109', 'campo109');
select t.un109('d109', 'distrito', 'Distrito Norte', 'r109');
select t.un109('d109b', 'distrito', 'Distrito Sul', 'r109');
update public.organizational_units set parent_id = t.id('d109') where id = t.id('clube_a');
update public.organizational_units set parent_id = t.id('d109b') where id = t.id('clube_b');
insert into public.organization_memberships (user_id, organizational_unit_id, role, status)
values (t.id('c109_dist'), t.id('d109'), 'coordenador_distrital', 'ativo'),
       (t.id('c109_outro'), t.id('d109b'), 'coordenador_distrital', 'ativo');
create function t.hdr(p jsonb) returns void language plpgsql as $$
begin perform set_config('request.headers', p::text, true); end $$;
create function t.recuar(p_min int) returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.comunidade_posts set created_at = created_at - make_interval(mins => p_min);
  update public.comunidade_comentarios set created_at = created_at - make_interval(mins => p_min);
  update public.rede_stories set created_at = created_at - make_interval(mins => p_min);
end $$;
insert into t.ids values ('st109', gen_random_uuid());
create table t.cam as select
  t.id('d109')::text || '/' || t.id('c109_dist')::text || '/' || t.id('st109')::text || '.webp' as st,
  t.id('clube_a')::text || '/' || t.id('c109_dist')::text || '/' || t.id('st109')::text || '.webp' as st_clube;
grant usage on schema t to public;
grant select on t.cam to public;
grant insert, select on t.ids to public;
reset role;
\o

-- =============================================================================
--  1. anon e estrutura
-- =============================================================================
select t.como_anon();
select t.throws('anon não vê o status', $q$select public.comunidade_meu_status()$q$);
select t.throws('anon não vê o feed', $q$select public.rede_feed('todos')$q$);
select t.throws('anon não publica', $q$select public.rede_publicar('livre', 'oi')$q$);
reset role;
select t.eq('helpers novos sem EXECUTE para authenticated',
  (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace
      and p.proname in ('_rede_unidade_ligada', '_rede_unidades_da_area', '_rede_contexto', '_rede_coordenacao_na_rede')
      and not has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute')
      and p.prosecdef and array_to_string(p.proconfig, ',') like '%search_path=""%'), 4::bigint);

-- =============================================================================
--  2. Sem clube liberado na área: bloqueado
-- =============================================================================
select t.como('c109_dist');
select t.eq('coordenador sem clube: status explica "área sem rede"', t.txt($q$select public.comunidade_meu_status()->>'motivo'$q$), 'area_sem_rede');
select t.eq('...e diz que é coordenação', t.txt($q$select public.comunidade_meu_status()->>'modo'$q$), 'coordenacao');
select t.throws('feed bloqueado', $q$select public.rede_feed('todos')$q$, 'ainda não está liberada na sua área');
select t.throws('publicar bloqueado', $q$select public.rede_publicar('livre', 'Bom dia')$q$, 'ainda não está liberada na sua área');

select t.como('admin_109');
select public.admin_recurso_do_clube_definir(t.id('clube_a'), 'comunidade', true);
select t.como('pais_a');
select public.comunidade_autorizar(t.id('membro_a'), true);
reset role;

-- =============================================================================
--  3. Coordenador sem clube entra (área com clube ligado) — identidade
-- =============================================================================
select t.como('c109_dist');
select t.eq('entra: pode ver', t.txt($q$select public.comunidade_meu_status()->>'pode_ver'$q$), 'true');
select t.eq('...pode publicar', t.txt($q$select public.comunidade_meu_status()->>'pode_publicar'$q$), 'true');
select t.eq('...na unidade de coordenação', t.txt($q$select public.comunidade_meu_status()->>'unidade'$q$), 'Distrito Norte');
select t.eq('...com o papel de coordenação', t.txt($q$select public.comunidade_meu_status()->>'papel'$q$), 'coordenador_distrital');
select t.eq('publica texto direto', t.txt($q$select public.rede_publicar('livre', 'Bom dia, clubes do distrito!')->>'status'$q$), 'publicado');
select t.eq('a triagem continua valendo', t.txt($q$select public.rede_publicar('livre', 'me chama no zap 81999998888')->>'motivo'$q$), 'contato');
reset role;
insert into t.ids (chave, id) select 'post_coord', id from public.comunidade_posts where autor_id = t.id('c109_dist') and status = 'publicado';
select t.eq('o post fica na unidade de coordenação', (select club_id from public.comunidade_posts where id = t.id('post_coord')), t.id('d109'));
select t.recuar(5);

select t.como('membro_a');
-- 515 (AJUSTE DE REGRA, D1): o post da coordenação nasce 'clube' (alcance da unidade dela); a criança do clube da área o lê em "Meu clube"
-- (clube + coordenação acima), não no feed da Comunidade.
select t.eq('criança do clube vê o post: nome + sobrenome',
  t.txt($q$select e->'autor'->>'nome' from jsonb_array_elements(public.rede_feed('meu_clube')->'itens') e where e->>'id' = (select id::text from t.ids where chave = 'post_coord')$q$), 'Carla Mendes');
select t.eq('...subtítulo "Coordenação · <unidade>"',
  t.txt($q$select e->'autor'->>'clube' from jsonb_array_elements(public.rede_feed('meu_clube')->'itens') e where e->>'id' = (select id::text from t.ids where chave = 'post_coord')$q$), 'Coordenação · Distrito Norte');
select t.eq('...selo de coordenação',
  t.txt($q$select e->'autor'->>'coordenacao' from jsonb_array_elements(public.rede_feed('meu_clube')->'itens') e where e->>'id' = (select id::text from t.ids where chave = 'post_coord')$q$), 'true');
select t.ok('...foto do perfil (adulto, sem autorização de imagem)',
  t.txt($q$select e->'autor'->>'foto' from jsonb_array_elements(public.rede_feed('meu_clube')->'itens') e where e->>'id' = (select id::text from t.ids where chave = 'post_coord')$q$) like '%foto-carla%');
select t.eq('criança publica', t.txt($q$select public.rede_publicar('livre', 'Hoje teve acampamento!')->>'status'$q$), 'publicado');
reset role;
insert into t.ids (chave, id) select 'post_crianca', id from public.comunidade_posts where autor_id = t.id('membro_a') and status = 'publicado';
select t.eq('criança de clube continua sem foto de rosto sem autorização', (public._comunidade_autor_json(t.id('membro_a'), t.id('clube_a')) ->> 'foto') is null, true);
select t.eq('...e sem selo', public._comunidade_autor_json(t.id('membro_a'), t.id('clube_a')) ->> 'coordenacao', 'false');
select t.recuar(5);

-- =============================================================================
--  4. Coordenação: curtir, salvar, comentar (criança no escopo), perfil, busca, story
-- =============================================================================
select t.como('c109_dist');
select t.eq('o feed Todos (= Comunidade) NÃO traz o post da criança (alcance clube)', t.n($q$select count(*) from jsonb_array_elements(public.rede_feed('todos')->'itens') e where e->>'id' = (select id::text from t.ids where chave = 'post_crianca')$q$), 0::bigint);
select t.eq('"Minha área" traz o post do clube da área', t.n($q$select count(*) from jsonb_array_elements(public.rede_feed('meu_clube')->'itens') e where e->>'id' = (select id::text from t.ids where chave = 'post_crianca')$q$), 1::bigint);
select t.eq('...e o meu', t.n($q$select count(*) from jsonb_array_elements(public.rede_feed('meu_clube')->'itens') e where e->>'id' = (select id::text from t.ids where chave = 'post_coord')$q$), 1::bigint);
select t.eq('curte', t.txt($q$select public.comunidade_curtir((select id from t.ids where chave = 'post_crianca'), true)->>'eu_curti'$q$), 'true');
select t.eq('salva', t.txt($q$select public.rede_salvar((select id from t.ids where chave = 'post_crianca'), true)->>'ok'$q$), 'true');
select t.eq('COMENTA em post de criança de clube DA SUA ÁREA', t.txt($q$select public.comunidade_comentar((select id from t.ids where chave = 'post_crianca'), 'Parabéns, turma!')->>'ok'$q$), 'true');
select t.eq('meu perfil: subtítulo de coordenação', t.txt($q$select public.rede_perfil()->>'clube'$q$), 'Coordenação · Distrito Norte');
select t.eq('...com o selo', t.txt($q$select public.rede_perfil()->>'coordenacao'$q$), 'true');
select t.eq('participa dos desafios (lista abre)', t.txt($q$select (public.rede_desafios() ? 'outros')::text$q$), 'true');
select t.permitido('sobe a foto do story no caminho da unidade de coordenação',
  $q$insert into storage.objects (bucket_id, name, owner, metadata) select 'comunidade', st, auth.uid(), '{"size": 90000}' from t.cam$q$);
select t.bloqueado('...mas não no caminho de um clube', $q$insert into storage.objects (bucket_id, name, owner) select 'comunidade', st_clube, auth.uid() from t.cam$q$);
select t.eq('publica story direto', t.txt($q$select public.rede_story_publicar((select st from t.cam), 'Visita de hoje')->>'status'$q$), 'publicado');
select t.como('membro_a');
select t.eq('criança acha a coordenação na busca', t.txt($q$select e->>'clube' from jsonb_array_elements(public.rede_buscar('carla')->'pessoas') e$q$), 'Coordenação · Distrito Norte');
select t.eq('...e abre o perfil', t.txt($q$select public.rede_perfil((select id from t.ids where chave = 'c109_dist'))->>'clube'$q$), 'Coordenação · Distrito Norte');
select t.eq('...e vê o story da coordenação', t.n($q$select count(*) from jsonb_array_elements(public.rede_stories()) e where e->'autor'->>'coordenacao' = 'true'$q$), 1::bigint);
select t.eq('...e abre o arquivo dele', t.n($q$select count(*) from storage.objects where bucket_id = 'comunidade' and name = (select st from t.cam)$q$), 1::bigint);
reset role;
select t.recuar(5);

-- =============================================================================
--  5. Coordenador de OUTRO distrito
-- =============================================================================
select t.como('c109_outro');
select t.throws('distrito sem clube ligado: bloqueado', $q$select public.rede_feed('todos')$q$, 'ainda não está liberada na sua área');
select t.como('admin_109');
select public.admin_recurso_do_clube_definir(t.id('clube_b'), 'comunidade', true);
select t.como('c109_outro');
select t.eq('com o clube B ligado, entra', t.txt($q$select public.comunidade_meu_status()->>'unidade'$q$), 'Distrito Sul');
-- 515: alcance 'clube' não cruza distritos (nem para a coordenação de outro distrito)
select t.throws('distrito vizinho NÃO vê o post da criança (alcance clube)', $q$select public.comunidade_curtir((select id from t.ids where chave = 'post_crianca'), true)$q$, 'não está disponível');
select t.throws('...nem o post da coordenação do outro distrito', $q$select public.comunidade_comentar((select id from t.ids where chave = 'post_coord'), 'Oi')$q$, 'não está disponível');
reset role;
-- FIXTURE: os dois posts "chegam" à Comunidade (pelas RPCs só diretoria/instrutor publica lá; ver teste 122), para seguir provando as
-- regras de comentar/curtir entre áreas (a coordenação só comenta em criança da sua área; adulto de outro clube não comenta).
update public.comunidade_posts set alcance = 'comunidade' where id in (t.id('post_crianca'), t.id('post_coord'));
select t.como('c109_outro');
-- 541: coordenação também comenta na Comunidade; alcance privado continua respeitado.
select t.eq('541: coordenação comenta em post público de outra área', t.txt($q$select public.comunidade_comentar((select id from t.ids where chave = 'post_crianca'), 'Muito bem!')->>'ok'$q$), 'true');
select t.eq('...mas curte', t.txt($q$select public.comunidade_curtir((select id from t.ids where chave = 'post_crianca'), true)->>'eu_curti'$q$), 'true');
select t.eq('541: coordenação comenta em post de adulto da Comunidade', t.txt($q$select public.comunidade_comentar((select id from t.ids where chave = 'post_coord'), 'Bom dia!')->>'ok'$q$), 'true');
select t.eq('"Minha área" não traz clube de outro distrito', t.n($q$select count(*) from jsonb_array_elements(public.rede_feed('meu_clube')->'itens') e where e->>'id' = (select id::text from t.ids where chave = 'post_crianca')$q$), 0::bigint);
select t.como('lider_b');
select t.eq('541: adulto de outro clube comenta em post público de criança', t.txt($q$select public.comunidade_comentar((select id from t.ids where chave = 'post_crianca'), 'Legal!')->>'ok'$q$), 'true');
reset role;

-- =============================================================================
--  6. Denúncia de conteúdo de coordenação: fila do ADMIN da plataforma
-- =============================================================================
select t.como('membro_a');
select t.ok('denunciar: a equipe da plataforma revisa',
  t.txt($q$select public.comunidade_denunciar('post', (select id from t.ids where chave = 'post_coord'), 'ofensivo')->>'mensagem'$q$) like '%equipe da plataforma%');
reset role;
select t.eq('a denúncia fica na unidade de coordenação', (select club_id from public.comunidade_denuncias where alvo_id = t.id('post_coord')), t.id('d109'));
select t.eq('nenhum aviso para a diretoria do clube', (select count(*) from public.notificacoes where para_usuario = t.id('lider_a') and titulo like '%denunciado%'), 0::bigint);
select t.como('lider_a');
select t.pedir_clube('clube_a');
select t.eq('a fila da diretoria do clube NÃO mostra', t.n($q$select count(*) from jsonb_array_elements(public.comunidade_fila_moderacao()->'denuncias') e where e->>'id' = (select id::text from t.ids where chave = 'post_coord')$q$), 0::bigint);
select t.throws('...nem a diretoria modera', $q$select public.comunidade_moderar('post', (select id from t.ids where chave = 'post_coord'), 'remover')$q$, 'não encontrado');
select t.como('admin_109');
select t.eq('a fila do ADMIN mostra', t.n($q$select count(*) from jsonb_array_elements(public.admin_comunidade_painel()->'fila'->'denuncias') e where e->>'id' = (select id::text from t.ids where chave = 'post_coord')$q$), 1::bigint);
select t.eq('...e o admin remove', t.txt($q$select public.admin_comunidade_moderar('post', (select id from t.ids where chave = 'post_coord'), 'remover', 'teste')->>'status'$q$), 'removido');
reset role;
select t.eq('remoção conta aviso para o coordenador (três avisos valem)', (select count(*) from public.comunidade_avisos where usuario_id = t.id('c109_dist')), 2::bigint);

-- =============================================================================
--  7. Contexto: clube com a rede ganha, a menos que o app peça coordenação
-- =============================================================================
insert into public.organization_memberships (user_id, organizational_unit_id, role, status)
values (t.id('c109_dist'), t.id('clube_a'), 'instrutor', 'ativo');
select t.como('c109_dist');
select t.eq('com clube (rede ligada) e sem pedido: entra como membro do clube', t.txt($q$select public.comunidade_meu_status()->>'modo'$q$), 'clube');
select t.hdr(jsonb_build_object('x-rede-como', 'coordenacao', 'x-escopo-atual', t.id('d109')));
select t.eq('pelo portal (x-rede-como): entra como coordenação', t.txt($q$select public.comunidade_meu_status()->>'modo'$q$), 'coordenacao');
select t.hdr(jsonb_build_object('x-rede-como', 'coordenacao', 'x-escopo-atual', t.id('d109b')));
select t.eq('escopo forjado (sem vínculo) não vale: cai no próprio vínculo', t.txt($q$select public.comunidade_meu_status()->>'unidade'$q$), 'Distrito Norte');
select t.como('lider_a');
select t.hdr(jsonb_build_object('x-rede-como', 'coordenacao'));
select t.eq('quem não coordena e pede coordenação continua no clube', t.txt($q$select public.comunidade_meu_status()->>'modo'$q$), 'clube');
reset role;

select t.fim();
rollback;
