-- SMOKE da Fase 7 em PRODUÇÃO — TUDO DENTRO DE UMA TRANSAÇÃO QUE TERMINA EM ROLLBACK (nada persiste).
-- Usa pessoas REAIS do Tenant 001 só como identidade (sem ler nome/dado pessoal) e catálogo SINTÉTICO de especialidades
-- criado e desfeito na mesma transação. Reaproveita a biblioteca de testes (supabase/tests/_lib.sql) para simular o JWT.
-- Uso: psql "$DB_URL_PRODUCAO" -v ON_ERROR_STOP=1 -v lib=/caminho/supabase/tests/_lib.sql -f scripts/smoke-fase7-producao.sql
begin;
set local statement_timeout = '120s';
set local lock_timeout = '10s';
\ir ../supabase/tests/_lib.sql
\o NUL
insert into t.ids (chave, id) values
  ('clube_a', 'bf23126e-9ec2-4077-8b02-76b159c955ba'),
  ('aluno', '97c2cf96-12ae-408f-bd99-7973545bd1ac'),
  ('aluno2', '733c565e-4b0f-4ed2-83c6-247f04886a4e'),
  ('dir1', 'a4967688-599c-48ec-b2da-818a96a666c1'),
  ('dir2', '04ed5e23-f110-487a-9174-1d2c2fef72d1'),
  ('outro_dir', '2fd90f67-83bc-4136-a9bf-51355e8a113d'),
  ('outro_aluno', '536d8519-26ae-4c9b-9704-4a21e81b290a'),
  ('coord', 'e23459f8-deab-4a51-b6a3-f6317aed93a3');
insert into t.ids (chave, id) select 'clube_b', id from public.organizational_units where slug = 'exercito-da-colina';
insert into t.ids (chave, id) values ('mc_aluno', '685f0c8b-30dc-431e-b69e-de0b37e82b42');
create function t.req(p text) returns uuid language sql stable security definer as $$
  select r.id from public.class_requirements r join public.class_sections s on s.id = r.section_id join public.classes c on c.id = s.class_id
  join public.curriculum_versions v on v.id = c.curriculum_version_id where r.manifesto_id = p and v.origem = 'oficial' and v.status = 'publicado' $$;
create function t.mr(p_user text, p_req text) returns uuid language sql stable security definer as $$
  select mr.id from public.member_requirements mr join public.member_classes mc on mc.id = mr.member_class_id
   where mr.usuario_id = t.id(p_user) and mr.requirement_id = t.req(p_req) and mc.id = t.id('mc_aluno') $$;
create function t.j(p_sql text) returns text language plpgsql as $$ declare v text; begin execute p_sql into v; return v; end $$;
\o

-- ======================= 0) sanidade do ambiente =======================
select t.eq('ledger: 510, 511, 512 e 513 presentes', (select count(*) from supabase_migrations.schema_migrations where version between '20260930000510' and '20260930000513'), 4);
select t.eq('71 modelos de relatório carregados', (select count(*) from public.requisito_modelos where alvo = 'classe'), 71);
select t.eq('o aluno real tem o requisito amigo.IV.1 na matrícula (ainda não iniciado)', (select status from public.member_requirements where id = t.mr('aluno', 'amigo.IV.1')), 'nao_iniciado');

-- ======================= 1) CLASSES: formulário, rascunho (NÃO envia), envio, devolução, correção, reenvio, histórico =======================
select t.como('aluno'); select t.pedir_clube('clube_a');
select t.ok('classe_formularios traz os formulários da matrícula numa chamada (amigo.IV.1, V.2, II.2…)',
  (public.classe_formularios(t.id('mc_aluno')) -> t.req('amigo.IV.1')::text -> 'modelo' ->> 'familia') = 'A2' and (select count(*) from json_object_keys(public.classe_formularios(t.id('mc_aluno')))) >= 5);
select t.eq('requisito_formulario informa que tem formulário', t.txt(format($q$select public.requisito_formulario(%L)->>'tem_formulario'$q$, t.req('amigo.IV.1'))), 'true');
select t.permitido('RASCUNHO parcial (autosave)', format($q$select public.requisito_relatorio_salvar(%L, %L::jsonb, '[]'::jsonb)$q$, t.req('amigo.IV.1'), '{"qualidades":["a","b","c"]}'));
reset role;
select t.eq('o rascunho NÃO enviou nada: 0 tentativas e status em_andamento', (select status || '|' || (select count(*) from public.requirement_submissions where member_requirement_id = t.mr('aluno', 'amigo.IV.1'))::text from public.member_requirements where id = t.mr('aluno', 'amigo.IV.1')), 'em_andamento|0');
select t.como('aluno'); select t.pedir_clube('clube_a');
select t.throws('enviar incompleto é recusado', format($q$select public.requisito_enviar(%L)$q$, t.req('amigo.IV.1')), 'Formulário incompleto');
select jsonb_build_object('qualidades', (select jsonb_agg('qualidade ' || g) from generate_series(1, 10) g), 'situacoes', (select jsonb_agg('situação ' || g) from generate_series(1, 4) g))::text as c1 \gset
select jsonb_build_object('qualidades', (select jsonb_agg('CORRIGIDA ' || g) from generate_series(1, 10) g), 'situacoes', (select jsonb_agg('nova situação ' || g) from generate_series(1, 4) g))::text as c2 \gset
select t.permitido('rascunho completo', format($q$select public.requisito_relatorio_salvar(%L, %L::jsonb, '[]'::jsonb)$q$, t.req('amigo.IV.1'), :'c1'));
select t.permitido('envio (tentativa 1)', format($q$select public.requisito_enviar(%L)$q$, t.req('amigo.IV.1')));
select t.como('dir1'); select t.pedir_clube('clube_a');
select t.ok('a fila da diretoria traz o CONTEÚDO estruturado e o modelo', exists (select 1 from json_array_elements(public.classe_avaliacoes_pendentes()) x where x ->> 'usuario_id' = t.id('aluno')::text and x -> 'conteudo' -> 'qualidades' ->> 0 = 'qualidade 1' and x -> 'modelo' ->> 'familia' = 'A2'));
select t.throws('devolver sem comentário é recusado', format($q$select public.requisito_avaliar(%L, 'correcao_solicitada', null)$q$, t.mr('aluno', 'amigo.IV.1')), 'Explique');
select t.permitido('diretoria devolve com comentário', format($q$select public.requisito_avaliar(%L, 'correcao_solicitada', 'Troque as 3 últimas (smoke).')$q$, t.mr('aluno', 'amigo.IV.1')));
select t.como('aluno'); select t.pedir_clube('clube_a');
select t.permitido('corrige o rascunho', format($q$select public.requisito_relatorio_salvar(%L, %L::jsonb, '[]'::jsonb)$q$, t.req('amigo.IV.1'), :'c2'));
select t.permitido('reenvia (tentativa 2)', format($q$select public.requisito_enviar(%L)$q$, t.req('amigo.IV.1')));
select t.eq('HISTÓRICO: 2 tentativas; a 1ª PRESERVADA com o conteúdo original, decisão e comentário',
  (select string_agg((x ->> 'tentativa_numero') || ':' || coalesce(x ->> 'decisao', 'sem') || ':' || (x -> 'conteudo' -> 'qualidades' ->> 0), ' | ' order by (x ->> 'tentativa_numero')::int)
     from json_array_elements(public.requisito_historico(t.mr('aluno', 'amigo.IV.1')) -> 'tentativas') x), '1:correcao_solicitada:qualidade 1 | 2:sem:CORRIGIDA 1');
reset role;
select t.throws('a tentativa antiga é IMUTÁVEL (update)', format($q$update public.requirement_submissions set conteudo = '{}'::jsonb where member_requirement_id = %L and tentativa_numero = 1$q$, t.mr('aluno', 'amigo.IV.1')), 'imutável');
select t.throws('...e (delete)', format($q$delete from public.requirement_submissions where member_requirement_id = %L$q$, t.mr('aluno', 'amigo.IV.1')), 'imutável');
select t.como('dir2'); select t.pedir_clube('clube_a');
select t.permitido('outra pessoa da diretoria aprova a tentativa 2', format($q$select public.requisito_avaliar(%L, 'aprovado', 'Ótimo (smoke)')$q$, t.mr('aluno', 'amigo.IV.1')));
select t.eq('AUDITORIA: avaliador, papel e data da confirmação (2 decisões, por tentativa)', t.txt(format($q$select count(*)::text from public.requirement_approvals a where a.member_requirement_id = %L and a.avaliado_por is not null and a.avaliado_papel is not null and a.submission_id is not null and a.created_at is not null$q$, t.mr('aluno', 'amigo.IV.1'))), '2');

-- modo compatível (tela antiga em cache): texto pelo caminho de sempre num requisito que agora tem formulário
select t.como('aluno'); select t.pedir_clube('clube_a');
select t.permitido('tela ANTIGA: salva texto e envia (amigo.II.2, sem rascunho estruturado)', format($q$select public.requisito_salvar(%L, 'Texto pelo caminho antigo (smoke).', null)$q$, t.req('amigo.II.2')));
select t.permitido('...envia', format($q$select public.requisito_enviar(%L)$q$, t.req('amigo.II.2')));
reset role;
select t.eq('...tentativa do tipo antigo (texto, sem conteúdo estruturado)', (select tipo_evidencia_entregue || '|' || coalesce(conteudo::text, 'nulo') from public.requirement_submissions where member_requirement_id = t.mr('aluno', 'amigo.II.2')), 'texto|nulo');

-- guia.V.2: a 4ª opção continua DESATIVADA
select t.eq('guia.V.2 opção 4 (nutrição/cultura física) é recusada pelo servidor',
  public._erros_em_texto(public._relatorio_validar((select schema from public.requisito_modelos where chave = 'guia.V.2'), '{"atividade":{"opcao":"nutricao_ou_cultura_fisica","dados":{}}}'::jsonb, '[]'::jsonb, true)), 'Qual atividade você escolheu?: esta opção ainda não está disponível');
select t.eq('guia.V.2 as outras 3 opções seguem válidas', coalesce(public._erros_em_texto(public._relatorio_validar((select schema from public.requisito_modelos where chave = 'guia.V.2'), '{"atividade":{"opcao":"corrida","dados":{"programa":"Treino"}}}'::jsonb, '[]'::jsonb, true)), 'ok'), 'ok');

-- ======================= 2) SEGURANÇA =======================
select t.como('aluno'); select t.pedir_clube('clube_a');
select t.throws('o aluno não avalia (sem permissão)', format($q$select public.requisito_avaliar(%L, 'aprovado', null)$q$, t.mr('aluno', 'amigo.V.2')), 'Sem permissão');
select t.como('dir1'); select t.pedir_clube('clube_a');
select t.permitido('a diretoria inicia a PRÓPRIA classe (dentro da transação)', format($q$select public.classe_iniciar((select c.id from public.classes c join public.curriculum_versions v on v.id = c.curriculum_version_id where c.manifesto_id = 'amigo' and v.status = 'publicado' and v.origem = 'oficial' limit 1))$q$));
select t.permitido('...salva e envia o próprio relatório', format($q$select public.requisito_relatorio_salvar(%L, %L::jsonb, '[]'::jsonb)$q$, t.req('amigo.IV.1'), :'c1'));
select t.permitido('...envia', format($q$select public.requisito_enviar(%L)$q$, t.req('amigo.IV.1')));
select t.throws('a DIRETORIA não aprova o próprio requisito', format($q$select public.requisito_avaliar((select mr.id from public.member_requirements mr where mr.usuario_id = t.id('dir1') and mr.requirement_id = %L), 'aprovado', null)$q$, t.req('amigo.IV.1')), 'próprio requisito');
select t.como('outro_dir'); select t.pedir_clube('clube_b');
select t.throws('diretoria de OUTRO clube não lê o histórico', format($q$select public.requisito_historico(%L)$q$, t.mr('aluno', 'amigo.IV.1')), 'não encontrado');
select t.throws('...nem avalia (UUID de outro clube)', format($q$select public.requisito_avaliar(%L, 'aprovado', null)$q$, t.mr('aluno', 'amigo.II.2')), 'não encontrado');
select t.eq('...a fila dele não traz nada do Tenant 001', t.nv($q$select count(*) from json_array_elements(public.classe_avaliacoes_pendentes()) x where x ->> 'usuario_id' = (select id::text from t.ids where chave = 'aluno')$q$), 0);
select t.throws('...nem abre os formulários da matrícula', format($q$select public.classe_formularios(%L)$q$, t.id('mc_aluno')), 'não encontrada');
select t.eq('...RLS: 0 tentativas e 0 rascunhos do Tenant 001', t.nv('select count(*) from public.requirement_submissions where club_id = (select id from t.ids where chave = ''clube_a'')') + t.nv('select count(*) from public.member_requirements where club_id = (select id from t.ids where chave = ''clube_a'')'), 0);
select t.como('coord');
select t.throws('coordenação distrital não lê o histórico', format($q$select public.requisito_historico(%L)$q$, t.mr('aluno', 'amigo.IV.1')));
select t.eq('...nem as tentativas pelas tabelas', t.nv('select count(*) from public.requirement_submissions'), 0);
select t.como('aluno2'); select t.pedir_clube('clube_a');
select t.throws('OUTRO aluno do mesmo clube não lê o histórico do colega', format($q$select public.requisito_historico(%L)$q$, t.mr('aluno', 'amigo.IV.1')), 'não encontrado');
reset role;
-- anon: nada das estruturas novas
select t.eq('anon NÃO executa as RPCs novas', (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace
   and p.proname in ('requisito_formulario', 'requisito_relatorio_salvar', 'classe_formularios', 'especialidade_historico', 'especialidade_requisito_relatorio_salvar', 'especialidades_buscar', 'requisito_historico', 'classe_avaliacoes_pendentes')
   and has_function_privilege('anon', p.oid, 'execute')), 0);
select t.eq('anon/authenticated NÃO acessam as tabelas novas (só RPC/RLS)',
  (select count(*) from information_schema.table_privileges where table_schema = 'public' and grantee in ('anon', 'authenticated')
    and table_name in ('requisito_modelos', 'specialty_requirement_groups') ) + (select count(*) from information_schema.table_privileges where table_schema = 'public' and grantee = 'anon' and table_name = 'specialty_requirement_submissions')
  + (select count(*) from information_schema.table_privileges where table_schema = 'public' and grantee = 'authenticated' and table_name = 'specialty_requirement_submissions' and privilege_type <> 'SELECT'), 0);

-- anexos: só do dono/clube, visíveis só à liderança do clube certo
insert into storage.objects (bucket_id, name, owner_id) values
  ('comprovacoes', t.id('aluno')::text || '/requisitos/smoke-1.png', t.id('aluno')::text),
  ('comprovacoes', t.id('aluno2')::text || '/requisitos/smoke-alheio.png', t.id('aluno2')::text);
select t.eq('anexo do PRÓPRIO usuário, existente: aceito', coalesce(public._erros_em_texto(public._anexos_do_dono_erros(jsonb_build_array(jsonb_build_object('campo','fotos','path', t.id('aluno')::text || '/requisitos/smoke-1.png')), t.id('aluno'), t.id('clube_a'))), 'ok'), 'ok');
select t.ok('anexo de OUTRO usuário é recusado', public._erros_em_texto(public._anexos_do_dono_erros(jsonb_build_array(jsonb_build_object('campo','fotos','path', t.id('aluno2')::text || '/requisitos/smoke-alheio.png')), t.id('aluno'), t.id('clube_a'))) like '%não é seu%');
select t.ok('anexo no caminho de OUTRO clube é recusado', public._erros_em_texto(public._anexos_do_dono_erros(jsonb_build_array(jsonb_build_object('campo','fotos','path', t.id('clube_b')::text || '/' || t.id('aluno')::text || '/requisitos/x.png')), t.id('aluno'), t.id('clube_a'))) like '%outro clube%');
insert into public.requirement_submissions (member_requirement_id, tentativa_numero, tipo_evidencia_entregue, conteudo, anexos, modelo_versao)
values (t.mr('aluno', 'amigo.V.2'), 1, 'relatorio', '{}'::jsonb, jsonb_build_array(jsonb_build_object('campo', 'fotos', 'path', t.id('aluno')::text || '/requisitos/smoke-1.png')), 1);
select t.como('dir1'); select t.pedir_clube('clube_a');
select t.ok('a liderança do clube do aluno ABRE o anexo', public.lideranca_ve_comprovacao(t.id('aluno')::text || '/requisitos/smoke-1.png'));
select t.como('outro_dir'); select t.pedir_clube('clube_b');
select t.ok('a liderança de OUTRO clube NÃO abre o anexo', not public.lideranca_ve_comprovacao(t.id('aluno')::text || '/requisitos/smoke-1.png'));
reset role;

-- ======================= 3) ESPECIALIDADES — só o MOTOR, com catálogo SINTÉTICO desfeito no ROLLBACK =======================
\o NUL
insert into public.curriculum_versions (id, origem, identificador, versao, vigente_desde, status, fonte_descricao)
values ('00000000-0000-4000-a000-000000000777', 'oficial', 'sintetico-smoke-fase7', '1', current_date, 'publicado', '[TESTE] sintético do smoke — desfeito no rollback');
create temp table _ar (cod text, qtd int) on commit drop;
insert into _ar values ('AR', 70), ('EN', 50), ('HM', 40);
insert into public.specialties (id, curriculum_version_id, codigo, nome, categoria, nivel, ordem)
select public.curriculo_uuid('smk:' || a.cod || g), '00000000-0000-4000-a000-000000000777', a.cod || '-' || lpad(g::text, 3, '0'), '[TESTE] Sintética ' || a.cod || ' ' || g, a.cod, '1', g from _ar a, lateral generate_series(1, a.qtd) g;
insert into public.specialty_requirements (specialty_id, codigo, descricao, tipo_evidencia, ordem, modelo)
select s.id, r::text, '[TESTE] req ' || r, 'resposta', r * 10, '{"versao":1,"campos":[{"chave":"resposta","tipo":"texto_longo","rotulo":"Resposta","obrigatorio":true,"max":500}]}'::jsonb
  from public.specialties s, generate_series(1, 3) r where s.curriculum_version_id = '00000000-0000-4000-a000-000000000777';
select t.como_cron();
insert into public.club_features (club_id, feature, enabled) values (t.id('clube_a'), 'especialidades', true), (t.id('clube_b'), 'especialidades', true)
  on conflict (club_id, feature) do update set enabled = true;
reset role;
create function t.esp(p text) returns uuid language sql stable security definer as $$ select public.curriculo_uuid('smk:' || p) $$;
create function t.paginar(p_busca text default null, p_area text default null, p_situacao text default 'todas', p_limite int default 25) returns text
language plpgsql as $$
declare v json; v_c text; v_pag int := 0; v_n int := 0; v_ant text := ''; v_ord boolean := true; it json; v_cods text[] := '{}';
begin
  loop
    v := public.especialidades_buscar(p_busca, p_area, p_situacao, p_limite, v_c); v_pag := v_pag + 1;
    for it in select * from json_array_elements(v -> 'itens') loop
      v_n := v_n + 1; if (it ->> 'categoria') || '|' || (it ->> 'codigo') <= v_ant then v_ord := false; end if;
      v_ant := (it ->> 'categoria') || '|' || (it ->> 'codigo'); v_cods := v_cods || (it ->> 'codigo');
    end loop;
    v_c := v ->> 'proximo'; exit when v_c is null or v_pag > 100;
  end loop;
  return v_pag || '|' || v_n || '|' || (select count(distinct x) from unnest(v_cods) x) || '|' || v_ord;
end $$;
\o
select t.como('aluno'); select t.pedir_clube('clube_a');
select t.eq('busca paginada percorre as 160 sintéticas em 7 páginas de 25, sem repetir, em ordem', t.paginar(), '7|160|160|true');
select t.eq('filtro por área EN: 50', split_part(t.paginar(null, 'EN'), '|', 2), '50');
select t.eq('busca por texto "Sintética HM 1": HM-001, HM-010…HM-019 (11)', split_part(t.paginar('Sintética HM 1'), '|', 2), (select count(*)::text from public.specialties where curriculum_version_id = '00000000-0000-4000-a000-000000000777' and nome ilike '%Sintética HM 1%'));
select t.eq('curinga % é literal', split_part(t.paginar('%'), '|', 2), '0');
select t.eq('limite 100000 vira 50', t.nv($q$select json_array_length(public.especialidades_buscar(null, null, 'todas', 100000, null) -> 'itens')$q$), 50);
select t.permitido('o aluno começa 2 especialidades sintéticas', format($q$select public.especialidade_iniciar(%L), public.especialidade_iniciar(%L)$q$, t.esp('AR1'), t.esp('AR2')));
select t.eq('situação "iniciadas": 2; "disponiveis": 158', split_part(t.paginar(null, null, 'iniciadas'), '|', 2) || '|' || split_part(t.paginar(null, null, 'disponiveis'), '|', 2), '2|158');
select t.como('aluno2'); select t.pedir_clube('clube_a');
select t.eq('PROGRESSO NÃO VAZA: outro aluno do mesmo clube vê 0 iniciadas', split_part(t.paginar(null, null, 'iniciadas'), '|', 2), '0');
select t.como('outro_aluno'); select t.pedir_clube('clube_b');
select t.eq('OUTRO CLUBE: 0 iniciadas (e não vê o que o Tenant 001 faz)', split_part(t.paginar(null, null, 'iniciadas'), '|', 2), '0');
-- fluxo completo de uma especialidade (motor) com histórico
select t.como('aluno'); select t.pedir_clube('clube_a');
select t.permitido('rascunho estruturado da especialidade', format($q$select public.especialidade_requisito_relatorio_salvar((select id from public.specialty_requirements where specialty_id = %L and codigo = '1'), '{"resposta":"primeira"}'::jsonb, '[]'::jsonb)$q$, t.esp('AR1')));
select t.permitido('envia (tentativa 1)', format($q$select public.especialidade_requisito_enviar((select id from public.specialty_requirements where specialty_id = %L and codigo = '1'))$q$, t.esp('AR1')));
select t.como('dir1'); select t.pedir_clube('clube_a');
select t.permitido('diretoria devolve com comentário', format($q$select public.especialidade_requisito_avaliar((select m.id from public.member_specialty_requirements m where m.usuario_id = t.id('aluno') and m.specialty_requirement_id = (select id from public.specialty_requirements where specialty_id = %L and codigo = '1')), 'correcao_solicitada', 'Escreva mais (smoke).')$q$, t.esp('AR1')));
select t.como('aluno'); select t.pedir_clube('clube_a');
select t.permitido('corrige e reenvia (tentativa 2)', format($q$select public.especialidade_requisito_relatorio_salvar((select id from public.specialty_requirements where specialty_id = %L and codigo = '1'), '{"resposta":"segunda, mais completa"}'::jsonb, '[]'::jsonb), public.especialidade_requisito_enviar((select id from public.specialty_requirements where specialty_id = %L and codigo = '1'))$q$, t.esp('AR1'), t.esp('AR1')));
select t.eq('HISTÓRICO da especialidade: 2 tentativas, a 1ª preservada', (select string_agg((x ->> 'tentativa_numero') || ':' || coalesce(x ->> 'decisao', 'sem') || ':' || (x -> 'conteudo' ->> 'resposta'), ' | ' order by (x ->> 'tentativa_numero')::int)
   from json_array_elements(public.especialidade_historico((select m.id from public.member_specialty_requirements m where m.usuario_id = t.id('aluno') and m.specialty_requirement_id = (select id from public.specialty_requirements where specialty_id = t.esp('AR1') and codigo = '1')) ) -> 'tentativas') x),
  '1:correcao_solicitada:primeira | 2:sem:segunda, mais completa');
select t.como('outro_dir'); select t.pedir_clube('clube_b');
select t.throws('diretoria de OUTRO clube não lê o histórico da especialidade', format($q$select public.especialidade_historico((select m.id from public.member_specialty_requirements m where m.usuario_id = t.id('aluno') and m.specialty_requirement_id = (select id from public.specialty_requirements where specialty_id = %L and codigo = '1')))$q$, t.esp('AR1')), 'não encontrado');
select t.como('coord');
select t.throws('coordenação não lê o histórico da especialidade', format($q$select public.especialidade_historico((select m.id from public.member_specialty_requirements m where m.usuario_id = t.id('aluno') limit 1))$q$));
reset role;

select * from t.fim();
rollback;
