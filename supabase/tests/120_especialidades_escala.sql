-- Fase 7 (migration 513): as Especialidades em ESCALA. Dados SINTÉTICOS, só nesta transação (ROLLBACK): nada disto é catálogo
-- de verdade nem vai para migration. Prova que a arquitetura aguenta ~552 especialidades / ~5.500 requisitos com busca, filtro por
-- área, paginação por cursor, iniciadas/concluídas/progresso e dependências — sem devolver o catálogo inteiro numa chamada.
begin;
\ir _lib.sql
\ir _fixtures.sql

-- ---------- catálogo sintético: 552 especialidades em 9 áreas, 10 requisitos cada (5.520 linhas) ----------
\o /dev/null
insert into public.curriculum_versions (id, origem, identificador, versao, vigente_desde, status, fonte_descricao)
values ('00000000-0000-4000-a000-000000000120', 'oficial', 'sintetico-escala-120', '1', current_date, 'publicado', '[TESTE] dado sintético de escala');
create temp table _areas (ord int, cod text, qtd int) on commit drop;
insert into _areas values (1,'AA',16),(2,'AD',9),(3,'AM',58),(4,'AP',68),(5,'AR',119),(6,'CS',43),(7,'EN',105),(8,'HD',13),(9,'HM',121);
insert into public.specialties (id, curriculum_version_id, codigo, nome, categoria, nivel, ordem)
select public.curriculo_uuid('esc120:' || a.cod || g), '00000000-0000-4000-a000-000000000120', a.cod || '-' || lpad(g::text, 3, '0'),
       '[TESTE] Sintética ' || a.cod || ' ' || g || case when g % 7 = 0 then ' Ação' else '' end, a.cod, (g % 3 + 1)::text, g
  from _areas a, lateral generate_series(1, a.qtd) g;
insert into public.specialty_requirements (specialty_id, codigo, descricao, tipo_evidencia, ordem)
select s.id, r::text, '[TESTE] requisito ' || r, 'texto', r * 10 from public.specialties s, generate_series(1, 10) r
 where s.curriculum_version_id = '00000000-0000-4000-a000-000000000120';
-- 36 especialidades dependem de outra: as de número 2 a 5 de cada área dependem da número 1
insert into public.curriculum_dependencies (alvo_tipo, alvo_id, depende_de_tipo, depende_de_id)
select 'specialty', public.curriculo_uuid('esc120:' || a.cod || g), 'specialty', public.curriculo_uuid('esc120:' || a.cod || '1')
  from _areas a, lateral generate_series(2, 5) g;
select t.como_cron();
insert into public.club_features (club_id, feature, enabled) values (t.id('clube_a'), 'especialidades', true), (t.id('clube_b'), 'especialidades', true)
on conflict (club_id, feature) do update set enabled = true;
reset role;
create function t.esp(p text) returns uuid language sql stable security definer as $$ select public.curriculo_uuid('esc120:' || p) $$;
-- percorre TODAS as páginas seguindo o cursor: devolve 'páginas|itens|distintos|ordenado|maior_página|maior_bytes'
create function t.paginar(p_busca text default null, p_area text default null, p_situacao text default 'todas', p_limite int default 50) returns text
language plpgsql as $$
declare v json; v_cursor text; v_pag int := 0; v_itens int := 0; v_maior int := 0; v_bytes int := 0; v_ant text := ''; v_ord boolean := true; it json; v_todos text[] := '{}';
begin
  loop
    v := public.especialidades_buscar(p_busca, p_area, p_situacao, p_limite, v_cursor);
    v_pag := v_pag + 1;
    v_maior := greatest(v_maior, json_array_length(v -> 'itens'));
    v_bytes := greatest(v_bytes, length(v::text));
    for it in select * from json_array_elements(v -> 'itens') loop
      v_itens := v_itens + 1;
      if (it ->> 'categoria') || '|' || (it ->> 'codigo') <= v_ant then v_ord := false; end if;
      v_ant := (it ->> 'categoria') || '|' || (it ->> 'codigo');
      v_todos := v_todos || (it ->> 'codigo');
    end loop;
    v_cursor := v ->> 'proximo';
    exit when v_cursor is null or v_pag > 200;
  end loop;
  return v_pag || '|' || v_itens || '|' || (select count(distinct x) from unnest(v_todos) x) || '|' || v_ord || '|' || v_maior || '|' || v_bytes;
end $$;
\o

select t.eq('catálogo sintético: 552 especialidades e 5.520 requisitos',
  (select count(*) from public.specialties where curriculum_version_id = '00000000-0000-4000-a000-000000000120')::text || '|' ||
  (select count(*) from public.specialty_requirements r join public.specialties s on s.id = r.specialty_id where s.curriculum_version_id = '00000000-0000-4000-a000-000000000120')::text, '552|5520');

-- ---------- 1) o catálogo todo NUNCA vem numa chamada só ----------
select t.como('membro_a'); select t.pedir_clube('clube_a');
select clock_timestamp() as t0 \gset
select t.paginar() as todas \gset
select (extract(epoch from clock_timestamp() - :'t0'::timestamptz) * 1000)::int as ms_todas \gset
select t.eq('percorrer TUDO por cursor: 12 páginas, 552 itens, 552 distintos (sem repetir nem pular), ordem estável, página ≤ 50',
  split_part(:'todas', '|', 1) || '|' || split_part(:'todas', '|', 2) || '|' || split_part(:'todas', '|', 3) || '|' || split_part(:'todas', '|', 4) || '|' || (split_part(:'todas', '|', 5)::int <= 50)::text, '12|552|552|true|true');
select t.ok('cada página é LEVE para 4G (máx. ' || split_part(:'todas', '|', 6) || ' bytes < 40 KB)', split_part(:'todas', '|', 6)::int < 40000);
\echo    [medida] percorrer as 12 páginas: :ms_todas ms; maior página: :todas (páginas|itens|distintos|ordenado|maior_itens|maior_bytes)
select t.ok('as 12 páginas em ' || :'ms_todas' || ' ms (limite 8000 ms; mede o pior caso de um banco pequeno)', :'ms_todas'::int < 8000);
select t.eq('limite absurdo (100000) é reduzido a 50', t.nv($q$select json_array_length(public.especialidades_buscar(null, null, 'todas', 100000, null) -> 'itens')$q$), 50);
select t.eq('limite 0 vira 1', t.nv($q$select json_array_length(public.especialidades_buscar(null, null, 'todas', 0, null) -> 'itens')$q$), 1);
select t.eq('a 1ª página traz as 9 áreas com contagem (para os filtros)', t.nv($q$select json_array_length(public.especialidades_buscar(null, null, 'todas', 10, null) -> 'areas')$q$), 9);
select t.eq('as páginas seguintes NÃO repetem a lista de áreas', t.txt($q$select (public.especialidades_buscar(null, null, 'todas', 10, 'AA|AA-010') -> 'areas')::text$q$), '[]');
select t.eq('total reflete o filtro (552)', t.nv($q$select (public.especialidades_buscar(null, null, 'todas', 10, null) ->> 'total')::int$q$), 552);

-- ---------- 2) filtro por área e busca ----------
select t.eq('área HM: 121 itens percorridos', split_part(t.paginar(null, 'HM'), '|', 2), '121');
select t.eq('área inexistente: 0', split_part(t.paginar(null, 'ZZ'), '|', 2), '0');
select t.eq('busca por código "AR-11" (AR-011, AR-110…AR-119)', split_part(t.paginar('AR-11'), '|', 2), (select count(*)::text from public.specialties where curriculum_version_id = '00000000-0000-4000-a000-000000000120' and codigo ilike '%AR-11%'));
select t.eq('busca por nome (com acento, sem diferenciar caixa): "ação"', split_part(t.paginar('ação'), '|', 2), (select count(*)::text from public.specialties where curriculum_version_id = '00000000-0000-4000-a000-000000000120' and nome ilike '%ação%'));
select t.eq('busca + área juntas', split_part(t.paginar('Sintética', 'AD'), '|', 2), '9');
select t.eq('curinga "%" digitado é LITERAL (não vira "tudo")', split_part(t.paginar('%'), '|', 2), '0');
select t.eq('"_" digitado é literal', split_part(t.paginar('_'), '|', 2), '0');
select t.eq('texto grande demais é cortado sem erro', t.nv($q$select json_array_length(public.especialidades_buscar(repeat('a', 5000), null, 'todas', 5, null) -> 'itens')$q$), 0);
select t.throws('situação inválida é recusada', $q$select public.especialidades_buscar(null, null, 'xyz', 5, null)$q$, 'Situação inválida');
select t.throws('cursor inválido é recusado', $q$select public.especialidades_buscar(null, null, 'todas', 5, 'lixo')$q$, 'Cursor inválido');
select t.permitido('cursor com SQL dentro é só TEXTO (inerte: vai como parâmetro, nunca é executado)', $q$select public.especialidades_buscar(null, null, 'todas', 5, $x$AA|x'; drop table public.profiles; --$x$)$q$);
reset role;
select t.eq('...e nada foi apagado', (select count(*) > 0 from public.profiles)::text, 'true');

-- ---------- 3) iniciadas, concluídas, progresso ----------
select t.como('membro_a'); select t.pedir_clube('clube_a');
\o /dev/null
select public.especialidade_iniciar(t.esp('AR1')), public.especialidade_iniciar(t.esp('EN1'));
reset role;
-- concluir AR-001 e EN-001 (todos os requisitos aprovados; o gatilho conclui e emite a conquista) — libera as que dependem delas
update public.member_specialty_requirements set status = 'aprovado'
 where usuario_id = t.id('membro_a') and specialty_requirement_id in (select r.id from public.specialty_requirements r where r.specialty_id in (t.esp('AR1'), t.esp('EN1')));
select t.como('membro_a'); select t.pedir_clube('clube_a');
select public.especialidade_iniciar(t.esp(a || g)) from (values ('AR'), ('EN')) v(a), generate_series(2, 15) g where g <> 5;   -- AR-005 fica DISPONÍVEL (depende de AR-001, concluída)
reset role;
\o
update public.member_specialty_requirements set status = 'aprovado'
 where usuario_id = t.id('membro_a') and specialty_requirement_id in (select r.id from public.specialty_requirements r where r.specialty_id in (t.esp('AR2'), t.esp('AR3'), t.esp('EN2')));
update public.member_specialty_requirements set status = 'aprovado'
 where usuario_id = t.id('membro_a') and specialty_requirement_id in (select r.id from public.specialty_requirements r where r.specialty_id = t.esp('AR4') and r.codigo::int <= 5);
select t.eq('gatilho concluiu as 5 especialidades', (select count(*) from public.member_specialties where usuario_id = t.id('membro_a') and status = 'concluida'), 5);
select t.eq('a pessoa iniciou 28 no total', (select count(*) from public.member_specialties where usuario_id = t.id('membro_a')), 28);
select t.como('membro_a'); select t.pedir_clube('clube_a');
select t.eq('situação "iniciadas": 23 (28 iniciadas − 5 concluídas)', split_part(t.paginar(null, null, 'iniciadas'), '|', 2), '23');
select t.eq('situação "concluidas": 5', split_part(t.paginar(null, null, 'concluidas'), '|', 2), '5');
select t.eq('situação "disponiveis": 524 (552 − 28 iniciadas)', split_part(t.paginar(null, null, 'disponiveis'), '|', 2), '524');
select t.eq('progresso: concluída = 100%, a metade de AR-004 = 50%, situação da concluída',
  t.txt($q$select (select (x ->> 'percentual') from json_array_elements(public.especialidades_buscar(null, 'AR', 'todas', 50, null) -> 'itens') x where x ->> 'codigo' = 'AR-001') || '|' ||
              (select (x ->> 'percentual') from json_array_elements(public.especialidades_buscar(null, 'AR', 'todas', 50, null) -> 'itens') x where x ->> 'codigo' = 'AR-004') || '|' ||
              (select (x ->> 'situacao') from json_array_elements(public.especialidades_buscar(null, 'AR', 'todas', 50, null) -> 'itens') x where x ->> 'codigo' = 'AR-001')$q$), '100|50|concluida');
select t.eq('a disponível traz percentual nulo e situação "disponivel"',
  t.txt($q$select (x ->> 'situacao') || '|' || coalesce(x ->> 'percentual', 'nulo') from json_array_elements(public.especialidades_buscar(null, 'HM', 'todas', 50, null) -> 'itens') x where x ->> 'codigo' = 'HM-010'$q$), 'disponivel|nulo');

-- ---------- 4) dependências ----------
select t.eq('AM-002 depende de AM-001 (que a pessoa NÃO concluiu): aparece com a pendência',
  t.txt($q$select (x -> 'dependencias_pendentes' ->> 0) from json_array_elements(public.especialidades_buscar(null, 'AM', 'todas', 50, null) -> 'itens') x where x ->> 'codigo' = 'AM-002'$q$),
  (select nome from public.specialties where id = t.esp('AM1')));
select t.eq('AR-005 (disponível) depende de AR-001 (CONCLUÍDA pela pessoa): sem pendência',
  t.txt($q$select (x -> 'dependencias_pendentes')::text from json_array_elements(public.especialidades_buscar(null, 'AR', 'todas', 50, null) -> 'itens') x where x ->> 'codigo' = 'AR-005'$q$), '[]');
select t.throws('iniciar uma especialidade com dependência pendente continua recusado', format($q$select public.especialidade_iniciar(%L)$q$, t.esp('AM2')), 'Falta concluir');
reset role;

-- ---------- 5) isolamento: o progresso é da PESSOA e do CLUBE em uso ----------
select t.como('membro_a2'); select t.pedir_clube('clube_a');
select t.eq('outra pessoa do mesmo clube: 0 iniciadas, 0 concluídas (nada vaza)', split_part(t.paginar(null, null, 'iniciadas'), '|', 2) || '|' || split_part(t.paginar(null, null, 'concluidas'), '|', 2), '0|0');
select t.como('lider_b'); select t.pedir_clube('clube_b');
select t.eq('liderança do OUTRO clube não vê o progresso do membro_a', split_part(t.paginar(null, null, 'iniciadas'), '|', 2), '0');
select t.como('membro_a'); select t.pedir_clube('clube_b');
select t.eq('a MESMA pessoa sem vínculo no clube B: lista vazia', t.nv($q$select (public.especialidades_buscar(null, null, 'todas', 10, null) ->> 'total')::int$q$), 0);
reset role;
select t.como_anon();
select t.eq('anon não executa', has_function_privilege('anon', 'public.especialidades_buscar(text,text,text,int,text)', 'execute')::text, 'false');
reset role;
select t.como_cron();
update public.club_features set enabled = false where club_id = t.id('clube_a') and feature = 'especialidades';
select t.como('membro_a'); select t.pedir_clube('clube_a');
select t.throws('recurso desligado: recusado no SERVIDOR', $q$select public.especialidades_buscar(null, null, 'todas', 10, null)$q$, 'não estão liberadas');
reset role;

-- ---------- 6) uma especialidade grande abre sem carregar as outras ----------
select t.como_cron();
update public.club_features set enabled = true where club_id = t.id('clube_a') and feature = 'especialidades';
select t.como('membro_a'); select t.pedir_clube('clube_a');
select clock_timestamp() as t1 \gset
select json_array_length(public.minha_especialidade((select id from public.member_specialties where usuario_id = t.id('membro_a') and specialty_id = t.esp('AR4')) ) -> 'requisitos') as n \gset
select (extract(epoch from clock_timestamp() - :'t1'::timestamptz) * 1000)::int as ms_minha \gset
\echo    [medida] minha_especialidade (1 de 552): :ms_minha ms
select t.eq('minha_especialidade abre só a escolhida (10 requisitos, nenhum das outras 551)', :'n'::text, '10');
select t.ok('...em ' || :'ms_minha' || ' ms (limite 1500 ms)', :'ms_minha'::int < 1500);
reset role;

select * from t.fim();
rollback;
