-- Cenário explícito pedido (fase 2 — Especialidades, migration 37): a MESMA pessoa faz a
-- MESMA especialidade em clubes diferentes; um instrutor em 2 clubes avalia cada um
-- corretamente e é bloqueado na aprovação CRUZADA; um requisito de classe dependente de
-- especialidade só libera quando a especialidade está concluída NO MESMO CLUBE (nunca
-- "importada" de outro clube da mesma pessoa); turma/oferta com instrutor responsável que
-- não é liderança; conclusão automática; histórico de avaliação; mudança de versão sem
-- alterar o histórico + a ferramenta de diff; feature flag "classes" desligada bloqueia
-- escrita (não só a rota).
begin;
\ir _lib.sql
\ir _fixtures.sql

insert into t.ids (chave, id) values
  ('classe_piloto', '00000000-0000-4000-a000-000000000002'::uuid),
  ('especialidade_piloto', '00000000-0000-4000-a000-000000000102'::uuid),
  ('versao_especialidade_piloto', '00000000-0000-4000-a000-000000000101'::uuid);
insert into t.ids (chave, id) select 'req_pri_' || codigo, id from public.specialty_requirements where specialty_id = t.id('especialidade_piloto');
insert into t.ids (chave, id) select 'req_conhecimentos_3', r.id from public.class_requirements r
  join public.class_sections s on s.id = r.section_id where s.class_id = t.id('classe_piloto') and s.codigo = 'conhecimentos' and r.codigo = '3';

-- ==================== 1) recurso "classes" desligado por padrão: escrita bloqueada (não só a rota) ====================
select t.como('multi_dois_papeis'); select t.pedir_clube('clube_a');
select t.throws('com o recurso "classes" desligado, especialidade_iniciar é recusado pelo SERVIDOR (não só escondido no menu)',
  format($q$select public.especialidade_iniciar(%L)$q$, t.id('especialidade_piloto')), 'desabilitado');
reset role;

insert into public.club_features (club_id, feature, enabled) values (t.id('clube_a'), 'classes', true), (t.id('clube_b'), 'classes', true)
on conflict (club_id, feature) do update set enabled = true;

-- ==================== 2) a MESMA pessoa faz a MESMA especialidade em clubes diferentes ====================
-- multi_dois_papeis: desbravador no A (unid A1), conselheiro no B (unid B1) — fixture pronta (27_multiclube_real).
select t.como('multi_dois_papeis');
select t.pedir_clube('clube_a');
select t.permitido('inicia a especialidade piloto no clube A (desbravador lá)', format($q$select public.especialidade_iniciar(%L)$q$, t.id('especialidade_piloto')));
select t.pedir_clube('clube_b');
select t.permitido('inicia a MESMA especialidade piloto no clube B (conselheiro lá — qualquer vínculo ativo pode)', format($q$select public.especialidade_iniciar(%L)$q$, t.id('especialidade_piloto')));
reset role;

insert into t.ids (chave, id) select 'ms_a', id from public.member_specialties where usuario_id = t.id('multi_dois_papeis') and club_id = t.id('clube_a');
insert into t.ids (chave, id) select 'ms_b', id from public.member_specialties where usuario_id = t.id('multi_dois_papeis') and club_id = t.id('clube_b');
select t.eq('member_specialties de A tem club_id = clube A', (select club_id from public.member_specialties where id = t.id('ms_a')), t.id('clube_a'));
select t.eq('member_specialties de B tem club_id = clube B', (select club_id from public.member_specialties where id = t.id('ms_b')), t.id('clube_b'));
select t.eq('3 member_specialty_requirements nasceram pra A', (select count(*) from public.member_specialty_requirements where member_specialty_id = t.id('ms_a')), 3);
select t.eq('3 member_specialty_requirements nasceram pra B', (select count(*) from public.member_specialty_requirements where member_specialty_id = t.id('ms_b')), 3);

-- evidências independentes nos dois clubes
select t.como('multi_dois_papeis');
select t.pedir_clube('clube_a');
select t.permitido('salva e envia req 1 (texto) no clube A', format($q$select public.especialidade_requisito_salvar(%L, %L, null)$q$, t.id('req_pri_1'), 'Resposta no clube A.'));
select t.permitido('...envia', format($q$select public.especialidade_requisito_enviar(%L)$q$, t.id('req_pri_1')));
select t.pedir_clube('clube_b');
select t.permitido('salva e envia req 1 (texto) no clube B — resposta DIFERENTE', format($q$select public.especialidade_requisito_salvar(%L, %L, null)$q$, t.id('req_pri_1'), 'Resposta no clube B.'));
select t.permitido('...envia', format($q$select public.especialidade_requisito_enviar(%L)$q$, t.id('req_pri_1')));
reset role;
select t.eq('req 1 de A tem o texto de A', (select evidencia_texto from public.member_specialty_requirements where member_specialty_id = t.id('ms_a') and specialty_requirement_id = t.id('req_pri_1')), 'Resposta no clube A.');
select t.eq('req 1 de B tem o texto de B (não vazou o de A)', (select evidencia_texto from public.member_specialty_requirements where member_specialty_id = t.id('ms_b') and specialty_requirement_id = t.id('req_pri_1')), 'Resposta no clube B.');

-- ==================== 3) instrutor em 2 clubes avalia cada um corretamente; aprovação CRUZADA bloqueada ====================
select t.como('instrutor_2clubes'); select t.pedir_clube('clube_a');
select t.permitido('instrutor_2clubes aprova req 1 de A, operando no clube A',
  format($q$select public.especialidade_requisito_avaliar((select id from public.member_specialty_requirements where member_specialty_id = %L and specialty_requirement_id = %L), 'aprovado', null)$q$, t.id('ms_a'), t.id('req_pri_1')));
select t.throws('instrutor_2clubes, AINDA operando no clube A, NÃO aprova o req 1 de B (é de outro clube, mesmo tendo permissão em ambos)',
  format($q$select public.especialidade_requisito_avaliar((select id from public.member_specialty_requirements where member_specialty_id = %L and specialty_requirement_id = %L), 'aprovado', null)$q$, t.id('ms_b'), t.id('req_pri_1')),
  'não encontrado');
select t.pedir_clube('clube_b');
select t.permitido('a MESMA pessoa, agora operando no clube B, aprova o req 1 de B normalmente',
  format($q$select public.especialidade_requisito_avaliar((select id from public.member_specialty_requirements where member_specialty_id = %L and specialty_requirement_id = %L), 'aprovado', 'Ok, clube B!')$q$, t.id('ms_b'), t.id('req_pri_1')));
reset role;
select t.eq('req 1 de A está aprovado', (select status from public.member_specialty_requirements where member_specialty_id = t.id('ms_a') and specialty_requirement_id = t.id('req_pri_1')), 'aprovado');
select t.eq('req 1 de B está aprovado', (select status from public.member_specialty_requirements where member_specialty_id = t.id('ms_b') and specialty_requirement_id = t.id('req_pri_1')), 'aprovado');

-- ==================== 4) histórico de avaliação: quem, quando, em qual clube, com qual papel ====================
select t.eq('a aprovação do req 1 de A ficou auditada: club_id=A, avaliador=instrutor_2clubes, papel=instrutor',
  (select count(*) from public.requirement_approvals
    where member_specialty_requirement_id = (select id from public.member_specialty_requirements where member_specialty_id = t.id('ms_a') and specialty_requirement_id = t.id('req_pri_1'))
      and club_id = t.id('clube_a') and avaliado_por = t.id('instrutor_2clubes') and avaliado_papel = 'instrutor' and decisao = 'aprovado'), 1);
select t.eq('a aprovação do req 1 de B ficou auditada: club_id=B, avaliador=instrutor_2clubes, papel=instrutor, com o comentário',
  (select count(*) from public.requirement_approvals
    where member_specialty_requirement_id = (select id from public.member_specialty_requirements where member_specialty_id = t.id('ms_b') and specialty_requirement_id = t.id('req_pri_1'))
      and club_id = t.id('clube_b') and avaliado_por = t.id('instrutor_2clubes') and avaliado_papel = 'instrutor' and comentario = 'Ok, clube B!'), 1);
select t.como('multi_dois_papeis'); select t.pedir_clube('clube_a');
select t.ok('minha_especialidade() de A mostra o histórico de avaliação do próprio requisito (avaliador e decisão)',
  t.txt($q$select (public.minha_especialidade()->'requisitos'->0->'avaliacoes')::text$q$) like '%Instrutor Dois Clubes%'
  and t.txt($q$select (public.minha_especialidade()->'requisitos'->0->'avaliacoes')::text$q$) like '%aprovado%');
reset role;

-- ==================== 5) recurso "classes" desligado NUM clube só: bloqueia lá, não no outro ====================
-- (feito aqui, enquanto req 2 de ms_a/ms_b ainda está intocado nos dois clubes — não interfere no resto do cenário)
update public.club_features set enabled = false where club_id = t.id('clube_b') and feature = 'classes';
select t.como('multi_dois_papeis'); select t.pedir_clube('clube_b');
select t.throws('com "classes" desligado só no clube B, escrever lá é recusado pelo SERVIDOR', format($q$select public.especialidade_requisito_salvar(%L, %L, null)$q$, t.id('req_pri_2'), 'tentativa'), 'desabilitado');
select t.pedir_clube('clube_a');
select t.permitido('...mas no clube A (onde continua ligado) a escrita segue funcionando', format($q$select public.especialidade_requisito_salvar(%L, null, null)$q$, t.id('req_pri_2')));
reset role;
update public.club_features set enabled = true where club_id = t.id('clube_b') and feature = 'classes';

-- ==================== 6) turma/oferta: instrutor responsável NÃO-liderança avalia SÓ a própria turma ====================
select t.como('lider_a'); select t.pedir_clube('clube_a');
select t.permitido('liderança cria a turma/oferta, com conselheiro_a como instrutor responsável', format($q$select public.oferta_especialidade_criar(%L, 'Turma de teste', %L, null, null)$q$, t.id('especialidade_piloto'), t.id('conselheiro_a')));
reset role;
insert into t.ids (chave, id) select 'oferta_a', id from public.specialty_offerings where club_id = t.id('clube_a') and instrutor_responsavel_id = t.id('conselheiro_a');
select t.eq('a oferta nasceu com o instrutor responsável certo (conselheiro, não precisa ser instrutor/diretoria)',
  (select instrutor_responsavel_id from public.specialty_offerings where id = t.id('oferta_a')), t.id('conselheiro_a'));

select t.como('lider_a'); select t.pedir_clube('clube_a');
select t.permitido('liderança atribui membro_a2 à turma', format($q$select public.especialidade_atribuir(%L, %L, %L)$q$, t.id('membro_a2'), t.id('especialidade_piloto'), t.id('oferta_a')));
reset role;
insert into t.ids (chave, id) select 'ms_a2', id from public.member_specialties where usuario_id = t.id('membro_a2') and club_id = t.id('clube_a');
select t.eq('member_specialties de membro_a2 ficou ligado à oferta', (select oferta_id from public.member_specialties where id = t.id('ms_a2')), t.id('oferta_a'));

select t.como('conselheiro_a'); select t.pedir_clube('clube_a');
select t.permitido('conselheiro_a (instrutor responsável da turma, NÃO tem pode_gerir_no_clube) avalia membro_a2 — porque é O responsável por essa oferta',
  format($q$select public.especialidade_requisito_avaliar((select id from public.member_specialty_requirements where member_specialty_id = %L and specialty_requirement_id = %L), 'aprovado', null)$q$, t.id('ms_a2'), t.id('req_pri_2')));
-- (a linha de multi_dois_papeis nem aparece pra conselheiro_a via RLS — não é dono, não gere o clube,
-- não é responsável por NENHUMA oferta dela; a subconsulta já devolve NULL, então a resposta é "não
-- encontrado", igual a um UUID inexistente — mesmo padrão de "sem oráculo" do resto do banco)
select t.throws('...mas conselheiro_a NÃO avalia a especialidade de multi_dois_papeis (não é dessa oferta, e conselheiro não é liderança)',
  format($q$select public.especialidade_requisito_avaliar((select id from public.member_specialty_requirements where member_specialty_id = %L and specialty_requirement_id = %L), 'aprovado', null)$q$, t.id('ms_a'), t.id('req_pri_2')),
  'não encontrado');
reset role;
select t.eq('req 2 de membro_a2 está aprovado (via responsável da turma)', (select status from public.member_specialty_requirements where member_specialty_id = t.id('ms_a2') and specialty_requirement_id = t.id('req_pri_2')), 'aprovado');

-- ==================== 7) dependência de Classe -> Especialidade: só no MESMO clube, nunca "importada" de outro ====================
select t.ok('req_conhecimentos_3 (classe piloto) ainda tem dependência pendente pra multi_dois_papeis no clube A (especialidade não concluída lá ainda)',
  array_length(public.dependencias_pendentes('class_requirement', t.id('req_conhecimentos_3'), t.id('multi_dois_papeis'), t.id('clube_a')), 1) > 0);
-- conclui a especialidade de multi_dois_papeis NO CLUBE A (falta só req 3; req 1 já aprovado acima)
select t.como('instrutor_2clubes'); select t.pedir_clube('clube_a');
select t.permitido('aprova req 3 de A (o 1 já tinha sido aprovado na seção 3 — vai pra 2/3)', format($q$select public.especialidade_requisito_avaliar((select id from public.member_specialty_requirements where member_specialty_id = %L and specialty_requirement_id = %L), 'aprovado', null)$q$, t.id('ms_a'), t.id('req_pri_3')));
select t.permitido('aprova req 2 de A (o último — fecha 3/3)', format($q$select public.especialidade_requisito_avaliar((select id from public.member_specialty_requirements where member_specialty_id = %L and specialty_requirement_id = %L), 'aprovado', null)$q$, t.id('ms_a'), t.id('req_pri_2')));
reset role;
select t.eq('especialidade de multi_dois_papeis no clube A: concluída sozinha (conclusão automática)', (select status from public.member_specialties where id = t.id('ms_a')), 'concluida');
select t.eq('progresso de A: 100%', public.especialidade_percentual(t.id('ms_a')), 100);
select t.eq('...e a de B CONTINUA em_andamento (só 1/3 aprovado lá)', (select status from public.member_specialties where id = t.id('ms_b')), 'em_andamento');

select t.eq('AGORA a dependência de conhecimentos/3 está satisfeita pra multi_dois_papeis NO CLUBE A',
  array_length(public.dependencias_pendentes('class_requirement', t.id('req_conhecimentos_3'), t.id('multi_dois_papeis'), t.id('clube_a')), 1), null);
select t.eq('...mas CONTINUA pendente NO CLUBE B — a conclusão em A não "vaza" pra B, mesma pessoa ou não',
  array_length(public.dependencias_pendentes('class_requirement', t.id('req_conhecimentos_3'), t.id('multi_dois_papeis'), t.id('clube_b')), 1) > 0, true);

-- ==================== 8) mudança de versão: v2 não mexe no histórico de quem já andou na v1 + ferramenta de diff ====================
insert into public.curriculum_versions (id, origem, identificador, versao, status, fonte_descricao)
values ('00000000-0000-4000-a000-000000000199'::uuid, 'piloto_teste', 'piloto-motor-curricular-especialidade', 'rascunho-2', 'publicado', 'v2 de teste, só pra provar o diff e a preservação do histórico.');
insert into public.specialties (id, curriculum_version_id, codigo, nome, categoria, nivel, ordem)
values ('00000000-0000-4000-a000-000000000198'::uuid, '00000000-0000-4000-a000-000000000199'::uuid, 'piloto_primeiros_socorros', '[PILOTO/TESTE] Primeiros Socorros', 'Dado de teste', 'regular', 10);
insert into public.specialty_requirements (specialty_id, codigo, descricao, tipo_evidencia, evidencia_obrigatoria, ordem) values
  ('00000000-0000-4000-a000-000000000198'::uuid, '1', '[DADO DE TESTE] Explicar em texto livre o que fazer numa emergência simples (texto revisado na v2).', 'texto', true, 10),
  ('00000000-0000-4000-a000-000000000198'::uuid, '3', '[DADO DE TESTE] Enviar uma foto do kit de primeiros socorros montado.', 'foto', true, 30),
  ('00000000-0000-4000-a000-000000000198'::uuid, '4', '[DADO DE TESTE] Requisito novo da v2 (não existia na v1).', 'nenhuma', false, 40);
-- (a v2 propositalmente OMITE o requisito '2' — simula uma remoção)

select t.eq('a especialidade v2 existe, MESMO código, versão diferente (nunca sobrescreve a v1)', (select count(*) from public.specialties where codigo = 'piloto_primeiros_socorros'), 2);
select t.eq('a v1 continua exatamente como estava', (select nome from public.specialties where id = t.id('especialidade_piloto')), '[PILOTO/TESTE] Primeiros Socorros');
select t.eq('member_specialties de multi_dois_papeis CONTINUA na v1 (não foi realocado pra v2)', (select specialty_id from public.member_specialties where id = t.id('ms_a')), t.id('especialidade_piloto'));

select t.como('multi_dois_papeis'); select t.pedir_clube('clube_a');
select t.eq('minha_especialidade() de multi_dois_papeis continua servindo a v1 (rascunho-1)',
  t.txt($q$select (public.minha_especialidade()->'curriculum_version'->>'versao')$q$), 'rascunho-1');
reset role;

select t.como('lider_a'); select t.pedir_clube('clube_a');
select t.eq('diff: 1 requisito ADICIONADO (o "4", novo na v2)',
  t.n($q$select jsonb_array_length((public.comparar_versoes_curriculares('00000000-0000-4000-a000-000000000101'::uuid, '00000000-0000-4000-a000-000000000199'::uuid)->'adicionados')::jsonb)$q$), 1);
select t.eq('diff: 1 requisito REMOVIDO (o "2", que não existe na v2)',
  t.n($q$select jsonb_array_length((public.comparar_versoes_curriculares('00000000-0000-4000-a000-000000000101'::uuid, '00000000-0000-4000-a000-000000000199'::uuid)->'removidos')::jsonb)$q$), 1);
select t.eq('diff: 1 requisito ALTERADO (o "1", descrição mudou)',
  t.n($q$select jsonb_array_length((public.comparar_versoes_curriculares('00000000-0000-4000-a000-000000000101'::uuid, '00000000-0000-4000-a000-000000000199'::uuid)->'alterados')::jsonb)$q$), 1);
reset role;

select t.fim();
rollback;
