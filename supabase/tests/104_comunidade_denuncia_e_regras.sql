-- COMUNIDADE (migrations 430–432) — recurso, denúncia, moderação e regras de segurança.
-- Prova: recurso desligado (e somente da plataforma) bloqueia tudo; anon sem acesso; sem acesso
-- direto às tabelas; autorização dos pais (e revogação); perfil público só com nome + sobrenome
-- (migration 470; antes: primeiro nome) + clube; adulto de outro clube não comenta em post de criança; pais não publicam; denúncia esconde
-- na hora e avisa a diretoria do clube de quem publicou; restaurar/remover com auditoria; denúncia
-- abusiva perde o poder de esconder; três avisos = suspensão; limites por minuto/dia e conta nova;
-- foto só aparece depois da diretoria aprovar (Storage inclusive); repost interno; isolamento
-- entre clubes; sem mensagem privada; visão do admin da plataforma.
begin;
\ir _lib.sql
\ir _fixtures.sql

\o /dev/null
select t.como_cron();
set local session_replication_role = replica;
update public.profiles set nome = 'Ana Clara Souza', created_at = now() - interval '60 days' where id = t.id('membro_a');
update public.profiles set created_at = now() - interval '60 days'
 where id in (t.id('membro_b'), t.id('lider_a'), t.id('lider_b'), t.id('instrutor_a'));
set local session_replication_role = origin;
select t.mk('admin_com', 'Admin Plataforma', 'diretoria', 'ativo', 'clube_b');
insert into public.platform_admins (user_id, papel) values (t.id('admin_com'), 'operacao');
create function t.recuar(p_min int) returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.comunidade_posts set created_at = created_at - make_interval(mins => p_min);
  update public.comunidade_comentarios set created_at = created_at - make_interval(mins => p_min);
  update public.comunidade_bloqueios set created_at = created_at - make_interval(mins => p_min);
end $$;
create function t.notif(p_chave text) returns bigint language sql security definer set search_path = '' as $$
  select count(*) from public.notificacoes where para_usuario = t.id(p_chave) and tipo = 'comunidade';
$$;
create function t.nome_clube(p_chave text) returns text language sql security definer set search_path = '' as $$
  select nome from public.organizational_units where id = t.id(p_chave);
$$;
create function t.status_post(p_chave text) returns text language sql security definer set search_path = '' as $$
  select status from public.comunidade_posts where id = t.id(p_chave);
$$;
reset role;
\o

-- =============================================================================
--  1. Recurso DESLIGADO por padrão e SOMENTE DA PLATAFORMA: bloqueia tudo
-- =============================================================================
select t.eq('recurso nasce desligado e somente da plataforma',
  (select padrao::text || '|' || somente_plataforma::text from public.recursos_catalogo where chave = 'comunidade'), 'false|true');
select t.como('membro_a');
select t.eq('status explica: recurso desligado', t.txt($q$select public.comunidade_meu_status()->>'motivo'$q$), 'recurso_desligado');
select t.throws('desligado: feed bloqueado', $q$select public.comunidade_feed()$q$, 'não está liberada');
select t.throws('desligado: publicar bloqueado', $q$select public.comunidade_publicar('oi')$q$, 'não está liberada');
select t.como('pais_a');
select t.throws('desligado: responsável não autoriza', format($q$select public.comunidade_autorizar(%L, true)$q$, t.id('membro_a')), 'não está liberada');
select t.como('lider_a');
select t.throws('a diretoria NÃO liga o recurso (é da plataforma)', $q$select public.recurso_definir('comunidade', true)$q$, 'plataforma');
select t.bloqueado('...nem direto na tabela', format($q$insert into public.club_features (club_id, feature, enabled) values (%L, 'comunidade', true)$q$, t.id('clube_a')));
select t.como('admin_com');
select t.ok('a plataforma liga no clube A', t.txt(format($q$select public.admin_recurso_do_clube_definir(%L, 'comunidade', true)::text$q$, t.id('clube_a'))) not like 'ERRO%');
select t.ok('...e no clube B', t.txt(format($q$select public.admin_recurso_do_clube_definir(%L, 'comunidade', true)::text$q$, t.id('clube_b'))) not like 'ERRO%');
reset role;

-- =============================================================================
--  2. anon e acesso direto
-- =============================================================================
select t.eq('anon não executa NENHUMA função da comunidade',
  (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname ~ 'comunidade'
     and has_function_privilege('anon', p.oid, 'execute')), 0::bigint);
select t.eq('anon/authenticated sem privilégio em NENHUMA tabela da comunidade',
  (select count(*) from information_schema.role_table_grants where table_schema = 'public' and table_name like 'comunidade%'
     and grantee in ('anon', 'authenticated', 'PUBLIC')), 0::bigint);
select t.eq('todas as tabelas da comunidade com RLS ligado',
  (select count(*) from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and c.relname like 'comunidade%' and not c.relrowsecurity), 0::bigint);
select t.eq('toda função da comunidade security definer tem search_path vazio',
  (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname ~ 'comunidade' and p.prosecdef
     and not (coalesce(p.proconfig, '{}') @> array['search_path=""'])), 0::bigint);
select t.eq('SEM mensagem privada: não existe tabela nem função de conversa na comunidade',
  (select count(*) from pg_class c where c.relnamespace = 'public'::regnamespace and c.relname ~ '^comunidade_.*(mensag|conversa|privad|direct|dm)')
  + (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname ~ '^comunidade_.*(mensag|conversa|privad|direct)'), 0::bigint);
select t.como_anon();
select t.throws('anon não abre o feed', $q$select public.comunidade_feed()$q$);
select t.como('lider_a');
select t.bloqueado('liderança não lê posts direto por REST', $q$select * from public.comunidade_posts$q$);
select t.bloqueado('liderança não lê denúncias direto por REST', $q$select * from public.comunidade_denuncias$q$);
reset role;
-- migration 472 (rede DBV, armazenamento mínimo): o bucket passou a aceitar WebP e o limite CAIU de 3 MB para
-- 300 KB. A trava ficou MAIS forte: continua privado, só imagem comprimida (JPEG/WebP), e bem menor.
select t.eq('bucket "comunidade" é PRIVADO, só JPEG/WebP, até 300 KB',
  (select count(*) from storage.buckets where id = 'comunidade' and not public
      and allowed_mime_types <@ array['image/jpeg', 'image/webp'] and file_size_limit <= 307200), 1::bigint);

-- =============================================================================
--  3. Autorização dos pais
-- =============================================================================
-- desde a 491 (29/09/2026) a criança entra LIBERADA (a autorização dos pais é a do papel, na admissão);
-- o bloqueio agora é o responsável DESLIGAR — é isso que as verificações abaixo passam a provar.
reset role;
do $$ begin
  set local session_replication_role = replica;  -- vínculo direto, como os fixtures fazem
  insert into public.responsaveis (responsavel_id, desbravador_id, nome_digitado, status, club_id)
  values (t.id('pais_a'), t.id('membro_a2'), 'Membro A2', 'aprovado', t.id('clube_a'));
  set local session_replication_role = origin;
end $$;
select t.como('pais_a');
select public.comunidade_autorizar(t.id('membro_a'), false);
select public.comunidade_autorizar(t.id('membro_a2'), false);  -- a "criança sem autorização" das seções seguintes
select t.como('membro_a');
select t.eq('responsável desligou: não vê', t.txt($q$select public.comunidade_meu_status()->>'motivo'$q$), 'sem_autorizacao');
select t.throws('responsável desligou: não publica', $q$select public.comunidade_publicar('oi')$q$, 'responsável');
select t.como('pais_b');
select t.throws('responsável de OUTRA criança não autoriza', format($q$select public.comunidade_autorizar(%L, true)$q$, t.id('membro_a')), 'responsável vinculado');
select t.como('membro_a2');
select t.throws('a própria criança não se autoriza', format($q$select public.comunidade_autorizar(%L, true)$q$, t.id('membro_a2')), 'responsável vinculado');
select t.como('pais_a');
-- 2 = membro_a + membro_a2 (vinculado no início desta seção para provar o "responsável desligou", regra da 491)
select t.eq('o responsável vê os filhos na lista', t.n($q$select jsonb_array_length(public.comunidade_autorizacoes_dos_filhos()->'filhos')$q$), 2::bigint);
select t.eq('responsável autoriza', t.txt(format($q$select public.comunidade_autorizar(%L, true)->>'autorizado'$q$, t.id('membro_a'))), 'true');
select t.como('pais_b');
select public.comunidade_autorizar(t.id('membro_b'), true);
select t.como('membro_a2');
select t.throws('criança SEM responsável vinculado continua sem acesso', $q$select public.comunidade_feed()$q$, 'responsável');
reset role;
select t.eq('autorização auditada', (select count(*) from public.comunidade_moderacao_log where acao = 'autorizacao_concedida' and via = 'responsavel'), 2::bigint);

-- =============================================================================
--  4. Publicar, perfil público mínimo, curtir, comentar, repost
-- =============================================================================
select t.como('membro_a');
select t.eq('com autorização publica', t.txt($q$select public.comunidade_publicar('Nosso acampamento foi incrível!')->>'status'$q$), 'publicado');
reset role;
insert into t.ids (chave, id) select 'post_a', id from public.comunidade_posts where autor_id = t.id('membro_a');
-- 515 (AJUSTE DE REGRA, D1/D2): o que a criança publica nasce 'clube' e só o próprio clube vê. Para continuar provando aqui as
-- regras entre clubes (curtir, repost, denúncia, foto, isolamento), o post é levado à 'comunidade' como FIXTURE (direto no banco):
-- pelas RPCs um desbravador não publica na Comunidade (provado no teste 122).
update public.comunidade_posts set alcance = 'comunidade' where id = t.id('post_a');
select t.como('membro_b');
select t.eq('membro de OUTRO clube vê no feed', t.n($q$select jsonb_array_length(public.comunidade_feed()->'itens')$q$), 1::bigint);
-- MUDANÇA DE REGRA (migration 470, decisão do dono para a rede DBV): o perfil público passou de "só o primeiro
-- nome" para NOME + SOBRENOME (as duas primeiras palavras do nome). O que continua proibido: o nome completo
-- (a 3ª palavra em diante), nascimento e e-mail.
select t.eq('perfil público = nome + sobrenome (duas primeiras palavras)', t.txt($q$select public.comunidade_feed()->'itens'->0->'autor'->>'nome'$q$), 'Ana C.');   -- 515 (D4/menores): criança vista de outro clube = 1º nome + inicial
select t.eq('...+ nome do clube', t.txt($q$select public.comunidade_feed()->'itens'->0->'autor'->>'clube'$q$), t.nome_clube('clube_a'));
select t.ok('...e NUNCA o nome completo, nascimento ou e-mail', t.txt($q$select public.comunidade_feed()::text$q$) !~ '(Souza|2014|teste\.local|nascimento|email)');
select t.eq('curtir', t.txt(format($q$select public.comunidade_curtir(%L, true)->>'curtidas'$q$, t.id('post_a'))), '1');
select t.eq('curtir de novo não duplica', t.txt(format($q$select public.comunidade_curtir(%L, true)->>'curtidas'$q$, t.id('post_a'))), '1');
-- 515 (G4): antes "criança de outro clube comenta" = true; agora desbravador só comenta no PRÓPRIO clube.
select t.throws('criança de outro clube NÃO comenta (só curte)', format($q$select public.comunidade_comentar(%L, 'Que legal!')$q$, t.id('post_a')), 'seu clube');
select t.eq('compartilhar DENTRO do app (repost)', t.txt(format($q$select public.comunidade_publicar(null, null, %L)->>'ok'$q$, t.id('post_a'))), 'true');
-- 515: o "comentário de B" que as seções seguintes denunciam agora é num post do PRÓPRIO clube B (G4)
select public.comunidade_publicar('Nossa unidade B está pronta!');
reset role;
insert into t.ids (chave, id) select 'repost_b', id from public.comunidade_posts where autor_id = t.id('membro_b') and repost_de is not null;
insert into t.ids (chave, id) select 'post_b', id from public.comunidade_posts where autor_id = t.id('membro_b') and repost_de is null;
update public.comunidade_posts set alcance = 'comunidade' where id = t.id('post_b');   -- fixture (ver acima)
select t.como('membro_b');
select t.eq('criança comenta no post do PRÓPRIO clube', t.txt(format($q$select public.comunidade_comentar(%L, 'Que legal!')->>'ok'$q$, t.id('post_b'))), 'true');
reset role;
select t.como('lider_b');
select t.throws('adulto de OUTRO clube NÃO comenta em post de criança', format($q$select public.comunidade_comentar(%L, 'Parabéns!')$q$, t.id('post_a')), 'Adultos de outro clube');
select t.eq('...mas pode curtir', t.txt(format($q$select public.comunidade_curtir(%L, true)->>'curtidas'$q$, t.id('post_a'))), '2');
select t.eq('repost de repost aponta para o ORIGINAL', t.txt(format($q$select public.comunidade_publicar(null, null, %L)->'post'->'repost'->>'id'$q$, t.id('repost_b'))), t.id('post_a')::text);
select t.como('lider_a');
select t.eq('adulto do MESMO clube comenta no post da criança', t.txt(format($q$select public.comunidade_comentar(%L, 'Orgulho!')->>'ok'$q$, t.id('post_a'))), 'true');
select t.como('pais_a');
select t.ok('responsável acompanha o feed', t.n($q$select jsonb_array_length(public.comunidade_feed()->'itens')$q$) >= 1);
select t.throws('responsável NÃO publica', $q$select public.comunidade_publicar('oi')$q$, 'não publicam');
select t.throws('responsável NÃO comenta', format($q$select public.comunidade_comentar(%L, 'oi')$q$, t.id('post_a')), 'não publicam');
select t.como('membro_b');
select t.eq('comentários listados com primeiro nome', t.n(format($q$select jsonb_array_length(public.comunidade_comentarios(%L)->'itens')$q$, t.id('post_a'))), 1::bigint);   -- 515: era 2 (a criança de B comentava)
reset role;

-- =============================================================================
--  5. Denúncia: some NA HORA para todos e a diretoria do clube de quem publicou é avisada
-- =============================================================================
select t.eq('diretoria A ainda sem aviso de denúncia', t.notif('lider_a'), 0::bigint);
select t.como('membro_a');
select t.throws('não denuncia o próprio conteúdo', format($q$select public.comunidade_denunciar('post', %L, 'ofensivo')$q$, t.id('post_a')), 'mesmo');
select t.como('membro_b');
select t.eq('denúncia esconde na hora', t.txt(format($q$select public.comunidade_denunciar('post', %L, 'ofensivo')->>'ocultou'$q$, t.id('post_a'))), 'true');
reset role;
select t.eq('post fica oculto_denuncia', t.status_post('post_a'), 'oculto_denuncia');
select t.ok('diretoria do clube de quem publicou (A) foi notificada', t.notif('lider_a') >= 1);
select t.eq('diretoria do clube de quem DENUNCIOU (B) não', t.notif('lider_b'), 0::bigint);
select t.eq('ocultação registrada pelo sistema', (select count(*) from public.comunidade_moderacao_log where alvo_id = t.id('post_a') and acao = 'ocultado_por_denuncia' and via = 'sistema'), 1::bigint);
select t.como('lider_b');
select t.eq('sumiu para TODOS (outro clube)', t.n(format($q$select count(*) from jsonb_array_elements(public.comunidade_feed()->'itens') e where e->>'id' = %L$q$, t.id('post_a'))), 0::bigint);
-- 515: o repost é do alcance 'clube' (B); aparece no "Meu clube", não no feed da Comunidade
select t.eq('o repost mostra "indisponível"', t.txt($q$select (e->'repost'->>'indisponivel') from jsonb_array_elements(public.rede_feed('meu_clube')->'itens') e where e->'repost' is not null limit 1$q$), 'true');
select t.throws('ninguém comenta no oculto', format($q$select public.comunidade_comentar(%L, 'oi')$q$, t.id('post_a')), 'não está disponível');
select t.throws('fila: diretoria de OUTRO clube não modera', format($q$select public.comunidade_moderar('post', %L, 'restaurar')$q$, t.id('post_a')), 'não encontrado');
select t.eq('...e não vê a denúncia na fila dela', t.n($q$select jsonb_array_length(public.comunidade_fila_moderacao()->'denuncias')$q$), 0::bigint);
select t.como('instrutor_a');
select t.throws('instrutor não modera (só diretoria)', $q$select public.comunidade_fila_moderacao()$q$, 'diretoria');
select t.como('lider_a');
select t.eq('diretoria A vê a denúncia na fila', t.n($q$select jsonb_array_length(public.comunidade_fila_moderacao()->'denuncias')$q$), 1::bigint);
select t.ok('...SEM saber quem denunciou', position(t.id('membro_b')::text in t.txt($q$select public.comunidade_fila_moderacao()::text$q$)) = 0);
select t.eq('diretoria RESTAURA', t.txt(format($q$select public.comunidade_moderar('post', %L, 'restaurar', 'Não era ofensivo')->>'status'$q$, t.id('post_a'))), 'publicado');
reset role;
select t.eq('denúncia ficou improcedente', (select resultado from public.comunidade_denuncias where alvo_id = t.id('post_a')), 'improcedente');
select t.eq('auditoria: quem restaurou', (select count(*) from public.comunidade_moderacao_log where alvo_id = t.id('post_a') and acao = 'restaurar' and por = t.id('lider_a') and via = 'diretoria'), 1::bigint);
select t.throws('histórico da moderação é imutável', $q$update public.comunidade_moderacao_log set motivo = 'x'$q$, 'não se altera');

-- denúncia de COMENTÁRIO: vai para a diretoria do clube de quem comentou
reset role;
insert into t.ids (chave, id) select 'coment_b', id from public.comunidade_comentarios where autor_id = t.id('membro_b');
select t.como('membro_a');
select t.eq('denunciar comentário esconde', t.txt(format($q$select public.comunidade_denunciar('comentario', %L, 'ofensivo')->>'ocultou'$q$, t.id('coment_b'))), 'true');
select t.como('lider_b');
select t.eq('...e cai na fila do clube de quem COMENTOU (B)', t.n($q$select jsonb_array_length(public.comunidade_fila_moderacao()->'denuncias')$q$), 1::bigint);
select t.eq('diretoria B remove o comentário de vez', t.txt(format($q$select public.comunidade_moderar('comentario', %L, 'remover')->>'status'$q$, t.id('coment_b'))), 'removido');
reset role;
select t.eq('remover deu um AVISO ao autor', (select count(*) from public.comunidade_avisos where usuario_id = t.id('membro_b') and origem = 'conteudo_removido'), 1::bigint);

-- =============================================================================
--  6. Denúncia abusiva: quem denuncia demais sem procedência perde o poder de esconder
-- =============================================================================
insert into public.comunidade_denuncias (club_id, alvo_tipo, alvo_id, denunciante_id, motivo, resultado, created_at)
select t.id('clube_a'), 'post', gen_random_uuid(), t.id('membro_b'), 'outro', 'improcedente', now() - interval '1 day'
  from generate_series(1, 2);
select t.como('lider_a');
select public.rede_publicar('aviso', 'Reunião ótima hoje', null, null, null, null, 'comunidade');   -- 515: a diretoria publica na Comunidade
reset role;
insert into t.ids (chave, id) select 'post_lider_a', id from public.comunidade_posts where autor_id = t.id('lider_a');
select t.como('membro_b');
select t.eq('denunciante com 3 improcedentes NÃO esconde na hora', t.txt(format($q$select public.comunidade_denunciar('post', %L, 'outro')->>'ocultou'$q$, t.id('post_lider_a'))), 'false');
reset role;
select t.eq('...o conteúdo continua no ar', t.status_post('post_lider_a'), 'publicado');
select t.eq('...mas a denúncia entra na fila da diretoria', (select count(*) from public.comunidade_denuncias where alvo_id = t.id('post_lider_a') and resultado = 'pendente'), 1::bigint);

-- =============================================================================
--  7. Três avisos = suspensão temporária + diretoria avisada
-- =============================================================================
select t.recuar(5);
select t.como('membro_b');
select public.comunidade_publicar('que merda');                 -- aviso 2 (o 1º foi a remoção)
reset role; select t.recuar(5); select t.como('membro_b');
select t.eq('3º aviso suspende', t.txt($q$select public.comunidade_publicar('seu otario')->>'suspenso'$q$), 'true');
select t.throws('suspenso não publica', $q$select public.comunidade_publicar('oi gente')$q$, 'pausada');
select t.throws('suspenso não comenta', format($q$select public.comunidade_comentar(%L, 'oi')$q$, t.id('post_a')), 'pausada');
select t.eq('suspenso ainda pode olhar o feed', t.txt($q$select (public.comunidade_feed() ? 'itens')::text$q$), 'true');
select t.eq('status: não pode publicar', t.txt($q$select public.comunidade_meu_status()->>'pode_publicar'$q$), 'false');
reset role;
select t.ok('diretoria B foi avisada da suspensão', (select count(*) from public.notificacoes where para_usuario = t.id('lider_b') and titulo like '%pausada%') = 1);
select t.como('lider_b');
select t.eq('diretoria vê o suspenso na fila', t.n($q$select jsonb_array_length(public.comunidade_fila_moderacao()->'suspensos')$q$), 1::bigint);
select t.como('lider_a');
select t.throws('diretoria de OUTRO clube não encerra', format($q$select public.comunidade_encerrar_suspensao(%L)$q$, t.id('membro_b')), 'Não há suspensão');
select t.como('lider_b');
select t.eq('diretoria do clube encerra antes do prazo', t.txt(format($q$select public.comunidade_encerrar_suspensao(%L)->>'ok'$q$, t.id('membro_b'))), 'true');
reset role; select t.recuar(5);
select t.como('membro_b');
select t.eq('volta a publicar', t.txt($q$select public.comunidade_publicar('Voltei, com respeito!')->>'ok'$q$), 'true');
reset role;

-- =============================================================================
--  8. Limites por minuto/dia e conta nova em observação
-- =============================================================================
select t.recuar(5);
select t.como('lider_a');
select t.eq('1º post do minuto', t.txt($q$select public.comunidade_publicar('um')->>'ok'$q$), 'true');
select t.eq('2º post do minuto', t.txt($q$select public.comunidade_publicar('dois')->>'ok'$q$), 'true');
select t.eq('3º no mesmo minuto: limite', t.txt($q$select public.comunidade_publicar('tres')->>'motivo'$q$), 'limite');
reset role;
select t.recuar(120);
insert into public.comunidade_posts (club_id, autor_id, autor_papel, legenda, status, created_at)
select t.id('clube_a'), t.id('lider_a'), 'diretoria', 'lote ' || g, 'publicado', now() - interval '3 hours' from generate_series(1, 10) g;
select t.como('lider_a');
select t.ok('limite por DIA', t.txt($q$select public.comunidade_publicar('mais um')->>'mensagem'$q$) like '%limite de hoje%');
reset role;
set local session_replication_role = replica;
update public.profiles set created_at = now() - interval '2 days' where id = t.id('instrutor_a');
set local session_replication_role = origin;
insert into public.comunidade_posts (club_id, autor_id, autor_papel, legenda, status, created_at)
select t.id('clube_a'), t.id('instrutor_a'), 'instrutor', 'novo ' || g, 'publicado', now() - interval '3 hours' from generate_series(1, 3) g;
select t.como('instrutor_a');
select t.eq('conta nova: status em observação', t.txt($q$select public.comunidade_meu_status()->>'em_observacao'$q$), 'true');
select t.ok('conta nova tem limite MENOR (3/dia)', t.txt($q$select public.comunidade_publicar('quarto')->>'mensagem'$q$) like '%primeiros dias%');
select t.eq('comentários: 5 por minuto passam', t.n(format($q$select count(*) from generate_series(1,5) g where (public.comunidade_comentar(%L, 'boa ' || g)->>'ok')::boolean$q$, t.id('post_a'))), 5::bigint);
select t.eq('6º comentário no minuto: limite', t.txt(format($q$select public.comunidade_comentar(%L, 'boa 6')->>'motivo'$q$, t.id('post_a'))), 'limite');
reset role;

-- =============================================================================
--  9. FOTO: entra em análise e só aparece depois da diretoria do clube do autor aprovar
-- =============================================================================
select t.recuar(5);
insert into t.ids values ('foto_b', gen_random_uuid());
insert into t.ids (chave, id) values ('dummy_path', gen_random_uuid());
create temp table caminho as select t.id('clube_b')::text || '/' || t.id('membro_b')::text || '/' || t.id('foto_b')::text || '.jpg' as p;
grant select on caminho to public;
select t.como('membro_a2');
select t.bloqueado('criança SEM autorização não envia foto ao Storage',
  format($q$insert into storage.objects (bucket_id, name, owner) values ('comunidade', %L, auth.uid())$q$,
         t.id('clube_a')::text || '/' || t.id('membro_a2')::text || '/' || t.id('dummy_path')::text || '.jpg'));
select t.como('membro_b');
select t.bloqueado('não envia foto na pasta de OUTRA pessoa',
  format($q$insert into storage.objects (bucket_id, name, owner) values ('comunidade', %L, auth.uid())$q$,
         t.id('clube_b')::text || '/' || t.id('lider_b')::text || '/' || t.id('dummy_path')::text || '.jpg'));
select t.permitido('criança autorizada envia a própria foto', format($q$insert into storage.objects (bucket_id, name, owner) values ('comunidade', %L, auth.uid())$q$, (select p from caminho)));
select t.throws('caminho inventado é recusado', $q$select public.comunidade_publicar('foto', 'x/y/z.jpg')$q$, 'inválida');
-- MUDANÇA DE REGRA (migration 480, decisão do dono de 29/09/2026): foto PUBLICA DIRETO por padrão
-- (rede_foto_exige_aprovacao() = false; a publicação direta e a denúncia estão provadas no teste 108).
-- O caminho "passa pela diretoria" continua existindo e sendo testado AQUI, com a regra ligada só
-- dentro deste teste (rollback no fim) — nenhuma checagem abaixo foi afrouxada.
reset role;
create or replace function public.rede_foto_exige_aprovacao() returns boolean language sql stable set search_path = '' as $f$ select true $f$;
select t.como('membro_b');
select t.eq('foto entra EM ANÁLISE', t.txt(format($q$select public.comunidade_publicar('Nossa unidade!', %L)->>'status'$q$, (select p from caminho))), 'em_analise');
select t.eq('o autor vê a própria foto em análise no feed', t.txt($q$select public.rede_feed('meu_clube')->'itens'->0->>'status'$q$), 'em_analise');   -- 515: Meu clube (o post nasce 'clube')
reset role;
insert into t.ids (chave, id) select 'post_foto', id from public.comunidade_posts where foto_path = (select p from caminho);
update public.comunidade_posts set alcance = 'comunidade' where id = t.id('post_foto');   -- fixture (ver acima)
select t.ok('diretoria B avisada da foto', (select count(*) from public.notificacoes where para_usuario = t.id('lider_b') and titulo like '%Foto aguardando%') = 1);
select t.como('membro_a');
select t.eq('outro clube NÃO vê a foto em análise no feed', t.n(format($q$select count(*) from jsonb_array_elements(public.comunidade_feed()->'itens') e where e->>'id' = %L$q$, t.id('post_foto'))), 0::bigint);
select t.eq('...nem o arquivo no Storage', t.nv(format($q$select count(*) from storage.objects where bucket_id = 'comunidade' and name = %L$q$, (select p from caminho))), 0::bigint);
select t.throws('...nem consegue curtir', format($q$select public.comunidade_curtir(%L, true)$q$, t.id('post_foto')), 'não está disponível');
select t.como('lider_a');
select t.eq('diretoria de OUTRO clube não vê a foto na fila', t.n($q$select jsonb_array_length(public.comunidade_fila_moderacao()->'fotos')$q$), 0::bigint);
select t.throws('...nem aprova', format($q$select public.comunidade_moderar('post', %L, 'aprovar_foto')$q$, t.id('post_foto')), 'não encontrado');
select t.como('lider_b');
select t.eq('diretoria B vê a foto na fila', t.n($q$select jsonb_array_length(public.comunidade_fila_moderacao()->'fotos')$q$), 1::bigint);
select t.eq('...e abre o arquivo para revisar', t.n(format($q$select count(*) from storage.objects where bucket_id = 'comunidade' and name = %L$q$, (select p from caminho))), 1::bigint);
select t.eq('diretoria B aprova', t.txt(format($q$select public.comunidade_moderar('post', %L, 'aprovar_foto')->>'status'$q$, t.id('post_foto'))), 'publicado');
select t.como('membro_a');
select t.eq('aprovada: aparece para outro clube', t.n(format($q$select count(*) from jsonb_array_elements(public.comunidade_feed()->'itens') e where e->>'id' = %L$q$, t.id('post_foto'))), 1::bigint);
select t.eq('...e o arquivo abre (URL assinada passa na policy)', t.n(format($q$select count(*) from storage.objects where bucket_id = 'comunidade' and name = %L$q$, (select p from caminho))), 1::bigint);
select t.como('membro_a2');
select t.eq('criança SEM autorização não abre o arquivo', t.nv(format($q$select count(*) from storage.objects where bucket_id = 'comunidade' and name = %L$q$, (select p from caminho))), 0::bigint);
reset role;
select t.eq('aprovação auditada', (select count(*) from public.comunidade_moderacao_log where alvo_id = t.id('post_foto') and acao = 'aprovar_foto' and por = t.id('lider_b')), 1::bigint);
select t.ok('o autor foi avisado da aprovação', (select count(*) from public.notificacoes where para_usuario = t.id('membro_b') and titulo like '%aprovada%') = 1);

-- =============================================================================
-- 10. Isolamento pelo recurso: clube com a Comunidade desligada sai do feed
-- =============================================================================
select t.como('admin_com');
select public.admin_recurso_do_clube_definir(t.id('clube_b'), 'comunidade', false);
select t.como('membro_a');
select t.eq('posts do clube desligado somem do feed dos outros', t.n(format($q$select count(*) from jsonb_array_elements(public.comunidade_feed()->'itens') e where e->>'clube_id' = %L$q$, t.id('clube_b'))), 0::bigint);
select t.eq('...e a foto dele deixa de abrir', t.nv(format($q$select count(*) from storage.objects where bucket_id = 'comunidade' and name = %L$q$, (select p from caminho))), 0::bigint);
select t.como('membro_b');
select t.throws('quem é do clube desligado não abre o feed', $q$select public.comunidade_feed()$q$, 'não está liberada');
select t.como('admin_com');
select public.admin_recurso_do_clube_definir(t.id('clube_b'), 'comunidade', true);
reset role;

-- =============================================================================
-- 11. Admin da plataforma
-- =============================================================================
select t.como('lider_a');
select t.throws('diretoria não abre o painel da plataforma', $q$select public.admin_comunidade_painel()$q$, 'Sem permissão');
select t.como('admin_com');
select t.ok('painel: fila de TODOS os clubes (denúncia pendente do clube A)', t.n($q$select jsonb_array_length(public.admin_comunidade_painel()->'fila'->'denuncias')$q$) >= 1);
select t.eq('plataforma remove', t.txt(format($q$select public.admin_comunidade_moderar('post', %L, 'remover', 'teste')->>'status'$q$, t.id('post_lider_a'))), 'removido');
reset role;
select t.eq('...auditado no log da comunidade (via plataforma)', (select count(*) from public.comunidade_moderacao_log where alvo_id = t.id('post_lider_a') and via = 'plataforma' and por = t.id('admin_com')), 1::bigint);
select t.eq('...e na auditoria da plataforma', (select count(*) from public.platform_admin_audit where acao = 'comunidade_moderar' and alvo_id = t.id('post_lider_a')), 1::bigint);

-- =============================================================================
-- 12. Apagar o próprio e revogação pelo responsável
-- =============================================================================
select t.como('membro_b');
select t.throws('não apaga o que não é seu', format($q$select public.comunidade_apagar('post', %L)$q$, t.id('post_a')), 'Não foi possível');
select t.como('pais_a');
select t.eq('responsável REVOGA', t.txt(format($q$select public.comunidade_autorizar(%L, false)->>'autorizado'$q$, t.id('membro_a'))), 'false');
reset role;
select t.eq('o que o filho publicou saiu da Comunidade', t.status_post('post_a'), 'retirado');
-- 2 = a revogação do início da seção 3 (regra da 491: o bloqueio é desligar) + esta
select t.eq('revogação auditada', (select count(*) from public.comunidade_moderacao_log where alvo_id = t.id('membro_a') and acao = 'autorizacao_revogada'), 2::bigint);
select t.como('membro_a');
select t.throws('revogado: não abre mais o feed', $q$select public.comunidade_feed()$q$, 'responsável');
select t.como('membro_b');
select t.eq('...e o post dele sumiu para os outros', t.n(format($q$select count(*) from jsonb_array_elements(public.comunidade_feed()->'itens') e where e->>'id' = %L$q$, t.id('post_a'))), 0::bigint);
reset role;

select t.fim();
rollback;
