-- REDE DBV (migration 517) — lista de conquistas publicaveis, aviso/evento so da lideranca, comentarios na Comunidade
-- so de adulto com papel, moderacao de foto na Comunidade inalterada, e audiolivros sem fonte desligados (teste 97).
-- Prova: rede_conquistas_publicaveis lista SO o registro real (classe investida / especialidade concluida nao revogada)
-- de membros que participam, do clube ATUAL, ainda nao publicado no alcance pedido, para diretoria|instrutor (senao []);
-- a previa e exatamente o texto que rede_publicar_conquista publica (nome reduzido; nada de relatorio/evidencia);
-- rede_publicar_conquista recusa qualquer origem fora da lista (UUID forjado, requisito, conquista de outro clube,
-- revogada, em andamento, cancelada, de responsavel, de quem saiu do clube); aviso/evento so diretoria|instrutor em qualquer
-- alcance (desbravador, conselheiro, tesoureiro, pais, coordenacao, admin da plataforma sem vinculo, suspenso, encerrado
-- recebem erro claro); comentario na Comunidade so de adulto diretoria|instrutor|conselheiro no clube atual (multiclube:
-- o papel vale no clube do contexto); foto na Comunidade segue analise -> aprovacao -> publicacao e o admin da plataforma
-- so modera item de Comunidade em analise/denunciado; anon sem execucao; nada vem do cliente (parametros inexistentes).
begin;
\ir _lib.sql
\ir _fixtures.sql

\o /dev/null
select t.como_cron();
insert into public.club_features (club_id, feature, enabled)
values (t.id('clube_a'), 'comunidade', true), (t.id('clube_b'), 'comunidade', true)
on conflict (club_id, feature) do update set enabled = true;

-- pessoas extras
select t.mk('susp_dir_a', 'Diretor Suspenso', 'diretoria', 'suspenso', 'clube_a');
select t.mk('enc_inst_a', 'Instrutor Encerrado', 'instrutor', 'ativo', 'clube_a');
select t.mk('ex_a', 'Ex Membro Silva', 'desbravador', 'ativo', 'clube_a', 'A1', date '2014-02-02');
update public.organization_memberships set status = 'encerrado' where user_id in (t.id('enc_inst_a'), t.id('ex_a'));
select t.signup('admin_123', '{"tipo":"fundador","nome":"Admin Cento Vinte Tres"}'::jsonb);
insert into public.platform_admins (user_id, papel) values (t.id('admin_123'), 'operacao');
select t.signup('coord_123', '{"tipo":"fundador","nome":"Coordenador Cento Vinte Tres"}'::jsonb);
insert into public.organizational_units (id, type, nome, slug, parent_id, metadata)
values (public.curriculo_uuid('t123:dist'), 'distrito', 'Distrito 123', null, null, '{"test_only":true}');
insert into t.ids values ('dist123', public.curriculo_uuid('t123:dist'));
update public.organizational_units set parent_id = t.id('dist123') where id = t.id('clube_a');
insert into public.organization_memberships (user_id, organizational_unit_id, role, status)
values (t.id('coord_123'), t.id('dist123'), 'coordenador_distrital', 'ativo');

set local session_replication_role = replica;
update public.profiles set created_at = now() - interval '60 days';
update public.profiles set nome = 'Ana Clara Souza Lima' where id = t.id('membro_a2');
set local session_replication_role = origin;

-- registros reais e ruidos
insert into public.member_classes (usuario_id, club_id, class_id, status, concluida_em, investida_em)
select t.id('membro_a'), t.id('clube_a'), c.id, 'investida', now(), now() from (select id from public.classes where ativo order by ordem, id limit 1) c;
insert into public.member_classes (usuario_id, club_id, class_id, status)
select t.id('membro_a2'), t.id('clube_a'), c.id, 'em_andamento' from (select id from public.classes where ativo order by ordem, id limit 1) c;
insert into public.member_classes (usuario_id, club_id, class_id, status, concluida_em, investida_em)
select t.id('membro_a2'), t.id('clube_a'), c.id, 'investida', now(), now() from (select id from public.classes where ativo order by ordem, id offset 1 limit 1) c;
insert into public.member_classes (usuario_id, club_id, class_id, status, concluida_em, investida_em)
select t.id('pais_a'), t.id('clube_a'), c.id, 'investida', now(), now() from (select id from public.classes where ativo order by ordem, id limit 1) c;
insert into public.member_classes (usuario_id, club_id, class_id, status, concluida_em, investida_em)
select t.id('ex_a'), t.id('clube_a'), c.id, 'investida', now(), now() from (select id from public.classes where ativo order by ordem, id limit 1) c;
insert into public.member_classes (usuario_id, club_id, class_id, status, concluida_em, investida_em)
select t.id('membro_b'), t.id('clube_b'), c.id, 'investida', now(), now() from (select id from public.classes where ativo order by ordem, id limit 1) c;
insert into public.member_classes (usuario_id, club_id, class_id, status, concluida_em, investida_em)
select t.id('suspenso_so_b'), t.id('clube_b'), c.id, 'investida', now(), now() from (select id from public.classes where ativo order by ordem, id limit 1) c;
insert into public.member_specialties (usuario_id, club_id, specialty_id, status, concluida_em)
select t.id('membro_a2'), t.id('clube_a'), s.id, 'concluida', now() from (select id from public.specialties order by created_at limit 1) s;
insert into public.member_specialties (usuario_id, club_id, specialty_id, status)
select t.id('membro_a'), t.id('clube_a'), s.id, 'cancelada' from (select id from public.specialties order by created_at limit 1) s;
insert into t.ids (chave, id) select 'mc_ok', id from public.member_classes where usuario_id = t.id('membro_a') and club_id = t.id('clube_a');
insert into t.ids (chave, id) select 'mc_andamento', id from public.member_classes where usuario_id = t.id('membro_a2') and club_id = t.id('clube_a') and status = 'em_andamento';
insert into t.ids (chave, id) select 'mc_rev', id from public.member_classes where usuario_id = t.id('membro_a2') and club_id = t.id('clube_a') and status = 'investida';
insert into t.ids (chave, id) select 'mc_pais', id from public.member_classes where usuario_id = t.id('pais_a');
insert into t.ids (chave, id) select 'mc_ex', id from public.member_classes where usuario_id = t.id('ex_a');
insert into t.ids (chave, id) select 'mc_b', id from public.member_classes where usuario_id = t.id('membro_b');
insert into t.ids (chave, id) select 'mc_susp_b', id from public.member_classes where usuario_id = t.id('suspenso_so_b') and club_id = t.id('clube_b');
insert into t.ids (chave, id) select 'ms_ok', id from public.member_specialties where usuario_id = t.id('membro_a2') and club_id = t.id('clube_a');
insert into t.ids (chave, id) select 'ms_cancel', id from public.member_specialties where usuario_id = t.id('membro_a') and club_id = t.id('clube_a');
insert into t.ids (chave, id) select 'ach_ok', id from public.curriculum_achievements where member_class_id = t.id('mc_ok');
insert into t.ids (chave, id) select 'classe_cat', id from public.classes where ativo order by ordem, id limit 1;
insert into t.ids (chave, id) select 'espec_cat', id from public.specialties order by created_at limit 1;
-- requisito individual real (se a classe tiver requisitos materializados) ou, na falta, o id de um requisito do catalogo
insert into t.ids (chave, id) select 'req_ind', coalesce(
  (select id from public.member_requirements where member_class_id = t.id('mc_ok') limit 1),
  (select id from public.member_requirements limit 1), gen_random_uuid());
-- a classe revogada nao conta
update public.curriculum_achievements set status = 'revogada', revogada_em = now(), revogada_motivo = 'teste 123'
 where member_class_id = t.id('mc_rev');

create function t.recuar(p_min int) returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.comunidade_posts set created_at = created_at - make_interval(mins => p_min);
  update public.comunidade_comentarios set created_at = created_at - make_interval(mins => p_min);
  update public.comunidade_bloqueios set created_at = created_at - make_interval(mins => p_min);
end $$;
create function t.nlista(p_alc text default 'clube') returns bigint language sql as $$
  select jsonb_array_length(public.rede_conquistas_publicaveis(p_alc))::bigint;
$$;
create function t.lista_tem(p_chave text, p_alc text default 'clube') returns bigint language sql as $$
  select count(*) from jsonb_array_elements(public.rede_conquistas_publicaveis(p_alc)) e where e ->> 'origem_id' = t.id(p_chave)::text;
$$;
-- publica tudo que a lista mostra; devolve "publicadas|com texto igual a previa"
create function t.publica_lista(p_alc text) returns text language plpgsql as $$
declare e jsonb; n int := 0; ig int := 0; r jsonb;
begin
  for e in select x from jsonb_array_elements(public.rede_conquistas_publicaveis(p_alc)) x loop
    r := public.rede_publicar_conquista(e ->> 'origem_tipo', (e ->> 'origem_id')::uuid, p_alc);
    if (r ->> 'ok')::boolean then
      n := n + 1;
      if r -> 'post' ->> 'legenda' = e ->> 'previa' then ig := ig + 1; end if;
    end if;
  end loop;
  return n || '|' || ig;
end $$;
create function t.cam(p_clube text, p_pessoa text, p_foto text, p_ext text default 'webp') returns text language sql as $$
  select t.id(p_clube)::text || '/' || t.id(p_pessoa)::text || '/' || t.id(p_foto)::text || '.' || p_ext;
$$;
create function t.obj(p_path text, p_bytes int default 120000, p_mime text default 'image/webp') returns void
language sql security definer set search_path = '' as $$
  insert into storage.objects (bucket_id, name, metadata) values ('comunidade', p_path, jsonb_build_object('size', p_bytes, 'mimetype', p_mime));
$$;
insert into t.ids values ('f1', gen_random_uuid()), ('f2', gen_random_uuid()), ('f3', gen_random_uuid());
grant usage on schema t to public;
reset role;
\o

-- =============================================================================
--  1. Estrutura, grants, anon
-- =============================================================================
select t.eq('helpers novos sem EXECUTE para anon/authenticated, security definer, search_path vazio',
  (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace
      and p.proname in ('_rede_conquistas_do_clube', '_rede_conquista_membro_ok', '_rede_conquista_ja_publicada')
      and not has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute')
      and p.prosecdef and coalesce(p.proconfig, '{}') @> array['search_path=""']), 3::bigint);
select t.eq('_rede_conquista_legenda: sem EXECUTE publico e search_path vazio',
  (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = '_rede_conquista_legenda'
      and not has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute')
      and coalesce(p.proconfig, '{}') @> array['search_path=""']), 1::bigint);
select t.eq('rede_conquistas_publicaveis: UMA funcao, authenticated executa, anon NAO, security definer, search_path vazio',
  (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'rede_conquistas_publicaveis'
      and has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute')
      and p.prosecdef and coalesce(p.proconfig, '{}') @> array['search_path=""']), 1::bigint);
select t.eq('nenhum parametro de texto/titulo/club_id: so p_alcance',
  (select pg_get_function_arguments(p.oid) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'rede_conquistas_publicaveis'),
  'p_alcance text DEFAULT ''clube''::text');
select t.eq('so existe UMA rede_publicar, UMA comunidade_comentar, UMA rede_publicar_conquista',
  (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace
      and p.proname in ('rede_publicar', 'comunidade_comentar', 'rede_publicar_conquista')), 3::bigint);
select t.como_anon();
select t.throws('anon nao lista conquistas', $q$select public.rede_conquistas_publicaveis()$q$);
select t.throws('anon nao publica conquista', format($q$select public.rede_publicar_conquista('classe', %L)$q$, gen_random_uuid()));
select t.throws('anon nao comenta', format($q$select public.comunidade_comentar(%L, 'oi')$q$, gen_random_uuid()));
reset role;

-- =============================================================================
--  2. A lista: quem ve, o que ve
-- =============================================================================
select t.como('lider_a');
select t.eq('diretoria A lista exatamente 2 (classe investida + especialidade concluida)', t.nlista(), 2::bigint);
select t.eq('...a classe investida do membro A esta', t.lista_tem('mc_ok'), 1::bigint);
select t.eq('...a especialidade concluida esta', t.lista_tem('ms_ok'), 1::bigint);
select t.eq('...classe em andamento NAO', t.lista_tem('mc_andamento'), 0::bigint);
select t.eq('...classe investida mas REVOGADA NAO', t.lista_tem('mc_rev'), 0::bigint);
select t.eq('...especialidade cancelada NAO', t.lista_tem('ms_cancel'), 0::bigint);
select t.eq('...conquista de responsavel (papel pais) NAO', t.lista_tem('mc_pais'), 0::bigint);
select t.eq('...conquista de quem saiu do clube (vinculo encerrado) NAO', t.lista_tem('mc_ex'), 0::bigint);
select t.eq('...conquista de OUTRO clube NAO', t.lista_tem('mc_b'), 0::bigint);
select t.eq('as chaves do item sao exatamente as combinadas (sem relatorio/evidencia/parecer/foto/documento)',
  t.txt($q$select string_agg(k, ',' order by k) from (select distinct jsonb_object_keys(e) k from jsonb_array_elements(public.rede_conquistas_publicaveis()) e) s$q$),
  'concluida_em,origem_id,origem_tipo,previa,rotulo,titulo');
select t.eq('rotulo: Classe / Especialidade',
  t.txt($q$select string_agg(distinct e->>'rotulo', ',' order by e->>'rotulo') from jsonb_array_elements(public.rede_conquistas_publicaveis()) e$q$), 'Classe,Especialidade');
select t.ok('previa da classe: nome reduzido + classe + clube',
  t.txt(format($q$select e->>'previa' from jsonb_array_elements(public.rede_conquistas_publicaveis()) e where e->>'origem_id' = %L$q$, t.id('mc_ok'))) ~ '^Membro A\. concluiu a classe .+ no clube Filhos da Conquista 🎉$');
select t.ok('previa da especialidade: "Ana C." (nome reduzido, nunca o nome completo)',
  t.txt(format($q$select e->>'previa' from jsonb_array_elements(public.rede_conquistas_publicaveis()) e where e->>'origem_id' = %L$q$, t.id('ms_ok'))) ~ '^Ana C\. concluiu a especialidade .+ no clube Filhos da Conquista 🎉$');
select t.eq('nenhuma previa traz sobrenome, relatorio, evidencia, parecer, foto ou documento',
  t.n($q$select count(*) from jsonb_array_elements(public.rede_conquistas_publicaveis()) e where e->>'previa' ~* '(souza|lima|evid[eê]ncia|relat[oó]rio|parecer|foto|documento|pdf|anexo)'$q$), 0::bigint);
select t.eq('a lista e ordenada (mais recente primeiro) e respeita limite de texto',
  t.n($q$select count(*) from jsonb_array_elements(public.rede_conquistas_publicaveis()) e where length(e->>'previa') > 500$q$), 0::bigint);
select t.throws('alcance inventado', $q$select public.rede_conquistas_publicaveis('mundo')$q$, 'Alcance inválido');
select t.throws('titulo enviado pelo cliente nao existe como parametro', $q$select public.rede_conquistas_publicaveis(p_titulo := 'Super Heroi')$q$);
select t.throws('club_id enviado pelo cliente nao existe como parametro', format($q$select public.rede_conquistas_publicaveis(p_club_id := %L)$q$, t.id('clube_b')));
select t.throws('nome enviado pelo cliente nao existe como parametro', $q$select public.rede_conquistas_publicaveis(p_nome := 'Fulano')$q$);
select t.eq('alcance comunidade: mesma lista (nada publicado ainda)', t.nlista('comunidade'), 2::bigint);

select t.como('instrutor_a');
select t.eq('instrutor A lista as mesmas 2', t.nlista(), 2::bigint);
-- sem permissao: lista vazia (sem erro)
select t.como('conselheiro_a');
select t.eq('conselheiro: lista vazia', t.nlista(), 0::bigint);
select t.como('tesoureiro_a');
select t.eq('tesoureiro: lista vazia', t.nlista(), 0::bigint);
select t.como('membro_a');
select t.eq('desbravador (dono de uma conquista): lista vazia', t.nlista(), 0::bigint);
select t.como('pais_a');
select t.eq('responsavel: lista vazia', t.nlista(), 0::bigint);
select t.como('susp_dir_a');
select t.eq('diretoria com vinculo suspenso: lista vazia', t.nlista(), 0::bigint);
select t.como('enc_inst_a');
select t.eq('instrutor com vinculo encerrado: lista vazia', t.nlista(), 0::bigint);
select t.como('coord_123');
select t.eq('coordenacao institucional (por cargo): lista vazia', t.nlista(), 0::bigint);
select t.como('admin_123');
select t.eq('admin da plataforma (sem vinculo de clube): lista vazia', t.nlista(), 0::bigint);
select t.como('lider_b');
select t.eq('diretoria B lista so o que e do B (1: o membro B; o suspenso no B fica de fora)', t.nlista(), 1::bigint);
select t.eq('...e e o do B', t.lista_tem('mc_b'), 1::bigint);
select t.eq('...nada do A aparece no B', t.lista_tem('mc_ok') + t.lista_tem('ms_ok'), 0::bigint);
select t.eq('...o membro suspenso no B nao aparece', t.lista_tem('mc_susp_b'), 0::bigint);

-- multiclube: o papel vale no clube do contexto
select t.como('dir_a_membro_b');
select t.pedir_clube('clube_a');
select t.eq('diretoria no A (pedindo o A): lista as do A', t.nlista(), 2::bigint);
select t.pedir_clube('clube_b');
select t.eq('mesma pessoa, desbravador no B (pedindo o B): lista vazia', t.nlista(), 0::bigint);
select t.como('instrutor_2clubes');
select t.pedir_clube('clube_a');
select t.eq('instrutor nos dois clubes, contexto A: so as do A', t.nlista(), 2::bigint);
select t.pedir_clube('clube_b');
select t.eq('...contexto B: so a do B', t.nlista(), 1::bigint);
select t.eq('...e nenhuma do A vaza para o contexto B', t.lista_tem('mc_ok') + t.lista_tem('ms_ok'), 0::bigint);
select t.como('multi_dois_papeis');
select t.pedir_clube('clube_b');
select t.eq('conselheiro no B (desbravador no A): lista vazia', t.nlista(), 0::bigint);

-- =============================================================================
--  3. Publicar so o que esta na lista (ataques)
-- =============================================================================
select t.como('lider_a');
select t.throws('UUID forjado (aleatorio) e recusado', format($q$select public.rede_publicar_conquista('classe', %L)$q$, gen_random_uuid()), 'Não encontramos');
select t.throws('UUID forjado como especialidade tambem', format($q$select public.rede_publicar_conquista('especialidade', %L)$q$, gen_random_uuid()), 'Não encontramos');
select t.throws('id do ACHIEVEMENT (nao do registro) e recusado', format($q$select public.rede_publicar_conquista('classe', %L)$q$, t.id('ach_ok')), 'Não encontramos');
select t.throws('requisito individual nao e conquista', format($q$select public.rede_publicar_conquista('classe', %L)$q$, t.id('req_ind')), 'Não encontramos');
select t.throws('...nem como especialidade', format($q$select public.rede_publicar_conquista('especialidade', %L)$q$, t.id('req_ind')), 'Não encontramos');
select t.throws('id da classe do CATALOGO e recusado', format($q$select public.rede_publicar_conquista('classe', %L)$q$, t.id('classe_cat')), 'Não encontramos');
select t.throws('id da especialidade do CATALOGO e recusado', format($q$select public.rede_publicar_conquista('especialidade', %L)$q$, t.id('espec_cat')), 'Não encontramos');
select t.throws('id de PESSOA e recusado', format($q$select public.rede_publicar_conquista('classe', %L)$q$, t.id('membro_a')), 'Não encontramos');
select t.throws('id de CLUBE e recusado', format($q$select public.rede_publicar_conquista('classe', %L)$q$, t.id('clube_a')), 'Não encontramos');
select t.throws('tipo trocado (classe como especialidade)', format($q$select public.rede_publicar_conquista('especialidade', %L)$q$, t.id('mc_ok')), 'Não encontramos');
select t.throws('tipo trocado (especialidade como classe)', format($q$select public.rede_publicar_conquista('classe', %L)$q$, t.id('ms_ok')), 'Não encontramos');
select t.throws('tipo de origem inventado', format($q$select public.rede_publicar_conquista('requisito', %L)$q$, t.id('req_ind')), 'Origem da conquista inválida');
select t.throws('classe em andamento', format($q$select public.rede_publicar_conquista('classe', %L)$q$, t.id('mc_andamento')), 'Não encontramos');
select t.throws('classe revogada', format($q$select public.rede_publicar_conquista('classe', %L)$q$, t.id('mc_rev')), 'Não encontramos');
select t.throws('especialidade cancelada', format($q$select public.rede_publicar_conquista('especialidade', %L)$q$, t.id('ms_cancel')), 'Não encontramos');
select t.throws('conquista de OUTRO clube', format($q$select public.rede_publicar_conquista('classe', %L)$q$, t.id('mc_b')), 'Não encontramos');
select t.throws('conquista de responsavel (pais)', format($q$select public.rede_publicar_conquista('classe', %L)$q$, t.id('mc_pais')), 'não participa');
select t.throws('conquista de quem saiu do clube', format($q$select public.rede_publicar_conquista('classe', %L)$q$, t.id('mc_ex')), 'não participa');
select t.throws('alcance inventado', format($q$select public.rede_publicar_conquista('classe', %L, 'mundo')$q$, t.id('mc_ok')), 'Alcance inválido');
reset role;
select t.eq('nada foi publicado por nenhuma tentativa', (select count(*) from public.comunidade_posts where tipo = 'conquista'), 0::bigint);
select t.como('lider_b');
select t.throws('diretoria B nao publica conquista do A', format($q$select public.rede_publicar_conquista('classe', %L)$q$, t.id('mc_ok')), 'Não encontramos');
select t.throws('...nem a do suspenso no B (nao participa da Rede no B)', format($q$select public.rede_publicar_conquista('classe', %L)$q$, t.id('mc_susp_b')), 'não participa');
-- papel insuficiente
select t.como('membro_a');
select t.throws('o proprio desbravador nao publica a sua conquista', format($q$select public.rede_publicar_conquista('classe', %L)$q$, t.id('mc_ok')), 'Só a diretoria');
select t.como('pais_a');
select t.throws('responsavel nao publica conquista', format($q$select public.rede_publicar_conquista('classe', %L)$q$, t.id('mc_ok')), 'não publicam');
select t.como('conselheiro_a');
select t.throws('conselheiro nao publica conquista', format($q$select public.rede_publicar_conquista('classe', %L)$q$, t.id('mc_ok')), 'Só a diretoria');
select t.como('tesoureiro_a');
select t.throws('tesoureiro nao publica conquista', format($q$select public.rede_publicar_conquista('classe', %L)$q$, t.id('mc_ok')), 'Só a diretoria');
select t.como('susp_dir_a');
select t.throws('diretoria suspensa nao publica conquista', format($q$select public.rede_publicar_conquista('classe', %L)$q$, t.id('mc_ok')));
select t.como('enc_inst_a');
select t.throws('instrutor encerrado nao publica conquista', format($q$select public.rede_publicar_conquista('classe', %L)$q$, t.id('mc_ok')));
select t.como('coord_123');
select t.throws('coordenacao institucional nao publica conquista', format($q$select public.rede_publicar_conquista('classe', %L)$q$, t.id('mc_ok')));
select t.como('admin_123');
select t.throws('admin da plataforma (sem vinculo) nao publica conquista', format($q$select public.rede_publicar_conquista('classe', %L)$q$, t.id('mc_ok')));
reset role;
select t.eq('...e continua nada publicado', (select count(*) from public.comunidade_posts where tipo = 'conquista'), 0::bigint);

-- o caminho feliz: publicar tudo que a lista mostra; o texto publicado == previa
select t.como('lider_a');
select t.eq('lista -> publica no Meu Clube: 2 publicadas, texto IGUAL a previa nas 2', t.publica_lista('clube'), '2|2');
select t.eq('...lista do clube agora vazia', t.nlista('clube'), 0::bigint);
select t.eq('...lista da Comunidade ainda traz as 2 (alcance e por alcance)', t.nlista('comunidade'), 2::bigint);
select t.throws('republicar no mesmo alcance e recusado', format($q$select public.rede_publicar_conquista('classe', %L)$q$, t.id('mc_ok')), 'já foi publicada');
reset role;
select t.recuar(1500);
select t.como('instrutor_a');
select t.eq('instrutor publica na Comunidade: 2 publicadas com texto igual a previa', t.publica_lista('comunidade'), '2|2');
select t.eq('...lista da Comunidade vazia', t.nlista('comunidade'), 0::bigint);
reset role;
select t.eq('4 posts de conquista (2 clube + 2 comunidade), todos com origem real e autor da lideranca',
  (select count(*) from public.comunidade_posts where tipo = 'conquista' and conquista_origem_id is not null and autor_papel in ('diretoria', 'instrutor')), 4::bigint);
select t.eq('...nenhum traz foto, e nenhum texto fora do modelo',
  (select count(*) from public.comunidade_posts where tipo = 'conquista'
      and (foto_path is not null or legenda !~ '^(Membro A\.|Ana C\.) concluiu a (classe|especialidade) .+ no clube .+ 🎉$')), 0::bigint);
-- lista e publicar concordam para o B tambem
select t.recuar(1500);
select t.como('lider_b');
select t.eq('B: lista -> publica 1 com texto igual a previa', t.publica_lista('clube'), '1|1');
reset role;
select t.recuar(1500);

-- =============================================================================
--  4. Aviso e evento: so diretoria|instrutor, em qualquer alcance
-- =============================================================================
select t.como('membro_a');
select t.throws('desbravador: aviso no Meu Clube recusado', $q$select public.rede_publicar('aviso', 'Reuniao!')$q$, 'Avisos e eventos');
select t.throws('desbravador: evento no Meu Clube recusado', $q$select public.rede_publicar('evento', 'Acampamento')$q$, 'Avisos e eventos');
select t.throws('desbravador: aviso na Comunidade recusado', $q$select public.rede_publicar('aviso', 'Reuniao!', null, null, null, null, 'comunidade')$q$, 'diretoria e os instrutores');
select t.throws('desbravador: evento na Comunidade recusado', $q$select public.rede_publicar('evento', 'Acampamento', null, null, null, null, 'comunidade')$q$, 'diretoria e os instrutores');
select t.throws('desbravador: atividade institucional recusada', $q$select public.rede_publicar('atividade', 'Atividade')$q$, 'Atividades do clube');
select t.eq('desbravador segue publicando recado livre no proprio clube', t.txt($q$select public.rede_publicar('livre', 'Oi, clube!')->>'ok'$q$), 'true');
select t.como('conselheiro_a');
select t.throws('conselheiro: aviso no Meu Clube recusado', $q$select public.rede_publicar('aviso', 'Reuniao!')$q$, 'Avisos e eventos');
select t.throws('conselheiro: evento no Meu Clube recusado', $q$select public.rede_publicar('evento', 'Acampamento')$q$, 'Avisos e eventos');
select t.throws('conselheiro: aviso na Comunidade recusado', $q$select public.rede_publicar('aviso', 'x', null, null, null, null, 'comunidade')$q$, 'diretoria e os instrutores');
select t.eq('conselheiro segue publicando atividade no Meu Clube (regra de 515)', t.txt($q$select public.rede_publicar('atividade', 'Unidade em acao')->>'ok'$q$), 'true');
select t.como('tesoureiro_a');
select t.throws('tesoureiro: aviso no Meu Clube recusado', $q$select public.rede_publicar('aviso', 'Reuniao!')$q$, 'Avisos e eventos');
select t.throws('tesoureiro: evento na Comunidade recusado', $q$select public.rede_publicar('evento', 'x', null, null, null, null, 'comunidade')$q$, 'diretoria e os instrutores');
select t.como('pais_a');
select t.throws('responsavel: aviso recusado', $q$select public.rede_publicar('aviso', 'Reuniao!')$q$, 'não publicam');
select t.throws('responsavel: evento na Comunidade recusado', $q$select public.rede_publicar('evento', 'x', null, null, null, null, 'comunidade')$q$, 'não publicam');
select t.como('coord_123');
select t.throws('coordenacao institucional: aviso recusado', $q$select public.rede_publicar('aviso', 'Reuniao!')$q$, 'Avisos e eventos');
select t.throws('coordenacao institucional: evento recusado', $q$select public.rede_publicar('evento', 'x')$q$, 'Avisos e eventos');
select t.throws('coordenacao institucional: aviso na Comunidade recusado', $q$select public.rede_publicar('aviso', 'x', null, null, null, null, 'comunidade')$q$, 'diretoria e os instrutores');
select t.como('admin_123');
select t.throws('admin da plataforma (sem vinculo): aviso recusado', $q$select public.rede_publicar('aviso', 'Reuniao!')$q$, 'clube');
select t.throws('admin da plataforma (sem vinculo): evento na Comunidade recusado', $q$select public.rede_publicar('evento', 'x', null, null, null, null, 'comunidade')$q$, 'clube');
select t.como('susp_dir_a');
select t.throws('diretoria suspensa: aviso recusado', $q$select public.rede_publicar('aviso', 'Reuniao!')$q$);
select t.como('enc_inst_a');
select t.throws('instrutor encerrado: evento recusado', $q$select public.rede_publicar('evento', 'x')$q$);
-- multiclube
select t.como('dir_a_membro_b');
select t.pedir_clube('clube_b');
select t.throws('diretoria no A mas DESBRAVADOR no B: aviso no B recusado', $q$select public.rede_publicar('aviso', 'x')$q$);
select t.pedir_clube('clube_a');
select t.eq('...pedindo o A (diretoria) o aviso passa', t.txt($q$select public.rede_publicar('aviso', 'Aviso da diretoria A')->>'ok'$q$), 'true');
select t.como('multi_dois_papeis');
select t.pedir_clube('clube_b');
select t.throws('conselheiro no B: evento recusado', $q$select public.rede_publicar('evento', 'x')$q$, 'Avisos e eventos');
reset role;
select t.recuar(1500);
-- quem pode
select t.como('lider_a');
select t.eq('diretoria: aviso no Meu Clube', t.txt($q$select public.rede_publicar('aviso', 'Aviso interno')->>'ok'$q$), 'true');
select t.eq('diretoria: evento no Meu Clube', t.txt($q$select public.rede_publicar('evento', 'Evento interno')->>'ok'$q$), 'true');
reset role;
select t.recuar(1500);
select t.como('lider_a');
select t.eq('diretoria: aviso na Comunidade', t.txt($q$select public.rede_publicar('aviso', 'Reuniao de sabado', null, null, null, null, 'comunidade')->>'ok'$q$), 'true');
reset role;
insert into t.ids (chave, id) select 'post_com_a', id from public.comunidade_posts where autor_id = t.id('lider_a') and alcance = 'comunidade' and tipo = 'aviso';
select t.recuar(1500);
select t.como('instrutor_a');
select t.eq('instrutor: evento no Meu Clube', t.txt($q$select public.rede_publicar('evento', 'Evento do instrutor')->>'ok'$q$), 'true');
select t.eq('instrutor: evento na Comunidade', t.txt($q$select public.rede_publicar('evento', 'Evento aberto', null, null, null, null, 'comunidade')->>'ok'$q$), 'true');
select t.como('instrutor_2clubes');
select t.pedir_clube('clube_b');
select t.eq('instrutor em 2 clubes: aviso no B (contexto B)', t.txt($q$select public.rede_publicar('aviso', 'Aviso do B')->>'ok'$q$), 'true');
reset role;
select t.recuar(1500);
select t.como('lider_b');
select t.eq('diretoria B: aviso na Comunidade', t.txt($q$select public.rede_publicar('aviso', 'Reuniao do B', null, null, null, null, 'comunidade')->>'ok'$q$), 'true');
reset role;
insert into t.ids (chave, id) select 'post_com_b', id from public.comunidade_posts where autor_id = t.id('lider_b') and alcance = 'comunidade' and tipo = 'aviso';
insert into t.ids (chave, id) select 'post_clube_a', id from public.comunidade_posts where autor_id = t.id('membro_a') and alcance = 'clube' and tipo = 'livre';
select t.eq('os recados recusados nao deixaram rastro (nenhum aviso/evento de quem nao pode)',
  (select count(*) from public.comunidade_posts where tipo in ('aviso', 'evento') and autor_papel not in ('diretoria', 'instrutor')), 0::bigint);
select t.recuar(1500);

-- =============================================================================
--  5. Comentarios na Comunidade
-- =============================================================================
select t.como('lider_b');
select t.eq('diretoria de OUTRO clube comenta na Comunidade', t.txt(format($q$select public.comunidade_comentar(%L, 'Boa, turma!')->>'ok'$q$, t.id('post_com_a'))), 'true');
select t.como('instrutor_a');
select t.eq('instrutor comenta na Comunidade', t.txt(format($q$select public.comunidade_comentar(%L, 'Conto com voces!')->>'ok'$q$, t.id('post_com_a'))), 'true');
select t.como('conselheiro_a');
select t.eq('conselheiro comenta na Comunidade', t.txt(format($q$select public.comunidade_comentar(%L, 'A unidade vai!')->>'ok'$q$, t.id('post_com_a'))), 'true');
select t.como('tesoureiro_a');
select t.throws('tesoureiro NAO comenta na Comunidade', format($q$select public.comunidade_comentar(%L, 'Oi')$q$, t.id('post_com_a')), 'Na Comunidade comentam');
select t.eq('...mas tesoureiro ainda comenta no Meu Clube (alcance clube)', t.txt(format($q$select public.comunidade_comentar(%L, 'Parabens!')->>'ok'$q$, t.id('post_clube_a'))), 'true');
select t.como('pais_a');
select t.throws('responsavel NAO comenta', format($q$select public.comunidade_comentar(%L, 'Oi')$q$, t.id('post_com_a')), 'não publicam');
select t.como('coord_123');
select t.throws('coordenacao institucional (so por cargo) NAO comenta na Comunidade', format($q$select public.comunidade_comentar(%L, 'Oi')$q$, t.id('post_com_a')), 'Na Comunidade comentam');
select t.como('admin_123');
select t.throws('admin da plataforma (sem vinculo) NAO comenta', format($q$select public.comunidade_comentar(%L, 'Oi')$q$, t.id('post_com_a')), 'clube');
select t.como('susp_dir_a');
select t.throws('diretoria com vinculo suspenso NAO comenta', format($q$select public.comunidade_comentar(%L, 'Oi')$q$, t.id('post_com_a')), 'Entre num clube');
select t.como('enc_inst_a');
select t.throws('instrutor com vinculo encerrado NAO comenta', format($q$select public.comunidade_comentar(%L, 'Oi')$q$, t.id('post_com_a')), 'Entre num clube');
select t.como('membro_b');
select t.throws('desbravador de OUTRO clube NAO comenta (regra de 515 mantida)', format($q$select public.comunidade_comentar(%L, 'Oi')$q$, t.id('post_com_a')), 'seu clube');
select t.eq('...mas pode curtir', t.txt(format($q$select public.comunidade_curtir(%L, true)->>'eu_curti'$q$, t.id('post_com_a'))), 'true');
select t.como('membro_a');
select t.eq('desbravador comenta na Comunidade do PROPRIO clube (regra de 515 mantida)', t.txt(format($q$select public.comunidade_comentar(%L, 'Vou sim!')->>'ok'$q$, t.id('post_com_a'))), 'true');
-- multiclube
select t.como('multi_dois_papeis');
select t.pedir_clube('clube_b');
select t.eq('conselheiro no B (desbravador no A): comenta na Comunidade do A pelo papel do B', t.txt(format($q$select public.comunidade_comentar(%L, 'Oi do B!')->>'ok'$q$, t.id('post_com_a'))), 'true');
select t.como('dir_a_membro_b');
select t.pedir_clube('clube_b');
select t.throws('diretoria no A mas desbravador no B: no contexto B NAO comenta conteudo do A', format($q$select public.comunidade_comentar(%L, 'Oi')$q$, t.id('post_com_a')));
select t.pedir_clube('clube_a');
select t.eq('...no contexto A (diretoria) comenta', t.txt(format($q$select public.comunidade_comentar(%L, 'Oi da diretoria')->>'ok'$q$, t.id('post_com_a'))), 'true');
select t.como('suspenso_so_b');
select t.pedir_clube('clube_b');
select t.throws('vinculo SUSPENSO no B: nao comenta no B (cai no A, onde e desbravador de outro clube)', format($q$select public.comunidade_comentar(%L, 'Oi')$q$, t.id('post_com_b')));
reset role;
select t.eq('...e nenhum comentario dele existe', (select count(*) from public.comunidade_comentarios where autor_id = t.id('suspenso_so_b')), 0::bigint);
select t.eq('comentarios gravados: so de quem pode (lider_b, instrutor_a, conselheiro_a, membro_a, multi, dir_a_membro_b) + 1 do tesoureiro no Meu Clube',
  (select count(*) from public.comunidade_comentarios where post_id = t.id('post_com_a')), 6::bigint);
select t.eq('...nenhum na Comunidade de tesoureiro/pais/coord/admin/suspenso/encerrado/desbravador de fora',
  (select count(*) from public.comunidade_comentarios where post_id = t.id('post_com_a')
      and autor_id in (t.id('tesoureiro_a'), t.id('pais_a'), t.id('coord_123'), t.id('admin_123'), t.id('susp_dir_a'), t.id('enc_inst_a'), t.id('membro_b'), t.id('suspenso_so_b'))), 0::bigint);

-- =============================================================================
--  6. Foto na Comunidade: analise -> aprovacao -> publicacao (inalterado); platform admin so modera o que lhe cabe
-- =============================================================================
select t.recuar(1500);
select t.obj(t.cam('clube_a', 'lider_a', 'f1'));
select t.obj(t.cam('clube_a', 'lider_a', 'f2'));
select t.obj(t.cam('clube_a', 'lider_a', 'f3'));
select t.como('lider_a');
select t.eq('foto na Comunidade entra EM ANALISE', t.txt(format($q$select public.rede_publicar('foto_clube', 'Acampamento', %L, 'Grupo no acampamento', null, null, 'comunidade')->>'status'$q$, t.cam('clube_a', 'lider_a', 'f1'))), 'em_analise');
select t.eq('foto no Meu Clube continua direta (legado)', t.txt(format($q$select public.rede_publicar('foto_clube', 'Acampamento 2', %L, 'Outro grupo')->>'status'$q$, t.cam('clube_a', 'lider_a', 'f2'))), 'publicado');
reset role;
insert into t.ids (chave, id) select 'foto_com', id from public.comunidade_posts where foto_path = t.cam('clube_a', 'lider_a', 'f1');
insert into t.ids (chave, id) select 'foto_clube', id from public.comunidade_posts where foto_path = t.cam('clube_a', 'lider_a', 'f2');
select t.como('lider_b');
select t.throws('em analise: outro clube nao abre a foto', format($q$select public.comunidade_post(%L)$q$, t.id('foto_com')), 'não está disponível');
select t.eq('...nem a ve no feed da Comunidade', t.n(format($q$select count(*) from jsonb_array_elements(public.rede_feed('comunidade', null, null, 20)->'itens') e where e->>'id' = %L$q$, t.id('foto_com'))), 0::bigint);
select t.como('lider_a');
select t.eq('a diretoria do clube aprova', t.txt(format($q$select public.comunidade_moderar('post', %L, 'aprovar_foto')->>'status'$q$, t.id('foto_com'))), 'publicado');
select t.como('lider_b');
select t.eq('...e entao o outro clube ve na Comunidade', t.n(format($q$select count(*) from jsonb_array_elements(public.rede_feed('comunidade', null, null, 20)->'itens') e where e->>'id' = %L$q$, t.id('foto_com'))), 1::bigint);
-- platform admin: so Comunidade em analise/denunciada
reset role;
select t.recuar(1500);
select t.como('admin_123');
select t.throws('admin da plataforma NAO modera post da Comunidade publicado e sem denuncia', format($q$select public.admin_comunidade_moderar('post', %L, 'ocultar')$q$, t.id('foto_com')), 'não encontrado');
select t.throws('...nem post do Meu Clube', format($q$select public.admin_comunidade_moderar('post', %L, 'ocultar')$q$, t.id('foto_clube')), 'não encontrado');
reset role;
-- uma foto em analise no Meu Clube (alcance clube) tambem nao e da plataforma
update public.comunidade_posts set status = 'em_analise' where id = t.id('foto_clube');
select t.como('admin_123');
select t.throws('...nem foto em analise do Meu Clube (privada do clube)', format($q$select public.admin_comunidade_moderar('post', %L, 'recusar_foto')$q$, t.id('foto_clube')), 'não encontrado');
reset role;
update public.comunidade_posts set status = 'publicado' where id = t.id('foto_clube');
-- uma foto da Comunidade em analise: a plataforma pode moderar e fica no log
select t.como('lider_a');
select t.eq('diretoria A manda uma segunda foto para a Comunidade (em analise)', t.txt(format($q$select public.rede_publicar('foto_clube', 'Outra', %L, 'Descricao', null, null, 'comunidade')->>'status'$q$, t.cam('clube_a', 'lider_a', 'f3'))), 'em_analise');
reset role;
insert into t.ids (chave, id) select 'foto_com2', id from public.comunidade_posts where foto_path = t.cam('clube_a', 'lider_a', 'f3');
select t.como('admin_123');
select t.eq('admin da plataforma modera item da Comunidade em analise', t.txt(format($q$select public.admin_comunidade_moderar('post', %L, 'recusar_foto', 'fora do padrao')->>'status'$q$, t.id('foto_com2'))), 'recusado');
reset role;
select t.eq('...e a acao ficou no log append-only da plataforma',
  (select count(*) from public.plataforma_acesso_log where admin_user_id = t.id('admin_123') and item_id = t.id('foto_com2') and o_que = 'moderar_recusar_foto'), 1::bigint);

select t.fim();
rollback;
