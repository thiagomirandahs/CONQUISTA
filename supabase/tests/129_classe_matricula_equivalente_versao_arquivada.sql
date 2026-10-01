-- Migration 523: classe já iniciada numa versão ARQUIVADA do currículo não pode ser iniciada de novo na versão vigente
-- (duas matrículas ativas da mesma classe no clube). Só no MESMO clube; cancelada não bloqueia; não mexe nas matrículas existentes.
begin;
\ir _lib.sql
\ir _curriculo_regular_2026.sql
\ir _fixtures.sql
insert into public.club_features (club_id, feature, enabled) values (t.id('clube_a'), 'classes', true), (t.id('clube_b'), 'classes', true)
on conflict (club_id, feature) do update set enabled = true;
create function t.classe(p_versao text, p_codigo text) returns uuid language sql stable security definer as $$
  select public.curriculo_uuid('class:' || p_versao || ':' || p_codigo) $$;
update public.profiles set nascimento = (current_date - interval '13 years')::date where id in (t.id('membro_a'), t.id('membro_a2'), t.id('membro_b'));

-- Amigo 2026.3 (arquivada) em andamento do membro_a no clube A (como a matrícula nasceu antes da 2026.4)
insert into public.member_classes (usuario_id, club_id, class_id) values (t.id('membro_a'), t.id('clube_a'), t.classe('2026.3', 'amigo'));
create function t.antes() returns text language sql stable security definer as $$
  select (select count(*) from public.member_classes)::text || '|' || (select count(*) from public.member_requirements) $$;
select t.antes() as foto \gset

select t.como('membro_a'); select t.pedir_clube('clube_a');
select t.eq('Amigo 2026.4 NÃO é oferecida a quem já tem a Amigo 2026.3 em andamento neste clube',
  t.n($q$select count(*) from json_array_elements(public.classes_disponiveis()) c where c->>'codigo' = 'amigo' and c->>'nome' = 'Amigo'$q$), 0::bigint);
select t.throws('classe_iniciar da Amigo 2026.4 é recusada (versão anterior em andamento)', format($q$select public.classe_iniciar(%L)$q$, t.classe('2026.4', 'amigo')), 'em andamento neste clube');
select t.eq('...outra classe (Companheiro) continua oferecida', t.n($q$select count(*) from json_array_elements(public.classes_disponiveis()) c where c->>'codigo' = 'companheiro'$q$), 1::bigint);
select t.permitido('...e pode ser iniciada', format($q$select public.classe_iniciar(%L)$q$, t.classe('2026.4', 'companheiro')));
reset role;

-- atribuição pela liderança: mesma recusa
select t.como('lider_a'); select t.pedir_clube('clube_a');
select t.throws('classe_atribuir da Amigo 2026.4 para quem tem a 2026.3 é recusada', format($q$select public.classe_atribuir(%L, %L)$q$, t.id('membro_a'), t.classe('2026.4', 'amigo')), 'em andamento neste clube');
select t.permitido('...mas atribuir a Amigo a OUTRO membro (sem matrícula) funciona', format($q$select public.classe_atribuir(%L, %L)$q$, t.id('membro_a2'), t.classe('2026.4', 'amigo')));
reset role;

-- multiclube: a matrícula do clube A não bloqueia o clube B (progresso em andamento é isolado por clube)
insert into public.organization_memberships (user_id, organizational_unit_id, role, status)
select t.id('membro_a'), t.id('clube_b'), 'desbravador', 'ativo' where not exists (select 1 from public.organization_memberships where user_id = t.id('membro_a') and organizational_unit_id = t.id('clube_b'));
select t.como('membro_a'); select t.pedir_clube('clube_b');
select t.permitido('no clube B a mesma pessoa pode iniciar a Amigo 2026.4 (isolado por clube)', format($q$select public.classe_iniciar(%L)$q$, t.classe('2026.4', 'amigo')));
reset role;

-- cancelada não bloqueia: cancela a Amigo 2026.3 do clube A e inicia a vigente
update public.member_classes set status = 'cancelada' where usuario_id = t.id('membro_a') and club_id = t.id('clube_a') and class_id = t.classe('2026.3', 'amigo');
select t.como('membro_a'); select t.pedir_clube('clube_a');
select t.permitido('matrícula CANCELADA da versão anterior não bloqueia a vigente', format($q$select public.classe_iniciar(%L)$q$, t.classe('2026.4', 'amigo')));
reset role;

-- nada foi migrado/alterado nas matrículas pré-existentes por esta migration (a 2026.3 só mudou porque o teste a cancelou)
select t.eq('a matrícula antiga NÃO foi apagada nem trocada de versão (continua apontando para a 2026.3, cancelada)',
  (select class_id::text || '|' || status from public.member_classes where usuario_id = t.id('membro_a') and club_id = t.id('clube_a') and class_id = t.classe('2026.3', 'amigo')),
  t.classe('2026.3', 'amigo')::text || '|cancelada');
select t.como_anon();
select t.eq('helper interno sem execute para anon/authenticated', (has_function_privilege('anon', 'public._classe_matricula_equivalente(uuid,uuid,uuid)', 'execute') or has_function_privilege('authenticated', 'public._classe_matricula_equivalente(uuid,uuid,uuid)', 'execute'))::text, 'false');
reset role;
select * from t.fim();
rollback;
