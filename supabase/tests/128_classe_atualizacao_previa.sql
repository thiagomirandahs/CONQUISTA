-- Atualização de matrícula de Classe — PRÉVIA somente leitura (migration 522).
-- Duas versões SINTÉTICAS de uma classe de teste (identificador próprio: o catálogo oficial real não é tocado) cobrem
-- preservado, inalterado, equivalente (via mapa explícito, inclusive renumerado), novo, removido, refazer (sem regra,
-- material, configuração diferente, diferença só de caixa) e aprovação não rastreável. Mais: um caso REAL (Amigo
-- 2026.3 -> 2026.4, conteúdo idêntico), isolamento (outra pessoa, outro clube, UUID forjado, anon, papéis sem poder),
-- multiclube, matrícula na versão vigente, mapa imutável/sem escrita pela API e prova de que nada é gravado.
begin;
\ir _lib.sql
\ir _fixtures.sql
insert into public.club_features (club_id, feature, enabled) values (t.id('clube_a'), 'classes', true), (t.id('clube_b'), 'classes', true)
on conflict (club_id, feature) do update set enabled = true;

create function t.u(k text) returns uuid language sql immutable as $$ select md5('t128:' || k)::uuid $$;
create function t.cv(p_versao text, p_codigo text) returns uuid language sql stable security definer as $$ select public.curriculo_uuid('class:' || p_versao || ':' || p_codigo) $$;
-- fotografia de tudo que a prévia poderia (indevidamente) mexer
create function t.foto() returns text language sql stable security definer as $$
  select md5(concat_ws('|',
    (select md5(coalesce(string_agg(x::text, '' order by x::text), '')) from public.member_classes x),
    (select md5(coalesce(string_agg(x::text, '' order by x::text), '')) from public.member_requirements x),
    (select md5(coalesce(string_agg(x::text, '' order by x::text), '')) from public.requirement_approvals x),
    (select md5(coalesce(string_agg(x::text, '' order by x::text), '')) from public.requirement_submissions x),
    (select md5(coalesce(string_agg(x::text, '' order by x::text), '')) from public.class_requirement_equivalencias x),
    (select md5(coalesce(string_agg(x::text, '' order by x::text), '')) from public.class_requirements x),
    (select md5(coalesce(string_agg(x::text, '' order by x::text), '')) from public.classes x),
    (select md5(coalesce(string_agg(x::text, '' order by x::text), '')) from public.curriculum_versions x),
    (select md5(coalesce(string_agg(x::text, '' order by x::text), '')) from public.class_completion_events x),
    (select md5(coalesce(string_agg(x::text, '' order by x::text), '')) from public.class_completion_snapshots x),
    (select md5(coalesce(string_agg(x::text, '' order by x::text), '')) from public.curriculum_achievements x),
    (select md5(coalesce(string_agg(x::text, '' order by x::text), '')) from public.auditoria_operacoes x))) $$;

-- ==================== 0) o mapa explícito nasce VAZIO (nada de regra inventada) ====================
select t.eq('0) o mapa de equivalências nasce vazio', (select count(*) from public.class_requirement_equivalencias), 0);
select t.eq('0) RLS ligada na tabela do mapa', (select relrowsecurity from pg_class where oid = 'public.class_requirement_equivalencias'::regclass), true);
select t.eq('0) ...sem nenhuma policy (só migration/dono do banco escreve e lê)', (select count(*) from pg_policy where polrelid = 'public.class_requirement_equivalencias'::regclass), 0);
select t.eq('0) a prévia é STABLE (não escreve)', (select provolatile::text from pg_proc where oid = 'public.classe_atualizacao_previa(uuid)'::regprocedure), 's');
select t.eq('0) anon não executa a prévia', has_function_privilege('anon', 'public.classe_atualizacao_previa(uuid)', 'execute'), false);
select t.eq('0) authenticated executa a prévia', has_function_privilege('authenticated', 'public.classe_atualizacao_previa(uuid)', 'execute'), true);
select t.eq('0) a assinatura interna não é chamável pelo cliente', has_function_privilege('authenticated', 'public._classe_requisito_assinatura(uuid)', 'execute'), false);
select t.eq('0) o mapa tem o gatilho da manutenção', (select count(*) from pg_trigger where tgrelid = 'public.class_requirement_equivalencias'::regclass and tgname = 'zz_manutencao_guarda'), 1);

-- ==================== fixture sintética: classe "tc" em duas versões ====================
insert into public.curriculum_versions (id, origem, identificador, versao, status, vigente_desde, fonte_descricao) values
  (t.u('v1'), 'oficial', 'teste-atualizacao-previa', 'v1', 'arquivado', '2026-01-01', 'fixture 128'),
  (t.u('v2'), 'oficial', 'teste-atualizacao-previa', 'v2', 'publicado', '2026-06-01', 'fixture 128');
insert into public.classes (id, curriculum_version_id, codigo, nome, manifesto_id) values
  (t.u('c1'), t.u('v1'), 'tc', 'Classe Teste', 'tc'), (t.u('c2'), t.u('v2'), 'tc', 'Classe Teste', 'tc');
insert into public.class_sections (id, class_id, codigo, nome, ordem, manifesto_id) values
  (t.u('s1'), t.u('c1'), 'I', 'Seção I', 10, 'tc.I'), (t.u('s2'), t.u('c2'), 'I', 'Seção I', 10, 'tc.I');

-- v1
insert into public.class_requirements (id, section_id, codigo, descricao, tipo_evidencia, evidencia_obrigatoria, ordem, manifesto_id) values
  (t.u('a1'),  t.u('s1'), '1',  'Texto estável um.',               'nenhuma', false, 10,  'tc.I.1'),
  (t.u('a2'),  t.u('s1'), '2',  'Texto estável dois.',             'nenhuma', false, 20,  'tc.I.2'),
  (t.u('a3'),  t.u('s1'), '3',  'Ler o capítulo 3 do livro.',      'nenhuma', false, 30,  'tc.I.3'),
  (t.u('a4'),  t.u('s1'), '4',  'Fazer a atividade quatro.',       'nenhuma', false, 40,  'tc.I.4'),
  (t.u('a5'),  t.u('s1'), '5',  'Entregar o relatório cinco.',     'nenhuma', false, 50,  'tc.I.5'),
  (t.u('a6'),  t.u('s1'), '6',  'Texto estável seis.',             'nenhuma', false, 60,  'tc.I.6'),
  (t.u('a7'),  t.u('s1'), '7',  'Participar do evento sete.',      'nenhuma', false, 70,  'tc.I.7'),
  (t.u('a9'),  t.u('s1'), '9',  'Requisito removido nove.',        'nenhuma', false, 90,  'tc.I.9'),
  (t.u('a10'), t.u('s1'), '10', 'Texto estável dez.',              'nenhuma', false, 100, 'tc.I.10'),
  (t.u('a11'), t.u('s1'), '11', 'Ler o livro.',                    'nenhuma', false, 110, 'tc.I.11'),
  (t.u('a12'), t.u('s1'), '12', 'Escolher uma especialidade.',     'nenhuma', false, 120, 'tc.I.12'),
  (t.u('a13'), t.u('s1'), '13', 'Texto estável treze.',            'nenhuma', false, 130, 'tc.I.13');
-- v2
insert into public.class_requirements (id, section_id, codigo, descricao, tipo_evidencia, evidencia_obrigatoria, ordem, manifesto_id) values
  (t.u('b1'),  t.u('s2'), '1',  'Texto estável um.',                              'nenhuma', false, 10,  'tc.I.1'),
  (t.u('b2'),  t.u('s2'), '2',  'Texto estável dois.',                            'nenhuma', false, 20,  'tc.I.2'),
  (t.u('b3'),  t.u('s2'), '3',  'Ler o capitulo 3 do livro do ano.',              'nenhuma', false, 30,  'tc.I.3'),
  (t.u('b4'),  t.u('s2'), '4',  'Fazer a atividade quatro com o grupo.',          'nenhuma', false, 40,  'tc.I.4'),
  (t.u('b5'),  t.u('s2'), '5',  'Entregar relatório de cinco páginas.',           'nenhuma', false, 50,  'tc.I.5'),
  (t.u('b6'),  t.u('s2'), '6',  'Texto estável seis.',                            'texto',   true,  60,  'tc.I.6'),
  (t.u('b70'), t.u('s2'), '70', 'Participar do evento sete (renumerado).',        'nenhuma', false, 70,  'tc.I.70'),
  (t.u('b8'),  t.u('s2'), '8',  'Requisito novo oito.',                           'nenhuma', false, 80,  'tc.I.8'),
  (t.u('b10'), t.u('s2'), '10', 'Texto estável dez.',                             'nenhuma', false, 100, 'tc.I.10'),
  (t.u('b11'), t.u('s2'), '11', 'ler o livro',                                    'nenhuma', false, 110, 'tc.I.11'),
  (t.u('b12'), t.u('s2'), '12', 'Escolher uma especialidade.',                    'nenhuma', false, 120, 'tc.I.12'),
  (t.u('b13'), t.u('s2'), '13', 'Texto estável treze.',                           'nenhuma', false, 130, 'tc.I.13');
-- escolhas N-de-M: tc.I.12 muda de opções (config diferente); tc.I.13 tem as MESMAS opções (preservado)
insert into public.requirement_option_groups (id, alvo_tipo, alvo_id, n_minimo) values
  (t.u('g12a'), 'class_requirement', t.u('a12'), 1), (t.u('g12b'), 'class_requirement', t.u('b12'), 1),
  (t.u('g13a'), 'class_requirement', t.u('a13'), 1), (t.u('g13b'), 'class_requirement', t.u('b13'), 1);
insert into public.requirement_options (grupo_id, rotulo, ordem) values
  (t.u('g12a'), 'Felinos', 10), (t.u('g12a'), 'Cães', 20),
  (t.u('g12b'), 'Felinos', 10), (t.u('g12b'), 'Aves', 20),
  (t.u('g13a'), 'Felinos', 10), (t.u('g13a'), 'Cães', 20),
  (t.u('g13b'), 'Felinos', 10), (t.u('g13b'), 'Cães', 20);

-- o mapa EXPLÍCITO desta fixture (vindo "do manifesto"): editorial, material e um equivalente renumerado
insert into public.class_requirement_equivalencias (identificador, versao_origem, versao_destino, requisito_origem, requisito_destino, tipo, fonte) values
  ('teste-atualizacao-previa', 'v1', 'v2', 'tc.I.3', 'tc.I.3',  'editorial',   'fixture 128: correção de grafia declarada'),
  ('teste-atualizacao-previa', 'v1', 'v2', 'tc.I.5', 'tc.I.5',  'material',    'fixture 128: o relatório mudou de natureza'),
  ('teste-atualizacao-previa', 'v1', 'v2', 'tc.I.7', 'tc.I.70', 'equivalente', 'fixture 128: renumeração declarada');

-- matrículas na v1: membro_a (clube A); multi nos DOIS clubes; membro_a2 já na v2; membro_b no REAL 2026.3
insert into public.member_classes (id, usuario_id, club_id, class_id) values
  (t.u('mc_a'),  t.id('membro_a'), t.id('clube_a'), t.u('c1')),
  (t.u('mc_ma'), t.id('multi_dois_papeis'), t.id('clube_a'), t.u('c1')),
  (t.u('mc_mb'), t.id('multi_dois_papeis'), t.id('clube_b'), t.u('c1')),
  (t.u('mc_a2'), t.id('membro_a2'), t.id('clube_a'), t.u('c2'));
insert into public.member_requirements (member_class_id, requirement_id, status)
select mc.id, r.id,
       case when r.manifesto_id in ('tc.I.2', 'tc.I.12') then 'em_andamento' else 'aprovado' end
  from (values (t.u('mc_a')), (t.u('mc_ma')), (t.u('mc_mb'))) mc(id)
  cross join public.class_requirements r where r.section_id = t.u('s1');
insert into public.member_requirements (member_class_id, requirement_id)
select t.u('mc_a2'), r.id from public.class_requirements r where r.section_id = t.u('s2');
-- aprovações rastreáveis (de verdade) para tudo que está 'aprovado', EXCETO tc.I.10 (aprovado sem rastro)
insert into public.requirement_approvals (member_requirement_id, requirement_id, curriculum_version_id, club_id, decisao, avaliado_por, avaliado_papel)
select mr.id, mr.requirement_id, t.u('v1'), mr.club_id, 'aprovado', t.id(case when mr.club_id = t.id('clube_a') then 'lider_a' else 'lider_b' end), 'diretoria'
  from public.member_requirements mr join public.class_requirements r on r.id = mr.requirement_id
 where mr.member_class_id in (t.u('mc_a'), t.u('mc_ma'), t.u('mc_mb')) and mr.status = 'aprovado' and r.manifesto_id <> 'tc.I.10';
-- multi no B já tem matrícula na versão vigente (v2)
insert into public.member_classes (id, usuario_id, club_id, class_id) values (t.u('mc_mb2'), t.id('multi_dois_papeis'), t.id('clube_b'), t.u('c2'));

-- caso REAL: membro_b na Amigo 2026.3 (arquivada), 2 requisitos aprovados com aprovação rastreável
insert into public.member_classes (id, usuario_id, club_id, class_id) values
  (t.u('mc_real'), t.id('membro_b'), t.id('clube_b'), public.curriculo_uuid('class:2026.3:amigo'));
insert into public.member_requirements (member_class_id, requirement_id, status)
select t.u('mc_real'), r.id, case when r.id in (select x.id from public.class_requirements x join public.class_sections xs on xs.id = x.section_id
                                                  where xs.class_id = public.curriculo_uuid('class:2026.3:amigo') order by x.manifesto_id limit 2) then 'aprovado' else 'nao_iniciado' end
  from public.class_requirements r join public.class_sections s on s.id = r.section_id and s.class_id = public.curriculo_uuid('class:2026.3:amigo');
insert into public.requirement_approvals (member_requirement_id, requirement_id, curriculum_version_id, club_id, decisao, avaliado_por, avaliado_papel)
select mr.id, mr.requirement_id, (select curriculum_version_id from public.classes where id = public.curriculo_uuid('class:2026.3:amigo')),
       mr.club_id, 'aprovado', t.id('lider_b'), 'diretoria'
  from public.member_requirements mr where mr.member_class_id = t.u('mc_real') and mr.status = 'aprovado';

-- helpers de leitura (rodam como o papel atual; a prévia é security definer)
create function t.cat(p_mc uuid, p_mid text) returns text language sql stable as $$
  select e ->> 'categoria' from jsonb_array_elements(public.classe_atualizacao_previa(p_mc) -> 'requisitos') e where e #>> '{destino,manifesto_id}' = p_mid $$;
create function t.mot(p_mc uuid, p_mid text) returns text language sql stable as $$
  select e ->> 'motivo' from jsonb_array_elements(public.classe_atualizacao_previa(p_mc) -> 'requisitos') e where e #>> '{destino,manifesto_id}' = p_mid $$;
create function t.cum(p_mc uuid, p_mid text) returns text language sql stable as $$
  select e ->> 'cumprido_na_versao_anterior' from jsonb_array_elements(public.classe_atualizacao_previa(p_mc) -> 'requisitos') e where e #>> '{destino,manifesto_id}' = p_mid $$;
create function t.cont(p_mc uuid) returns text language sql stable as $$
  select (c ->> 'preservado') || '/' || (c ->> 'inalterado') || '/' || (c ->> 'equivalente') || '/' || (c ->> 'novo') || '/' || (c ->> 'refazer') || '/' || (c ->> 'removido') || '/' || (c ->> 'total_requisitos_vigentes')
    from (select public.classe_atualizacao_previa(p_mc) -> 'contagens' c) x $$;

create table t.antes as select t.foto() as f;

-- ==================== 1) a própria pessoa vê a prévia (cada categoria) ====================
select t.como('membro_a'); select t.pedir_clube('clube_a');
select t.eq('1) existe atualização v1 -> v2 e a matrícula é atualizável',
  (public.classe_atualizacao_previa(t.u('mc_a')) ->> 'existe_atualizacao') || '|' || (public.classe_atualizacao_previa(t.u('mc_a')) ->> 'atualizavel'), 'true|true');
select t.eq('1) versão da matrícula = v1 e vigente = v2 (mesmo código, publicada)',
  (public.classe_atualizacao_previa(t.u('mc_a')) #>> '{versao_da_matricula,versao}') || '>' || (public.classe_atualizacao_previa(t.u('mc_a')) #>> '{versao_vigente,versao}'), 'v1>v2');
select t.eq('1) tc.I.1 (mesmo id, descrição e configuração idênticas, aprovado) = preservado', t.cat(t.u('mc_a'), 'tc.I.1'), 'preservado');
select t.eq('1) ...e cumprido na versão anterior', t.cum(t.u('mc_a'), 'tc.I.1'), 'true');
select t.eq('1) tc.I.2 (idêntico, ainda NÃO aprovado) = inalterado, sem "cumprido"', t.cat(t.u('mc_a'), 'tc.I.2') || '|' || t.cum(t.u('mc_a'), 'tc.I.2'), 'inalterado|false');
select t.eq('1) tc.I.3 (mapa EDITORIAL) = equivalente, cumprido', t.cat(t.u('mc_a'), 'tc.I.3') || '|' || t.mot(t.u('mc_a'), 'tc.I.3') || '|' || t.cum(t.u('mc_a'), 'tc.I.3'), 'equivalente|mapa_editorial|true');
select t.eq('1) tc.I.4 (descrição diferente SEM regra) = refazer', t.cat(t.u('mc_a'), 'tc.I.4') || '|' || t.mot(t.u('mc_a'), 'tc.I.4') || '|' || t.cum(t.u('mc_a'), 'tc.I.4'),
  'refazer|descricao_diferente_sem_regra_explicita|false');
select t.eq('1) tc.I.5 (mapa MATERIAL) = refazer', t.cat(t.u('mc_a'), 'tc.I.5') || '|' || t.mot(t.u('mc_a'), 'tc.I.5'), 'refazer|mapa_material');
select t.eq('1) tc.I.6 (mesma descrição, evidência diferente, sem regra) = refazer por configuração', t.cat(t.u('mc_a'), 'tc.I.6') || '|' || t.mot(t.u('mc_a'), 'tc.I.6'),
  'refazer|configuracao_diferente_sem_regra_explicita');
select t.eq('1) tc.I.70 (mapa EQUIVALENTE renumerado tc.I.7 -> tc.I.70) = equivalente, cumprido', t.cat(t.u('mc_a'), 'tc.I.70') || '|' || t.cum(t.u('mc_a'), 'tc.I.70'), 'equivalente|true');
select t.eq('1) tc.I.8 (só na versão nova) = novo', t.cat(t.u('mc_a'), 'tc.I.8') || '|' || t.mot(t.u('mc_a'), 'tc.I.8'), 'novo|sem_origem');
select t.eq('1) tc.I.10 (aprovado SEM aprovação rastreável) = inalterado, NÃO cumprido', t.cat(t.u('mc_a'), 'tc.I.10') || '|' || t.cum(t.u('mc_a'), 'tc.I.10'), 'inalterado|false');
select t.eq('1) ...e a origem diz aprovacao_rastreavel=false',
  (select e #>> '{origem,aprovacao_rastreavel}' from jsonb_array_elements(public.classe_atualizacao_previa(t.u('mc_a')) -> 'requisitos') e where e #>> '{destino,manifesto_id}' = 'tc.I.10'), 'false');
select t.eq('1) tc.I.11 (só muda a CAIXA do texto) = refazer: nada de similaridade', t.cat(t.u('mc_a'), 'tc.I.11'), 'refazer');
select t.eq('1) tc.I.12 (opções do N-de-M mudaram) = refazer por configuração', t.cat(t.u('mc_a'), 'tc.I.12') || '|' || t.mot(t.u('mc_a'), 'tc.I.12'), 'refazer|configuracao_diferente_sem_regra_explicita');
select t.eq('1) tc.I.13 (N-de-M com as MESMAS opções, aprovado) = preservado', t.cat(t.u('mc_a'), 'tc.I.13'), 'preservado');
select t.eq('1) contagens preservado/inalterado/equivalente/novo/refazer/removido/total', t.cont(t.u('mc_a')), '2/2/2/1/5/1/12');
select t.eq('1) removido: só tc.I.9 (tc.I.7 NÃO aparece: o mapa o destinou a tc.I.70)',
  (select string_agg(e #>> '{origem,manifesto_id}', ',' order by e #>> '{origem,manifesto_id}') from jsonb_array_elements(public.classe_atualizacao_previa(t.u('mc_a')) -> 'removidos') e), 'tc.I.9');
select t.eq('1) ...com o status e a aprovação antigos à vista',
  (select (e #>> '{origem,status}') || '|' || (e ->> 'cumprido_na_versao_anterior') from jsonb_array_elements(public.classe_atualizacao_previa(t.u('mc_a')) -> 'removidos') e limit 1), 'aprovado|true');
select t.eq('1) a regra por mapa vem declarada (via, tipo, fonte)',
  (select (e #>> '{regra,via}') || '|' || (e #>> '{regra,tipo}') || '|' || (e #>> '{regra,fonte}') from jsonb_array_elements(public.classe_atualizacao_previa(t.u('mc_a')) -> 'requisitos') e where e #>> '{destino,manifesto_id}' = 'tc.I.3'),
  'mapa_explicito|editorial|fixture 128: correção de grafia declarada');
select t.eq('1) sem mapa, a regra é "mesmo_manifesto_id"',
  (select e #>> '{regra,via}' from jsonb_array_elements(public.classe_atualizacao_previa(t.u('mc_a')) -> 'requisitos') e where e #>> '{destino,manifesto_id}' = 'tc.I.1'), 'mesmo_manifesto_id');
select t.eq('1) o mapa tem 3 linhas para este par de versões', (public.classe_atualizacao_previa(t.u('mc_a')) ->> 'mapa_explicito_linhas'), '3');
select t.eq('1) nenhuma evidência/texto de pessoa vaza no JSON (só campos combinados na origem)',
  (select string_agg(k, ',' order by k) from (select jsonb_object_keys(e -> 'origem') k from jsonb_array_elements(public.classe_atualizacao_previa(t.u('mc_a')) -> 'requisitos') e where e #>> '{destino,manifesto_id}' = 'tc.I.1') z),
  'aprovacao_rastreavel,aprovado_em,aprovado_papel,codigo,descricao,manifesto_id,member_requirement_id,requirement_id,status');
select t.eq('1) sem matrícula na versão vigente ainda', coalesce(public.classe_atualizacao_previa(t.u('mc_a')) ->> 'ja_tem_matricula_na_versao_vigente', 'nulo'), 'nulo');
reset role;

-- ==================== 2) liderança do clube da matrícula ====================
select t.como('lider_a'); select t.pedir_clube('clube_a');
select t.eq('2) diretoria do A vê a prévia da matrícula do A', t.cont(t.u('mc_a')), '2/2/2/1/5/1/12');
reset role;
select t.como('instrutor_a'); select t.pedir_clube('clube_a');
select t.eq('2) instrutor do A também', t.cont(t.u('mc_a')), '2/2/2/1/5/1/12');
reset role;
select t.como('conselheiro_a'); select t.pedir_clube('clube_a');
select t.throws('2) conselheiro NÃO (não avalia currículo)', format($q$select public.classe_atualizacao_previa(%L)$q$, t.u('mc_a')), 'Matrícula não encontrada neste clube.');
reset role;
select t.como('tesoureiro_a'); select t.pedir_clube('clube_a');
select t.throws('2) tesoureiro NÃO', format($q$select public.classe_atualizacao_previa(%L)$q$, t.u('mc_a')), 'Matrícula não encontrada neste clube.');
reset role;
select t.como('pais_a'); select t.pedir_clube('clube_a');
select t.throws('2) responsável (pais) NÃO', format($q$select public.classe_atualizacao_previa(%L)$q$, t.u('mc_a')), 'Matrícula não encontrada neste clube.');
reset role;

-- ==================== 3) isolamento: outra pessoa, outro clube, UUID forjado, anon ====================
select t.como('membro_a2'); select t.pedir_clube('clube_a');
select t.throws('3) outro desbravador do MESMO clube NÃO vê a matrícula alheia', format($q$select public.classe_atualizacao_previa(%L)$q$, t.u('mc_a')), 'Matrícula não encontrada neste clube.');
reset role;
select t.como('lider_b'); select t.pedir_clube('clube_b');
select t.throws('3) diretoria do OUTRO clube (B) NÃO vê matrícula do A', format($q$select public.classe_atualizacao_previa(%L)$q$, t.u('mc_a')), 'Matrícula não encontrada neste clube.');
select t.pedir_clube('clube_a');
select t.throws('3) ...nem pedindo o clube A no cabeçalho (não tem vínculo lá: fica sem clube)', format($q$select public.classe_atualizacao_previa(%L)$q$, t.u('mc_a')), 'Sem clube em uso.');
reset role;
select t.como('lider_a'); select t.pedir_clube('clube_a');
select t.throws('3) UUID forjado: mesma mensagem (sem oráculo)', $q$select public.classe_atualizacao_previa('00000000-0000-4000-8000-000000000001')$q$, 'Matrícula não encontrada neste clube.');
select t.throws('3) UUID nulo: mesma mensagem', $q$select public.classe_atualizacao_previa(null)$q$, 'Matrícula não encontrada neste clube.');
select t.throws('3) a diretoria do A não alcança a matrícula do B (clube derivado do servidor)', format($q$select public.classe_atualizacao_previa(%L)$q$, t.u('mc_real')), 'Matrícula não encontrada neste clube.');
reset role;
select t.como_anon();
select t.throws('3) anon: sem permissão de execução', format($q$select public.classe_atualizacao_previa(%L)$q$, t.u('mc_a')), 'permission denied');
reset role;
select t.como('membro_a');
select set_config('request.headers', '{"x-clube-atual":"00000000-0000-4000-8000-0000000000aa"}', true);
select t.throws('3) clube pedido inexistente: requisição fica SEM clube', format($q$select public.classe_atualizacao_previa(%L)$q$, t.u('mc_a')), 'Sem clube em uso.');
reset role;

-- ==================== 4) multiclube: a matrícula do A não toca a do B ====================
select t.como('multi_dois_papeis'); select t.pedir_clube('clube_a');
select t.eq('4) multi no A: prévia da matrícula do A', t.cont(t.u('mc_ma')), '2/2/2/1/5/1/12');
select t.eq('4) ...sem matrícula na versão vigente no A', coalesce(public.classe_atualizacao_previa(t.u('mc_ma')) ->> 'ja_tem_matricula_na_versao_vigente', 'nulo'), 'nulo');
select t.throws('4) multi no A NÃO alcança a matrícula do B', format($q$select public.classe_atualizacao_previa(%L)$q$, t.u('mc_mb')), 'Matrícula não encontrada neste clube.');
select t.pedir_clube('clube_b');
select t.eq('4) multi no B: prévia da matrícula do B', t.cont(t.u('mc_mb')), '2/2/2/1/5/1/12');
select t.eq('4) ...e o B enxerga a matrícula que já tem na versão vigente (v2)',
  public.classe_atualizacao_previa(t.u('mc_mb')) #>> '{ja_tem_matricula_na_versao_vigente,member_class_id}', t.u('mc_mb2')::text);
select t.throws('4) multi no B NÃO alcança a matrícula do A', format($q$select public.classe_atualizacao_previa(%L)$q$, t.u('mc_ma')), 'Matrícula não encontrada neste clube.');
reset role;

-- ==================== 5) matrícula já na versão vigente / fora de andamento ====================
select t.como('membro_a2'); select t.pedir_clube('clube_a');
select t.eq('5) matrícula na versão VIGENTE: existe_atualizacao=false, motivo, nada listado',
  (public.classe_atualizacao_previa(t.u('mc_a2')) ->> 'existe_atualizacao') || '|' || (public.classe_atualizacao_previa(t.u('mc_a2')) ->> 'motivo') || '|'
  || jsonb_array_length(public.classe_atualizacao_previa(t.u('mc_a2')) -> 'requisitos') || '|' || jsonb_array_length(public.classe_atualizacao_previa(t.u('mc_a2')) -> 'removidos'),
  'false|ja_na_versao_vigente|0|0');
reset role;
select t.eq('5) (antes de mexer na fixture) as seções 1-4 não gravaram NADA', t.foto(), (select f from t.antes));
update public.member_classes set status = 'aguardando_revisao' where id = t.u('mc_ma');
create table t.antes2 as select t.foto() as f;
select t.como('multi_dois_papeis'); select t.pedir_clube('clube_a');
select t.eq('5) matrícula fora de andamento: existe atualização mas NÃO atualizável (motivo explícito)',
  (public.classe_atualizacao_previa(t.u('mc_ma')) ->> 'existe_atualizacao') || '|' || (public.classe_atualizacao_previa(t.u('mc_ma')) ->> 'atualizavel') || '|' || (public.classe_atualizacao_previa(t.u('mc_ma')) ->> 'motivo'),
  'true|false|matricula_nao_em_andamento');
reset role;

-- ==================== 6) caso REAL: Amigo 2026.3 -> 2026.4 (conteúdo idêntico) ====================
select t.como('membro_b'); select t.pedir_clube('clube_b');
select t.eq('6) real: versões 2026.3 > 2026.4', (public.classe_atualizacao_previa(t.u('mc_real')) #>> '{versao_da_matricula,versao}') || '>' || (public.classe_atualizacao_previa(t.u('mc_real')) #>> '{versao_vigente,versao}'), '2026.3>2026.4');
select t.eq('6) real: mapa vazio (0 linhas)', public.classe_atualizacao_previa(t.u('mc_real')) ->> 'mapa_explicito_linhas', '0');
select t.eq('6) real: 2 preservados, resto inalterado, 0 novo/refazer/removido',
  (select (c ->> 'preservado') || '|' || (c ->> 'novo') || '|' || (c ->> 'refazer') || '|' || (c ->> 'removido') || '|' || (((c ->> 'preservado')::int + (c ->> 'inalterado')::int)::text) || '|' || (c ->> 'total_requisitos_vigentes')
     from (select public.classe_atualizacao_previa(t.u('mc_real')) -> 'contagens' c) x),
  '2|0|0|0|' || (select count(*) from public.class_requirements r join public.class_sections s on s.id = r.section_id
                  where s.class_id = t.cv('2026.4', 'amigo') and r.ativo) || '|' ||
                (select count(*) from public.class_requirements r join public.class_sections s on s.id = r.section_id
                  where s.class_id = t.cv('2026.4', 'amigo') and r.ativo));
reset role;

-- ==================== 7) o mapa: sem escrita pela API, imutável, 1:1, só versões que existem ====================
select t.como('lider_a'); select t.pedir_clube('clube_a');
select t.throws('7) diretoria não lê o mapa direto', $q$select count(*) from public.class_requirement_equivalencias$q$, 'permission denied');
select t.throws('7) ...nem escreve', $q$insert into public.class_requirement_equivalencias (identificador, versao_origem, versao_destino, requisito_origem, requisito_destino, tipo, fonte) values ('teste-atualizacao-previa','v1','v2','tc.I.1','tc.I.1','equivalente','tentativa de cliente 123')$q$, 'permission denied');
reset role;
select t.como('membro_a'); select t.pedir_clube('clube_a');
select t.throws('7) membro não escreve no mapa', $q$insert into public.class_requirement_equivalencias (identificador, versao_origem, versao_destino, requisito_origem, requisito_destino, tipo, fonte) values ('teste-atualizacao-previa','v1','v2','tc.I.1','tc.I.1','equivalente','tentativa de cliente 123')$q$, 'permission denied');
reset role;
select t.como_anon();
select t.throws('7) anon não lê o mapa', $q$select count(*) from public.class_requirement_equivalencias$q$, 'permission denied');
reset role;
select t.throws('7) nem o dono do banco ALTERA uma linha do mapa', $q$update public.class_requirement_equivalencias set tipo = 'equivalente' where requisito_origem = 'tc.I.5'$q$, 'imutável');
select t.throws('7) ...nem APAGA', $q$delete from public.class_requirement_equivalencias where requisito_origem = 'tc.I.5'$q$, 'imutável');
select t.throws('7) 1:1 — segunda linha para a mesma ORIGEM é recusada', $q$insert into public.class_requirement_equivalencias (identificador, versao_origem, versao_destino, requisito_origem, requisito_destino, tipo, fonte) values ('teste-atualizacao-previa','v1','v2','tc.I.3','tc.I.99','equivalente','duplicada na origem 123')$q$, 'duplicate key');
select t.throws('7) 1:1 — segunda linha para o mesmo DESTINO é recusada (fusão não é equivalente)', $q$insert into public.class_requirement_equivalencias (identificador, versao_origem, versao_destino, requisito_origem, requisito_destino, tipo, fonte) values ('teste-atualizacao-previa','v1','v2','tc.I.99','tc.I.3','equivalente','duplicada no destino 123')$q$, 'duplicate key');
select t.throws('7) versão inexistente é recusada (FK)', $q$insert into public.class_requirement_equivalencias (identificador, versao_origem, versao_destino, requisito_origem, requisito_destino, tipo, fonte) values ('teste-atualizacao-previa','v1','v9','tc.I.50','tc.I.50','equivalente','versão que não existe 123')$q$, 'violates foreign key');
select t.throws('7) tipo fora de editorial/equivalente/material é recusado', $q$insert into public.class_requirement_equivalencias (identificador, versao_origem, versao_destino, requisito_origem, requisito_destino, tipo, fonte) values ('teste-atualizacao-previa','v1','v2','tc.I.50','tc.I.50','parecido','tipo inventado 1234')$q$, 'check');
select t.throws('7) fonte (regra declarada) obrigatória', $q$insert into public.class_requirement_equivalencias (identificador, versao_origem, versao_destino, requisito_origem, requisito_destino, tipo, fonte) values ('teste-atualizacao-previa','v1','v2','tc.I.50','tc.I.50','equivalente','')$q$, 'check');
select t.throws('7) origem = destino na mesma versão é recusado', $q$insert into public.class_requirement_equivalencias (identificador, versao_origem, versao_destino, requisito_origem, requisito_destino, tipo, fonte) values ('teste-atualizacao-previa','v1','v1','tc.I.50','tc.I.50','equivalente','mesma versão nos dois lados')$q$, 'check');

-- ==================== 8) nada foi gravado pela prévia ====================
select t.eq('8) fotografia de member_classes/requisitos/aprovações/submissões/mapa/currículo/eventos/snapshots/conquistas/auditoria IDÊNTICA', t.foto(), (select f from t.antes2));
select t.eq('8) o mapa continua com 3 linhas', (select count(*) from public.class_requirement_equivalencias), 3);
select t.eq('8) nenhuma matrícula nova nasceu', (select count(*) from public.member_classes where class_id = t.u('c2')), 2);

select t.fim();
rollback;
