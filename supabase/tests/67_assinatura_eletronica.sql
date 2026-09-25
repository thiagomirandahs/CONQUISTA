-- Fase 4 (Bloco 2, migration 89): assinatura eletrônica interna do DesbravaClube. Fluxo pedagógico
-- completo (requisitos aprovados → revisão final → investidura → snapshot → documento FINAL → PDF)
-- até assinar de verdade — quem assina vem de workflow_stage_decisions (nunca hardcoded).
begin;
\ir _lib.sql
\ir _curriculo_regular_2026.sql
\ir _fixtures.sql

insert into public.club_features (club_id, feature, enabled) values (t.id('clube_a'), 'classes', true), (t.id('clube_b'), 'classes', true)
on conflict (club_id, feature) do update set enabled = true;
create function t.classe(p text) returns uuid language sql stable security definer as $$
  select c.id from public.classes c join public.curriculum_versions v on v.id = c.curriculum_version_id where v.origem = 'oficial' and v.status = 'publicado' and c.manifesto_id = p $$;
create function t.req(p text) returns uuid language sql stable security definer as $$
  select r.id from public.class_requirements r join public.class_sections s on s.id = r.section_id join public.classes c on c.id = s.class_id
  join public.curriculum_versions v on v.id = c.curriculum_version_id where r.manifesto_id = p and v.origem = 'oficial' and v.status = 'publicado' $$;
create table t.ids_txt (chave text primary key, id text not null); grant all on t.ids_txt to public;
create function t.tok() returns text language sql stable as $$ select id from t.ids_txt where chave = 'token_final' $$;

insert into public.dynamic_content_values (definicao_id, ano, valor, vigente_desde, vigente_ate, fonte_url, fonte_descricao)
select d.id, a.y, 'Livro do Curso de Leitura do ano [DADO DE TESTE]', make_date(a.y, 1, 1), make_date(a.y, 12, 31), 'https://exemplo.test/fixture', 'FIXTURE DE TESTE — não é o livro oficial'
from public.dynamic_content_definitions d, (select extract(year from public._data_no_brasil())::int as y) a where d.chave = 'curso_leitura_amigo';

select t.como('multi_dois_papeis'); select t.pedir_clube('clube_a');
select t.permitido('inicia Amigo no A', format($q$select public.classe_iniciar(%L)$q$, t.classe('amigo')));
reset role;
insert into t.ids (chave, id) select 'mc', id from public.member_classes where usuario_id = t.id('multi_dois_papeis') and club_id = t.id('clube_a') and class_id = t.classe('amigo');
select t.como('multi_dois_papeis'); select t.pedir_clube('clube_a');
select t.permitido('registra escolhas', format($q$select public.requisito_escolher(r, array[(select o.id from public.requirement_options o join public.requirement_option_groups g on g.id = o.grupo_id where g.alvo_id = r order by o.ordem limit 1)], '{}') from unnest(array[%L::uuid, %L::uuid]) r$q$, t.req('amigo.V.1'), t.req('amigo.VII.1')), 2);
select t.permitido('...IX.1 texto livre', format($q$select public.requisito_escolher(%L, '{}', array['Cestaria [DADO DE TESTE]'])$q$, t.req('amigo.IX.1')));
select t.permitido('guarda resposta PRIVADA em I.1', format($q$select public.requisito_salvar(%L, 'Resposta privada do menor [TESTE]', null)$q$, t.req('amigo.I.1')));
select t.como('lider_a'); select t.pedir_clube('clube_a');
select t.permitido('lider_a aprova os 25', format($q$select public.requisito_avaliar(mr.id, 'aprovado', 'comentário interno [TESTE]') from public.member_requirements mr where mr.member_class_id = %L$q$, t.id('mc')), 25);
select t.permitido('aprova revisão final', format($q$select public.revisao_final_decidir(%L, 'aprovado', 'ok')$q$, t.id('mc')));
select t.permitido('registra investidura', format($q$select public.investidura_registrar(%L, current_date, 'Cerimônia [TESTE]')$q$, t.id('mc')));
select t.permitido('emite o documento FINAL', format($q$select public.documento_emitir(%L, 'final')$q$, t.id('mc')));
reset role;
insert into t.ids_txt (chave, id) select 'token_final', token_publico from public.class_documents where member_class_id = t.id('mc') and tipo = 'final';
insert into t.ids (chave, id) select 'doc', id from public.class_documents where member_class_id = t.id('mc') and tipo = 'final';

-- ==================== sem PDF ainda: assinatura é recusada ====================
select t.como('lider_a'); select t.pedir_clube('clube_a');
select t.throws('sem PDF gerado, assinar é recusado', format($q$select public.documento_assinar(%L, 'Declaro que revisei este documento [TESTE].')$q$, t.tok()), 'Gere o PDF');
reset role;

-- registra o PDF (simulando o que a Edge Function faria)
select t.como('lider_a'); select t.pedir_clube('clube_a');
select t.permitido('registra o PDF', format($q$select public.documento_pdf_registrar(%L, %L, %L)$q$, t.tok(), repeat('a', 64), t.id('clube_a')::text || '/' || t.id('multi_dois_papeis')::text || '/' || t.id('doc')::text || '/1.pdf'));
reset role;

-- ==================== revisão DOCUMENTAL — diferente de avaliação curricular, obrigatória antes de assinar ====================
select t.como('lider_a'); select t.pedir_clube('clube_a');
select t.throws('sem revisão ainda, assinar é recusado', format($q$select public.documento_assinar(%L, 'Declaro que revisei este documento [TESTE].')$q$, t.tok()), 'revisão documental');
select t.throws('correção sem motivo é recusada', format($q$select public.documento_revisar(%L, 'correcao_solicitada')$q$, t.tok()), 'motivo obrigatório');
select t.permitido('solicita correção documental (dado ausente [TESTE])', format($q$select public.documento_revisar(%L, 'correcao_solicitada', 'Falta o nome da unidade [TESTE]', 'Adicione a unidade antes de gerar de novo [TESTE]')$q$, t.tok()));
select t.throws('com correção solicitada, assinar continua recusado', format($q$select public.documento_assinar(%L, 'Declaro que revisei este documento [TESTE].')$q$, t.tok()), 'revisão documental');
select t.eq('documentos_do_clube mostra estado correcao_solicitada com motivo/orientação',
  (select (x.j->>'estado') || '|' || (x.j->'revisao'->>'motivo') || '|' || (x.j->'revisao'->>'orientacao')
   from json_array_elements((select public.documentos_do_clube())) x(j) where x.j->>'documento_id' = t.id('doc')::text),
  'correcao_solicitada|Falta o nome da unidade [TESTE]|Adicione a unidade antes de gerar de novo [TESTE]');
select t.permitido('regenera o PDF depois da correção (nova versão, pdf_versao=2)', format($q$select public.documento_pdf_registrar(%L, %L, %L)$q$, t.tok(), repeat('e', 64), t.id('clube_a')::text || '/' || t.id('multi_dois_papeis')::text || '/' || t.id('doc')::text || '/2.pdf'));
select t.throws('PDF regenerado NÃO herda a revisão da versão anterior — precisa revisar de novo', format($q$select public.documento_assinar(%L, 'Declaro que revisei este documento [TESTE].')$q$, t.tok()), 'revisão documental');
select t.permitido('agora aprova a revisão da versão 2', format($q$select public.documento_revisar(%L, 'aprovado')$q$, t.tok()));
reset role;

-- outro clube não revisa documento alheio
select t.como('lider_b'); select t.pedir_clube('clube_b');
select t.throws('liderança de OUTRO clube não revisa documento do clube A', format($q$select public.documento_revisar(%L, 'aprovado')$q$, t.tok()), 'Sem permissão');
reset role;

-- ==================== quem NÃO decidiu não assina ====================
select t.como('conselheiro_a'); select t.pedir_clube('clube_a');
select t.throws('quem não decidiu nenhuma etapa do workflow não assina', format($q$select public.documento_assinar(%L, 'Declaro que revisei este documento [TESTE].')$q$, t.tok()), 'Sem autoridade');
reset role;

select t.como_anon();
select t.throws('anônimo nem chama (revoke de anon)', format($q$select public.documento_assinar(%L, 'Declaro que revisei este documento [TESTE].')$q$, t.tok()), 'permission denied');
reset role;

-- ==================== consentimento curto é recusado ====================
select t.como('lider_a'); select t.pedir_clube('clube_a');
select t.throws('consentimento curto/vazio é recusado', format($q$select public.documento_assinar(%L, 'ok')$q$, t.tok()), 'declaração');

-- ==================== documento_assinaturas ANTES de assinar ====================
select t.eq('documento_assinaturas: lider_a PODE assinar, ainda não assinou, 0 de 1 exigida',
  (select (a->>'posso_assinar') || '|' || (a->>'ja_assinei') || '|' || jsonb_array_length(a->'registradas') || '|' || (a->>'exigidas')
   from (select public.documento_assinaturas(t.tok()) a) x), 'true|false|0|1');

-- ==================== assina de verdade ====================
select t.permitido('lider_a assina (decidiu as duas etapas — revisão e investidura — do workflow real)',
  format($q$select public.documento_assinar(%L, 'Declaro que revisei este documento e confirmo sua assinatura eletrônica [TESTE].')$q$, t.tok()));
select t.throws('assinar de novo (mesma pessoa) é recusado — sem assinatura duplicada',
  format($q$select public.documento_assinar(%L, 'Declaro que revisei este documento de novo [TESTE].')$q$, t.tok()), 'já assinou');
reset role;

select t.eq('depois de assinar: documento_assinaturas mostra 1 de 1 exigida, ja_assinei=true',
  (select (a->>'ja_assinei') || '|' || jsonb_array_length(a->'registradas') || '|' || (a->>'exigidas')
   from (select public.documento_assinaturas(t.tok()) a) x), 'true|1|1');

-- ==================== hash vinculado ao PDF exato ====================
select t.eq('a assinatura guardou o MESMO pdf_hash do documento (não o hash do snapshot)',
  -- 'e' porque o PDF foi regenerado pra versão 2 durante o teste de revisão documental acima
  (select (s.pdf_hash = repeat('e', 64)) and (s.pdf_hash <> snap.hash)
   from public.document_signatures s
   join public.class_documents d on d.id = s.documento_id
   join public.class_completion_snapshots snap on snap.id = d.snapshot_id
   where s.documento_id = t.id('doc') and s.status = 'registrada')::text,
  'true');

-- ==================== imutabilidade: PDF não pode ser sobrescrito depois de assinado ====================
select t.como('lider_a'); select t.pedir_clube('clube_a');
select t.throws('PDF não pode ser regenerado depois de assinado', format($q$select public.documento_pdf_registrar(%L, %L, %L)$q$, t.tok(), repeat('b', 64), t.id('clube_a')::text || '/x/y/2.pdf'), 'já tem assinatura');
reset role;

-- ==================== outro clube não assina, não revoga, não lê ====================
-- (lider_b não serve de "estranho": multi_dois_papeis TEM vínculo ativo em clube_b também, e
-- _pode_ver_conquista_curricular libera por desenho a liderança de qualquer clube onde a pessoa tem
-- vínculo ativo hoje — mesma ressalva já documentada no teste 66. membro_b não é liderança em
-- lugar nenhum: serve de estranho de verdade.)
select t.como('lider_b'); select t.pedir_clube('clube_b');
select t.throws('liderança de OUTRO clube não assina (não decidiu etapa nenhuma deste workflow, mesmo enxergando o documento)', format($q$select public.documento_assinar(%L, 'Declaro que revisei este documento [TESTE].')$q$, t.tok()), 'Sem autoridade');
reset role;
select t.como('membro_b'); select t.pedir_clube('clube_b');
select t.ok('quem não é liderança em lugar nenhum não vê nada em documento_assinaturas (null)', public.documento_assinaturas(t.tok()) is null);
reset role;

-- ==================== revogar UMA assinatura (não o documento inteiro) ====================
select t.como('multi_dois_papeis'); select t.pedir_clube('clube_a');
select t.throws('o TITULAR (que não assinou) não revoga assinatura alheia', (select format($q$select public.documento_assinatura_revogar(%L, 'engano [TESTE]')$q$, id) from public.document_signatures where documento_id = t.id('doc') and status = 'registrada'), 'Sem permissão');
reset role;
select t.como('lider_a'); select t.pedir_clube('clube_a');
select t.permitido('o próprio signatário revoga a própria assinatura', (select format($q$select public.documento_assinatura_revogar(%L, 'assinei sem querer [TESTE]')$q$, id) from public.document_signatures where documento_id = t.id('doc') and status = 'registrada'));
reset role;
select t.eq('depois de revogada: documento_assinaturas volta a mostrar 0 de 1, posso_assinar=true de novo',
  (select (a->>'posso_assinar') || '|' || jsonb_array_length(a->'registradas') from (select public.documento_assinaturas(t.tok()) a) x), 'true|0');

-- assinar de novo depois de revogada É permitido (índice único é parcial, só bloqueia 'registrada')
select t.como('lider_a'); select t.pedir_clube('clube_a');
select t.permitido('assina de novo depois de revogar a anterior', format($q$select public.documento_assinar(%L, 'Declaro que revisei este documento de novo [TESTE].')$q$, t.tok()));
reset role;

-- ==================== assinatura em LOTE ====================
-- prepara um segundo documento (acompanhamento) na mesma matrícula pra testar o lote com 2 itens,
-- um deles já sem autoridade nenhuma pra provar que o lote NUNCA finge sucesso total.
select t.como('lider_a'); select t.pedir_clube('clube_a');
select t.permitido('emite também o Caderno de acompanhamento (mesmo snapshot)', format($q$select public.documento_emitir(%L, 'acompanhamento')$q$, t.id('mc')));
reset role;
insert into t.ids_txt (chave, id) select 'token_acomp', token_publico from public.class_documents where member_class_id = t.id('mc') and tipo = 'acompanhamento';
insert into t.ids (chave, id) select 'doc_acomp', id from public.class_documents where member_class_id = t.id('mc') and tipo = 'acompanhamento';
select t.como('lider_a'); select t.pedir_clube('clube_a');
select t.permitido('registra o PDF do acompanhamento', format($q$select public.documento_pdf_registrar(%L, %L, %L)$q$, (select id from t.ids_txt where chave = 'token_acomp'), repeat('c', 64), t.id('clube_a')::text || '/x/' || t.id('doc_acomp')::text || '/1.pdf'));
select t.permitido('aprova a revisão documental do acompanhamento', format($q$select public.documento_revisar(%L, 'aprovado')$q$, (select id from t.ids_txt where chave = 'token_acomp')));
reset role;

select t.como('lider_a'); select t.pedir_clube('clube_a');
select t.eq('lote com 1 token inválido: 1 assinado, 1 recusado — NUNCA finge sucesso total',
  (select (r->>'assinados') || '|' || (r->>'recusados')
   from (select public.documento_assinar_lote(array[(select id from t.ids_txt where chave = 'token_acomp'), 'token-que-nao-existe-nunca'], 'Declaro lote [TESTE].') r) x),
  '1|1');
reset role;

-- ==================== documento revogado não aceita assinatura nova ====================
select t.como('lider_a'); select t.pedir_clube('clube_a');
select t.permitido('revoga o snapshot (motivo auditado)', format($q$select public.snapshot_revogar(%L, 'engano de teste [TESTE]')$q$, (select snapshot_id from public.class_documents where id = t.id('doc_acomp'))));
select t.throws('documento revogado recusa assinatura nova', format($q$select public.documento_assinar(%L, 'Declaro que revisei este documento [TESTE].')$q$, (select id from t.ids_txt where chave = 'token_acomp')), 'não é possível assinar');
reset role;
select t.como_anon();
select t.eq('/verificar continua funcionando e mostra REVOGADO (nunca 404/apaga)', (public.documento_verificar((select id from t.ids_txt where chave = 'token_acomp')) ->> 'estado'), 'revogado');
reset role;

-- ==================== observabilidade: assinar/revogar deixam rastro em auditoria_operacoes ====================
-- (achado da auditoria de fechamento: essas ações não apareciam na trilha genérica que o painel do
-- admin da plataforma lê — só na trilha específica de classe. Migration 90 corrigiu.)
select t.eq('documento_assinado registrado em auditoria_operacoes', (select count(*) from public.auditoria_operacoes where operacao = 'documento_assinado'), 3); -- 'doc' (1ª vez) + 'doc' de novo depois de revogar + 'doc_acomp' pelo lote
select t.eq('documento_assinatura_revogada registrada em auditoria_operacoes', (select count(*) from public.auditoria_operacoes where operacao = 'documento_assinatura_revogada'), 1);
select t.eq('documento_snapshot_revogado registrado em auditoria_operacoes', (select count(*) from public.auditoria_operacoes where operacao = 'documento_snapshot_revogado'), 1);
select t.eq('o detalhe da revogação do snapshot guarda o motivo, não dado sensível', (select detalhe ->> 'motivo' from public.auditoria_operacoes where operacao = 'documento_snapshot_revogado'), 'engano de teste [TESTE]');

select t.fim();
rollback;
