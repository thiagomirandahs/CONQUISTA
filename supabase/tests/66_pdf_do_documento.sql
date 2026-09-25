-- Fase 4 (Bloco 1, migration 88): PDF autoritativo do documento de classe.
-- documento_pdf_dados reaproveita documento_conteudo (mesma sanitização, não duplicada aqui — só
-- testamos os campos NOVOS: ids técnicos pro caminho do Storage). documento_pdf_registrar: hash
-- válido, caminho tem que começar pela pasta do CLUBE DO DOCUMENTO, dono/liderança apenas, nunca
-- sobrescreve depois de assinado, incrementa pdf_versao a cada chamada.
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
create function t.tok() returns text language sql stable as $$ select id from t.ids_txt where chave = 'token_acomp' $$;

insert into public.dynamic_content_values (definicao_id, ano, valor, vigente_desde, vigente_ate, fonte_url, fonte_descricao)
select d.id, a.y, 'Livro do Curso de Leitura do ano [DADO DE TESTE]', make_date(a.y, 1, 1), make_date(a.y, 12, 31), 'https://exemplo.test/fixture', 'FIXTURE DE TESTE — não é o livro oficial'
from public.dynamic_content_definitions d, (select extract(year from public._data_no_brasil())::int as y) a where d.chave = 'curso_leitura_amigo';

select t.como('multi_dois_papeis'); select t.pedir_clube('clube_a');
select t.permitido('inicia Amigo no A', format($q$select public.classe_iniciar(%L)$q$, t.classe('amigo')));
reset role;
insert into t.ids (chave, id) select 'mc', id from public.member_classes where usuario_id = t.id('multi_dois_papeis') and club_id = t.id('clube_a') and class_id = t.classe('amigo');
select t.como('multi_dois_papeis'); select t.pedir_clube('clube_a');
select t.permitido('registra escolhas V.1/VII.1', format($q$select public.requisito_escolher(r, array[(select o.id from public.requirement_options o join public.requirement_option_groups g on g.id = o.grupo_id where g.alvo_id = r order by o.ordem limit 1)], '{}') from unnest(array[%L::uuid, %L::uuid]) r$q$, t.req('amigo.V.1'), t.req('amigo.VII.1')), 2);
select t.permitido('...IX.1 texto livre', format($q$select public.requisito_escolher(%L, '{}', array['Cestaria [DADO DE TESTE]'])$q$, t.req('amigo.IX.1')));
select t.permitido('guarda resposta PRIVADA em I.1', format($q$select public.requisito_salvar(%L, 'Resposta privada do menor [TESTE]', null)$q$, t.req('amigo.I.1')));
select t.como('lider_a'); select t.pedir_clube('clube_a');
select t.permitido('lider_a aprova os 25', format($q$select public.requisito_avaliar(mr.id, 'aprovado', 'comentário interno [TESTE]') from public.member_requirements mr where mr.member_class_id = %L$q$, t.id('mc')), 25);
select t.permitido('emite o Caderno de acompanhamento', format($q$select public.documento_emitir(%L)$q$, t.id('mc')));
reset role;
insert into t.ids_txt (chave, id) select 'token_acomp', token_publico from public.class_documents where member_class_id = t.id('mc') and tipo = 'acompanhamento';
insert into t.ids (chave, id) select 'doc', id from public.class_documents where member_class_id = t.id('mc') and tipo = 'acompanhamento';

-- ==================== documento_pdf_dados: reaproveita a sanitização, acrescenta ids técnicos ====================
select t.como('multi_dois_papeis'); select t.pedir_clube('clube_a');
select t.eq('pdf_dados (dono): documento_id/club_id_origem/usuario_id corretos, pdf_versao_atual=0, ainda não assinado',
  (select (d->>'documento_id' = t.id('doc')::text) || '|' || (d->>'club_id_origem' = t.id('clube_a')::text) || '|' || (d->>'usuario_id' = t.id('multi_dois_papeis')::text) || '|' || (d->>'pdf_versao_atual') || '|' || (d->>'ja_assinado')
     from (select public.documento_pdf_dados(t.tok()) d) x), 'true|true|true|0|false');
select t.ok('pdf_dados: conteudo é o MESMO objeto de documento_conteudo (não duplicado)', (public.documento_pdf_dados(t.tok())->'conteudo') = public.documento_conteudo(t.tok()));
reset role;

select t.como('lider_a'); select t.pedir_clube('clube_a');
select t.ok('pdf_dados (liderança do clube): também acessa', (public.documento_pdf_dados(t.tok())->>'documento_id') is not null);
reset role;

-- (lider_b não serve de "estranho" aqui: multi_dois_papeis TEM vínculo ativo em clube_b também, e
-- _pode_ver_conquista_curricular libera por desenho a liderança de qualquer clube onde a pessoa
-- tem vínculo ativo hoje — é assim que "o novo clube consulta" funciona, e documento_conteudo já
-- se apoiava nisso. membro_b não é liderança de lugar nenhum: serve de estranho de verdade.)
select t.como('membro_b'); select t.pedir_clube('clube_b');
select t.ok('pdf_dados: quem não é liderança em lugar nenhum não acessa (null)', public.documento_pdf_dados(t.tok()) is null);
reset role;

select t.como_anon();
select t.throws('pdf_dados: anônimo nem pode chamar (revoke de anon) — a verificação pública continua sendo só documento_verificar', format($q$select public.documento_pdf_dados(%L)$q$, t.tok()), 'permission denied');
reset role;

-- ==================== documento_pdf_registrar: validações ====================
select t.como('multi_dois_papeis'); select t.pedir_clube('clube_a');
select t.throws('hash com formato errado é recusado', format($q$select public.documento_pdf_registrar(%L, 'nao-e-um-hash', %L)$q$, t.tok(), t.id('clube_a')::text || '/x/doc.pdf'), 'Hash inválido');
select t.throws('caminho de OUTRO clube é recusado', format($q$select public.documento_pdf_registrar(%L, %L, %L)$q$, t.tok(), repeat('a', 64), t.id('clube_b')::text || '/x/doc.pdf'), 'não corresponde');
select t.permitido('registra o PDF com hash e caminho válidos (pasta do próprio clube)', format($q$select public.documento_pdf_registrar(%L, %L, %L)$q$, t.tok(), repeat('a', 64), t.id('clube_a')::text || '/' || t.id('multi_dois_papeis')::text || '/' || t.id('doc')::text || '/1.pdf'));
select t.eq('depois de registrar: pdf_versao=1, pdf_hash salvo', (select pdf_versao::text || '|' || pdf_hash from public.class_documents where id = t.id('doc')), '1|' || repeat('a', 64));
select t.permitido('registrar de novo (regeneração) incrementa pdf_versao', format($q$select public.documento_pdf_registrar(%L, %L, %L)$q$, t.tok(), repeat('b', 64), t.id('clube_a')::text || '/' || t.id('multi_dois_papeis')::text || '/' || t.id('doc')::text || '/2.pdf'));
select t.eq('pdf_versao agora é 2, hash atualizado', (select pdf_versao::text || '|' || pdf_hash from public.class_documents where id = t.id('doc')), '2|' || repeat('b', 64));
reset role;

select t.como('membro_b'); select t.pedir_clube('clube_b');
select t.throws('quem não é liderança em lugar nenhum não registra PDF deste documento', format($q$select public.documento_pdf_registrar(%L, %L, %L)$q$, t.tok(), repeat('c', 64), t.id('clube_a')::text || '/x/y/3.pdf'), 'Sem permissão');
reset role;

-- aprova a revisão documental (agora exigida por documento_assinar — migration 92) e simula uma
-- assinatura direto na tabela (como postgres) — o fluxo real de assinatura está no teste 67; aqui
-- só prova que a trava de imutabilidade do PDF já funciona depois de assinado.
select t.como('lider_a'); select t.pedir_clube('clube_a');
select t.permitido('aprova a revisão documental', format($q$select public.documento_revisar(%L, 'aprovado')$q$, t.tok()));
reset role;
insert into public.document_signatures (documento_id, snapshot_id, club_id_origem, metodo, status)
select t.id('doc'), snapshot_id, t.id('clube_a'), 'aprovacao_sistema', 'registrada' from public.class_documents where id = t.id('doc');
select t.como('multi_dois_papeis'); select t.pedir_clube('clube_a');
select t.throws('depois de assinado: PDF não pode mais ser sobrescrito', format($q$select public.documento_pdf_registrar(%L, %L, %L)$q$, t.tok(), repeat('d', 64), t.id('clube_a')::text || '/' || t.id('multi_dois_papeis')::text || '/' || t.id('doc')::text || '/3.pdf'), 'já tem assinatura');
select t.eq('...e pdf_versao continua em 2 (nada mudou)', (select pdf_versao from public.class_documents where id = t.id('doc')), 2);
reset role;

-- ==================== documentos_do_clube: Central de Documentos (só leitura) ====================
select t.como('lider_a'); select t.pedir_clube('clube_a');
-- (roda DEPOIS da simulação de assinatura feita acima, direto na tabela como postgres — por isso
-- assinaturas_registradas=1 e estado=assinado: é exatamente o dado real da tabela, não inventado.)
select t.eq('documentos_do_clube: aparece o documento, estado=assinado (reflete a assinatura simulada acima)',
  (select (x.j->>'titular_nome') || '|' || (x.j->>'tipo') || '|' || (x.j->>'estado') || '|' || (x.j->>'assinaturas_registradas') || '|' || (x.j->>'pdf_versao')
   from json_array_elements((select public.documentos_do_clube())) x(j)
   where x.j->>'documento_id' = t.id('doc')::text),
  'Multi Dois Papeis|acompanhamento|assinado|1|2');
reset role;

select t.como('membro_a'); select t.pedir_clube('clube_a');
select t.throws('quem não é liderança não lista a Central de Documentos', 'select public.documentos_do_clube()', 'Sem permissão');
reset role;

select t.como('lider_b'); select t.pedir_clube('clube_b');
select t.eq('liderança de OUTRO clube: lista vazia (nenhum documento vaza entre clubes)', (select json_array_length(public.documentos_do_clube())), 0);
reset role;

select t.fim();
rollback;
