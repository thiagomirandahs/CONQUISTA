-- COMPATIBILIDADE das migrations 510–513 com dados que JÁ EXISTEM (fase 7). Roda no banco no estado da migration 503
-- (o de produção hoje), com comprovações ANTIGAS feitas pelo caminho de sempre (requisito_salvar/enviar/avaliar).
-- ESTE arquivo dá COMMIT (o banco é descartável, criado só para este teste); o post.sql confere depois de aplicar 510–513.
\set ON_ERROR_STOP on
begin;
\ir ../_lib.sql
\ir ../_curriculo_regular_2026.sql
\ir ../_fixtures.sql
\o /dev/null
insert into public.club_features (club_id, feature, enabled) values (t.id('clube_a'), 'classes', true), (t.id('clube_b'), 'classes', true), (t.id('clube_a'), 'especialidades', true)
on conflict (club_id, feature) do update set enabled = true;
create function t.classe(p text) returns uuid language sql stable security definer as $$
  select c.id from public.classes c join public.curriculum_versions v on v.id = c.curriculum_version_id where v.origem = 'oficial' and v.status = 'publicado' and c.manifesto_id = p $$;
create function t.req(p text) returns uuid language sql stable security definer as $$
  select r.id from public.class_requirements r join public.class_sections s on s.id = r.section_id join public.classes c on c.id = s.class_id
  join public.curriculum_versions v on v.id = c.curriculum_version_id where r.manifesto_id = p and v.origem = 'oficial' and v.status = 'publicado' $$;
create function t.mr(p_user text, p_req text) returns uuid language sql stable security definer as $$
  select mr.id from public.member_requirements mr where mr.usuario_id = t.id(p_user) and mr.requirement_id = t.req(p_req) $$;
select t.id('membro_a')::text || '/requisitos/antiga-1.png' as foto1 \gset
insert into storage.objects (bucket_id, name, owner_id) values ('comprovacoes', :'foto1', t.id('membro_a')::text);
\o

-- ---- 1) tentativa 1 (texto) → correção → tentativa 2 → aprovada (amigo.IV.1 GANHA modelo na 512) ----
select t.como('membro_a'); select t.pedir_clube('clube_a');
select public.classe_iniciar(t.classe('amigo'));
select public.requisito_salvar(t.req('amigo.IV.1'), 'Minhas 10 qualidades de um bom amigo (texto ANTIGO).', null);
select public.requisito_enviar(t.req('amigo.IV.1'));
select t.como('instrutor_a'); select t.pedir_clube('clube_a');
select public.requisito_avaliar(t.mr('membro_a', 'amigo.IV.1'), 'correcao_solicitada', 'Refaça com exemplos.');
select t.como('membro_a'); select t.pedir_clube('clube_a');
select public.requisito_salvar(t.req('amigo.IV.1'), 'Versão corrigida ANTIGA com 4 exemplos.', null);
select public.requisito_enviar(t.req('amigo.IV.1'));
select t.como('lider_a'); select t.pedir_clube('clube_a');
select public.requisito_avaliar(t.mr('membro_a', 'amigo.IV.1'), 'aprovado', 'Muito bom (antigo).');
-- ---- 2) enviada e AINDA sem avaliação no momento do upgrade (amigo.II.2, vai ganhar modelo) ----
select t.como('membro_a'); select t.pedir_clube('clube_a');
select public.requisito_salvar(t.req('amigo.II.2'), 'Explico os versículos (texto ANTIGO pendente).', null);
select public.requisito_enviar(t.req('amigo.II.2'));
-- ---- 3) foto antiga pendente (amigo.VI.1, sem modelo) ----
select public.requisito_salvar(t.req('amigo.VI.1'), null, :'foto1');
select public.requisito_enviar(t.req('amigo.VI.1'));
-- ---- 4) rascunho antigo, ainda NÃO enviado (amigo.V.2, vai ganhar modelo) ----
select public.requisito_salvar(t.req('amigo.V.2'), 'Rascunho antigo do compromisso de vida saudável.', null);
-- ---- 5) uma segunda pessoa com outra classe em outro clube ----
select t.como('membro_b'); select t.pedir_clube('clube_b');
select public.classe_iniciar(t.classe('amigo'));
select public.requisito_salvar(t.req('amigo.III.2'), 'Redação antiga do clube B.', null);
select public.requisito_enviar(t.req('amigo.III.2'));
reset role;
commit;
