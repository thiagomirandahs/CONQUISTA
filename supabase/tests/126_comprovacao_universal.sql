-- Migration 520: COMPROVAÇÃO UNIVERSAL — todo requisito (Classes e Especialidades) aceita um RELATO complementar em texto livre.
-- Prova: qualquer tipo_evidencia aceita relato; requisito simples (tipo 'nenhuma') envia e é avaliado só com o relato;
-- relatório estruturado segue funcionando com relato complementar; relato NUNCA vira obrigação nem substitui a evidência
-- que o requisito já exige; o relato de CADA tentativa fica congelado (tentativa 2 nunca sobrescreve a 1) e aparece no
-- histórico e na fila de avaliação; segurança (autoavaliação, outro clube/usuário, UUID forjado, suspenso, anon, parâmetro
-- inexistente, anexo alheio); compatibilidade (chamadas ANTIGAS e payloads antigos só GANHAM campos); Especialidades (mesmo conceito).
begin;
\ir _lib.sql
\ir _fixtures.sql

\o /dev/null
\ir _fixture_especialidade_teste.sql
\o
insert into public.club_features (club_id, feature, enabled)
select c, f, true from (values (t.id('clube_a')), (t.id('clube_b'))) a(c), (values ('classes'), ('especialidades')) b(f)
on conflict (club_id, feature) do update set enabled = true;

create function t.classe(p text) returns uuid language sql stable security definer as $$
  select c.id from public.classes c join public.curriculum_versions v on v.id = c.curriculum_version_id where v.origem = 'oficial' and v.status = 'publicado' and c.manifesto_id = p $$;
create function t.req(p text) returns uuid language sql stable security definer as $$
  select r.id from public.class_requirements r join public.class_sections s on s.id = r.section_id join public.classes c on c.id = s.class_id
  join public.curriculum_versions v on v.id = c.curriculum_version_id where r.manifesto_id = p and v.origem = 'oficial' and v.status = 'publicado' $$;
create function t.mr(p_user text, p_req text) returns uuid language sql stable security definer as $$
  select mr.id from public.member_requirements mr where mr.usuario_id = t.id(p_user) and mr.requirement_id = t.req(p_req) and mr.club_id = t.id(case when p_user = 'membro_b' then 'clube_b' else 'clube_a' end) $$;
create function t.sub(p_user text, p_req text, p_tent int) returns uuid language sql stable security definer as $$
  select s.id from public.requirement_submissions s where s.member_requirement_id = t.mr(p_user, p_req) and s.tentativa_numero = p_tent $$;
create function t.rel(p_user text, p_req text) returns text language sql stable security definer as $$
  select relato from public.member_requirements where id = t.mr(p_user, p_req) $$;
create function t.relsub(p_user text, p_req text, p_tent int) returns text language sql stable security definer as $$
  select coalesce(relato, '<nulo>') from public.requirement_submissions where id = t.sub(p_user, p_req, p_tent) $$;
create function t.salva(p_req text, p_relato text) returns text language sql as $$
  select public.requisito_relato_salvar(t.req(p_req), p_relato)::text $$;
-- decide a tentativa MAIS RECENTE
create function t.decide(p_user text, p_req text, p_decisao text, p_comentario text default null) returns void language plpgsql as $$
begin
  perform public.requisito_avaliar(t.mr(p_user, p_req), p_decisao, p_comentario,
    (select s.id from public.requirement_submissions s where s.member_requirement_id = t.mr(p_user, p_req) order by s.tentativa_numero desc limit 1));
end $$;

-- ==================== 0) contrato: colunas, privilégios, RPC nova ====================
select t.eq('4 colunas "relato" criadas (progresso e tentativa, Classes e Especialidades)',
  (select count(*) from information_schema.columns where table_schema = 'public' and column_name = 'relato'
     and table_name in ('member_requirements', 'requirement_submissions', 'member_specialty_requirements', 'specialty_requirement_submissions')), 4);
select t.ok('anon NÃO executa requisito_relato_salvar', not has_function_privilege('anon', 'public.requisito_relato_salvar(uuid,text)', 'execute'));
select t.ok('anon NÃO executa especialidade_requisito_relato_salvar', not has_function_privilege('anon', 'public.especialidade_requisito_relato_salvar(uuid,text)', 'execute'));
select t.ok('authenticated executa as duas', has_function_privilege('authenticated', 'public.requisito_relato_salvar(uuid,text)', 'execute')
  and has_function_privilege('authenticated', 'public.especialidade_requisito_relato_salvar(uuid,text)', 'execute'));
select t.ok('o normalizador interno não é executável por authenticated/anon', not has_function_privilege('authenticated', 'public._relato_normalizar(text)', 'execute')
  and not has_function_privilege('anon', 'public._relato_normalizar(text)', 'execute'));
select t.ok('as RPCs antigas continuam com a MESMA assinatura (front antigo)',
  to_regprocedure('public.requisito_salvar(uuid,text,text)') is not null and to_regprocedure('public.requisito_enviar(uuid)') is not null
  and to_regprocedure('public.requisito_relatorio_salvar(uuid,jsonb,jsonb)') is not null and to_regprocedure('public.requisito_historico(uuid)') is not null
  and to_regprocedure('public.especialidade_requisito_enviar(uuid)') is not null and to_regprocedure('public.especialidade_requisito_salvar(uuid,text,text)') is not null);

-- ==================== 1) matrículas ====================
select t.como('membro_a'); select t.pedir_clube('clube_a');
select t.permitido('membro_a inicia a classe Amigo', format($q$select public.classe_iniciar(%L)$q$, t.classe('amigo')));
select t.como('membro_a2'); select t.pedir_clube('clube_a');
select t.permitido('membro_a2 inicia a classe Amigo', format($q$select public.classe_iniciar(%L)$q$, t.classe('amigo')));
select t.como('membro_b'); select t.pedir_clube('clube_b');
select t.permitido('membro_b inicia a classe Amigo (clube B)', format($q$select public.classe_iniciar(%L)$q$, t.classe('amigo')));
select t.como('lider_a'); select t.pedir_clube('clube_a');
select t.permitido('a diretoria inicia a própria classe Amigo', format($q$select public.classe_iniciar(%L)$q$, t.classe('amigo')));
reset role;

-- ==================== 2) QUALQUER tipo_evidencia aceita relato ====================
-- 10 requisitos "nenhuma" sem modelo recebem, só nesta transação, cada um dos 10 tipos aceitos pelo CHECK do catálogo.
update public.class_requirements r set tipo_evidencia = x.tipo
  from (select (array['amigo.I.1','amigo.V.1','amigo.VII.1','amigo.VIII.1','amigo.IX.1','amigo.IV.2','amigo.VIII.2','amigo.I.2','amigo.I.3','amigo.I.6'])[g] as mid,
               (array['nenhuma','texto','foto','arquivo','presenca','atividade','biblia','evento','especialidade','externo'])[g] as tipo
          from generate_series(1, 10) g) x
 where r.manifesto_id = x.mid and r.section_id in (select s.id from public.class_sections s where s.class_id = t.classe('amigo'));
select t.eq('os 10 tipos de evidência estão em uso no cenário',
  (select count(distinct r.tipo_evidencia) from public.class_requirements r where r.section_id in (select s.id from public.class_sections s where s.class_id = t.classe('amigo'))), 10);

select t.como('membro_a'); select t.pedir_clube('clube_a');
select t.eq('os 10 tipos aceitam relato (10 gravações, 10 respostas ok)',
  (select count(*) from unnest(array['amigo.I.1','amigo.V.1','amigo.VII.1','amigo.VIII.1','amigo.IX.1','amigo.IV.2','amigo.VIII.2','amigo.I.2','amigo.I.3','amigo.I.6']) m
    where t.txt(format($q$select (public.requisito_relato_salvar(%L, %L)->>'ok')$q$, t.req(m), 'Relato de ' || m)) = 'true'), 10);
reset role;
select t.eq('cada relato ficou no requisito certo e o requisito passou a "em andamento"',
  (select count(*) from public.member_requirements mr join public.class_requirements r on r.id = mr.requirement_id
    where mr.usuario_id = t.id('membro_a') and mr.relato = 'Relato de ' || r.manifesto_id and mr.status = 'em_andamento' and mr.rascunho_em is not null), 10);
select t.eq('relato é rascunho: NENHUMA tentativa foi criada (nada envia sozinho)',
  (select count(*) from public.requirement_submissions where usuario_id = t.id('membro_a')), 0);
select t.throws('o CHECK recusa relato com mais de 2000 caracteres direto na tabela (defesa em profundidade)', format($q$update public.member_requirements set relato = repeat('a', 2001) where id = %L$q$, t.mr('membro_a', 'amigo.V.1')), 'check');
select t.throws('o CHECK recusa relato só de espaços', format($q$update public.member_requirements set relato = '   ' where id = %L$q$, t.mr('membro_a', 'amigo.V.1')), 'check');
select t.eq('...e evidencia_texto antigo não foi tocado pelo relato',
  (select count(*) from public.member_requirements where usuario_id = t.id('membro_a') and evidencia_texto is not null), 0);

-- ==================== 3) normalização: tamanho, trim, controle, vazio ====================
select t.como('membro_a'); select t.pedir_clube('clube_a');
select t.eq('trim e CRLF viram \n; devolve o texto normalizado',
  t.txt($q$select public.requisito_relato_salvar(t.req('amigo.I.1'), E'  linha 1\r\nlinha 2  \n')->>'relato'$q$), E'linha 1\nlinha 2');
select t.permitido('exatamente 2000 caracteres é aceito', $q$select t.salva('amigo.I.1', repeat('é', 2000))$q$);
select t.throws('2001 caracteres é recusado', $q$select t.salva('amigo.I.1', repeat('a', 2001))$q$, '2000 caracteres');
select t.throws('texto gigante é recusado cedo', $q$select t.salva('amigo.I.1', repeat('a', 30000))$q$, '2000 caracteres');
select t.throws('caractere de controle é recusado', $q$select t.salva('amigo.I.1', E'ola\x01mundo')$q$, 'inválidos');
select t.throws('caractere de direção de texto (bidi) é recusado', $q$select t.salva('amigo.I.1', E'ola‮mundo')$q$, 'inválidos');
select t.permitido('emoji (inclui junção) e acentos passam', $q$select t.salva('amigo.I.1', 'Fiz com a minha unidade 👨‍👩‍👧 — ação ✔️')$q$);
select t.eq('relato só de espaços APAGA o relato (null)', t.txt($q$select (public.requisito_relato_salvar(t.req('amigo.I.1'), E'   \n  ')->>'relato') is null$q$), 'true');
reset role;
select t.eq('...e no banco ficou null', (select (relato is null)::text from public.member_requirements where id = t.mr('membro_a', 'amigo.I.1')), 'true');
select t.eq('...sem apagar o rascunho de outros requisitos', t.rel('membro_a', 'amigo.V.1'), 'Relato de amigo.V.1');

-- ==================== 4) requisito SIMPLES (nenhuma): envia e é avaliado só com o relato ====================
select t.como('membro_a'); select t.pedir_clube('clube_a');
select t.permitido('relato no requisito simples amigo.II.1', $q$select t.salva('amigo.II.1', 'Participei da reunião e ajudei a organizar a sala.')$q$);
select t.permitido('envia SÓ com o relato (nenhuma evidência)', format($q$select public.requisito_enviar(%L)$q$, t.req('amigo.II.1')));
select t.throws('não edita o relato enquanto aguarda avaliação', $q$select t.salva('amigo.II.1', 'mudei')$q$, 'Aguarde a avaliação');
select t.permitido('outro requisito simples (amigo.I.2, com o relato do passo 2) envia', format($q$select public.requisito_enviar(%L)$q$, t.req('amigo.I.2')));
select t.permitido('apagar o relato (null) é permitido', $q$select t.salva('amigo.I.3', null)$q$);
select t.permitido('requisito simples SEM relato continua enviando (nada virou obrigatório)', format($q$select public.requisito_enviar(%L)$q$, t.req('amigo.I.3')));
select t.permitido('requisito com texto antigo (requisito_salvar de 2 args) + relato do rascunho envia junto', format($q$select public.requisito_salvar(%L, 'texto antigo')$q$, t.req('amigo.VIII.1')));
select t.permitido('...envia', format($q$select public.requisito_enviar(%L)$q$, t.req('amigo.VIII.1')));
reset role;
select t.eq('tentativa 1 congelou o relato; o tipo entregue segue "nenhuma"',
  (select tipo_evidencia_entregue || '|' || relato || '|' || (evidencia_texto is null)::text from public.requirement_submissions where id = t.sub('membro_a', 'amigo.II.1', 1)),
  'nenhuma|Participei da reunião e ajudei a organizar a sala.|true');
select t.eq('sem relato a tentativa fica com relato null', t.relsub('membro_a', 'amigo.I.3', 1), '<nulo>');
select t.eq('evidencia_texto antigo e relato são campos DIFERENTES na mesma tentativa',
  (select evidencia_texto || '|' || coalesce(relato, 'nulo') || '|' || tipo_evidencia_entregue from public.requirement_submissions where id = t.sub('membro_a', 'amigo.VIII.1', 1)), 'texto antigo|Relato de amigo.VIII.1|texto');
select t.throws('a tentativa é imutável (relato não muda)', format($q$update public.requirement_submissions set relato = 'adulterado' where id = %L$q$, t.sub('membro_a', 'amigo.II.1', 1)), 'imutável');

select t.como('instrutor_a'); select t.pedir_clube('clube_a');
select t.eq('a fila do avaliador mostra o relato da tentativa',
  t.txt(format($q$select x->>'relato' from json_array_elements(public.classe_avaliacoes_pendentes()) x where x->>'member_requirement_id' = %L$q$, t.mr('membro_a', 'amigo.II.1'))),
  'Participei da reunião e ajudei a organizar a sala.');
select t.eq('...e null onde não houve relato', t.txt(format($q$select coalesce(x->>'relato', 'nulo') from json_array_elements(public.classe_avaliacoes_pendentes()) x where x->>'member_requirement_id' = %L$q$, t.mr('membro_a', 'amigo.I.3'))), 'nulo');
select t.permitido('instrutor aprova SÓ com o relato', format($q$select t.decide('membro_a', 'amigo.II.1', 'aprovado', 'Boa participação.')$q$));
reset role;
select t.eq('requisito aprovado (status)', (select status from public.member_requirements where id = t.mr('membro_a', 'amigo.II.1')), 'aprovado');
select t.como('membro_a'); select t.pedir_clube('clube_a');
select t.throws('depois de aprovado o dono NÃO grava relato', $q$select t.salva('amigo.II.1', 'tarde demais')$q$, 'já foi aprovado');
reset role;
select t.eq('...e o relato aprovado não mudou', t.rel('membro_a', 'amigo.II.1'), 'Participei da reunião e ajudei a organizar a sala.');

-- ==================== 5) relatório ESTRUTURADO + relato complementar; devolução → correção → reenvio ====================
select jsonb_build_object('qualidades', (select jsonb_agg('qualidade ' || g) from generate_series(1, 10) g),
                          'situacoes', (select jsonb_agg('situação ' || g) from generate_series(1, 4) g))::text as c1 \gset
select jsonb_build_object('qualidades', (select jsonb_agg('NOVA qualidade ' || g) from generate_series(1, 10) g),
                          'situacoes', (select jsonb_agg('nova situação ' || g) from generate_series(1, 4) g))::text as c2 \gset
select t.como('membro_a'); select t.pedir_clube('clube_a');
select t.permitido('formulário estruturado salvo', format($q$select public.requisito_relatorio_salvar(%L, %L::jsonb, '[]'::jsonb)$q$, t.req('amigo.IV.1'), :'c1'));
select t.permitido('relato complementar salvo no MESMO requisito', $q$select t.salva('amigo.IV.1', 'Primeiro relato: fiz em casa com meu pai.')$q$);
select t.eq('o dono reabre o formulário e recebe rascunho + relato + horário',
  t.txt(format($q$select (f->'rascunho'->'qualidades'->>0) || '|' || (f->>'relato') || '|' || ((f->>'rascunho_em') is not null)::text from (select public.requisito_formulario(%L) f) s$q$, t.req('amigo.IV.1'))),
  'qualidade 1|Primeiro relato: fiz em casa com meu pai.|true');
select t.eq('...e classe_formularios traz o relato do requisito com modelo',
  t.txt(format($q$select (public.classe_formularios(%L)->>%L)::json->>'relato'$q$, (select id from public.member_classes where usuario_id = t.id('membro_a') and club_id = t.id('clube_a') and class_id = t.classe('amigo')), t.req('amigo.IV.1')::text)),
  'Primeiro relato: fiz em casa com meu pai.');
select t.permitido('envia (tentativa 1)', format($q$select public.requisito_enviar(%L)$q$, t.req('amigo.IV.1')));
reset role;
select t.eq('tentativa 1: conteúdo estruturado E relato congelados',
  (select jsonb_array_length(conteudo -> 'qualidades') || '|' || relato || '|' || tipo_evidencia_entregue from public.requirement_submissions where id = t.sub('membro_a', 'amigo.IV.1', 1)),
  '10|Primeiro relato: fiz em casa com meu pai.|relatorio');
select t.ok('o resumo legível (evidencia_texto) NÃO mistura o relato', (select evidencia_texto not like '%fiz em casa%' from public.requirement_submissions where id = t.sub('membro_a', 'amigo.IV.1', 1)));

select t.como('instrutor_a'); select t.pedir_clube('clube_a');
select t.permitido('instrutor devolve com comentário', format($q$select t.decide('membro_a', 'amigo.IV.1', 'correcao_solicitada', 'Conte melhor como foi.')$q$));
select t.como('membro_a'); select t.pedir_clube('clube_a');
select t.eq('depois da devolução o dono ainda vê o relato da tentativa 1 como rascunho (e o comentário)',
  t.txt(format($q$select (f->>'relato') || '|' || (f->'ultima_avaliacao'->>'comentario') from (select public.requisito_formulario(%L) f) s$q$, t.req('amigo.IV.1'))),
  'Primeiro relato: fiz em casa com meu pai.|Conte melhor como foi.');
select t.permitido('relato corrigido (volta a "em andamento")', $q$select t.salva('amigo.IV.1', 'Segundo relato: refiz sozinho e anotei tudo.')$q$);
select t.permitido('conteúdo corrigido', format($q$select public.requisito_relatorio_salvar(%L, %L::jsonb, '[]'::jsonb)$q$, t.req('amigo.IV.1'), :'c2'));
select t.permitido('reenvia (tentativa 2)', format($q$select public.requisito_enviar(%L)$q$, t.req('amigo.IV.1')));
reset role;
select t.eq('agora são 2 tentativas', (select count(*) from public.requirement_submissions where member_requirement_id = t.mr('membro_a', 'amigo.IV.1')), 2);
select t.eq('tentativa 1 continua com o relato ORIGINAL', t.relsub('membro_a', 'amigo.IV.1', 1), 'Primeiro relato: fiz em casa com meu pai.');
select t.eq('tentativa 2 tem o relato NOVO', t.relsub('membro_a', 'amigo.IV.1', 2), 'Segundo relato: refiz sozinho e anotei tudo.');
select t.eq('tentativa 1 continua com o conteúdo ORIGINAL', (select conteudo -> 'qualidades' ->> 0 from public.requirement_submissions where id = t.sub('membro_a', 'amigo.IV.1', 1)), 'qualidade 1');

select t.como('instrutor_a'); select t.pedir_clube('clube_a');
select t.eq('a fila mostra o relato da tentativa MAIS RECENTE', t.txt(format($q$select x->>'relato' from json_array_elements(public.classe_avaliacoes_pendentes()) x where x->>'member_requirement_id' = %L$q$, t.mr('membro_a', 'amigo.IV.1'))),
  'Segundo relato: refiz sozinho e anotei tudo.');
select t.permitido('instrutor aprova a tentativa 2', format($q$select t.decide('membro_a', 'amigo.IV.1', 'aprovado', 'Agora sim.')$q$));
select t.eq('HISTÓRICO (liderança): relato E conteúdo de cada tentativa',
  (select string_agg((x ->> 'tentativa_numero') || ':' || (x ->> 'decisao') || ':' || (x ->> 'relato') || ':' || (x -> 'conteudo' -> 'qualidades' ->> 0), ' | ' order by (x ->> 'tentativa_numero')::int)
     from json_array_elements(public.requisito_historico(t.mr('membro_a', 'amigo.IV.1')) -> 'tentativas') x),
  '1:correcao_solicitada:Primeiro relato: fiz em casa com meu pai.:qualidade 1 | 2:aprovado:Segundo relato: refiz sozinho e anotei tudo.:NOVA qualidade 1');
select t.como('membro_a'); select t.pedir_clube('clube_a');
select t.eq('HISTÓRICO (o próprio dono) também traz o relato de cada tentativa',
  (select string_agg(x ->> 'relato', ' | ' order by (x ->> 'tentativa_numero')::int) from json_array_elements(public.requisito_historico(t.mr('membro_a', 'amigo.IV.1')) -> 'tentativas') x),
  'Primeiro relato: fiz em casa com meu pai. | Segundo relato: refiz sozinho e anotei tudo.');
reset role;
select t.eq('AUDITORIA da avaliação intacta (quem, papel, quando)',
  (select count(*) from public.requirement_approvals a where a.member_requirement_id = t.mr('membro_a', 'amigo.IV.1') and a.avaliado_por = t.id('instrutor_a') and a.avaliado_papel = 'instrutor' and a.submission_id is not null), 2);

-- relato que já estava no rascunho vai junto no reenvio sem ser editado de novo (não some, não vira obrigação)
select t.como('membro_a2'); select t.pedir_clube('clube_a');
select t.permitido('membro_a2: relato + envio de requisito simples', $q$select t.salva('amigo.II.1', 'a2 relato')$q$);
select t.permitido('...envia', format($q$select public.requisito_enviar(%L)$q$, t.req('amigo.II.1')));
select t.como('instrutor_a'); select t.pedir_clube('clube_a');
select t.permitido('...devolvida', format($q$select t.decide('membro_a2', 'amigo.II.1', 'correcao_solicitada', 'Detalhe mais.')$q$));
select t.como('membro_a2'); select t.pedir_clube('clube_a');
select t.permitido('reenvia SEM editar o relato', format($q$select public.requisito_enviar(%L)$q$, t.req('amigo.II.1')));
reset role;
select t.eq('as duas tentativas têm o mesmo relato (cada uma congelou o seu)', t.relsub('membro_a2', 'amigo.II.1', 1) || '|' || t.relsub('membro_a2', 'amigo.II.1', 2), 'a2 relato|a2 relato');

-- ==================== 6) relato NÃO substitui a evidência que o requisito já exige ====================
select t.como('membro_a'); select t.pedir_clube('clube_a');
select t.permitido('relato em requisito de FOTO obrigatória (amigo.III.1)', $q$select t.salva('amigo.III.1', 'Tirei a foto no sábado.')$q$);
select t.throws('...mas sem a foto o envio continua recusado (relato não vira a evidência)', format($q$select public.requisito_enviar(%L)$q$, t.req('amigo.III.1')), 'exige uma evidência');
select t.permitido('relato em requisito de TEXTO obrigatório sem rascunho (modo compatível, amigo.I.4)', $q$select t.salva('amigo.I.4', 'Relato complementar.')$q$);
select t.throws('...sem o texto de comprovação o envio continua recusado', format($q$select public.requisito_enviar(%L)$q$, t.req('amigo.I.4')), 'exige uma evidência');
select t.permitido('chamada ANTIGA (3 args) de requisito_salvar continua funcionando', format($q$select public.requisito_salvar(%L, 'texto de comprovação antigo', null)$q$, t.req('amigo.I.4')));
select t.permitido('chamada antiga com 1 arg só do texto também', format($q$select public.requisito_salvar(%L, 'texto de comprovação antigo 2')$q$, t.req('amigo.I.4')));
select t.permitido('modo compatível: texto + relato enviam juntos', format($q$select public.requisito_enviar(%L)$q$, t.req('amigo.I.4')));
reset role;
select t.eq('modo compatível: evidencia_texto e relato ficam SEPARADOS e coerentes',
  (select tipo_evidencia_entregue || '|' || evidencia_texto || '|' || relato from public.requirement_submissions where id = t.sub('membro_a', 'amigo.I.4', 1)),
  'texto|texto de comprovação antigo 2|Relato complementar.');
select t.ok('requisito_salvar (antigo) agora marca o horário do rascunho', (select rascunho_em is not null from public.member_requirements where id = t.mr('membro_a', 'amigo.I.4')));

-- ==================== 7) anexos: regra existente intacta ====================
insert into public.requisito_modelos (alvo, chave, versao, schema, categoria, familia) values
  ('classe', 'amigo.VI.1', 1, '{"versao":1,"campos":[{"chave":"local","tipo":"texto_curto","rotulo":"Local","obrigatorio":true},{"chave":"fotos","tipo":"anexos","rotulo":"Fotos","obrigatorio":false,"max":2}]}'::jsonb, 'TESTE', 'T1');
select t.id('membro_b')::text || '/requisitos/do-colega.jpg' as f_alheio \gset
select t.id('membro_a')::text || '/requisitos/meu.jpg' as f_meu \gset
insert into storage.objects (bucket_id, name, owner_id) values ('comprovacoes', :'f_alheio', t.id('membro_b')::text), ('comprovacoes', :'f_meu', t.id('membro_a')::text);
select t.como('membro_a'); select t.pedir_clube('clube_a');
select t.permitido('relato no requisito com modelo + anexos opcionais', $q$select t.salva('amigo.VI.1', 'Relato junto com a foto.')$q$);
select t.throws('arquivo de OUTRO usuário continua recusado (mesmo com relato salvo)',
  format($q$select public.requisito_relatorio_salvar(%L, '{"local":"x"}'::jsonb, %L::jsonb)$q$, t.req('amigo.VI.1'), jsonb_build_array(jsonb_build_object('campo', 'fotos', 'path', :'f_alheio'))::text), 'não é seu');
select t.permitido('arquivo MEU + formulário + relato: tudo junto', format($q$select public.requisito_relatorio_salvar(%L, '{"local":"x"}'::jsonb, %L::jsonb)$q$, t.req('amigo.VI.1'), jsonb_build_array(jsonb_build_object('campo', 'fotos', 'path', :'f_meu'))::text));
select t.permitido('...envia', format($q$select public.requisito_enviar(%L)$q$, t.req('amigo.VI.1')));
reset role;
select t.eq('a tentativa guardou formulário, anexo E relato',
  (select (conteudo ->> 'local') || '|' || jsonb_array_length(anexos) || '|' || relato from public.requirement_submissions where id = t.sub('membro_a', 'amigo.VI.1', 1)), 'x|1|Relato junto com a foto.');

-- ==================== 8) segurança ====================
-- autoavaliação
select t.como('lider_a'); select t.pedir_clube('clube_a');
select t.permitido('a diretoria salva relato no próprio requisito', $q$select t.salva('amigo.II.1', 'meu relato de diretoria')$q$);
select t.permitido('...envia', format($q$select public.requisito_enviar(%L)$q$, t.req('amigo.II.1')));
select t.throws('...e NÃO aprova o próprio requisito', format($q$select public.requisito_avaliar(%L, 'aprovado', null)$q$, t.mr('lider_a', 'amigo.II.1')), 'próprio requisito');
select t.como('instrutor_a'); select t.pedir_clube('clube_a');
select t.permitido('outra pessoa da liderança avalia normalmente', format($q$select public.requisito_avaliar(%L, 'aprovado', null)$q$, t.mr('lider_a', 'amigo.II.1')));
reset role;

-- outro usuário / outro clube / UUID forjado
select t.como('membro_b'); select t.pedir_clube('clube_b');
select t.permitido('membro_b grava o SEU relato no mesmo requisito do currículo (linha dele, no clube B)', $q$select t.salva('amigo.III.2', 'relato do B')$q$);
select t.throws('UUID forjado (aleatório) é "não encontrado"', $q$select public.requisito_relato_salvar(gen_random_uuid(), 'x')$q$, 'não encontrado');
select t.throws('p_requirement_id nulo é recusado', $q$select public.requisito_relato_salvar(null, 'x')$q$, 'não encontrado');
select t.throws('não lê o histórico do progresso de OUTRO usuário/clube', format($q$select public.requisito_historico(%L)$q$, t.mr('membro_a', 'amigo.IV.1')), 'não encontrado');
select t.eq('não enxerga o relato do colega nas tabelas (RLS)', t.nv($q$select count(*) from public.member_requirements where relato like '%Primeiro relato%'$q$), 0);
select t.eq('...nem as tentativas dele', t.nv($q$select count(*) from public.requirement_submissions where relato is not null and usuario_id <> auth.uid()$q$), 0);
reset role;
select t.eq('o relato do membro_a em amigo.III.2 segue sem relato; o do membro_b ficou só dele',
  coalesce(t.rel('membro_a', 'amigo.III.2'), 'nulo') || '|' || t.rel('membro_b', 'amigo.III.2'), 'nulo|relato do B');
select t.como('membro_a'); select t.pedir_clube('clube_b');
select t.throws('pedir o clube B sem vínculo lá: "Sem clube em uso" (o servidor só age no clube do vínculo)', $q$select t.salva('amigo.III.2', 'invasor')$q$, 'Sem clube em uso');
reset role;
select t.eq('...o relato do membro_b (clube B) ficou intacto', t.rel('membro_b', 'amigo.III.2'), 'relato do B');
select t.como('membro_a2'); select t.pedir_clube('clube_a');
select t.throws('colega do mesmo clube não lê o histórico do progresso alheio', format($q$select public.requisito_historico(%L)$q$, t.mr('membro_a', 'amigo.IV.1')), 'não encontrado');
select t.eq('...nem vê relato alheio nas tabelas', t.nv($q$select count(*) from public.member_requirements where relato = 'Relato de amigo.V.1'$q$), 0);
reset role;
select t.como('lider_b'); select t.pedir_clube('clube_b');
select t.throws('liderança de OUTRO clube não lê o histórico', format($q$select public.requisito_historico(%L)$q$, t.mr('membro_a', 'amigo.IV.1')), 'não encontrado');
select t.eq('...e a fila dela não traz nada do clube A', t.nv($q$select count(*) from json_array_elements(public.classe_avaliacoes_pendentes()) x where x->>'relato' like '%Segundo relato%'$q$), 0);
reset role;

-- clube sem o recurso "classes" ligado
update public.club_features set enabled = false where club_id = t.id('clube_b') and feature = 'classes';
select t.como('membro_b'); select t.pedir_clube('clube_b');
select t.throws('recurso Classes desligado no clube: recusado', $q$select t.salva('amigo.III.2', 'x')$q$);
reset role;
update public.club_features set enabled = true where club_id = t.id('clube_b') and feature = 'classes';

-- vínculo suspenso / encerrado
update public.organization_memberships set status = 'suspenso' where user_id = t.id('membro_b') and organizational_unit_id = t.id('clube_b');
select t.como('membro_b'); select t.pedir_clube('clube_b');
select t.throws('membro SUSPENSO não grava relato', $q$select t.salva('amigo.III.2', 'suspenso')$q$);
reset role;
update public.organization_memberships set status = 'encerrado', ends_at = now() where user_id = t.id('membro_b') and organizational_unit_id = t.id('clube_b');
select t.como('membro_b'); select t.pedir_clube('clube_b');
select t.throws('membro com vínculo ENCERRADO (inativo) não grava relato', $q$select t.salva('amigo.III.2', 'encerrado')$q$);
reset role;
select t.eq('...e o relato dele ficou como estava', t.rel('membro_b', 'amigo.III.2'), 'relato do B');

-- anon e parâmetros inexistentes
select t.como_anon();
select t.throws('anon NÃO executa requisito_relato_salvar', format($q$select public.requisito_relato_salvar(%L, 'x')$q$, t.req('amigo.III.2')), 'permission denied');
reset role;
select t.como('membro_a'); select t.pedir_clube('clube_a');
select t.throws('parâmetro inexistente (p_club_id) falha: o clube vem só do servidor',
  format($q$select public.requisito_relato_salvar(p_requirement_id => %L, p_relato => 'x', p_club_id => %L)$q$, t.req('amigo.III.2'), t.id('clube_b')), 'does not exist');
select t.throws('parâmetro inexistente (p_usuario_id) falha',
  format($q$select public.requisito_relato_salvar(p_requirement_id => %L, p_relato => 'x', p_usuario_id => %L)$q$, t.req('amigo.III.2'), t.id('membro_b')), 'does not exist');
select t.bloqueado('escrita direta na tabela é negada (só pela RPC)', $q$update public.member_requirements set relato = 'direto'$q$);

-- ==================== 9) compatibilidade: payloads antigos só GANHAM campos ====================
select t.ok('requisito_formulario: todas as chaves antigas continuam',
  (to_jsonb(public.requisito_formulario(t.req('amigo.IV.1'))) ?& array['tem_formulario','modelo','member_requirement_id','status','rascunho','rascunho_em','anexos','tentativas','ultima_avaliacao']));
select t.ok('requisito_formulario de requisito SEM modelo também devolve relato e tem_formulario=false',
  (to_jsonb(public.requisito_formulario(t.req('amigo.III.2'))) ? 'relato') and (to_jsonb(public.requisito_formulario(t.req('amigo.V.1')))->>'tem_formulario') = 'false');
select t.ok('requisito_historico: chaves antigas por tentativa continuam',
  (select bool_and(to_jsonb(x) ?& array['submission_id','tentativa_numero','tipo_evidencia','evidencia_texto','evidencia_path','conteudo','anexos','modelo_versao','enviado_em','decisao','avaliado_por_nome','avaliado_papel','comentario','avaliado_em','relato'])
     from json_array_elements(public.requisito_historico(t.mr('membro_a', 'amigo.IV.1')) -> 'tentativas') x));
select t.ok('minha_classe: requisito ganha relato/rascunho_em e mantém os campos antigos',
  (select bool_and(to_jsonb(r) ?& array['id','codigo','descricao','tipo_evidencia','evidencia_obrigatoria','member_requirement_id','status','evidencia_texto','evidencia_path','enviado_em','bloqueios','avaliacoes','relato','rascunho_em'])
     from json_array_elements(public.minha_classe()->'secoes') s, json_array_elements(s->'requisitos') r));
select t.eq('minha_classe devolve o relato do requisito para o dono (inclusive requisito simples)',
  t.txt($q$select r->>'relato' from json_array_elements(public.minha_classe()->'secoes') s, json_array_elements(s->'requisitos') r where r->>'manifesto_id' = 'amigo.V.1'$q$), 'Relato de amigo.V.1');
reset role;
select t.como('instrutor_a'); select t.pedir_clube('clube_a');
select t.ok('classe_avaliacoes_pendentes: chaves antigas continuam',
  (select coalesce(bool_and(to_jsonb(x) ?& array['member_requirement_id','submission_id','tentativa_numero','usuario_id','usuario_nome','classe_nome','requisito_codigo','tipo_evidencia','evidencia_texto','evidencia_path','conteudo','anexos','modelo','enviado_em','escolha','bloqueios','unidade_nome','relato']), false)
     from json_array_elements(public.classe_avaliacoes_pendentes()) x));
reset role;

-- ==================== 10) ESPECIALIDADES: mesmo conceito, aditivo ====================
create function t.esp() returns uuid language sql stable security definer as $$ select id from public.specialties where codigo = 'TE-001' $$;
create function t.sr(p_ordem int) returns uuid language sql stable security definer as $$
  select r.id from public.specialty_requirements r where r.specialty_id = t.esp() and r.codigo = p_ordem::text $$;
create function t.msr(p_user text, p_ordem int) returns uuid language sql stable security definer as $$
  select m.id from public.member_specialty_requirements m where m.usuario_id = t.id(p_user) and m.specialty_requirement_id = t.sr(p_ordem) $$;
create function t.ssub(p_user text, p_ordem int, p_tent int) returns uuid language sql stable security definer as $$
  select s.id from public.specialty_requirement_submissions s where s.member_specialty_requirement_id = t.msr(p_user, p_ordem) and s.tentativa_numero = p_tent $$;
create function t.erel(p_user text, p_ordem int, p_tent int) returns text language sql stable security definer as $$
  select coalesce(relato, '<nulo>') from public.specialty_requirement_submissions where id = t.ssub(p_user, p_ordem, p_tent) $$;
create function t.esalva(p_ordem int, p_relato text) returns text language sql as $$
  select public.especialidade_requisito_relato_salvar(t.sr(p_ordem), p_relato)::text $$;
create function t.edecide(p_user text, p_ordem int, p_decisao text, p_comentario text default null) returns void language plpgsql as $$
begin
  perform public.especialidade_requisito_avaliar(t.msr(p_user, p_ordem), p_decisao, p_comentario,
    (select s.id from public.specialty_requirement_submissions s where s.member_specialty_requirement_id = t.msr(p_user, p_ordem) order by s.tentativa_numero desc limit 1));
end $$;

select t.como('membro_a'); select t.pedir_clube('clube_a');
select t.permitido('membro_a inicia a especialidade', format($q$select public.especialidade_iniciar(%L)$q$, t.esp()));
select t.como('membro_b'); select t.pedir_clube('clube_b');
reset role;
update public.organization_memberships set status = 'ativo', ends_at = null where user_id = t.id('membro_b') and organizational_unit_id = t.id('clube_b');
select t.como('membro_b'); select t.pedir_clube('clube_b');
select t.permitido('membro_b inicia a especialidade (clube B)', format($q$select public.especialidade_iniciar(%L)$q$, t.esp()));
select t.como('membro_a'); select t.pedir_clube('clube_a');
select t.permitido('especialidade: relato salvo (requisito de leitura)', $q$select t.esalva(1, 'Li o texto duas vezes e resumi para minha unidade.')$q$);
select t.eq('...volta o relato normalizado e o horário',
  t.txt($q$select (public.especialidade_requisito_relato_salvar(t.sr(1), E'  Li o texto duas vezes e resumi para minha unidade.  ')->>'relato') || '|' || ((public.especialidade_requisito_relato_salvar(t.sr(1), 'Li o texto duas vezes e resumi para minha unidade.')->>'rascunho_em') is not null)::text$q$),
  'Li o texto duas vezes e resumi para minha unidade.|true');
select t.throws('especialidade: 2001 caracteres é recusado', $q$select t.esalva(1, repeat('a', 2001))$q$, '2000 caracteres');
select t.throws('especialidade: caractere de controle é recusado', $q$select t.esalva(1, E'a\x02b')$q$, 'inválidos');
select t.eq('minha_especialidade devolve relato e rascunho_em por requisito',
  t.txt($q$select (r->>'relato') || '|' || ((r->>'rascunho_em') is not null)::text from json_array_elements(public.minha_especialidade()->'requisitos') r where r->>'codigo' = '1'$q$),
  'Li o texto duas vezes e resumi para minha unidade.|true');
select t.eq('...nenhuma tentativa criada por salvar o relato', t.nv(format($q$select count(*) from public.specialty_requirement_submissions where member_specialty_requirement_id = %L$q$, t.msr('membro_a', 1))), 0);
select t.permitido('especialidade: envia (formulário + relato)', format($q$select public.especialidade_requisito_relatorio_salvar(%L, '{"li":true}'::jsonb, '[]'::jsonb)$q$, t.sr(1)));
select t.permitido('...envio (tentativa 1)', format($q$select public.especialidade_requisito_enviar(%L)$q$, t.sr(1)));
select t.throws('especialidade: não edita o relato enquanto aguarda', $q$select t.esalva(1, 'mudei')$q$, 'Aguarde a avaliação');
select t.permitido('especialidade: requisito SEM relato envia (nada obrigatório)', format($q$select public.especialidade_requisito_relatorio_salvar(%L, '{"resposta":"minha resposta"}'::jsonb, '[]'::jsonb)$q$, t.sr(2)));
select t.permitido('...envio', format($q$select public.especialidade_requisito_enviar(%L)$q$, t.sr(2)));
reset role;
select t.eq('especialidade: tentativa 1 congelou o relato', t.erel('membro_a', 1, 1), 'Li o texto duas vezes e resumi para minha unidade.');
select t.eq('especialidade: sem relato a tentativa fica null', t.erel('membro_a', 2, 1), '<nulo>');
select t.throws('especialidade: tentativa imutável (relato)', format($q$update public.specialty_requirement_submissions set relato = 'x' where id = %L$q$, t.ssub('membro_a', 1, 1)), 'imutável');
select t.como('instrutor_a'); select t.pedir_clube('clube_a');
select t.eq('especialidade: a fila mostra o relato', t.txt(format($q$select x->>'relato' from json_array_elements(public.especialidade_avaliacoes_pendentes()) x where x->>'member_specialty_requirement_id' = %L$q$, t.msr('membro_a', 1))),
  'Li o texto duas vezes e resumi para minha unidade.');
select t.permitido('especialidade: devolve com comentário', format($q$select t.edecide('membro_a', 1, 'correcao_solicitada', 'Resuma em 3 linhas.')$q$));
select t.como('membro_a'); select t.pedir_clube('clube_a');
select t.permitido('especialidade: corrige o relato', $q$select t.esalva(1, 'Resumo em 3 linhas: ...')$q$);
select t.permitido('especialidade: reenvia (tentativa 2)', format($q$select public.especialidade_requisito_enviar(%L)$q$, t.sr(1)));
reset role;
select t.eq('especialidade: tentativa 1 intacta, tentativa 2 com o relato novo', t.erel('membro_a', 1, 1) || ' || ' || t.erel('membro_a', 1, 2),
  'Li o texto duas vezes e resumi para minha unidade. || Resumo em 3 linhas: ...');
select t.como('lider_a'); select t.pedir_clube('clube_a');
select t.permitido('especialidade: diretoria aprova a tentativa 2', format($q$select t.edecide('membro_a', 1, 'aprovado', 'Ok.')$q$));
select t.eq('especialidade: histórico com o relato de cada tentativa',
  (select string_agg((x ->> 'tentativa_numero') || ':' || (x ->> 'decisao') || ':' || (x ->> 'relato'), ' | ' order by (x ->> 'tentativa_numero')::int)
     from json_array_elements(public.especialidade_historico(t.msr('membro_a', 1)) -> 'tentativas') x),
  '1:correcao_solicitada:Li o texto duas vezes e resumi para minha unidade. | 2:aprovado:Resumo em 3 linhas: ...');
select t.como('membro_a'); select t.pedir_clube('clube_a');
select t.throws('especialidade: aprovado não aceita novo relato', $q$select t.esalva(1, 'tarde')$q$, 'já foi aprovado');
reset role;
select t.como('membro_b'); select t.pedir_clube('clube_b');
select t.permitido('especialidade: membro_b grava o SEU relato', $q$select t.esalva(1, 'relato do B na especialidade')$q$);
select t.throws('especialidade: UUID forjado é "não encontrado"', $q$select public.especialidade_requisito_relato_salvar(gen_random_uuid(), 'x')$q$, 'não encontrado');
select t.throws('especialidade: não lê o histórico do progresso alheio', format($q$select public.especialidade_historico(%L)$q$, t.msr('membro_a', 1)), 'não encontrado');
select t.throws('especialidade: parâmetro inexistente (p_club_id) falha',
  format($q$select public.especialidade_requisito_relato_salvar(p_specialty_requirement_id => %L, p_relato => 'x', p_club_id => %L)$q$, t.sr(1), t.id('clube_a')), 'does not exist');
reset role;
select t.eq('especialidade: o relato do membro_a não foi tocado pelo membro_b', (select relato from public.member_specialty_requirements where id = t.msr('membro_a', 1)), 'Resumo em 3 linhas: ...');
select t.como_anon();
select t.throws('especialidade: anon não executa', format($q$select public.especialidade_requisito_relato_salvar(%L, 'x')$q$, t.sr(1)), 'permission denied');
reset role;
select t.como('lider_a'); select t.pedir_clube('clube_a');
select t.permitido('a diretoria inicia a especialidade e grava relato no próprio requisito', format($q$select public.especialidade_iniciar(%L)$q$, t.esp()));
select t.permitido('...relato', $q$select t.esalva(3, 'meu relato')$q$);
select t.ok('especialidade: payload antigo de minha_especialidade só ganhou campos (relato)',
  (select bool_and(to_jsonb(r) ?& array['id','codigo','descricao','tipo_evidencia','evidencia_obrigatoria','modelo','grupo','depende_de','prazo_dias','bloqueios','member_specialty_requirement_id','status','evidencia_texto','evidencia_path','enviado_em','rascunho','rascunho_em','anexos','tentativas','avaliacoes','relato'])
     from json_array_elements(public.minha_especialidade()->'requisitos') r));
reset role;
select * from t.fim();
rollback;
