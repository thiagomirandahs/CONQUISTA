-- Classes entre clubes e sem nascimento (migration 519). Decisões do dono:
--  * conclusão = conquista ATIVA da pessoa (qualquer clube) satisfaz a dependência em qualquer clube;
--  * regular apenas INICIADA em outro clube NÃO libera a avançada (iniciada só vale no clube atual);
--  * classe já concluída em outro clube NÃO é oferecida nem pode ser (re)iniciada/atribuída (sem 2ª conclusão);
--  * classes_concluidas_anteriormente(): as conquistas da própria pessoa em OUTROS clubes (só o nome do clube);
--  * sem data de nascimento, classe com idade mínima não matricula (nem atribuída pela diretoria).
begin;
\ir _lib.sql
\ir _curriculo_regular_2026.sql
\ir _fixtures.sql
insert into public.club_features (club_id, feature, enabled) values (t.id('clube_a'), 'classes', true), (t.id('clube_b'), 'classes', true)
on conflict (club_id, feature) do update set enabled = true;

create function t.classe(p_codigo text) returns uuid language sql stable security definer as $$
  select public.curriculo_uuid('class:2026.4:' || p_codigo) $$;
create function t.classe_v(p_versao text, p_codigo text) returns uuid language sql stable security definer as $$
  select public.curriculo_uuid('class:' || p_versao || ':' || p_codigo) $$;
-- "elegivel|bloqueio|anterior" de UMA classe em classes_disponiveis() (como o papel atual); '-' se não listada
create function t.d(p_codigo text) returns text language sql stable as $$
  select coalesce((select (c->>'elegivel') || '|' || coalesce(c->>'bloqueio', '-') || '|' || (c->>'anterior')
                     from json_array_elements(public.classes_disponiveis()) c where c->>'codigo' = p_codigo), '-') $$;
create function t.nasce(p_chave text, p_anos int) returns void language sql as $$
  update public.profiles set nascimento = (current_date - make_interval(years => p_anos))::date where id = t.id(p_chave) $$;
create function t.mc(p_chave text, p_codigo text, p_clube text) returns uuid language sql stable security definer as $$
  select id from public.member_classes where usuario_id = t.id(p_chave) and club_id = t.id(p_clube) and class_id = t.classe(p_codigo) $$;
-- fotografia do que uma conclusão duplicada/indevida NÃO pode criar
create function t.tudo() returns text language sql stable security definer as $$
  select (select count(*) from public.member_classes)::text || '|' || (select count(*) from public.curriculum_achievements) || '|'
      || (select count(*) from public.class_completion_snapshots) || '|' || (select count(*) from public.class_documents) || '|'
      || (select count(*) from public.class_investitures) || '|' || (select count(*) from public.member_requirements) $$;
-- o fluxo real termina em member_classes.status='investida' + conquista ativa (gatilho do motor; simulado como o teste 124/74)
create function t.concluir(p_chave text, p_codigo text, p_clube text) returns void language sql security definer as $$
  update public.member_classes set status = 'investida', concluida_em = now() - interval '2 days', investida_em = now() - interval '1 day'
   where id = t.mc(p_chave, p_codigo, p_clube) $$;
-- lista crua de classes_concluidas_anteriormente como "codigo:clube" em ordem
create function t.ant() returns text language sql stable as $$
  select coalesce(string_agg((x->>'codigo') || ':' || (x->>'origem_clube_nome'), ',' order by ord), '') from json_array_elements(public.classes_concluidas_anteriormente()) with ordinality as a(x, ord) $$;

select t.signup('sem_clube', jsonb_build_object('nome', 'Sem Clube', 'cargo', 'Desbravador', 'nascimento', (current_date - interval '13 years')::date::text));
-- multi_dois_papeis: desbravador no A, conselheiro no B, nascimento 2013-01-01 (13 anos), SEM nenhuma matrícula ainda.
-- lider_a / lider_b: diretoria de cada clube (adultos pela fixture). membro_a (12 anos, só A), membro_b (só B).

-- ==================== 1) regular INICIADA no B não libera a avançada no A ====================
select t.como('multi_dois_papeis'); select t.pedir_clube('clube_b');
select t.permitido('1) multi inicia Amigo no clube B', format($q$select public.classe_iniciar(%L)$q$, t.classe('amigo')));
select t.eq('1) no B a avançada Amigo da Natureza está liberada (a regular está iniciada AQUI)', t.d('amigo_da_natureza'), 'true|-|true');
select t.pedir_clube('clube_a');
select t.eq('1) no A: Amigo da Natureza NÃO liberada (elegivel=false, bloqueio pre_requisito)', t.d('amigo_da_natureza'), 'false|pre_requisito|true');
select t.eq('1) no A: o motivo pede a regular Amigo',
  t.txt($q$select c->>'motivo_inelegivel' from json_array_elements(public.classes_disponiveis()) c where c->>'codigo' = 'amigo_da_natureza'$q$),
  'Comece a classe Amigo primeiro: a Classe Avançada é feita junto com ela ou depois dela.');
select t.eq('1) no A: elegivel == (bloqueio is null) em TODAS as linhas',
  t.n($q$select count(*) from json_array_elements(public.classes_disponiveis()) c where (c->>'elegivel')::boolean <> (c->>'bloqueio' is null)$q$), 0);
select t.throws('1) no A: classe_iniciar recusa a avançada (regular iniciada só no B)', format($q$select public.classe_iniciar(%L)$q$, t.classe('amigo_da_natureza')), 'Comece a classe Amigo primeiro');
reset role;
select t.como('lider_a'); select t.pedir_clube('clube_a');
select t.throws('1) no A: classe_atribuir também recusa', format($q$select public.classe_atribuir(%L, %L)$q$, t.id('multi_dois_papeis'), t.classe('amigo_da_natureza')), 'Comece a classe Amigo primeiro');
reset role;
select t.eq('1) ...nenhuma avançada nasceu', (select count(*) from public.member_classes where usuario_id = t.id('multi_dois_papeis') and class_id = t.classe('amigo_da_natureza')), 0);
-- a regra de 4 argumentos recebe o clube explícito; a de 3 usa o clube atual (sem clube atual: iniciada NÃO satisfaz)
select t.como('sem_clube');
reset role;
select t.eq('1) sem clube atual: iniciada NÃO satisfaz (regra de 3 args)', public._dependencia_de_classe_satisfeita(t.id('multi_dois_papeis'), t.classe('amigo'), 'iniciada_ou_concluida'), false);
select t.eq('1) clube explícito B: a iniciada no B satisfaz...', public._dependencia_de_classe_satisfeita(t.id('multi_dois_papeis'), t.classe('amigo'), 'iniciada_ou_concluida', t.id('clube_b')), true);
select t.eq('1) ...clube explícito A: NÃO satisfaz', public._dependencia_de_classe_satisfeita(t.id('multi_dois_papeis'), t.classe('amigo'), 'iniciada_ou_concluida', t.id('clube_a')), false);
select t.eq('1) modo "concluida" nunca aceita só-iniciada', public._dependencia_de_classe_satisfeita(t.id('multi_dois_papeis'), t.classe('amigo'), 'concluida', t.id('clube_b')), false);
select t.eq('1) clube nulo: iniciada não satisfaz', public._dependencia_de_classe_satisfeita(t.id('multi_dois_papeis'), t.classe('amigo'), 'iniciada_ou_concluida', null::uuid), false);
select t.eq('1) dependencias_pendentes (clube A) lista a Amigo; (clube B) não lista nada',
  coalesce(array_to_string(public.dependencias_pendentes('class', t.classe('amigo_da_natureza'), t.id('multi_dois_papeis'), t.id('clube_a')), ','), '') || '|'
  || coalesce(array_to_string(public.dependencias_pendentes('class', t.classe('amigo_da_natureza'), t.id('multi_dois_papeis'), t.id('clube_b')), ','), ''), 'Amigo|');

-- ==================== 2) multiclube: progresso EM ANDAMENTO segue isolado ====================
select t.como('multi_dois_papeis'); select t.pedir_clube('clube_a');
select t.permitido('2) multi inicia Companheiro no A', format($q$select public.classe_iniciar(%L)$q$, t.classe('companheiro')));
select t.pedir_clube('clube_b');
select t.permitido('2) ...e Companheiro no B', format($q$select public.classe_iniciar(%L)$q$, t.classe('companheiro')));
reset role;
select t.como('lider_a'); select t.pedir_clube('clube_a');
select t.permitido('2) a diretoria do A aprova 1 requisito do Companheiro do A',
  format($q$select public.requisito_avaliar((select mr.id from public.member_requirements mr join public.class_requirements r on r.id = mr.requirement_id where mr.member_class_id = %L order by r.manifesto_id limit 1), 'aprovado', 'ok A')$q$, t.mc('multi_dois_papeis', 'companheiro', 'clube_a')));
reset role;
select t.eq('2) duas matrículas distintas do Companheiro (uma por clube)', (select count(distinct id) from public.member_classes where usuario_id = t.id('multi_dois_papeis') and class_id = t.classe('companheiro')), 2);
select t.eq('2) percentual: A > 0 e B = 0 (progresso em andamento NÃO atravessa clubes)',
  (public.classe_percentual(t.mc('multi_dois_papeis', 'companheiro', 'clube_a')) > 0)::text || '|' || public.classe_percentual(t.mc('multi_dois_papeis', 'companheiro', 'clube_b'))::text, 'true|0');
select t.eq('2) nenhum requisito do B saiu de nao_iniciado', (select count(*) from public.member_requirements where member_class_id = t.mc('multi_dois_papeis', 'companheiro', 'clube_b') and status <> 'nao_iniciado'), 0);
select t.como('multi_dois_papeis'); select t.pedir_clube('clube_a');
select t.eq('2) minhas_classes no A = só Companheiro (a Amigo do B não aparece)', t.txt($q$select string_agg(x->>'codigo', ',' order by x->>'codigo') from json_array_elements(public.minhas_classes()) x$q$), 'companheiro');
select t.pedir_clube('clube_b');
select t.eq('2) minhas_classes no B = Amigo e Companheiro', t.txt($q$select string_agg(x->>'codigo', ',' order by x->>'codigo') from json_array_elements(public.minhas_classes()) x$q$), 'amigo,companheiro');
select t.pedir_clube('clube_a');
select t.eq('2) em andamento NÃO entra em classes_concluidas_anteriormente', t.n($q$select json_array_length(public.classes_concluidas_anteriormente())$q$), 0);
reset role;

-- ==================== 3) regular CONCLUÍDA no B libera a avançada no A (proveniência preservada) ====================
select t.concluir('multi_dois_papeis', 'amigo', 'clube_b');
select t.eq('3) a conclusão no B gerou UMA conquista ativa com club_id_origem = B',
  (select count(*) from public.curriculum_achievements a where a.usuario_id = t.id('multi_dois_papeis') and a.classe_id = t.classe('amigo') and a.status = 'ativa' and a.club_id_origem = t.id('clube_b')), 1);
select t.como('multi_dois_papeis'); select t.pedir_clube('clube_a');
select t.eq('3) no A: Amigo da Natureza LIBERADA pela Amigo concluída no B', t.d('amigo_da_natureza'), 'true|-|true');
select t.permitido('3) ...e classe_iniciar a inicia no A', format($q$select public.classe_iniciar(%L)$q$, t.classe('amigo_da_natureza')));
reset role;
select t.eq('3) a conquista da Amigo é a única e continua com club_id_origem = B (proveniência preservada)',
  (select count(*) from public.curriculum_achievements a where a.usuario_id = t.id('multi_dois_papeis') and a.classe_id = t.classe('amigo'))::text || '|' ||
  (select count(*) from public.curriculum_achievements a where a.usuario_id = t.id('multi_dois_papeis') and a.classe_id = t.classe('amigo') and a.club_id_origem = t.id('clube_b')), '1|1');
select t.eq('3) a avançada nasceu no A em andamento, sem conquista', (select status from public.member_classes where id = t.mc('multi_dois_papeis', 'amigo_da_natureza', 'clube_a')), 'em_andamento');
-- a diretoria também atribui uma avançada liberada por conclusão em outro clube (recomeço da mesma matrícula cancelada)
update public.member_classes set status = 'cancelada' where id = t.mc('multi_dois_papeis', 'amigo_da_natureza', 'clube_a');
select t.como('lider_a'); select t.pedir_clube('clube_a');
select t.permitido('3) a diretoria do A atribui a avançada (liberada pela conclusão no B)', format($q$select public.classe_atribuir(%L, %L)$q$, t.id('multi_dois_papeis'), t.classe('amigo_da_natureza')));
reset role;

-- ==================== 4) conclusão NÃO duplicada: classe concluída em outro clube não é oferecida nem iniciada/atribuída ====================
create table t.foto as select t.tudo() as antes;
select t.como('multi_dois_papeis'); select t.pedir_clube('clube_a');
select t.eq('4) classes_disponiveis no A NÃO oferece a Amigo (concluída no B)', t.d('amigo'), '-');
select t.throws('4) classe_iniciar da Amigo no A: recusa com o nome do clube de origem', format($q$select public.classe_iniciar(%L)$q$, t.classe('amigo')), 'Esta classe já foi concluída por você em Clube B (teste).');
reset role;
select t.como('lider_a'); select t.pedir_clube('clube_a');
select t.throws('4) classe_atribuir da Amigo no A: recusa (versão neutra, sem nome de clube)', format($q$select public.classe_atribuir(%L, %L)$q$, t.id('multi_dois_papeis'), t.classe('amigo')), 'Esta classe já foi concluída por esta pessoa em outro clube.');
reset role;
select t.eq('4) nada novo: member_classes/conquistas/snapshots/documentos/investiduras/requisitos idênticos', t.tudo(), (select antes from t.foto));
select t.eq('4) ...e não existe matrícula da Amigo no A', (select count(*) from public.member_classes where usuario_id = t.id('multi_dois_papeis') and club_id = t.id('clube_a') and class_id = t.classe('amigo')), 0);
-- versão ANTIGA oficial da mesma classe (mesmo código) também está concluída: a equivalência é por código oficial
select t.como('multi_dois_papeis'); select t.pedir_clube('clube_a');
select t.throws('4) a Amigo de versão arquivada (2026.3) também é recusada (vira "não encontrada" — fora do fluxo normal)', format($q$select public.classe_iniciar(%L)$q$, t.classe_v('2026.3', 'amigo')), 'Classe não encontrada');
-- no PRÓPRIO clube onde concluiu o comportamento idempotente de sempre continua (mesma matrícula, sem duplicar)
select t.pedir_clube('clube_b');
select t.eq('4) no B (onde concluiu) reiniciar devolve a MESMA matrícula',
  t.txt(format($q$select (public.classe_iniciar(%L)->>'member_class_id')::uuid = %L::uuid$q$, t.classe('amigo'), t.mc('multi_dois_papeis', 'amigo', 'clube_b'))), 'true');
reset role;
select t.eq('4) ...e continua sem nada novo', t.tudo(), (select antes from t.foto));

-- ==================== 5) classes_concluidas_anteriormente ====================
-- uma segunda conquista em OUTRO clube (Pesquisador, há 1 ano) para provar a ordem (mais recente primeiro)
insert into public.curriculum_achievements (usuario_id, tipo, classe_id, club_id_origem, concluida_em)
values (t.id('multi_dois_papeis'), 'classe', t.classe('pesquisador'), t.id('clube_b'), now() - interval '1 year');
select t.como('multi_dois_papeis'); select t.pedir_clube('clube_a');
select t.eq('5) no A: lista as conquistas do B, mais recente primeiro, com o NOME do clube', t.ant(), 'amigo:Clube B (teste),pesquisador:Clube B (teste)');
select t.eq('5) os campos são exatamente os combinados (nada de relatório, evidência, pessoa, ids de clube)',
  t.txt($q$select string_agg(k, ',') from (select json_object_keys(x) k from (select (public.classes_concluidas_anteriormente()->>0)::json x) y) z$q$),
  'class_id,codigo,nome,avancada,concluida_em,origem_clube_nome,origem');
select t.eq('5) origem = outro_clube; avancada=false; concluida_em preenchida',
  t.txt($q$select (x->>'origem') || '|' || (x->>'avancada') || '|' || ((x->>'concluida_em') is not null) from (select (public.classes_concluidas_anteriormente()->>0)::json x) y$q$), 'outro_clube|false|true');
select t.eq('5) a Pesquisador concluída no B também NÃO é oferecida no A', t.d('pesquisador'), '-');
select t.throws('5) ...nem iniciada no A', format($q$select public.classe_iniciar(%L)$q$, t.classe('pesquisador')), 'concluída por você em Clube B (teste)');
select t.pedir_clube('clube_b');
select t.eq('5) no B (clube de origem) a lista é vazia: quem concluiu aqui não é "anterior de outro clube"', t.ant(), '');
reset role;
-- conquista de OUTRA pessoa não aparece para a multi; a multi não aparece para as outras
insert into public.curriculum_achievements (usuario_id, tipo, classe_id, club_id_origem, concluida_em)
values (t.id('membro_b'), 'classe', t.classe('amigo'), t.id('clube_b'), now() - interval '3 days');
select t.como('multi_dois_papeis'); select t.pedir_clube('clube_a');
select t.eq('5) a conquista de membro_b NÃO entra na lista da multi', t.ant(), 'amigo:Clube B (teste),pesquisador:Clube B (teste)');
reset role;
select t.como('membro_a'); select t.pedir_clube('clube_a');
select t.eq('5) membro_a (sem conquistas) vê lista vazia — não vaza a da multi', t.ant(), '');
reset role;
select t.como('membro_b'); select t.pedir_clube('clube_b');
select t.eq('5) membro_b no B (clube de origem): vazia', t.ant(), '');
reset role;
-- sem clube em uso / clube alheio / responsável / anon / recurso desligado
select t.como('sem_clube');
select t.eq('5) sem clube em uso: []', t.txt($q$select public.classes_concluidas_anteriormente()::text$q$), '[]');
reset role;
update public.club_features set enabled = false where club_id = t.id('clube_a') and feature = 'classes';
select t.como('multi_dois_papeis'); select t.pedir_clube('clube_a');
select t.eq('5) recurso "classes" desligado no clube: []', t.txt($q$select public.classes_concluidas_anteriormente()::text$q$), '[]');
reset role;
update public.club_features set enabled = true where club_id = t.id('clube_a') and feature = 'classes';
select t.como('pais_a'); select t.pedir_clube('clube_a');
select t.eq('5) responsável (pais): []', t.txt($q$select public.classes_concluidas_anteriormente()::text$q$), '[]');
reset role;
select t.como('membro_a'); select t.pedir_clube('clube_b');   -- pede clube onde não tem vínculo: o servidor não honra
select t.eq('5) pedir clube alheio pelo header: []', t.txt($q$select public.classes_concluidas_anteriormente()::text$q$), '[]');
reset role;
select t.como_anon();
select t.throws('5) anon não chama classes_concluidas_anteriormente', $q$select public.classes_concluidas_anteriormente()$q$, 'permission denied');
reset role;

-- ==================== 6) conquista REVOGADA volta a permitir ====================
update public.curriculum_achievements set status = 'revogada', revogada_em = now(), revogada_motivo = 'teste 125'
 where usuario_id = t.id('multi_dois_papeis') and classe_id = t.classe('pesquisador');
select t.como('multi_dois_papeis'); select t.pedir_clube('clube_a');
select t.eq('6) Pesquisador com conquista REVOGADA volta a ser oferecida no A (13 anos: elegível, anterior)', t.d('pesquisador'), 'true|-|true');
select t.ant() as _ \gset
select t.eq('6) ...e sai de classes_concluidas_anteriormente', t.ant(), 'amigo:Clube B (teste)');
select t.permitido('6) ...e classe_iniciar volta a funcionar', format($q$select public.classe_iniciar(%L)$q$, t.classe('pesquisador')));
reset role;

-- ==================== 7) SEM nascimento não matricula ====================
select t.como('conselheiro_a'); select t.pedir_clube('clube_a');
select t.permitido('7) (controle) conselheiro_a adulto inicia Amigo', format($q$select public.classe_iniciar(%L)$q$, t.classe('amigo')));
reset role;
update public.profiles set nascimento = null where id = t.id('conselheiro_a');
create table t.foto7 as select t.tudo() as antes, (select md5(mc::text) from public.member_classes mc where id = t.mc('conselheiro_a', 'amigo', 'clube_a')) as mc;
select t.como('conselheiro_a'); select t.pedir_clube('clube_a');
select t.eq('7) sem nascimento: Pesquisador = false|nascimento|false', t.d('pesquisador'), 'false|nascimento|false');
select t.eq('7) sem nascimento: a avançada mostra o nascimento antes da regular', t.d('guia_de_exploracao'), 'false|nascimento|false');
select t.eq('7) sem nascimento: motivo amigável',
  t.txt($q$select c->>'motivo_inelegivel' from json_array_elements(public.classes_disponiveis()) c where c->>'codigo' = 'pesquisador'$q$),
  'Informe a data de nascimento para verificar quais classes estão disponíveis.');
select t.eq('7) sem nascimento: elegivel == (bloqueio is null) em todas as linhas, e NENHUMA elegível',
  t.n($q$select count(*) from json_array_elements(public.classes_disponiveis()) c where (c->>'elegivel')::boolean <> (c->>'bloqueio' is null)$q$) * 100
  + t.n($q$select count(*) from json_array_elements(public.classes_disponiveis()) c where (c->>'elegivel')::boolean$q$), 0);
select t.throws('7) sem nascimento: RPC direto classe_iniciar recusa', format($q$select public.classe_iniciar(%L)$q$, t.classe('pesquisador')), 'Informe a data de nascimento');
select t.pedir_clube('clube_a');   -- pelo header x-clube-atual explícito (a aba que escolheu o clube)
select t.throws('7) sem nascimento: via header x-clube-atual também recusa', format($q$select public.classe_iniciar(%L)$q$, t.classe('pesquisador')), 'Informe a data de nascimento');
select t.throws('7) sem nascimento: a avançada também (a idade vem antes)', format($q$select public.classe_iniciar(%L)$q$, t.classe('guia_de_exploracao')), 'Informe a data de nascimento');
select t.eq('7) a matrícula que JÁ existia segue listada em minhas_classes (a 519 não mexe nas existentes)', t.txt($q$select x->>'codigo' || '|' || (x->>'status') from json_array_elements(public.minhas_classes()) x where x->>'codigo' = 'amigo'$q$), 'amigo|em_andamento');
reset role;
select t.como('lider_a'); select t.pedir_clube('clube_a');
select t.throws('7) sem nascimento: a diretoria também não atribui (classe_atribuir)', format($q$select public.classe_atribuir(%L, %L)$q$, t.id('conselheiro_a'), t.classe('pesquisador')), 'Informe a data de nascimento');
reset role;
select t.eq('7) nada novo e a matrícula existente ficou byte a byte igual', t.tudo() = (select antes from t.foto7) and (select md5(mc::text) from public.member_classes mc where id = t.mc('conselheiro_a', 'amigo', 'clube_a')) = (select mc from t.foto7), true);
-- com nascimento volta a funcionar (inclusive atribuído pela diretoria)
select t.nasce('conselheiro_a', 30);
select t.como('conselheiro_a'); select t.pedir_clube('clube_a');
select t.eq('7) com nascimento: Pesquisador elegível de novo (30 anos: anterior)', t.d('pesquisador'), 'true|-|true');
select t.permitido('7) ...e inicia', format($q$select public.classe_iniciar(%L)$q$, t.classe('pesquisador')));
reset role;
select t.como('lider_a'); select t.pedir_clube('clube_a');
select t.permitido('7) ...e a diretoria atribui', format($q$select public.classe_atribuir(%L, %L)$q$, t.id('conselheiro_a'), t.classe('companheiro')));
reset role;
-- menor com data: a idade continua valendo (10 anos não inicia Guia) — a regra de idade (380/518) segue coerente
select t.nasce('conselheiro_a', 10);
select t.como('conselheiro_a'); select t.pedir_clube('clube_a');
select t.eq('7) com nascimento de 10 anos: Guia bloqueada por IDADE (não por nascimento)', t.d('guia'), 'false|idade|false');
select t.throws('7) ...e a mensagem é a de idade', format($q$select public.classe_iniciar(%L)$q$, t.classe('guia')), 'a partir de 15 anos');
reset role;
select t.nasce('conselheiro_a', 30);

-- ==================== 8) front manipulado não burla ====================
select t.como('membro_a'); select t.pedir_clube('clube_a');
select t.throws('8) UUID forjado', $q$select public.classe_iniciar('11111111-1111-4111-8111-111111111111')$q$, 'Classe não encontrada');
select t.throws('8) classe do piloto (origem não oficial)', $q$select public.classe_iniciar('00000000-0000-4000-a000-000000000002')$q$, 'Classe não encontrada');
select t.throws('8) p_idade não existe em classe_iniciar', format($q$select public.classe_iniciar(p_class_id => %L, p_idade => 99)$q$, t.classe('guia')), 'does not exist');
select t.throws('8) p_club_id não existe em classe_iniciar', format($q$select public.classe_iniciar(p_class_id => %L, p_club_id => %L)$q$, t.classe('amigo'), t.id('clube_b')), 'does not exist');
select t.throws('8) p_nascimento não existe em classe_iniciar', format($q$select public.classe_iniciar(p_class_id => %L, p_nascimento => '2000-01-01')$q$, t.classe('amigo')), 'does not exist');
select t.throws('8) classe_atribuir não aceita p_club_id', format($q$select public.classe_atribuir(p_usuario_id => %L, p_class_id => %L, p_club_id => %L)$q$, t.id('membro_a'), t.classe('amigo'), t.id('clube_a')), 'does not exist');
select t.throws('8) classes_concluidas_anteriormente não aceita p_usuario_id', format($q$select public.classes_concluidas_anteriormente(p_usuario_id => %L)$q$, t.id('multi_dois_papeis')), 'does not exist');
select t.throws('8) classes_disponiveis não aceita p_club_id', format($q$select public.classes_disponiveis(p_club_id => %L)$q$, t.id('clube_b')), 'does not exist');
select t.bloqueado('8) usuário comum não forja conquista (insert em curriculum_achievements)',
  format($q$insert into public.curriculum_achievements (usuario_id, tipo, classe_id, club_id_origem, concluida_em) values (%L, 'classe', %L, %L, now())$q$, t.id('membro_a'), t.classe('amigo'), t.id('clube_b')));
select t.permitido('8) membro_a inicia Amigo no A (controle positivo)', format($q$select public.classe_iniciar(%L)$q$, t.classe('amigo')));
select t.tenta(format($q$update public.member_classes set status = 'investida', concluida_em = now() where id = %L$q$, t.mc('membro_a', 'amigo', 'clube_a')));
select t.eq('8) ...e não se auto-conclui (status segue em_andamento, sem conquista)',
  (select status from public.member_classes where id = t.mc('membro_a', 'amigo', 'clube_a'))::text || '|' || (select count(*) from public.curriculum_achievements where usuario_id = t.id('membro_a'))::text, 'em_andamento|0');
select t.throws('8) helper interno _classe_conclusao_ativa_clube não é chamável pelo app', format($q$select public._classe_conclusao_ativa_clube(%L, %L)$q$, t.id('membro_a'), t.classe('amigo')), 'permission denied');
select t.throws('8) ...nem a regra de dependência (3 args)', format($q$select public._dependencia_de_classe_satisfeita(%L, %L, 'concluida')$q$, t.id('membro_a'), t.classe('amigo')), 'permission denied');
select t.throws('8) ...nem a de 4 args', format($q$select public._dependencia_de_classe_satisfeita(%L, %L, 'concluida', %L)$q$, t.id('membro_a'), t.classe('amigo'), t.id('clube_a')), 'permission denied');
select t.pedir_clube('clube_b');
select t.throws('8) pedir o clube B sem vínculo: classe_iniciar recusa (Sem clube em uso)', format($q$select public.classe_iniciar(%L)$q$, t.classe('pesquisador')), 'Sem clube em uso');
reset role;
select t.como_anon();
select t.throws('8) anon não chama classe_iniciar', format($q$select public.classe_iniciar(%L)$q$, t.classe('amigo')), 'permission denied');
select t.throws('8) anon não chama classes_disponiveis', $q$select public.classes_disponiveis()$q$, 'permission denied');
reset role;
-- a classe concluída por OUTRA pessoa (membro_b concluiu Amigo no B) não atrapalha membro_a
select t.eq('8) a conquista de membro_b não afeta a oferta/iniciar de membro_a', (select count(*) from public.member_classes where usuario_id = t.id('membro_a') and class_id = t.classe('amigo')), 1);

-- ==================== 9) permissões das funções ====================
select t.eq('9) classes_concluidas_anteriormente: authenticated executa, anon NÃO',
  (has_function_privilege('authenticated', 'public.classes_concluidas_anteriormente()', 'execute'))::text || '|' || (has_function_privilege('anon', 'public.classes_concluidas_anteriormente()', 'execute'))::text, 'true|false');
select t.eq('9) classes_disponiveis / classe_iniciar / classe_atribuir seguem sem anon',
  (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('classes_disponiveis', 'classe_iniciar', 'classe_atribuir') and has_function_privilege('anon', p.oid, 'execute')), 0);
select t.eq('9) os helpers não têm execute para anon nem authenticated',
  (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace
     and p.proname in ('_classe_bloqueio_tipo', '_classe_eh_anterior', '_classe_motivo_inelegivel', '_classe_conclusao_ativa_clube', '_dependencia_de_classe_satisfeita')
     and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))), 0);
select t.eq('9) todas security definer com search_path vazio',
  (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace
     and p.proname in ('classes_concluidas_anteriormente', '_classe_conclusao_ativa_clube', '_dependencia_de_classe_satisfeita', 'classes_disponiveis', 'classe_iniciar', 'classe_atribuir')
     and not (p.prosecdef and exists (select 1 from unnest(p.proconfig) c where c in ('search_path=""', 'search_path=')))), 0);
select t.eq('9) a assinatura de 3 argumentos da regra de dependência foi mantida',
  pg_get_function_identity_arguments('public._dependencia_de_classe_satisfeita(uuid,uuid,text)'::regprocedure), 'p_usuario_id uuid, p_depende_de_id uuid, p_modo text');
select t.fim();
rollback;
