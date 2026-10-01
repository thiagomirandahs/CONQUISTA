-- Migration 524: a fila unificada de avaliação (Gestão → Avaliações) traz o RELATO complementar da tentativa mais recente (520).
-- Sem isso o instrutor não via o relato da 1ª tentativa nessa fila. Aditivo: mesma autorização e filtros.
begin;
\ir _lib.sql
\ir _fixtures.sql
insert into public.club_features (club_id, feature, enabled) values (t.id('clube_a'), 'classes', true), (t.id('clube_b'), 'classes', true)
on conflict (club_id, feature) do update set enabled = true;
create function t.classe(p text) returns uuid language sql stable security definer as $$
  select c.id from public.classes c join public.curriculum_versions v on v.id = c.curriculum_version_id where v.origem = 'oficial' and v.status = 'publicado' and c.manifesto_id = p $$;
create function t.req(p text) returns uuid language sql stable security definer as $$
  select r.id from public.class_requirements r join public.class_sections s on s.id = r.section_id join public.classes c on c.id = s.class_id
  join public.curriculum_versions v on v.id = c.curriculum_version_id where r.manifesto_id = p and v.origem = 'oficial' and v.status = 'publicado' $$;

select t.como('membro_a'); select t.pedir_clube('clube_a');
select t.permitido('membro_a inicia Amigo', format($q$select public.classe_iniciar(%L)$q$, t.classe('amigo')));
select t.permitido('salva o relato', format($q$select public.requisito_relato_salvar(%L, %L)$q$, t.req('amigo.II.1'), 'Participei da reunião de sábado.'));
select t.permitido('envia', format($q$select public.requisito_enviar(%L)$q$, t.req('amigo.II.1')));
reset role;
select t.como('instrutor_a'); select t.pedir_clube('clube_a');
select t.eq('a fila unificada mostra o relato da tentativa', t.txt($q$select x->>'relato' from json_array_elements(public.fila_avaliacao_unificada('classe', null)) x where x->>'subtitulo' = (select descricao from public.class_requirements where id = (select r.id from public.class_requirements r where r.manifesto_id = 'amigo.II.1' limit 1))$q$), 'Participei da reunião de sábado.');
reset role;
select t.como('lider_b'); select t.pedir_clube('clube_b');
select t.eq('a diretoria de OUTRO clube não vê nada do clube A na fila', t.n($q$select count(*) from json_array_elements(public.fila_avaliacao_unificada('classe', null)) x where x->>'relato' = 'Participei da reunião de sábado.'$q$), 0::bigint);
select t.como('membro_a'); select t.pedir_clube('clube_a');
select t.throws('membro comum não lê a fila', $q$select public.fila_avaliacao_unificada(null, null)$q$);
select t.como_anon();
select t.eq('anon sem execute', has_function_privilege('anon', 'public.fila_avaliacao_unificada(text,uuid)', 'execute')::text, 'false');
reset role;
select * from t.fim();
rollback;
