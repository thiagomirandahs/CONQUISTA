-- Etapa 2 (pós-migração real): jornada de entrega/correção/reenvio de requisito de Classe.
-- Cobre: texto/foto/arquivo preservados por tentativa; correção→reenvio sem perder a tentativa
-- anterior; histórico completo; isolamento de evidência entre clubes (inclusive para a MESMA
-- pessoa com vínculo nos dois); concorrência entre dois avaliadores sobre a mesma tentativa.
begin;
\ir _lib.sql
\ir _fixtures.sql

-- Mesmo procedimento do teste 32: só nesta transação, o piloto vira "oficial" pra exercitar o motor.
update public.curriculum_versions set status = 'arquivado' where origem = 'oficial';
update public.curriculum_versions set origem = 'oficial' where id = '00000000-0000-4000-a000-000000000001'::uuid;
insert into t.ids (chave, id) values ('classe_piloto', '00000000-0000-4000-a000-000000000002'::uuid);
insert into t.ids (chave, id)
  select 'req_' || s.codigo || '_' || r.codigo, r.id
  from public.class_requirements r join public.class_sections s on s.id = r.section_id
  where s.class_id = t.id('classe_piloto');

-- requisito extra de tipo 'arquivo' (a fixture da classe piloto não tem nenhum) — só pra este teste.
insert into public.class_requirements (section_id, codigo, descricao, tipo_evidencia, evidencia_obrigatoria, ordem)
values ((select id from public.class_sections where class_id = t.id('classe_piloto') and codigo = 'conhecimentos'),
        '4', '[DADO DE TESTE] Enviar o comprovante em PDF de participação num evento.', 'arquivo', true, 30)
on conflict (section_id, codigo) do update set tipo_evidencia = excluded.tipo_evidencia, evidencia_obrigatoria = excluded.evidencia_obrigatoria;
insert into t.ids (chave, id) select 'req_conhecimentos_4', id from public.class_requirements
 where section_id = (select id from public.class_sections where class_id = t.id('classe_piloto') and codigo = 'conhecimentos') and codigo = '4';

insert into public.club_features (club_id, feature, enabled) values (t.id('clube_a'), 'classes', true), (t.id('clube_b'), 'classes', true)
on conflict (club_id, feature) do update set enabled = true;

-- ==================== 1) membro_a inicia e envia texto, foto e arquivo ====================
select t.como('membro_a'); select t.pedir_clube('clube_a');
select t.permitido('membro_a inicia a classe piloto no clube A', format($q$select public.classe_iniciar(%L)$q$, t.id('classe_piloto')));
reset role;
insert into t.ids (chave, id) select 'mc_a', id from public.member_classes where usuario_id = t.id('membro_a') and club_id = t.id('clube_a');
insert into t.ids (chave, id) select 'mr_texto', id from public.member_requirements where member_class_id = t.id('mc_a') and requirement_id = t.id('req_espiritual_2');
insert into t.ids (chave, id) select 'mr_foto', id from public.member_requirements where member_class_id = t.id('mc_a') and requirement_id = t.id('req_ar_livre_1');
insert into t.ids (chave, id) select 'mr_arquivo', id from public.member_requirements where member_class_id = t.id('mc_a') and requirement_id = t.id('req_conhecimentos_4');

select t.como('membro_a'); select t.pedir_clube('clube_a');
select t.permitido('texto: salva rascunho', format($q$select public.requisito_salvar(%L, %L, null)$q$, t.id('req_espiritual_2'), 'Aprendi sobre paciência.'));
select t.permitido('texto: envia (Tentativa 1)', format($q$select public.requisito_enviar(%L)$q$, t.id('req_espiritual_2')));
select t.permitido('foto: salva rascunho com path', format($q$select public.requisito_salvar(%L, null, %L)$q$, t.id('req_ar_livre_1'), 'clube-a-teste-fake/' || t.id('membro_a')::text || '/requisitos/foto1.jpg'));
select t.permitido('foto: envia (Tentativa 1)', format($q$select public.requisito_enviar(%L)$q$, t.id('req_ar_livre_1')));
select t.permitido('arquivo: salva rascunho com path de pdf', format($q$select public.requisito_salvar(%L, null, %L)$q$, t.id('req_conhecimentos_4'), 'clube-a-teste-fake/' || t.id('membro_a')::text || '/requisitos/comprovante1.pdf'));
select t.permitido('arquivo: envia (Tentativa 1)', format($q$select public.requisito_enviar(%L)$q$, t.id('req_conhecimentos_4')));
reset role;

select t.eq('1ª submissão de texto: tentativa 1, tipo texto', (select tipo_evidencia_entregue || '|' || tentativa_numero::text from public.requirement_submissions where member_requirement_id = t.id('mr_texto')), 'texto|1');
select t.eq('1ª submissão de foto: tentativa 1, tipo foto', (select tipo_evidencia_entregue || '|' || tentativa_numero::text from public.requirement_submissions where member_requirement_id = t.id('mr_foto')), 'foto|1');
select t.eq('1ª submissão de arquivo: tentativa 1, tipo arquivo', (select tipo_evidencia_entregue || '|' || tentativa_numero::text from public.requirement_submissions where member_requirement_id = t.id('mr_arquivo')), 'arquivo|1');
select t.eq('os 3 requisitos estão aguardando_avaliacao', (select count(*) from public.member_requirements where id in (t.id('mr_texto'), t.id('mr_foto'), t.id('mr_arquivo')) and status = 'aguardando_avaliacao'), 3);

-- ==================== 2) lider_a pede correção do texto (Tentativa 1), exigindo orientação ====================
select t.como('lider_a'); select t.pedir_clube('clube_a');
select t.throws('correção sem orientação é recusada',
  format($q$select public.requisito_avaliar(%L, 'correcao_solicitada', null)$q$, t.id('mr_texto')), 'Explique');
select t.permitido('lider_a pede correção do texto com orientação',
  format($q$select public.requisito_avaliar(%L, 'correcao_solicitada', %L)$q$, t.id('mr_texto'), 'Refaça explicando com mais detalhes o que você aprendeu.'));
reset role;
select t.eq('texto voltou pra correcao_solicitada', (select status from public.member_requirements where id = t.id('mr_texto')), 'correcao_solicitada');
select t.eq('só 1 submissão ainda (a correção não cria tentativa nova sozinha)', (select count(*) from public.requirement_submissions where member_requirement_id = t.id('mr_texto')), 1);

-- ==================== 3) membro_a corrige e reenvia — a Tentativa 1 continua intacta ====================
select t.como('membro_a'); select t.pedir_clube('clube_a');
select t.permitido('membro_a corrige o texto', format($q$select public.requisito_salvar(%L, %L, null)$q$, t.id('req_espiritual_2'), 'Aprendi sobre paciência: exemplo detalhado da reunião de terça.'));
select t.permitido('membro_a reenvia (Tentativa 2)', format($q$select public.requisito_enviar(%L)$q$, t.id('req_espiritual_2')));
reset role;

select t.eq('agora existem 2 tentativas de texto', (select count(*) from public.requirement_submissions where member_requirement_id = t.id('mr_texto')), 2);
select t.eq('Tentativa 1 continua com o texto ORIGINAL (não foi sobrescrita)',
  (select evidencia_texto from public.requirement_submissions where member_requirement_id = t.id('mr_texto') and tentativa_numero = 1), 'Aprendi sobre paciência.');
select t.eq('Tentativa 2 tem o texto CORRIGIDO',
  (select evidencia_texto from public.requirement_submissions where member_requirement_id = t.id('mr_texto') and tentativa_numero = 2), 'Aprendi sobre paciência: exemplo detalhado da reunião de terça.');

-- ==================== 4) lider_a aprova a Tentativa 2 — histórico mostra as duas ====================
select t.como('lider_a'); select t.pedir_clube('clube_a');
select t.permitido('lider_a aprova a Tentativa 2', format($q$select public.requisito_avaliar(%L, 'aprovado', 'Ficou claro agora, parabéns.')$q$, t.id('mr_texto')));
reset role;

select t.como('membro_a'); select t.pedir_clube('clube_a');
select t.eq('histórico: 2 tentativas, na ordem certa, com decisão de cada uma',
  (select string_agg((x->>'tentativa_numero') || ':' || coalesce(x->>'decisao', 'sem_decisao'), ',' order by (x->>'tentativa_numero')::int)
   from json_array_elements((public.requisito_historico(t.id('mr_texto'))->'tentativas')) x),
  '1:correcao_solicitada,2:aprovado');
select t.eq('a orientação da Tentativa 1 ficou registrada no histórico',
  (select x->>'comentario' from json_array_elements((public.requisito_historico(t.id('mr_texto'))->'tentativas')) x where (x->>'tentativa_numero')::int = 1),
  'Refaça explicando com mais detalhes o que você aprendeu.');
reset role;

-- ==================== 5) concorrência: dois avaliadores decidindo a MESMA tentativa ====================
select t.como('lider_a'); select t.pedir_clube('clube_a');
select t.permitido('avaliador 1: aprova a foto (Tentativa 1)', format($q$select public.requisito_avaliar(%L, 'aprovado', null, (select id from public.requirement_submissions where member_requirement_id=%L order by tentativa_numero desc limit 1))$q$, t.id('mr_foto'), t.id('mr_foto')));
reset role;
select t.como('instrutor_a'); select t.pedir_clube('clube_a');
select t.throws('avaliador 2: tenta corrigir a MESMA tentativa já decidida pelo avaliador 1 — recusado, não sobrescreve',
  format($q$select public.requisito_avaliar(%L, 'correcao_solicitada', 'tarde demais', (select id from public.requirement_submissions where member_requirement_id=%L order by tentativa_numero desc limit 1))$q$, t.id('mr_foto'), t.id('mr_foto')),
  'já foi avaliada');
reset role;
select t.eq('a foto continua aprovada (a segunda decisão não corrompeu o histórico)', (select status from public.member_requirements where id = t.id('mr_foto')), 'aprovado');
select t.eq('só 1 decisão registrada pra essa tentativa (não 2)', (select count(*) from public.requirement_approvals where submission_id = (select id from public.requirement_submissions where member_requirement_id = t.id('mr_foto'))), 1);

-- reenvio depois de aprovado não é permitido (mesma regra de sempre, preservada)
select t.como('membro_a'); select t.pedir_clube('clube_a');
select t.throws('membro_a NÃO reenvia um requisito já aprovado', format($q$select public.requisito_enviar(%L)$q$, t.id('req_ar_livre_1')), 'já foi aprovado');
reset role;

-- ==================== 6) a mesma criança em DOIS clubes — submissões e histórico independentes ====================
select t.como('multi_dois_papeis'); select t.pedir_clube('clube_a');
select t.permitido('multi inicia a classe piloto no clube A', format($q$select public.classe_iniciar(%L)$q$, t.id('classe_piloto')));
select t.como('multi_dois_papeis'); select t.pedir_clube('clube_b');
select t.permitido('a MESMA pessoa inicia a MESMA classe piloto no clube B', format($q$select public.classe_iniciar(%L)$q$, t.id('classe_piloto')));
reset role;

insert into t.ids (chave, id) select 'mr_multi_a', id from public.member_requirements where usuario_id = t.id('multi_dois_papeis') and club_id = t.id('clube_a') and requirement_id = t.id('req_espiritual_2');
insert into t.ids (chave, id) select 'mr_multi_b', id from public.member_requirements where usuario_id = t.id('multi_dois_papeis') and club_id = t.id('clube_b') and requirement_id = t.id('req_espiritual_2');

select t.como('multi_dois_papeis'); select t.pedir_clube('clube_a');
select t.permitido('multi envia no clube A', format($q$select public.requisito_salvar(%L, %L, null)$q$, t.id('req_espiritual_2'), 'Texto do clube A.'));
select t.permitido('...', format($q$select public.requisito_enviar(%L)$q$, t.id('req_espiritual_2')));
select t.como('multi_dois_papeis'); select t.pedir_clube('clube_b');
select t.permitido('multi envia no clube B, com texto DIFERENTE', format($q$select public.requisito_salvar(%L, %L, null)$q$, t.id('req_espiritual_2'), 'Texto do clube B, nada a ver com o A.'));
select t.permitido('...', format($q$select public.requisito_enviar(%L)$q$, t.id('req_espiritual_2')));
reset role;

select t.eq('a submissão do clube A tem o texto de A', (select evidencia_texto from public.requirement_submissions where member_requirement_id = t.id('mr_multi_a')), 'Texto do clube A.');
select t.eq('a submissão do clube B tem o texto de B, isolada da de A', (select evidencia_texto from public.requirement_submissions where member_requirement_id = t.id('mr_multi_b')), 'Texto do clube B, nada a ver com o A.');
select t.eq('club_id da submissão de A é o clube A (derivado, não do cliente)', (select club_id from public.requirement_submissions where member_requirement_id = t.id('mr_multi_a')), t.id('clube_a'));
select t.eq('club_id da submissão de B é o clube B', (select club_id from public.requirement_submissions where member_requirement_id = t.id('mr_multi_b')), t.id('clube_b'));

-- liderança de B não avalia (nem enxerga na fila) o requisito de A da mesma pessoa
select t.como('lider_b'); select t.pedir_clube('clube_b');
select t.throws('lider_b NÃO avalia o requisito do clube A da mesma pessoa (aba errada)',
  format($q$select public.requisito_avaliar(%L, 'aprovado', null)$q$, t.id('mr_multi_a')), 'não encontrado');
select t.eq('a fila de B não lista o item de A', t.txt('select public.classe_avaliacoes_pendentes()::text') like ('%' || t.id('mr_multi_a')::text || '%'), 'false');
reset role;

-- ==================== 7) histórico: por member_requirement_id, único, nunca vaza de A pra B ====================
-- requisito_historico(member_requirement_id) exige club_id = clube_atual_id() na própria consulta
-- — passar o id de A enquanto se está em B (ou vice-versa) dá exatamente "não encontrado", nunca
-- os dados do outro clube.
select t.como('lider_b'); select t.pedir_clube('clube_b');
select t.throws('lider_b NÃO lê o histórico do member_requirement de A, mesmo sabendo o id (aba errada)',
  format($q$select public.requisito_historico(%L)$q$, t.id('mr_multi_a')), 'não encontrado');
select t.eq('lider_b LÊ o histórico do de B, com o texto de B',
  (select x->>'evidencia_texto' from json_array_elements((public.requisito_historico(t.id('mr_multi_b'))->'tentativas')) x limit 1),
  'Texto do clube B, nada a ver com o A.');
reset role;

select t.como('lider_a'); select t.pedir_clube('clube_a');
select t.throws('lider_a NÃO lê o histórico do member_requirement de B, mesmo sabendo o id (aba errada)',
  format($q$select public.requisito_historico(%L)$q$, t.id('mr_multi_b')), 'não encontrado');
select t.eq('lider_a LÊ o histórico do de A, com o texto de A — nunca o de B',
  (select x->>'evidencia_texto' from json_array_elements((public.requisito_historico(t.id('mr_multi_a'))->'tentativas')) x limit 1),
  'Texto do clube A.');
reset role;

-- ==================== 8) fila unificada: classes aparecem junto com especialidades, filtro por tipo funciona ====================
select t.como('lider_a'); select t.pedir_clube('clube_a');
select t.ok('fila unificada (tipo=classe) inclui o requisito de arquivo de membro_a',
  t.txt('select public.fila_avaliacao_unificada(''classe'', null)::text') like '%' || t.id('mr_arquivo')::text || '%');
select t.eq('fila unificada (tipo=especialidade) NÃO traz nenhum item de classe',
  t.txt('select public.fila_avaliacao_unificada(''especialidade'', null)::text') like '%' || t.id('mr_arquivo')::text || '%', 'false');
reset role;

select * from t.fim();
rollback;
