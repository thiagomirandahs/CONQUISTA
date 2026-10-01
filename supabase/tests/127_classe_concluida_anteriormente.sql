-- Registrar CLASSE JÁ CONCLUÍDA (migration 521): histórico anterior ao app, sem aprovações/matrícula/documento falsos.
--  * autoridade: pode_avaliar_curriculo (diretoria|instrutor) no CLUBE ATUAL; ninguém registra para si;
--  * só cria linha em curriculum_achievements (origem='registro_anterior') + log append-only; nada de member_classes,
--    member_requirements, requirement_approvals, snapshot, documento, investidura, evento;
--  * conclusão ativa (qualquer clube) satisfaz a dependência, some da oferta e não reabre; revogar é soft e só do registro;
--  * data desconhecida nunca vira data; idade/nascimento não são pré-requisito do histórico;
--  * comprovante opcional em pasta própria do bucket privado 'comprovacoes'.
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
create function t.d(p_codigo text) returns text language sql stable as $$
  select coalesce((select (c->>'elegivel') || '|' || coalesce(c->>'bloqueio', '-') || '|' || (c->>'anterior')
                     from json_array_elements(public.classes_disponiveis()) c where c->>'codigo' = p_codigo), '-') $$;
create function t.nasce(p_chave text, p_anos int) returns void language sql as $$
  update public.profiles set nascimento = (current_date - make_interval(years => p_anos))::date where id = t.id(p_chave) $$;
create function t.mc(p_chave text, p_codigo text, p_clube text) returns uuid language sql stable security definer as $$
  select id from public.member_classes where usuario_id = t.id(p_chave) and club_id = t.id(p_clube) and class_id = t.classe(p_codigo) $$;
-- fotografia do que um registro de histórico NÃO pode criar (conquistas ficam de fora: é o que ele cria)
create function t.tudo() returns text language sql stable security definer as $$
  select (select count(*) from public.member_classes)::text || '|' || (select count(*) from public.member_requirements) || '|'
      || (select count(*) from public.requirement_approvals) || '|' || (select count(*) from public.requirement_submissions) || '|'
      || (select count(*) from public.class_completion_snapshots) || '|' || (select count(*) from public.class_documents) || '|'
      || (select count(*) from public.class_investitures) || '|' || (select count(*) from public.class_completion_events) $$;
create function t.concluir(p_chave text, p_codigo text, p_clube text) returns void language sql security definer as $$
  update public.member_classes set status = 'investida', concluida_em = now() - interval '2 days', investida_em = now() - interval '1 day'
   where id = t.mc(p_chave, p_codigo, p_clube) $$;
create function t.ant() returns text language sql stable as $$
  select coalesce(string_agg((x->>'codigo') || ':' || (x->>'origem_clube_nome') || ':' || (x->>'origem'), ',' order by ord), '') from json_array_elements(public.classes_concluidas_anteriormente()) with ordinality as a(x, ord) $$;
create function t.reg(p_chave text, p_codigo text, p_data text default null, p_desc boolean default false,
                      p_obs text default 'Cartão da classe, conferido pela diretoria', p_path text default null) returns text
language sql stable as $$
  select format($q$select public.classe_concluida_anteriormente_registrar(%L, %L, %L::date, %L::boolean, %L, %L)$q$,
                t.id(p_chave), t.classe(p_codigo), p_data, p_desc, p_obs, p_path) $$;
create function t.ach(p_chave text, p_codigo text, p_clube text) returns uuid language sql stable security definer as $$
  select id from public.curriculum_achievements where usuario_id = t.id(p_chave) and classe_id = t.classe(p_codigo)
     and origem = 'registro_anterior' and status = 'ativa' and club_id_origem = t.id(p_clube) $$;
create function t.ach_app(p_chave text, p_codigo text) returns uuid language sql stable security definer as $$
  select id from public.curriculum_achievements where usuario_id = t.id(p_chave) and classe_id = t.classe(p_codigo) and origem = 'conclusao_no_app' $$;
create function t.ach_rev(p_chave text, p_codigo text) returns uuid language sql stable security definer as $$
  select id from public.curriculum_achievements where usuario_id = t.id(p_chave) and classe_id = t.classe(p_codigo) and status = 'revogada' $$;
create function t.nlog() returns bigint language sql stable security definer as $$ select count(*) from public.class_prior_completion_log $$;
create function t.nach() returns bigint language sql stable security definer as $$ select count(*) from public.curriculum_achievements $$;
create function t.arq(p_clube text, p_chave text) returns text language sql stable as $$
  select t.id(p_clube)::text || '/' || t.id(p_chave)::text || '/conclusao-anterior/' $$;

select t.signup('sem_clube', jsonb_build_object('nome', 'Sem Clube', 'cargo', 'Desbravador', 'nascimento', (current_date - interval '13 years')::date::text));
select t.nasce('membro_a', 13);
select t.nasce('membro_a2', 13);
select t.nasce('membro_b', 13);
select t.nasce('multi_dois_papeis', 13);
select (select nome from public.organizational_units where id = t.id('clube_a')) as nome_a \gset

-- ==================== 1) quem pode registrar ====================
create table t.foto1 as select t.tudo() as antes;
select t.como('instrutor_a'); select t.pedir_clube('clube_a');
select t.permitido('1) instrutor registra Amigo de membro_a (data conhecida)', t.reg('membro_a', 'amigo', '2020-05-10'));
reset role;
select t.como('lider_a'); select t.pedir_clube('clube_a');
select t.permitido('1) diretoria registra Companheiro de membro_a2 (data desconhecida)', t.reg('membro_a2', 'companheiro', null, true));
reset role;
select t.eq('1) nenhuma matrícula/requisito/aprovação/tentativa/snapshot/documento/investidura/evento nasceu', t.tudo(), (select antes from t.foto1));
select t.eq('1) duas conquistas de origem registro_anterior, ativas', (select count(*) from public.curriculum_achievements where origem = 'registro_anterior' and status = 'ativa'), 2);
select t.eq('1) proveniência: clube, ator, papel, data do registro e observação gravados',
  (select (a.club_id_origem = t.id('clube_a') and a.registrado_no_club_id = t.id('clube_a') and a.registrado_por = t.id('instrutor_a') and a.registrado_papel = 'instrutor'
           and a.registrado_em is not null and a.observacao = 'Cartão da classe, conferido pela diretoria' and a.member_class_id is null and a.snapshot_id is null)
     from public.curriculum_achievements a where a.id = t.ach('membro_a', 'amigo', 'clube_a')), true);
select t.eq('1) papel gravado da diretoria', (select registrado_papel from public.curriculum_achievements where id = t.ach('membro_a2', 'companheiro', 'clube_a')), 'diretoria');
select t.eq('1) concluida_em = 10/05/2020 ao meio-dia de São Paulo', (select to_char(concluida_em at time zone 'America/Sao_Paulo', 'YYYY-MM-DD HH24:MI') from public.curriculum_achievements where id = t.ach('membro_a', 'amigo', 'clube_a')), '2020-05-10 12:00');
select t.eq('1) log: 2 linhas "registrar" com ator, papel, clube, membro, classe e motivo',
  (select count(*) from public.class_prior_completion_log where acao = 'registrar' and club_id = t.id('clube_a') and ator_id is not null and ator_papel in ('instrutor', 'diretoria')
      and length(motivo) >= 5 and usuario_id in (t.id('membro_a'), t.id('membro_a2')) and class_id in (t.classe('amigo'), t.classe('companheiro')) and achievement_id is not null), 2);

-- quem NÃO registra
select t.como('membro_a'); select t.pedir_clube('clube_a');
select t.throws('1) desbravador não registra', t.reg('membro_a2', 'pesquisador', '2020-01-01'), 'Sem permissão');
select t.throws('1) desbravador não registra nem para si', t.reg('membro_a', 'pesquisador', '2020-01-01'), 'Sem permissão');
reset role;
select t.como('conselheiro_a'); select t.pedir_clube('clube_a');
select t.throws('1) conselheiro não registra', t.reg('membro_a', 'pesquisador', '2020-01-01'), 'Sem permissão');
reset role;
select t.como('tesoureiro_a'); select t.pedir_clube('clube_a');
select t.throws('1) tesoureiro não registra', t.reg('membro_a', 'pesquisador', '2020-01-01'), 'Sem permissão');
reset role;
select t.como('pais_a'); select t.pedir_clube('clube_a');
select t.throws('1) responsável (pais) não registra', t.reg('membro_a', 'pesquisador', '2020-01-01'), 'Sem permissão');
reset role;
select t.como_anon();
select t.throws('1) anon não registra', t.reg('membro_a', 'pesquisador', '2020-01-01'), 'permission denied');
select t.throws('1) anon não revoga', format($q$select public.classe_concluida_anteriormente_revogar(%L, 'motivo qualquer')$q$, t.id('membro_a')), 'permission denied');
select t.throws('1) anon não lista', format($q$select public.classe_concluidas_do_membro(%L)$q$, t.id('membro_a')), 'permission denied');
reset role;
-- outro clube / sem vínculo / autoatribuição
select t.como('lider_b'); select t.pedir_clube('clube_b');
select t.throws('1) diretoria do B não registra para membro do A (sem vínculo ativo no B)', t.reg('membro_a', 'pesquisador', '2020-01-01'), 'sem vínculo ativo neste clube');
select t.pedir_clube('clube_a');   -- tenta agir no A pelo header: o servidor não honra (sem vínculo no A)
select t.throws('1) diretoria do B pedindo o clube A pelo header: sem permissão', t.reg('membro_a', 'pesquisador', '2020-01-01'), 'Sem permissão');
reset role;
select t.como('dir_a_membro_b'); select t.pedir_clube('clube_b');
select t.throws('1) diretoria do A que é só desbravador no B não registra no B', t.reg('membro_b', 'pesquisador', '2020-01-01'), 'Sem permissão');
select t.pedir_clube('clube_a');
select t.throws('1) ...e no A (onde é diretoria) não registra para quem só tem vínculo no B', t.reg('membro_b', 'pesquisador', '2020-01-01'), 'sem vínculo ativo neste clube');
reset role;
select t.como('lider_a'); select t.pedir_clube('clube_a');
select t.throws('1) pessoa sem nenhum vínculo é recusada', t.reg('sem_clube', 'pesquisador', '2020-01-01'), 'sem vínculo ativo neste clube');
select t.throws('1) responsável (pais) não é destinatário (sem vínculo de membro)', t.reg('pais_a', 'pesquisador', '2020-01-01'), 'sem vínculo ativo neste clube');
select t.throws('1) a diretoria não registra para si mesma', t.reg('lider_a', 'pesquisador', '2020-01-01'), 'outra pessoa da liderança');
reset role;
update public.organization_memberships set status = 'suspenso' where user_id = t.id('membro_a2') and organizational_unit_id = t.id('clube_a');
select t.como('lider_a'); select t.pedir_clube('clube_a');
select t.throws('1) vínculo suspenso é recusado', t.reg('membro_a2', 'pesquisador', '2020-01-01'), 'sem vínculo ativo neste clube');
reset role;
update public.organization_memberships set status = 'ativo' where user_id = t.id('membro_a2') and organizational_unit_id = t.id('clube_a');
select t.eq('1) nada disso criou registro', t.nach(), 2);

-- ==================== 2) classe forjada / fora do fluxo ====================
select t.como('lider_a'); select t.pedir_clube('clube_a');
select t.throws('2) UUID forjado', format($q$select public.classe_concluida_anteriormente_registrar(%L, '11111111-1111-4111-8111-111111111111', '2020-01-01', false, 'observação válida', null)$q$, t.id('membro_a')), 'Classe não encontrada');
select t.throws('2) classe do piloto (origem não oficial)', format($q$select public.classe_concluida_anteriormente_registrar(%L, '00000000-0000-4000-a000-000000000002', '2020-01-01', false, 'observação válida', null)$q$, t.id('membro_a')), 'Classe não encontrada');
select t.throws('2) versão arquivada (2026.3)', format($q$select public.classe_concluida_anteriormente_registrar(%L, %L, '2020-01-01', false, 'observação válida', null)$q$, t.id('membro_a'), t.classe_v('2026.3', 'pesquisador')), 'Classe não encontrada');
reset role;
update public.curriculum_versions set status = 'rascunho' where id = (select curriculum_version_id from public.classes where id = t.classe('pesquisador'));
select t.como('lider_a'); select t.pedir_clube('clube_a');
select t.throws('2) classe de versão em rascunho', t.reg('membro_a', 'pesquisador', '2020-01-01'), 'Classe não encontrada');
reset role;
update public.curriculum_versions set status = 'publicado' where id = (select curriculum_version_id from public.classes where id = t.classe('pesquisador'));
select t.eq('2) nada nasceu', t.nach(), 2);

-- ==================== 3) validações (data, observação, comprovante) ====================
select t.como('lider_a'); select t.pedir_clube('clube_a');
select t.throws('3) data no futuro', t.reg('membro_a', 'pesquisador', (current_date + 2)::text), 'não pode ser no futuro');
select t.throws('3) sem data e sem marcar "não sei"', t.reg('membro_a', 'pesquisador', null), 'Informe a data');
select t.throws('3) data E "desconhecida" juntas', t.reg('membro_a', 'pesquisador', '2020-01-01', true), 'não informe a data');
select t.throws('3) data anterior ao nascimento (13 anos)', t.reg('membro_a', 'pesquisador', '2000-01-01'), 'anterior ao nascimento');
select t.throws('3) data absurda (1900)', t.reg('membro_a', 'pesquisador', '1900-01-01'), 'inválida');
select t.throws('3) observação vazia', t.reg('membro_a', 'pesquisador', '2020-01-01', false, ''), 'observação');
select t.throws('3) observação nula', t.reg('membro_a', 'pesquisador', '2020-01-01', false, null), 'observação');
select t.throws('3) observação curta (4 letras)', t.reg('membro_a', 'pesquisador', '2020-01-01', false, 'abcd'), 'pelo menos 5');
select t.throws('3) observação só com espaços', t.reg('membro_a', 'pesquisador', '2020-01-01', false, '      '), 'pelo menos 5');
select t.throws('3) observação > 500', t.reg('membro_a', 'pesquisador', '2020-01-01', false, repeat('x', 501)), 'no máximo 500');
select t.permitido('3) observação de exatamente 500 passa (Pesquisador de membro_a)', t.reg('membro_a', 'pesquisador', current_date::text, false, repeat('x', 500)));
reset role;
select t.eq('3) hoje é uma data válida; ficou 1 registro a mais', t.nach(), 3);
-- data desconhecida: nunca vira data
select t.eq('3) data desconhecida: o registro guarda data_desconhecida=true', (select data_desconhecida from public.curriculum_achievements where id = t.ach('membro_a2', 'companheiro', 'clube_a')), true);
select t.como('lider_a'); select t.pedir_clube('clube_a');
select t.eq('3) ...e a leitura da liderança devolve concluida_em NULL',
  t.txt(format($q$select (x->>'concluida_em') is null from json_array_elements(public.classe_concluidas_do_membro(%L)) x where x->>'codigo' = 'companheiro'$q$, t.id('membro_a2'))), 'true');
reset role;
select t.como('membro_a2'); select t.pedir_clube('clube_a');
select t.eq('3) ...e a do próprio membro (classes_concluidas_anteriormente): concluida_em NULL, data_desconhecida=true',
  t.txt($q$select (x->>'concluida_em') is null and (x->>'data_desconhecida')::boolean from (select (public.classes_concluidas_anteriormente()->>0)::json x) y$q$), 'true');
select t.eq('3) ...e a minha_jornada: concluida_em NULL, origem registro_anterior',
  t.txt($q$select (x->>'concluida_em') is null and x->>'origem' = 'registro_anterior' and (x->>'data_desconhecida')::boolean from (select (public.minha_jornada()->'conquistas'->>0)::json x) y$q$), 'true');
reset role;

-- ==================== 4) efeito: concluída, não oferecida, não reabre, libera a avançada ====================
select t.como('membro_a'); select t.pedir_clube('clube_a');
select t.eq('4) Amigo NÃO é mais oferecida (concluída)', t.d('amigo'), '-');
select t.eq('4) Amigo da Natureza LIBERADA pela Amigo registrada', left(t.d('amigo_da_natureza'), 6), 'true|-');
select t.throws('4) classe_iniciar da Amigo recusa (já concluída)', format($q$select public.classe_iniciar(%L)$q$, t.classe('amigo')), 'já foi concluída por você');
select t.permitido('4) classe_iniciar da Amigo da Natureza funciona (dependência satisfeita)', format($q$select public.classe_iniciar(%L)$q$, t.classe('amigo_da_natureza')));
select t.eq('4) lista do próprio membro: 2 chaves a mais só nos itens deste clube',
  t.txt($q$select string_agg(k, ',') from (select json_object_keys(x) k from (select (public.classes_concluidas_anteriormente()->>0)::json x) y) z$q$),
  'class_id,codigo,nome,avancada,concluida_em,origem_clube_nome,origem,registrada_em,data_desconhecida');
select t.eq('4) lista do próprio membro: origem distinguível e nome do clube', t.ant() like '%amigo:' || :'nome_a' || ':registro_anterior_neste_clube%', true);
select t.eq('4) lista do próprio membro: concluida_em 2020-05-10 (data conhecida)',
  t.txt($q$select to_char((x->>'concluida_em')::timestamptz at time zone 'America/Sao_Paulo', 'YYYY-MM-DD') from json_array_elements(public.classes_concluidas_anteriormente()) x where x->>'codigo' = 'amigo'$q$), '2020-05-10');
select t.eq('4) lista do próprio membro: sem observação, comprovante, ator ou ids de pessoa',
  t.txt($q$select count(*)::text from json_array_elements(public.classes_concluidas_anteriormente()) x, json_object_keys(x) k where k in ('observacao', 'comprovante_path', 'registrado_por', 'registrado_por_nome', 'usuario_id')$q$), '0');
select t.eq('4) minha_jornada traz a conquista com origem registro_anterior',
  t.txt($q$select count(*)::text from json_array_elements(public.minha_jornada()->'conquistas') x where x->>'origem' = 'registro_anterior' and x->>'nome' = 'Amigo'$q$), '1');
select t.eq('4) minha_jornada continua com as mesmas 5 seções', t.txt($q$select (select string_agg(k, ',' order by k) from json_object_keys(public.minha_jornada()) k)$q$), 'classes,conquistas,especialidades,investiduras,leituras');
reset role;
select t.como('lider_a'); select t.pedir_clube('clube_a');
select t.throws('4) classe_atribuir da Amigo recusa', format($q$select public.classe_atribuir(%L, %L)$q$, t.id('membro_a'), t.classe('amigo')), 'já foi concluída por esta pessoa neste clube');
reset role;
select t.eq('4) a regra de dependência (4 args) vê a conclusão', public._dependencia_de_classe_satisfeita(t.id('membro_a'), t.classe('amigo'), 'concluida', t.id('clube_a')), true);
select t.eq('4) curriculo_pessoa_concluiu vê a conquista', public.curriculo_pessoa_concluiu('classe', t.id('membro_a'), t.classe('amigo'), null), true);
select t.eq('4) só a matrícula da avançada nasceu (nenhuma da Amigo; sem conquista falsa de avançada)',
  (select count(*) from public.member_classes where usuario_id = t.id('membro_a') and club_id = t.id('clube_a') and class_id = t.classe('amigo'))::text || '|' ||
  (select count(*) from public.member_classes where usuario_id = t.id('membro_a') and club_id = t.id('clube_a'))::text, '0|1');
-- regular só INICIADA em outro clube continua NÃO liberando a avançada
select t.como('multi_dois_papeis'); select t.pedir_clube('clube_b');
select t.permitido('4) multi inicia Amigo no B (só iniciada)', format($q$select public.classe_iniciar(%L)$q$, t.classe('amigo')));
select t.pedir_clube('clube_a');
select t.eq('4) no A: Amigo da Natureza continua bloqueada (pré-requisito)', t.d('amigo_da_natureza') like 'false|pre_requisito|%', true);
reset role;

-- ==================== 5) não duplica ====================
create table t.foto5 as select t.nach() as a, t.nlog() as l;
select t.como('lider_a'); select t.pedir_clube('clube_a');
select t.throws('5) segundo registro da mesma classe/pessoa recusado', t.reg('membro_a', 'amigo', '2019-01-01'), 'já consta como concluída por esta pessoa neste clube');
reset role;
select t.eq('5) ...sem criar conquista nem log', t.nach() = (select a from t.foto5) and t.nlog() = (select l from t.foto5), true);
-- concluída no app + registro
select t.como('membro_b'); select t.pedir_clube('clube_b');
select t.permitido('5) membro_b inicia Amigo no B', format($q$select public.classe_iniciar(%L)$q$, t.classe('amigo')));
reset role;
select t.concluir('membro_b', 'amigo', 'clube_b');
select t.como('lider_b'); select t.pedir_clube('clube_b');
select t.throws('5) concluída no app + registro: recusado', t.reg('membro_b', 'amigo', '2019-01-01'), 'já consta como concluída por esta pessoa neste clube');
reset role;
-- matrícula existente da mesma classe no clube
select t.como('membro_a2'); select t.pedir_clube('clube_a');
select t.permitido('5) membro_a2 inicia Pesquisador', format($q$select public.classe_iniciar(%L)$q$, t.classe('pesquisador')));
reset role;
select t.como('lider_a'); select t.pedir_clube('clube_a');
select t.throws('5) registro com matrícula não cancelada da mesma classe: recusa com orientação', t.reg('membro_a2', 'pesquisador', '2020-01-01'), 'finalize ou cancele a matrícula');
reset role;
update public.member_classes set status = 'cancelada' where id = t.mc('membro_a2', 'pesquisador', 'clube_a');
select t.como('lider_a'); select t.pedir_clube('clube_a');
select t.permitido('5) com a matrícula CANCELADA o registro é aceito', t.reg('membro_a2', 'pesquisador', '2021-03-03'));
reset role;
-- multiclube: registro no A vale no B, sem criar matrícula no B
create table t.foto5b as select t.tudo() as antes;
select t.como('lider_a'); select t.pedir_clube('clube_a');
select t.permitido('5) diretoria do A registra Pesquisador de multi_dois_papeis (desbravador no A)', t.reg('multi_dois_papeis', 'pesquisador', '2018-08-08'));
reset role;
select t.como('lider_b'); select t.pedir_clube('clube_b');
select t.throws('5) o B não registra de novo (conclusão portátil: já consta em outro clube)', t.reg('multi_dois_papeis', 'pesquisador', '2018-08-08'), 'em outro clube');
reset role;
select t.como('multi_dois_papeis'); select t.pedir_clube('clube_b');
select t.eq('5) no B: Pesquisador NÃO é oferecida', t.d('pesquisador'), '-');
select t.throws('5) no B: classe_iniciar recusa citando o clube de origem', format($q$select public.classe_iniciar(%L)$q$, t.classe('pesquisador')), 'concluída por você em ' || :'nome_a');
select t.eq('5) no B a lista de anteriores mostra a conclusão vinda do A (origem outro_clube, 7 chaves da 519)',
  t.ant() like '%pesquisador:' || :'nome_a' || ':outro_clube%', true);
select t.eq('5) ...com exatamente as 7 chaves da 519',
  t.txt($q$select string_agg(k, ',') from (select json_object_keys(x) k from (select (public.classes_concluidas_anteriormente()->>0)::json x) y) z$q$),
  'class_id,codigo,nome,avancada,concluida_em,origem_clube_nome,origem');
reset role;
select t.eq('5) nenhuma matrícula nasceu no B por causa disso (só as do próprio fluxo)', (select count(*) from public.member_classes where usuario_id = t.id('multi_dois_papeis') and club_id = t.id('clube_b') and class_id = t.classe('pesquisador')), 0);
select t.eq('5) nada de aprovação/snapshot/documento/investidura criado pelo registro do multi', t.tudo(), (select antes from t.foto5b));

-- ==================== 6) idade/nascimento não são pré-requisito do histórico ====================
update public.profiles set nascimento = null where id = t.id('membro_a2');
select t.como('lider_a'); select t.pedir_clube('clube_a');
select t.permitido('6) membro SEM nascimento: registra a Guia (idade mínima 15) — histórico real', t.reg('membro_a2', 'guia', '2015-01-01'));
reset role;
select t.nasce('membro_a2', 10);
select t.como('lider_a'); select t.pedir_clube('clube_a');
select t.permitido('6) membro de 10 anos (hoje abaixo da idade mínima da Guia): registra Guia de Exploração (avançada)', t.reg('membro_a2', 'guia_de_exploracao', null, true));
reset role;
select t.nasce('membro_a2', 13);

-- ==================== 7) comprovante ====================
select t.arq('clube_a', 'membro_a') || '7a1b2c3d-0000-4000-8000-000000000001.jpg' as f1 \gset
select t.arq('clube_a', 'membro_a') || '7a1b2c3d-0000-4000-8000-000000000002.jpg' as f2 \gset
select t.arq('clube_a', 'membro_a') || '7a1b2c3d-0000-4000-8000-000000000003.jpg' as f3 \gset
select t.arq('clube_a', 'membro_a2') || '7a1b2c3d-0000-4000-8000-000000000004.jpg' as f4 \gset
select t.arq('clube_b', 'membro_b') || '7a1b2c3d-0000-4000-8000-000000000005.jpg' as f5 \gset
select t.id('membro_a')::text || '/conclusao-anterior/7a1b2c3d-0000-4000-8000-000000000006.jpg' as fvelho \gset
select t.arq('clube_a', 'membro_a') || 'foto-solta.jpg' as fnome \gset
-- Storage como a liderança (policies novas)
select t.como('instrutor_a'); select t.pedir_clube('clube_a');
select t.permitido('7) instrutor envia comprovante para a pasta de membro_a (bucket privado)', format($q$insert into storage.objects (bucket_id, name, owner_id) values ('comprovacoes', %L, auth.uid()::text)$q$, :'f1'));
select t.permitido('7) ...e outro arquivo (será usado)', format($q$insert into storage.objects (bucket_id, name, owner_id) values ('comprovacoes', %L, auth.uid()::text)$q$, :'f2'));
select t.permitido('7) ...e um terceiro (ficará sem uso)', format($q$insert into storage.objects (bucket_id, name, owner_id) values ('comprovacoes', %L, auth.uid()::text)$q$, :'f3'));
select t.permitido('7) ...e um para membro_a2', format($q$insert into storage.objects (bucket_id, name, owner_id) values ('comprovacoes', %L, auth.uid()::text)$q$, :'f4'));
select t.bloqueado('7) instrutor do A não envia para a pasta do clube B', format($q$insert into storage.objects (bucket_id, name, owner_id) values ('comprovacoes', %L, auth.uid()::text)$q$, :'f5'));
select t.bloqueado('7) ...nem para quem não é do clube (sem_clube)', format($q$insert into storage.objects (bucket_id, name, owner_id) values ('comprovacoes', %L, auth.uid()::text)$q$, t.arq('clube_a', 'sem_clube') || '7a1b2c3d-0000-4000-8000-000000000007.jpg'));
select t.bloqueado('7) ...nem para a pasta de um responsável (pais)', format($q$insert into storage.objects (bucket_id, name, owner_id) values ('comprovacoes', %L, auth.uid()::text)$q$, t.arq('clube_a', 'pais_a') || '7a1b2c3d-0000-4000-8000-000000000008.jpg'));
select t.bloqueado('7) ...nem com nome fora do padrão <uuid>.<ext>', format($q$insert into storage.objects (bucket_id, name, owner_id) values ('comprovacoes', %L, auth.uid()::text)$q$, :'fnome'));
select t.bloqueado('7) ...nem com pasta mais funda', format($q$insert into storage.objects (bucket_id, name, owner_id) values ('comprovacoes', %L, auth.uid()::text)$q$, t.arq('clube_a', 'membro_a') || 'x/7a1b2c3d-0000-4000-8000-000000000009.jpg'));
reset role;
select t.como('conselheiro_a'); select t.pedir_clube('clube_a');
select t.bloqueado('7) conselheiro não envia', format($q$insert into storage.objects (bucket_id, name, owner_id) values ('comprovacoes', %L, auth.uid()::text)$q$, t.arq('clube_a', 'membro_a') || '7a1b2c3d-0000-4000-8000-000000000010.jpg'));
reset role;
select t.como('lider_b'); select t.pedir_clube('clube_b');
select t.bloqueado('7) diretoria do B não envia para a pasta do A', format($q$insert into storage.objects (bucket_id, name, owner_id) values ('comprovacoes', %L, auth.uid()::text)$q$, t.arq('clube_a', 'membro_a') || '7a1b2c3d-0000-4000-8000-000000000011.jpg'));
reset role;
select t.como('membro_a'); select t.pedir_clube('clube_a');
select t.bloqueado('7) o próprio membro não envia para a pasta de outra pessoa', format($q$insert into storage.objects (bucket_id, name, owner_id) values ('comprovacoes', %L, auth.uid()::text)$q$, t.arq('clube_a', 'membro_a2') || '7a1b2c3d-0000-4000-8000-000000000012.jpg'));
-- leitura
select t.eq('7) o dono lê o próprio comprovante', t.nv(format($q$select count(*) from storage.objects where bucket_id = 'comprovacoes' and name = %L$q$, :'f1')), 1);
reset role;
select t.como('membro_a2'); select t.pedir_clube('clube_a');
select t.eq('7) outro membro NÃO lê o comprovante de membro_a', t.nv(format($q$select count(*) from storage.objects where bucket_id = 'comprovacoes' and name = %L$q$, :'f1')), 0);
reset role;
select t.como('tesoureiro_a'); select t.pedir_clube('clube_a');
select t.eq('7) tesoureiro NÃO lê', t.nv(format($q$select count(*) from storage.objects where bucket_id = 'comprovacoes' and name = %L$q$, :'f1')), 0);
reset role;
select t.como('lider_b'); select t.pedir_clube('clube_b');
select t.eq('7) diretoria de OUTRO clube NÃO lê', t.nv(format($q$select count(*) from storage.objects where bucket_id = 'comprovacoes' and name = %L$q$, :'f1')), 0);
reset role;
select t.como('instrutor_a'); select t.pedir_clube('clube_a');
select t.eq('7) a liderança do clube lê', t.nv(format($q$select count(*) from storage.objects where bucket_id = 'comprovacoes' and name = %L$q$, :'f1')), 1);
reset role;
select t.eq('7) o bucket continua PRIVADO', (select public from storage.buckets where id = 'comprovacoes'), false);

-- comprovante no registro
select t.como('instrutor_a'); select t.pedir_clube('clube_a');
select t.throws('7) caminho com nome de OUTRO membro é recusado', t.reg('membro_a', 'companheiro', '2020-01-01', false, 'observação válida', :'f4'), 'Comprovante inválido');
select t.throws('7) caminho do formato antigo é recusado', t.reg('membro_a', 'companheiro', '2020-01-01', false, 'observação válida', :'fvelho'), 'Comprovante inválido');
select t.throws('7) caminho de outro clube é recusado', t.reg('membro_b', 'companheiro', '2020-01-01', false, 'observação válida', :'f5'), 'sem vínculo ativo');
select t.throws('7) caminho inexistente no Storage é recusado', t.reg('membro_a', 'companheiro', '2020-01-01', false, 'observação válida', t.arq('clube_a', 'membro_a') || '7a1b2c3d-0000-4000-8000-0000000000ff.jpg'), 'Comprovante não encontrado');
select t.throws('7) caminho com ../ é recusado', t.reg('membro_a', 'companheiro', '2020-01-01', false, 'observação válida', t.arq('clube_a', 'membro_a') || '../7a1b2c3d-0000-4000-8000-000000000001.jpg'), 'Comprovante inválido');
select t.permitido('7) registro com comprovante válido', t.reg('membro_a', 'companheiro', '2020-01-01', false, 'observação válida', :'f2'));
select t.throws('7) o MESMO arquivo não serve a dois registros', t.reg('membro_a', 'guia', '2020-01-01', false, 'observação válida', :'f2'), 'já está em outro registro');
reset role;
select t.eq('7) o caminho ficou no registro e é único', (select count(*) from public.curriculum_achievements where comprovante_path = :'f2'), 1);
select t.como('instrutor_a'); select t.pedir_clube('clube_a');
select t.eq('7) a liderança vê tem_comprovante e o caminho (para assinar a URL)',
  t.txt(format($q$select (x->>'tem_comprovante') || '|' || (x->>'comprovante_path' = %L)::text from json_array_elements(public.classe_concluidas_do_membro(%L)) x where x->>'codigo' = 'companheiro'$q$, :'f2', t.id('membro_a'))), 'true|true');
select t.eq('7) instrutor PODE apagar (pela policy) comprovante enviado e nunca usado', public.pode_apagar_conclusao_anterior(:'f3'), true);
select t.eq('7) ...e NÃO o que está em uso', public.pode_apagar_conclusao_anterior(:'f2'), false);
reset role;
select t.como('tesoureiro_a'); select t.pedir_clube('clube_a');
select t.eq('7) tesoureiro não apaga (policy)', public.pode_apagar_conclusao_anterior(:'f4'), false);
reset role;

-- ==================== 8) leitura da liderança: classe_concluidas_do_membro ====================
select t.como('instrutor_a'); select t.pedir_clube('clube_a');
select t.eq('8) chaves exatas do item', t.txt(format($q$select string_agg(k, ',') from (select json_object_keys(x) k from (select (public.classe_concluidas_do_membro(%L)->>0)::json x) y) z$q$, t.id('membro_a'))),
  'achievement_id,class_id,codigo,nome,avancada,origem,status,concluida_em,data_desconhecida,clube_nome,neste_clube,registrado_em,registrado_por_nome,registrado_papel,observacao,tem_comprovante,comprovante_path,revogada_em,revogada_motivo,pode_revogar');
select t.eq('8) membro_a: Amigo, Companheiro e Pesquisador, todas registro_anterior neste clube',
  t.txt(format($q$select string_agg((x->>'codigo') || ':' || (x->>'origem') || ':' || (x->>'neste_clube') || ':' || (x->>'pode_revogar'), ',' order by x->>'codigo') from json_array_elements(public.classe_concluidas_do_membro(%L)) x$q$, t.id('membro_a'))),
  'amigo:registro_anterior:true:true,companheiro:registro_anterior:true:true,pesquisador:registro_anterior:true:true');
select t.eq('8) o registro mostra quem registrou (nome), o papel e a observação', t.txt(format($q$select (x->>'registrado_por_nome') is not null and x->>'registrado_papel' = 'instrutor' and x->>'observacao' = 'Cartão da classe, conferido pela diretoria' from json_array_elements(public.classe_concluidas_do_membro(%L)) x where x->>'codigo' = 'amigo'$q$, t.id('membro_a'))), 'true');
select t.throws('8) pessoa que não é do clube', format($q$select public.classe_concluidas_do_membro(%L)$q$, t.id('membro_b')), 'sem vínculo ativo');
reset role;
select t.como('membro_a'); select t.pedir_clube('clube_a');
select t.throws('8) desbravador não usa a leitura da liderança', format($q$select public.classe_concluidas_do_membro(%L)$q$, t.id('membro_a')), 'Sem permissão');
reset role;
select t.como('conselheiro_a'); select t.pedir_clube('clube_a');
select t.throws('8) conselheiro também não', format($q$select public.classe_concluidas_do_membro(%L)$q$, t.id('membro_a')), 'Sem permissão');
reset role;
-- o B vê o registro feito no A (multi tem vínculo nos dois), sem detalhes internos do A
select t.como('lider_b'); select t.pedir_clube('clube_b');
select t.eq('8) o B vê a conclusão vinda do A, sem observação/ator/comprovante e sem poder revogar',
  t.txt(format($q$select (x->>'origem') || '|' || (x->>'neste_clube') || '|' || coalesce(x->>'observacao', 'null') || '|' || coalesce(x->>'registrado_por_nome', 'null') || '|' || (x->>'tem_comprovante') || '|' || (x->>'pode_revogar') from json_array_elements(public.classe_concluidas_do_membro(%L)) x where x->>'codigo' = 'pesquisador'$q$, t.id('multi_dois_papeis'))),
  'registro_anterior|false|null|null|false|false');
reset role;

-- ==================== 9) revogar ====================
select t.como('membro_a'); select t.pedir_clube('clube_a');
select t.throws('9) desbravador não revoga', format($q$select public.classe_concluida_anteriormente_revogar(%L, 'motivo qualquer válido')$q$, t.ach('membro_a', 'amigo', 'clube_a')), 'Sem permissão');
reset role;
select t.como('lider_b'); select t.pedir_clube('clube_b');
select t.throws('9) diretoria de OUTRO clube não revoga (mesma resposta de "não existe")', format($q$select public.classe_concluida_anteriormente_revogar(%L, 'motivo qualquer válido')$q$, t.ach('membro_a', 'amigo', 'clube_a')), 'não encontrado ou sem permissão');
select t.throws('9) id inexistente: mesma resposta', $q$select public.classe_concluida_anteriormente_revogar('11111111-1111-4111-8111-111111111111', 'motivo qualquer válido')$q$, 'não encontrado ou sem permissão');
select t.throws('9) o B não revoga nem a conquista do próprio multi registrada no A', format($q$select public.classe_concluida_anteriormente_revogar(%L, 'motivo qualquer válido')$q$, t.ach('multi_dois_papeis', 'pesquisador', 'clube_a')), 'não encontrado ou sem permissão');
select t.throws('9) conclusão REAL do app não se revoga por aqui', format($q$select public.classe_concluida_anteriormente_revogar(%L, 'motivo qualquer válido')$q$, t.ach_app('membro_b', 'amigo')), 'feita no app');
reset role;
select t.como('instrutor_a'); select t.pedir_clube('clube_a');
select t.throws('9) motivo curto', format($q$select public.classe_concluida_anteriormente_revogar(%L, 'abc')$q$, t.ach('membro_a', 'amigo', 'clube_a')), 'pelo menos 5');
select t.throws('9) motivo nulo', format($q$select public.classe_concluida_anteriormente_revogar(%L, null)$q$, t.ach('membro_a', 'amigo', 'clube_a')), 'pelo menos 5');
select t.throws('9) a revogação genérica recusa registro_anterior (precisa de log)', format($q$select public.curriculum_achievement_revogar(%L, 'motivo qualquer válido')$q$, t.ach('membro_a', 'amigo', 'clube_a')), 'classe_concluida_anteriormente_revogar');
reset role;
select t.eq('9) nada foi revogado até aqui', (select count(*) from public.curriculum_achievements where status = 'revogada'), 0);
create table t.foto9 as select t.nach() as a, t.nlog() as l, t.tudo() as tudo;
select t.como('instrutor_a'); select t.pedir_clube('clube_a');
select t.permitido('9) instrutor revoga o registro da Amigo (com motivo)', format($q$select public.classe_concluida_anteriormente_revogar(%L, 'Registrada por engano: cartão de outra pessoa')$q$, t.ach('membro_a', 'amigo', 'clube_a')));
reset role;
select t.eq('9) NUNCA delete: o número de conquistas é o mesmo; a linha ficou revogada com autor, data e motivo',
  (select count(*) from public.curriculum_achievements) = (select a from t.foto9)
  and exists (select 1 from public.curriculum_achievements a where a.usuario_id = t.id('membro_a') and a.classe_id = t.classe('amigo') and a.status = 'revogada'
              and a.revogada_por = t.id('instrutor_a') and a.revogada_em is not null and a.revogada_motivo = 'Registrada por engano: cartão de outra pessoa' and a.origem = 'registro_anterior'), true);
select t.eq('9) log de revogar com ator, clube, motivo, antes e depois',
  (select count(*) from public.class_prior_completion_log where acao = 'revogar' and ator_id = t.id('instrutor_a') and club_id = t.id('clube_a') and usuario_id = t.id('membro_a')
      and motivo like 'Registrada por engano%' and antes->>'status' = 'ativa' and depois->>'status' = 'revogada'), 1);
select t.eq('9) revogar não criou matrícula/aprovação/documento/etc.', t.tudo(), (select tudo from t.foto9));
select t.como('instrutor_a'); select t.pedir_clube('clube_a');
select t.throws('9) revogar duas vezes recusa', format($q$select public.classe_concluida_anteriormente_revogar(%L, 'motivo qualquer válido')$q$, t.ach_rev('membro_a', 'amigo')), 'já está revogado');
select t.eq('9) o item revogado aparece na leitura da liderança com pode_revogar=false e motivo',
  t.txt(format($q$select (x->>'status') || '|' || (x->>'pode_revogar') || '|' || (x->>'revogada_motivo') from json_array_elements(public.classe_concluidas_do_membro(%L)) x where x->>'codigo' = 'amigo'$q$, t.id('membro_a'))), 'revogada|false|Registrada por engano: cartão de outra pessoa');
reset role;
select t.como('membro_a'); select t.pedir_clube('clube_a');
select t.eq('9) depois de revogar a Amigo volta a ser oferecida', left(t.d('amigo'), 5), 'true|');
select t.eq('9) ...e sai da lista de anteriores', t.ant() not like 'amigo:%', true);
select t.eq('9) ...e a minha_jornada não a mostra mais', t.txt($q$select count(*)::text from json_array_elements(public.minha_jornada()->'conquistas') x where x->>'nome' = 'Amigo'$q$), '0');
reset role;
select t.eq('9) ...e a dependência deixa de valer (modo concluída)', public._dependencia_de_classe_satisfeita(t.id('membro_a'), t.classe('amigo'), 'concluida', t.id('clube_a')), false);
select t.eq('9) ...e curriculo_pessoa_concluiu volta a false', public.curriculo_pessoa_concluiu('classe', t.id('membro_a'), t.classe('amigo'), null), false);
-- re-registrar depois de revogar: nova linha, histórico preservado (índice único ignora o revogado)
select t.como('lider_a'); select t.pedir_clube('clube_a');
select t.permitido('9) registrar de novo depois de revogar funciona', t.reg('membro_a', 'amigo', '2020-05-11', false, 'Cartão conferido corretamente agora'));
reset role;
select t.eq('9) ...e ficam 2 linhas da Amigo (uma revogada, uma ativa); log com 2 "registrar" + 1 "revogar" da Amigo',
  (select count(*) from public.curriculum_achievements where usuario_id = t.id('membro_a') and classe_id = t.classe('amigo'))::text || '|' ||
  (select count(*) from public.class_prior_completion_log where usuario_id = t.id('membro_a') and class_id = t.classe('amigo'))::text, '2|3');
-- uma conclusão REAL no mesmo clube depois de um registro revogado não é engolida pelo índice
select t.como('lider_a'); select t.pedir_clube('clube_a');
select t.permitido('9) revoga de novo para testar a conclusão real depois', format($q$select public.classe_concluida_anteriormente_revogar(%L, 'Para testar a conclusão real depois')$q$, t.ach('membro_a', 'amigo', 'clube_a')));
reset role;
select t.como('membro_a'); select t.pedir_clube('clube_a');
select t.permitido('9) membro_a inicia a Amigo de verdade (classe voltou a ser oferecida)', format($q$select public.classe_iniciar(%L)$q$, t.classe('amigo')));
reset role;
select t.concluir('membro_a', 'amigo', 'clube_a');
select t.eq('9) a conclusão REAL gerou conquista ativa conclusao_no_app (não foi engolida pelo registro revogado)',
  (select count(*) from public.curriculum_achievements where usuario_id = t.id('membro_a') and classe_id = t.classe('amigo') and status = 'ativa' and origem = 'conclusao_no_app'), 1);

-- ==================== 10) imutabilidade e permissões ====================
select t.throws('10) log: UPDATE falha', $q$update public.class_prior_completion_log set motivo = 'outro motivo'$q$, 'imutável');
select t.throws('10) log: DELETE falha', $q$delete from public.class_prior_completion_log$q$, 'imutável');
select t.throws('10) log: TRUNCATE falha', $q$truncate public.class_prior_completion_log$q$, 'imutável');
select t.throws('10) registro_anterior: observação não muda', format($q$update public.curriculum_achievements set observacao = 'adulterada' where id = (select id from public.curriculum_achievements where usuario_id = %L and classe_id = %L and origem = 'registro_anterior' limit 1)$q$, t.id('membro_a'), t.classe('amigo')), 'imutável');
select t.throws('10) registro_anterior: data não muda', format($q$update public.curriculum_achievements set concluida_em = now() where usuario_id = %L and classe_id = %L and origem = 'registro_anterior'$q$, t.id('membro_a'), t.classe('amigo')), 'imutável');
select t.throws('10) a origem de uma conquista não se troca (nem a do app)', format($q$update public.curriculum_achievements set origem = 'registro_anterior' where usuario_id = %L and classe_id = %L and origem = 'conclusao_no_app'$q$, t.id('membro_a'), t.classe('amigo')), 'origem');
select t.throws('10) constraint: registro_anterior exige observação e carimbo', format($q$insert into public.curriculum_achievements (usuario_id, tipo, classe_id, club_id_origem, concluida_em, origem) values (%L, 'classe', %L, %L, now(), 'registro_anterior')$q$, t.id('membro_a'), t.classe('guia'), t.id('clube_a')), 'registro_coerente');
select t.como('lider_a'); select t.pedir_clube('clube_a');
select t.throws('10) liderança não lê o log direto (só pelas RPCs)', $q$select count(*) from public.class_prior_completion_log$q$, 'permission denied');
select t.bloqueado('10) liderança não insere conquista direto', format($q$insert into public.curriculum_achievements (usuario_id, tipo, classe_id, club_id_origem, concluida_em, origem, registrado_em, registrado_no_club_id, registrado_papel, observacao) values (%L, 'classe', %L, %L, now(), 'registro_anterior', now(), %L, 'diretoria', 'observação válida')$q$, t.id('membro_a'), t.classe('guia'), t.id('clube_a'), t.id('clube_a')));
select t.bloqueado('10) liderança não apaga conquista direto', $q$delete from public.curriculum_achievements$q$);
select t.bloqueado('10) liderança não altera conquista direto', $q$update public.curriculum_achievements set status = 'revogada'$q$);
reset role;
-- parâmetros que não existem
select t.como('lider_a'); select t.pedir_clube('clube_a');
select t.throws('10) p_club_id não existe no registrar', format($q$select public.classe_concluida_anteriormente_registrar(p_usuario_id => %L, p_class_id => %L, p_concluida_em => '2020-01-01', p_observacao => 'observação válida', p_club_id => %L)$q$, t.id('membro_a2'), t.classe('pesquisador'), t.id('clube_b')), 'does not exist');
select t.throws('10) p_nome não existe no registrar', format($q$select public.classe_concluida_anteriormente_registrar(p_usuario_id => %L, p_class_id => %L, p_concluida_em => '2020-01-01', p_observacao => 'observação válida', p_nome => 'x')$q$, t.id('membro_a2'), t.classe('pesquisador')), 'does not exist');
select t.throws('10) p_club_id não existe no revogar', format($q$select public.classe_concluida_anteriormente_revogar(p_achievement_id => %L, p_motivo => 'motivo válido', p_club_id => %L)$q$, t.ach('membro_a2', 'companheiro', 'clube_a'), t.id('clube_b')), 'does not exist');
select t.throws('10) p_club_id não existe na leitura', format($q$select public.classe_concluidas_do_membro(p_usuario_id => %L, p_club_id => %L)$q$, t.id('membro_a'), t.id('clube_b')), 'does not exist');
reset role;
select t.eq('10) as 3 RPCs: authenticated executa, anon NÃO',
  (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace
     and p.proname in ('classe_concluida_anteriormente_registrar', 'classe_concluida_anteriormente_revogar', 'classe_concluidas_do_membro')
     and has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute')), 3);
select t.eq('10) todas security definer com search_path vazio (RPCs, gatilhos e helpers novos)',
  (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace
     and p.proname in ('classe_concluida_anteriormente_registrar', 'classe_concluida_anteriormente_revogar', 'classe_concluidas_do_membro', 'classes_concluidas_anteriormente',
                       'minha_jornada', 'curriculum_achievement_revogar', 'registrar_conquista_curricular', '_proteger_registro_anterior', '_class_prior_log_sem_truncate',
                       'pode_enviar_conclusao_anterior', 'pode_ver_conclusao_anterior', 'pode_apagar_conclusao_anterior')
     and not (p.prosecdef and exists (select 1 from unnest(p.proconfig) c where c in ('search_path=""', 'search_path=')))), 0);
select t.eq('10) helpers internos sem execute para anon/authenticated',
  (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace
     and p.proname in ('_proteger_registro_anterior', '_class_prior_log_sem_truncate', '_conclusao_anterior_caminho_ok', '_conclusao_anterior_pasta')
     and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))), 0);
select t.eq('10) a tabela de log tem RLS ligado e nenhum privilégio para app', (select relrowsecurity from pg_class where oid = 'public.class_prior_completion_log'::regclass)::text || '|'
  || (has_table_privilege('authenticated', 'public.class_prior_completion_log', 'select') or has_table_privilege('anon', 'public.class_prior_completion_log', 'select'))::text, 'true|false');
select t.eq('10) o log registrou ao todo registros e revogações com ator e clube preenchidos',
  (select count(*) from public.class_prior_completion_log where ator_id is null or club_id is null or length(motivo) < 5), 0);
select t.fim();
rollback;
