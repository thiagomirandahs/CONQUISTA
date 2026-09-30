-- Migration 514 (fase 8): catálogo de leitura + progresso de leitura/áudio + administração auditada + Minha Jornada + Portfólio
-- + horário do rascunho no servidor. Prova: sementes documentadas (sem URL inventada, áudio não confirmado escondido),
-- PDF só com licença, links só quando revisados, só o admin da plataforma edita (com auditoria imutável), progresso é da PESSOA e do
-- CLUBE (nunca do cliente), ouvir até o fim NÃO aprova requisito, isolamento entre pessoas/clubes, portfólio sem foto/caminho.
begin;
\ir _lib.sql
\ir _curriculo_regular_2026.sql
\ir _fixtures.sql

\o /dev/null
select t.signup('admin121', '{"tipo":"fundador","nome":"Admin 121"}'::jsonb);
insert into public.platform_admins (user_id, papel, motivo) values (t.id('admin121'), 'operacao', 'teste 121');
insert into public.club_features (club_id, feature, enabled) values (t.id('clube_a'), 'classes', true), (t.id('clube_b'), 'classes', true)
on conflict (club_id, feature) do update set enabled = true;
create function t.classe(p text) returns uuid language sql stable security definer as $$
  select c.id from public.classes c join public.curriculum_versions v on v.id = c.curriculum_version_id where v.origem = 'oficial' and v.status = 'publicado' and c.manifesto_id = p $$;
create function t.req(p text) returns uuid language sql stable security definer as $$
  select r.id from public.class_requirements r join public.class_sections s on s.id = r.section_id join public.classes c on c.id = s.class_id
  join public.curriculum_versions v on v.id = c.curriculum_version_id where r.manifesto_id = p and v.origem = 'oficial' and v.status = 'publicado' $$;
create function t.mr(p_user text, p_req text) returns uuid language sql stable security definer as $$
  select mr.id from public.member_requirements mr where mr.usuario_id = t.id(p_user) and mr.requirement_id = t.req(p_req) $$;
create function t.mat(p text) returns uuid language sql stable security definer as $$ select id from public.leitura_materiais where chave = p $$;
\o

-- ==================== 1) sementes: só o que está documentado ====================
select t.eq('7 materiais semeados (6 livros de classe + Curso de Leitura 2026)', (select count(*) from public.leitura_materiais), 7);
select t.eq('mapeamento classe → livro conforme o catálogo oficial',
  (select string_agg(classe_manifesto || '=' || titulo, ',' order by ordem) from public.leitura_materiais where tipo = 'livro_classe'),
  'amigo=Vaso de Barro,companheiro=Um Simples Lanche,pesquisador=Além da Magia,pioneiro=Expedição Galápagos,excursionista=O Fim do Começo,guia=O Livro Amargo');
select t.eq('Curso de Leitura 2026 = "Servo de Deus e Amigo de Todos", sem áudio cadastrado',
  (select titulo || '|' || ano || '|' || (audiolivro_id is null)::text || '|' || audio_confirmado::text from public.leitura_materiais where tipo = 'curso_leitura'), 'Servo de Deus e Amigo de Todos|2026|true|false');
select t.eq('áudio CONFIRMADO só nos 4 documentados (Vaso de Barro, Um Simples Lanche, Além da Magia, O Livro Amargo)',
  (select string_agg(titulo, ',' order by ordem) from public.leitura_materiais where audio_confirmado), 'Vaso de Barro,Um Simples Lanche,Além da Magia,O Livro Amargo');
select t.eq('Expedição Galápagos e O Fim do Começo: áudio NÃO confirmado', (select count(*) from public.leitura_materiais where chave in ('expedicao-galapagos', 'o-fim-do-comeco') and audio_confirmado), 0);
select t.eq('nenhuma URL inventada: nenhum material tem livro/PDF/capa/áudio direto semeado', (select count(*) from public.leitura_materiais where book_url is not null or pdf_url is not null or capa_url is not null or audio_url is not null), 0);
select t.eq('o áudio dos 4 reaproveita o catálogo de audiolivros (capítulos já existentes)', (select count(*) from public.leitura_materiais m join public.audiolivros a on a.id = m.audiolivro_id where m.audio_confirmado), 4);
select t.throws('PDF sem fonte/licença é recusado pelo banco', $q$update public.leitura_materiais set pdf_url = 'https://exemplo.org/livro.pdf' where chave = 'vaso-de-barro'$q$, 'leitura_pdf_so_com_licenca');
select t.throws('URL que não é https é recusada', $q$update public.leitura_materiais set book_url = 'http://exemplo.org/x' where chave = 'vaso-de-barro'$q$);
select t.throws('javascript: é recusado', $q$update public.leitura_materiais set book_url = 'javascript:alert(1)' where chave = 'vaso-de-barro'$q$);

-- ==================== 2) leitura pelo app ====================
select t.como('membro_a'); select t.pedir_clube('clube_a');
select t.eq('membro vê os 7 materiais ativos', t.nv($q$select json_array_length(public.leituras_catalogo('todos') -> 'itens')$q$), 7);
select t.eq('filtro "curso": 1', t.nv($q$select json_array_length(public.leituras_catalogo('curso') -> 'itens')$q$), 1);
select t.eq('filtro "com áudio": só os 4 confirmados', t.nv($q$select json_array_length(public.leituras_catalogo('com_audio') -> 'itens')$q$), 4);
select t.eq('filtro "minha classe": 0 enquanto não iniciou classe', t.nv($q$select json_array_length(public.leituras_catalogo('minha_classe') -> 'itens')$q$), 0);
select t.throws('filtro inválido é recusado', $q$select public.leituras_catalogo('xyz')$q$, 'Filtro inválido');
select t.eq('áudio não confirmado NÃO aparece como disponível (Galápagos)', t.txt($q$select (x ->> 'tem_audio') || '|' || coalesce(x ->> 'audiolivro_id', 'nulo') from json_array_elements(public.leituras_catalogo('todos') -> 'itens') x where x ->> 'chave' = 'expedicao-galapagos'$q$), 'false|nulo');
select t.eq('áudio confirmado aparece (Vaso de Barro)', t.txt($q$select (x ->> 'tem_audio') from json_array_elements(public.leituras_catalogo('todos') -> 'itens') x where x ->> 'chave' = 'vaso-de-barro'$q$), 'true');
select t.eq('tabelas do catálogo não são lidas direto', t.nv('select count(*) from public.leitura_materiais') + t.nv('select count(*) from public.leitura_progresso') + t.nv('select count(*) from public.leitura_auditoria'), 0);
select t.como_anon();
select t.eq('anon NÃO executa o catálogo nem o progresso', (has_function_privilege('anon', 'public.leituras_catalogo(text)', 'execute') or has_function_privilege('anon', 'public.leitura_progresso_salvar(uuid,int,int,int,boolean)', 'execute'))::text, 'false');
reset role;

-- minha classe
select t.como('membro_a'); select t.pedir_clube('clube_a');
select public.classe_iniciar(t.classe('amigo'));
select t.eq('filtro "minha classe" traz o livro da classe iniciada (Vaso de Barro)', t.txt($q$select (x ->> 'titulo') from json_array_elements(public.leituras_catalogo('minha_classe') -> 'itens') x limit 1$q$), 'Vaso de Barro');
reset role;

-- ==================== 3) progresso: da pessoa, no clube, sem aprovar requisito ====================
select t.como('membro_a'); select t.pedir_clube('clube_a');
select t.permitido('salva onde parou (capítulo 4, 18:42)', format($q$select public.leitura_progresso_salvar(%L, 4, 1122, 2400, false)$q$, t.mat('vaso-de-barro')));
select t.eq('...volta no catálogo', t.txt($q$select (x -> 'progresso' ->> 'capitulo') || '|' || (x -> 'progresso' ->> 'posicao_seg') || '|' || (x -> 'progresso' ->> 'concluido') from json_array_elements(public.leituras_catalogo('todos') -> 'itens') x where x ->> 'chave' = 'vaso-de-barro'$q$), '4|1122|false');
select t.permitido('chegou ao fim: concluído', format($q$select public.leitura_progresso_salvar(%L, 12, 2400, 2400, true)$q$, t.mat('vaso-de-barro')));
select t.permitido('voltar a ouvir NÃO desfaz o "concluído"', format($q$select public.leitura_progresso_salvar(%L, 1, 10, 2400, false)$q$, t.mat('vaso-de-barro')));
select t.eq('...continua concluído', t.txt($q$select (x -> 'progresso' ->> 'concluido') from json_array_elements(public.leituras_catalogo('concluidos') -> 'itens') x where x ->> 'chave' = 'vaso-de-barro'$q$), 'true');
select t.permitido('valores absurdos são limitados (sem erro)', format($q$select public.leitura_progresso_salvar(%L, 99999, 99999999, -5, false)$q$, t.mat('vaso-de-barro')));
reset role;
select t.eq('valores limitados no banco (capítulo ≤ 500, posição ≤ 86400, duração ≥ 0)', (select capitulo_ordem || '|' || posicao_seg || '|' || duracao_seg from public.leitura_progresso where usuario_id = t.id('membro_a')), '500|86400|0');
select t.eq('1 linha só por pessoa+clube+material (upsert)', (select count(*) from public.leitura_progresso where usuario_id = t.id('membro_a')), 1);
select t.eq('o servidor gravou a PESSOA e o CLUBE certos', (select (usuario_id = t.id('membro_a') and club_id = t.id('clube_a'))::text from public.leitura_progresso where usuario_id = t.id('membro_a')), 'true');
select t.eq('ouvir até o fim NÃO aprova requisito nem muda a classe (nenhum requisito aprovado)', (select count(*) from public.member_requirements where usuario_id = t.id('membro_a') and status = 'aprovado'), 0);
select t.como('membro_a2'); select t.pedir_clube('clube_a');
select t.eq('outra pessoa do mesmo clube NÃO vê o progresso do colega', t.txt($q$select coalesce((x -> 'progresso')::text, 'nulo') from json_array_elements(public.leituras_catalogo('todos') -> 'itens') x where x ->> 'chave' = 'vaso-de-barro'$q$), 'null');
select t.eq('...e não tem concluídos', t.nv($q$select json_array_length(public.leituras_catalogo('concluidos') -> 'itens')$q$), 0);
select t.como('membro_a'); select t.pedir_clube('clube_b');
select t.eq('a mesma pessoa pedindo um clube onde NÃO tem vínculo: catálogo vazio', t.nv($q$select json_array_length(public.leituras_catalogo('todos') -> 'itens')$q$), 0);
select t.throws('...e não grava progresso', format($q$select public.leitura_progresso_salvar(%L, 1, 1, 1, false)$q$, t.mat('vaso-de-barro')), 'Sem clube em uso');
select t.como('membro_a'); select t.pedir_clube('clube_a');
select t.throws('material inexistente é recusado', format($q$select public.leitura_progresso_salvar(%L, 1, 1, 1, false)$q$, gen_random_uuid()), 'Material não encontrado');
reset role;

-- ==================== 4) administração: SÓ a plataforma; auditoria imutável ====================
select t.como('lider_a'); select t.pedir_clube('clube_a');
select t.throws('diretoria de clube NÃO lista o admin', $q$select public.admin_leitura_listar()$q$);
select t.throws('diretoria de clube NÃO altera o catálogo global', format($q$select public.admin_leitura_salvar(%L, '{"ativo": false}'::jsonb)$q$, t.mat('vaso-de-barro')));
select t.throws('nem lê a auditoria', $q$select public.admin_leitura_auditoria()$q$);
select t.como('membro_a');
select t.throws('membro não edita', format($q$select public.admin_leitura_salvar(%L, '{"ativo": false}'::jsonb)$q$, t.mat('vaso-de-barro')));
select t.como_anon();
select t.eq('anon não executa nenhuma RPC de admin', (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'admin_leitura%' and has_function_privilege('anon', p.oid, 'execute')), 0);
reset role;
select t.como('admin121');
select t.eq('admin da plataforma lista os 7', json_array_length(public.admin_leitura_listar())::bigint, 7);
select t.throws('campo fora da lista é recusado', format($q$select public.admin_leitura_salvar(%L, '{"id": "x"}'::jsonb)$q$, t.mat('vaso-de-barro')), 'Campo não permitido');
select t.permitido('admin cadastra a capa e o link oficial do livro (sem migration)', format($q$select public.admin_leitura_salvar(%L, %L::jsonb)$q$, t.mat('vaso-de-barro'),
  '{"capa_url":"https://exemplo.org/capa.jpg","book_url":"https://exemplo.org/livro","book_rotulo":"Comprar","fonte":"Editora (teste)"}'));
select t.throws('PDF sem licença: recusado', format($q$select public.admin_leitura_salvar(%L, '{"pdf_url":"https://exemplo.org/x.pdf"}'::jsonb)$q$, t.mat('vaso-de-barro')), 'leitura_pdf_so_com_licenca');
select t.permitido('PDF COM fonte/licença oficial: aceito', format($q$select public.admin_leitura_salvar(%L, '{"pdf_url":"https://exemplo.org/x.pdf","pdf_fonte_licenca":"Distribuição gratuita autorizada pela editora (teste)"}'::jsonb)$q$, t.mat('vaso-de-barro')));
select t.throws('confirmar áudio SEM a fonte do áudio é recusado (Curso de Leitura)', format($q$select public.admin_leitura_salvar(%L, '{"audio_confirmado": true}'::jsonb)$q$, t.mat('servo-de-deus-e-amigo-de-todos')), 'leitura_audio_so_com_fonte');
select t.permitido('desativar um material', format($q$select public.admin_leitura_salvar(%L, '{"ativo": false}'::jsonb)$q$, t.mat('o-livro-amargo')));
select t.permitido('criar um material novo', $q$select public.admin_leitura_salvar(null, '{"chave":"livro-teste-121","titulo":"Livro de Teste","tipo":"outro"}'::jsonb)$q$);
reset role;
select t.eq('os 4 áudios confirmados têm a fonte do áudio registrada', (select count(*) from public.leitura_materiais where audio_confirmado and audio_fonte is not null), 4);
select t.eq('as mudanças ficaram na AUDITORIA (quem, o quê, antes/depois)', (select count(*) from public.leitura_auditoria where ator = t.id('admin121')), 4);
select t.eq('...com antes/depois da edição da capa', (select (antes ->> 'capa_url' is null and depois ->> 'capa_url' = 'https://exemplo.org/capa.jpg')::text from public.leitura_auditoria where acao = 'editar' and depois ->> 'chave' = 'vaso-de-barro' order by id limit 1), 'true');
select t.throws('a auditoria é imutável (update)', $q$update public.leitura_auditoria set acao = 'x'$q$, 'imutável');
select t.throws('...e (delete)', $q$delete from public.leitura_auditoria$q$, 'imutável');
select t.como('membro_a'); select t.pedir_clube('clube_a');
select t.eq('o link revisado aparece e o PDF licenciado também (Vaso de Barro)', t.txt($q$select (x ->> 'book_rotulo') || '|' || (x ->> 'book_url') || '|' || (x ->> 'pdf_url') from json_array_elements(public.leituras_catalogo('todos') -> 'itens') x where x ->> 'chave' = 'vaso-de-barro'$q$), 'Comprar|https://exemplo.org/livro|https://exemplo.org/x.pdf');
select t.eq('desativado some do catálogo (O Livro Amargo)', t.nv($q$select count(*) from json_array_elements(public.leituras_catalogo('todos') -> 'itens') x where x ->> 'chave' = 'o-livro-amargo'$q$), 0);
select t.eq('...e o progresso de material desativado não grava', t.txt(format($q$select public.leitura_progresso_salvar(%L, 1, 1, 1, false)$q$, t.mat('o-livro-amargo'))), 'ERRO: Material não encontrado.');
reset role;
-- link NÃO revisado some (mesmo com URL cadastrada)
select t.como('admin121');
select public.admin_leitura_salvar(t.mat('vaso-de-barro'), '{"revisado": false}'::jsonb);
select t.como('membro_a'); select t.pedir_clube('clube_a');
select t.eq('material NÃO revisado: aparece, mas sem links e sem áudio', t.txt($q$select coalesce(x ->> 'book_url', 'sem') || '|' || coalesce(x ->> 'pdf_url', 'sem') || '|' || (x ->> 'tem_audio') from json_array_elements(public.leituras_catalogo('todos') -> 'itens') x where x ->> 'chave' = 'vaso-de-barro'$q$), 'sem|sem|false');
reset role;

-- ==================== 5) horário do rascunho (servidor) ====================
select t.como('membro_a'); select t.pedir_clube('clube_a');
select t.permitido('salva um rascunho estruturado', format($q$select public.requisito_relatorio_salvar(%L, %L::jsonb, '[]'::jsonb)$q$, t.req('amigo.IV.1'), '{"qualidades":["a","b"]}'));
select t.ok('o servidor devolve o HORÁRIO do rascunho no formulário', (public.requisito_formulario(t.req('amigo.IV.1')) ->> 'rascunho_em') is not null);
select t.ok('...e na chamada em lote da matrícula', (public.classe_formularios((select id from public.member_classes where usuario_id = t.id('membro_a') limit 1)) -> t.req('amigo.IV.1')::text ->> 'rascunho_em') is not null);
reset role;
select t.ok('rascunho_em é gravado', (select rascunho_em is not null from public.member_requirements where id = t.mr('membro_a', 'amigo.IV.1')));

-- ==================== 6) Minha Jornada e Portfólio ====================
-- aprova um requisito de texto do membro_a para o portfólio (caminho antigo + avaliação normal)
select t.como('membro_a'); select t.pedir_clube('clube_a');
select public.requisito_salvar(t.req('amigo.II.2'), 'Explico os versículos com minhas palavras. ' || repeat('x', 400), null);
select public.requisito_enviar(t.req('amigo.II.2'));
select t.como('lider_a'); select t.pedir_clube('clube_a');
select public.requisito_avaliar(t.mr('membro_a', 'amigo.II.2'), 'aprovado', 'Muito bom');
select t.como('membro_a'); select t.pedir_clube('clube_a');
select t.eq('minha_jornada: a classe Amigo aparece com percentual > 0', t.txt($q$select (x ->> 'nome') || '|' || ((x ->> 'percentual')::int > 0)::text from json_array_elements(public.minha_jornada() -> 'classes') x limit 1$q$), (select nome from public.classes where id = t.classe('amigo')) || '|true');
select t.eq('minha_jornada: leitura (Vaso de Barro) aparece', t.nv($q$select count(*) from json_array_elements(public.minha_jornada() -> 'leituras') x where x ->> 'titulo' = 'Vaso de Barro'$q$), 1);
select t.eq('minha_jornada traz as 5 seções', t.txt($q$select (select string_agg(k, ',' order by k) from json_object_keys(public.minha_jornada()) k)$q$), 'classes,conquistas,especialidades,investiduras,leituras');
select t.eq('portfólio: 1 requisito aprovado, com avaliador/papel e resumo CURTO (≤ 280), sem caminho nem foto',
  t.txt($q$select jsonb_array_length((public.meu_portfolio() -> 'itens')::jsonb)::text || '|' || (x ->> 'avaliado_papel') || '|' || (length(x ->> 'resumo') <= 280)::text || '|' || (x::text !~ 'path|evidencia_path|foto') from json_array_elements(public.meu_portfolio() -> 'itens') x limit 1$q$), '1|diretoria|true|true');
select t.throws('cursor inválido do portfólio é recusado', $q$select public.meu_portfolio(10, 'lixo')$q$, 'Cursor inválido');
select t.como('membro_a2'); select t.pedir_clube('clube_a');
select t.eq('OUTRA pessoa não vê o portfólio do colega', t.nv($q$select jsonb_array_length((public.meu_portfolio() -> 'itens')::jsonb)$q$), 0);
select t.como('lider_b'); select t.pedir_clube('clube_b');
select t.eq('liderança de OUTRO clube não vê nada do membro (portfólio é sempre da própria pessoa)', t.nv($q$select jsonb_array_length((public.meu_portfolio() -> 'itens')::jsonb)$q$), 0);
select t.como('lider_a'); select t.pedir_clube('clube_a');
select t.eq('diretoria do MESMO clube também não vê o portfólio do membro (é sempre da própria pessoa)', t.nv($q$select jsonb_array_length((public.meu_portfolio() -> 'itens')::jsonb)$q$), 0);
select t.eq('...nem a jornada dele (só a própria)', t.nv($q$select count(*) from json_array_elements(public.minha_jornada() -> 'leituras') x where x ->> 'titulo' = 'Vaso de Barro'$q$), 0);
select t.como('admin121');
select t.eq('admin da plataforma NÃO vê o portfólio de ninguém (só o seu, vazio)', t.nv($q$select jsonb_array_length((public.meu_portfolio() -> 'itens')::jsonb)$q$), 0);
select t.como_anon();
select t.eq('anon não executa jornada nem portfólio', (has_function_privilege('anon', 'public.minha_jornada()', 'execute') or has_function_privilege('anon', 'public.meu_portfolio(int,text)', 'execute'))::text, 'false');
reset role;

select * from t.fim();
rollback;
