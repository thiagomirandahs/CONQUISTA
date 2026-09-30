-- Depois de aplicar 510–513 sobre os dados ANTIGOS de pre.sql: nada pode ter mudado de significado e o motor novo tem que
-- conviver com o que já existia (roda no mesmo banco, com ROLLBACK).
\set ON_ERROR_STOP on
begin;
truncate t.res;

select t.eq('os 71 modelos existem agora', (select count(*) from public.requisito_modelos), 71);
-- ---- comprovações ANTIGAS mantêm o significado ----
select t.como('membro_a'); select t.pedir_clube('clube_a');
select t.eq('histórico do amigo.IV.1 (agora COM modelo): 2 tentativas antigas do tipo texto, sem conteúdo estruturado, mesmas decisões e comentários',
  (select string_agg((x ->> 'tentativa_numero') || ':' || (x ->> 'tipo_evidencia') || ':' || coalesce(x ->> 'conteudo', 'nulo') || ':' || (x ->> 'decisao') || ':' || (x ->> 'avaliado_papel') || ':' || coalesce(x ->> 'comentario', ''), ' | ' order by (x ->> 'tentativa_numero')::int)
     from json_array_elements(public.requisito_historico(t.mr('membro_a', 'amigo.IV.1')) -> 'tentativas') x),
  '1:texto:nulo:correcao_solicitada:instrutor:Refaça com exemplos. | 2:texto:nulo:aprovado:diretoria:Muito bom (antigo).');
select t.eq('...e o TEXTO das duas tentativas segue intacto',
  (select string_agg(x ->> 'evidencia_texto', ' | ' order by (x ->> 'tentativa_numero')::int) from json_array_elements(public.requisito_historico(t.mr('membro_a', 'amigo.IV.1')) -> 'tentativas') x),
  'Minhas 10 qualidades de um bom amigo (texto ANTIGO). | Versão corrigida ANTIGA com 4 exemplos.');
select t.eq('requisito aprovado antes continua aprovado', (select status from public.member_requirements where id = t.mr('membro_a', 'amigo.IV.1')), 'aprovado');
select t.eq('o formulário desse requisito reconhece que já foi aprovado (não reabre edição)', t.txt(format($q$select (public.requisito_formulario(%L)->>'status')$q$, t.req('amigo.IV.1'))), 'aprovado');
select t.eq('a última avaliação antiga aparece no formulário', t.txt(format($q$select (public.requisito_formulario(%L)->'ultima_avaliacao'->>'comentario')$q$, t.req('amigo.IV.1'))), 'Muito bom (antigo).');
reset role;
-- ---- pendente antiga: o avaliador vê, e aprova normalmente ----
select t.como('instrutor_a'); select t.pedir_clube('clube_a');
select t.eq('a fila mostra a tentativa ANTIGA pendente do amigo.II.2 com o texto e SEM conteúdo estruturado nem modelo',
  t.txt($q$select (x ->> 'evidencia_texto') || '|' || coalesce(x ->> 'conteudo', 'nulo') || '|' || coalesce(x -> 'modelo' ->> 'familia', 'sem-modelo') from json_array_elements(public.classe_avaliacoes_pendentes()) x where (x ->> 'evidencia_texto') like 'Explico os versículos%' limit 1$q$),
  'Explico os versículos (texto ANTIGO pendente).|nulo|sem-modelo');
select t.eq('a foto antiga pendente (amigo.VI.1) continua com o caminho',
  t.txt($q$select (x ->> 'evidencia_path') from json_array_elements(public.classe_avaliacoes_pendentes()) x where x ->> 'evidencia_path' like '%antiga-1.png' limit 1$q$),
  t.id('membro_a')::text || '/requisitos/antiga-1.png');
select t.permitido('avaliar a pendente antiga pelo caminho de SEMPRE (3 argumentos) continua funcionando', format($q$select public.requisito_avaliar(%L, 'aprovado', 'ok depois do upgrade')$q$, t.mr('membro_a', 'amigo.II.2')));
reset role;
select t.eq('...e foi registrada na tentativa antiga', (select count(*) from public.requirement_approvals a join public.requirement_submissions s on s.id = a.submission_id where s.member_requirement_id = t.mr('membro_a', 'amigo.II.2')), 1);
-- ---- rascunho antigo (texto) segue valendo e o envio antigo funciona (MODO COMPATÍVEL) ----
select t.eq('o rascunho antigo continua no requisito', (select evidencia_texto from public.member_requirements where id = t.mr('membro_a', 'amigo.V.2')), 'Rascunho antigo do compromisso de vida saudável.');
select t.como('membro_a'); select t.pedir_clube('clube_a');
select t.eq('o formulário novo do amigo.V.2 nasce SEM rascunho estruturado (o antigo não é convertido nem apagado)', t.txt(format($q$select coalesce((public.requisito_formulario(%L)->'rascunho')::text, 'nulo')$q$, t.req('amigo.V.2'))), 'null');
select t.permitido('quem tinha rascunho antigo ainda envia pelo caminho antigo', format($q$select public.requisito_enviar(%L)$q$, t.req('amigo.V.2')));
reset role;
select t.eq('...e a tentativa é do tipo antigo', (select tipo_evidencia_entregue || '|' || coalesce(conteudo::text, 'nulo') from public.requirement_submissions where member_requirement_id = t.mr('membro_a', 'amigo.V.2')), 'texto|nulo');
-- ---- o motor novo convive: outro requisito da MESMA matrícula usa o formulário ----
select t.como('membro_a'); select t.pedir_clube('clube_a');
select t.permitido('formulário novo no amigo.VIII.3 da mesma matrícula antiga', format($q$select public.requisito_relatorio_salvar(%L, %L::jsonb, '[]'::jsonb)$q$, t.req('amigo.VIII.3'),
  (select jsonb_build_object('regras', (select jsonb_agg('regra ' || g) from generate_series(1, 10) g), 'perdido', 'Fico parado e uso o apito.')::text)));
select t.permitido('...e envia', format($q$select public.requisito_enviar(%L)$q$, t.req('amigo.VIII.3')));
reset role;
select t.eq('...e a tentativa nova guardou o conteúdo estruturado', (select tipo_evidencia_entregue || '|' || jsonb_array_length(conteudo -> 'regras') from public.requirement_submissions where member_requirement_id = t.mr('membro_a', 'amigo.VIII.3')), 'relatorio|10');
-- ---- outro clube ficou como estava ----
select t.eq('clube B: a submissão antiga continua com o mesmo texto', (select evidencia_texto from public.requirement_submissions where member_requirement_id = t.mr('membro_b', 'amigo.III.2')), 'Redação antiga do clube B.');
select t.como('lider_b'); select t.pedir_clube('clube_b');
select t.eq('a fila do clube B só tem o que é do B', t.nv($q$select count(*) from json_array_elements(public.classe_avaliacoes_pendentes()) x where (x ->> 'evidencia_texto') like '%ANTIGO%'$q$), 0);
reset role;
select * from t.fim();
rollback;
