-- Fase 3 — as 6 Classes Regulares 2026 importadas (migrations 39/40) no FLUXO REAL, multi-clube.
-- Cenários pedidos: (1) 6 classes uma vez só; (2) banco = manifesto; (3) requisito alterado por
-- OMD = versão vigente; (4) dinâmico resolve o conteúdo de 2026; (5) N-de-M depois da importação
-- real; (6) sem_repeticao consulta curriculum_achievements; (7) iniciar/progredir/concluir por
-- clube; (8) conquista portátil; (9) Tenant 001 × 002 isolados; (10) pessoa em 2 clubes com
-- progresso independente na MESMA Classe; (11) nenhuma Avançada publicada; (12) nenhum
-- [PILOTO/TESTE] pro usuário normal. Mais: elegibilidade SÓ por idade_minima (o que a fonte
-- declara), "Origem do requisito", importação sem criar progresso.
begin;
\ir _lib.sql
\ir _curriculo_regular_2026.sql

-- ==================== importar = publicar catálogo, NÃO matricular ninguém ====================
select t.eq('a importação não criou progresso (member_classes) em classe oficial pra ninguém',
  (select count(*) from public.member_classes mc join public.classes c on c.id = mc.class_id join public.curriculum_versions v on v.id = c.curriculum_version_id where v.origem = 'oficial'), 0);
select t.eq('...nem member_requirements, nem conquista curricular de classe oficial',
  (select count(*) from public.member_requirements mr join public.class_requirements r on r.id = mr.requirement_id where r.manifesto_id is not null)
  + (select count(*) from public.curriculum_achievements a join public.classes c on c.id = a.classe_id join public.curriculum_versions v on v.id = c.curriculum_version_id where v.origem = 'oficial'), 0);

\ir _fixtures.sql
insert into public.club_features (club_id, feature, enabled) values (t.id('clube_a'), 'classes', true), (t.id('clube_b'), 'classes', true)
on conflict (club_id, feature) do update set enabled = true;

create function t.classe(p_manifesto_id text) returns uuid language sql stable as $$
  select c.id from public.classes c join public.curriculum_versions v on v.id = c.curriculum_version_id
  where v.origem = 'oficial' and v.status = 'publicado' and c.manifesto_id = p_manifesto_id $$;
create function t.req(p_manifesto_id text) returns uuid language sql stable as $$
  select r.id from public.class_requirements r join public.class_sections s on s.id = r.section_id join public.classes c on c.id = s.class_id
  join public.curriculum_versions v on v.id = c.curriculum_version_id
  where r.manifesto_id = p_manifesto_id and v.origem = 'oficial' and v.status = 'publicado' $$;
insert into t.ids (chave, id) values ('classe_piloto', '00000000-0000-4000-a000-000000000002'::uuid), ('especialidade_piloto', '00000000-0000-4000-a000-000000000102'::uuid);

-- ==================== 1 + 11) as 6 existem uma vez só; nenhuma Avançada ====================
select t.eq('(1) 6 classes oficiais publicadas, uma por manifesto_id', (select count(distinct manifesto_id) from public.classes c join public.curriculum_versions v on v.id = c.curriculum_version_id where v.origem = 'oficial' and v.status = 'publicado'), 6);
select t.eq('(1) ...exatamente Amigo, Companheiro, Pesquisador, Pioneiro, Excursionista e Guia',
  (select string_agg(nome, ',' order by ordem) from public.classes c join public.curriculum_versions v on v.id = c.curriculum_version_id where v.origem = 'oficial' and v.status = 'publicado'),
  'Amigo,Companheiro,Pesquisador,Pioneiro,Excursionista,Guia');
select t.eq('(11) nenhuma Classe Avançada no banco (nem publicada, nem rascunho)',
  (select count(*) from public.classes where nome ~* 'natureza|excursionismo|campo e bosque|fronteiras|na mata|exploração' or manifesto_id ~ '_'), 0);
select t.eq('(2) 149 requisitos oficiais (banco = manifesto; a comparação campo a campo é o teste 36)',
  (select count(*) from public.class_requirements r where r.id = t.req(r.manifesto_id)), (select count(*) from jsonb_array_elements((select texto::jsonb from t.manifesto) -> 'classes') c, jsonb_array_elements(c -> 'secoes') s, jsonb_array_elements(s -> 'requisitos')));

-- ==================== 12) piloto preservado mas INVISÍVEL; elegibilidade só por idade ====================
-- membro_a nasceu em 2014-05-05 → 12 anos em 2026: elegível a Amigo(10)/Companheiro(11)/Pesquisador(12), não a Pioneiro(13)/Excursionista(14)/Guia(15)
select t.como('membro_a'); select t.pedir_clube('clube_a');
select t.eq('(12) classes_disponiveis lista as 6 oficiais...', t.n($q$select json_array_length(public.classes_disponiveis())$q$), 6);
select t.eq('(12) ...e NENHUM [PILOTO/TESTE]', t.txt($q$select public.classes_disponiveis()::text$q$) like '%PILOTO%', false);
select t.throws('(12) iniciar o piloto direto pela RPC também é recusado ("não encontrada" — sem oráculo)', format($q$select public.classe_iniciar(%L)$q$, t.id('classe_piloto')), 'não encontrada');
select t.eq('elegibilidade: 3 elegíveis (12 anos) e 3 com motivo "a partir de N anos"',
  t.n($q$select count(*) from json_array_elements(public.classes_disponiveis()) c where (c->>'elegivel')::boolean$q$) * 10
  + t.n($q$select count(*) from json_array_elements(public.classes_disponiveis()) c where not (c->>'elegivel')::boolean and c->>'motivo_inelegivel' like 'Esta classe é a partir de%'$q$), 33);
select t.eq('elegibilidade: idade_minima vem do manifesto (Amigo=10 … Guia=15), nada além disso',
  t.txt($q$select string_agg(c->>'idade_minima', ',' order by (c->>'idade_minima')::int) from json_array_elements(public.classes_disponiveis()) c$q$), '10,11,12,13,14,15');
select t.throws('elegibilidade: membro_a (12) NÃO inicia Pioneiro (13)', format($q$select public.classe_iniciar(%L)$q$, t.classe('pioneiro')), 'a partir de 13 anos');
select t.permitido('elegibilidade: membro_a inicia Amigo', format($q$select public.classe_iniciar(%L)$q$, t.classe('amigo')));
select t.como('lider_a'); select t.pedir_clube('clube_a');
select t.permitido('sem nascimento cadastrado NÃO há bloqueio (não inventa): lider_a inicia Guia', format($q$select public.classe_iniciar(%L)$q$, t.classe('guia')));
select t.throws('a liderança também não atribui classe abaixo da idade (membro_a → Excursionista)', format($q$select public.classe_atribuir(%L, %L)$q$, t.id('membro_a'), t.classe('excursionista')), 'a partir de 14 anos');
select t.throws('nem atribui o piloto', format($q$select public.classe_atribuir(%L, %L)$q$, t.id('membro_a'), t.id('classe_piloto')), 'não encontrada');
reset role;
select t.eq('(12) o piloto continua EXISTINDO (preservado, separado: origem piloto_teste, versão própria)',
  (select count(*) from public.classes c join public.curriculum_versions v on v.id = c.curriculum_version_id where c.id = t.id('classe_piloto') and v.origem = 'piloto_teste' and v.status = 'publicado'), 1);
select t.eq('nenhuma sequência/pré-requisito entre classes foi inventada (0 dependências class→class)', (select count(*) from public.curriculum_dependencies where alvo_tipo = 'class' and depende_de_tipo = 'class'), 0);
-- a regra é condicional: sem catálogo oficial, o piloto volta a aparecer (arquiva SÓ a publicada e devolve SÓ ela —
-- a 2026.1 já está arquivada de verdade e tem que continuar assim)
insert into t.ids (chave, id) select 'versao_publicada', id from public.curriculum_versions where origem = 'oficial' and status = 'publicado';
update public.curriculum_versions set status = 'arquivado' where id = t.id('versao_publicada');
select t.como('membro_a2'); select t.pedir_clube('clube_a');
select t.eq('(12) sem catálogo oficial publicado, o piloto volta ao fluxo normal (a regra é condicional, não um apagamento)', t.txt($q$select public.classes_disponiveis()::text$q$) like '%PILOTO%', true);
reset role;
update public.curriculum_versions set status = 'publicado' where id = t.id('versao_publicada');
select t.eq('(1) continua UMA versão oficial publicada (a 2026.1 segue arquivada)', (select count(*) from public.curriculum_versions where origem = 'oficial' and status = 'publicado'), 1);

-- ==================== 3) requisito alterado por OMD = versão vigente + "Origem do requisito" ====================
select t.eq('(3) Companheiro I.5 é o livro VIGENTE (OMD 021/2024, obrigatório desde 2026): "Um Simples Lanche", não "Caminho a Cristo"',
  (select count(*) from public.class_requirements where id = t.req('companheiro.I.5') and descricao ilike '%Um Simples Lanche%' and descricao not ilike '%Caminho a Cristo%' and status_fonte = 'ALTERADO_POR_OMD' and alterado_por_omd = 'OMD-021-2024'), 1);
select t.eq('(3) os 4 livros trocados pela OMD 021/2024 estão todos ALTERADO_POR_OMD por ela (Companheiro, Pioneiro, Excursionista, Guia I.5)',
  (select count(*) from public.class_requirements where id in (t.req('companheiro.I.5'), t.req('pioneiro.I.5'), t.req('excursionista.I.5'), t.req('guia.I.5')) and alterado_por_omd = 'OMD-021-2024'), 4);
select t.eq('(3) Amigo I.5 confirmado sem alteração pela mesma OMD (confirmado_por_omd), livro "Vaso de Barro" (OMD 012/2017)',
  (select count(*) from public.class_requirements where id = t.req('amigo.I.5') and alterado_por_omd = 'OMD-012-2017' and confirmado_por_omd = 'OMD-021-2024' and descricao ilike '%Vaso de Barro%'), 1);
select t.como('membro_a'); select t.pedir_clube('clube_a');
select t.eq('Origem do requisito (RPC, qualquer autenticado): OMD resolvida com título/URL/status, status_fonte, hash da versão, página oficial da classe',
  t.txt(format($q$select (o->'requisito'->>'status_fonte') || '|' || (o->'requisito'->'alterado_por_omd'->>'id') || '|' || ((o->'requisito'->'alterado_por_omd'->>'url') is not null)::text || '|' || (o->'requisito'->'alterado_por_omd'->>'status') || '|' || (o->'versao'->>'fonte_hash') || '|' || ((o->'classe'->>'fonte_url') like 'https://www.adventistas.org/%%')::text from public.requisito_origem(%L) o$q$, t.req('companheiro.I.5'))),
  'ALTERADO_POR_OMD|OMD-021-2024|true|CONFIRMADO|' || (select hash from t.manifesto) || '|true');
select t.eq('Origem: carimbo da página (2017) ≠ vigência da classe (2026-01-01) — os dois preservados, separados',
  t.txt(format($q$select (o->'classe'->>'fonte_publicado_em') || '|' || (o->'classe'->>'vigente_desde') from public.requisito_origem(%L) o$q$, t.req('companheiro.I.5'))), '2017-11-03|2026-01-01');
select t.eq('Origem: a nota de vigência do manifesto veio junto (proveniencia)', t.txt(format($q$select o->'classe'->'proveniencia'->>'vigente_desde_nota' from public.requisito_origem(%L) o$q$, t.req('companheiro.I.5'))) like '%transição%', true);
select t.eq('Origem de requisito do piloto (publicado, mas não oficial) também responde — sem OMD, sem manifesto', t.txt(format($q$select (o->'requisito'->>'manifesto_id') is null from public.requisito_origem((select r.id from public.class_requirements r join public.class_sections s on s.id = r.section_id where s.class_id = %L limit 1)) o$q$, t.id('classe_piloto'))), 'true');
reset role;

-- ==================== 4) dinâmico: referencia o mecanismo; 2026 resolve o valor cadastrado ====================
insert into t.ids (chave, id) select 'mr_amigo_I4', mr.id from public.member_requirements mr where mr.usuario_id = t.id('membro_a') and mr.club_id = t.id('clube_a') and mr.requirement_id = t.req('amigo.I.4');
select t.eq('(4) Amigo I.4 referencia o slot curso_leitura_amigo (não tem "2026" no texto)',
  (select count(*) from public.class_requirements r join public.dynamic_content_definitions d on d.id = r.conteudo_dinamico_definicao_id where r.id = t.req('amigo.I.4') and d.chave = 'curso_leitura_amigo' and r.descricao !~ '20[0-9][0-9]'), 1);
select t.como('membro_a'); select t.pedir_clube('clube_a');
select t.eq('(4) sem valor cadastrado pro ano: minha_classe() entrega conteudo_dinamico com valor NULL (honesto) e a explicação diz BLOQUEADO',
  t.txt($q$select (r->'conteudo_dinamico'->>'chave') || '|' || coalesce(r->'conteudo_dinamico'->>'valor', 'NULL') from json_array_elements(public.minha_classe()->'secoes'->0->'requisitos') r where r->>'manifesto_id' = 'amigo.I.4'$q$) || '|' || t.txt(format($q$select public.explicar_requisito_classe(%L)->>'resultado'$q$, t.id('mr_amigo_I4'))),
  'curso_leitura_amigo|NULL|bloqueado');
select t.throws('(4) BLOQUEADO de verdade: sem o conteúdo do período, ENVIAR é recusado (fase 3.1)', format($q$select public.requisito_enviar(%L)$q$, t.req('amigo.I.4')), 'ainda não está disponível');
select t.como('lider_a'); select t.pedir_clube('clube_a');
select t.throws('(4) ...e APROVAR também é recusado — aprovação manual não contorna a regra', format($q$select public.requisito_avaliar(%L, 'aprovado', null)$q$, t.id('mr_amigo_I4')), 'ainda não está disponível');
reset role;
select t.eq('(4) o requisito continua nao_iniciado, sem avaliação registrada', (select status from public.member_requirements where id = t.id('mr_amigo_I4')) || '|' || (select count(*) from public.requirement_approvals where member_requirement_id = t.id('mr_amigo_I4')), 'nao_iniciado|0');
-- o valor do ano entra DEPOIS, como dado com fonte (aqui, sintético de teste) — nunca dentro do requisito
insert into public.dynamic_content_values (definicao_id, valor, vigente_desde, vigente_ate, fonte_descricao)
select id, 'Livro do Curso de Leitura 2026 [DADO DE TESTE]', '2026-01-01', '2026-12-31', 'fixture do teste 37' from public.dynamic_content_definitions where chave = 'curso_leitura_amigo';
select t.eq('(4) resolver(curso_leitura_amigo, 2026-06-01) = o valor de 2026', public.conteudo_dinamico_resolver('curso_leitura_amigo', '2026-06-01') ->> 'valor', 'Livro do Curso de Leitura 2026 [DADO DE TESTE]');
select t.eq('(4) resolver(…, 2027-06-01) = NULL (2027 ainda sem cadastro; não reaproveita 2026)', public.conteudo_dinamico_resolver('curso_leitura_amigo', '2027-06-01') ->> 'valor', null);
select t.como('membro_a'); select t.pedir_clube('clube_a');
select t.eq('(4) minha_classe() agora entrega o valor de 2026 no requisito, e a explicação passa a PENDENTE',
  t.txt($q$select r->'conteudo_dinamico'->>'valor' from json_array_elements(public.minha_classe()->'secoes'->0->'requisitos') r where r->>'manifesto_id' = 'amigo.I.4'$q$) || '|' || t.txt(format($q$select public.explicar_requisito_classe(%L)->>'resultado'$q$, t.id('mr_amigo_I4'))),
  'Livro do Curso de Leitura 2026 [DADO DE TESTE]|pendente');
select t.eq('(4) o texto do requisito NÃO mudou (o ano vive no catálogo dinâmico)', t.txt($q$select r->>'descricao' from json_array_elements(public.minha_classe()->'secoes'->0->'requisitos') r where r->>'manifesto_id' = 'amigo.I.4'$q$), (select descricao from public.class_requirements where id = t.req('amigo.I.4')));
reset role;

-- ==================== 5) N-de-M real: Amigo V.1 (1 de 4) e sem_repeticao ====================
select t.como('membro_a'); select t.pedir_clube('clube_a');
select t.eq('(5) Amigo V.1 chega na tela como regra declarativa: n_minimo=1, 4 opções na ordem do cartão, sem_repeticao=false',
  t.txt($q$select (r->'escolha'->>'n_minimo') || '|' || json_array_length(r->'escolha'->'opcoes') || '|' || (r->'escolha'->>'sem_repeticao') || '|' || (r->'escolha'->'opcoes'->0->>'rotulo') from json_array_elements(public.minha_classe()->'secoes'->4->'requisitos') r where r->>'manifesto_id' = 'amigo.V.1'$q$),
  '1|4|false|Natação principiante I');
select t.eq('(5) a explicação do requisito lista a regra escolha_n_de_m com origem nas tabelas da migration 38',
  t.txt(format($q$select r->>'origem' from jsonb_array_elements(public.explicar_requisito_classe((select id from public.member_requirements where usuario_id = %L and club_id = %L and requirement_id = %L))->'regras_aplicadas') r where r->>'regra' = 'escolha_n_de_m'$q$, t.id('membro_a'), t.id('clube_a'), t.req('amigo.V.1'))),
  'requirement_option_groups + requirement_options + member_requirement_options');
select t.eq('(5) requisito simples NÃO carrega escolha nem conteúdo dinâmico (null, não objeto vazio)',
  t.txt($q$select ((r->'escolha') is null or json_typeof(r->'escolha') = 'null')::text || '|' || ((r->'conteudo_dinamico') is null or json_typeof(r->'conteudo_dinamico') = 'null')::text from json_array_elements(public.minha_classe()->'secoes'->0->'requisitos') r where r->>'manifesto_id' = 'amigo.I.1'$q$), 'true|true');
reset role;
select t.eq('(6) Companheiro IX.1 virou grupo sem_repeticao=true com o pool do manifesto e SEM lista fechada (o cartão não lista opções: "em Artes e habilidades manuais")',
  (select (g.sem_repeticao)::text || '|' || g.pool_sem_repeticao || '|' || g.n_minimo || '|' || (select count(*) from public.requirement_options o where o.grupo_id = g.id)
     from public.requirement_option_groups g where g.alvo_tipo = 'class_requirement' and g.alvo_id = t.req('companheiro.IX.1')), 'true|companheiro.especialidades_ja_concluidas_pela_pessoa|1|0');
select t.eq('(6) Excursionista IX.1: sem_repeticao COM lista (4 opções) — os dois formatos do cartão são representados sem perda',
  (select g.sem_repeticao::text || '|' || (select count(*) from public.requirement_options o where o.grupo_id = g.id) from public.requirement_option_groups g where g.alvo_tipo = 'class_requirement' and g.alvo_id = t.req('excursionista.IX.1')), 'true|4');
select t.eq('(6) a primitiva do "não repetir" consulta curriculum_achievements (histórico portátil), nunca member_specialties do clube atual',
  (select count(*) from pg_proc where (proname = 'curriculo_pessoa_concluiu' and prosrc ~ 'curriculum_achievements' and prosrc !~ 'member_specialties')
                                   or (proname = 'especialidade_ja_concluida_pela_pessoa' and prosrc ~ 'curriculo_pessoa_concluiu' and prosrc !~ 'member_specialties')), 2);

-- ==================== 7 + 10) iniciar/progredir/concluir POR CLUBE; a mesma Classe em 2 clubes, independente ====================
-- multi_dois_papeis (2013-01-01 → 13 anos): desbravador no A, conselheiro no B. Amigo nos dois.
select t.como('multi_dois_papeis'); select t.pedir_clube('clube_a');
select t.permitido('(10) multi inicia Amigo no clube A', format($q$select public.classe_iniciar(%L)$q$, t.classe('amigo')));
select t.pedir_clube('clube_b');
select t.permitido('(10) multi inicia a MESMA Amigo no clube B', format($q$select public.classe_iniciar(%L)$q$, t.classe('amigo')));
select t.permitido('(7) no B: salva e envia Amigo I.1', format($q$select public.requisito_salvar(%L, 'Feito no clube B', null)$q$, t.req('amigo.I.1')));
select t.permitido('...envia', format($q$select public.requisito_enviar(%L)$q$, t.req('amigo.I.1')));
reset role;
insert into t.ids (chave, id) select 'mc_multi_a', id from public.member_classes where usuario_id = t.id('multi_dois_papeis') and club_id = t.id('clube_a') and class_id = t.classe('amigo');
insert into t.ids (chave, id) select 'mc_multi_b', id from public.member_classes where usuario_id = t.id('multi_dois_papeis') and club_id = t.id('clube_b') and class_id = t.classe('amigo');
select t.eq('(10) duas matrículas SEPARADAS na mesma Classe (uma por clube), 25 requisitos cada',
  (select count(*) from public.member_classes where usuario_id = t.id('multi_dois_papeis') and class_id = t.classe('amigo')) * 100
  + (select count(*) from public.member_requirements where member_class_id = t.id('mc_multi_a')) + (select count(*) from public.member_requirements where member_class_id = t.id('mc_multi_b')) - 25, 225);
select t.como('lider_a'); select t.pedir_clube('clube_a');
select t.eq('(9) lider_a NÃO vê o requisito enviado no B (fila do A vazia)', t.n($q$select json_array_length(public.classe_avaliacoes_pendentes())$q$), 0);
select t.throws('(9) lider_a NÃO aprova o requisito do B, mesmo com o id', format($q$select public.requisito_avaliar((select id from public.member_requirements where member_class_id = %L and requirement_id = %L), 'aprovado', null)$q$, t.id('mc_multi_b'), t.req('amigo.I.1')), 'não encontrado');
select t.como('lider_b'); select t.pedir_clube('clube_b');
select t.eq('(9) lider_b vê exatamente 1 pendente (o de multi no B)', t.n($q$select json_array_length(public.classe_avaliacoes_pendentes())$q$), 1);
select t.permitido('(7) lider_b aprova', format($q$select public.requisito_avaliar((select id from public.member_requirements where member_class_id = %L and requirement_id = %L), 'aprovado', 'ok B')$q$, t.id('mc_multi_b'), t.req('amigo.I.1')));
reset role;
select t.eq('(10) B: 4% (1/25); A: 0% — progresso independente', public.classe_percentual(t.id('mc_multi_b')) * 100 + public.classe_percentual(t.id('mc_multi_a')), 400);
select t.eq('(9) a aprovação ficou auditada no clube B, por lider_b',
  (select count(*) from public.requirement_approvals a where a.club_id = t.id('clube_b') and a.avaliado_por = t.id('lider_b') and a.member_requirement_id in (select id from public.member_requirements where member_class_id = t.id('mc_multi_b'))), 1);

-- (5, fase 3.1) N-de-M NÃO passa por aprovação manual sem a escolha registrada
select t.como('lider_a'); select t.pedir_clube('clube_a');
select t.throws('(5) aprovar Amigo V.1 de multi SEM escolha registrada é recusado ("Escolha pelo menos 1 das 4 opções")',
  format($q$select public.requisito_avaliar((select id from public.member_requirements where member_class_id = %L and requirement_id = %L), 'aprovado', null)$q$, t.id('mc_multi_a'), t.req('amigo.V.1')), 'Escolha pelo menos 1 das 4');
select t.como('multi_dois_papeis'); select t.pedir_clube('clube_a');
select t.throws('(5) enviar sem escolher também é recusado', format($q$select public.requisito_enviar(%L)$q$, t.req('amigo.V.1')), 'Escolha pelo menos 1');
select t.throws('(5) escolher uma opção de OUTRO requisito é recusado', format($q$select public.requisito_escolher(%L, array[(select o.id from public.requirement_options o join public.requirement_option_groups g on g.id = o.grupo_id where g.alvo_id = %L limit 1)], '{}')$q$, t.req('amigo.V.1'), t.req('amigo.VII.1')), 'Opção inválida');
select t.throws('(5) texto livre num requisito que TEM lista é recusado', format($q$select public.requisito_escolher(%L, '{}', array['qualquer coisa'])$q$, t.req('amigo.V.1')), 'escolha entre elas');
select t.permitido('(5) multi registra a escolha em V.1 e VII.1 (1ª opção de cada)',
  format($q$select public.requisito_escolher(r, array[(select o.id from public.requirement_options o join public.requirement_option_groups g on g.id = o.grupo_id where g.alvo_id = r order by o.ordem limit 1)], '{}')
           from unnest(array[%L::uuid, %L::uuid]) r$q$, t.req('amigo.V.1'), t.req('amigo.VII.1')), 2);
-- amigo.IX.1 (revisão 2026.2): categoria aberta, SEM lista — a pessoa informa qual especialidade fez (texto livre)
select t.throws('(5) IX.1 não aceita id de opção (o cartão não lista opções)', format($q$select public.requisito_escolher(%L, array[%L::uuid], '{}')$q$, t.req('amigo.IX.1'), t.req('amigo.V.1')), 'informe qual foi');
select t.permitido('(5) multi informa em IX.1 qual especialidade da área fez (texto livre)', format($q$select public.requisito_escolher(%L, '{}', array['Cestaria [DADO DE TESTE]'])$q$, t.req('amigo.IX.1')));
select t.eq('(5) IX.1 chega na tela como grupo aberto: n_minimo=1, 0 opções, aceita_texto_livre, escolha registrada, sem bloqueio',
  t.txt($q$select (r->'escolha'->>'n_minimo') || '|' || (r->'escolha'->>'total_opcoes') || '|' || (r->'escolha'->>'aceita_texto_livre') || '|' || (r->'escolha'->'escolhidas'->0->>'rotulo_livre') || '|' || json_array_length(r->'bloqueios') from json_array_elements(public.minha_classe()->'secoes'->8->'requisitos') r where r->>'manifesto_id' = 'amigo.IX.1'$q$), '1|0|true|Cestaria [DADO DE TESTE]|0');
select t.eq('(5) minha_classe() mostra a escolha registrada em V.1 e bloqueios vazios; o status virou em_andamento',
  t.txt($q$select (r->'escolha'->'escolhidas'->0->>'rotulo') || '|' || json_array_length(r->'bloqueios') || '|' || (r->>'status') from json_array_elements(public.minha_classe()->'secoes'->4->'requisitos') r where r->>'manifesto_id' = 'amigo.V.1'$q$), 'Natação principiante I|0|em_andamento');
select t.eq('(5) requisito simples de multi (I.1) nasce sem bloqueio', t.txt($q$select json_array_length(r->'bloqueios')::text from json_array_elements(public.minha_classe()->'secoes'->0->'requisitos') r where r->>'manifesto_id' = 'amigo.I.1'$q$), '0');
reset role;
select t.eq('(5) as 3 escolhas estão em member_requirement_options (2 por opção do cartão + 1 texto livre), com club_id = A derivado (nunca do cliente)',
  (select count(*) filter (where option_id is not null) * 10 + count(*) filter (where rotulo_livre is not null)
     from public.member_requirement_options mo where mo.usuario_id = t.id('multi_dois_papeis') and mo.club_id = t.id('clube_a')), 21);
select t.como('lider_b'); select t.pedir_clube('clube_b');
select t.eq('(9) lider_b NÃO vê as escolhas feitas no A', t.nv(format($q$select count(*) from public.member_requirement_options where usuario_id = %L$q$, t.id('multi_dois_papeis'))), 0);
reset role;

-- (7) concluir no A: lider_a aprova os 25 do A → concluída + revisão de investidura + conquista
select t.como('lider_a'); select t.pedir_clube('clube_a');
select t.permitido('(7) lider_a aprova os 25 requisitos de multi no A (I.4 com o conteúdo do ano cadastrado; V.1/VII.1/IX.1 com escolha registrada)', format($q$select public.requisito_avaliar(mr.id, 'aprovado', null) from public.member_requirements mr where mr.member_class_id = %L$q$, t.id('mc_multi_a')), 25);
reset role;
select t.eq('(7) Amigo de multi no A: 100%, snapshot selado, AGUARDANDO REVISÃO FINAL (fase 4: não é "concluída/investida" ainda)',
  (select status from public.member_classes where id = t.id('mc_multi_a')) || '|' || public.classe_percentual(t.id('mc_multi_a')) || '|' || (select status from public.investiture_reviews where member_class_id = t.id('mc_multi_a') order by solicitado_em desc limit 1), 'aguardando_revisao|100|pendente');
select t.eq('(10) ...e a do B continua em_andamento, 4%', (select status from public.member_classes where id = t.id('mc_multi_b')) || '|' || public.classe_percentual(t.id('mc_multi_b')), 'em_andamento|4');
select t.eq('(8) ainda NENHUMA conquista de classe (só na investidura)', (select count(*) from public.curriculum_achievements where usuario_id = t.id('multi_dois_papeis') and tipo = 'classe'), 0);
select t.como('lider_a'); select t.pedir_clube('clube_a');
select t.permitido('(7) lider_a aprova a revisão final', format($q$select public.revisao_final_decidir(%L, 'aprovado', 'Tudo certo')$q$, t.id('mc_multi_a')));
select t.permitido('(7) lider_a registra a investidura', format($q$select public.investidura_registrar(%L)$q$, t.id('mc_multi_a')));
reset role;
select t.eq('(7) investida, com evento de investidura registrado por lider_a (diretoria)', (select status from public.member_classes where id = t.id('mc_multi_a')) || '|' || (select registrado_papel from public.class_investitures where member_class_id = t.id('mc_multi_a') and status = 'registrada'), 'investida|diretoria');

-- ==================== 8) a conquista é PORTÁTIL, com proveniência ====================
insert into t.ids (chave, id) select 'ach_amigo', id from public.curriculum_achievements where usuario_id = t.id('multi_dois_papeis') and tipo = 'classe' and classe_id = t.classe('amigo');
select t.eq('(8) conquista de CLASSE emitida: Amigo (a versão oficial PUBLICADA do manifesto), club_id_origem = A, ativa, ligada à matrícula do A',
  (select count(*) from public.curriculum_achievements a join public.classes c on c.id = a.classe_id join public.curriculum_versions v on v.id = c.curriculum_version_id
    where a.id = t.id('ach_amigo') and a.club_id_origem = t.id('clube_a') and a.status = 'ativa' and a.member_class_id = t.id('mc_multi_a') and v.origem = 'oficial'
      and v.versao = (select texto::jsonb ->> 'manifesto_versao' from t.manifesto)), 1);
select t.eq('(8) só UMA conquista (a matrícula do B não gera outra enquanto não concluir lá)', (select count(*) from public.curriculum_achievements where usuario_id = t.id('multi_dois_papeis') and tipo = 'classe'), 1);
select t.como('lider_b'); select t.pedir_clube('clube_b');
select t.eq('(8) lider_b VÊ a conquista (pessoa com vínculo ativo no B)', t.nv(format($q$select count(*) from public.curriculum_achievements where id = %L$q$, t.id('ach_amigo'))), 1);
select t.throws('(8) ...mas NÃO revoga (só o emissor A)', format($q$select public.curriculum_achievement_revogar(%L, 'não posso')$q$, t.id('ach_amigo')), 'clube que emitiu');
select t.eq('(9) lider_b NÃO vê a matrícula/progresso/avaliações de multi no A', t.nv(format($q$select count(*) from public.member_classes where id = %L$q$, t.id('mc_multi_a'))) + t.nv(format($q$select count(*) from public.member_requirements where member_class_id = %L$q$, t.id('mc_multi_a'))) + t.nv(format($q$select count(*) from public.requirement_approvals where club_id = %L$q$, t.id('clube_a'))), 0);
select t.como('membro_b');
select t.eq('(8) membro comum do B não vê a conquista', t.nv(format($q$select count(*) from public.curriculum_achievements where id = %L$q$, t.id('ach_amigo'))), 0);
reset role;

-- ==================== 6) sem_repeticao consulta o histórico portátil, de verdade ====================
select t.como('multi_dois_papeis'); select t.pedir_clube('clube_a');
select t.permitido('multi inicia a especialidade piloto no A (não há especialidade oficial: o piloto segue no fluxo)', format($q$select public.especialidade_iniciar(%L)$q$, t.id('especialidade_piloto')));
select t.como('lider_a'); select t.pedir_clube('clube_a');
select t.permitido('lider_a aprova os 3 requisitos', format($q$select public.especialidade_requisito_avaliar(mr.id, 'aprovado', null) from public.member_specialty_requirements mr where mr.usuario_id = %L and mr.club_id = %L$q$, t.id('multi_dois_papeis'), t.id('clube_a')), 3);
reset role;
select t.eq('(6) especialidade_ja_concluida_pela_pessoa = true — via curriculum_achievements emitida por A', public.especialidade_ja_concluida_pela_pessoa(t.id('multi_dois_papeis'), t.id('especialidade_piloto')), true);
select t.eq('(6) ...com a conquista da especialidade rastreável (club_id_origem = A)', (select count(*) from public.curriculum_achievements where usuario_id = t.id('multi_dois_papeis') and tipo = 'especialidade' and specialty_id = t.id('especialidade_piloto') and club_id_origem = t.id('clube_a') and status = 'ativa'), 1);
select t.como('lider_a'); select t.pedir_clube('clube_a');
select t.permitido('o emissor revoga', format($q$select public.curriculum_achievement_revogar((select id from public.curriculum_achievements where usuario_id = %L and specialty_id = %L), 'teste')$q$, t.id('multi_dois_papeis'), t.id('especialidade_piloto')));
reset role;
select t.eq('(6) revogada → deixa de contar como "já realizada" (mesmo com member_specialties do A ainda concluída)', public.especialidade_ja_concluida_pela_pessoa(t.id('multi_dois_papeis'), t.id('especialidade_piloto')), false);
select t.eq('...member_specialties do A intocada (dado operacional não é o que a regra lê)', (select status from public.member_specialties where usuario_id = t.id('multi_dois_papeis') and club_id = t.id('clube_a') and specialty_id = t.id('especialidade_piloto')), 'concluida');

select t.fim();
rollback;
