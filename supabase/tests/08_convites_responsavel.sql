-- Prioridade 7: convite de responsável — listagem, revogação, expiração, uso único,
-- token que nunca fica guardado em claro, isolamento por clube e papel padronizado em `pais`.
begin;
\ir _lib.sql
\ir _fixtures.sql

-- ---------- criação: só a liderança do clube; o token aparece UMA vez e só o hash é guardado ----------
select t.como('membro_a');
select t.bloqueado('membro comum NÃO cria convite', $q$select public.criar_convite_responsavel()$q$);
select t.como('pais_a');
select t.bloqueado('responsável NÃO cria convite', $q$select public.criar_convite_responsavel()$q$);
select t.como_anon();
select t.bloqueado('anônimo NÃO cria convite', $q$select public.criar_convite_responsavel()$q$);

select t.como('lider_a');
select (j->>'token') as tok_a1, (j->>'id') as inv_a1, (j->>'expires_at') as exp_a1 from (select public.criar_convite_responsavel() as j) x \gset
select (j->>'token') as tok_a2, (j->>'id') as inv_a2 from (select public.criar_convite_responsavel() as j) x \gset
select (j->>'token') as tok_a3, (j->>'id') as inv_a3 from (select public.criar_convite_responsavel() as j) x \gset
select t.como('lider_b');
select (j->>'token') as tok_b1, (j->>'id') as inv_b1 from (select public.criar_convite_responsavel() as j) x \gset
reset role;

select t.eq('token tem 48 caracteres (192 bits)', length(:'tok_a1')::bigint, 48);
select t.eq('só o hash é guardado (o token em claro NÃO existe no banco)', (select count(*) from public.club_invites where token_hash = :'tok_a1'), 0);
select t.eq('o hash sha256 do token é o que está guardado', (select count(*) from public.club_invites where token_hash = encode(extensions.digest(:'tok_a1', 'sha256'), 'hex')), 1);
select t.ok('convite expira em ~14 dias', (select expires_at between now() + interval '13 days 23 hours' and now() + interval '14 days 1 hour' from public.club_invites where id = :'inv_a1'::uuid));
select t.eq('convite do clube A pertence ao clube A', (select club_id from public.club_invites where id = :'inv_a1'::uuid), t.id('clube_a'));
select t.eq('convite do clube B pertence ao clube B', (select club_id from public.club_invites where id = :'inv_b1'::uuid), t.id('clube_b'));

-- ---------- listagem: só a liderança do clube, sem token nem hash ----------
select t.como('lider_a');
select t.eq('líder A lista os 3 convites do clube A', t.n('select count(*) from public.listar_convites_responsavel()'), 3);
select t.eq('a listagem NÃO devolve token nem hash', t.n(format($q$select count(*) from (select to_jsonb(c)::text as j from public.listar_convites_responsavel() c) z where j like %L or j like %L$q$, '%' || :'tok_a1' || '%', '%token%')), 0);
select t.eq('convite novo aparece como ativo', t.txt(format($q$select status from public.listar_convites_responsavel() where id = %L$q$, :'inv_a1')), 'ativo');
select t.eq('a tabela club_invites não é legível direto (nem pela liderança)', t.nv('select count(*) from public.club_invites'), 0);
select t.como('lider_b');
select t.eq('líder B lista só o convite do clube B', t.n('select count(*) from public.listar_convites_responsavel()'), 1);
select t.como('membro_a');
select t.eq('membro comum não lista convites', t.nv('select count(*) from public.listar_convites_responsavel()'), 0);
select t.como('pais_a');
select t.eq('responsável não lista convites', t.nv('select count(*) from public.listar_convites_responsavel()'), 0);
select t.como_anon();
select t.eq('anônimo não lista convites', t.nv('select count(*) from public.listar_convites_responsavel()'), 0);

-- ---------- uso: cadastro de responsável só com convite válido, uma vez ----------
reset role;
-- migration 104: sem convite o cadastro de responsável é aceito, mas NÃO dá clube nem filho — entra
-- num clube só pedindo pelo link (pendente, a liderança aprova) e o filho continua por convite/diretoria.
select t.signup('pais_sem_convite', '{"nome":"Sem Convite","tipo":"pais"}'::jsonb);
select t.eq('responsável SEM convite: conta criada como responsável', (select papel from public.profiles where id = t.id('pais_sem_convite')), 'pais');
select t.eq('...mas SEM vínculo de clube nenhum', (select count(*) from public.organization_memberships where user_id = t.id('pais_sem_convite')), 0);
select t.eq('...e SEM filho nenhum', (select count(*) from public.responsaveis where responsavel_id = t.id('pais_sem_convite')), 0);
select t.throws('cadastro de responsável com convite inexistente é recusado',
  $q$select t.signup('pais_lixo', '{"nome":"Lixo","tipo":"pais","convite_responsavel":"0000000000000000000000000000000000000000000000ff"}'::jsonb)$q$, 'inválido');
select t.signup('pais_novo', jsonb_build_object('nome', 'Pais Novo', 'tipo', 'pais', 'convite_responsavel', :'tok_a1'));
select t.eq('responsável entra como papel pais', (select papel from public.profiles where id = t.id('pais_novo')), 'pais');
select t.eq('responsável entra ativo (o convite é a autorização)', (select status from public.profiles where id = t.id('pais_novo')), 'ativo');
select t.eq('vínculo do responsável é no clube do convite', (select organizational_unit_id from public.organization_memberships where user_id = t.id('pais_novo')), t.id('clube_a'));
select t.eq('vínculo do responsável tem papel padronizado pais', (select role from public.organization_memberships where user_id = t.id('pais_novo')), 'pais');
select t.eq('responsável tem exatamente 1 vínculo', (select count(*) from public.organization_memberships where user_id = t.id('pais_novo')), 1);
select t.ok('convite usado guarda quando foi usado', (select used_at is not null from public.club_invites where id = :'inv_a1'::uuid));
select t.eq('convite usado guarda quem usou', (select used_by from public.club_invites where id = :'inv_a1'::uuid), t.id('pais_novo'));
select t.throws('convite de uso único: 2º cadastro com o mesmo convite é recusado',
  format($q$select t.signup('pais_reuso', %L::jsonb)$q$, jsonb_build_object('nome','Reuso','tipo','pais','convite_responsavel', :'tok_a1')::text), 'inválido');
select t.signup('pais_b_novo', jsonb_build_object('nome','Pais B Novo','tipo','pais','convite_responsavel', :'tok_b1'));
select t.eq('o responsável do convite do clube B cai no clube B', (select organizational_unit_id from public.organization_memberships where user_id = t.id('pais_b_novo')), t.id('clube_b'));
select t.como('pais_novo');
select t.eq('responsável recém-cadastrado não lê perfis do clube', t.n('select count(*) from public.profiles'), 1);
select t.eq('responsável recém-cadastrado não lê pontos', t.nv('select count(*) from public.pontos'), 0);
reset role;

-- ---------- expiração ----------
update public.club_invites set expires_at = now() - interval '1 minute' where id = :'inv_a2'::uuid;
select t.throws('convite expirado é recusado',
  format($q$select t.signup('pais_expirado', %L::jsonb)$q$, jsonb_build_object('nome','Expirado','tipo','pais','convite_responsavel', :'tok_a2')::text), 'expirado');
select t.como('lider_a');
select t.eq('convite vencido aparece como expirado', t.txt(format($q$select status from public.listar_convites_responsavel() where id = %L$q$, :'inv_a2')), 'expirado');
select t.eq('convite usado aparece como usado', t.txt(format($q$select status from public.listar_convites_responsavel() where id = %L$q$, :'inv_a1')), 'usado');

-- ---------- revogação ----------
select t.como('lider_b');
select t.throws('líder B NÃO revoga convite do clube A', format('select public.revogar_convite_responsavel(%L)', :'inv_a3'), 'permiss');
select t.como('membro_a');
select t.throws('membro comum NÃO revoga convite', format('select public.revogar_convite_responsavel(%L)', :'inv_a3'), 'permiss');
select t.como('lider_a');
select t.throws('não revoga convite inexistente', format('select public.revogar_convite_responsavel(%L)', gen_random_uuid()), 'encontrad');
select t.throws('não revoga convite já usado', format('select public.revogar_convite_responsavel(%L)', :'inv_a1'), 'usado');
select t.permitido('líder A revoga o convite ativo', format('select public.revogar_convite_responsavel(%L)', :'inv_a3'));
select t.throws('revogar duas vezes é recusado', format('select public.revogar_convite_responsavel(%L)', :'inv_a3'), 'revogad');
select t.eq('convite revogado aparece como revogado', t.txt(format($q$select status from public.listar_convites_responsavel() where id = %L$q$, :'inv_a3')), 'revogado');
reset role;
select t.throws('convite REVOGADO é recusado no cadastro',
  format($q$select t.signup('pais_revogado', %L::jsonb)$q$, jsonb_build_object('nome','Revogado','tipo','pais','convite_responsavel', :'tok_a3')::text), 'inválido');
select t.eq('nenhum perfil criado por cadastro recusado', (select count(*) from public.profiles where id in (md5('cq-test:pais_revogado')::uuid, md5('cq-test:pais_expirado')::uuid, md5('cq-test:pais_reuso')::uuid)), 0);

-- ---------- papel padronizado ----------
select t.eq('nenhum vínculo com papel legado "responsavel"', (select count(*) from public.organization_memberships where role = 'responsavel'), 0);

select t.fim();
rollback;
