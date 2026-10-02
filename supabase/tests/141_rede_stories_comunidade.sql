-- REDE DBV (migration 535) — STORIES PARA TODOS NA COMUNIDADE, SEM MÓDULO DE AMIGOS.
-- Regra (decisão do dono, 02/10/2026): qualquer participante elegível publica story com alcance 'comunidade'
-- (todos os clubes da Rede veem por 24 h), sem aprovação prévia; moderação posterior por denúncia.
-- Prova: alcance clube x comunidade; a chamada ANTIGA (sem alcance) fica idêntica (publica 'clube', lista só o
-- próprio clube); outro clube elegível vê o alcance comunidade e NÃO vê o alcance clube (fileira, visto, denúncia,
-- arquivo do bucket privado); sem vínculo / pendente / inativo / recurso desligado / criança com a autorização
-- desligada / responsável / anon: não veem nem publicam; expirado, apagado e removido somem (fileira e arquivo) e
-- entram na fila de apagar; denúncia de outro clube esconde na hora e avisa a diretoria do clube DO AUTOR; só essa
-- diretoria e a plataforma moderam (diretoria de outro clube: negado); só o autor apaga; UUID forjado não é oráculo;
-- menor visto de fora chega com nome reduzido e sem unidade; não existe tabela/RPC de amizade/seguir.
begin;
\ir _lib.sql
\ir _fixtures.sql

\o /dev/null
select t.como_cron();
insert into public.organizational_units (type, nome, slug, pais, timezone, metadata)
values ('clube', 'Clube C (teste, rede desligada)', 'clube-c-teste-141', 'BR', 'America/Recife', '{"test_only":true}');
insert into t.ids (chave, id) select 'clube_c', id from public.organizational_units where slug = 'clube-c-teste-141';
insert into public.club_features (club_id, feature, enabled)
values (t.id('clube_a'), 'comunidade', true), (t.id('clube_b'), 'comunidade', true), (t.id('clube_c'), 'comunidade', false)
on conflict (club_id, feature) do update set enabled = excluded.enabled;
select t.mk('leitor_b', 'Leitor B', 'conselheiro', 'ativo', 'clube_b', 'B1', date '1990-07-07');
select t.mk('pend_b', 'Pendente B', 'desbravador', 'pendente', 'clube_b', 'B1', date '2014-07-07');
select t.mk('inat_b', 'Inativo B', 'conselheiro', 'ativo', 'clube_b', null, date '1990-07-07');
select t.mk('membro_c', 'Membro C', 'conselheiro', 'ativo', 'clube_c', null, date '1990-07-07');
select t.signup('sem_vinculo', '{"tipo":"desbravador","nome":"Sem Vinculo"}'::jsonb);
select t.signup('admin_141', '{"tipo":"fundador","nome":"Admin Cento Quarenta Um"}'::jsonb);
insert into public.platform_admins (user_id, papel) values (t.id('admin_141'), 'operacao');
set local session_replication_role = replica;
update public.profiles set created_at = now() - interval '60 days';
-- membro_a2: criança cujo responsável DESLIGOU a Rede (desde a 491 a criança entra liberada)
insert into public.responsaveis (responsavel_id, desbravador_id, nome_digitado, status, club_id)
values (t.id('pais_a'), t.id('membro_a2'), 'Membro A2', 'aprovado', t.id('clube_a'));
update public.organization_memberships set status = 'suspenso' where user_id = t.id('inat_b');
set local session_replication_role = origin;

create function t.recuar(p_min int) returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.rede_stories set created_at = created_at - make_interval(mins => p_min);
  update public.comunidade_bloqueios set created_at = created_at - make_interval(mins => p_min);
end $$;
insert into t.ids select 'f' || i, gen_random_uuid() from generate_series(1, 14) i;
create function t.cam(p_clube text, p_pessoa text, p_foto text) returns text language sql as $$
  select t.id(p_clube)::text || '/' || t.id(p_pessoa)::text || '/' || t.id(p_foto)::text || '.webp';
$$;
create function t.obj(p_path text) returns void language sql security definer set search_path = '' as $$
  insert into storage.objects (bucket_id, name, metadata) values ('comunidade', p_path, '{"size": 120000, "mimetype": "image/webp"}');
$$;
-- guarda o id do story pelo caminho da foto (roda como dono: a tabela não tem grant)
create function t.guardar(p_chave text, p_path text) returns void language sql security definer set search_path = '' as $$
  insert into t.ids (chave, id) select p_chave, id from public.rede_stories where foto_path = p_path;
$$;
create function t.campo(p_chave text, p_col text) returns text language plpgsql security definer set search_path = '' as $$
declare v text;
begin
  execute format('select %I::text from public.rede_stories where id = $1', p_col) into v using t.id(p_chave);
  return v;
end $$;
create function t.nome_clube(p_chave text) returns text language sql security definer set search_path = '' as $$
  select nome from public.organizational_units where id = t.id(p_chave);
$$;
-- quantas vezes o story aparece na fileira pedida (null = chamada ANTIGA, sem argumento); -1 se a RPC recusar
create function t.ve(p_alcance text, p_chave text) returns bigint language plpgsql as $$
begin
  if p_alcance is null then
    return t.n(format($q$select count(*) from jsonb_array_elements(public.rede_stories()) g, jsonb_array_elements(g->'stories') e where e->>'id' = %L$q$, t.id(p_chave)));
  end if;
  return t.n(format($q$select count(*) from jsonb_array_elements(public.rede_stories(%L)) g, jsonb_array_elements(g->'stories') e where e->>'id' = %L$q$, p_alcance, t.id(p_chave)));
end $$;
-- o arquivo abre? (policy de SELECT do bucket privado = o que decide a URL assinada)
create function t.arq(p_path text) returns bigint language plpgsql as $$
begin
  return t.nv(format($q$select count(*) from storage.objects where bucket_id = 'comunidade' and name = %L$q$, p_path));
end $$;
grant usage on schema t to public;
select t.obj(t.cam('clube_a', 'membro_a', 'f1')), t.obj(t.cam('clube_a', 'membro_a', 'f2')), t.obj(t.cam('clube_a', 'membro_a', 'f9')),
       t.obj(t.cam('clube_a', 'conselheiro_a', 'f3')), t.obj(t.cam('clube_a', 'conselheiro_a', 'f4')),
       t.obj(t.cam('clube_b', 'membro_b', 'f5')), t.obj(t.cam('clube_a', 'membro_a2', 'f6')), t.obj(t.cam('clube_a', 'pais_a', 'f7')),
       t.obj(t.cam('clube_c', 'membro_c', 'f8')), t.obj(t.cam('clube_b', 'pend_b', 'f10')), t.obj(t.cam('clube_b', 'inat_b', 'f11')),
       t.obj(t.cam('clube_a', 'lider_a', 'f12')), t.obj(t.cam('clube_a', 'conselheiro_a', 'f13')), t.obj(t.cam('clube_b', 'membro_b', 'f14'));
select t.como('pais_a');
select public.comunidade_autorizar(t.id('membro_a2'), false);
reset role;
\o

-- =============================================================================
--  1. Estrutura: alcance, assinaturas sem overload, grants, anon, SEM módulo de amigos
-- =============================================================================
select t.throws('alcance inventado é recusado pelo banco', format($q$insert into public.rede_stories (club_id, autor_id, autor_papel, foto_path, status, alcance)
  values (%L, %L, 'diretoria', 'x/y/amigos.webp', 'publicado', 'amigos')$q$, t.id('clube_a'), t.id('lider_a')), 'alcance_valido');
select t.eq('a constraint antiga (só clube) saiu', (select count(*) from pg_constraint where conname = 'rede_stories_alcance_so_clube'), 0::bigint);
select t.eq('alcance NOT NULL com padrão clube',
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'rede_stories'
      and column_name = 'alcance' and is_nullable = 'NO' and column_default like '%clube%'), 1::bigint);
select t.eq('UMA só rede_stories e UMA só rede_story_publicar (sem overload ambíguo no PostgREST)',
  (select string_agg(p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')', ' | ' order by p.proname)
     from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('rede_stories', 'rede_story_publicar')),
  'rede_stories(p_alcance text) | rede_story_publicar(p_foto_path text, p_texto text, p_alcance text)');
select t.eq('funções da 535: security definer, search_path vazio',
  (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace
      and p.proname in ('rede_stories', 'rede_story_publicar', '_rede_story_visivel', '_comunidade_pode_ver_foto', '_plataforma_pode_item', 'comunidade_denunciar')
      and p.prosecdef and p.proconfig @> array['search_path=""']), 6::bigint);
select t.eq('anon sem EXECUTE nas RPCs de story',
  (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace
      and p.proname in ('rede_stories', 'rede_story_publicar', 'rede_story_visto', 'rede_story_apagar', 'comunidade_denunciar', '_comunidade_pode_ver_foto')
      and has_function_privilege('anon', p.oid, 'execute')), 0::bigint);
select t.eq('helpers internos sem EXECUTE para authenticated',
  (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace
      and p.proname in ('_rede_story_visivel', '_plataforma_pode_item', '_rede_item_visivel')
      and has_function_privilege('authenticated', p.oid, 'execute')), 0::bigint);
select t.eq('rede_stories continua com RLS ligada, SEM policy e SEM grant (acesso só por RPC)',
  (select count(*) from pg_class c where c.oid = 'public.rede_stories'::regclass and c.relrowsecurity
      and not exists (select 1 from pg_policy pol where pol.polrelid = c.oid)
      and not exists (select 1 from information_schema.role_table_grants g where g.table_schema = 'public' and g.table_name = 'rede_stories'
                        and g.grantee in ('anon', 'authenticated', 'PUBLIC'))), 1::bigint);
-- REGRA: "Stories para todos na Comunidade sem módulo de amigos"
select t.eq('Stories para todos na Comunidade SEM módulo de amigos: não existe tabela de amizade/seguir',
  (select coalesce(string_agg(c.relname, ', '), '') from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'v', 'm')
      and c.relname ~* '(amig|amizade|seguidor|seguindo|seguir|follow|friend)'), '');
select t.eq('...nem RPC de amizade/seguir',
  (select coalesce(string_agg(p.proname, ', '), '') from pg_proc p where p.pronamespace = 'public'::regnamespace
      and p.proname ~* '(amig|amizade|seguidor|seguindo|seguir|follow|friend)'), '');
select t.eq('...e rede_stories não tem coluna de público restrito (lista de pessoas)',
  (select coalesce(string_agg(column_name, ', '), '') from information_schema.columns where table_schema = 'public' and table_name = 'rede_stories'
      and column_name ~* '(amig|seguid|destinat|publico|audien)'), '');
select t.como_anon();
select t.throws('anon não vê a fileira (chamada antiga)', $q$select public.rede_stories()$q$);
select t.throws('anon não vê a fileira da Comunidade', $q$select public.rede_stories('comunidade')$q$);
select t.throws('anon não publica story na Comunidade', $q$select public.rede_story_publicar('x', null, 'comunidade')$q$);
select t.throws('anon não denuncia', $q$select public.comunidade_denunciar('story', gen_random_uuid(), 'outro')$q$);
select t.throws('anon não apaga', $q$select public.rede_story_apagar(gen_random_uuid())$q$);
reset role;

-- =============================================================================
--  2. Publicar: clube x comunidade; a chamada antiga continua 'clube'; sem aprovação
-- =============================================================================
select t.como('membro_a');
select t.eq('chamada ANTIGA (2 argumentos) publica direto', t.txt(format($q$select public.rede_story_publicar(%L, 'Só do clube')->>'status'$q$, t.cam('clube_a', 'membro_a', 'f1'))), 'publicado');
select t.throws('alcance inventado é recusado pela RPC', format($q$select public.rede_story_publicar(%L, null, 'amigos')$q$, t.cam('clube_a', 'membro_a', 'f2')), 'Alcance inválido');
select t.eq('CRIANÇA (com a autorização dos pais) publica na Comunidade SEM aprovação: nasce publicado',
  t.txt(format($q$select (r->>'status') || '|' || (r->>'alcance') from (select public.rede_story_publicar(%L, 'Para todos', 'comunidade') r) x$q$, t.cam('clube_a', 'membro_a', 'f2'))), 'publicado|comunidade');
select t.eq('o limite por minuto soma os dois alcances', t.txt(format($q$select public.rede_story_publicar(%L, null, 'comunidade')->>'motivo'$q$, t.cam('clube_a', 'membro_a', 'f9'))), 'limite');
reset role;
select t.guardar('k1', t.cam('clube_a', 'membro_a', 'f1'));
select t.guardar('m1', t.cam('clube_a', 'membro_a', 'f2'));
select t.eq('story da chamada antiga nasce com alcance clube', t.campo('k1', 'alcance'), 'clube');
select t.eq('story novo nasce com alcance comunidade', t.campo('m1', 'alcance'), 'comunidade');
select t.ok('alcance comunidade: as MESMAS 24 h', (select expira_em between now() + interval '23 hours 59 minutes' and now() + interval '24 hours 1 minute' from public.rede_stories where id = t.id('m1')));
select t.eq('nenhum aviso de "aguardando aprovação" (não há aprovação prévia)', (select count(*) from public.notificacoes where titulo like '%aguardando%'), 0::bigint);
select t.eq('nada na fila de fotos em análise', (select count(*) from public.rede_stories where status = 'em_analise'), 0::bigint);
select t.recuar(5);
select t.como('membro_a');
select t.throws('a mesma foto não vira dois stories (idempotência do envio repetido)', format($q$select public.rede_story_publicar(%L, null, 'comunidade')$q$, t.cam('clube_a', 'membro_a', 'f2')), 'já foi usada');
select t.como('conselheiro_a');
select t.eq('adulto sem cargo de gestão (conselheiro) também publica na Comunidade', t.txt(format($q$select public.rede_story_publicar(%L, 'Acampamento', 'comunidade')->>'status'$q$, t.cam('clube_a', 'conselheiro_a', 'f3'))), 'publicado');
select t.eq('...e p_alcance ''clube'' explícito = clube', t.txt(format($q$select public.rede_story_publicar(%L, null, 'clube')->>'alcance'$q$, t.cam('clube_a', 'conselheiro_a', 'f4'))), 'clube');
select t.como('membro_b');
select t.eq('criança do clube B publica na Comunidade', t.txt(format($q$select public.rede_story_publicar(%L, 'Do B', 'comunidade')->>'status'$q$, t.cam('clube_b', 'membro_b', 'f5'))), 'publicado');
select t.throws('não publica com a foto de OUTRA pessoa/clube', format($q$select public.rede_story_publicar(%L, null, 'comunidade')$q$, t.cam('clube_a', 'lider_a', 'f12')), 'inválida');
select t.eq('texto do story da Comunidade passa pela MESMA triagem', t.txt(format($q$select public.rede_story_publicar(%L, 'me chama no zap', 'comunidade')->>'motivo'$q$, t.cam('clube_b', 'membro_b', 'f14'))), 'contato');
reset role;
select t.guardar('c1', t.cam('clube_a', 'conselheiro_a', 'f3'));
select t.guardar('c2', t.cam('clube_a', 'conselheiro_a', 'f4'));
select t.guardar('b1', t.cam('clube_b', 'membro_b', 'f5'));

-- quem NÃO publica
select t.como('membro_a2');
select t.throws('criança com a autorização dos pais DESLIGADA não publica na Comunidade', format($q$select public.rede_story_publicar(%L, null, 'comunidade')$q$, t.cam('clube_a', 'membro_a2', 'f6')), 'autorizar');
select t.como('pais_a');
select t.throws('responsável não publica', format($q$select public.rede_story_publicar(%L, null, 'comunidade')$q$, t.cam('clube_a', 'pais_a', 'f7')), 'não publicam');
select t.como('membro_c');
select t.throws('clube com o recurso DESLIGADO não publica', format($q$select public.rede_story_publicar(%L, null, 'comunidade')$q$, t.cam('clube_c', 'membro_c', 'f8')), 'não está liberada');
select t.como('pend_b');
select t.throws('vínculo PENDENTE não publica', format($q$select public.rede_story_publicar(%L, null, 'comunidade')$q$, t.cam('clube_b', 'pend_b', 'f10')));
select t.como('inat_b');
select t.throws('vínculo INATIVO não publica', format($q$select public.rede_story_publicar(%L, null, 'comunidade')$q$, t.cam('clube_b', 'inat_b', 'f11')));
select t.como('sem_vinculo');
select t.throws('SEM vínculo não publica', $q$select public.rede_story_publicar('x/y/z.webp', null, 'comunidade')$q$);
reset role;
select t.eq('só os 5 stories legítimos existem', (select count(*) from public.rede_stories), 5::bigint);

-- =============================================================================
--  3. Listar por alcance; o default preserva o comportamento antigo
-- =============================================================================
select t.como('leitor_b');   -- adulto do clube B (outro clube, elegível)
select t.eq('B, chamada ANTIGA rede_stories(): NÃO recebe story do clube A (nem os de alcance comunidade)',
  t.n($q$select count(*) from jsonb_array_elements(public.rede_stories()) g where g->'autor'->>'id' <> $q$ || quote_literal(t.id('membro_b')) ), 0::bigint);
select t.eq('...só o do próprio clube', t.ve(null, 'b1'), 1::bigint);
select t.eq('rede_stories() = rede_stories(''clube'') = rede_stories(null)',
  t.txt($q$select (public.rede_stories() = public.rede_stories('clube'))::text || (public.rede_stories() = public.rede_stories(null))::text$q$), 'truetrue');
select t.throws('alcance inválido na fileira', $q$select public.rede_stories('amigos')$q$, 'Alcance inválido');
select t.eq('B vê na Comunidade o story da CRIANÇA do clube A', t.ve('comunidade', 'm1'), 1::bigint);
select t.eq('B vê na Comunidade o story do adulto do clube A', t.ve('comunidade', 'c1'), 1::bigint);
select t.eq('B vê na Comunidade o do próprio clube', t.ve('comunidade', 'b1'), 1::bigint);
select t.eq('B NÃO vê na Comunidade o story de alcance CLUBE da criança do A', t.ve('comunidade', 'k1'), 0::bigint);
select t.eq('B NÃO vê na Comunidade o story de alcance CLUBE do adulto do A', t.ve('comunidade', 'c2'), 0::bigint);
select t.eq('...nem pela aba Meu Clube', t.ve('clube', 'k1') + t.ve('clube', 'c2') + t.ve('clube', 'm1') + t.ve('clube', 'c1'), 0::bigint);
select t.eq('uma chamada traz a faixa inteira: 3 pessoas (uma bolinha por pessoa)', t.n($q$select jsonb_array_length(public.rede_stories('comunidade'))$q$), 3::bigint);
select t.eq('cada story diz o próprio alcance', t.txt($q$select string_agg(distinct e->>'alcance', ',') from jsonb_array_elements(public.rede_stories('comunidade')) g, jsonb_array_elements(g->'stories') e$q$), 'comunidade');
select t.eq('MENOR visto de outro clube: nome reduzido (1º nome + inicial)',
  t.txt(format($q$select g->'autor'->>'nome' from jsonb_array_elements(public.rede_stories('comunidade')) g where g->'autor'->>'id' = %L$q$, t.id('membro_a'))), 'Membro A.');
select t.eq('...sem unidade e sem foto de rosto',
  t.txt(format($q$select coalesce(g->'autor'->>'unidade', '-') || '|' || coalesce(g->'autor'->>'foto', '-') from jsonb_array_elements(public.rede_stories('comunidade')) g where g->'autor'->>'id' = %L$q$, t.id('membro_a'))), '-|-');
select t.ok('...com o nome do clube do autor',
  t.txt(format($q$select g->'autor'->>'clube' from jsonb_array_elements(public.rede_stories('comunidade')) g where g->'autor'->>'id' = %L$q$, t.id('membro_a')))
  = t.nome_clube('clube_a'));
select t.como('membro_b');   -- criança do clube B
select t.eq('criança de outro clube (autorizada) também vê a Comunidade', t.ve('comunidade', 'm1') + t.ve('comunidade', 'c1'), 2::bigint);
select t.eq('...e o dela vem primeiro (meu)', t.txt($q$select public.rede_stories('comunidade')->0->>'meu'$q$), 'true');
select t.como('lider_a');    -- mesmo clube do autor
select t.eq('Meu Clube (A) continua mostrando os stories do clube, inclusive os de alcance comunidade',
  t.ve('clube', 'k1') + t.ve('clube', 'c2') + t.ve('clube', 'm1') + t.ve('clube', 'c1'), 4::bigint);
select t.eq('...e não mostra o do clube B', t.ve('clube', 'b1'), 0::bigint);
select t.eq('Comunidade vista do A: os 3 de alcance comunidade, sem os de alcance clube',
  t.ve('comunidade', 'm1') + t.ve('comunidade', 'c1') + t.ve('comunidade', 'b1') + 10 * (t.ve('comunidade', 'k1') + t.ve('comunidade', 'c2')), 3::bigint);
select t.eq('dentro do clube o menor aparece com o nome normal',
  t.txt(format($q$select g->'autor'->>'nome' from jsonb_array_elements(public.rede_stories('comunidade')) g where g->'autor'->>'id' = %L$q$, t.id('membro_a'))), 'Membro A');

-- quem NÃO vê
select t.como('membro_a2');
select t.throws('criança com a autorização desligada não vê a Comunidade', $q$select public.rede_stories('comunidade')$q$, 'autorizar');
select t.como('membro_c');
select t.throws('clube com o recurso desligado não vê', $q$select public.rede_stories('comunidade')$q$, 'não está liberada');
select t.como('pend_b');
select t.throws('vínculo pendente não vê', $q$select public.rede_stories('comunidade')$q$);
select t.como('inat_b');
select t.throws('vínculo inativo não vê', $q$select public.rede_stories('comunidade')$q$);
select t.como('sem_vinculo');
select t.throws('sem vínculo não vê', $q$select public.rede_stories('comunidade')$q$);
select t.como('pais_b');
select t.eq('responsável (vínculo ativo) acompanha a Comunidade, como já acompanha o feed', t.ve('comunidade', 'c1'), 1::bigint);
select t.bloqueado('ninguém lê rede_stories direto', $q$select * from public.rede_stories$q$);

-- =============================================================================
--  4. Mídia: bucket PRIVADO; o arquivo só abre para quem pode ver o story
-- =============================================================================
select t.eq('o bucket comunidade continua privado', (select count(*) from storage.buckets where id = 'comunidade' and public), 0::bigint);
select t.como('leitor_b');
select t.eq('outro clube elegível abre o arquivo do story de alcance comunidade', t.arq(t.cam('clube_a', 'membro_a', 'f2')), 1::bigint);
select t.eq('...e NÃO abre o arquivo do story de alcance clube', t.arq(t.cam('clube_a', 'membro_a', 'f1')) + t.arq(t.cam('clube_a', 'conselheiro_a', 'f4')), 0::bigint);
select t.eq('...nem arquivo solto de outra pessoa (sem story)', t.arq(t.cam('clube_a', 'lider_a', 'f12')), 0::bigint);
select t.como('lider_b');
select t.eq('diretoria de OUTRO clube não abre o story de alcance clube', t.arq(t.cam('clube_a', 'membro_a', 'f1')), 0::bigint);
select t.como('membro_a2');
select t.eq('criança com a autorização desligada não abre', t.arq(t.cam('clube_a', 'membro_a', 'f2')), 0::bigint);
select t.como('membro_c');
select t.eq('recurso desligado não abre', t.arq(t.cam('clube_a', 'membro_a', 'f2')), 0::bigint);
select t.como('pend_b');
select t.eq('pendente não abre', t.arq(t.cam('clube_a', 'membro_a', 'f2')), 0::bigint);
select t.como('inat_b');
select t.eq('inativo não abre', t.arq(t.cam('clube_a', 'membro_a', 'f2')), 0::bigint);
select t.como('sem_vinculo');
select t.eq('sem vínculo não abre', t.arq(t.cam('clube_a', 'membro_a', 'f2')), 0::bigint);
select t.como_anon();
select t.eq('anon não abre', t.arq(t.cam('clube_a', 'membro_a', 'f2')), 0::bigint);
reset role;

-- =============================================================================
--  5. Acesso direto por id (visto, apagar, denunciar) e UUID forjado
-- =============================================================================
select t.como('leitor_b');
select public.rede_story_visto(t.id('m1'));
select public.rede_story_visto(t.id('m1'));
select t.eq('visto vale no alcance comunidade (anel cinza por story)',
  t.txt(format($q$select e->>'visto' from jsonb_array_elements(public.rede_stories('comunidade')) g, jsonb_array_elements(g->'stories') e where e->>'id' = %L$q$, t.id('m1'))), 'true');
select t.throws('visto em story de alcance CLUBE de outro clube: negado', format($q$select public.rede_story_visto(%L)$q$, t.id('k1')), 'não está disponível');
select t.throws('visto com UUID forjado: mesma resposta', $q$select public.rede_story_visto(gen_random_uuid())$q$, 'não está disponível');
select t.throws('denunciar story de alcance CLUBE de outro clube: negado', format($q$select public.comunidade_denunciar('story', %L, 'outro')$q$, t.id('k1')), 'não está disponível');
select t.throws('denunciar UUID forjado: mesma resposta', $q$select public.comunidade_denunciar('story', gen_random_uuid(), 'outro')$q$, 'não está disponível');
select t.throws('outro clube NÃO apaga story alheio', format($q$select public.rede_story_apagar(%L)$q$, t.id('m1')), 'Não foi possível apagar');
select t.throws('apagar UUID forjado: mesma resposta', $q$select public.rede_story_apagar(gen_random_uuid())$q$, 'Não foi possível apagar');
select t.como('lider_a');
select t.throws('nem a diretoria do clube do autor apaga pelo "apagar" (só o autor; a diretoria MODERA)', format($q$select public.rede_story_apagar(%L)$q$, t.id('m1')), 'Não foi possível apagar');
select t.como('membro_c');
select t.throws('recurso desligado: não marca visto', format($q$select public.rede_story_visto(%L)$q$, t.id('m1')));
select t.throws('recurso desligado: não denuncia', format($q$select public.comunidade_denunciar('story', %L, 'outro')$q$, t.id('m1')));
reset role;
select t.eq('visto gravado uma vez (idempotente)', (select count(*) from public.rede_stories_vistos where story_id = t.id('m1') and usuario_id = t.id('leitor_b')), 1::bigint);
select t.eq('nada mudou nos stories', (select count(*) from public.rede_stories where status = 'publicado'), 5::bigint);

-- =============================================================================
--  6. Denúncia (moderação POSTERIOR): outro clube denuncia, some na hora, modera o clube do AUTOR e a plataforma
-- =============================================================================
select t.como('membro_a');
select t.throws('não denuncia o próprio story', format($q$select public.comunidade_denunciar('story', %L, 'outro')$q$, t.id('m1')), 'mesmo publicou');
select t.como('leitor_b');
select t.eq('OUTRO clube denuncia o story da Comunidade: escondido na hora', t.txt(format($q$select public.comunidade_denunciar('story', %L, 'imagem')->>'ocultou'$q$, t.id('m1'))), 'true');
select t.eq('...sumiu da fileira da Comunidade', t.ve('comunidade', 'm1'), 0::bigint);
select t.eq('...o arquivo não abre mais para o outro clube', t.arq(t.cam('clube_a', 'membro_a', 'f2')), 0::bigint);
select t.eq('denúncia repetida da mesma pessoa não duplica', t.txt(format($q$select public.comunidade_denunciar('story', %L, 'imagem')->>'mensagem'$q$, t.id('m1'))), 'Você já denunciou isto. Obrigado por cuidar da Comunidade!');
select t.como('lider_a');
select t.eq('...sumiu também no próprio clube', t.ve('clube', 'm1') + t.ve('comunidade', 'm1'), 0::bigint);
reset role;
select t.eq('uma denúncia só', (select count(*) from public.comunidade_denuncias where alvo_tipo = 'story' and alvo_id = t.id('m1')), 1::bigint);
select t.eq('denúncia fica na fila do clube DO AUTOR', (select club_id from public.comunidade_denuncias where alvo_id = t.id('m1')), t.id('clube_a'));
select t.eq('diretoria do clube do autor avisada', (select count(*) from public.notificacoes where para_usuario = t.id('lider_a') and titulo like '%denunciado%'), 1::bigint);
select t.eq('diretoria do clube de quem denunciou NÃO é avisada', (select count(*) from public.notificacoes where para_usuario = t.id('lider_b') and titulo like '%denunciado%'), 0::bigint);
select t.como('lider_b');
select t.throws('diretoria de OUTRO clube NÃO modera (restaurar)', format($q$select public.comunidade_moderar('story', %L, 'restaurar')$q$, t.id('m1')), 'não encontrado');
select t.throws('diretoria de OUTRO clube NÃO modera (remover)', format($q$select public.comunidade_moderar('story', %L, 'remover')$q$, t.id('m1')), 'não encontrado');
select t.eq('...nem vê na própria fila', t.n($q$select jsonb_array_length(public.comunidade_fila_moderacao()->'denuncias')$q$), 0::bigint);
select t.eq('...nem abre o arquivo escondido', t.arq(t.cam('clube_a', 'membro_a', 'f2')), 0::bigint);
select t.como('lider_a');
select t.eq('diretoria do clube do autor vê na fila', t.txt($q$select string_agg(e->>'tipo', ',') from jsonb_array_elements(public.comunidade_fila_moderacao()->'denuncias') e$q$), 'story');
select t.eq('...e abre o arquivo para revisar', t.arq(t.cam('clube_a', 'membro_a', 'f2')), 1::bigint);
select t.como('admin_141');
select t.eq('plataforma assina a foto do story da Comunidade denunciado (mediado, com log)',
  t.txt(format($q$select public.admin_comunidade_foto_assinar('story', %L)->>'path'$q$, t.id('m1'))), t.cam('clube_a', 'membro_a', 'f2'));
select t.eq('plataforma modera o story da Comunidade denunciado (Manter)', t.txt(format($q$select public.admin_comunidade_moderar('story', %L, 'restaurar', 'ok')->>'status'$q$, t.id('m1'))), 'publicado');
select t.throws('plataforma NÃO mexe em story da Comunidade sem denúncia', format($q$select public.admin_comunidade_moderar('story', %L, 'remover', 'x')$q$, t.id('c1')), 'não encontrado');
reset role;
select t.eq('acesso da plataforma registrado', (select count(*) from public.plataforma_acesso_log where admin_user_id = t.id('admin_141') and item_tipo = 'story' and item_id = t.id('m1')), 2::bigint);
select t.ok('Manter não estica as 24 h', (select expira_em < now() + interval '24 hours 1 minute' from public.rede_stories where id = t.id('m1')));

-- story de alcance CLUBE escondido por denúncia: outro clube não registra denúncia nem com o UUID certo (correção da 535)
select t.como('lider_a');
select t.eq('o próprio clube denuncia o story de alcance clube', t.txt(format($q$select public.comunidade_denunciar('story', %L, 'outro')->>'ocultou'$q$, t.id('k1'))), 'true');
select t.como('leitor_b');
select t.throws('story de alcance clube JÁ escondido: outro clube não denuncia (sem oráculo de UUID)', format($q$select public.comunidade_denunciar('story', %L, 'outro')$q$, t.id('k1')), 'não está disponível');
select t.como('admin_141');
select t.throws('plataforma NÃO modera story de alcance CLUBE (nem denunciado)', format($q$select public.admin_comunidade_moderar('story', %L, 'remover', 'x')$q$, t.id('k1')), 'não encontrado');
select t.throws('...nem assina a foto dele', format($q$select public.admin_comunidade_foto_assinar('story', %L)$q$, t.id('k1')), 'não encontrado');
reset role;
select t.eq('nenhuma denúncia de outro clube no story de alcance clube', (select count(*) from public.comunidade_denuncias where alvo_id = t.id('k1') and denunciante_club_id <> t.id('clube_a')), 0::bigint);

-- remover pela diretoria do clube do autor
select t.como('membro_b');
select t.eq('segunda denúncia (outra pessoa, outro clube) no story restaurado', t.txt(format($q$select public.comunidade_denunciar('story', %L, 'ofensivo')->>'ok'$q$, t.id('m1'))), 'true');
select t.como('lider_a');
select t.eq('diretoria do clube do autor remove', t.txt(format($q$select public.comunidade_moderar('story', %L, 'remover')->>'status'$q$, t.id('m1'))), 'removido');
select t.como('leitor_b');
select t.eq('removido: fora da Comunidade', t.ve('comunidade', 'm1'), 0::bigint);
select t.eq('removido: arquivo não abre', t.arq(t.cam('clube_a', 'membro_a', 'f2')), 0::bigint);
select t.throws('removido: não marca visto', format($q$select public.rede_story_visto(%L)$q$, t.id('m1')), 'não está disponível');
reset role;
select t.eq('removido: arquivo entra na fila de apagar na hora (mesma limpeza)', (select motivo from public.rede_fotos_para_apagar where story_id = t.id('m1')), 'story');

-- =============================================================================
--  7. Excluir o próprio
-- =============================================================================
select t.como('conselheiro_a');
select t.eq('o autor apaga o próprio story da Comunidade', t.txt(format($q$select public.rede_story_apagar(%L)->>'ok'$q$, t.id('c1'))), 'true');
select t.throws('apagar de novo: nada a apagar (idempotente, sem efeito)', format($q$select public.rede_story_apagar(%L)$q$, t.id('c1')), 'Não foi possível apagar');
select t.como('leitor_b');
select t.eq('apagado: fora da Comunidade', t.ve('comunidade', 'c1'), 0::bigint);
select t.eq('apagado: arquivo não abre', t.arq(t.cam('clube_a', 'conselheiro_a', 'f3')), 0::bigint);
select t.throws('apagado: não aceita denúncia', format($q$select public.comunidade_denunciar('story', %L, 'outro')$q$, t.id('c1')), 'não está disponível');
reset role;
select t.eq('apagado: uma linha na fila de apagar', (select count(*) from public.rede_fotos_para_apagar where story_id = t.id('c1')), 1::bigint);

-- =============================================================================
--  8. 24 h: expirou, sumiu (fileira, arquivo, visto, denúncia) e vai para a limpeza
-- =============================================================================
select t.recuar(5);
select t.como('membro_a');
select t.eq('novo story da criança na Comunidade', t.txt(format($q$select public.rede_story_publicar(%L, 'Outro', 'comunidade')->>'status'$q$, t.cam('clube_a', 'membro_a', 'f9'))), 'publicado');
reset role;
select t.guardar('m2', t.cam('clube_a', 'membro_a', 'f9'));
select t.como('leitor_b');
select t.eq('no ar: B vê e abre', t.ve('comunidade', 'm2') + t.arq(t.cam('clube_a', 'membro_a', 'f9')), 2::bigint);
reset role;
update public.rede_stories set expira_em = now() - interval '1 minute', publicado_em = now() - interval '24 hours 1 minute' where id = t.id('m2');
select t.como('leitor_b');
select t.eq('expirado: fora da Comunidade', t.ve('comunidade', 'm2'), 0::bigint);
select t.eq('expirado: o arquivo não abre mais (sem URL assinada)', t.arq(t.cam('clube_a', 'membro_a', 'f9')), 0::bigint);
select t.throws('expirado: não marca visto', format($q$select public.rede_story_visto(%L)$q$, t.id('m2')), 'não está disponível');
select t.throws('expirado: não aceita denúncia', format($q$select public.comunidade_denunciar('story', %L, 'outro')$q$, t.id('m2')), 'não está disponível');
select t.como('lider_a');
select t.eq('expirado: fora também do Meu Clube', t.ve('clube', 'm2'), 0::bigint);
select t.como_cron();
select t.ok('a rotina diária marca o story expirado da Comunidade', public.rede_marcar_fotos_para_apagar() >= 1);
reset role;
select t.eq('expirado na fila de apagar (motivo story)', (select motivo from public.rede_fotos_para_apagar where story_id = t.id('m2')), 'story');
select t.eq('foto de story NÃO vira órfã', (select count(*) from public.rede_fotos_para_apagar where motivo = 'orfa' and story_id is null
   and caminho in (select foto_path from public.rede_stories)), 0::bigint);
select t.eq('catálogo do GC cobre rede_stories.foto_path (qualquer alcance)',
  (select count(*) from public._storage_referencias() r where r.tabela = 'rede_stories' and 'foto_path' = any (r.colunas)), 1::bigint);
select t.como_service();
set local role service_role;
select t.ok('a Edge Function limpar-fotos-rede recebe e confirma os 3 (removido, apagado, expirado)',
  (select (public.rede_fotos_confirmar((select array_agg(id) from public.rede_fotos_pendentes()))->>'arquivos')::int >= 3));
reset role;
select t.eq('stories fora do ar marcados com a foto apagada', (select count(*) from public.rede_stories where id in (t.id('m1'), t.id('c1'), t.id('m2')) and foto_apagada_em is not null), 3::bigint);

-- =============================================================================
--  9. Autor deixa de participar / clube desliga / pais desligam: some da Comunidade dos outros
-- =============================================================================
select t.recuar(5);
select t.como('conselheiro_a');
select t.eq('novo story do adulto do A na Comunidade', t.txt(format($q$select public.rede_story_publicar(%L, null, 'comunidade')->>'status'$q$, t.cam('clube_a', 'conselheiro_a', 'f13'))), 'publicado');
select t.como('leitor_b');
select t.eq('antes: B vê o próprio clube na Comunidade e abre o arquivo do A', t.ve('comunidade', 'b1') + t.arq(t.cam('clube_a', 'conselheiro_a', 'f13')), 2::bigint);
select t.como('lider_a');
select t.eq('antes: A vê o story do B na Comunidade', t.ve('comunidade', 'b1') + t.arq(t.cam('clube_b', 'membro_b', 'f5')), 2::bigint);
\o /dev/null
select t.como('pais_b');
select public.comunidade_autorizar(t.id('membro_b'), false);
\o
select t.como('lider_a');
select t.eq('responsável desligou a autorização: o story da criança some para os outros clubes', t.ve('comunidade', 'b1'), 0::bigint);
select t.eq('...e o arquivo não abre', t.arq(t.cam('clube_b', 'membro_b', 'f5')), 0::bigint);
select t.como('pais_b');
\o /dev/null
select public.comunidade_autorizar(t.id('membro_b'), true);
\o
select t.como('lider_a');
select t.eq('religou: volta', t.ve('comunidade', 'b1'), 1::bigint);
select t.como_cron();
update public.club_features set enabled = false where club_id = t.id('clube_b') and feature = 'comunidade';
select t.como('lider_a');
select t.eq('clube do autor DESLIGOU o recurso: o story sai da Comunidade de todos', t.ve('comunidade', 'b1'), 0::bigint);
select t.eq('...e o arquivo não abre', t.arq(t.cam('clube_b', 'membro_b', 'f5')), 0::bigint);
select t.como('leitor_b');
select t.throws('...e o próprio clube B deixa de ver a Comunidade', $q$select public.rede_stories('comunidade')$q$, 'não está liberada');
select t.eq('...inclusive os arquivos de outros clubes', t.arq(t.cam('clube_a', 'conselheiro_a', 'f13')), 0::bigint);
select t.como_cron();
update public.club_features set enabled = true where club_id = t.id('clube_b') and feature = 'comunidade';
update public.organization_memberships set status = 'suspenso' where user_id = t.id('membro_b') and organizational_unit_id = t.id('clube_b');
select t.como('lider_a');
select t.eq('autor INATIVADO no clube: o story dele some da Comunidade', t.ve('comunidade', 'b1'), 0::bigint);
select t.eq('...e o arquivo não abre', t.arq(t.cam('clube_b', 'membro_b', 'f5')), 0::bigint);
select t.como('membro_b');
select t.throws('...e ele não vê mais a Comunidade', $q$select public.rede_stories('comunidade')$q$);
select t.eq('...nem abre arquivo de story de outro clube', t.arq(t.cam('clube_a', 'conselheiro_a', 'f13')), 0::bigint);
reset role;

select t.fim();
rollback;
