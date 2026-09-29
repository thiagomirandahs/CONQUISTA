-- REDE DBV (migration 501) — quem escolheu o PERSONAGEM tem o ARQUIVO da foto fechado entre clubes.
-- Prova: personagem + autorização arquivada -> membro de OUTRO clube não lê perfis/<uid>-x.jpg pela
-- policy da Rede; voltou para foto -> volta a abrir; colega do MESMO clube (policy 031) e o próprio
-- dono não mudam; a função mantém grants, security definer e search_path vazio.
begin;
\ir _lib.sql
\ir _fixtures.sql

\o /dev/null
select t.como_cron();
set local session_replication_role = replica;
update public.profiles set nome = 'Caio Pereira Dias',
       foto = 'http://x/storage/v1/object/public/imagens/perfis/' || t.id('membro_a2') || '-x.jpg',
       avatar_tipo = 'personagem',
       avatar = '{"pele":"#f1c27d","cabelo":"curto","corCabelo":"#2b1d0e","roupa":"lisa","corRoupa":"#1e3a8a"}'::jsonb
 where id = t.id('membro_a2');
set local session_replication_role = origin;
select t.mk('admin_111', 'Admin Plataforma', 'diretoria', 'ativo', 'clube_b');
insert into public.platform_admins (user_id, papel) values (t.id('admin_111'), 'operacao');
insert into storage.objects (bucket_id, name, owner, owner_id)
values ('imagens', 'perfis/' || t.id('membro_a2') || '-x.jpg', t.id('membro_a2'), t.id('membro_a2')::text);
create function t.qtd_arq() returns text language sql as $$
  select format($q$select count(*) from storage.objects where bucket_id = 'imagens' and name = %L$q$,
                'perfis/' || t.id('membro_a2') || '-x.jpg');
$$;
grant usage on schema t to public;
reset role;
\o

-- 1. estrutura
select t.eq('_rede_pode_ver_foto_perfil: authenticated executa, anon não, security definer, search_path vazio',
  (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = '_rede_pode_ver_foto_perfil'
      and has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute')
      and p.prosecdef and coalesce(p.proconfig, '{}') @> array['search_path=""']), 1::bigint);

-- 2. rede ligada nos dois clubes + autorização de imagem arquivada
select t.como('admin_111');
select public.admin_recurso_do_clube_definir(t.id('clube_a'), 'comunidade', true);
select public.admin_recurso_do_clube_definir(t.id('clube_b'), 'comunidade', true);
select t.como('lider_a');
select public.rede_marcar_autorizacao_imagem(t.id('membro_a2'), true);

-- 3. personagem + arquivada: outro clube NÃO abre o arquivo
select t.como('membro_b');
select t.eq('personagem + autorização arquivada: outro clube não lê o arquivo', t.nv(t.qtd_arq()), 0::bigint);
select t.eq('...e a função da Rede diz não',
  t.txt(format($q$select public._rede_pode_ver_foto_perfil(%L)::text$q$, 'perfis/' || t.id('membro_a2') || '-x.jpg')), 'false');
select t.como('membro_a');
select t.eq('colega do MESMO clube continua lendo (policy do clube, 031)', t.n(t.qtd_arq()), 1::bigint);
select t.como('membro_a2');
select t.eq('o próprio dono continua lendo', t.n(t.qtd_arq()), 1::bigint);

-- 4. voltou para foto: abre de novo para outro clube
select public.salvar_avatar(null, 'foto');
select t.como('membro_b');
select t.eq('voltou para foto (arquivada): outro clube lê de novo', t.n(t.qtd_arq()), 1::bigint);
-- (avatar_tipo é NOT NULL default 'foto' desde a migration 20260824000001: não existe caso nulo)

-- 5. personagem de novo: fecha na hora
select t.como('membro_a2');
select public.salvar_avatar('{"pele":"#f1c27d","cabelo":"curto","corCabelo":"#2b1d0e","roupa":"lisa","corRoupa":"#1e3a8a"}'::jsonb, 'personagem');
select t.como('membro_b');
select t.eq('personagem de novo: fecha na hora', t.nv(t.qtd_arq()), 0::bigint);
select t.como('membro_a');
select t.eq('...colega do mesmo clube segue lendo', t.n(t.qtd_arq()), 1::bigint);
select t.como('membro_a2');
select t.eq('...o dono segue lendo', t.n(t.qtd_arq()), 1::bigint);

-- 6. anon nunca
select t.como_anon();
select t.eq('anon não lê', t.nv(t.qtd_arq()), 0::bigint);
reset role;

select t.fim();
rollback;
