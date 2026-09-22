-- Cenário explícito pedido (fase Classes/Especialidades — motor curricular, migration 36):
-- Tenant 001 (clube A) e Tenant 002 (clube B) COMPARTILHAM o mesmo catálogo curricular (currículo
-- é conteúdo da plataforma) — mas o PROGRESSO de cada pessoa é sempre por clube. Cobre: usuário
-- em dois clubes, avaliador com papéis DIFERENTES nos clubes, tentativa de aprovação CRUZADA
-- (inclusive por quem TEM permissão de gerir no clube em que está operando, só que o requisito é
-- de outro clube), cálculo de progresso sempre no servidor, conclusão + abertura automática da
-- revisão de investidura, e mudança de versão curricular sem alterar o histórico de quem já
-- iniciou a versão antiga.
begin;
\ir _lib.sql
\ir _fixtures.sql

-- Este teste exercita o MOTOR com a classe PILOTO. Desde a fase 3 (migration 40) existe catálogo
-- oficial publicado, e o piloto some do fluxo normal quando isso acontece (teste 37 prova) — aqui
-- arquivamos o oficial (só nesta transação) pra continuar testando o motor com o dado pequeno.
update public.curriculum_versions set status = 'arquivado' where origem = 'oficial';
insert into t.ids (chave, id) values ('classe_piloto', '00000000-0000-4000-a000-000000000002'::uuid);
insert into t.ids (chave, id)
  select 'req_' || s.codigo || '_' || r.codigo, r.id
  from public.class_requirements r join public.class_sections s on s.id = r.section_id
  where s.class_id = t.id('classe_piloto');

-- migration 37: o recurso "classes" passa a bloquear ESCRITA nas RPCs (não só a rota) — liga nos dois clubes de teste.
insert into public.club_features (club_id, feature, enabled) values (t.id('clube_a'), 'classes', true), (t.id('clube_b'), 'classes', true)
on conflict (club_id, feature) do update set enabled = true;

-- ==================== 1) catálogo compartilhado: a MESMA classe piloto aparece nos dois clubes ====================
select t.como('membro_a'); select t.pedir_clube('clube_a');
select t.ok('classe piloto aparece em classes_disponiveis no clube A (catálogo é da plataforma)',
  t.txt('select public.classes_disponiveis()::text') like '%' || t.id('classe_piloto')::text || '%');
select t.como('membro_b'); select t.pedir_clube('clube_b');
select t.ok('a MESMA classe piloto aparece em classes_disponiveis no clube B',
  t.txt('select public.classes_disponiveis()::text') like '%' || t.id('classe_piloto')::text || '%');
reset role;

-- ==================== 2) matrícula: membro_a inicia no clube A, membro_b inicia no clube B ====================
select t.como('membro_a'); select t.pedir_clube('clube_a');
select t.permitido('membro_a inicia a classe piloto no clube A', format($q$select public.classe_iniciar(%L)$q$, t.id('classe_piloto')));
select t.como('membro_b'); select t.pedir_clube('clube_b');
select t.permitido('membro_b inicia a MESMA classe piloto no clube B', format($q$select public.classe_iniciar(%L)$q$, t.id('classe_piloto')));
reset role;

insert into t.ids (chave, id) select 'mc_a', id from public.member_classes where usuario_id = t.id('membro_a') and club_id = t.id('clube_a');
insert into t.ids (chave, id) select 'mc_b', id from public.member_classes where usuario_id = t.id('membro_b') and club_id = t.id('clube_b');

select t.eq('member_classes de A tem club_id = clube A', (select club_id from public.member_classes where id = t.id('mc_a')), t.id('clube_a'));
select t.eq('member_classes de B tem club_id = clube B', (select club_id from public.member_classes where id = t.id('mc_b')), t.id('clube_b'));
select t.eq('7 member_requirements nasceram pra A (um por requisito ativo — 6 da fase 1 + 1 com dependência, migration 37)', (select count(*) from public.member_requirements where member_class_id = t.id('mc_a')), 7);
select t.eq('7 member_requirements nasceram pra B', (select count(*) from public.member_requirements where member_class_id = t.id('mc_b')), 7);
select t.eq('todos nascem nao_iniciado', (select count(*) from public.member_requirements where member_class_id in (t.id('mc_a'), t.id('mc_b')) and status <> 'nao_iniciado'), 0);

-- ==================== 3) preencher e enviar: evidências independentes em cada clube ====================
select t.como('membro_a'); select t.pedir_clube('clube_a');
select t.permitido('membro_a salva rascunho de texto (espiritual/2)', format($q$select public.requisito_salvar(%L, %L, null)$q$, t.id('req_espiritual_2'), 'Aprendi sobre paciência.'));
select t.permitido('membro_a envia espiritual/2 pra avaliação', format($q$select public.requisito_enviar(%L)$q$, t.id('req_espiritual_2')));
select t.throws('membro_a NÃO envia ar_livre/1 sem a foto obrigatória', format($q$select public.requisito_enviar(%L)$q$, t.id('req_ar_livre_1')), 'evidência');
select t.permitido('membro_a salva a evidência (caminho simulado) de ar_livre/1', format($q$select public.requisito_salvar(%L, null, %L)$q$, t.id('req_ar_livre_1'), t.id('membro_a')::text || '/requisitos/1.jpg'));
select t.permitido('agora envia ar_livre/1 (evidência presente)', format($q$select public.requisito_enviar(%L)$q$, t.id('req_ar_livre_1')));
select t.permitido('membro_a envia espiritual/1 (evidência não obrigatória, sem nada salvo)', format($q$select public.requisito_enviar(%L)$q$, t.id('req_espiritual_1')));

select t.como('membro_b'); select t.pedir_clube('clube_b');
select t.permitido('membro_b salva espiritual/2 no clube B (independente do A)', format($q$select public.requisito_salvar(%L, %L, null)$q$, t.id('req_espiritual_2'), 'Outra resposta, outro clube.'));
select t.permitido('...e envia', format($q$select public.requisito_enviar(%L)$q$, t.id('req_espiritual_2')));
reset role;

select t.eq('espiritual/2 de A tem o texto de A', (select evidencia_texto from public.member_requirements where member_class_id = t.id('mc_a') and requirement_id = t.id('req_espiritual_2')), 'Aprendi sobre paciência.');
select t.eq('espiritual/2 de B tem o texto de B (não vazou o de A)', (select evidencia_texto from public.member_requirements where member_class_id = t.id('mc_b') and requirement_id = t.id('req_espiritual_2')), 'Outra resposta, outro clube.');
select t.eq('espiritual/2 de A está aguardando_avaliacao', (select status from public.member_requirements where member_class_id = t.id('mc_a') and requirement_id = t.id('req_espiritual_2')), 'aguardando_avaliacao');

-- ==================== 4) avaliador com papéis DIFERENTES nos clubes (dir_a_membro_b: diretoria no A, desbravador no B) ====================
select t.como('dir_a_membro_b'); select t.pedir_clube('clube_a');
select t.permitido('dir_a_membro_b (diretoria no A) aprova espiritual/2 de membro_a',
  format($q$select public.requisito_avaliar((select id from public.member_requirements where member_class_id = %L and requirement_id = %L), 'aprovado', 'Muito bem!')$q$, t.id('mc_a'), t.id('req_espiritual_2')));
select t.pedir_clube('clube_b');
select t.throws('a MESMA pessoa, operando no clube B (lá é só desbravador), NÃO aprova nada — sem permissão',
  format($q$select public.requisito_avaliar((select id from public.member_requirements where member_class_id = %L and requirement_id = %L), 'aprovado', null)$q$, t.id('mc_b'), t.id('req_espiritual_2')),
  'permissão');
reset role;
select t.eq('espiritual/2 de A está aprovado', (select status from public.member_requirements where member_class_id = t.id('mc_a') and requirement_id = t.id('req_espiritual_2')), 'aprovado');
select t.eq('espiritual/2 de B CONTINUA aguardando (a tentativa no B falhou por permissão)', (select status from public.member_requirements where member_class_id = t.id('mc_b') and requirement_id = t.id('req_espiritual_2')), 'aguardando_avaliacao');

-- ==================== 5) aprovação CRUZADA: avaliador COM permissão no clube em que opera, requisito de OUTRO clube (instrutor_2clubes) ====================
select t.como('instrutor_2clubes'); select t.pedir_clube('clube_b');
-- instrutor_2clubes TEM pode_gerir_no_clube(B)=true (é instrutor lá) — mesmo assim, o requisito alvo é do clube A:
select t.throws('instrutor_2clubes, operando no clube B (onde TEM permissão de gerir), NÃO aprova um requisito do clube A',
  format($q$select public.requisito_avaliar((select id from public.member_requirements where member_class_id = %L and requirement_id = %L), 'aprovado', null)$q$, t.id('mc_a'), t.id('req_ar_livre_1')),
  'não encontrado');
select t.pedir_clube('clube_a');
select t.permitido('a MESMA pessoa, operando no clube A (onde o requisito É de verdade), aprova normalmente',
  format($q$select public.requisito_avaliar((select id from public.member_requirements where member_class_id = %L and requirement_id = %L), 'aprovado', null)$q$, t.id('mc_a'), t.id('req_ar_livre_1')));
reset role;
select t.eq('ar_livre/1 de A está aprovado', (select status from public.member_requirements where member_class_id = t.id('mc_a') and requirement_id = t.id('req_ar_livre_1')), 'aprovado');

-- ==================== 6) instrutor_2clubes aprova de verdade no B (clube certo), sem tocar no A ====================
select t.como('instrutor_2clubes'); select t.pedir_clube('clube_b');
select t.permitido('instrutor_2clubes aprova espiritual/2 de membro_b, agora no clube CERTO (B)',
  format($q$select public.requisito_avaliar((select id from public.member_requirements where member_class_id = %L and requirement_id = %L), 'aprovado', 'Ok!')$q$, t.id('mc_b'), t.id('req_espiritual_2')));
reset role;
select t.eq('espiritual/2 de B está aprovado agora', (select status from public.member_requirements where member_class_id = t.id('mc_b') and requirement_id = t.id('req_espiritual_2')), 'aprovado');
select t.eq('...e o de A continua aprovado de antes (não mudou por causa disso)', (select status from public.member_requirements where member_class_id = t.id('mc_a') and requirement_id = t.id('req_espiritual_2')), 'aprovado');

-- ==================== 7) auditoria: quem avaliou, em qual clube, com qual papel ====================
select t.eq('a aprovação de A ficou registrada com club_id=A, avaliador=dir_a_membro_b, papel=diretoria',
  (select count(*) from public.requirement_approvals
    where member_requirement_id = (select id from public.member_requirements where member_class_id = t.id('mc_a') and requirement_id = t.id('req_espiritual_2'))
      and club_id = t.id('clube_a') and avaliado_por = t.id('dir_a_membro_b') and avaliado_papel = 'diretoria' and decisao = 'aprovado'), 1);
select t.eq('a aprovação de B ficou registrada com club_id=B, avaliador=instrutor_2clubes, papel=instrutor',
  (select count(*) from public.requirement_approvals
    where member_requirement_id = (select id from public.member_requirements where member_class_id = t.id('mc_b') and requirement_id = t.id('req_espiritual_2'))
      and club_id = t.id('clube_b') and avaliado_por = t.id('instrutor_2clubes') and avaliado_papel = 'instrutor' and decisao = 'aprovado'), 1);

-- ==================== 8) progresso: SEMPRE calculado no servidor, nunca recebido do cliente ====================
select t.eq('member_classes NÃO tem coluna "percentual" (não existe onde o cliente possa "mandar 100%") — é sempre classe_percentual()',
  (select count(*) from pg_attribute where attrelid = 'public.member_classes'::regclass and attname = 'percentual' and not attisdropped), 0);
select t.eq('progresso de A: 2 de 7 aprovados = 29% (espiritual/2 + ar_livre/1)', public.classe_percentual(t.id('mc_a')), 29);
select t.eq('progresso de B: 1 de 7 aprovados = 14% (independente de A)', public.classe_percentual(t.id('mc_b')), 14);

select t.como('membro_a'); select t.pedir_clube('clube_a');
select t.eq('minha_classe() de A relata percentual=29 via RPC', t.n($q$select (public.minha_classe()->'member_class'->>'percentual')::int$q$), 29);
select t.como('membro_b'); select t.pedir_clube('clube_b');
select t.eq('minha_classe() de B relata percentual=14 via RPC (não vaza o progresso de A)', t.n($q$select (public.minha_classe()->'member_class'->>'percentual')::int$q$), 14);
reset role;

-- ==================== 9) conclusão automática + abertura da revisão de investidura (só onde de fato terminou) ====================
select t.como('dir_a_membro_b'); select t.pedir_clube('clube_a');
select t.permitido('aprova espiritual/1 (o resto de A)', format($q$select public.requisito_avaliar((select id from public.member_requirements where member_class_id = %L and requirement_id = %L), 'aprovado', null)$q$, t.id('mc_a'), t.id('req_espiritual_1')));
select t.permitido('aprova ar_livre/2', format($q$select public.requisito_avaliar((select id from public.member_requirements where member_class_id = %L and requirement_id = %L), 'aprovado', null)$q$, t.id('mc_a'), t.id('req_ar_livre_2')));
select t.permitido('aprova conhecimentos/1 (sem envio prévio — avaliador pode aprovar direto, ex.: observado em reunião)', format($q$select public.requisito_avaliar((select id from public.member_requirements where member_class_id = %L and requirement_id = %L), 'aprovado', null)$q$, t.id('mc_a'), t.id('req_conhecimentos_1')));
select t.permitido('aprova conhecimentos/2', format($q$select public.requisito_avaliar((select id from public.member_requirements where member_class_id = %L and requirement_id = %L), 'aprovado', null)$q$, t.id('mc_a'), t.id('req_conhecimentos_2')));

-- conhecimentos/3 (migration 37) DEPENDE da especialidade piloto concluída — o motor de Especialidades
-- é testado a fundo no teste 34; aqui só destrava a dependência pelo caminho mais curto (direto na
-- tabela, como postgres) pra confirmar que a classe INTEGRA a dependência sem quebrar o resto do fluxo.
select t.eq('conhecimentos/3 (com dependência) NÃO aprova enquanto a especialidade não está concluída',
  t.txt(format($q$select public.requisito_avaliar((select id from public.member_requirements where member_class_id = %L and requirement_id = %L), 'aprovado', null)::text$q$, t.id('mc_a'), t.id('req_conhecimentos_3'))),
  'ERRO: Requisito bloqueado: Falta concluir antes: [PILOTO/TESTE] Primeiros Socorros.');
reset role;
insert into public.member_specialties (usuario_id, club_id, specialty_id, status, concluida_em)
values (t.id('membro_a'), t.id('clube_a'), '00000000-0000-4000-a000-000000000102'::uuid, 'concluida', now())
on conflict (usuario_id, club_id, specialty_id) do update set status = 'concluida', concluida_em = now();
select t.como('dir_a_membro_b'); select t.pedir_clube('clube_a');
select t.permitido('...e agora que a especialidade está concluída, conhecimentos/3 aprova (fecha 7/7)', format($q$select public.requisito_avaliar((select id from public.member_requirements where member_class_id = %L and requirement_id = %L), 'aprovado', null)$q$, t.id('mc_a'), t.id('req_conhecimentos_3')));
reset role;

select t.eq('classe de A concluiu sozinha (7/7 aprovados)', (select status from public.member_classes where id = t.id('mc_a')), 'concluida');
select t.eq('...e abriu a revisão de investidura sozinha, pendente', (select status from public.investiture_reviews where member_class_id = t.id('mc_a')), 'pendente');
select t.eq('progresso de A agora é 100%', public.classe_percentual(t.id('mc_a')), 100);
select t.eq('a classe de B CONTINUA em_andamento (só 1/7 aprovado lá — não terminou por engano)', (select status from public.member_classes where id = t.id('mc_b')), 'em_andamento');
select t.eq('...e B não tem revisão de investidura (não concluiu)', (select count(*) from public.investiture_reviews where member_class_id = t.id('mc_b')), 0);

-- ==================== 10) investidura: só resolve no clube CERTO ====================
select t.como('instrutor_2clubes'); select t.pedir_clube('clube_b');
select t.throws('instrutor_2clubes, operando no clube B, NÃO confirma a investidura de A (é de outro clube)',
  format($q$select public.investidura_confirmar(%L, true, null)$q$, t.id('mc_a')), 'não encontrada');
select t.como('dir_a_membro_b'); select t.pedir_clube('clube_a');
select t.permitido('dir_a_membro_b confirma a investidura de A, operando no clube certo', format($q$select public.investidura_confirmar(%L, true, 'Parabéns!')$q$, t.id('mc_a')));
reset role;
select t.eq('investiture_reviews de A: investido', (select status from public.investiture_reviews where member_class_id = t.id('mc_a')), 'investido');
select t.eq('member_classes de A: investida', (select status from public.member_classes where id = t.id('mc_a')), 'investida');
select t.eq('member_classes de B continua intocada (em_andamento)', (select status from public.member_classes where id = t.id('mc_b')), 'em_andamento');

-- ==================== 11) mudança de versão curricular: NÃO reescreve o histórico de quem já andou na v1 ====================
insert into public.curriculum_versions (id, origem, identificador, versao, status, fonte_descricao)
values ('00000000-0000-4000-a000-000000000099'::uuid, 'piloto_teste', 'piloto-motor-curricular', 'rascunho-2', 'publicado',
  'Segunda versão de teste, só pra provar que trocar de versão não mexe no histórico de quem já andou na v1.');
insert into public.classes (id, curriculum_version_id, codigo, nome, ordem)
values ('00000000-0000-4000-a000-000000000098'::uuid, '00000000-0000-4000-a000-000000000099'::uuid, 'piloto_amigo', '[PILOTO/TESTE] Amigo (v2)', 10);

select t.eq('a classe NOVA (v2) existe, com o MESMO código, versão DIFERENTE (nunca sobrescreve a v1)',
  (select count(*) from public.classes where codigo = 'piloto_amigo'), 2);
select t.eq('a classe ANTIGA (v1) continua exatamente como estava (mesmo nome, mesmo id)',
  (select nome from public.classes where id = t.id('classe_piloto')), '[PILOTO/TESTE] Amigo');
select t.eq('member_classes de membro_a CONTINUA apontando pra classe da v1 (não foi realocado pra v2 por baixo)',
  (select class_id from public.member_classes where id = t.id('mc_a')), t.id('classe_piloto'));
select t.eq('os requisitos de membro_a continuam TODOS da v1 (histórico intacto — nenhum passou pra v2)',
  (select count(*) from public.member_requirements mr
     join public.class_requirements r on r.id = mr.requirement_id
     join public.class_sections s on s.id = r.section_id
   where mr.member_class_id = t.id('mc_a') and s.class_id <> t.id('classe_piloto')), 0);

select t.como('membro_a'); select t.pedir_clube('clube_a');
select t.eq('minha_classe() de membro_a continua servindo a v1 (rascunho-1) — não pulou pra v2 sozinho',
  t.txt($q$select (public.minha_classe()->'curriculum_version'->>'versao')$q$), 'rascunho-1');
reset role;

select t.fim();
rollback;
