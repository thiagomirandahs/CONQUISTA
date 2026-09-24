-- Fase 9.1 (item 9, migration 83) — ESPECIALIDADES FORA DO PILOTO.
--
-- O dono decidiu: o piloto multi-clube roda com as Classes (catálogo OFICIAL 2026.2) e SEM
-- especialidades, porque o único catálogo de especialidades que existe é de TESTE. Até a 83:
--   · as especialidades viviam atrás do recurso 'classes' — ligar as Classes levava junto o [TESTE];
--   · a própria liderança do clube ligava o recurso (tela, REST direto em club_features, onboarding);
--   · o catálogo de teste entrava no fluxo normal justamente por FALTAR o oficial;
--   · as RPCs de leitura não checavam recurso nenhum, e a RLS do catálogo mostrava o [TESTE] a qualquer
--     conta logada.
-- Este teste é o gate permanente disso, com dois clubes (A = Tenant 001, B = clube de teste):
--   1) a liderança NÃO liga 'especialidades' — nem pela RPC, nem por INSERT/UPDATE direto em
--      club_features, nem pelo onboarding; só a plataforma;
--   2) com 'classes' ligado e 'especialidades' desligado, TODA RPC de especialidade recusa;
--   3) com a plataforma ligando, funciona — e SÓ com catálogo oficial (o piloto não aparece nem em
--      matrícula antiga);
--   4) nenhum [TESTE] chega a membro: nem por RPC, nem por REST, nem pelo diff de versões, nem pelas
--      experiências [TESTE] que a migration 49 semeava no clube legado.
begin;
\ir _lib.sql
\ir _fixtures.sql

insert into t.ids (chave, id) values
  ('esp_piloto', '00000000-0000-4000-a000-000000000102'::uuid),
  ('versao_esp_piloto', '00000000-0000-4000-a000-000000000101'::uuid),
  ('classe_piloto', '00000000-0000-4000-a000-000000000002'::uuid),
  ('versao_oficial_esp', '00000000-0000-4000-a000-000000000621'::uuid),
  ('esp_oficial', '00000000-0000-4000-a000-000000000622'::uuid),
  ('req_oficial', '00000000-0000-4000-a000-000000000623'::uuid);
insert into t.ids (chave, id) select 'req_piloto_1', id from public.specialty_requirements where specialty_id = t.id('esp_piloto') and codigo = '1';

-- 'classes' LIGADO nos dois clubes (a liderança pode): é o cenário do piloto
insert into public.club_features (club_id, feature, enabled) values (t.id('clube_a'), 'classes', true), (t.id('clube_b'), 'classes', true)
on conflict (club_id, feature) do update set enabled = true;

-- o catálogo OFICIAL de especialidades ainda não existe: a fixture o simula, primeiro em RASCUNHO
-- (é como a plataforma o receberia antes de publicar)
insert into public.curriculum_versions (id, origem, identificador, versao, status, fonte_descricao)
values (t.id('versao_oficial_esp'), 'oficial', 'especialidades-oficiais-fixture-62', '1', 'rascunho',
        'FIXTURE do teste 62: simula o catálogo oficial de especialidades publicado pela plataforma.');
insert into public.specialties (id, curriculum_version_id, codigo, nome, ordem)
values (t.id('esp_oficial'), t.id('versao_oficial_esp'), 'oficial_fixture', 'Especialidade Oficial (fixture)', 10);
insert into public.specialty_requirements (id, specialty_id, codigo, descricao, tipo_evidencia, evidencia_obrigatoria, ordem)
values (t.id('req_oficial'), t.id('esp_oficial'), '1', 'Requisito da especialidade oficial (fixture).', 'texto', false, 10);

-- dado ANTIGO que sobrou do tempo em que o piloto estava no fluxo (existe no staging): uma matrícula
-- [TESTE] de membro_a no A, com um requisito aguardando avaliação, e uma turma [TESTE]
\o /dev/null
select public._especialidade_matricular(t.id('membro_a'), t.id('clube_a'), t.id('esp_piloto'), null);
\o
insert into t.ids (chave, id) select 'ms_piloto_a', id from public.member_specialties where usuario_id = t.id('membro_a') and specialty_id = t.id('esp_piloto');
update public.member_specialty_requirements set status = 'aguardando_avaliacao', enviado_em = now(), evidencia_texto = 'resposta antiga [TESTE]'
 where member_specialty_id = t.id('ms_piloto_a') and specialty_requirement_id = t.id('req_piloto_1');
insert into public.specialty_offerings (club_id, specialty_id, titulo, criado_por) values (t.id('clube_a'), t.id('esp_piloto'), 'Turma piloto antiga', t.id('lider_a'));

-- administrador da plataforma (fora de organization_memberships, como na fase 5)
select t.signup('admin_62', '{"tipo":"fundador","nome":"Admin da Plataforma 62"}'::jsonb);
insert into public.platform_admins (user_id, papel, motivo) values (t.id('admin_62'), 'operacao', 'teste 62');
select t.signup('fundador_62', '{"tipo":"fundador","nome":"Fundador 62"}'::jsonb);

-- =============================================================================
-- 1) O CATÁLOGO: especialidades é recurso próprio, desligado, SÓ da plataforma
-- =============================================================================
select t.eq('a chave "especialidades" existe, nasce DESLIGADA e é somente da plataforma',
  t.txt($q$select padrao::text || '|' || somente_plataforma::text from public.recursos_catalogo where chave = 'especialidades'$q$), 'false|true');
select t.eq('"classes" continua sendo da liderança (não é somente da plataforma) e não se apresenta mais como "dados de teste"',
  t.txt($q$select somente_plataforma::text || '|' || (descricao ilike '%teste%')::text from public.recursos_catalogo where chave = 'classes'$q$), 'false|false');
select t.eq('com "classes" LIGADO, "especialidades" continua DESLIGADO nos dois clubes (não vem mais de carona)',
  public.recurso_habilitado_no_clube(t.id('clube_a'), 'classes')::text || '|' || public.recurso_habilitado_no_clube(t.id('clube_a'), 'especialidades')::text
  || '|' || public.recurso_habilitado_no_clube(t.id('clube_b'), 'especialidades')::text, 'true|false|false');
select t.como('multi_dois_papeis');
select t.eq('meu_contexto (o que o front usa para o menu) diz especialidades = false nas duas abas',
  t.txt($q$select string_agg(v->>'nome' || '=' || (v->'recursos'->>'especialidades'), ',' order by v->>'nome') from jsonb_array_elements(public.meu_contexto()->'vinculos') v$q$),
  'Clube B (teste)=false,Filhos da Conquista=false');
select t.eq('o catálogo que o front lê traz a marca "somente_plataforma" (a tela de recursos não oferece switch)',
  t.txt($q$select somente_plataforma::text from public.recursos_catalogo where chave = 'especialidades'$q$), 'true');
reset role;

-- =============================================================================
-- 2) A LIDERANÇA NÃO LIGA (nem desliga) — por nenhuma porta
-- =============================================================================
select t.como_cron();   -- a plataforma deixa uma linha explícita (desligada) no A, para as tentativas de UPDATE/DELETE
insert into public.club_features (club_id, feature, enabled) values (t.id('clube_a'), 'especialidades', false)
on conflict (club_id, feature) do update set enabled = false;

select t.como('lider_a'); select t.pedir_clube('clube_a');
select t.throws('[tela] diretoria do A NÃO liga especialidades pela RPC', $q$select public.recurso_definir('especialidades', true)$q$, 'liberado pela plataforma');
select t.throws('[tela] ...nem desliga', $q$select public.recurso_definir('especialidades', false)$q$, 'liberado pela plataforma');
select t.bloqueado('[REST] ...nem por INSERT direto em club_features (a policy da liderança não alcança chave da plataforma)',
  format($q$insert into public.club_features (club_id, feature, enabled) values (%L, 'especialidades', true)
           on conflict (club_id, feature) do update set enabled = true$q$, t.id('clube_a')));
select t.bloqueado('[REST] ...nem por UPDATE da linha que a plataforma deixou',
  format($q$update public.club_features set enabled = true where club_id = %L and feature = 'especialidades'$q$, t.id('clube_a')));
select t.bloqueado('[REST] ...nem apagando a linha', format($q$delete from public.club_features where club_id = %L and feature = 'especialidades'$q$, t.id('clube_a')));
select t.permitido('(controle) a mesma diretoria continua ligando/desligando os recursos DELA', $q$select public.recurso_definir('mural', false)$q$);
select t.permitido('(controle) ...e religa', $q$select public.recurso_definir('mural', true)$q$);
select t.throws('[plataforma] a RPC da plataforma recusa quem não é administrador dela',
  format($q$select public.admin_recurso_do_clube_definir(%L, 'especialidades', true)$q$, t.id('clube_a')), 'administração da plataforma');
select t.como('instrutor_a'); select t.pedir_clube('clube_a');
select t.throws('[tela] instrutor do A também não liga', $q$select public.recurso_definir('especialidades', true)$q$, 'liberado pela plataforma');
select t.como('lider_b'); select t.pedir_clube('clube_b');
select t.throws('[tela] diretoria do B também não liga no B', $q$select public.recurso_definir('especialidades', true)$q$, 'liberado pela plataforma');
select t.bloqueado('[REST] ...nem por INSERT direto no B', format($q$insert into public.club_features (club_id, feature, enabled) values (%L, 'especialidades', true)$q$, t.id('clube_b')));
select t.como('dir_a_membro_b'); select t.pedir_clube('clube_a');
select t.throws('[tela] quem é diretoria no A e membro no B, na aba A, também não liga', $q$select public.recurso_definir('especialidades', true)$q$, 'liberado pela plataforma');

-- o onboarding é uma porta SECURITY DEFINER (a RLS não a alcança): o gatilho de club_features barra
select t.como('fundador_62');
\o /dev/null
select public.onboarding_iniciar();
select public.onboarding_etapa('conta', '{"nome":"Cliente 62","email":"c62@teste.local"}'::jsonb);
select public.onboarding_etapa('dados_basicos', '{"documento":"00.000.000/0001-62","telefone":"81999990062"}'::jsonb);
select public.onboarding_etapa('clube', '{"nome":"Clube 62","plano":"completo"}'::jsonb);
select public.onboarding_etapa('identidade', '{"sigla":"C6"}'::jsonb);
select public.onboarding_etapa('diretor', '{}'::jsonb);
select public.onboarding_etapa('configuracao', '{"pix":""}'::jsonb);
\o
select t.throws('[onboarding] quem cria um clube NÃO liga especialidades na etapa "recursos" (mesmo em plano que inclui tudo)',
  $q$select public.onboarding_etapa('recursos', '{"recursos":{"especialidades":true}}'::jsonb)$q$, 'liberado pela plataforma');
select t.permitido('[onboarding] (controle) a etapa "recursos" segue funcionando para os recursos do clube',
  $q$select public.onboarding_etapa('recursos', '{"recursos":{"mural":true}}'::jsonb)$q$);
reset role;

select t.como('admin_62');
select t.throws('[plataforma] nem a plataforma libera especialidades SEM catálogo oficial publicado (seria tela vazia — ou, antes, o [TESTE])',
  format($q$select public.admin_recurso_do_clube_definir(%L, 'especialidades', true)$q$, t.id('clube_a')), 'catálogo OFICIAL');
reset role;
select t.eq('depois de todas as tentativas: especialidades continua DESLIGADO no A e no B',
  public.recurso_habilitado_no_clube(t.id('clube_a'), 'especialidades')::text || '|' || public.recurso_habilitado_no_clube(t.id('clube_b'), 'especialidades')::text, 'false|false');

-- =============================================================================
-- 3) "classes" LIGADO + "especialidades" DESLIGADO: TODA RPC de especialidade recusa (com erro claro)
-- =============================================================================
-- (uma matrícula OFICIAL antiga de membro_a2, para a explicação ter o que explicar)
select t.como_cron();
update public.curriculum_versions set status = 'publicado' where id = t.id('versao_oficial_esp');
\o /dev/null
select public._especialidade_matricular(t.id('membro_a2'), t.id('clube_a'), t.id('esp_oficial'), null);
\o
insert into t.ids (chave, id) select 'msr_oficial_a2', mr.id from public.member_specialty_requirements mr join public.member_specialties ms on ms.id = mr.member_specialty_id
 where ms.usuario_id = t.id('membro_a2') and ms.specialty_id = t.id('esp_oficial');

select t.como('membro_a'); select t.pedir_clube('clube_a');
select t.throws('[leitura] especialidades_disponiveis recusa', $q$select public.especialidades_disponiveis()$q$, 'não estão liberadas');
select t.throws('[leitura] minha_especialidade recusa', $q$select public.minha_especialidade()$q$, 'não estão liberadas');
select t.throws('[escrita] especialidade_iniciar recusa (mesmo a oficial)', format($q$select public.especialidade_iniciar(%L)$q$, t.id('esp_oficial')), 'não estão liberadas');
select t.throws('[escrita] especialidade_requisito_salvar recusa', format($q$select public.especialidade_requisito_salvar(%L, 'x', null)$q$, t.id('req_piloto_1')), 'não estão liberadas');
select t.throws('[escrita] especialidade_requisito_enviar recusa', format($q$select public.especialidade_requisito_enviar(%L)$q$, t.id('req_piloto_1')), 'não estão liberadas');
select t.eq('[Início] meu_inicio não mostra card de especialidade (nem o [TESTE] da matrícula antiga)',
  t.n($q$select count(*) from json_array_elements(public.meu_inicio()) i where i->>'rota' = '/minhas-especialidades' or i::text ilike '%especialidade%'$q$), 0);
select t.como('membro_a2'); select t.pedir_clube('clube_a');
select t.throws('[leitura] explicar_requisito_especialidade recusa (matrícula oficial, recurso desligado)', format($q$select public.explicar_requisito_especialidade(%L)$q$, t.id('msr_oficial_a2')), 'não estão liberadas');
select t.como('lider_a'); select t.pedir_clube('clube_a');
select t.throws('[leitura] ofertas_especialidade_do_clube recusa', $q$select public.ofertas_especialidade_do_clube()$q$, 'não estão liberadas');
select t.throws('[leitura] especialidade_avaliacoes_pendentes recusa', $q$select public.especialidade_avaliacoes_pendentes()$q$, 'não estão liberadas');
select t.throws('[escrita] oferta_especialidade_criar recusa', format($q$select public.oferta_especialidade_criar(%L, 'Turma', null, null, null)$q$, t.id('esp_oficial')), 'não estão liberadas');
select t.throws('[escrita] especialidade_atribuir recusa', format($q$select public.especialidade_atribuir(%L, %L)$q$, t.id('membro_a'), t.id('esp_oficial')), 'não estão liberadas');
select t.throws('[escrita] especialidade_requisito_avaliar recusa', format($q$select public.especialidade_requisito_avaliar(%L, 'aprovado', null)$q$, gen_random_uuid()), 'não estão liberadas');
select t.eq('[Gestão] a fila única não conta especialidades (null = recurso desligado; classes segue contando)',
  t.txt($q$select coalesce(public.avaliacoes_pendentes()->>'especialidades', 'null') || '|' || (public.avaliacoes_pendentes()->>'classes' is not null)::text$q$), 'null|true');
reset role;

-- =============================================================================
-- 4) A PLATAFORMA LIGA (com catálogo oficial publicado): funciona — e SÓ com o oficial
-- =============================================================================
select t.como('admin_62');
select t.permitido('[plataforma] o administrador libera especialidades no clube A (catálogo oficial publicado)',
  format($q$select public.admin_recurso_do_clube_definir(%L, 'especialidades', true)$q$, t.id('clube_a')));
reset role;
select t.eq('...ficou auditado (quem, clube, recurso, ligado)',
  (select (a.ator = t.id('admin_62'))::text || '|' || (a.club_id = t.id('clube_a'))::text || '|' || (a.detalhe->>'recurso') || '|' || (a.detalhe->>'ligado')
     from public.auditoria_operacoes a where a.operacao = 'recurso_alterado_pela_plataforma' order by a.id desc limit 1), 'true|true|especialidades|true');
select t.eq('...ligado SÓ no A: o B continua desligado', public.recurso_habilitado_no_clube(t.id('clube_a'), 'especialidades')::text || '|' || public.recurso_habilitado_no_clube(t.id('clube_b'), 'especialidades')::text, 'true|false');

select t.como('membro_a'); select t.pedir_clube('clube_a');
select t.eq('[fluxo] especialidades_disponiveis lista a OFICIAL e nenhum [PILOTO/TESTE]',
  (t.txt($q$select public.especialidades_disponiveis()::text$q$) like '%Especialidade Oficial (fixture)%')::text || '|' || (t.txt($q$select public.especialidades_disponiveis()::text$q$) ilike '%PILOTO%')::text, 'true|false');
select t.throws('[fluxo] iniciar a especialidade piloto é recusado ("não encontrada" — sem oráculo)', format($q$select public.especialidade_iniciar(%L)$q$, t.id('esp_piloto')), 'não encontrada');
select t.permitido('[fluxo] iniciar a OFICIAL funciona', format($q$select public.especialidade_iniciar(%L)$q$, t.id('esp_oficial')));
select t.eq('[fluxo] minha_especialidade() devolve a oficial — a matrícula [TESTE] antiga não aparece',
  t.txt($q$select (public.minha_especialidade()->'especialidade'->>'nome') || '|' || (public.minha_especialidade()->'curriculum_version'->>'origem')$q$), 'Especialidade Oficial (fixture)|oficial');
select t.eq('[fluxo] ...nem pedindo a matrícula [TESTE] pelo id', t.txt(format($q$select coalesce(public.minha_especialidade(%L)::text, 'NULL')$q$, t.id('ms_piloto_a'))), 'NULL');
select t.throws('[fluxo] ...nem mexendo num requisito dela', format($q$select public.especialidade_requisito_salvar(%L, 'x', null)$q$, t.id('req_piloto_1')), 'não encontrado');
select t.permitido('[fluxo] salvar e enviar o requisito oficial funciona', format($q$select public.especialidade_requisito_salvar(%L, 'minha resposta', null)$q$, t.id('req_oficial')));
select t.permitido('[fluxo] ...envia', format($q$select public.especialidade_requisito_enviar(%L)$q$, t.id('req_oficial')));
select t.eq('[Início] o card mostra a especialidade OFICIAL em andamento, nunca o [TESTE]',
  (t.txt($q$select public.meu_inicio()::text$q$) like '%Especialidade Oficial (fixture)%')::text || '|' || (t.txt($q$select public.meu_inicio()::text$q$) ilike '%PILOTO%')::text, 'true|false');
select t.como('lider_a'); select t.pedir_clube('clube_a');
select t.eq('[Gestão] a fila conta SÓ o envio oficial (o [TESTE] antigo aguardando não entra)', t.txt($q$select public.avaliacoes_pendentes()->>'especialidades'$q$), '1');
select t.eq('[avaliação] a lista de pendências traz o oficial e não o [TESTE]',
  t.txt($q$select string_agg(x->>'especialidade_nome', ',') from json_array_elements(public.especialidade_avaliacoes_pendentes()) x$q$), 'Especialidade Oficial (fixture)');
select t.eq('[turmas] a turma [TESTE] antiga não aparece', (t.txt($q$select public.ofertas_especialidade_do_clube()::text$q$) like '%Turma piloto antiga%')::text, 'false');
select t.throws('[turmas] não se cria turma da especialidade piloto', format($q$select public.oferta_especialidade_criar(%L, 'Turma nova piloto', null, null, null)$q$, t.id('esp_piloto')), 'não encontrada');
select t.throws('[turmas] responsável ("pais") não vira instrutor responsável de turma', format($q$select public.oferta_especialidade_criar(%L, 'Turma oficial', %L, null, null)$q$, t.id('esp_oficial'), t.id('pais_a')), 'vínculo ativo');
select t.permitido('[turmas] turma da oficial com o conselheiro como responsável funciona', format($q$select public.oferta_especialidade_criar(%L, 'Turma oficial', %L, null, null)$q$, t.id('esp_oficial'), t.id('conselheiro_a')));
select t.throws('[plataforma] a liderança continua sem poder DESLIGAR o que a plataforma ligou', $q$select public.recurso_definir('especialidades', false)$q$, 'liberado pela plataforma');

-- a MESMA pessoa em dois clubes: liberado no A, desligado no B
select t.como('multi_dois_papeis'); select t.pedir_clube('clube_b');
select t.throws('[multi-clube] na aba B (desligado lá) a mesma pessoa é recusada', $q$select public.especialidades_disponiveis()$q$, 'não estão liberadas');
select t.pedir_clube('clube_a');
select t.permitido('[multi-clube] ...e na aba A (liberado) funciona', $q$select public.especialidades_disponiveis()$q$, 0);
select t.eq('[multi-clube] meu_contexto: A=true, B=false',
  t.txt($q$select string_agg(v->>'nome' || '=' || (v->'recursos'->>'especialidades'), ',' order by v->>'nome') from jsonb_array_elements(public.meu_contexto()->'vinculos') v$q$),
  'Clube B (teste)=false,Filhos da Conquista=true');
reset role;

-- =============================================================================
-- 5) NENHUM [TESTE] CHEGA A MEMBRO — nem pela API crua
-- =============================================================================
select t.como('membro_a'); select t.pedir_clube('clube_a');
select t.eq('[REST] specialties: nenhuma [PILOTO/TESTE] visível (a oficial sim)',
  t.nv($q$select count(*) from public.specialties where nome ilike '%PILOTO%'$q$) * 10 + t.nv($q$select count(*) from public.specialties where nome = 'Especialidade Oficial (fixture)'$q$), 1);
select t.eq('[REST] specialty_requirements: nenhum requisito da especialidade piloto', t.nv(format($q$select count(*) from public.specialty_requirements where specialty_id = %L$q$, t.id('esp_piloto'))), 0);
select t.eq('[REST] curriculum_versions: só versões oficiais', t.nv($q$select count(*) from public.curriculum_versions where origem <> 'oficial'$q$), 0);
select t.eq('[REST] classes/seções/requisitos: nada da classe PILOTO da migration 36',
  t.nv(format($q$select count(*) from public.classes where id = %L$q$, t.id('classe_piloto')))
  + t.nv(format($q$select count(*) from public.class_sections where class_id = %L$q$, t.id('classe_piloto')))
  + t.nv($q$select count(*) from public.class_requirements where descricao like '[DADO DE TESTE]%'$q$), 0);
select t.eq('(controle) as Classes oficiais continuam legíveis', t.nv($q$select count(*) from public.classes$q$), 6);
select t.eq('[diff] comparar_versoes_curriculares com a versão de teste não responde a membro',
  t.txt(format($q$select coalesce(public.comparar_versoes_curriculares(%L, %L)::text, 'NULL')$q$, t.id('versao_esp_piloto'), t.id('versao_oficial_esp'))), 'NULL');
select t.eq('[experiências] nenhuma experiência [TESTE] no clube legado (a 83 tirou as que a 49 semeava)',
  t.nv($q$select count(*) from public.experiences where titulo like '[TESTE]%'$q$), 0);
reset role;
select t.como_cron();
select t.ok('(controle) a plataforma continua comparando qualquer versão (sessão sem usuário)',
  public.comparar_versoes_curriculares(t.id('versao_esp_piloto'), t.id('versao_oficial_esp')) is not null);
select t.eq('(controle) o piloto continua EXISTINDO no banco (preservado, só fora do app)',
  (select count(*) from public.specialties s join public.curriculum_versions v on v.id = s.curriculum_version_id where s.id = t.id('esp_piloto') and v.origem = 'piloto_teste'), 1);
select t.eq('...e nada de experiência [TESTE] ficou no clube legado', (select count(*) from public.experiences where club_id = t.id('clube_a') and teste), 0);

select t.fim();
rollback;
