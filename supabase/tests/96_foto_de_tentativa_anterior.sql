-- Migration 360: a liderança do PRÓPRIO clube abre a foto de uma tentativa anterior do requisito
-- (histórico por tentativa, migration 87) — antes só a foto atual abria, e a coordenação (330) abria
-- mais que o próprio clube. Prova que a abertura é só do clube certo e só da gestão.
begin;
\ir _lib.sql
\ir _curriculo_regular_2026.sql
\ir _fixtures.sql

insert into public.club_features (club_id, feature, enabled) values (t.id('clube_a'), 'classes', true)
on conflict (club_id, feature) do update set enabled = true;
create function t.classe(p text) returns uuid language sql stable security definer as $$
  select c.id from public.classes c join public.curriculum_versions v on v.id = c.curriculum_version_id where v.origem = 'oficial' and v.status = 'publicado' and c.manifesto_id = p $$;
create function t.req(p text) returns uuid language sql stable security definer as $$
  select r.id from public.class_requirements r join public.class_sections s on s.id = r.section_id join public.classes c on c.id = s.class_id
  join public.curriculum_versions v on v.id = c.curriculum_version_id where r.manifesto_id = p and v.origem = 'oficial' and v.status = 'publicado' $$;
create function t.ve(p_nome text) returns bigint language sql as $$
  select t.nv(format('select count(*) from storage.objects where bucket_id = ''comprovacoes'' and name = %L', p_nome)) $$;

select t.id('membro_a')::text || '/requisitos/tentativa1.png' as foto1 \gset
select t.id('membro_a')::text || '/requisitos/tentativa2.png' as foto2 \gset
insert into storage.objects (bucket_id, name, owner_id) values
  ('comprovacoes', :'foto1', t.id('membro_a')::text), ('comprovacoes', :'foto2', t.id('membro_a')::text);

-- tentativa 1 → correção → tentativa 2
select t.como('membro_a'); select t.pedir_clube('clube_a');
select public.classe_iniciar(t.classe('amigo'));
select public.requisito_salvar(t.req('amigo.III.1'), 'primeira', :'foto1');
select public.requisito_enviar(t.req('amigo.III.1'));
reset role;
select id as mr from public.member_requirements where usuario_id = t.id('membro_a') and requirement_id = t.req('amigo.III.1') \gset
select t.como('instrutor_a'); select t.pedir_clube('clube_a');
select public.requisito_avaliar(:'mr', 'correcao_solicitada', 'refaça',
  (select id from public.requirement_submissions where member_requirement_id = :'mr' and tentativa_numero = 1));
select t.como('membro_a'); select t.pedir_clube('clube_a');
select public.requisito_salvar(t.req('amigo.III.1'), 'segunda', :'foto2');
select public.requisito_enviar(t.req('amigo.III.1'));
reset role;
select t.eq('[pré] as duas tentativas existem, a atual aponta para a foto 2',
  (select count(*) from public.requirement_submissions where member_requirement_id = :'mr')::text || '|' ||
  (select evidencia_path from public.member_requirements where id = :'mr'), '2|' || :'foto2');

-- ---------- liderança do clube: abre as duas ----------
select t.como('instrutor_a'); select t.pedir_clube('clube_a');
select t.eq('instrutor do clube abre a foto ATUAL', t.ve(:'foto2'), 1);
select t.eq('instrutor do clube abre a foto da TENTATIVA ANTERIOR (antes da 360: 0)', t.ve(:'foto1'), 1);
select t.como('lider_a'); select t.pedir_clube('clube_a');
select t.eq('diretoria do clube abre a foto da tentativa anterior', t.ve(:'foto1'), 1);

-- ---------- quem NÃO pode ----------
select t.como('lider_b'); select t.pedir_clube('clube_b');
select t.eq('diretoria de OUTRO clube não abre a tentativa anterior', t.ve(:'foto1'), 0);
select t.eq('...nem a atual', t.ve(:'foto2'), 0);
select t.como('membro_a2'); select t.pedir_clube('clube_a');
select t.eq('outra criança do MESMO clube não abre', t.ve(:'foto1'), 0);
select t.como('pais_a'); select t.pedir_clube('clube_a');
select t.eq('responsável sem vínculo com a criança não abre', t.ve(:'foto1'), 0);
select t.como('dir_a_membro_b'); select t.pedir_clube('clube_b');
select t.eq('diretoria do A operando no clube B não abre (o clube em uso manda)', t.ve(:'foto1'), 0);
select t.como_anon();
select t.eq('anônimo não abre', t.ve(:'foto1'), 0);
reset role;

-- ---------- a dona continua abrindo as próprias ----------
select t.como('membro_a'); select t.pedir_clube('clube_a');
select t.eq('a própria criança abre as duas', t.ve(:'foto1') + t.ve(:'foto2'), 2);
reset role;

select t.fim();
rollback;
