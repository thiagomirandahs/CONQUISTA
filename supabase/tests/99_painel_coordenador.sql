-- Painel do coordenador (migration 390): escopo_resumo_coordenador(p_periodo).
-- Prova: coordenador vê só os clubes do SEU escopo, só números agregados (sem nome de pessoa nem campo
-- sensível), coordenador de outro distrito não vê, header forjado/diretoria de clube não usam, anon sem EXECUTE.
begin;
\ir _lib.sql
\ir _fixtures.sql

\o /dev/null
select t.signup('c99_dist', '{"tipo":"fundador","nome":"Coord Distrital 99"}'::jsonb);
select t.signup('c99_outro', '{"tipo":"fundador","nome":"Coord Outro 99"}'::jsonb);
create function t.un99(p_chave text, p_tipo text, p_nome text, p_pai text) returns void language plpgsql as $$
begin
  insert into public.organizational_units (id, type, nome, slug, parent_id, metadata)
  values (public.curriculo_uuid('t99:' || p_chave), p_tipo, p_nome, null,
          case when p_pai is not null then t.id(p_pai) end, '{"test_only":true}');
  insert into t.ids (chave, id) values (p_chave, public.curriculo_uuid('t99:' || p_chave));
end $$;
select t.un99('campo99', 'campo', 'Associação 99', null);
select t.un99('r99', 'regiao', 'Região 99', 'campo99');
select t.un99('d99', 'distrito', 'Distrito 99', 'r99');
select t.un99('d99b', 'distrito', 'Distrito 99 B', 'r99');
update public.organizational_units set parent_id = t.id('d99') where id = t.id('clube_a');
update public.organizational_units set parent_id = t.id('d99b') where id = t.id('clube_b');
insert into public.organization_memberships (user_id, organizational_unit_id, role, status)
values (t.id('c99_dist'), t.id('d99'), 'coordenador_distrital', 'ativo'),
       (t.id('c99_outro'), t.id('d99b'), 'coordenador_distrital', 'ativo');
-- visita realizada neste ano no clube A
insert into public.club_visits (club_id, escopo_id, papel, agendada_para, objetivo, status, realizada_em, relatorio)
values (t.id('clube_a'), t.id('d99'), 'coordenador_distrital', now() - interval '1 hour', 'Visita 99', 'realizada', now() - interval '1 hour', 'Relatório secreto 99');
create function t.no_escopo99(p_pessoa text, p_unid text) returns void language plpgsql as $$
begin
  perform t.como(p_pessoa);
  perform set_config('request.headers', json_build_object('x-escopo-atual', t.id(p_unid))::text, true);
end $$;
grant insert, select on t.ids to public;
\o

-- ==================== coordenador do distrito 99 ====================
select t.no_escopo99('c99_dist', 'd99');
select set_config('t99.r', public.escopo_resumo_coordenador('mes')::text, true) is not null;
select set_config('t99.ano', public.escopo_resumo_coordenador('ano')::text, true) is not null;
reset role;
select t.eq('vê exatamente 1 clube (o do seu distrito)',
  (select count(*) from json_array_elements(current_setting('t99.r')::json -> 'clubes'))::bigint, 1::bigint);
select t.eq('o clube visto é o A', (current_setting('t99.r')::json -> 'clubes' -> 0 ->> 'club_id')::uuid, t.id('clube_a'));
select t.ok('clube B (outro distrito) não aparece', position(t.id('clube_b')::text in current_setting('t99.r')) = 0);
select t.eq('visita realizada no ano conta', (current_setting('t99.r')::json -> 'clubes' -> 0 ->> 'visitas_ano')::int, 1);
select t.eq('totais: 1 visitado, 0 faltando',
  (current_setting('t99.r')::json -> 'totais' ->> 'visitados_ano') || '/' || (current_setting('t99.r')::json -> 'totais' ->> 'faltando_visitar_ano'), '1/0');
select t.eq('período ecoado', current_setting('t99.ano')::json ->> 'periodo', 'ano');
select t.ok('clube sem avanço conta como parado',
  (current_setting('t99.r')::json -> 'clubes' -> 0 ->> 'parado')::boolean = ((current_setting('t99.r')::json -> 'clubes' -> 0 ->> 'dias_sem_avancar') is null
    or (current_setting('t99.r')::json -> 'clubes' -> 0 ->> 'dias_sem_avancar')::int > 30));
select t.ok('só agregados: nenhum campo sensível',
  current_setting('t99.r') !~* '"(usuario\w*|pessoa\w*|foto\w*|avatar|chat|mensage\w*|evidencia\w*|valor\w*|financeiro|caixa|responsave\w*|email|telefone|nascimento|relatorio|objetivo|observacao|plano|assinatura)"\s*:');
select t.eq('nenhum nome de pessoa do clube A aparece',
  (select count(*) from public.organization_memberships m join public.profiles p on p.id = m.user_id
    where m.organizational_unit_id = t.id('clube_a') and length(p.nome) > 3
      and position(p.nome in current_setting('t99.r')) > 0), 0::bigint);
select t.ok('relatório da visita não sai', position('secreto 99' in current_setting('t99.r')) = 0);

-- ==================== outro distrito / escopo forjado / clube ====================
select t.no_escopo99('c99_outro', 'd99b');
select set_config('t99.o', public.escopo_resumo_coordenador('mes')::text, true) is not null;
select t.ok('coordenador do outro distrito NÃO vê o clube A', position(t.id('clube_a')::text in current_setting('t99.o')) = 0);
select t.no_escopo99('c99_outro', 'd99');
select t.eq('header forjado (escopo sem vínculo) = sem escopo',
  (public.escopo_resumo_coordenador('mes')::json ->> 'sem_escopo'), 'true');
select t.como('lider_a');
select t.eq('diretoria do clube (sem vínculo institucional) = sem escopo',
  (public.escopo_resumo_coordenador('mes')::json ->> 'sem_escopo'), 'true');
select t.no_escopo99('c99_dist', 'd99');
select t.throws('período inválido é recusado', $$select public.escopo_resumo_coordenador('semana')$$, 'Período inválido');

reset role;
select t.eq('anon sem EXECUTE', has_function_privilege('anon', 'public.escopo_resumo_coordenador(text)', 'execute'), false);
select t.eq('authenticated com EXECUTE', has_function_privilege('authenticated', 'public.escopo_resumo_coordenador(text)', 'execute'), true);
select t.eq('security definer + search_path vazio',
  (select p.prosecdef and array_to_string(p.proconfig, ',') like '%search_path=""%'
     from pg_proc p where p.oid = 'public.escopo_resumo_coordenador(text)'::regprocedure), true);

select t.fim();
rollback;
