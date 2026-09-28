-- REDE DBV (migration 470) — perfil público e AUTORIZAÇÃO DE USO DE IMAGEM.
-- Prova: nome + sobrenome no feed (e nunca o nome completo); a foto de perfil só aparece com a
-- autorização de imagem arquivada pela diretoria; o responsável desliga (e o "não" dele vale em
-- qualquer clube); diretoria de OUTRO clube não marca; instrutor não marca; o arquivo da foto de
-- perfil (bucket 'imagens') só abre na rede com autorização; tudo bloqueado com o recurso desligado;
-- anon sem acesso; tabela sem acesso direto.
begin;
\ir _lib.sql
\ir _fixtures.sql

\o /dev/null
select t.como_cron();
set local session_replication_role = replica;
update public.profiles set nome = 'Ana de Souza Lima', foto = 'http://x/storage/v1/object/public/imagens/perfis/' || t.id('membro_a') || '-1.jpg'
 where id = t.id('membro_a');
update public.profiles set nome = 'Bruno Costa Neto' where id = t.id('membro_b');
set local session_replication_role = origin;
select t.mk('admin_rede', 'Admin Plataforma', 'diretoria', 'ativo', 'clube_b');
insert into public.platform_admins (user_id, papel) values (t.id('admin_rede'), 'operacao');
insert into storage.objects (bucket_id, name) values ('imagens', 'perfis/' || t.id('membro_a') || '-1.jpg');
create function t.nome_clube(p_chave text) returns text language sql security definer set search_path = '' as $$
  select nome from public.organizational_units where id = t.id(p_chave);
$$;
create function t.ano_vinculo(p_pessoa text, p_clube text) returns text language sql security definer set search_path = '' as $$
  select extract(year from min(starts_at))::int::text from public.organization_memberships
   where user_id = t.id(p_pessoa) and organizational_unit_id = t.id(p_clube);
$$;
reset role;
\o

-- =============================================================================
--  1. Recurso desligado: tudo da rede bloqueado
-- =============================================================================
select t.como('lider_a');
select t.throws('desligado: diretoria não abre a lista de autorização de imagem', $q$select public.rede_membros_autorizacao_imagem()$q$, 'não está liberada');
select t.throws('desligado: diretoria não marca autorização', format($q$select public.rede_marcar_autorizacao_imagem(%L, true)$q$, t.id('membro_a')), 'não está liberada');
select t.como('membro_a');
select t.throws('desligado: perfil da rede bloqueado', $q$select public.rede_perfil()$q$, 'não está liberada');
select t.como('pais_a');
select t.eq('desligado: o responsável ainda consegue DESLIGAR (dizer não nunca fica bloqueado)',
  t.txt(format($q$select public.rede_responsavel_imagem(%L, true)->>'ok'$q$, t.id('membro_a'))), 'true');

select t.como('admin_rede');
select public.admin_recurso_do_clube_definir(t.id('clube_a'), 'comunidade', true);
select public.admin_recurso_do_clube_definir(t.id('clube_b'), 'comunidade', true);
select t.como('pais_a');
select public.comunidade_autorizar(t.id('membro_a'), true);
select t.como('pais_b');
select public.comunidade_autorizar(t.id('membro_b'), true);
reset role;
-- desde a 491 (29/09/2026) a criança entra LIBERADA (a autorização dos pais é a do papel, na admissão);
-- a "criança sem autorização" destes testes (membro_a2) passa a ser a criança cujo RESPONSÁVEL DESLIGOU.
do $$ begin
  set local session_replication_role = replica;  -- vínculo direto, como os fixtures fazem
  insert into public.responsaveis (responsavel_id, desbravador_id, nome_digitado, status, club_id)
  values (t.id('pais_a'), t.id('membro_a2'), 'Membro A2', 'aprovado', t.id('clube_a'));
  set local session_replication_role = origin;
end $$;
select t.como('pais_a');
select public.comunidade_autorizar(t.id('membro_a2'), false);
reset role;

-- =============================================================================
--  2. anon e acesso direto
-- =============================================================================
select t.eq('anon não executa NENHUMA função da rede',
  (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname ~ '^_?rede_'
     and has_function_privilege('anon', p.oid, 'execute')), 0::bigint);
select t.eq('anon/authenticated sem privilégio em tabela da rede',
  (select count(*) from information_schema.role_table_grants where table_schema = 'public' and table_name like 'rede\_%'
     and grantee in ('anon', 'authenticated', 'PUBLIC')), 0::bigint);
select t.eq('funções security definer da rede com search_path vazio',
  (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname ~ 'rede_' and p.prosecdef
     and not (coalesce(p.proconfig, '{}') @> array['search_path=""'])), 0::bigint);
select t.como_anon();
select t.throws('anon não abre perfil', $q$select public.rede_perfil()$q$);
select t.como('lider_a');
select t.bloqueado('diretoria não lê a tabela de autorização direto', $q$select * from public.rede_autorizacao_imagem$q$);

-- =============================================================================
--  3. Nome + sobrenome no feed
-- =============================================================================
select t.como('membro_a');
select public.comunidade_publicar('Olá, rede!');
select t.como('membro_b');
select t.eq('feed: nome + sobrenome (pula "de")', t.txt($q$select public.rede_feed()->'itens'->0->'autor'->>'nome'$q$), 'Ana Souza');
select t.ok('...nunca o nome completo', t.txt($q$select public.rede_feed()::text$q$) !~ 'Lima');
select t.eq('...com o nome do clube embaixo', t.txt($q$select public.rede_feed()->'itens'->0->'autor'->>'clube'$q$),
  t.nome_clube('clube_a'));
select t.eq('sem autorização de imagem: foto do autor NÃO vem', t.txt($q$select coalesce(public.rede_feed()->'itens'->0->'autor'->>'foto', 'nula')$q$), 'nula');
select t.eq('perfil de outro clube: nome + sobrenome', t.txt(format($q$select public.rede_perfil(%L)->>'nome'$q$, t.id('membro_a'))), 'Ana Souza');
select t.eq('perfil: "desde" = ano do vínculo', t.txt(format($q$select (public.rede_perfil(%L)->>'desde')$q$, t.id('membro_a'))),
  t.ano_vinculo('membro_a', 'clube_a'));
select t.eq('perfil: 1 publicação', t.txt(format($q$select public.rede_perfil(%L)->>'publicacoes'$q$, t.id('membro_a'))), '1');
select t.eq('perfil sem autorização: sem foto', t.txt(format($q$select coalesce(public.rede_perfil(%L)->>'foto', 'nula')$q$, t.id('membro_a'))), 'nula');
select t.eq('...e o ARQUIVO da foto de perfil não abre para outro clube',
  t.nv(format($q$select count(*) from storage.objects where bucket_id = 'imagens' and name = %L$q$, 'perfis/' || t.id('membro_a') || '-1.jpg')), 0::bigint);
select t.como('membro_a2');
select t.throws('criança sem autorização dos pais não vê perfis', format($q$select public.rede_perfil(%L)$q$, t.id('membro_a')), 'responsável');

-- =============================================================================
--  4. Quem marca a autorização de imagem
-- =============================================================================
select t.como('lider_b');
select t.throws('diretoria de OUTRO clube NÃO marca', format($q$select public.rede_marcar_autorizacao_imagem(%L, true)$q$, t.id('membro_a')), 'não é membro ativo');
select t.como('instrutor_a');
select t.throws('instrutor NÃO marca (só diretoria)', format($q$select public.rede_marcar_autorizacao_imagem(%L, true)$q$, t.id('membro_a')), 'diretoria');
select t.como('membro_a');
select t.throws('a própria criança não marca', format($q$select public.rede_marcar_autorizacao_imagem(%L, true)$q$, t.id('membro_a')), 'diretoria');
select t.como('pais_b');
select t.throws('responsável de OUTRA criança não desliga', format($q$select public.rede_responsavel_imagem(%L, true)$q$, t.id('membro_a')), 'responsável vinculado');
select t.como('lider_a');
select t.ok('diretoria A vê o membro na lista', t.n(format($q$select count(*) from jsonb_array_elements(public.rede_membros_autorizacao_imagem()) e where e->>'usuario_id' = %L$q$, t.id('membro_a'))) = 1);
select t.eq('diretoria A marca "arquivada"', t.txt(format($q$select public.rede_marcar_autorizacao_imagem(%L, true)->>'arquivada'$q$, t.id('membro_a'))), 'true');
reset role;
select t.eq('marcação auditada', (select count(*) from public.auditoria_operacoes where operacao = 'rede_autorizacao_imagem' and alvo = t.id('membro_a')), 1::bigint);

-- o responsável tinha desligado na seção 1: continua sem foto até ele religar
select t.como('membro_b');
select t.eq('arquivada, mas o responsável desligou: sem foto', t.txt(format($q$select coalesce(public.rede_perfil(%L)->>'foto', 'nula')$q$, t.id('membro_a'))), 'nula');
select t.como('pais_a');
select t.eq('o responsável religa o que ele mesmo desligou', t.txt(format($q$select public.rede_responsavel_imagem(%L, false)->>'imagem_autorizada'$q$, t.id('membro_a'))), 'true');
select t.eq('o responsável vê o estado na tela Meus filhos', t.txt($q$select public.comunidade_autorizacoes_dos_filhos()->'filhos'->0->>'imagem_autorizada'$q$), 'true');

-- =============================================================================
--  5. Com autorização: foto aparece (feed, perfil e o arquivo)
-- =============================================================================
select t.como('membro_b');
select t.ok('com autorização: foto do autor no feed', t.txt($q$select public.rede_feed()->'itens'->0->'autor'->>'foto'$q$) like '%perfis/%');
select t.ok('...e no perfil', t.txt(format($q$select public.rede_perfil(%L)->>'foto'$q$, t.id('membro_a'))) like '%perfis/%');
select t.eq('...e o ARQUIVO abre para quem está na rede (outro clube)',
  t.n(format($q$select count(*) from storage.objects where bucket_id = 'imagens' and name = %L$q$, 'perfis/' || t.id('membro_a') || '-1.jpg')), 1::bigint);
select t.como('membro_a2');
select t.eq('...mas não para criança sem autorização dos pais',
  t.nv(format($q$select count(*) from storage.objects where bucket_id = 'imagens' and name = %L$q$, 'perfis/' || t.id('membro_a') || '-1.jpg')), 0::bigint);

-- =============================================================================
--  6. O responsável DESLIGA: some na hora
-- =============================================================================
select t.como('pais_a');
select t.eq('responsável desliga', t.txt(format($q$select public.rede_responsavel_imagem(%L, true)->>'imagem_autorizada'$q$, t.id('membro_a'))), 'false');
select t.como('membro_b');
select t.eq('desligado: foto some do feed', t.txt($q$select coalesce(public.rede_feed()->'itens'->0->'autor'->>'foto', 'nula')$q$), 'nula');
select t.eq('...e o arquivo deixa de abrir',
  t.nv(format($q$select count(*) from storage.objects where bucket_id = 'imagens' and name = %L$q$, 'perfis/' || t.id('membro_a') || '-1.jpg')), 0::bigint);
select t.como('lider_a');
select public.rede_marcar_autorizacao_imagem(t.id('membro_a'), true);
select t.como('membro_b');
select t.eq('a diretoria remarcar NÃO passa por cima do "não" do responsável',
  t.txt(format($q$select coalesce(public.rede_perfil(%L)->>'foto', 'nula')$q$, t.id('membro_a'))), 'nula');

-- =============================================================================
--  7. Recurso desligado de novo: perfil e feed bloqueados
-- =============================================================================
select t.como('admin_rede');
select public.admin_recurso_do_clube_definir(t.id('clube_b'), 'comunidade', false);
select t.como('membro_b');
select t.throws('desligado: rede_feed bloqueado', $q$select public.rede_feed()$q$, 'não está liberada');
select t.throws('desligado: rede_perfil bloqueado', format($q$select public.rede_perfil(%L)$q$, t.id('membro_a')), 'não está liberada');
select t.como('membro_a');
select t.throws('perfil de quem está num clube com a rede desligada fica indisponível', format($q$select public.rede_perfil(%L)$q$, t.id('membro_b')), 'não está disponível');
reset role;

select t.fim();
rollback;
