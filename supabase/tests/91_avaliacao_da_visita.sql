-- Avaliação da visita da coordenação pelo clube (migration 320).
begin;
\ir _lib.sql
\ir _fixtures.sql

\o /dev/null
select t.signup('c_dist', '{"tipo":"fundador","nome":"Coord Distrital 91"}'::jsonb);
select t.signup('c_dist2', '{"tipo":"fundador","nome":"Coord Outro Distrito 91"}'::jsonb);
select t.signup('c_reg', '{"tipo":"fundador","nome":"Coord Regional 91"}'::jsonb);
select t.signup('c_reg1', '{"tipo":"fundador","nome":"Coord Outra Regiao 91"}'::jsonb);
select t.signup('c_geral', '{"tipo":"fundador","nome":"Coord Geral 91"}'::jsonb);
select t.signup('c_sec', '{"tipo":"fundador","nome":"Secretaria MD 91"}'::jsonb);
select t.signup('c_dep', '{"tipo":"fundador","nome":"Departamental 91"}'::jsonb);

-- árvore: Associação › 2ª Região › (Distrito 1: clube A) + (Distrito 2: clube B); 1ª Região › Distrito 3
create function t.un(p_chave text, p_tipo text, p_nome text, p_pai text) returns void language plpgsql as $$
begin
  insert into public.organizational_units (id, type, nome, slug, parent_id, metadata)
  values (public.curriculo_uuid('t91:' || p_chave), p_tipo, p_nome, null,
          case when p_pai is not null then t.id(p_pai) end, '{"test_only":true}');
  insert into t.ids (chave, id) values (p_chave, public.curriculo_uuid('t91:' || p_chave));
end $$;
select t.un('campo', 'campo', 'Associação 91', null);
select t.un('r2', 'regiao', '2ª Região 91', 'campo');
select t.un('r1', 'regiao', '1ª Região 91', 'campo');
select t.un('d1', 'distrito', 'Distrito 1 91', 'r2');
select t.un('d2', 'distrito', 'Distrito 2 91', 'r2');
select t.un('d3', 'distrito', 'Distrito 3 91', 'r1');
update public.organizational_units set parent_id = t.id('d1') where id = t.id('clube_a');
update public.organizational_units set parent_id = t.id('d2') where id = t.id('clube_b');

create function t.vinc(p_pessoa text, p_unid text, p_papel text) returns void language sql as $$
  insert into public.organization_memberships (user_id, organizational_unit_id, role, status)
  values (t.id(p_pessoa), t.id(p_unid), p_papel, 'ativo');
$$;
select t.vinc('c_dist', 'd1', 'coordenador_distrital');
select t.vinc('c_dist2', 'd2', 'coordenador_distrital');
select t.vinc('c_reg', 'r2', 'coordenador_regional');
select t.vinc('c_reg1', 'r1', 'coordenador_regional');
select t.vinc('c_geral', 'campo', 'coordenador_geral');
select t.vinc('c_sec', 'campo', 'secretario_md');
select t.vinc('c_dep', 'campo', 'departamental_jovem');
select t.vinc('c_dist', 'clube_b', 'instrutor');  -- o distrital também serve num clube (sino no clube dele)

create function t.no_escopo(p_pessoa text, p_unid text) returns void language plpgsql as $$
begin
  perform t.como(p_pessoa);
  perform set_config('request.headers', json_build_object('x-escopo-atual', t.id(p_unid))::text, true);
end $$;
-- avaliação (texto do JSON) de uma visita vista pelo portal do escopo em uso
create function t.aval_portal(p_visita text) returns text language sql as $$
  select (v -> 'avaliacao')::text from json_array_elements(public.escopo_visitas()) v where v ->> 'id' = p_visita;
$$;
grant insert, select on t.ids to public;

-- distrital agenda (futuro) e a visita "passa": v1 realizada, v2 passou sem marcar, v3 futura, v4 cancelada
select t.no_escopo('c_dist', 'd1');
select set_config('t91.v1', public.escopo_visita_agendar(t.id('clube_a'), now() + interval '3 days', 'Conhecer a diretoria') ->> 'id', true);
select set_config('t91.v2', public.escopo_visita_agendar(t.id('clube_a'), now() + interval '4 days', 'Acompanhar reunião') ->> 'id', true);
select set_config('t91.v3', public.escopo_visita_agendar(t.id('clube_a'), now() + interval '9 days', 'Investidura') ->> 'id', true);
select set_config('t91.v4', public.escopo_visita_agendar(t.id('clube_a'), now() + interval '5 days', 'Cancelada') ->> 'id', true);
select public.escopo_visita_atualizar(current_setting('t91.v4')::uuid, 'cancelar', null, 'Imprevisto');
reset role;
update public.club_visits set agendada_para = now() - interval '2 days' where id = current_setting('t91.v1')::uuid;
update public.club_visits set agendada_para = now() - interval '1 day' where id = current_setting('t91.v2')::uuid;
select t.no_escopo('c_dist', 'd1');
select public.escopo_visita_atualizar(current_setting('t91.v1')::uuid, 'realizada', null, 'Clube organizado e animado.');
\o

-- ==================== quem avalia ====================
select t.como('lider_a');
select t.eq('JSON do clube: visita realizada é avaliável',
  t.txt(format($q$select v ->> 'avaliavel' from json_array_elements(public.clube_visitas(%L)) v where v ->> 'id' = %L$q$, t.id('clube_a'), current_setting('t91.v1'))), 'true');
select t.eq('JSON do clube: visita futura não é avaliável',
  t.txt(format($q$select v ->> 'avaliavel' from json_array_elements(public.clube_visitas(%L)) v where v ->> 'id' = %L$q$, t.id('clube_a'), current_setting('t91.v3'))), 'false');
select t.throws('nota geral é obrigatória', format('select public.clube_visita_avaliar(%L, null)', current_setting('t91.v1')), 'nota geral');
select t.throws('nota fora de 1..5 é recusada', format('select public.clube_visita_avaliar(%L, 6)', current_setting('t91.v1')), 'nota geral');
select t.throws('nota opcional fora de 1..5 é recusada', format('select public.clube_visita_avaliar(%L, 4, 0)', current_setting('t91.v1')), '1 a 5');
select t.throws('observação acima de 600 é recusada',
  format('select public.clube_visita_avaliar(%L, 4, null, null, null, %L)', current_setting('t91.v1'), repeat('x', 601)), 'muito longa');
select t.throws('visita futura não se avalia', format('select public.clube_visita_avaliar(%L, 5)', current_setting('t91.v3')), 'ainda não aconteceu');
select t.throws('visita cancelada não se avalia', format('select public.clube_visita_avaliar(%L, 5)', current_setting('t91.v4')), 'cancelada');
select t.eq('diretoria avalia a visita realizada',
  t.txt(format($q$select public.clube_visita_avaliar(%L, 4, 5, 4, null, '  Orientou muito bem as unidades.  ') ->> 'nova'$q$, current_setting('t91.v1'))), 'true');
select t.eq('diretoria avalia visita cuja data passou sem o coordenador marcar',
  t.txt(format($q$select public.clube_visita_avaliar(%L, 3) ->> 'ok'$q$, current_setting('t91.v2'))), 'true');
select t.eq('editar dentro dos 7 dias (continua uma avaliação só)',
  t.txt(format($q$select public.clube_visita_avaliar(%L, 5, 5, 4, 5, 'Orientou muito bem as unidades.') ->> 'nova'$q$, current_setting('t91.v1'))), 'false');
reset role;
select t.eq('uma avaliação por visita', (select count(*) from public.club_visit_ratings where visit_id = current_setting('t91.v1')::uuid), 1::bigint);
select t.eq('observação gravada sem espaços nas pontas',
  (select observacao from public.club_visit_ratings where visit_id = current_setting('t91.v1')::uuid), 'Orientou muito bem as unidades.');
select t.eq('notificação pessoal ao coordenador que visitou (sino) — v1 e v2',
  (select count(*) from public.notificacoes where para_usuario = t.id('c_dist') and tipo = 'visita' and titulo like '%avaliada%'
     and club_id = t.id('clube_b')), 2::bigint);
select t.eq('...e ao editar, outro aviso ("atualizada")',
  (select count(*) from public.notificacoes where para_usuario = t.id('c_dist') and tipo = 'visita' and titulo like '%atualizada%'), 1::bigint);
update public.club_visit_ratings set criada_em = now() - interval '8 days' where visit_id = current_setting('t91.v1')::uuid;
select t.como('lider_a');
select t.throws('depois de 7 dias a avaliação congela', format('select public.clube_visita_avaliar(%L, 1)', current_setting('t91.v1')), '7 dias');
select t.eq('diretoria vê a avaliação na lista do clube',
  t.txt(format($q$select v -> 'avaliacao' ->> 'geral' from json_array_elements(public.clube_visitas(%L)) v where v ->> 'id' = %L$q$, t.id('clube_a'), current_setting('t91.v1'))), '5');

select t.como('lider_b');
select t.throws('diretoria de OUTRO clube não avalia', format('select public.clube_visita_avaliar(%L, 1)', current_setting('t91.v2')), 'não encontrada');
select t.throws('diretoria de outro clube não lê as visitas do A', format('select public.clube_visitas(%L)', t.id('clube_a')), 'Sem permissão');
select t.como('membro_a');
select t.throws('membro comum não avalia', format('select public.clube_visita_avaliar(%L, 1)', current_setting('t91.v2')), 'não encontrada');
select t.throws('membro comum não lê avaliações', format('select public.clube_visitas(%L)', t.id('clube_a')), 'Sem permissão');
select t.eq('membro comum não lê a tabela direto', t.nv('select count(*) from public.club_visit_ratings'), 0);
select t.no_escopo('c_dist', 'd1');
select t.throws('coordenador não avalia a própria visita', format('select public.clube_visita_avaliar(%L, 5)', current_setting('t91.v2')), 'não encontrada');
select t.eq('coordenador não lê a tabela direto', t.nv('select count(*) from public.club_visit_ratings'), 0);

-- ==================== quem lê pelo portal ====================
select t.no_escopo('c_dist', 'd1');
select t.eq('o coordenador que visitou vê a nota', t.txt(format($q$select t.aval_portal(%L)::json ->> 'geral'$q$, current_setting('t91.v1'))), '5');
select t.eq('...e a observação', t.txt(format($q$select t.aval_portal(%L)::json ->> 'observacao'$q$, current_setting('t91.v1'))), 'Orientou muito bem as unidades.');
select t.no_escopo('c_reg', 'r2');
select t.eq('regional (acima) vê', t.txt(format($q$select t.aval_portal(%L)::json ->> 'geral'$q$, current_setting('t91.v1'))), '5');
select t.no_escopo('c_geral', 'campo');
select t.eq('coordenador geral vê', t.txt(format($q$select t.aval_portal(%L)::json ->> 'geral'$q$, current_setting('t91.v2'))), '3');
select t.no_escopo('c_sec', 'campo');
select t.eq('secretário(a) MD vê', t.txt(format($q$select t.aval_portal(%L)::json ->> 'geral'$q$, current_setting('t91.v1'))), '5');
select t.no_escopo('c_dep', 'campo');
select t.eq('departamental vê', t.txt(format($q$select t.aval_portal(%L)::json ->> 'geral'$q$, current_setting('t91.v1'))), '5');
select t.no_escopo('c_dist2', 'd2');
select t.eq('distrital de OUTRO distrito não vê a visita nem a avaliação',
  t.n(format($q$select count(*) from json_array_elements(public.escopo_visitas()) v where v ->> 'id' = %L$q$, current_setting('t91.v1'))), 0);
select t.no_escopo('c_reg1', 'r1');
select t.eq('regional de outra região não vê', t.n($q$select count(*) from json_array_elements(public.escopo_visitas())$q$), 0);
select t.no_escopo('c_dist', 'r2');
select t.eq('header forjado (distrital pedindo a região) não vê nada', t.n($q$select count(*) from json_array_elements(public.escopo_visitas())$q$), 0);
-- nível ABAIXO de quem agendou não vê: regional agenda, distrital não lê a avaliação
select t.no_escopo('c_reg', 'r2');
select set_config('t91.v5', public.escopo_visita_agendar(t.id('clube_a'), now() + interval '2 days', 'Visita regional') ->> 'id', true) is not null;
reset role;
update public.club_visits set agendada_para = now() - interval '1 day' where id = current_setting('t91.v5')::uuid;
select t.como('lider_a');
select public.clube_visita_avaliar(current_setting('t91.v5')::uuid, 2, null, null, null, 'Chegou atrasado') is not null;
reset role;
select t.eq('aviso vai para o regional (quem agendou, sem relatório)',
  (select count(*) from public.notificacoes where para_usuario = t.id('c_reg') and tipo = 'visita' and club_id = t.id('r2')), 1::bigint);
select t.no_escopo('c_dist', 'd1');
select t.eq('distrital (abaixo do regional) não vê a avaliação da visita do regional',
  t.n(format($q$select count(*) from json_array_elements(public.escopo_visitas()) v where v ->> 'id' = %L$q$, current_setting('t91.v5'))), 0);

-- ==================== grants ====================
reset role;
select t.eq('anon sem EXECUTE na RPC nova',
  has_function_privilege('anon', 'public.clube_visita_avaliar(uuid,int,int,int,int,text)', 'execute'), false);
select t.eq('helper sem EXECUTE para authenticated',
  has_function_privilege('authenticated', 'public._visita_avaliavel(public.club_visits)', 'execute'), false);

select t.fim();
rollback;
