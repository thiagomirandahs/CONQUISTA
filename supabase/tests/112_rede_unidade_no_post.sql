-- REDE DBV (migration 502) — a UNIDADE do autor no post e no perfil ("Clube · Unidade · há X").
-- Prova: o nome da unidade do vínculo ATIVO no clube do conteúdo sai no autor do feed e em rede_perfil,
-- para o mesmo clube e para OUTRO clube; membro sem unidade → null; autor de coordenação → null;
-- vínculo suspenso/encerrado não vaza unidade; unidade de outro clube não é usada; só o NOME sai
-- (as chaves do JSON do autor são exatamente as da 500 + `unidade`); anon não executa nada;
-- grants e search_path continuam fechados.
begin;
\ir _lib.sql
\ir _fixtures.sql

\o /dev/null
select t.como_cron();
set local session_replication_role = replica;
update public.profiles set created_at = now() - interval '60 days'
 where id in (t.id('membro_a'), t.id('membro_a2'), t.id('membro_b'), t.id('lider_a'));
set local session_replication_role = origin;
select t.mk('admin_112', 'Admin Plataforma', 'diretoria', 'ativo', 'clube_b');
insert into public.platform_admins (user_id, papel) values (t.id('admin_112'), 'operacao');
-- membro com unidade que vai ser SUSPENSO depois de publicar
select t.mk('susp_112', 'Suspenso Cento Doze', 'desbravador', 'ativo', 'clube_a', 'A2', date '2013-02-02');
-- coordenação: distrito acima do clube A, com um coordenador sem clube
select t.signup('coord_112', '{"tipo":"fundador","nome":"Carla Mendes da Silva"}'::jsonb);
update public.profiles set created_at = now() - interval '60 days' where id = t.id('coord_112');
insert into public.organizational_units (id, type, nome, slug, parent_id, metadata)
values (public.curriculo_uuid('t112:d112'), 'distrito', 'Distrito 112', null, null, '{"test_only":true}');
insert into t.ids (chave, id) values ('d112', public.curriculo_uuid('t112:d112'));
update public.organizational_units set parent_id = t.id('d112') where id = t.id('clube_a');
insert into public.organization_memberships (user_id, organizational_unit_id, role, status)
values (t.id('coord_112'), t.id('d112'), 'coordenador_distrital', 'ativo');
create function t.autor_no_feed(p_chave text, p_campo text) returns text language plpgsql as $$
declare v text;
begin
  execute format($q$select e->'autor'->>%L from jsonb_array_elements(public.rede_feed('todos')->'itens') e
                    where e->'autor'->>'id' = %L limit 1$q$, p_campo, t.id(p_chave)::text) into v;
  return v;
exception when others then return 'ERRO: ' || sqlerrm;
end $$;
create function t.chaves_do_autor(p_chave text) returns text language plpgsql as $$
declare v text;
begin
  execute format($q$select string_agg(k, ',' order by k) from jsonb_array_elements(public.rede_feed('todos')->'itens') e,
                    jsonb_object_keys(e->'autor') k where e->'autor'->>'id' = %L$q$, t.id(p_chave)::text) into v;
  return v;
exception when others then return 'ERRO: ' || sqlerrm;
end $$;
grant usage on schema t to public;
reset role;
\o

-- =============================================================================
--  1. Estrutura: grants e search_path continuam como na 500
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
select t.throws('anon não chama _comunidade_autor_json', format($q$select public._comunidade_autor_json(%L, %L)$q$, t.id('membro_a'), t.id('clube_a')));
select t.throws('anon não abre perfil', $q$select public.rede_perfil()$q$);
select t.throws('anon não vê o feed', $q$select public.rede_feed('todos')$q$);
reset role;

-- =============================================================================
--  2. Rede ligada nos dois clubes; cada um publica
-- =============================================================================
select t.como('admin_112');
select public.admin_recurso_do_clube_definir(t.id('clube_a'), 'comunidade', true);
select public.admin_recurso_do_clube_definir(t.id('clube_b'), 'comunidade', true);
select t.como('membro_a');
select t.eq('membro com unidade (A1) publica', t.txt($q$select public.rede_publicar('livre', 'Olá da unidade A1!')->>'status'$q$), 'publicado');
select t.como('lider_a');
select t.eq('diretoria sem unidade publica', t.txt($q$select public.rede_publicar('livre', 'Olá da diretoria!')->>'status'$q$), 'publicado');
select t.como('susp_112');
select t.eq('membro que vai ser suspenso publica', t.txt($q$select public.rede_publicar('livre', 'Olá antes da suspensão!')->>'status'$q$), 'publicado');
select t.como('coord_112');
select t.eq('coordenação publica', t.txt($q$select public.rede_publicar('livre', 'Bom dia, clubes do distrito!')->>'status'$q$), 'publicado');
reset role;

-- =============================================================================
--  3. Mesmo clube vê a unidade; outro clube também; sem unidade e coordenação → null
-- =============================================================================
select t.como('membro_a2');
select t.eq('mesmo clube: unidade do autor no feed', t.autor_no_feed('membro_a', 'unidade'), 'Teste A1');
select t.eq('mesmo clube: diretoria sem unidade → null', coalesce(t.autor_no_feed('lider_a', 'unidade'), 'nula'), 'nula');
select t.eq('mesmo clube: rede_perfil traz a unidade', t.txt(format($q$select public.rede_perfil(%L)->>'unidade'$q$, t.id('membro_a'))), 'Teste A1');
select t.eq('meu perfil: minha unidade', t.txt($q$select public.rede_perfil()->>'unidade'$q$), 'Teste A2');

select t.como('membro_b');
select t.eq('OUTRO clube: unidade do autor no feed', t.autor_no_feed('membro_a', 'unidade'), 'Teste A1');
select t.eq('OUTRO clube: o clube continua', t.autor_no_feed('membro_a', 'clube'), 'Filhos da Conquista');
select t.eq('OUTRO clube: diretoria sem unidade → null', coalesce(t.autor_no_feed('lider_a', 'unidade'), 'nula'), 'nula');
select t.eq('OUTRO clube: autor de coordenação → unidade null', coalesce(t.autor_no_feed('coord_112', 'unidade'), 'nula'), 'nula');
select t.eq('...e o subtítulo da coordenação segue', t.autor_no_feed('coord_112', 'clube'), 'Coordenação · Distrito 112');
select t.eq('OUTRO clube: rede_perfil traz a unidade', t.txt(format($q$select public.rede_perfil(%L)->>'unidade'$q$, t.id('membro_a'))), 'Teste A1');
select t.eq('OUTRO clube: rede_perfil da diretoria sem unidade → null', t.txt(format($q$select coalesce(public.rede_perfil(%L)->>'unidade', 'nula')$q$, t.id('lider_a'))), 'nula');
select t.eq('OUTRO clube: rede_perfil da coordenação → null', t.txt(format($q$select coalesce(public.rede_perfil(%L)->>'unidade', 'nula')$q$, t.id('coord_112'))), 'nula');

-- só o NOME sai: as chaves do autor são exatamente as da 500 + unidade (nada de id/cor/conselheiro)
select t.eq('chaves do autor no feed: as da 500 + unidade, nada mais', t.chaves_do_autor('membro_a'), 'avatar,avatar_tipo,clube,coordenacao,foto,id,nome,unidade');
select t.eq('...também no autor de coordenação', t.chaves_do_autor('coord_112'), 'avatar,avatar_tipo,clube,coordenacao,foto,id,nome,unidade');
reset role;

-- =============================================================================
--  4. Vínculo suspenso/encerrado não vaza a unidade; unidade de OUTRO clube não conta
-- =============================================================================
select t.como('membro_b');
select t.eq('antes da suspensão: unidade vem', t.autor_no_feed('susp_112', 'unidade'), 'Teste A2');
reset role;
update public.organization_memberships set status = 'suspenso' where user_id = t.id('susp_112') and organizational_unit_id = t.id('clube_a');
select t.eq('vínculo SUSPENSO: _comunidade_autor_json devolve unidade null',
  coalesce(public._comunidade_autor_json(t.id('susp_112'), t.id('clube_a'))->>'unidade', 'nula'), 'nula');
update public.organization_memberships set status = 'encerrado', starts_at = now() - interval '2 days', ends_at = now() - interval '1 minute'
 where user_id = t.id('susp_112') and organizational_unit_id = t.id('clube_a');
select t.eq('vínculo ENCERRADO: unidade null', coalesce(public._comunidade_autor_json(t.id('susp_112'), t.id('clube_a'))->>'unidade', 'nula'), 'nula');
-- membro_a tem unidade A1 no clube A; perguntar pelo clube B não pode devolver A1
select t.eq('unidade do clube A não aparece quando o conteúdo é do clube B',
  coalesce(public._comunidade_autor_json(t.id('membro_a'), t.id('clube_b'))->>'unidade', 'nula'), 'nula');
-- unidade apontada de outro clube (dado inconsistente): não sai
set local session_replication_role = replica;
update public.organization_memberships set unidade_id = t.id('B1') where user_id = t.id('membro_a2') and organizational_unit_id = t.id('clube_a');
set local session_replication_role = origin;
select t.eq('unidade que pertence a OUTRO clube (inconsistência) não sai',
  coalesce(public._comunidade_autor_json(t.id('membro_a2'), t.id('clube_a'))->>'unidade', 'nula'), 'nula');
select t.eq('coordenação pela função direta: null', coalesce(public._comunidade_autor_json(t.id('coord_112'), t.id('d112'))->>'unidade', 'nula'), 'nula');

-- =============================================================================
--  5. Recurso desligado: tudo bloqueado (a unidade não abre porta nenhuma)
-- =============================================================================
select t.como('admin_112');
select public.admin_recurso_do_clube_definir(t.id('clube_b'), 'comunidade', false);
select t.como('membro_b');
select t.throws('desligado: rede_perfil bloqueado', format($q$select public.rede_perfil(%L)$q$, t.id('membro_a')), 'não está liberada');
select t.throws('desligado: feed bloqueado', $q$select public.rede_feed('todos')$q$, 'não está liberada');
reset role;

select t.fim();
rollback;
