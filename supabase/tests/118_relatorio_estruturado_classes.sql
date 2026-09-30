-- Fase 7 (migrations 510 e 512): motor de RELATÓRIO ESTRUTURADO das Classes + CONTEÚDO de cada tentativa.
-- Prova: modelos do manifesto no banco; rascunho/validação no servidor; envio congela conteúdo+anexos;
-- devolução com comentário; correção e reenvio SEM sobrescrever a tentativa antiga; histórico com o conteúdo;
-- confirmação auditada (quem, papel, quando); ninguém avalia o próprio requisito; anexos só do próprio dono,
-- no clube certo, visíveis só à liderança do clube; isolamento entre clubes; compatibilidade com comprovação antiga.
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
create function t.mr(p_user text, p_req text) returns uuid language sql stable security definer as $$
  select mr.id from public.member_requirements mr where mr.usuario_id = t.id(p_user) and mr.requirement_id = t.req(p_req) $$;
create function t.j(p_sql text) returns text language plpgsql as $$ declare v text; begin execute p_sql into v; return v; end $$;

-- ==================== 1) os 71 modelos do manifesto estão no banco, ligados a requisitos reais, imutáveis ====================
select t.eq('71 modelos de relatório das Classes no banco', (select count(*) from public.requisito_modelos where alvo = 'classe'), 71);
select t.eq('todo modelo aponta para um requisito que existe no currículo importado',
  (select count(*) from public.requisito_modelos m where not exists (select 1 from public.class_requirements r where r.manifesto_id = m.chave)), 0);
select t.eq('as 5 categorias esperadas (e nenhuma de foto obrigatória)',
  (select count(distinct categoria) from public.requisito_modelos), 5);
select t.eq('nenhum campo de anexos é obrigatório nos modelos das Classes (regra 8: foto só opcional)',
  (select count(*) from public.requisito_modelos m, jsonb_array_elements(m.schema -> 'campos') c
    where c ->> 'tipo' = 'anexos' and coalesce((c ->> 'obrigatorio')::boolean, false)), 0);
select t.throws('modelo é imutável (update)', $q$update public.requisito_modelos set familia = 'X' where chave = 'amigo.IV.1'$q$, 'imutável');
select t.throws('modelo é imutável (delete)', $q$delete from public.requisito_modelos where chave = 'amigo.IV.1'$q$, 'imutável');
select t.como('membro_a');
select t.eq('authenticated não lê nem grava requisito_modelos direto (só RPC)', (select t.nv('select count(*) from public.requisito_modelos')), 0);
reset role;

-- modelo SÓ DE TESTE com anexos obrigatórios, para exercitar arquivos (nas Classes reais o anexo é opcional)
insert into public.requisito_modelos (alvo, chave, versao, schema, categoria, familia) values
  ('classe', 'amigo.III.1', 1, '{"versao":1,"campos":[{"chave":"local","tipo":"texto_curto","rotulo":"Local","obrigatorio":true},{"chave":"fiz","tipo":"confirmacao","rotulo":"Fiz","obrigatorio":true},{"chave":"fotos","tipo":"anexos","rotulo":"Fotos","obrigatorio":true,"min":1,"max":2,"tipos":["imagem"]}]}'::jsonb, 'TESTE', 'T1');

-- ==================== 2) rascunho e envio no servidor ====================
select t.como('membro_a'); select t.pedir_clube('clube_a');
select t.permitido('membro_a inicia a classe Amigo', format($q$select public.classe_iniciar(%L)$q$, t.classe('amigo')));
select t.eq('requisito COM formulário informa o modelo ao dono', t.txt(format($q$select (public.requisito_formulario(%L)->'modelo'->>'familia')$q$, t.req('amigo.IV.1'))), 'A2');
select t.eq('requisito SEM formulário informa tem_formulario=false', t.txt(format($q$select (public.requisito_formulario(%L)->>'tem_formulario')$q$, t.req('amigo.II.1'))), 'false');
select t.throws('requisito sem formulário não aceita rascunho estruturado',
  format($q$select public.requisito_relatorio_salvar(%L, '{}'::jsonb, '[]'::jsonb)$q$, t.req('amigo.II.1')), 'não tem formulário');

select t.throws('campo desconhecido é recusado',
  format($q$select public.requisito_relatorio_salvar(%L, %L::jsonb, '[]'::jsonb)$q$, t.req('amigo.IV.1'), '{"hack": "x"}'), 'campo desconhecido');
select t.throws('lista com mais itens que o máximo é recusada',
  format($q$select public.requisito_relatorio_salvar(%L, %L::jsonb, '[]'::jsonb)$q$, t.req('amigo.IV.1'),
    (select jsonb_build_object('qualidades', (select jsonb_agg('q' || g) from generate_series(1, 11) g))::text)), 'no máximo 10');
select t.throws('tipo errado (texto onde é lista) é recusado',
  format($q$select public.requisito_relatorio_salvar(%L, %L::jsonb, '[]'::jsonb)$q$, t.req('amigo.IV.1'), '{"qualidades": "vários"}'), 'lista inválida');
select t.throws('anexo em requisito que não aceita anexos é recusado',
  format($q$select public.requisito_relatorio_salvar(%L, '{}'::jsonb, %L::jsonb)$q$, t.req('amigo.IV.1'), '[{"campo":"fotos","path":"x/y.jpg"}]'), 'não aceita anexos');

select t.permitido('rascunho parcial (5 qualidades) é aceito',
  format($q$select public.requisito_relatorio_salvar(%L, %L::jsonb, '[]'::jsonb)$q$, t.req('amigo.IV.1'),
    (select jsonb_build_object('qualidades', (select jsonb_agg('q' || g) from generate_series(1, 5) g))::text)));
select t.throws('enviar com formulário incompleto é recusado e diz o que falta',
  format($q$select public.requisito_enviar(%L)$q$, t.req('amigo.IV.1')), 'Formulário incompleto');
reset role;
select t.eq('o rascunho ficou guardado e o requisito está em andamento', (select status || '|' || jsonb_array_length(rascunho -> 'qualidades') from public.member_requirements where id = t.mr('membro_a', 'amigo.IV.1')), 'em_andamento|5');
select t.eq('nenhuma tentativa foi criada por rascunho', (select count(*) from public.requirement_submissions where member_requirement_id = t.mr('membro_a', 'amigo.IV.1')), 0);

select jsonb_build_object('qualidades', (select jsonb_agg('qualidade ' || g) from generate_series(1, 10) g),
                          'situacoes', (select jsonb_agg('situação ' || g) from generate_series(1, 4) g))::text as c1 \gset
select t.como('membro_a'); select t.pedir_clube('clube_a');
select t.permitido('rascunho completo', format($q$select public.requisito_relatorio_salvar(%L, %L::jsonb, '[]'::jsonb)$q$, t.req('amigo.IV.1'), :'c1'));
select t.permitido('envio (tentativa 1)', format($q$select public.requisito_enviar(%L)$q$, t.req('amigo.IV.1')));
select t.throws('não edita o rascunho enquanto aguarda avaliação',
  format($q$select public.requisito_relatorio_salvar(%L, %L::jsonb, '[]'::jsonb)$q$, t.req('amigo.IV.1'), :'c1'), 'Aguarde a avaliação');
reset role;
select t.eq('tentativa 1 congelou o CONTEÚDO estruturado (10 qualidades, 4 situações)',
  (select jsonb_array_length(conteudo -> 'qualidades') || '|' || jsonb_array_length(conteudo -> 'situacoes') || '|' || tipo_evidencia_entregue || '|' || modelo_versao
     from public.requirement_submissions where member_requirement_id = t.mr('membro_a', 'amigo.IV.1') and tentativa_numero = 1), '10|4|relatorio|1');
select t.ok('e um RESUMO legível em evidencia_texto (telas/PDF antigos)',
  (select evidencia_texto like '%qualidade 10%' from public.requirement_submissions where member_requirement_id = t.mr('membro_a', 'amigo.IV.1') and tentativa_numero = 1));
select t.throws('tentativa é imutável (update do conteúdo)', format($q$update public.requirement_submissions set conteudo = '{}'::jsonb where member_requirement_id = %L$q$, t.mr('membro_a', 'amigo.IV.1')), 'imutável');
select t.throws('tentativa é imutável (delete)', format($q$delete from public.requirement_submissions where member_requirement_id = %L$q$, t.mr('membro_a', 'amigo.IV.1')), 'imutável');

-- ==================== 3) devolução com comentário → correção → reenvio; a tentativa antiga NUNCA muda ====================
select t.como('instrutor_a'); select t.pedir_clube('clube_a');
select t.eq('a fila do avaliador traz conteúdo e modelo da tentativa',
  t.txt($q$select (x->'conteudo'->'qualidades'->>0) || '|' || (x->'modelo'->>'familia') from json_array_elements(public.classe_avaliacoes_pendentes()) x limit 1$q$), 'qualidade 1|A2');
select t.throws('devolver sem comentário é recusado',
  format($q$select public.requisito_avaliar(%L, 'correcao_solicitada', null)$q$, t.mr('membro_a', 'amigo.IV.1')), 'Explique');
select t.permitido('instrutor devolve com comentário',
  format($q$select public.requisito_avaliar(%L, 'correcao_solicitada', 'Troque as 3 últimas qualidades por exemplos seus.', (select id from public.requirement_submissions where member_requirement_id = %L and tentativa_numero = 1))$q$, t.mr('membro_a', 'amigo.IV.1'), t.mr('membro_a', 'amigo.IV.1')));

select jsonb_build_object('qualidades', (select jsonb_agg('NOVA qualidade ' || g) from generate_series(1, 10) g),
                          'situacoes', (select jsonb_agg('nova situação ' || g) from generate_series(1, 4) g))::text as c2 \gset
select t.como('membro_a'); select t.pedir_clube('clube_a');
select t.eq('dono vê a última avaliação (comentário) ao reabrir o formulário', t.txt(format($q$select (public.requisito_formulario(%L)->'ultima_avaliacao'->>'comentario')$q$, t.req('amigo.IV.1'))), 'Troque as 3 últimas qualidades por exemplos seus.');
select t.permitido('membro corrige o rascunho', format($q$select public.requisito_relatorio_salvar(%L, %L::jsonb, '[]'::jsonb)$q$, t.req('amigo.IV.1'), :'c2'));
select t.permitido('membro reenvia (tentativa 2)', format($q$select public.requisito_enviar(%L)$q$, t.req('amigo.IV.1')));
reset role;
select t.eq('agora são 2 tentativas', (select count(*) from public.requirement_submissions where member_requirement_id = t.mr('membro_a', 'amigo.IV.1')), 2);
select t.eq('tentativa 1 continua com o conteúdo ORIGINAL', (select conteudo -> 'qualidades' ->> 0 from public.requirement_submissions where member_requirement_id = t.mr('membro_a', 'amigo.IV.1') and tentativa_numero = 1), 'qualidade 1');
select t.eq('tentativa 2 tem o conteúdo NOVO', (select conteudo -> 'qualidades' ->> 0 from public.requirement_submissions where member_requirement_id = t.mr('membro_a', 'amigo.IV.1') and tentativa_numero = 2), 'NOVA qualidade 1');

select t.como('lider_a'); select t.pedir_clube('clube_a');
select t.permitido('diretoria aprova a tentativa 2', format($q$select public.requisito_avaliar(%L, 'aprovado', 'Muito bom!', (select id from public.requirement_submissions where member_requirement_id = %L and tentativa_numero = 2))$q$, t.mr('membro_a', 'amigo.IV.1'), t.mr('membro_a', 'amigo.IV.1')));
select t.eq('histórico (visão da liderança): 2 tentativas, decisões, comentários e CONTEÚDO de cada uma',
  (select string_agg((x ->> 'tentativa_numero') || ':' || (x ->> 'decisao') || ':' || (x -> 'conteudo' -> 'qualidades' ->> 0), ',' order by (x ->> 'tentativa_numero')::int)
     from json_array_elements(public.requisito_historico(t.mr('membro_a', 'amigo.IV.1')) -> 'tentativas') x),
  '1:correcao_solicitada:qualidade 1,2:aprovado:NOVA qualidade 1');
select t.eq('histórico devolve o modelo para desenhar o relatório', (public.requisito_historico(t.mr('membro_a', 'amigo.IV.1')) -> 'modelo' ->> 'familia'), 'A2');
reset role;
select t.eq('AUDITORIA da confirmação: quem, papel e quando',
  (select count(*) from public.requirement_approvals a where a.member_requirement_id = t.mr('membro_a', 'amigo.IV.1')
     and a.avaliado_por is not null and a.avaliado_papel in ('instrutor', 'diretoria') and a.created_at is not null and a.submission_id is not null), 2);
select t.eq('tentativa 1 devolvida pelo instrutor; tentativa 2 aprovada pela diretoria',
  (select string_agg(a.avaliado_papel || ':' || a.decisao, ',' order by s.tentativa_numero) from public.requirement_approvals a
     join public.requirement_submissions s on s.id = a.submission_id where a.member_requirement_id = t.mr('membro_a', 'amigo.IV.1')), 'instrutor:correcao_solicitada,diretoria:aprovado');
select t.como('membro_a'); select t.pedir_clube('clube_a');
select t.throws('depois de aprovado o dono não edita', format($q$select public.requisito_relatorio_salvar(%L, '{}'::jsonb, '[]'::jsonb)$q$, t.req('amigo.IV.1')), 'já foi aprovado');
select t.throws('nem reenvia', format($q$select public.requisito_enviar(%L)$q$, t.req('amigo.IV.1')), 'já foi aprovado');
reset role;

-- ==================== 4) ninguém avalia o PRÓPRIO requisito ====================
select t.como('lider_a'); select t.pedir_clube('clube_a');
select t.permitido('a diretoria inicia a própria classe Amigo', format($q$select public.classe_iniciar(%L)$q$, t.classe('amigo')));
select t.permitido('a diretoria preenche e envia o próprio relatório', format($q$select public.requisito_relatorio_salvar(%L, %L::jsonb, '[]'::jsonb)$q$, t.req('amigo.IV.1'), :'c1'));
select t.permitido('...envia', format($q$select public.requisito_enviar(%L)$q$, t.req('amigo.IV.1')));
select t.throws('a diretoria NÃO aprova o próprio requisito', format($q$select public.requisito_avaliar(%L, 'aprovado', null)$q$, t.mr('lider_a', 'amigo.IV.1')), 'próprio requisito');
select t.throws('nem devolve o próprio', format($q$select public.requisito_avaliar(%L, 'correcao_solicitada', 'x')$q$, t.mr('lider_a', 'amigo.IV.1')), 'próprio requisito');
select t.como('instrutor_a'); select t.pedir_clube('clube_a');
select t.permitido('outra pessoa da liderança avalia normalmente', format($q$select public.requisito_avaliar(%L, 'aprovado', null)$q$, t.mr('lider_a', 'amigo.IV.1')));
reset role;

-- ==================== 5) anexos: só do dono, do clube certo, existentes; visíveis só à liderança do clube ====================
select t.id('membro_a')::text || '/requisitos/rel-1.jpg' as f1 \gset
select t.id('membro_a')::text || '/requisitos/rel-2.jpg' as f2 \gset
select t.id('membro_a')::text || '/requisitos/rel-3.jpg' as f3 \gset
select t.id('clube_a')::text || '/' || t.id('membro_a')::text || '/requisitos/rel-novo.jpg' as f4 \gset
select t.id('clube_b')::text || '/' || t.id('membro_a')::text || '/requisitos/rel-outro-clube.jpg' as f_outro_clube \gset
select t.id('membro_b')::text || '/requisitos/do-colega.jpg' as f_alheio \gset
insert into storage.objects (bucket_id, name, owner_id) values
  ('comprovacoes', :'f1', t.id('membro_a')::text), ('comprovacoes', :'f2', t.id('membro_a')::text), ('comprovacoes', :'f3', t.id('membro_a')::text),
  ('comprovacoes', :'f4', t.id('membro_a')::text), ('comprovacoes', :'f_outro_clube', t.id('membro_a')::text), ('comprovacoes', :'f_alheio', t.id('membro_b')::text);

select t.como('membro_a'); select t.pedir_clube('clube_a');
select t.throws('arquivo de OUTRO usuário é recusado',
  format($q$select public.requisito_relatorio_salvar(%L, '{"local":"x"}'::jsonb, %L::jsonb)$q$, t.req('amigo.III.1'), jsonb_build_array(jsonb_build_object('campo', 'fotos', 'path', :'f_alheio'))::text), 'não é seu');
select t.throws('arquivo do MESMO usuário mas de OUTRO clube é recusado',
  format($q$select public.requisito_relatorio_salvar(%L, '{"local":"x"}'::jsonb, %L::jsonb)$q$, t.req('amigo.III.1'), jsonb_build_array(jsonb_build_object('campo', 'fotos', 'path', :'f_outro_clube'))::text), 'outro clube');
select t.throws('caminho que não existe no bucket é recusado',
  format($q$select public.requisito_relatorio_salvar(%L, '{"local":"x"}'::jsonb, %L::jsonb)$q$, t.req('amigo.III.1'), jsonb_build_array(jsonb_build_object('campo', 'fotos', 'path', t.id('membro_a')::text || '/requisitos/fantasma.jpg'))::text), 'não encontrado');
select t.throws('caminho com .. é recusado',
  format($q$select public.requisito_relatorio_salvar(%L, '{"local":"x"}'::jsonb, %L::jsonb)$q$, t.req('amigo.III.1'), jsonb_build_array(jsonb_build_object('campo', 'fotos', 'path', t.id('membro_a')::text || '/../x.jpg'))::text), 'inválido');
select t.throws('mais anexos que o máximo (2) é recusado',
  format($q$select public.requisito_relatorio_salvar(%L, '{"local":"x"}'::jsonb, %L::jsonb)$q$, t.req('amigo.III.1'),
    jsonb_build_array(jsonb_build_object('campo', 'fotos', 'path', :'f1'), jsonb_build_object('campo', 'fotos', 'path', :'f2'), jsonb_build_object('campo', 'fotos', 'path', :'f3'))::text), 'no máximo 2');
select t.permitido('sem anexo dá para salvar rascunho', format($q$select public.requisito_relatorio_salvar(%L, '{"local":"Praça","fiz":true}'::jsonb, '[]'::jsonb)$q$, t.req('amigo.III.1')));
select t.throws('anexo obrigatório ausente barra o ENVIO', format($q$select public.requisito_enviar(%L)$q$, t.req('amigo.III.1')), 'Formulário incompleto');
select t.permitido('2 anexos válidos (formato antigo e novo)',
  format($q$select public.requisito_relatorio_salvar(%L, '{"local":"Praça","fiz":true}'::jsonb, %L::jsonb)$q$, t.req('amigo.III.1'),
    jsonb_build_array(jsonb_build_object('campo', 'fotos', 'path', :'f1'), jsonb_build_object('campo', 'fotos', 'path', :'f4'))::text));
select t.permitido('envia com anexos', format($q$select public.requisito_enviar(%L)$q$, t.req('amigo.III.1')));
reset role;
select t.eq('a tentativa guardou os 2 anexos', (select jsonb_array_length(anexos) from public.requirement_submissions where member_requirement_id = t.mr('membro_a', 'amigo.III.1')), 2);

select t.como('lider_a'); select t.pedir_clube('clube_a');
select t.ok('liderança do clube A abre o anexo do formato antigo', public.lideranca_ve_comprovacao(:'f1'));
select t.ok('liderança do clube A abre o anexo do formato novo (2º anexo)', public.lideranca_ve_comprovacao(:'f4'));
select t.ok('...mas NÃO abre um arquivo que nenhuma tentativa referencia', not public.lideranca_ve_comprovacao(:'f3'));
select t.como('lider_b'); select t.pedir_clube('clube_b');
select t.ok('liderança do OUTRO clube NÃO abre o anexo', not public.lideranca_ve_comprovacao(:'f1') and not public.lideranca_ve_comprovacao(:'f4'));
reset role;

-- ==================== 6) isolamento entre clubes ====================
select t.como('lider_b'); select t.pedir_clube('clube_b');
select t.throws('liderança de OUTRO clube não lê o histórico', format($q$select public.requisito_historico(%L)$q$, t.mr('membro_a', 'amigo.IV.1')), 'não encontrado');
select t.eq('a fila de avaliação do clube B não traz nada do clube A', t.nv($q$select json_array_length(public.classe_avaliacoes_pendentes())$q$), 0);
select t.como('membro_b'); select t.pedir_clube('clube_b');
select t.throws('membro sem matrícula não abre o formulário de outro', format($q$select public.requisito_formulario(%L)$q$, t.req('amigo.IV.1')), 'não encontrado');
select t.throws('nem salva rascunho em requisito que não iniciou', format($q$select public.requisito_relatorio_salvar(%L, '{}'::jsonb, '[]'::jsonb)$q$, t.req('amigo.IV.1')), 'não encontrado');
select t.como('membro_a'); select t.pedir_clube('clube_b');
select t.throws('membro_a pedindo o clube B (onde não tem vínculo) não salva nada', format($q$select public.requisito_relatorio_salvar(%L, '{}'::jsonb, '[]'::jsonb)$q$, t.req('amigo.IV.1')), null);
reset role;
select t.como('lider_b'); select t.pedir_clube('clube_b');
select t.eq('RLS: a liderança de B enxerga 0 tentativas (as de A ficam no clube A)', t.nv('select count(*) from public.requirement_submissions'), 0);
reset role;

-- ==================== 7) compatibilidade: requisito SEM formulário segue igual ====================
select t.como('membro_a'); select t.pedir_clube('clube_a');
select t.permitido('requisito sem modelo: salva a foto como sempre', format($q$select public.requisito_salvar(%L, null, %L)$q$, t.req('amigo.VI.1'), :'f3'));
select t.permitido('...envia', format($q$select public.requisito_enviar(%L)$q$, t.req('amigo.VI.1')));
reset role;
select t.eq('...e a tentativa é do tipo antigo, sem conteúdo estruturado',
  (select tipo_evidencia_entregue || '|' || coalesce(conteudo::text, 'nulo') from public.requirement_submissions where member_requirement_id = t.mr('membro_a', 'amigo.VI.1')), 'foto|nulo');

-- MODO COMPATÍVEL: requisito COM formulário, mas o membro nunca abriu o formulário (tela antiga em cache): segue pelo caminho de texto
select t.como('membro_a'); select t.pedir_clube('clube_a');
select t.permitido('tela antiga: salva texto num requisito que agora tem formulário', format($q$select public.requisito_salvar(%L, 'Explico os versículos com minhas palavras.', null)$q$, t.req('amigo.II.2')));
select t.permitido('...e envia (sem rascunho estruturado, vale o caminho antigo)', format($q$select public.requisito_enviar(%L)$q$, t.req('amigo.II.2')));
reset role;
select t.eq('...a tentativa é do tipo antigo (texto), sem conteúdo estruturado',
  (select tipo_evidencia_entregue || '|' || coalesce(conteudo::text, 'nulo') from public.requirement_submissions where member_requirement_id = t.mr('membro_a', 'amigo.II.2')), 'texto|nulo');
-- quem USOU o formulário é validado por inteiro (não dá para "fugir" do modelo depois de começar)
select t.como('membro_a'); select t.pedir_clube('clube_a');
select t.permitido('membro abre o formulário do requisito amigo.V.2 e salva um rascunho incompleto', format($q$select public.requisito_relatorio_salvar(%L, '{"compromisso":"vou me cuidar"}'::jsonb, '[]'::jsonb)$q$, t.req('amigo.V.2')));
select t.permitido('...e mesmo salvando texto pelo caminho antigo por cima', format($q$select public.requisito_salvar(%L, 'texto solto', null)$q$, t.req('amigo.V.2')));
select t.throws('...o envio continua exigindo o formulário completo', format($q$select public.requisito_enviar(%L)$q$, t.req('amigo.V.2')), 'Formulário incompleto');
reset role;

-- ==================== 8) o validador do servidor (casos do modelo real) ====================
create function t.val(p_chave text, p_conteudo text, p_envio boolean default true, p_anexos text default '[]') returns text language sql stable as $$
  select coalesce(public._erros_em_texto(public._relatorio_validar((select schema from public.requisito_modelos where chave = p_chave and versao = 1 and alvo = 'classe'), p_conteudo::jsonb, p_anexos::jsonb, p_envio)), 'ok') $$;
select t.eq('escolha com opção PENDENTE é recusada (regra 10)', t.val('guia.V.2', '{"atividade":{"opcao":"nutricao_ou_cultura_fisica","dados":{}}}'), 'Qual atividade você escolheu?: esta opção ainda não está disponível');
select t.eq('escolha com opção válida: corrida', t.val('guia.V.2', '{"atividade":{"opcao":"corrida","dados":{"programa":"Treino de 4 semanas"}}}'), 'ok');
select t.ok('escolha sem os dados da opção não envia', t.val('guia.V.2', '{"atividade":{"opcao":"corrida","dados":{}}}') like '%Preencha%');
select t.ok('escolha inexistente é recusada', t.val('guia.V.2', '{"atividade":{"opcao":"outra","dados":{}}}') like '%opção inválida%');
select t.eq('checklist "2 de 4": 1 tema no envio é recusado', t.val('excursionista.IV.1', '{"temas":{"autoestima":true},"forma":{"opcao":"avaliacao_pessoal","dados":{"avaliacao":"texto"}}}'), 'Escolha 2 destes temas: marque pelo menos 2');
select t.eq('checklist "2 de 4": 3 marcados é recusado mesmo no rascunho', t.val('excursionista.IV.1', '{"temas":{"autoestima":true,"financas_pessoais":true,"pressao_de_grupo":true}}', false), 'Escolha 2 destes temas: marque no máximo 2');
select t.eq('checklist "2 de 4" + avaliação pessoal: ok', t.val('excursionista.IV.1', '{"temas":{"autoestima":true,"pressao_de_grupo":true},"forma":{"opcao":"avaliacao_pessoal","dados":{"avaliacao":"texto"}}}'), 'ok');
select t.eq('meta de quantidade: 2 convidados < 3 → recusado no envio', t.val('pioneiro.II.5', '{"quantidade":2,"fiz":true}'), 'Quantas pessoas você convidou: mínimo 3');
select t.eq('meta de quantidade: rascunho com 2 é aceito', t.val('pioneiro.II.5', '{"quantidade":2}', false), 'ok');
select t.eq('meta de quantidade: 3 convidados + confirmação → ok', t.val('pioneiro.II.5', '{"quantidade":3,"fiz":true}'), 'ok');
select t.eq('regra 7: o modelo do convite NÃO tem campo de nome de pessoa',
  (select count(*) from public.requisito_modelos where chave = 'pioneiro.II.5' and schema::text ~* '(nome|telefone|contato|email)'), 0);
select t.eq('número decimal onde é inteiro', t.val('pioneiro.II.5', '{"quantidade":3.5,"fiz":true}'), 'Quantas pessoas você convidou: use número inteiro');
select t.eq('confirmação obrigatória desmarcada não envia', t.val('companheiro.IV.1', '{"fiz":false}'), 'Confirme: Conversei com o conselheiro ou a Unidade sobre respeitar pessoas de outras culturas, raças e sexo');
select t.eq('diário: 6 dias no envio é recusado', t.val('companheiro.VII.3', (select jsonb_build_object('dias', (select jsonb_agg(jsonb_build_object('observacao', 'ok')) from generate_series(1, 6)))::text)), 'Diário da Criação: faltam entradas (6/7)');
select t.eq('diário: 7 dias ok', t.val('companheiro.VII.3', (select jsonb_build_object('dias', (select jsonb_agg(jsonb_build_object('observacao', 'ok')) from generate_series(1, 7)))::text)), 'ok');
select t.ok('diário: dia com campo vazio aponta QUAL dia', t.val('companheiro.VII.3', (select jsonb_build_object('dias', (select jsonb_agg(jsonb_build_object('observacao', case when g = 3 then '' else 'ok' end)) from generate_series(1, 7) g))::text)) like 'Dia 3:%');
select t.ok('data no futuro é recusada', t.val('companheiro.VIII.2', '{"data":"2999-01-01"}', false) like '%não pode ser no futuro%');
select t.ok('data inválida é recusada', t.val('companheiro.VIII.2', '{"data":"31/02/2026"}', false) like '%data inválida%');
select t.ok('conteúdo enorme é recusado', t.val('amigo.III.2', (select jsonb_build_object('texto', repeat('a', 2600))::text), false) like '%passou de%');
select t.ok('foto do relato é OPCIONAL (regra 8): envio sem foto passa',
  t.val('companheiro_de_excursionismo.5', '{"data":"2026-01-10","local":"Parque","distancia_km":6,"descricao":"Fui","aprendizado":"Aprendi"}') = 'ok');
select t.ok('...e com foto também', t.val('companheiro_de_excursionismo.5', '{"data":"2026-01-10","local":"Parque","distancia_km":6,"descricao":"Fui","aprendizado":"Aprendi"}', true, '[{"campo":"fotos","path":"a/b.jpg"}]') = 'ok');

-- ==================== 9) conteúdo privado fechado à coordenação institucional ====================
\o /dev/null
select t.signup('c118_dist', '{"tipo":"fundador","nome":"Coord Distrital 118"}'::jsonb);
insert into public.organizational_units (id, type, nome, slug, parent_id, metadata) values
  (public.curriculo_uuid('t118:campo'), 'campo', 'Associação 118', null, null, '{"test_only":true}');
insert into public.organizational_units (id, type, nome, slug, parent_id, metadata) values
  (public.curriculo_uuid('t118:r'), 'regiao', 'Região 118', null, public.curriculo_uuid('t118:campo'), '{"test_only":true}');
insert into public.organizational_units (id, type, nome, slug, parent_id, metadata) values
  (public.curriculo_uuid('t118:d'), 'distrito', 'Distrito 118', null, public.curriculo_uuid('t118:r'), '{"test_only":true}');
insert into t.ids (chave, id) values ('d118', public.curriculo_uuid('t118:d'));
update public.organizational_units set parent_id = t.id('d118') where id = t.id('clube_a');
insert into public.organization_memberships (user_id, organizational_unit_id, role, status) values (t.id('c118_dist'), t.id('d118'), 'coordenador_distrital', 'ativo');
create function t.no_escopo118() returns void language plpgsql as $$
begin
  perform t.como('c118_dist');
  perform set_config('request.headers', json_build_object('x-escopo-atual', t.id('d118'))::text, true);
end $$;
grant insert, select on t.ids to public;
\o
select t.no_escopo118();
select t.throws('coordenador do distrito NÃO lê o histórico (conteúdo das tentativas) de um clube abaixo', format($q$select public.requisito_historico(%L)$q$, t.mr('membro_a', 'amigo.IV.1')), 'Sem clube em uso');
select t.eq('...a fila de avaliação de Classes vem vazia para ele', t.nv($q$select json_array_length(public.classe_avaliacoes_pendentes())$q$), 0);
select t.eq('...RLS: 0 tentativas', t.nv('select count(*) from public.requirement_submissions'), 0);
select t.eq('...RLS: 0 progresso de requisitos (rascunho fechado)', t.nv('select count(*) from public.member_requirements'), 0);
select t.ok('...não abre os anexos', not public.lideranca_ve_comprovacao(:'f1'));
reset role;

select * from t.fim();
rollback;
