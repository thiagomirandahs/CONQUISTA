-- REDE DBV (migrations 480–481) — PUBLICAÇÃO DIRETA, STORIES de 24 h e BUSCA.
-- Prova: a regra de foto vive num lugar só (rede_foto_exige_aprovacao, hoje false = publica direto,
-- decisão do dono de 29/09/2026) e vale para post E story; story dura 24 h (some da fileira, o arquivo
-- não abre mais e entra na fila de apagar); texto do story passa pela triagem; fileira agrupada por
-- pessoa com os meus primeiro e "visto" por usuário; denúncia esconde na hora e avisa a diretoria do
-- clube de quem publicou (Manter/Remover pela mesma moderação); isolamento entre clubes; recurso
-- desligado bloqueia; anon sem acesso; se a regra voltar a exigir aprovação, o story nasce em análise
-- e as 24 h contam da aprovação; busca só acha quem participa da rede.
begin;
\ir _lib.sql
\ir _fixtures.sql

\o /dev/null
select t.como_cron();
set local session_replication_role = replica;
update public.profiles set created_at = now() - interval '60 days'
 where id in (t.id('membro_a'), t.id('membro_b'), t.id('lider_a'), t.id('lider_b'));
set local session_replication_role = origin;
select t.mk('admin_st', 'Admin Plataforma', 'diretoria', 'ativo', 'clube_b');
insert into public.platform_admins (user_id, papel) values (t.id('admin_st'), 'operacao');
create function t.recuar(p_min int) returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.comunidade_posts set created_at = created_at - make_interval(mins => p_min);
  update public.rede_stories set created_at = created_at - make_interval(mins => p_min);
  update public.comunidade_bloqueios set created_at = created_at - make_interval(mins => p_min);
end $$;
create function t.nome_clube(p_chave text) returns text language sql security definer set search_path = '' as $$
  select nome from public.organizational_units where id = t.id(p_chave);
$$;
insert into t.ids values ('s1', gen_random_uuid()), ('s2', gen_random_uuid()), ('s3', gen_random_uuid()),
  ('s4', gen_random_uuid()), ('sa', gen_random_uuid()), ('p1', gen_random_uuid());
create table t.cam as select
  t.id('clube_b')::text || '/' || t.id('membro_b')::text || '/' || t.id('s1')::text || '.webp' as s1,
  t.id('clube_b')::text || '/' || t.id('membro_b')::text || '/' || t.id('s2')::text || '.webp' as s2,
  t.id('clube_b')::text || '/' || t.id('membro_b')::text || '/' || t.id('s3')::text || '.webp' as s3,
  t.id('clube_b')::text || '/' || t.id('membro_b')::text || '/' || t.id('s4')::text || '.webp' as s4,
  t.id('clube_a')::text || '/' || t.id('membro_a')::text || '/' || t.id('sa')::text || '.webp' as sa,
  t.id('clube_b')::text || '/' || t.id('membro_b')::text || '/' || t.id('p1')::text || '.webp' as p1;
grant usage on schema t to public;
grant select on t.cam to public;
reset role;
\o

-- =============================================================================
--  1. Estrutura, regra num lugar só, anon
-- =============================================================================
select t.eq('regra de hoje: foto publica direto (decisão do dono, 29/09/2026)', public.rede_foto_exige_aprovacao(), false);
select t.eq('story dura 24 h', public.rede_horas_de_story(), 24);
select t.eq('tabelas de story com RLS e sem grant',
  (select count(*) from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
      and c.relname in ('rede_stories', 'rede_stories_vistos') and c.relrowsecurity
      and not exists (select 1 from information_schema.role_table_grants g where g.table_schema = 'public' and g.table_name = c.relname
                        and g.grantee in ('anon', 'authenticated', 'PUBLIC'))), 2::bigint);
select t.eq('...com a guarda do modo manutenção',
  (select count(distinct c.relname) from pg_trigger g join pg_class c on c.oid = g.tgrelid
    where c.relname in ('rede_stories', 'rede_stories_vistos') and g.tgname = 'zz_manutencao_guarda'), 2::bigint);
select t.como_anon();
select t.throws('anon não vê a fileira', $q$select public.rede_stories()$q$);
select t.throws('anon não publica story', $q$select public.rede_story_publicar('x', null)$q$);
select t.throws('anon não busca', $q$select public.rede_buscar('ana')$q$);
select t.throws('anon não marca visto', $q$select public.rede_story_visto(gen_random_uuid())$q$);
reset role;

-- =============================================================================
--  2. Recurso desligado: tudo bloqueado
-- =============================================================================
select t.como('membro_b');
select t.throws('desligado: fileira bloqueada', $q$select public.rede_stories()$q$, 'não está liberada');
select t.throws('desligado: publicar story bloqueado', $q$select public.rede_story_publicar((select s1 from t.cam))$q$, 'não está liberada');
select t.throws('desligado: busca bloqueada', $q$select public.rede_buscar('membro')$q$, 'não está liberada');
select t.bloqueado('desligado: nem sobe a foto', $q$insert into storage.objects (bucket_id, name, owner) select 'comunidade', s1, auth.uid() from t.cam$q$);

select t.como('admin_st');
select public.admin_recurso_do_clube_definir(t.id('clube_a'), 'comunidade', true);
select public.admin_recurso_do_clube_definir(t.id('clube_b'), 'comunidade', true);
select t.como('pais_a');
select public.comunidade_autorizar(t.id('membro_a'), true);
select t.como('pais_b');
select public.comunidade_autorizar(t.id('membro_b'), true);
reset role;

-- =============================================================================
--  3. Publicar story (direto) — validações e triagem
-- =============================================================================
select t.como('membro_b');
select t.permitido('sobe as fotos do story no próprio caminho',
  $q$insert into storage.objects (bucket_id, name, owner, metadata) select 'comunidade', x, auth.uid(), '{"size": 110000}'
     from t.cam, unnest(array[s1, s2, s3, s4, p1]) as x$q$, 5);
select t.throws('story sem foto é recusado', $q$select public.rede_story_publicar(null, 'oi')$q$, 'Escolha uma foto');
select t.throws('caminho inventado é recusado', $q$select public.rede_story_publicar('x/y/z.webp')$q$, 'inválida');
select t.throws('foto de OUTRA pessoa é recusada', $q$select public.rede_story_publicar((select sa from t.cam))$q$, 'inválida');
select t.throws('texto acima de 120 é recusado', format($q$select public.rede_story_publicar((select s1 from t.cam), %L)$q$, repeat('a', 121)), 'até 120');
select t.eq('texto do story passa pela triagem', t.txt($q$select public.rede_story_publicar((select s1 from t.cam), 'me chama no zap')->>'motivo'$q$), 'contato');
reset role;
select t.eq('bloqueado não cria story', (select count(*) from public.rede_stories), 0::bigint);
select t.recuar(5);
select t.como('membro_b');
select t.eq('story com foto PUBLICA DIRETO', t.txt($q$select public.rede_story_publicar((select s1 from t.cam), 'Pôr do sol no acampamento')->>'status'$q$), 'publicado');
select t.throws('a mesma foto não vira dois stories', $q$select public.rede_story_publicar((select s1 from t.cam))$q$, 'já foi usada');
select t.eq('segundo story', t.txt($q$select public.rede_story_publicar((select s2 from t.cam))->>'ok'$q$), 'true');
select t.eq('limite: no máximo 2 por minuto', t.txt($q$select public.rede_story_publicar((select s3 from t.cam))->>'motivo'$q$), 'limite');
select t.eq('post com foto também publica direto', t.txt($q$select public.rede_publicar('foto', 'Trilha', (select p1 from t.cam))->>'status'$q$), 'publicado');
reset role;
insert into t.ids (chave, id) select 'st1', id from public.rede_stories where foto_path = (select s1 from t.cam);
insert into t.ids (chave, id) select 'st2', id from public.rede_stories where foto_path = (select s2 from t.cam);
update public.rede_stories set publicado_em = publicado_em - interval '1 minute' where id = t.id('st1');   -- ordem estável na bolinha
select t.ok('as 24 h contam da publicação',
  (select expira_em between now() + interval '23 hours 59 minutes' and now() + interval '24 hours 1 minute' from public.rede_stories where id = t.id('st1')));
select t.eq('nenhum aviso de "aguardando aprovação" à diretoria', (select count(*) from public.notificacoes where para_usuario = t.id('lider_b') and titulo like '%aguardando%'), 0::bigint);

-- =============================================================================
--  4. Fileira, visto e arquivo
-- =============================================================================
select t.como('membro_b');
select t.eq('meus stories vêm primeiro', t.txt($q$select public.rede_stories()->0->>'meu'$q$), 'true');
select t.eq('...agrupados (2 stories numa bolinha)', t.n($q$select jsonb_array_length(public.rede_stories()->0->'stories')$q$), 2::bigint);
select t.como('membro_a');
select t.eq('outro clube vê o story (nome + sobrenome)', t.txt($q$select public.rede_stories()->0->'autor'->>'nome'$q$), 'Membro B');
select t.eq('...ainda não visto', t.txt($q$select public.rede_stories()->0->>'todos_vistos'$q$), 'false');
select t.eq('...e abre o arquivo (URL assinada passa na policy)', t.n($q$select count(*) from storage.objects where bucket_id = 'comunidade' and name = (select s1 from t.cam)$q$), 1::bigint);
select public.rede_story_visto(t.id('st1'));
select public.rede_story_visto(t.id('st1'));
select t.eq('visto é por story', t.txt($q$select string_agg(e->>'visto', ',' order by e->>'criado_em') from jsonb_array_elements(public.rede_stories()->0->'stories') e$q$), 'true,false');
select public.rede_story_visto(t.id('st2'));
select t.eq('todos vistos: anel cinza', t.txt($q$select public.rede_stories()->0->>'todos_vistos'$q$), 'true');
select t.bloqueado('ninguém lê rede_stories direto', $q$select * from public.rede_stories$q$);
select t.bloqueado('...nem rede_stories_vistos', $q$select * from public.rede_stories_vistos$q$);
select t.como('lider_b');
select t.eq('visto é por usuário (a diretoria B ainda não viu)', t.txt($q$select e->>'todos_vistos' from jsonb_array_elements(public.rede_stories()) e where e->'autor'->>'nome' = 'Membro B'$q$), 'false');
select t.como('membro_a2');
select t.throws('criança SEM autorização dos pais não vê a fileira', $q$select public.rede_stories()$q$, 'autorizar');
select t.eq('...nem abre o arquivo', t.nv($q$select count(*) from storage.objects where bucket_id = 'comunidade' and name = (select s1 from t.cam)$q$), 0::bigint);
select t.como('membro_b');
select t.bloqueado('autor não apaga o arquivo de story no ar', $q$delete from storage.objects where bucket_id = 'comunidade' and name = (select s1 from t.cam)$q$);
reset role;
select t.eq('visto gravado uma vez', (select count(*) from public.rede_stories_vistos where story_id = t.id('st1')), 1::bigint);

-- =============================================================================
--  5. Denúncia: esconde na hora e avisa a diretoria do clube de quem publicou
-- =============================================================================
select t.como('membro_b');
select t.throws('não denuncia o próprio story', format($q$select public.comunidade_denunciar('story', %L, 'outro')$q$, t.id('st2')), 'mesmo publicou');
select t.como('membro_a');
select t.eq('denúncia esconde o story na hora', t.txt(format($q$select public.comunidade_denunciar('story', %L, 'imagem')->>'ocultou'$q$, t.id('st2'))), 'true');
select t.eq('...sumiu da fileira (fica só o outro)', t.n($q$select jsonb_array_length(public.rede_stories()->0->'stories')$q$), 1::bigint);
select t.throws('...e não marca mais visto', format($q$select public.rede_story_visto(%L)$q$, t.id('st2')), 'não está disponível');
select t.eq('...nem abre o arquivo', t.nv($q$select count(*) from storage.objects where bucket_id = 'comunidade' and name = (select s2 from t.cam)$q$), 0::bigint);
reset role;
select t.ok('diretoria B avisada', (select count(*) from public.notificacoes where para_usuario = t.id('lider_b') and titulo like '%denunciado%') = 1);
select t.eq('diretoria A (de quem denunciou) NÃO é avisada', (select count(*) from public.notificacoes where para_usuario = t.id('lider_a') and titulo like '%denunciado%'), 0::bigint);
select t.eq('histórico registra o ocultamento', (select count(*) from public.comunidade_moderacao_log where alvo_tipo = 'story' and alvo_id = t.id('st2') and acao = 'ocultado_por_denuncia'), 1::bigint);
select t.como('lider_a');
select t.throws('diretoria de OUTRO clube não modera', format($q$select public.comunidade_moderar('story', %L, 'restaurar')$q$, t.id('st2')), 'não encontrado');
select t.como('lider_b');
select t.eq('diretoria B vê o story na fila de denúncias', t.txt($q$select e->>'tipo' from jsonb_array_elements(public.comunidade_fila_moderacao()->'denuncias') e$q$), 'story');
select t.eq('fila de fotos vazia (publicação direta)', t.n($q$select jsonb_array_length(public.comunidade_fila_moderacao()->'fotos')$q$), 0::bigint);
select t.eq('...e abre o arquivo para revisar', t.n($q$select count(*) from storage.objects where bucket_id = 'comunidade' and name = (select s2 from t.cam)$q$), 1::bigint);
select t.eq('Manter volta ao ar', t.txt(format($q$select public.comunidade_moderar('story', %L, 'restaurar')->>'status'$q$, t.id('st2'))), 'publicado');
reset role;
select t.ok('Manter não estica as 24 h', (select expira_em < now() + interval '24 hours 1 minute' from public.rede_stories where id = t.id('st2')));
insert into public.comunidade_denuncias (club_id, alvo_tipo, alvo_id, denunciante_id, motivo)
values (t.id('clube_b'), 'story', t.id('st2'), t.id('lider_a'), 'outro');
select t.como('lider_b');
select t.eq('Remover tira do ar', t.txt(format($q$select public.comunidade_moderar('story', %L, 'remover')->>'status'$q$, t.id('st2'))), 'removido');
reset role;
select t.eq('removido: arquivo entra na fila de apagar na hora', (select motivo from public.rede_fotos_para_apagar where story_id = t.id('st2')), 'story');
select t.eq('remover dá aviso (strike) ao autor', (select count(*) from public.comunidade_avisos where usuario_id = t.id('membro_b') and origem = 'conteudo_removido'), 1::bigint);

-- =============================================================================
--  6. 24 h: expirou, sumiu
-- =============================================================================
update public.rede_stories set expira_em = now() - interval '1 minute', publicado_em = now() - interval '24 hours 1 minute' where id = t.id('st1');
select t.como('membro_a');
select t.eq('expirado some da fileira', t.n($q$select jsonb_array_length(public.rede_stories())$q$), 0::bigint);
select t.throws('...não marca visto', format($q$select public.rede_story_visto(%L)$q$, t.id('st1')), 'não está disponível');
select t.throws('...não aceita denúncia', format($q$select public.comunidade_denunciar('story', %L, 'outro')$q$, t.id('st1')), 'não está disponível');
select t.eq('...e o arquivo não abre mais', t.nv($q$select count(*) from storage.objects where bucket_id = 'comunidade' and name = (select s1 from t.cam)$q$), 0::bigint);
select t.como('membro_b');
select t.eq('o autor também não vê mais o expirado na fileira', t.n($q$select jsonb_array_length(public.rede_stories())$q$), 0::bigint);
select t.como_cron();
select t.ok('a rotina diária marca o story expirado', public.rede_marcar_fotos_para_apagar() >= 1);
reset role;
select t.eq('expirado na fila (motivo story, com tamanho)', (select motivo || '|' || bytes from public.rede_fotos_para_apagar where story_id = t.id('st1')), 'story|110000');
select t.eq('foto de story ativo/pendente NÃO vira órfã', (select count(*) from public.rede_fotos_para_apagar where motivo = 'orfa'), 0::bigint);
select t.como_service();
set local role service_role;
select t.eq('a Edge Function confirma o apagamento', (select public.rede_fotos_confirmar((select array_agg(id) from public.rede_fotos_pendentes()))->>'arquivos'), '2');
reset role;
select t.ok('story marcado com a foto apagada', (select foto_apagada_em is not null from public.rede_stories where id = t.id('st1')));

-- =============================================================================
--  7. Isolamento: clube que desliga o recurso sai da fileira dos outros
-- =============================================================================
select t.recuar(5);
select t.como('membro_b');
select public.rede_story_publicar((select s3 from t.cam), 'Nó de escota');
select t.como('membro_a');
select t.eq('story novo de B aparece para A', t.n($q$select jsonb_array_length(public.rede_stories())$q$), 1::bigint);
select t.como('admin_st');
select public.admin_recurso_do_clube_definir(t.id('clube_b'), 'comunidade', false);
select t.como('membro_a');
select t.eq('B desligou: some da fileira de A', t.n($q$select jsonb_array_length(public.rede_stories())$q$), 0::bigint);
select t.eq('...e o arquivo não abre', t.nv($q$select count(*) from storage.objects where bucket_id = 'comunidade' and name = (select s3 from t.cam)$q$), 0::bigint);
select t.como('admin_st');
select public.admin_recurso_do_clube_definir(t.id('clube_b'), 'comunidade', true);
select t.como('pais_b');
select public.comunidade_autorizar(t.id('membro_b'), false);
select t.como('membro_a');
select t.eq('responsável retirou a autorização: o story da criança some', t.n($q$select jsonb_array_length(public.rede_stories())$q$), 0::bigint);
select t.como('pais_b');
select public.comunidade_autorizar(t.id('membro_b'), true);
reset role;

-- =============================================================================
--  8. Busca
-- =============================================================================
select t.como('membro_a');
select t.eq('termo curto não busca', t.n($q$select jsonb_array_length(public.rede_buscar('m')->'pessoas')$q$), 0::bigint);
select t.ok('acha pessoa pelo nome público', t.n($q$select count(*) from jsonb_array_elements(public.rede_buscar('membro b')->'pessoas') e where e->>'nome' = 'Membro B'$q$) = 1);
select t.ok('...sem acento/maiúscula', t.n($q$select count(*) from jsonb_array_elements(public.rede_buscar('MÉMBRO B')->'pessoas') e where e->>'nome' = 'Membro B'$q$) = 1);
select t.eq('criança SEM autorização dos pais não aparece', t.n($q$select count(*) from jsonb_array_elements(public.rede_buscar('membro a2')->'pessoas') e$q$), 0::bigint);
select t.eq('responsável não aparece', t.n($q$select count(*) from jsonb_array_elements(public.rede_buscar('pais')->'pessoas') e$q$), 0::bigint);
select t.eq('acha o clube pelo nome', t.txt(format($q$select public.rede_buscar(%L)->'clubes'->0->>'id'$q$, t.nome_clube('clube_b'))), t.id('clube_b')::text);
select t.ok('lista as pessoas de um clube', t.n(format($q$select count(*) from jsonb_array_elements(public.rede_buscar(null, %L)->'pessoas') e where e->>'clube' = %L$q$, t.id('clube_b'), t.nome_clube('clube_b'))) >= 2);
select t.como('admin_st');
select public.admin_recurso_do_clube_definir(t.id('clube_b'), 'comunidade', false);
select t.como('membro_a');
select t.eq('clube com o recurso desligado não aparece', t.n(format($q$select jsonb_array_length(public.rede_buscar(%L)->'clubes')$q$, t.nome_clube('clube_b'))), 0::bigint);
select t.eq('...nem as pessoas dele', t.n($q$select count(*) from jsonb_array_elements(public.rede_buscar('membro b')->'pessoas') e$q$), 0::bigint);
select t.throws('...nem a lista do clube', format($q$select public.rede_buscar(null, %L)$q$, t.id('clube_b')), 'não participa');
select t.como('admin_st');
select public.admin_recurso_do_clube_definir(t.id('clube_b'), 'comunidade', true);
reset role;

-- =============================================================================
--  9. Se a regra voltar a exigir aprovação (troca numa migration): story nasce em análise
--     e as 24 h contam da APROVAÇÃO. (Aqui a troca é só dentro deste teste, que termina em rollback.)
-- =============================================================================
create or replace function public.rede_foto_exige_aprovacao() returns boolean language sql stable set search_path = '' as $$ select true $$;
select t.recuar(5);
select t.como('membro_b');
select t.eq('com aprovação: story nasce EM ANÁLISE', t.txt($q$select public.rede_story_publicar((select s4 from t.cam))->>'status'$q$), 'em_analise');
select t.eq('...o autor vê o próprio pendente', t.txt($q$select public.rede_stories()->0->'stories'->-1->>'status'$q$), 'em_analise');
reset role;
insert into t.ids (chave, id) select 'st4', id from public.rede_stories where foto_path = (select s4 from t.cam);
select t.ok('...sem prazo ainda', (select expira_em is null from public.rede_stories where id = t.id('st4')));
select t.ok('...diretoria B avisada', (select count(*) from public.notificacoes where para_usuario = t.id('lider_b') and titulo like '%Story aguardando%') = 1);
select t.como('membro_a');
select t.eq('...outro clube não vê', t.n(format($q$select count(*) from jsonb_array_elements(public.rede_stories()) g, jsonb_array_elements(g->'stories') e where e->>'id' = %L$q$, t.id('st4'))), 0::bigint);
select t.como('lider_b');
select t.eq('...está na fila de fotos da diretoria B', t.txt($q$select string_agg(e->>'tipo', ',') from jsonb_array_elements(public.comunidade_fila_moderacao()->'fotos') e$q$), 'story');
reset role;
update public.rede_stories set created_at = now() - interval '5 hours' where id = t.id('st4');
select t.como('lider_b');
select t.eq('aprova', t.txt(format($q$select public.comunidade_moderar('story', %L, 'aprovar_foto')->>'status'$q$, t.id('st4'))), 'publicado');
reset role;
select t.ok('as 24 h contam da aprovação (não do envio)',
  (select expira_em > now() + interval '23 hours 59 minutes' from public.rede_stories where id = t.id('st4')));
select t.como('membro_a');
select t.eq('aprovado: aparece para outro clube', t.n(format($q$select count(*) from jsonb_array_elements(public.rede_stories()) g, jsonb_array_elements(g->'stories') e where e->>'id' = %L$q$, t.id('st4'))), 1::bigint);
reset role;

select t.fim();
rollback;
