-- Fase 7 (migration 511): motor de ESPECIALIDADES ampliado, provado com uma especialidade FICTÍCIA de teste
-- (supabase/especialidades-manifesto/teste/especialidade-teste.json → _fixture_especialidade_teste.sql).
-- SÓ LOCAL: a fixture é gerada do manifesto de teste, roda dentro desta transação (ROLLBACK) e nunca vira migration.
--
-- Fluxo completo: iniciar → rascunho → enviar → avaliar → devolver → corrigir → reenviar → aprovar → progresso → conclusão → histórico.
-- Tipos: leitura, resposta, relatório, foto, arquivo (vários anexos), atividade, validação, meta, dependente, N de M, prazo.
-- Segurança: multiclube/RLS, ninguém avalia o próprio requisito, UUID/arquivo de outro clube recusado, tentativa antiga
-- imutável, conteúdo privado fechado à coordenação institucional.
begin;
\ir _lib.sql
\ir _fixtures.sql

\o /dev/null
\ir _fixture_especialidade_teste.sql
select t.como_cron();
insert into public.club_features (club_id, feature, enabled) values (t.id('clube_a'), 'especialidades', true), (t.id('clube_b'), 'especialidades', true)
on conflict (club_id, feature) do update set enabled = true;
reset role;

create function t.esp() returns uuid language sql stable security definer as $$ select id from public.specialties where codigo = 'TE-001' $$;
create function t.sr(p_ordem int) returns uuid language sql stable security definer as $$
  select r.id from public.specialty_requirements r where r.specialty_id = t.esp() and r.codigo = p_ordem::text $$;
create function t.msr(p_user text, p_ordem int) returns uuid language sql stable security definer as $$
  select m.id from public.member_specialty_requirements m where m.usuario_id = t.id(p_user) and m.specialty_requirement_id = t.sr(p_ordem) $$;
create function t.ms(p_user text) returns uuid language sql stable security definer as $$
  select m.id from public.member_specialties m where m.usuario_id = t.id(p_user) and m.specialty_id = t.esp() limit 1 $$;
create function t.sub(p_user text, p_ordem int, p_tent int) returns uuid language sql stable security definer as $$
  select s.id from public.specialty_requirement_submissions s where s.member_specialty_requirement_id = t.msr(p_user, p_ordem) and s.tentativa_numero = p_tent $$;
-- membro: salva o formulário e envia (roda como o papel ATUAL)
create function t.envia(p_ordem int, p_conteudo text, p_anexos text default '[]') returns void language plpgsql as $$
begin
  perform public.especialidade_requisito_relatorio_salvar(t.sr(p_ordem), p_conteudo::jsonb, p_anexos::jsonb);
  perform public.especialidade_requisito_enviar(t.sr(p_ordem));
end $$;
-- avaliador: decide a tentativa MAIS RECENTE
create function t.decide(p_user text, p_ordem int, p_decisao text, p_comentario text default null) returns void language plpgsql as $$
begin
  perform public.especialidade_requisito_avaliar(t.msr(p_user, p_ordem), p_decisao, p_comentario,
    (select s.id from public.specialty_requirement_submissions s where s.member_specialty_requirement_id = t.msr(p_user, p_ordem) order by s.tentativa_numero desc limit 1));
end $$;
create function t.anexo(p_campo text, p_path text) returns text language sql immutable as $$ select jsonb_build_object('campo', p_campo, 'path', p_path)::text $$;
grant insert, select on t.ids to public;

-- arquivos de teste no bucket privado (formato antigo <usuario>/…; e um do formato novo <clube>/<usuario>/…)
\o
insert into storage.objects (bucket_id, name, owner_id)
select 'comprovacoes', t.id('membro_a')::text || '/especialidades/f' || g || '.jpg', t.id('membro_a')::text from generate_series(1, 8) g;
insert into storage.objects (bucket_id, name, owner_id) values
  ('comprovacoes', t.id('clube_a')::text || '/' || t.id('membro_a')::text || '/especialidades/novo.jpg', t.id('membro_a')::text),
  ('comprovacoes', t.id('clube_b')::text || '/' || t.id('membro_a')::text || '/especialidades/outro-clube.jpg', t.id('membro_a')::text),
  ('comprovacoes', t.id('membro_b')::text || '/especialidades/alheio.jpg', t.id('membro_b')::text);

-- ==================== 0) a fixture veio do MANIFESTO e o catálogo tem o formato esperado ====================
select t.eq('a especialidade fictícia existe (1) com 14 requisitos e 1 grupo N de M',
  (select count(*) from public.specialties where codigo = 'TE-001')::text || '|' || (select count(*) from public.specialty_requirements where specialty_id = t.esp())::text || '|' || (select count(*) from public.specialty_requirement_groups where specialty_id = t.esp())::text,
  '1|14|1');
select t.eq('proveniência gravada (fonte, data da consulta, status, hash do manifesto)',
  (select (fonte_url is not null)::text || '|' || fonte_consultada_em::text || '|' || status_fonte || '|' || (length(manifesto_hash) = 64)::text from public.specialties where id = t.esp()), 'true|2026-09-30|conferido|true');
select t.eq('a versão importada guarda hash e é "oficial/publicado" só nesta transação', (select origem || '|' || status from public.curriculum_versions where identificador = 'especialidades-teste-local'), 'oficial|publicado');
select t.eq('os 7 tipos de evidência do manifesto foram gravados',
  (select count(distinct tipo_evidencia) from public.specialty_requirements where specialty_id = t.esp()), 7);
select t.eq('dependência, grupo e prazo gravados',
  (select (select depende_de::text from public.specialty_requirements where specialty_id = t.esp() and codigo = '9') || '|' ||
          (select count(*) from public.specialty_requirements where specialty_id = t.esp() and grupo = 'tecnicas') || '|' ||
          (select prazo_dias from public.specialty_requirements where specialty_id = t.esp() and codigo = '14')), '{2}|4|30');
\o /dev/null
\ir _fixture_especialidade_teste.sql
\o
select t.eq('reimportar o MESMO manifesto é idempotente (nada duplica)',
  (select count(*) from public.specialties where codigo = 'TE-001')::text || '|' || (select count(*) from public.specialty_requirements where specialty_id = t.esp())::text || '|' || (select count(*) from public.curriculum_versions where identificador = 'especialidades-teste-local')::text, '1|14|1');

-- ==================== 1) iniciar e ver os requisitos ====================
select t.como('membro_a'); select t.pedir_clube('clube_a');
select t.permitido('membro_a inicia a especialidade', format($q$select public.especialidade_iniciar(%L)$q$, t.esp()));
select t.eq('minha_especialidade: 14 requisitos, 0%, grupo "tecnicas" com mínimo 2',
  t.txt($q$select (json_array_length(x->'requisitos'))::text || '|' || (x->'member_specialty'->>'percentual') || '|' || (x->'grupos'->0->>'minimo') from (select public.minha_especialidade() x) s$q$), '14|0|2');
select t.eq('requisito 9 (dependente) já vem BLOQUEADO até o 2 ser aprovado',
  t.txt($q$select r->'bloqueios'->>0 from json_array_elements(public.minha_especialidade()->'requisitos') r where r->>'codigo' = '9'$q$), 'Conclua antes o requisito 2.');
select t.ok('requisito 14 informa a data limite do prazo',
  (t.txt($q$select r->>'prazo_em' from json_array_elements(public.minha_especialidade()->'requisitos') r where r->>'codigo' = '14'$q$)) is not null);
select t.eq('cada requisito traz o modelo do formulário', t.txt($q$select (r->'modelo'->'campos'->0->>'tipo') from json_array_elements(public.minha_especialidade()->'requisitos') r where r->>'codigo' = '2'$q$), 'texto_longo');

-- ==================== 2) resposta: rascunho → envio → devolução → correção → reenvio → aprovação ====================
select t.throws('enviar em branco é recusado e diz o que falta', format($q$select public.especialidade_requisito_enviar(%L)$q$, t.sr(2)), 'Formulário incompleto');
select t.throws('campo desconhecido no rascunho é recusado', format($q$select public.especialidade_requisito_relatorio_salvar(%L, '{"x":1}'::jsonb, '[]'::jsonb)$q$, t.sr(2)), 'campo desconhecido');
select t.permitido('rascunho salvo', format($q$select public.especialidade_requisito_relatorio_salvar(%L, '{"resposta":"rascunho"}'::jsonb, '[]'::jsonb)$q$, t.sr(2)));
select t.permitido('membro envia (tentativa 1)', format($q$select public.especialidade_requisito_enviar(%L)$q$, t.sr(2)));
select t.throws('não edita enquanto aguarda', format($q$select public.especialidade_requisito_relatorio_salvar(%L, '{"resposta":"mudei"}'::jsonb, '[]'::jsonb)$q$, t.sr(2)), 'Aguarde a avaliação');
select t.throws('não reenvia enquanto aguarda', format($q$select public.especialidade_requisito_enviar(%L)$q$, t.sr(2)), 'Aguarde a avaliação');
select t.throws('membro NÃO avalia (sem permissão)', format($q$select public.especialidade_requisito_avaliar(%L, 'aprovado', null)$q$, t.msr('membro_a', 2)), 'Sem permissão');
reset role;
select t.eq('tentativa 1 congelada com o conteúdo do rascunho',
  (select conteudo ->> 'resposta' || '|' || tipo_evidencia_entregue from public.specialty_requirement_submissions where id = t.sub('membro_a', 2, 1)), 'rascunho|relatorio');
select t.throws('tentativa imutável (update)', format($q$update public.specialty_requirement_submissions set conteudo = '{}'::jsonb where id = %L$q$, t.sub('membro_a', 2, 1)), 'imutável');
select t.throws('tentativa imutável (delete)', format($q$delete from public.specialty_requirement_submissions where id = %L$q$, t.sub('membro_a', 2, 1)), 'imutável');

select t.como('instrutor_a'); select t.pedir_clube('clube_a');
select t.eq('a fila mostra conteúdo, tentativa e modelo', t.txt($q$select (x->'conteudo'->>'resposta') || '|' || (x->>'tentativa_numero') || '|' || (x->'modelo'->'campos'->0->>'chave') from json_array_elements(public.especialidade_avaliacoes_pendentes()) x limit 1$q$), 'rascunho|1|resposta');
select t.throws('devolver sem comentário é recusado', format($q$select public.especialidade_requisito_avaliar(%L, 'correcao_solicitada', null)$q$, t.msr('membro_a', 2)), 'Explique');
select t.permitido('instrutor devolve com comentário', format($q$select t.decide('membro_a', 2, 'correcao_solicitada', 'Escreva com mais detalhes.')$q$));
select t.throws('a mesma tentativa não é decidida duas vezes', format($q$select public.especialidade_requisito_avaliar(%L, 'aprovado', null, %L)$q$, t.msr('membro_a', 2), t.sub('membro_a', 2, 1)), 'já foi avaliada');
select t.como('membro_a'); select t.pedir_clube('clube_a');
select t.permitido('membro corrige e reenvia (tentativa 2)', format($q$select t.envia(2, '{"resposta":"resposta corrigida e detalhada"}')$q$));
reset role;
select t.eq('2 tentativas; a 1ª segue com o texto original', (select count(*)::text || '|' || (select conteudo ->> 'resposta' from public.specialty_requirement_submissions where id = t.sub('membro_a', 2, 1))
   from public.specialty_requirement_submissions where member_specialty_requirement_id = t.msr('membro_a', 2)), '2|rascunho');
select t.como('lider_a'); select t.pedir_clube('clube_a');
select t.throws('avaliar a tentativa 1 (antiga) depois do reenvio é recusado', format($q$select public.especialidade_requisito_avaliar(%L, 'aprovado', null, %L)$q$, t.msr('membro_a', 2), t.sub('membro_a', 2, 1)), 'mais recente');
select t.permitido('diretoria aprova a tentativa 2', format($q$select t.decide('membro_a', 2, 'aprovado', 'Ótimo.')$q$));
select t.eq('HISTÓRICO: 2 tentativas, decisão, avaliador (papel) e conteúdo de cada uma',
  (select string_agg((x ->> 'tentativa_numero') || ':' || (x ->> 'decisao') || ':' || (x ->> 'avaliado_papel') || ':' || (x -> 'conteudo' ->> 'resposta'), ' | ' order by (x ->> 'tentativa_numero')::int)
     from json_array_elements(public.especialidade_historico(t.msr('membro_a', 2)) -> 'tentativas') x),
  '1:correcao_solicitada:instrutor:rascunho | 2:aprovado:diretoria:resposta corrigida e detalhada');
select t.eq('histórico: comentário de cada avaliação preservado', (select string_agg(x ->> 'comentario', ' | ' order by (x ->> 'tentativa_numero')::int) from json_array_elements(public.especialidade_historico(t.msr('membro_a', 2)) -> 'tentativas') x), 'Escreva com mais detalhes. | Ótimo.');
reset role;
select t.eq('avaliador registrado pelo SERVIDOR (não escolhido pelo cliente)', (select count(*) from public.requirement_approvals where member_specialty_requirement_id = t.msr('membro_a', 2) and avaliado_por in (t.id('instrutor_a'), t.id('lider_a')) and specialty_submission_id is not null), 2);

-- ==================== 3) dependência ====================
select t.como('membro_a'); select t.pedir_clube('clube_a');
select t.permitido('requisito 9 libera depois que o 2 foi aprovado', format($q$select t.envia(9, '{"resposta":"aprendi"}')$q$));
reset role;
select t.como('instrutor_a'); select t.pedir_clube('clube_a');
select t.permitido('aprova o 9', format($q$select t.decide('membro_a', 9, 'aprovado')$q$));
reset role;

-- ==================== 4) leitura, relatório (vários anexos), foto, arquivos, atividade, validação, meta ====================
select t.como('membro_a'); select t.pedir_clube('clube_a');
select t.throws('leitura sem marcar "Li" não envia', format($q$select t.envia(1, '{"li":false}')$q$), 'Confirme');
select t.permitido('leitura: envia', format($q$select t.envia(1, '{"li":true}')$q$));
select t.throws('relatório sem data não envia', format($q$select t.envia(3, '{"local":"Praça","descricao":"Fui"}')$q$), 'Preencha: Data');
select t.throws('relatório com data no futuro é recusado', format($q$select t.envia(3, '{"data":"2999-01-01","local":"Praça","descricao":"Fui"}')$q$), 'futuro');
select t.permitido('relatório com 3 fotos (múltiplos anexos)', format($q$select t.envia(3, '{"data":"2026-01-10","local":"Praça","descricao":"Fui"}', %L)$q$,
  jsonb_build_array(jsonb_build_object('campo', 'fotos', 'path', t.id('membro_a')::text || '/especialidades/f1.jpg'), jsonb_build_object('campo', 'fotos', 'path', t.id('membro_a')::text || '/especialidades/f2.jpg'),
                    jsonb_build_object('campo', 'fotos', 'path', t.id('clube_a')::text || '/' || t.id('membro_a')::text || '/especialidades/novo.jpg'))::text));
select t.throws('foto obrigatória: sem anexo não envia', format($q$select t.envia(4, '{}')$q$), 'pelo menos 1 anexo');
select t.throws('foto: 2 anexos passam do máximo (1)', format($q$select t.envia(4, '{}', %L)$q$,
  jsonb_build_array(jsonb_build_object('campo', 'foto', 'path', t.id('membro_a')::text || '/especialidades/f3.jpg'), jsonb_build_object('campo', 'foto', 'path', t.id('membro_a')::text || '/especialidades/f4.jpg'))::text), 'no máximo 1');
select t.permitido('foto: 1 anexo envia', format($q$select t.envia(4, '{}', %L)$q$, jsonb_build_array(jsonb_build_object('campo', 'foto', 'path', t.id('membro_a')::text || '/especialidades/f3.jpg'))::text));
select t.throws('arquivos: 1 só (mínimo 2) não envia', format($q$select t.envia(5, '{}', %L)$q$, jsonb_build_array(jsonb_build_object('campo', 'arquivos', 'path', t.id('membro_a')::text || '/especialidades/f4.jpg'))::text), 'pelo menos 2 anexo');
select t.throws('arquivos: 5 passam do máximo (4)', format($q$select t.envia(5, '{}', %L)$q$,
  (select jsonb_agg(jsonb_build_object('campo', 'arquivos', 'path', t.id('membro_a')::text || '/especialidades/f' || g || '.jpg'))::text from generate_series(4, 8) g)), 'no máximo 4');
select t.permitido('arquivos: 3 anexos envia', format($q$select t.envia(5, '{}', %L)$q$,
  (select jsonb_agg(jsonb_build_object('campo', 'arquivos', 'path', t.id('membro_a')::text || '/especialidades/f' || g || '.jpg'))::text from generate_series(4, 6) g)));
select t.permitido('atividade prática: envia', format($q$select t.envia(6, '{"fiz":true}')$q$));
select t.permitido('validação do instrutor: envia', format($q$select t.envia(7, '{"demonstrei":true}')$q$));
select t.throws('meta: 3 dias < 4 não envia', format($q$select t.envia(8, '{"dias":3,"fiz":true}')$q$), 'mínimo 4');
select t.permitido('meta: 4 dias envia', format($q$select t.envia(8, '{"dias":4,"fiz":true}')$q$));
reset role;
select t.eq('a tentativa do relatório guardou os 3 anexos', (select jsonb_array_length(anexos) from public.specialty_requirement_submissions where id = t.sub('membro_a', 3, 1)), 3);

select t.como('instrutor_a'); select t.pedir_clube('clube_a');
select t.eq('a fila da liderança tem os 7 requisitos enviados', t.nv('select json_array_length(public.especialidade_avaliacoes_pendentes())'), 7);
select t.permitido('aprova 1', $q$select t.decide('membro_a', 1, 'aprovado')$q$);
select t.permitido('aprova 3', $q$select t.decide('membro_a', 3, 'aprovado')$q$);
select t.permitido('aprova 4', $q$select t.decide('membro_a', 4, 'aprovado')$q$);
select t.permitido('aprova 5', $q$select t.decide('membro_a', 5, 'aprovado')$q$);
select t.permitido('aprova 6', $q$select t.decide('membro_a', 6, 'aprovado')$q$);
select t.permitido('aprova 7', $q$select t.decide('membro_a', 7, 'aprovado')$q$);
select t.permitido('aprova 8', $q$select t.decide('membro_a', 8, 'aprovado')$q$);
reset role;

-- ==================== 5) progresso com N de M e conclusão ====================
select t.eq('progresso: 9 avulsos aprovados de 12 unidades (10 avulsos + grupo de 2) = 75%',
  (select public.especialidade_percentual(t.ms('membro_a'))), 75);
select t.como('membro_a'); select t.pedir_clube('clube_a');
select t.permitido('técnica A', format($q$select t.envia(10, '{"fiz":true}')$q$));
select t.permitido('técnica B', format($q$select t.envia(11, '{"fiz":true}')$q$));
select t.permitido('técnica C (além do mínimo)', format($q$select t.envia(12, '{"fiz":true}')$q$));
reset role;
select t.como('lider_a'); select t.pedir_clube('clube_a');
select t.permitido('aprova técnica A', $q$select t.decide('membro_a', 10, 'aprovado')$q$);
reset role;
select t.eq('1 técnica de 2 aprovada: 10 de 12 = 83%', (select public.especialidade_percentual(t.ms('membro_a'))), 83);
select t.como('lider_a'); select t.pedir_clube('clube_a');
select t.permitido('aprova técnica B', $q$select t.decide('membro_a', 11, 'aprovado')$q$);
reset role;
select t.eq('2 técnicas aprovadas: grupo completo, 11 de 12 = 92%', (select public.especialidade_percentual(t.ms('membro_a'))), 92);
select t.como('lider_a'); select t.pedir_clube('clube_a');
select t.permitido('aprova técnica C (extra)', $q$select t.decide('membro_a', 12, 'aprovado')$q$);
reset role;
select t.eq('técnica extra NÃO passa de 92% (grupo conta só o mínimo)', (select public.especialidade_percentual(t.ms('membro_a'))), 92);
select t.eq('ainda em andamento (falta o requisito 14)', (select status from public.member_specialties where id = t.ms('membro_a')), 'em_andamento');
select t.como('membro_a'); select t.pedir_clube('clube_a');
select t.permitido('requisito 14 dentro do prazo', format($q$select t.envia(14, '{"resposta":"final"}')$q$));
reset role;
select t.como('instrutor_a'); select t.pedir_clube('clube_a');
select t.permitido('aprova o último', $q$select t.decide('membro_a', 14, 'aprovado')$q$);
reset role;
select t.eq('CONCLUÍDA automaticamente: 100%, status e data', (select status || '|' || (concluida_em is not null)::text || '|' || public.especialidade_percentual(id)::text from public.member_specialties where id = t.ms('membro_a')), 'concluida|true|100');
select t.como('membro_a'); select t.pedir_clube('clube_a');
select t.eq('membro vê a especialidade concluída com o histórico', t.txt($q$select (x->'member_specialty'->>'status') || '|' || (x->'requisitos'->1->>'tentativas') from (select public.minha_especialidade() x) s$q$), 'concluida|2');
reset role;

-- ==================== 6) prazo (não penaliza correção) ====================
select t.como('membro_a2'); select t.pedir_clube('clube_a');
select t.permitido('membro_a2 inicia', format($q$select public.especialidade_iniciar(%L)$q$, t.esp()));
select t.permitido('membro_a2 envia o 14 dentro do prazo', format($q$select t.envia(14, '{"resposta":"primeira"}')$q$));
reset role;
select t.como('instrutor_a'); select t.pedir_clube('clube_a');
select t.permitido('instrutor devolve o 14', $q$select t.decide('membro_a2', 14, 'correcao_solicitada', 'refaça')$q$);
reset role;
update public.member_specialties set iniciada_em = now() - interval '40 days' where id = t.ms('membro_a2');
select t.como('membro_a2'); select t.pedir_clube('clube_a');
select t.permitido('depois do prazo, REENVIAR o que foi devolvido é permitido', format($q$select t.envia(14, '{"resposta":"corrigida atrasada"}')$q$));
select t.permitido('requisito sem prazo segue normal fora do prazo', format($q$select t.envia(1, '{"li":true}')$q$));
reset role;
-- outro membro que nunca enviou o 14
insert into public.member_specialties (usuario_id, club_id, specialty_id, iniciada_em) values (t.id('pais_a'), t.id('clube_a'), t.esp(), now() - interval '40 days');
insert into public.member_specialty_requirements (member_specialty_id, specialty_requirement_id) select t.ms('pais_a'), id from public.specialty_requirements where specialty_id = t.esp();
select t.eq('prazo vencido, sem entrega anterior: BLOQUEADO', cardinality(public._especialidade_bloqueios(t.msr('pais_a', 14)))::bigint, 1);
select t.eq('...com a mensagem certa', array_to_string(public._especialidade_bloqueios(t.msr('pais_a', 14)), '|'), 'O prazo deste requisito terminou. Fale com o instrutor.');

-- ==================== 7) SEGURANÇA ====================
-- 7.1 ninguém avalia o próprio requisito
select t.como('lider_a'); select t.pedir_clube('clube_a');
select t.permitido('diretoria inicia a própria especialidade', format($q$select public.especialidade_iniciar(%L)$q$, t.esp()));
select t.permitido('...e envia o requisito 1', format($q$select t.envia(1, '{"li":true}')$q$));
select t.throws('diretoria NÃO aprova o próprio requisito', format($q$select public.especialidade_requisito_avaliar(%L, 'aprovado', null)$q$, t.msr('lider_a', 1)), 'próprio requisito');
select t.throws('nem devolve o próprio', format($q$select public.especialidade_requisito_avaliar(%L, 'correcao_solicitada', 'x')$q$, t.msr('lider_a', 1)), 'próprio requisito');
select t.como('instrutor_a'); select t.pedir_clube('clube_a');
select t.permitido('outra pessoa da liderança avalia normalmente', $q$select t.decide('lider_a', 1, 'aprovado')$q$);
reset role;

-- 7.2 outro clube: UUID, histórico, fila, arquivo
select t.como('lider_b'); select t.pedir_clube('clube_b');
select t.throws('liderança de OUTRO clube não avalia (UUID de outro clube)', format($q$select public.especialidade_requisito_avaliar(%L, 'aprovado', null)$q$, t.msr('membro_a2', 14)), 'não encontrado');
select t.throws('...não lê o histórico', format($q$select public.especialidade_historico(%L)$q$, t.msr('membro_a', 2)), 'não encontrado');
select t.eq('...a fila do clube B não traz nada do A', t.nv('select json_array_length(public.especialidade_avaliacoes_pendentes())'), 0);
select t.eq('...RLS: 0 tentativas visíveis', t.nv('select count(*) from public.specialty_requirement_submissions'), 0);
select t.eq('...e 0 aprovações de especialidade do outro clube', t.nv('select count(*) from public.requirement_approvals where member_specialty_requirement_id is not null'), 0);
select t.como('membro_b'); select t.pedir_clube('clube_b');
select t.throws('membro do clube B não envia requisito de quem não iniciou (UUID de requisito)', format($q$select public.especialidade_requisito_enviar(%L)$q$, t.sr(2)), 'não encontrado');
select t.throws('...nem salva rascunho', format($q$select public.especialidade_requisito_relatorio_salvar(%L, '{"resposta":"x"}'::jsonb, '[]'::jsonb)$q$, t.sr(2)), 'não encontrado');
select t.como('membro_a'); select t.pedir_clube('clube_a');
select t.throws('membro_a, no clube A, não abre histórico de OUTRA pessoa', format($q$select public.especialidade_historico(%L)$q$, t.msr('membro_a2', 14)), 'não encontrado');

-- 7.3 arquivos: de outro usuário, de outro clube, inexistente
reset role;
select t.como('membro_a2'); select t.pedir_clube('clube_a');
select t.throws('arquivo de OUTRO usuário é recusado (membro_a2 tentando usar o arquivo do colega)', format($q$select public.especialidade_requisito_relatorio_salvar(%L, '{"data":"2026-01-10","local":"x","descricao":"y"}'::jsonb, %L::jsonb)$q$, t.sr(3),
  jsonb_build_array(jsonb_build_object('campo', 'fotos', 'path', t.id('membro_a')::text || '/especialidades/f1.jpg'))::text), 'não é seu');
select t.throws('arquivo que NÃO existe no bucket é recusado', format($q$select public.especialidade_requisito_relatorio_salvar(%L, '{"data":"2026-01-10","local":"x","descricao":"y"}'::jsonb, %L::jsonb)$q$, t.sr(3),
  jsonb_build_array(jsonb_build_object('campo', 'fotos', 'path', t.id('membro_a2')::text || '/especialidades/fantasma.jpg'))::text), 'não encontrado');
reset role;

-- 7.4 visibilidade dos anexos
select t.como('lider_a'); select t.pedir_clube('clube_a');
select t.ok('liderança do clube A abre os anexos do relatório (formato antigo)', public.lideranca_ve_comprovacao(t.id('membro_a')::text || '/especialidades/f1.jpg'));
select t.ok('...e do formato novo', public.lideranca_ve_comprovacao(t.id('clube_a')::text || '/' || t.id('membro_a')::text || '/especialidades/novo.jpg'));
select t.ok('...mas não um arquivo que nenhuma tentativa referencia', not public.lideranca_ve_comprovacao(t.id('membro_a')::text || '/especialidades/f8.jpg'));
select t.como('lider_b'); select t.pedir_clube('clube_b');
select t.ok('liderança de OUTRO clube NÃO abre os anexos', not public.lideranca_ve_comprovacao(t.id('membro_a')::text || '/especialidades/f1.jpg'));
reset role;

-- 7.5 conteúdo privado fechado à coordenação institucional
\o /dev/null
select t.signup('c119_dist', '{"tipo":"fundador","nome":"Coord Distrital 119"}'::jsonb);
insert into public.organizational_units (id, type, nome, slug, parent_id, metadata) values
  (public.curriculo_uuid('t119:campo'), 'campo', 'Associação 119', null, null, '{"test_only":true}');
insert into public.organizational_units (id, type, nome, slug, parent_id, metadata) values
  (public.curriculo_uuid('t119:r'), 'regiao', 'Região 119', null, public.curriculo_uuid('t119:campo'), '{"test_only":true}');
insert into public.organizational_units (id, type, nome, slug, parent_id, metadata) values
  (public.curriculo_uuid('t119:d'), 'distrito', 'Distrito 119', null, public.curriculo_uuid('t119:r'), '{"test_only":true}');
insert into t.ids (chave, id) values ('d119', public.curriculo_uuid('t119:d'));
update public.organizational_units set parent_id = t.id('d119') where id = t.id('clube_a');
insert into public.organization_memberships (user_id, organizational_unit_id, role, status) values (t.id('c119_dist'), t.id('d119'), 'coordenador_distrital', 'ativo');
create function t.no_escopo119() returns void language plpgsql as $$
begin
  perform t.como('c119_dist');
  perform set_config('request.headers', json_build_object('x-escopo-atual', t.id('d119'))::text, true);
end $$;
grant insert, select on t.ids to public;
\o
select t.no_escopo119();
select t.throws('coordenador do distrito NÃO lê o histórico de especialidade de um clube abaixo', format($q$select public.especialidade_historico(%L)$q$, t.msr('membro_a', 2)), 'Sem clube em uso');
select t.throws('...nem avalia', format($q$select public.especialidade_requisito_avaliar(%L, 'aprovado', null)$q$, t.msr('membro_a2', 14)), 'Sem clube em uso');
select t.eq('...nem enxerga tentativas pelas tabelas (RLS)', t.nv('select count(*) from public.specialty_requirement_submissions'), 0);
select t.eq('...nem as aprovações de especialidade', t.nv('select count(*) from public.requirement_approvals where member_specialty_requirement_id is not null'), 0);
select t.eq('...nem o progresso dos membros', t.nv('select count(*) from public.member_specialty_requirements'), 0);
select t.ok('...nem abre os anexos', not public.lideranca_ve_comprovacao(t.id('membro_a')::text || '/especialidades/f1.jpg'));
reset role;

-- 7.6 o catálogo novo não é gravável pela API e as RPCs novas não são de anon
select t.eq('authenticated NÃO grava em grupos nem lê direto',
  (select count(*) from information_schema.table_privileges where table_schema = 'public' and grantee in ('authenticated', 'anon') and table_name = 'specialty_requirement_groups'), 0);
select t.eq('authenticated não altera tentativas (só select via RLS)',
  (select count(*) from information_schema.table_privileges where table_schema = 'public' and grantee = 'authenticated' and table_name = 'specialty_requirement_submissions' and privilege_type <> 'SELECT'), 0);
select t.eq('as RPCs novas não são executáveis por anon',
  (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('especialidade_requisito_relatorio_salvar', 'especialidade_historico', 'especialidade_requisito_avaliar', 'especialidade_requisito_enviar', 'requisito_relatorio_salvar', 'requisito_formulario')
     and has_function_privilege('anon', p.oid, 'execute')), 0);

select * from t.fim();
rollback;
