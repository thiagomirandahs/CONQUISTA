-- Fase 2.6 — Motor de Regras Curriculares (migration 38). Fixtures SINTÉTICAS ("[PILOTO/TESTE]"),
-- nunca conteúdo oficial: as 6 Classes Regulares continuam NÃO importadas. Cenários pedidos:
--   1) conteúdo anual 2026 vs 2027 sem duplicar a Classe;
--   2) escolha 2-de-3 (e 1-de-N, polimórfico em requisito de especialidade);
--   3) Especialidade concluída no Clube A satisfazendo regra curricular no Clube B;
--   4) Clube B incapaz de alterar/revogar a conclusão emitida pelo A (e revogação = soft, com autoria);
--   5) remoção do vínculo com A sem apagar o histórico curricular legítimo;
--   6) pontos/presença/jogos/progresso do A continuando invisíveis ao B;
--   7) prazo mínimo (bloqueia a conclusão) / máximo (informativo);
--   8) troca de versão curricular preservando o histórico portátil;
--   9) duas abas/clubes: progresso operacional por aba, reconhecimento curricular único;
--  10) tentativa de forjar club_id (insert direto, header de clube sem vínculo, revogar "de outro clube").
-- Mais o motor de explicação (satisfeito | pendente | bloqueado + regra + origem) em cada passo.
begin;
\ir _lib.sql
\ir _fixtures.sql

insert into public.club_features (club_id, feature, enabled) values (t.id('clube_a'), 'classes', true), (t.id('clube_b'), 'classes', true)
on conflict (club_id, feature) do update set enabled = true;
-- fixtures sintéticas são origem='piloto_teste' — somem do fluxo normal quando há catálogo oficial
-- publicado (fase 3, teste 37). Arquiva o oficial só nesta transação pra testar o motor com elas.
update public.curriculum_versions set status = 'arquivado' where origem = 'oficial';

-- ==================== fixtures curriculares SINTÉTICAS desta fase ====================
insert into public.curriculum_versions (id, origem, identificador, versao, vigente_desde, status, fonte_descricao)
values ('00000000-0000-4000-a000-000000000201'::uuid, 'piloto_teste', 'piloto-motor-regras-curriculares', 'rascunho-1', current_date, 'publicado',
        'Dados de TESTE da fase 2.6 (conteúdo dinâmico, N-de-M, histórico portátil, prazo). Não é currículo oficial.');
insert into public.classes (id, curriculum_version_id, codigo, nome, ordem)
values ('00000000-0000-4000-a000-000000000202'::uuid, '00000000-0000-4000-a000-000000000201'::uuid, 'piloto_regras', '[PILOTO/TESTE] Regras Curriculares', 10);
insert into public.class_sections (id, class_id, codigo, nome, ordem)
values ('00000000-0000-4000-a000-000000000211'::uuid, '00000000-0000-4000-a000-000000000202'::uuid, 'geral', '[PILOTO/TESTE] Geral', 10);

-- 5 especialidades sintéticas de 1 requisito cada (X, Y, Z = opções do N-de-M; PORTATIL = dependência; PRAZO = prazo mínimo/máximo)
insert into public.specialties (id, curriculum_version_id, codigo, nome, ordem, prazo_minimo_dias, prazo_maximo_dias) values
  ('00000000-0000-4000-a000-000000000241'::uuid, '00000000-0000-4000-a000-000000000201'::uuid, 'piloto_x', '[PILOTO/TESTE] Opção X', 10, null, null),
  ('00000000-0000-4000-a000-000000000242'::uuid, '00000000-0000-4000-a000-000000000201'::uuid, 'piloto_y', '[PILOTO/TESTE] Opção Y', 20, null, null),
  ('00000000-0000-4000-a000-000000000243'::uuid, '00000000-0000-4000-a000-000000000201'::uuid, 'piloto_z', '[PILOTO/TESTE] Opção Z', 30, null, null),
  ('00000000-0000-4000-a000-000000000244'::uuid, '00000000-0000-4000-a000-000000000201'::uuid, 'piloto_portatil', '[PILOTO/TESTE] Portátil', 40, null, null),
  ('00000000-0000-4000-a000-000000000245'::uuid, '00000000-0000-4000-a000-000000000201'::uuid, 'piloto_prazo', '[PILOTO/TESTE] Com Prazo', 50, 2, 30);
insert into public.specialty_requirements (specialty_id, codigo, descricao, tipo_evidencia, evidencia_obrigatoria, ordem)
select id, '1', '[DADO DE TESTE] Requisito único de ' || nome, 'nenhuma', false, 10
from public.specialties where curriculum_version_id = '00000000-0000-4000-a000-000000000201'::uuid;

insert into t.ids (chave, id) values
  ('versao_regras', '00000000-0000-4000-a000-000000000201'::uuid),
  ('classe_regras', '00000000-0000-4000-a000-000000000202'::uuid),
  ('esp_x', '00000000-0000-4000-a000-000000000241'::uuid), ('esp_y', '00000000-0000-4000-a000-000000000242'::uuid),
  ('esp_z', '00000000-0000-4000-a000-000000000243'::uuid), ('esp_portatil', '00000000-0000-4000-a000-000000000244'::uuid),
  ('esp_prazo', '00000000-0000-4000-a000-000000000245'::uuid),
  ('classe_piloto_36', '00000000-0000-4000-a000-000000000002'::uuid);
insert into t.ids (chave, id) select 'sreq_' || sp.codigo, r.id from public.specialty_requirements r join public.specialties sp on sp.id = r.specialty_id
 where sp.curriculum_version_id = t.id('versao_regras');

-- A) conteúdo anual/dinâmico: a DEFINIÇÃO (o slot) nasce sem nenhum valor ainda
insert into public.dynamic_content_definitions (id, chave, nome, descricao)
values ('00000000-0000-4000-a000-000000000221'::uuid, 'piloto_curso_leitura_do_ano', '[PILOTO/TESTE] Curso de Leitura do Ano', 'slot de teste');
insert into t.ids (chave, id) values ('def_leitura', '00000000-0000-4000-a000-000000000221'::uuid);

-- 3 requisitos na classe sintética: anual (dinâmico), escolha (2 de 3), dependente (de PORTATIL concluída)
insert into public.class_requirements (id, section_id, codigo, descricao, tipo_evidencia, evidencia_obrigatoria, ordem, conteudo_dinamico_definicao_id) values
  ('00000000-0000-4000-a000-000000000251'::uuid, '00000000-0000-4000-a000-000000000211'::uuid, '1', '[DADO DE TESTE] Ler o livro do Curso de Leitura do ano (conteúdo dinâmico).', 'nenhuma', false, 10, t.id('def_leitura')),
  ('00000000-0000-4000-a000-000000000252'::uuid, '00000000-0000-4000-a000-000000000211'::uuid, '2', '[DADO DE TESTE] Completar 2 das 3 opções (X, Y, Z).', 'nenhuma', false, 20, null),
  ('00000000-0000-4000-a000-000000000253'::uuid, '00000000-0000-4000-a000-000000000211'::uuid, '3', '[DADO DE TESTE] Ter concluído a especialidade Portátil.', 'nenhuma', false, 30, null);
insert into t.ids (chave, id) values
  ('req_anual', '00000000-0000-4000-a000-000000000251'::uuid), ('req_escolha', '00000000-0000-4000-a000-000000000252'::uuid), ('req_dependente', '00000000-0000-4000-a000-000000000253'::uuid);

-- B) grupo 2-de-3 no requisito de classe + grupo 1-de-2 num requisito de ESPECIALIDADE (polimórfico)
insert into public.requirement_option_groups (id, alvo_tipo, alvo_id, n_minimo)
values ('00000000-0000-4000-a000-000000000231'::uuid, 'class_requirement', t.id('req_escolha'), 2),
       ('00000000-0000-4000-a000-000000000232'::uuid, 'specialty_requirement', t.id('sreq_piloto_prazo'), 1);
insert into public.requirement_options (grupo_id, rotulo, specialty_id, ordem) values
  ('00000000-0000-4000-a000-000000000231'::uuid, 'Opção X', t.id('esp_x'), 10),
  ('00000000-0000-4000-a000-000000000231'::uuid, 'Opção Y', t.id('esp_y'), 20),
  ('00000000-0000-4000-a000-000000000231'::uuid, 'Opção Z', t.id('esp_z'), 30),
  ('00000000-0000-4000-a000-000000000232'::uuid, 'Opção X', t.id('esp_x'), 10),
  ('00000000-0000-4000-a000-000000000232'::uuid, 'Opção Y', t.id('esp_y'), 20);
insert into t.ids (chave, id) values ('grupo_2de3', '00000000-0000-4000-a000-000000000231'::uuid), ('grupo_1de2', '00000000-0000-4000-a000-000000000232'::uuid);
select t.throws('grupo N-de-M apontando pra requisito inexistente é rejeitado pelo gatilho',
  $q$insert into public.requirement_option_groups (alvo_tipo, alvo_id, n_minimo) values ('class_requirement', gen_random_uuid(), 1)$q$, 'não existe');
select t.throws('n_minimo < 1 é rejeitado (a regra sempre exige pelo menos 1)',
  format($q$insert into public.requirement_option_groups (alvo_tipo, alvo_id, n_minimo) values ('class_requirement', %L, 0)$q$, t.id('req_anual')), 'check');

-- E) dependência declarativa: req_dependente exige PORTATIL concluída
insert into public.curriculum_dependencies (alvo_tipo, alvo_id, depende_de_tipo, depende_de_id, obrigatorio)
values ('class_requirement', t.id('req_dependente'), 'specialty', t.id('esp_portatil'), true);

-- ==================== 1) conteúdo anual 2026 vs 2027 — SEM duplicar a Classe ====================
select t.como('membro_a'); select t.pedir_clube('clube_a');
select t.permitido('membro_a inicia a classe sintética no clube A', format($q$select public.classe_iniciar(%L)$q$, t.id('classe_regras')));
reset role;
insert into t.ids (chave, id) select 'mr_anual_a', mr.id from public.member_requirements mr where mr.usuario_id = t.id('membro_a') and mr.club_id = t.id('clube_a') and mr.requirement_id = t.id('req_anual');
insert into t.ids (chave, id) select 'mr_escolha_a', mr.id from public.member_requirements mr where mr.usuario_id = t.id('membro_a') and mr.club_id = t.id('clube_a') and mr.requirement_id = t.id('req_escolha');

select t.como('membro_a'); select t.pedir_clube('clube_a');
select t.eq('EXPLICAÇÃO: sem nenhum valor cadastrado pro ano, o requisito dinâmico fica BLOQUEADO',
  t.txt(format($q$select public.explicar_requisito_classe(%L)->>'resultado'$q$, t.id('mr_anual_a'))), 'bloqueado');
select t.eq('...e a regra que bloqueou está nomeada, com a origem (tabela) que produziu o resultado',
  t.txt(format($q$select r->>'origem' from jsonb_array_elements(public.explicar_requisito_classe(%L)->'regras_aplicadas') r where r->>'regra' = 'conteudo_dinamico' and (r->>'satisfeito')::boolean = false$q$, t.id('mr_anual_a'))),
  'dynamic_content_definitions + dynamic_content_values');
reset role;

insert into public.dynamic_content_values (definicao_id, valor, vigente_desde, vigente_ate, fonte_descricao) values
  (t.id('def_leitura'), 'Livro 2026 [TESTE]', '2026-01-01', '2026-12-31', 'fixture'),
  (t.id('def_leitura'), 'Livro 2027 [TESTE]', '2027-01-01', null, 'fixture (aberto)');
select t.throws('período que SOBREPÕE outro da mesma definição é rejeitado (resolução sempre determinística: 1 valor por data)',
  format($q$insert into public.dynamic_content_values (definicao_id, valor, vigente_desde, vigente_ate) values (%L, 'Duplicado', '2026-06-01', '2026-08-01')$q$, t.id('def_leitura')), 'sobrepõe');
select t.throws('vigente_ate antes de vigente_desde é rejeitado', format($q$insert into public.dynamic_content_values (definicao_id, valor, vigente_desde, vigente_ate) values (%L, 'Invertido', '2030-05-01', '2030-01-01')$q$, t.id('def_leitura')), 'check');
select t.permitido('um período que NÃO sobrepõe (antes de 2026) entra normalmente',
  format($q$insert into public.dynamic_content_values (definicao_id, valor, vigente_desde, vigente_ate) values (%L, 'Livro 2025 [TESTE]', '2025-01-01', '2025-12-31')$q$, t.id('def_leitura')));

select t.eq('resolver(2026-06-15) = livro de 2026', public.conteudo_dinamico_resolver('piloto_curso_leitura_do_ano', '2026-06-15') ->> 'valor', 'Livro 2026 [TESTE]');
select t.eq('resolver(2027-06-15) = livro de 2027', public.conteudo_dinamico_resolver('piloto_curso_leitura_do_ano', '2027-06-15') ->> 'valor', 'Livro 2027 [TESTE]');
select t.eq('resolver(2031-01-01) = ainda o de 2027 (período aberto vale até ser fechado)', public.conteudo_dinamico_resolver('piloto_curso_leitura_do_ano', '2031-01-01') ->> 'valor', 'Livro 2027 [TESTE]');
select t.eq('resolver(2020-01-01) = NULL (nenhum período cobre; nunca adivinha)', public.conteudo_dinamico_resolver('piloto_curso_leitura_do_ano', '2020-01-01') ->> 'valor', null);
select t.ok('resolver de chave inexistente = NULL (não inventa)', public.conteudo_dinamico_resolver('nao_existe', current_date) is null);
select t.eq('a Classe continua sendo UMA só (nenhuma versão nova por causa do ano)', (select count(*) from public.classes where codigo = 'piloto_regras'), 1);
select t.eq('...e UMA curriculum_version só', (select count(*) from public.curriculum_versions where identificador = 'piloto-motor-regras-curriculares'), 1);
select t.eq('...e o requisito da classe é UM só (o mesmo id serve 2025, 2026 e 2027)', (select count(*) from public.class_requirements where conteudo_dinamico_definicao_id = t.id('def_leitura')), 1);

select t.como('membro_a'); select t.pedir_clube('clube_a');
select t.eq('EXPLICAÇÃO: com o valor de hoje cadastrado, o mesmo requisito passa de BLOQUEADO pra PENDENTE (ainda não aprovado)',
  t.txt(format($q$select public.explicar_requisito_classe(%L)->>'resultado'$q$, t.id('mr_anual_a'))), 'pendente');
select t.ok('...a regra conteudo_dinamico agora está satisfeita e carrega o valor resolvido pro dia de hoje',
  t.txt(format($q$select r->'detalhe'->>'valor' from jsonb_array_elements(public.explicar_requisito_classe(%L)->'regras_aplicadas') r where r->>'regra' = 'conteudo_dinamico' and (r->>'satisfeito')::boolean$q$, t.id('mr_anual_a'))) like 'Livro 20%');
select t.ok('membro comum LÊ o catálogo dinâmico (leitura pública)...', t.nv($q$select count(*) from public.dynamic_content_values$q$) >= 3);
select t.bloqueado('...mas NÃO escreve nele (catálogo da plataforma, só migration/SQL)', format($q$insert into public.dynamic_content_values (definicao_id, valor, vigente_desde) values (%L, 'hack', '2040-01-01')$q$, t.id('def_leitura')));
reset role;

-- ==================== 2) escolha 2-de-3 — o servidor conta, o front só apresenta ====================
select t.eq('grupo 2-de-3: 0 opções satisfeitas no início', (public.opcoes_satisfeitas_automaticamente(t.id('grupo_2de3'), t.id('membro_a')) ->> 'satisfeitas')::int, 0);
select t.eq('...total_opcoes = 3, n_minimo = 2 (a regra vem do dado, não de código)', (public.opcoes_satisfeitas_automaticamente(t.id('grupo_2de3'), t.id('membro_a')) ->> 'total_opcoes')::int * 10 + (public.opcoes_satisfeitas_automaticamente(t.id('grupo_2de3'), t.id('membro_a')) ->> 'n_minimo')::int, 32);

-- membro_a conclui X no clube A
select t.como('membro_a'); select t.pedir_clube('clube_a');
select t.permitido('membro_a inicia X', format($q$select public.especialidade_iniciar(%L)$q$, t.id('esp_x')));
select t.permitido('membro_a inicia Y', format($q$select public.especialidade_iniciar(%L)$q$, t.id('esp_y')));
reset role;
insert into t.ids (chave, id) select 'ms_x_membro_a', id from public.member_specialties where usuario_id = t.id('membro_a') and club_id = t.id('clube_a') and specialty_id = t.id('esp_x');
insert into t.ids (chave, id) select 'ms_y_membro_a', id from public.member_specialties where usuario_id = t.id('membro_a') and club_id = t.id('clube_a') and specialty_id = t.id('esp_y');
select t.como('lider_a'); select t.pedir_clube('clube_a');
select t.permitido('lider_a aprova o requisito único de X', format($q$select public.especialidade_requisito_avaliar((select id from public.member_specialty_requirements where member_specialty_id = %L), 'aprovado', null)$q$, t.id('ms_x_membro_a')));
reset role;
select t.eq('X concluiu sozinha', (select status from public.member_specialties where id = t.id('ms_x_membro_a')), 'concluida');
select t.eq('grupo 2-de-3: 1 satisfeita (X) — ainda não basta', (public.opcoes_satisfeitas_automaticamente(t.id('grupo_2de3'), t.id('membro_a')) ->> 'satisfeitas')::int, 1);
select t.como('membro_a'); select t.pedir_clube('clube_a');
-- (fase 3.1, migration 41: regra estrutural não satisfeita BLOQUEIA — antes era só "pendente")
select t.eq('EXPLICAÇÃO: escolha_n_de_m com 1/2 = NÃO satisfeita, resultado BLOQUEADO (enviar/aprovar recusam)',
  t.txt(format($q$select (r->>'satisfeito') || '/' || (public.explicar_requisito_classe(%L)->>'resultado') from jsonb_array_elements(public.explicar_requisito_classe(%L)->'regras_aplicadas') r where r->>'regra' = 'escolha_n_de_m'$q$, t.id('mr_escolha_a'), t.id('mr_escolha_a'))), 'false/bloqueado');
reset role;
select t.como('lider_a'); select t.pedir_clube('clube_a');
select t.permitido('lider_a aprova o requisito único de Y', format($q$select public.especialidade_requisito_avaliar((select id from public.member_specialty_requirements where member_specialty_id = %L), 'aprovado', null)$q$, t.id('ms_y_membro_a')));
reset role;
select t.eq('grupo 2-de-3: 2 satisfeitas (X e Y) — Z nem foi tocada e não precisa', (public.opcoes_satisfeitas_automaticamente(t.id('grupo_2de3'), t.id('membro_a')) ->> 'satisfeitas')::int, 2);
select t.como('membro_a'); select t.pedir_clube('clube_a');
select t.eq('EXPLICAÇÃO: escolha_n_de_m com 2/2 = satisfeita, origem = requirement_option_groups + requirement_options',
  t.txt(format($q$select (r->>'satisfeito') || '|' || (r->>'origem') from jsonb_array_elements(public.explicar_requisito_classe(%L)->'regras_aplicadas') r where r->>'regra' = 'escolha_n_de_m'$q$, t.id('mr_escolha_a'))), 'true|requirement_option_groups + requirement_options + member_requirement_options');
select t.eq('...mas o resultado operacional continua PENDENTE até a liderança aprovar (a conta informa, não aprova sozinha)',
  t.txt(format($q$select public.explicar_requisito_classe(%L)->>'resultado'$q$, t.id('mr_escolha_a'))), 'pendente');
reset role;
select t.eq('grupo 1-de-2 (em requisito de ESPECIALIDADE, polimórfico): satisfeito com só X', (public.opcoes_satisfeitas_automaticamente(t.id('grupo_1de2'), t.id('membro_a')) ->> 'satisfeitas')::int >= 1, true);
select t.eq('a mesma pergunta pra OUTRA pessoa (membro_b) dá 0 — a conta é por pessoa', (public.opcoes_satisfeitas_automaticamente(t.id('grupo_2de3'), t.id('membro_b')) ->> 'satisfeitas')::int, 0);

-- ==================== 3) Especialidade concluída no Clube A satisfaz regra curricular no Clube B ====================
-- multi_dois_papeis: desbravador no A, conselheiro no B (fixture). Conclui PORTATIL no A.
select t.como('multi_dois_papeis'); select t.pedir_clube('clube_a');
select t.permitido('multi inicia PORTATIL no clube A', format($q$select public.especialidade_iniciar(%L)$q$, t.id('esp_portatil')));
select t.permitido('multi inicia X no clube A também (vai servir pro teste de revogação)', format($q$select public.especialidade_iniciar(%L)$q$, t.id('esp_x')));
reset role;
insert into t.ids (chave, id) select 'ms_portatil_a', id from public.member_specialties where usuario_id = t.id('multi_dois_papeis') and club_id = t.id('clube_a') and specialty_id = t.id('esp_portatil');
insert into t.ids (chave, id) select 'ms_x_multi_a', id from public.member_specialties where usuario_id = t.id('multi_dois_papeis') and club_id = t.id('clube_a') and specialty_id = t.id('esp_x');
select t.eq('antes: sem conquista, a dependência do req 3 está PENDENTE pra multi (visto de B)',
  array_length(public.dependencias_pendentes('class_requirement', t.id('req_dependente'), t.id('multi_dois_papeis'), t.id('clube_b')), 1) > 0, true);
select t.eq('antes: especialidade_ja_concluida_pela_pessoa(PORTATIL) = false', public.especialidade_ja_concluida_pela_pessoa(t.id('multi_dois_papeis'), t.id('esp_portatil')), false);

select t.como('lider_a'); select t.pedir_clube('clube_a');
select t.permitido('lider_a aprova PORTATIL de multi (no A)', format($q$select public.especialidade_requisito_avaliar((select id from public.member_specialty_requirements where member_specialty_id = %L), 'aprovado', 'Muito bem!')$q$, t.id('ms_portatil_a')));
select t.permitido('lider_a aprova X de multi (no A)', format($q$select public.especialidade_requisito_avaliar((select id from public.member_specialty_requirements where member_specialty_id = %L), 'aprovado', null)$q$, t.id('ms_x_multi_a')));
reset role;
insert into t.ids (chave, id) select 'ach_portatil', id from public.curriculum_achievements where usuario_id = t.id('multi_dois_papeis') and specialty_id = t.id('esp_portatil');
insert into t.ids (chave, id) select 'ach_x_multi', id from public.curriculum_achievements where usuario_id = t.id('multi_dois_papeis') and specialty_id = t.id('esp_x');
select t.eq('a conclusão gerou a conquista PORTÁTIL: tipo=especialidade, status=ativa, club_id_origem=A, ligada ao member_specialty de origem',
  (select count(*) from public.curriculum_achievements where id = t.id('ach_portatil') and tipo = 'especialidade' and status = 'ativa'
     and club_id_origem = t.id('clube_a') and member_specialty_id = t.id('ms_portatil_a') and concluida_em is not null), 1);
select t.eq('proveniência do AVALIADOR continua em requirement_approvals (club_id=A, lider_a, comentário) — a conquista aponta pro member_specialty que tem esse rastro',
  (select count(*) from public.requirement_approvals a join public.member_specialty_requirements mr on mr.id = a.member_specialty_requirement_id
    where mr.member_specialty_id = t.id('ms_portatil_a') and a.club_id = t.id('clube_a') and a.avaliado_por = t.id('lider_a') and a.comentario = 'Muito bem!'), 1);
select t.eq('só 1 conquista por pessoa+especialidade+clube emissor (índice parcial — reprocessar não duplica)',
  (select count(*) from public.curriculum_achievements where usuario_id = t.id('multi_dois_papeis') and specialty_id = t.id('esp_portatil')), 1);
select t.eq('AGORA a dependência do req 3 está SATISFEITA pra multi visto de B (a conclusão em A é reconhecida em B)',
  array_length(public.dependencias_pendentes('class_requirement', t.id('req_dependente'), t.id('multi_dois_papeis'), t.id('clube_b')), 1), null);
select t.eq('especialidade_ja_concluida_pela_pessoa(PORTATIL) = true (primitiva do "não repetir": histórico portátil, não member_specialties do clube atual)',
  public.especialidade_ja_concluida_pela_pessoa(t.id('multi_dois_papeis'), t.id('esp_portatil')), true);

-- a regra curricular em B de fato libera: multi inicia a classe sintética NO B e envia o req 3 lá
select t.como('multi_dois_papeis'); select t.pedir_clube('clube_b');
select t.permitido('multi inicia a classe sintética no clube B', format($q$select public.classe_iniciar(%L)$q$, t.id('classe_regras')));
select t.permitido('multi ENVIA o req 3 no B — antes da fase 2.6 isso falhava com "Falta concluir antes" (dependência era só do mesmo clube)',
  format($q$select public.requisito_enviar(%L)$q$, t.id('req_dependente')));
reset role;
insert into t.ids (chave, id) select 'mr_dependente_b', mr.id from public.member_requirements mr where mr.usuario_id = t.id('multi_dois_papeis') and mr.club_id = t.id('clube_b') and mr.requirement_id = t.id('req_dependente');
select t.como('lider_b'); select t.pedir_clube('clube_b');
select t.permitido('lider_b APROVA o req 3 no B (a checagem de dependência do avaliador também reconhece a conquista de A)',
  format($q$select public.requisito_avaliar(%L, 'aprovado', 'Reconhecido do clube A')$q$, t.id('mr_dependente_b')));
reset role;
select t.como('multi_dois_papeis'); select t.pedir_clube('clube_b');
select t.eq('EXPLICAÇÃO no B: req 3 SATISFEITO; regra dependencia_curricular satisfeita com origem no histórico portátil',
  t.txt(format($q$select (public.explicar_requisito_classe(%L)->>'resultado') || '|' || (r->>'satisfeito') || '|' || (r->>'origem') from jsonb_array_elements(public.explicar_requisito_classe(%L)->'regras_aplicadas') r where r->>'regra' = 'dependencia_curricular'$q$, t.id('mr_dependente_b'), t.id('mr_dependente_b'))),
  'satisfeito|true|curriculum_dependencies + curriculum_achievements (histórico portátil)');
reset role;

-- quem ENXERGA a conquista (RLS): dono, liderança do emissor, liderança de clube com vínculo ativo — mais ninguém
select t.como('multi_dois_papeis');
select t.eq('a própria pessoa vê a conquista', t.nv(format($q$select count(*) from public.curriculum_achievements where id = %L$q$, t.id('ach_portatil'))), 1);
select t.como('lider_a');
select t.eq('a liderança do clube EMISSOR (A) vê', t.nv(format($q$select count(*) from public.curriculum_achievements where id = %L$q$, t.id('ach_portatil'))), 1);
select t.como('lider_b');
select t.eq('a liderança de um clube onde a pessoa TEM VÍNCULO ATIVO (B) vê — é assim que "o novo clube consulta"', t.nv(format($q$select count(*) from public.curriculum_achievements where id = %L$q$, t.id('ach_portatil'))), 1);
select t.como('membro_b');
select t.eq('um membro comum do B NÃO vê (não é dono nem liderança)', t.nv(format($q$select count(*) from public.curriculum_achievements where id = %L$q$, t.id('ach_portatil'))), 0);
select t.como('membro_a');
select t.eq('um membro comum do A NÃO vê a conquista de outra pessoa', t.nv(format($q$select count(*) from public.curriculum_achievements where id = %L$q$, t.id('ach_portatil'))), 0);
select t.como_anon();
select t.eq('anon não vê nada', t.nv($q$select count(*) from public.curriculum_achievements$q$), 0);
reset role;

-- ==================== 9) duas abas/clubes: progresso operacional por aba, reconhecimento curricular único ====================
select t.como('multi_dois_papeis'); select t.pedir_clube('clube_a');
select t.permitido('aba A: multi inicia a MESMA classe sintética também no A', format($q$select public.classe_iniciar(%L)$q$, t.id('classe_regras')));
select t.eq('aba A: minha_classe() mostra o req 3 NÃO iniciado no A (o progresso operacional é da aba/clube)',
  t.txt($q$select r->>'status' from json_array_elements(public.minha_classe()->'secoes'->0->'requisitos') r where r->>'codigo' = '3'$q$), 'nao_iniciado');
select t.eq('aba A: a dependência do req 3 está satisfeita (a conquista é uma só, a aba não importa)',
  array_length(public.dependencias_pendentes('class_requirement', t.id('req_dependente'), t.id('multi_dois_papeis'), t.id('clube_a')), 1), null);
select t.pedir_clube('clube_b');
select t.eq('aba B: minha_classe() mostra o req 3 APROVADO no B', t.txt($q$select r->>'status' from json_array_elements(public.minha_classe()->'secoes'->0->'requisitos') r where r->>'codigo' = '3'$q$), 'aprovado');
select t.eq('aba B: a mesma conquista', t.nv(format($q$select count(*) from public.curriculum_achievements where id = %L$q$, t.id('ach_portatil'))), 1);
select t.esquecer_clube_pedido();
select t.eq('sem nenhuma aba escolhida: a conquista continua visível (é da PESSOA, não do clube em uso)', t.nv(format($q$select count(*) from public.curriculum_achievements where id = %L$q$, t.id('ach_portatil'))), 1);
reset role;
select t.eq('as duas matrículas de multi na classe sintética são linhas SEPARADAS (uma por clube), nunca uma só',
  (select count(*) from public.member_classes where usuario_id = t.id('multi_dois_papeis') and class_id = t.id('classe_regras')), 2);

-- ==================== 4) Clube B incapaz de alterar/revogar a conclusão emitida por A ====================
select t.como('lider_b'); select t.pedir_clube('clube_b');
select t.throws('lider_b NÃO revoga a conquista emitida por A (só a liderança do clube EMISSOR pode)',
  format($q$select public.curriculum_achievement_revogar(%L, 'tentativa indevida')$q$, t.id('ach_x_multi')), 'clube que emitiu');
select t.bloqueado('lider_b NÃO altera a conquista por UPDATE direto', format($q$update public.curriculum_achievements set status = 'revogada' where id = %L$q$, t.id('ach_x_multi')));
select t.bloqueado('lider_b NÃO apaga a conquista por DELETE direto', format($q$delete from public.curriculum_achievements where id = %L$q$, t.id('ach_x_multi')));
select t.como('multi_dois_papeis');
select t.throws('nem a PRÓPRIA pessoa revoga/edita a própria conquista', format($q$select public.curriculum_achievement_revogar(%L, 'eu mesmo')$q$, t.id('ach_x_multi')), 'clube que emitiu');
reset role;
select t.eq('...continua ativa e intacta', (select status from public.curriculum_achievements where id = t.id('ach_x_multi')), 'ativa');

select t.como('lider_a'); select t.pedir_clube('clube_a');
select t.permitido('a liderança do EMISSOR (A) revoga a conquista X de multi, com motivo', format($q$select public.curriculum_achievement_revogar(%L, 'Avaliação refeita: requisito não cumprido.')$q$, t.id('ach_x_multi')));
select t.throws('revogar 2x é recusado (histórico não é reescrito)', format($q$select public.curriculum_achievement_revogar(%L, 'de novo')$q$, t.id('ach_x_multi')), 'já está revogada');
reset role;
select t.eq('revogação é SOFT: a linha continua existindo', (select count(*) from public.curriculum_achievements where id = t.id('ach_x_multi')), 1);
select t.eq('...com status=revogada, autor=lider_a, motivo e data preservados',
  (select count(*) from public.curriculum_achievements where id = t.id('ach_x_multi') and status = 'revogada' and revogada_por = t.id('lider_a')
     and revogada_em is not null and revogada_motivo = 'Avaliação refeita: requisito não cumprido.'), 1);
select t.eq('...e club_id_origem NÃO mudou (proveniência imutável)', (select club_id_origem from public.curriculum_achievements where id = t.id('ach_x_multi')), t.id('clube_a'));
select t.eq('conquista revogada NÃO conta mais como concluída (especialidade_ja_concluida_pela_pessoa X = false)', public.especialidade_ja_concluida_pela_pessoa(t.id('multi_dois_papeis'), t.id('esp_x')), false);
select t.eq('...mas o registro operacional em A (member_specialties X) NÃO foi tocado pela revogação curricular', (select status from public.member_specialties where id = t.id('ms_x_multi_a')), 'concluida');
select t.eq('a conquista PORTATIL (outra linha) continua ativa — revogar uma não mexe nas outras', (select status from public.curriculum_achievements where id = t.id('ach_portatil')), 'ativa');

-- ==================== 6) pontos/presença/progresso do A continuam INVISÍVEIS ao B ====================
select t.eq('ESTRUTURA: curriculum_achievements não tem NENHUMA coluna de dado operacional (pontos, presença, mensalidade, mensagem, evidência, arquivo, foto)',
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'curriculum_achievements'
     and (column_name = any (array['pontos', 'presenca', 'mensalidade', 'mensagem', 'evidencia_texto', 'evidencia_path', 'arquivo', 'foto', 'ranking'])
          or column_name like '%ponto%' or column_name like '%presen%' or column_name like '%evidenc%')), 0);
select t.como('lider_b'); select t.pedir_clube('clube_b');
select t.eq('lider_b NÃO vê os pontos de quem é do A', t.nv(format($q$select count(*) from public.pontos where usuario_id = %L$q$, t.id('membro_a'))), 0);
select t.eq('lider_b NÃO vê o progresso operacional (member_specialties) de multi NO A — mesmo vendo a conquista', t.nv(format($q$select count(*) from public.member_specialties where usuario_id = %L and club_id = %L$q$, t.id('multi_dois_papeis'), t.id('clube_a'))), 0);
select t.eq('lider_b NÃO vê as evidências/requisitos de multi no A', t.nv(format($q$select count(*) from public.member_specialty_requirements where usuario_id = %L and club_id = %L$q$, t.id('multi_dois_papeis'), t.id('clube_a'))), 0);
select t.eq('lider_b NÃO vê as avaliações (requirement_approvals) feitas no A', t.nv(format($q$select count(*) from public.requirement_approvals where club_id = %L$q$, t.id('clube_a'))), 0);
select t.eq('lider_b NÃO vê a matrícula de multi na classe sintética NO A', t.nv(format($q$select count(*) from public.member_classes where usuario_id = %L and club_id = %L$q$, t.id('multi_dois_papeis'), t.id('clube_a'))), 0);
select t.eq('lider_b NÃO vê o comprovante (Storage) de quem é do A', t.nv(format($q$select count(*) from storage.objects where bucket_id = 'comprovacoes' and name like %L$q$, t.id('membro_a') || '/%')), 0);
select t.eq('lider_b NÃO vê mensalidade de quem é do A', t.nv(format($q$select count(*) from public.mensalidades where desbravador_id = %L$q$, t.id('membro_a'))), 0);
select t.como('lider_a'); select t.pedir_clube('clube_a');
select t.eq('(controle) lider_a vê o progresso operacional de multi no A', t.n(format($q$select count(*) from public.member_specialties where usuario_id = %L and club_id = %L$q$, t.id('multi_dois_papeis'), t.id('clube_a'))), 2);
reset role;

-- ==================== 8) troca de versão curricular preserva o histórico portátil ====================
insert into public.curriculum_versions (id, origem, identificador, versao, status, fonte_descricao)
values ('00000000-0000-4000-a000-000000000299'::uuid, 'piloto_teste', 'piloto-motor-regras-curriculares', 'rascunho-2', 'publicado', 'v2 de teste');
insert into public.specialties (id, curriculum_version_id, codigo, nome, ordem)
values ('00000000-0000-4000-a000-000000000298'::uuid, '00000000-0000-4000-a000-000000000299'::uuid, 'piloto_portatil', '[PILOTO/TESTE] Portátil (v2)', 40);
insert into public.specialty_requirements (specialty_id, codigo, descricao, tipo_evidencia, evidencia_obrigatoria, ordem) values
  ('00000000-0000-4000-a000-000000000298'::uuid, '1', '[DADO DE TESTE] Requisito revisado na v2.', 'texto', true, 10),
  ('00000000-0000-4000-a000-000000000298'::uuid, '2', '[DADO DE TESTE] Requisito novo na v2.', 'nenhuma', false, 20);
select t.eq('a conquista de multi continua apontando pra ESPECIALIDADE DA V1 (id imutável), não foi "migrada" pra v2',
  (select specialty_id from public.curriculum_achievements where id = t.id('ach_portatil')), t.id('esp_portatil'));
select t.eq('...e a versão curricular da conquista é a rascunho-1',
  (select v.versao from public.curriculum_achievements a join public.specialties sp on sp.id = a.specialty_id join public.curriculum_versions v on v.id = sp.curriculum_version_id where a.id = t.id('ach_portatil')), 'rascunho-1');
select t.eq('a dependência declarada sobre a v1 continua satisfeita (a v2 não invalida o que já foi concluído)',
  array_length(public.dependencias_pendentes('class_requirement', t.id('req_dependente'), t.id('multi_dois_papeis'), t.id('clube_b')), 1), null);
select t.eq('diff v1→v2 da Portátil: 1 adicionado, 1 alterado, 0 removidos (ferramenta de revisão continua funcionando)',
  jsonb_array_length((public.comparar_versoes_curriculares(t.id('versao_regras'), '00000000-0000-4000-a000-000000000299'::uuid)->'adicionados')::jsonb) * 100
  + jsonb_array_length((public.comparar_versoes_curriculares(t.id('versao_regras'), '00000000-0000-4000-a000-000000000299'::uuid)->'alterados')::jsonb) * 10
  + (select count(*) from jsonb_array_elements((public.comparar_versoes_curriculares(t.id('versao_regras'), '00000000-0000-4000-a000-000000000299'::uuid)->'removidos')::jsonb) x where x->>'pai' = '[PILOTO/TESTE] Portátil'), 110);

-- ==================== 5) remover o vínculo com A NÃO apaga o histórico curricular legítimo ====================
delete from public.organization_memberships where user_id = t.id('multi_dois_papeis') and organizational_unit_id = t.id('clube_a');
select t.eq('(controle) multi não tem mais vínculo no A', (select count(*) from public.organization_memberships where user_id = t.id('multi_dois_papeis') and organizational_unit_id = t.id('clube_a')), 0);
select t.eq('a conquista PORTATIL emitida por A continua existindo e ATIVA', (select status from public.curriculum_achievements where id = t.id('ach_portatil')), 'ativa');
select t.eq('a conquista revogada também continua (histórico completo, inclusive a revogação)', (select status from public.curriculum_achievements where id = t.id('ach_x_multi')), 'revogada');
select t.eq('a dependência em B continua satisfeita pela conquista de A, mesmo sem vínculo em A',
  array_length(public.dependencias_pendentes('class_requirement', t.id('req_dependente'), t.id('multi_dois_papeis'), t.id('clube_b')), 1), null);
select t.como('multi_dois_papeis');
select t.eq('a pessoa continua vendo a própria conquista', t.nv(format($q$select count(*) from public.curriculum_achievements where id = %L$q$, t.id('ach_portatil'))), 1);
select t.como('lider_b');
select t.eq('lider_b (clube com vínculo ativo) continua vendo', t.nv(format($q$select count(*) from public.curriculum_achievements where id = %L$q$, t.id('ach_portatil'))), 1);
select t.como('lider_a');
select t.eq('lider_a (EMISSOR) continua vendo e mantém a autoridade sobre o que emitiu, mesmo a pessoa tendo saído', t.nv(format($q$select count(*) from public.curriculum_achievements where id = %L$q$, t.id('ach_portatil'))), 1);
select t.pedir_clube('clube_a');
select t.permitido('...e ainda pode revogar (autoridade permanente do emissor)', format($q$select public.curriculum_achievement_revogar(%L, 'Revisão posterior.')$q$, t.id('ach_portatil')));
reset role;
select t.eq('agora a dependência em B volta a ficar PENDENTE (a revogação do emissor vale em todo lugar; ninguém mais poderia)',
  array_length(public.dependencias_pendentes('class_requirement', t.id('req_dependente'), t.id('multi_dois_papeis'), t.id('clube_b')), 1) > 0, true);
select t.eq('...mas o req 3 já APROVADO em B não é desfeito retroativamente (o que foi avaliado fica avaliado; a EXPLICAÇÃO passa a apontar a pendência)',
  (select status from public.member_requirements where id = t.id('mr_dependente_b')), 'aprovado');

-- ==================== 7) prazo mínimo BLOQUEIA a conclusão; máximo é informativo ====================
select t.eq('as classes/especialidades PILOTO das fases 1/2 não ganharam prazo (NULL — a fonte não determina)',
  (select count(*) from public.classes where id = t.id('classe_piloto_36') and prazo_minimo_dias is null and prazo_maximo_dias is null), 1);
select t.throws('prazo negativo é rejeitado', format($q$update public.specialties set prazo_minimo_dias = -1 where id = %L$q$, t.id('esp_prazo')), 'check');
select t.como('membro_a'); select t.pedir_clube('clube_a');
select t.permitido('membro_a inicia a especialidade COM PRAZO (mín 2 dias, máx 30)', format($q$select public.especialidade_iniciar(%L)$q$, t.id('esp_prazo')));
reset role;
insert into t.ids (chave, id) select 'ms_prazo', id from public.member_specialties where usuario_id = t.id('membro_a') and club_id = t.id('clube_a') and specialty_id = t.id('esp_prazo');
select t.como('lider_a'); select t.pedir_clube('clube_a');
select t.permitido('lider_a aprova o requisito único no MESMO DIA do início', format($q$select public.especialidade_requisito_avaliar((select id from public.member_specialty_requirements where member_specialty_id = %L), 'aprovado', null)$q$, t.id('ms_prazo')));
reset role;
select t.eq('100% dos requisitos aprovados...', public.especialidade_percentual(t.id('ms_prazo')), 100);
select t.eq('...mas a especialidade NÃO concluiu: prazo mínimo de 2 dias ainda não atingido (calculado no servidor a partir de iniciada_em)', (select status from public.member_specialties where id = t.id('ms_prazo')), 'em_andamento');
select t.eq('...e nenhuma conquista foi emitida', (select count(*) from public.curriculum_achievements where member_specialty_id = t.id('ms_prazo')), 0);
select t.eq('prazo_situacao explica: minimo_atingido=false, maximo_excedido=false',
  (select (s->>'minimo_atingido') || '/' || (s->>'maximo_excedido') from (select public.prazo_situacao(ms.iniciada_em, sp.prazo_minimo_dias, sp.prazo_maximo_dias) s
     from public.member_specialties ms join public.specialties sp on sp.id = ms.specialty_id where ms.id = t.id('ms_prazo')) q), 'false/false');
-- simula o tempo passando (400 dias): mínimo atingido E máximo excedido
update public.member_specialties set iniciada_em = now() - interval '400 days' where id = t.id('ms_prazo');
select t.eq('prazo_situacao agora: minimo_atingido=true, maximo_excedido=true, dias_desde_inicio=400',
  (select (s->>'minimo_atingido') || '/' || (s->>'maximo_excedido') || '/' || (s->>'dias_desde_inicio') from (select public.prazo_situacao(ms.iniciada_em, sp.prazo_minimo_dias, sp.prazo_maximo_dias) s
     from public.member_specialties ms join public.specialties sp on sp.id = ms.specialty_id where ms.id = t.id('ms_prazo')) q), 'true/true/400');
select t.como('lider_a'); select t.pedir_clube('clube_a');
select t.permitido('nova avaliação (reprocessa a conclusão)', format($q$select public.especialidade_requisito_avaliar((select id from public.member_specialty_requirements where member_specialty_id = %L), 'aprovado', 'confirmado')$q$, t.id('ms_prazo')));
reset role;
select t.eq('com o mínimo atingido a especialidade conclui — o máximo excedido NÃO bloqueia (é informativo/explicável, sem automação destrutiva)', (select status from public.member_specialties where id = t.id('ms_prazo')), 'concluida');
select t.eq('...e a conquista foi emitida', (select count(*) from public.curriculum_achievements where member_specialty_id = t.id('ms_prazo') and status = 'ativa'), 1);
select t.como('membro_a'); select t.pedir_clube('clube_a');
select t.eq('EXPLICAÇÃO (especialidade): o requisito da especialidade com prazo está SATISFEITO e o grupo 1-de-2 aparece como regra aplicada',
  t.txt(format($q$select (e->>'resultado') || '|' || (select r->>'regra' from jsonb_array_elements(e->'regras_aplicadas') r where r->>'regra' = 'escolha_n_de_m') from (select public.explicar_requisito_especialidade((select id from public.member_specialty_requirements where member_specialty_id = %L)) e) q$q$, t.id('ms_prazo'))), 'satisfeito|escolha_n_de_m');
reset role;
-- prazo em CLASSE (mesma capacidade): declara 5000 dias de mínimo numa classe que membro_a está fazendo e aprova tudo — não conclui
-- (antes, membro_a conclui a Portátil no A, senão o req 3 dele não aprova — a dependência é checada na avaliação)
select t.como('membro_a'); select t.pedir_clube('clube_a');
select t.permitido('membro_a inicia a Portátil no A', format($q$select public.especialidade_iniciar(%L)$q$, t.id('esp_portatil')));
select t.como('lider_a'); select t.pedir_clube('clube_a');
select t.permitido('lider_a aprova a Portátil de membro_a', format($q$select public.especialidade_requisito_avaliar((select id from public.member_specialty_requirements where usuario_id = %L and club_id = %L and specialty_requirement_id = %L), 'aprovado', null)$q$, t.id('membro_a'), t.id('clube_a'), t.id('sreq_piloto_portatil')));
reset role;
update public.classes set prazo_minimo_dias = 5000 where id = t.id('classe_regras');
select t.como('lider_a'); select t.pedir_clube('clube_a');
select t.permitido('lider_a aprova os 3 requisitos da classe sintética de membro_a', format($q$select public.requisito_avaliar(mr.id, 'aprovado', null) from public.member_requirements mr where mr.usuario_id = %L and mr.club_id = %L$q$, t.id('membro_a'), t.id('clube_a')), 3);
reset role;
select t.eq('classe: 3/3 aprovados', public.classe_percentual((select id from public.member_classes where usuario_id = t.id('membro_a') and club_id = t.id('clube_a') and class_id = t.id('classe_regras'))), 100);
select t.eq('...mas a classe NÃO concluiu (prazo mínimo de 5000 dias) e nenhuma revisão de investidura abriu',
  (select status from public.member_classes where usuario_id = t.id('membro_a') and club_id = t.id('clube_a') and class_id = t.id('classe_regras')), 'em_andamento');
select t.eq('...nenhuma conquista de classe emitida', (select count(*) from public.curriculum_achievements where usuario_id = t.id('membro_a') and tipo = 'classe'), 0);
update public.classes set prazo_minimo_dias = null where id = t.id('classe_regras');
select t.como('lider_a'); select t.pedir_clube('clube_a');
select t.permitido('sem prazo, reavaliar 1 requisito reprocessa a conclusão', format($q$select public.requisito_avaliar(%L, 'aprovado', null)$q$, t.id('mr_anual_a')));
reset role;
select t.eq('agora a classe concluiu e a conquista de CLASSE foi emitida (tipo=classe, classe_id, club_id_origem=A)',
  (select count(*) from public.curriculum_achievements a join public.member_classes mc on mc.id = a.member_class_id
    where a.usuario_id = t.id('membro_a') and a.tipo = 'classe' and a.classe_id = t.id('classe_regras') and a.club_id_origem = t.id('clube_a') and a.status = 'ativa' and mc.status = 'concluida'), 1);
select t.como('lider_a'); select t.pedir_clube('clube_a');
select t.permitido('investidura confirmada', format($q$select public.investidura_confirmar((select id from public.member_classes where usuario_id = %L and club_id = %L and class_id = %L), true, null)$q$, t.id('membro_a'), t.id('clube_a'), t.id('classe_regras')));
reset role;
select t.eq('investir (concluida→investida) NÃO duplica a conquista de classe', (select count(*) from public.curriculum_achievements where usuario_id = t.id('membro_a') and tipo = 'classe'), 1);

-- ==================== 10) tentativa de forjar club_id ====================
select t.como('multi_dois_papeis'); select t.pedir_clube('clube_b');
select t.bloqueado('a pessoa NÃO insere uma conquista pra si mesma "em nome" do clube B (INSERT direto revogado)',
  format($q$insert into public.curriculum_achievements (usuario_id, tipo, specialty_id, club_id_origem, concluida_em) values (%L, 'especialidade', %L, %L, now())$q$, t.id('multi_dois_papeis'), t.id('esp_z'), t.id('clube_b')));
select t.como('lider_a'); select t.pedir_clube('clube_a');
select t.bloqueado('nem a liderança insere direto (só o gatilho de conclusão emite; club_id_origem vem do registro operacional)',
  format($q$insert into public.curriculum_achievements (usuario_id, tipo, specialty_id, club_id_origem, concluida_em) values (%L, 'especialidade', %L, %L, now())$q$, t.id('membro_a'), t.id('esp_z'), t.id('clube_b')));
select t.bloqueado('a liderança de A NÃO "muda a origem" de uma conquista pra B por UPDATE', format($q$update public.curriculum_achievements set club_id_origem = %L where id = %L$q$, t.id('clube_b'), t.id('ach_portatil')));
reset role;
select t.eq('nenhuma conquista de Z existe (as tentativas não passaram)', (select count(*) from public.curriculum_achievements where specialty_id = t.id('esp_z')), 0);
select t.eq('club_id_origem de TODA conquista bate com o club_id do registro operacional que a gerou (nunca aceito do cliente)',
  (select count(*) from public.curriculum_achievements a
    left join public.member_specialties ms on ms.id = a.member_specialty_id
    left join public.member_classes mc on mc.id = a.member_class_id
    where a.club_id_origem is distinct from coalesce(ms.club_id, mc.club_id)), 0);

-- header pedindo um clube SEM vínculo: membro_b (só no B) "pede" o A ao iniciar Z — o servidor grava B
select t.como('membro_b'); select t.pedir_clube('clube_a');
select t.permitido('membro_b inicia Z pedindo o clube A no header', format($q$select public.especialidade_iniciar(%L)$q$, t.id('esp_z')));
reset role;
select t.eq('o registro operacional nasceu no clube B (único vínculo real) — o header forjado não foi honrado',
  (select club_id from public.member_specialties where usuario_id = t.id('membro_b') and specialty_id = t.id('esp_z')), t.id('clube_b'));
select t.como('lider_b'); select t.pedir_clube('clube_b');
select t.permitido('lider_b aprova', format($q$select public.especialidade_requisito_avaliar((select id from public.member_specialty_requirements where usuario_id = %L and club_id = %L), 'aprovado', null)$q$, t.id('membro_b'), t.id('clube_b')));
reset role;
select t.eq('...e a conquista saiu com club_id_origem = B (proveniência real), não A',
  (select club_id_origem from public.curriculum_achievements where usuario_id = t.id('membro_b') and specialty_id = t.id('esp_z')), t.id('clube_b'));
insert into t.ids (chave, id) select 'ach_z_membro_b', id from public.curriculum_achievements where usuario_id = t.id('membro_b') and specialty_id = t.id('esp_z');
select t.como('lider_a'); select t.pedir_clube('clube_a');
select t.throws('lider_a, operando no A, NÃO revoga a conquista emitida por B (o header não é a autoridade; club_id_origem é)',
  format($q$select public.curriculum_achievement_revogar(%L, 'forjando')$q$, t.id('ach_z_membro_b')), 'clube que emitiu');
select t.eq('lider_a nem ENXERGA a conquista de membro_b (não emitiu, e membro_b não tem vínculo no A)', t.nv(format($q$select count(*) from public.curriculum_achievements where id = %L$q$, t.id('ach_z_membro_b'))), 0);
reset role;
select t.eq('...continua ativa', (select status from public.curriculum_achievements where id = t.id('ach_z_membro_b')), 'ativa');

select t.fim();
rollback;
