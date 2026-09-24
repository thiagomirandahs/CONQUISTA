-- =============================================================================
--  Fase 9 — o "clube em uso" só pode ser um CLUBE (migration 75).
--
--  Achado pelo gate de API no staging: um coordenador distrital mandando `x-clube-atual` com o id
--  do DISTRITO ganhava um "clube em uso" que era o distrito — e publicava no mural, adotava
--  bichinho, com as linhas gravadas no distrito. O teste mede o banco, não a resposta.
-- =============================================================================
begin;
\ir _lib.sql
\ir _fixtures.sql

\o /dev/null
insert into public.organizational_units (type, nome, slug, metadata)
values ('distrito', 'Distrito do teste 59', 't59-distrito', '{"test_only":true}');
insert into t.ids (chave, id) select 'distrito', id from public.organizational_units where slug = 't59-distrito';
update public.organizational_units set parent_id = t.id('distrito') where id in (t.id('clube_a'), t.id('clube_b'));
select t.mk('coord', 'Coordenador Distrital 59', 'desbravador', 'ativo', 'clube_a');   -- cria a conta
delete from public.organization_memberships where user_id = t.id('coord');           -- e a deixa SEM clube
select t.mk2('coord', 'coordenador_distrital', 'ativo', 'distrito');
insert into public.club_features (club_id, feature, enabled)
select c, f, true from (values (t.id('clube_a')), (t.id('clube_b'))) cl(c) cross join (values ('mural'), ('bichinho')) fe(f)
on conflict (club_id, feature) do update set enabled = true;
create function t.linhas_no_distrito() returns bigint language sql security definer set search_path = '' as $$
  select (select count(*) from public.fotos where club_id = t.id('distrito'))
       + (select count(*) from public.bichinhos where club_id = t.id('distrito'));
$$;
\o

-- 1. o que o servidor resolve
select t.como('coord');
select t.ok('sem header, o coordenador (sem vínculo de clube) não tem clube em uso', public.clube_atual_id() is null);
select t.pedir_clube('distrito');
select t.ok('com x-clube-atual = o DISTRITO, continua sem clube em uso (antes: o distrito)', public.clube_atual_id() is null);
select t.ok('...e portanto não é "membro ativo do clube em uso"', not coalesce(public.membro_ativo_no_clube(public.clube_atual_id()), false));

-- 2. o que ele consegue gravar — medido no banco
select t.bloqueado('com o distrito na aba, não publica no mural',
  $q$insert into public.fotos (url, evento, legenda, autor_id) values ('https://x/59.jpg', 'Acampamento', 't59', auth.uid())$q$);
select t.tenta($q$select public.bichinho_adotar('Sonda', 'cachorro')$q$);
reset role;
select t.eq('nenhuma linha gravada no distrito (foto nem bichinho)', t.linhas_no_distrito(), 0);

-- 3. o que NÃO pode ter quebrado: o escopo institucional, pelo header dele
select t.como('coord');
select set_config('request.headers', json_build_object('x-escopo-atual', t.id('distrito'))::text, true);
select t.eq('o portal institucional continua: x-escopo-atual = o distrito resolve o escopo', public.escopo_atual_id(), t.id('distrito'));
reset role;

-- 4. e quem É de clube continua resolvendo o clube pelo header, como sempre
select t.como('membro_a'); select t.pedir_clube('clube_a');
select t.eq('membro de A, com x-clube-atual = A, tem A em uso', public.clube_atual_id(), t.id('clube_a'));
reset role;

select t.fim();
rollback;
