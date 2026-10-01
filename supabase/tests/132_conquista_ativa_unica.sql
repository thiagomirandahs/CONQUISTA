-- Conquista curricular de CLASSE (migration 527): UMA ATIVA por pessoa + classe EQUIVALENTE, garantida pelo banco; a REVOGADA fica no histórico
-- e nunca mais bloqueia uma nova conclusão legítima.
--  * A) conclusão normal; B) conclusão em outro clube (reconhece, 1 ativa); C) registro anterior; D) reconhecimento de conclusão existente;
--  * E) revogada: histórico preservado (ator/clube/data/motivo iguais antes/depois); F) nova conclusão depois da revogação gera NOVA ativa
--    (inclusive reinvestir no MESMO clube: o bug achado na 525);
--  * G) o BANCO recusa a 2ª ativa equivalente (clubes/versões diferentes; classe fora do catálogo oficial só equivale a ela mesma);
--  * H) três clubes; I) multiclube: progresso em andamento isolado; J) tentativas de duplicar (insert direto, RPC repetida, reconhecer 2x);
--  * K) a verificação de duplicatas pré-existentes (aborto da migration) enxerga o que o índice impediria.
begin;
\ir _lib.sql
\ir _curriculo_regular_2026.sql
\ir _fixtures.sql
insert into public.club_features (club_id, feature, enabled) values (t.id('clube_a'), 'classes', true), (t.id('clube_b'), 'classes', true)
on conflict (club_id, feature) do update set enabled = true;

-- 3º clube
insert into public.organizational_units (type, nome, slug, pais, timezone, metadata)
values ('clube', 'Clube C (teste)', 'clube-c-teste', 'BR', 'America/Recife', '{"test_only":true}');
insert into t.ids (chave, id) select 'clube_c', id from public.organizational_units where slug = 'clube-c-teste';
insert into public.unidades (nome, cor, club_id) values ('Teste C1', '#444444', t.id('clube_c'));
insert into t.ids (chave, id) select 'C1', id from public.unidades where nome = 'Teste C1';
insert into public.club_features (club_id, feature, enabled) values (t.id('clube_c'), 'classes', true)
on conflict (club_id, feature) do update set enabled = true;

create function t.classe(p_codigo text) returns uuid language sql stable security definer as $$
  select public.curriculo_uuid('class:2026.4:' || p_codigo) $$;
create function t.classe_v(p_versao text, p_codigo text) returns uuid language sql stable security definer as $$
  select public.curriculo_uuid('class:' || p_versao || ':' || p_codigo) $$;
create function t.mc(p_chave text, p_codigo text, p_clube text) returns uuid language sql stable security definer as $$
  select id from public.member_classes where usuario_id = t.id(p_chave) and club_id = t.id(p_clube) and class_id = t.classe(p_codigo) $$;
create function t.concluir(p_chave text, p_codigo text, p_clube text) returns void language sql security definer as $$
  update public.member_classes set status = 'investida', concluida_em = now() - interval '2 days', investida_em = now() - interval '1 day'
   where id = t.mc(p_chave, p_codigo, p_clube) $$;
create function t.reabrir(p_chave text, p_codigo text, p_clube text) returns void language sql security definer as $$
  update public.member_classes set status = 'em_andamento', concluida_em = null, investida_em = null
   where id = t.mc(p_chave, p_codigo, p_clube) $$;
create function t.reg(p_chave text, p_codigo text, p_data text default '2020-05-10') returns text language sql stable as $$
  select format($q$select public.classe_concluida_anteriormente_registrar(%L, %L, %L::date, false, 'Cartão da classe, conferido pela diretoria', null)$q$, t.id(p_chave), t.classe(p_codigo), p_data) $$;
create function t.nach(p_chave text, p_codigo text) returns bigint language sql stable security definer as $$
  select count(*) from public.curriculum_achievements where usuario_id = t.id(p_chave) and classe_id = t.classe(p_codigo) $$;
create function t.nativ(p_chave text, p_codigo text) returns bigint language sql stable security definer as $$
  select count(*) from public.curriculum_achievements where usuario_id = t.id(p_chave) and classe_id = t.classe(p_codigo) and status = 'ativa' $$;
create function t.nrec(p_chave text, p_codigo text) returns bigint language sql stable security definer as $$
  select count(*) from public.class_completion_recognitions where usuario_id = t.id(p_chave) and class_id = t.classe(p_codigo) $$;
create function t.ativa(p_chave text, p_codigo text) returns uuid language sql stable security definer as $$
  select id from public.curriculum_achievements where usuario_id = t.id(p_chave) and classe_id = t.classe(p_codigo) and status = 'ativa' $$;
create function t.rede(p_clube text, p_mc uuid) returns bigint language sql stable security definer as $$
  select count(*) from public._rede_conquistas_do_clube(t.id(p_clube)) where origem_tipo = 'classe' and origem_id = p_mc $$;
create table t.snap (chave text primary key, j jsonb not null);

update public.profiles set nascimento = (current_date - interval '13 years')::date where id in (t.id('membro_a'), t.id('membro_a2'), t.id('membro_b'));
select t.mk('tres', 'Tres Clubes', 'desbravador', 'ativo', 'clube_a', 'A1', (current_date - interval '13 years')::date);
select t.mk2('tres', 'desbravador', 'ativo', 'clube_b', 'B1');
select t.mk2('tres', 'desbravador', 'ativo', 'clube_c', 'C1');
select t.mk2('membro_a', 'desbravador', 'ativo', 'clube_b', 'B1');
select t.mk2('membro_a2', 'desbravador', 'ativo', 'clube_b', 'B1');
select t.mk2('membro_b', 'desbravador', 'ativo', 'clube_a', 'A1');

-- ==================== estrutura: índices e coluna ====================
select t.eq('estrutura: índice único parcial por pessoa+classe equivalente, só de ATIVAS',
  (select indexdef like '%(usuario_id, classe_codigo)%' and indexdef like '%UNIQUE%' and indexdef like '%status = ''ativa''%'
     from pg_indexes where indexname = 'ux_curriculum_achievements_classe_ativa_pessoa'), true);
select t.eq('estrutura: índice antigo agora só de ATIVAS (a revogada nunca ocupa a vaga)',
  (select indexdef like '%status = ''ativa''%' and indexdef not like '%registro_anterior%' from pg_indexes where indexname = 'ux_curriculum_achievements_classe'), true);

-- ==================== A) conclusão normal ====================
select t.como('membro_a'); select t.pedir_clube('clube_a');
select t.permitido('A) membro_a inicia Amigo no A', format($q$select public.classe_iniciar(%L)$q$, t.classe('amigo')));
select t.pedir_clube('clube_b');
select t.permitido('B) ...e Amigo no B (a 519 só bloqueia depois que existe conclusão)', format($q$select public.classe_iniciar(%L)$q$, t.classe('amigo')));
reset role;
select t.concluir('membro_a', 'amigo', 'clube_a');
select t.eq('A) conclusão normal cria 1 conquista ATIVA, conclusao_no_app, clube A, sem reconhecimento',
  t.nach('membro_a', 'amigo') || '|' || t.nativ('membro_a', 'amigo') || '|' || t.nrec('membro_a', 'amigo') || '|'
  || (select origem || '/' || (club_id_origem = t.id('clube_a'))::text || '/' || (member_class_id = t.mc('membro_a', 'amigo', 'clube_a'))::text from public.curriculum_achievements where id = t.ativa('membro_a', 'amigo')),
  '1|1|0|conclusao_no_app/true/true');
select t.eq('A) classe_codigo preenchido pelo gatilho com o código oficial',
  (select classe_codigo from public.curriculum_achievements where id = t.ativa('membro_a', 'amigo')), 'amigo');
-- I) progresso em andamento do outro clube fica isolado
select t.eq('I) a matrícula do B segue em andamento e isolada (a conquista do A não a conclui)',
  (select status from public.member_classes where id = t.mc('membro_a', 'amigo', 'clube_b')) || '|' || public.classe_percentual(t.mc('membro_a', 'amigo', 'clube_b')), 'em_andamento|0');

-- ==================== B) conclusão em outro clube: reconhece, 1 ativa ====================
select t.concluir('membro_a', 'amigo', 'clube_b');
select t.eq('B) a 2ª conclusão (clube B) NÃO cria 2ª conquista: 1 ativa + 1 reconhecimento; a matrícula do B fica investida',
  t.nach('membro_a', 'amigo') || '|' || t.nativ('membro_a', 'amigo') || '|' || t.nrec('membro_a', 'amigo') || '|' || (select status from public.member_classes where id = t.mc('membro_a', 'amigo', 'clube_b')),
  '1|1|1|investida');
-- J) reconhecer duas vezes / reprocessar
select t.concluir('membro_a', 'amigo', 'clube_b');
select t.eq('J) reprocessar a conclusão do B: continua 1 conquista e 1 reconhecimento', t.nach('membro_a', 'amigo') || '|' || t.nrec('membro_a', 'amigo'), '1|1');
select t.reabrir('membro_a', 'amigo', 'clube_b'); select t.concluir('membro_a', 'amigo', 'clube_b');
select t.eq('J) reabrir e investir de novo: continua 1 e 1', t.nach('membro_a', 'amigo') || '|' || t.nrec('membro_a', 'amigo'), '1|1');
select t.eq('J) ponto único chamado de novo para a matrícula já reconhecida: "reconhecida", sem linha nova',
  public._classe_emitir_ou_reconhecer(t.mc('membro_a', 'amigo', 'clube_b'), t.id('membro_a'), t.classe('amigo'), t.id('clube_b'), now()) || '|' || t.nach('membro_a', 'amigo') || '|' || t.nrec('membro_a', 'amigo'),
  'reconhecida|1|1');
select t.eq('J) ponto único para a matrícula DONA da conquista ativa: "ja_propria", sem linha nova (violação do índice convertida, sem erro)',
  public._classe_emitir_ou_reconhecer(t.mc('membro_a', 'amigo', 'clube_a'), t.id('membro_a'), t.classe('amigo'), t.id('clube_a'), now()) || '|' || t.nach('membro_a', 'amigo') || '|' || t.nrec('membro_a', 'amigo'),
  'ja_propria|1|1');

-- ==================== C) registro anterior ====================
select t.como('lider_b'); select t.pedir_clube('clube_b');
select t.permitido('C) lider_b registra Amigo anterior de membro_a2', t.reg('membro_a2', 'amigo'));
reset role;
select t.eq('C) 1 conquista ativa registro_anterior (B), com classe_codigo',
  t.nach('membro_a2', 'amigo') || '|' || t.nativ('membro_a2', 'amigo') || '|' || (select origem || '/' || classe_codigo from public.curriculum_achievements where id = t.ativa('membro_a2', 'amigo')),
  '1|1|registro_anterior/amigo');
-- J) repetir a RPC
select t.como('lider_b'); select t.pedir_clube('clube_b');
select t.throws('J) o mesmo registro repetido no B recusa (neste clube)', t.reg('membro_a2', 'amigo', '2021-01-01'), 'já consta como concluída por esta pessoa neste clube');
reset role;
select t.como('lider_a'); select t.pedir_clube('clube_a');
select t.throws('J) o registro pelo clube A recusa (em outro clube)', t.reg('membro_a2', 'amigo', '2021-01-01'), 'já consta como concluída por esta pessoa em outro clube');
reset role;
select t.eq('J) as recusas não criaram nada', t.nach('membro_a2', 'amigo'), 1);

-- ==================== E) revogada: histórico preservado ====================
insert into t.snap select 'prior_b_antes', to_jsonb(a) - 'status' - 'revogada_em' - 'revogada_por' - 'revogada_motivo'
  from public.curriculum_achievements a where a.id = t.ativa('membro_a2', 'amigo');
create table t.id_prior_b as select t.ativa('membro_a2', 'amigo') as id;
grant select on t.id_prior_b to public;
select t.como('lider_b'); select t.pedir_clube('clube_b');
select t.permitido('E) lider_b revoga o registro anterior (com motivo)', format($q$select public.classe_concluida_anteriormente_revogar(%L, 'Registro lançado por engano')$q$, (select id from t.id_prior_b)));
reset role;
select t.eq('E) a linha revogada continua lá e TODOS os dados originais (origem, ator, clube, data, observação) estão idênticos aos de antes',
  (select (to_jsonb(a) - 'status' - 'revogada_em' - 'revogada_por' - 'revogada_motivo' = (select j from t.snap where chave = 'prior_b_antes'))::text
     from public.curriculum_achievements a where a.id = (select id from t.id_prior_b)), 'true');
select t.eq('E) revogação auditada: status, motivo, quem e quando',
  (select a.status || '|' || a.revogada_motivo || '|' || (a.revogada_por = t.id('lider_b'))::text || '|' || (a.revogada_em is not null)::text from public.curriculum_achievements a where a.id = (select id from t.id_prior_b)),
  'revogada|Registro lançado por engano|true|true');
select t.eq('E) a revogada não conta como ativa', t.nativ('membro_a2', 'amigo'), 0);
insert into t.snap select 'prior_b_revogada', to_jsonb(a) from public.curriculum_achievements a where a.id = (select id from t.id_prior_b);

-- ==================== F) nova conclusão depois da revogação gera NOVA ativa ====================
-- F1) registro anterior de novo, em outro clube (A) e depois de novo no MESMO clube do revogado (B)
select t.como('lider_a'); select t.pedir_clube('clube_a');
select t.permitido('F) após a revogação, o clube A registra a mesma classe de novo', t.reg('membro_a2', 'amigo', '2019-03-03'));
reset role;
select t.eq('F) 2 linhas (a revogada do B + a nova do A), só 1 ativa, do A', t.nach('membro_a2', 'amigo') || '|' || t.nativ('membro_a2', 'amigo') || '|' || (select (club_id_origem = t.id('clube_a'))::text from public.curriculum_achievements where id = t.ativa('membro_a2', 'amigo')), '2|1|true');
select t.como('lider_a'); select t.pedir_clube('clube_a');
select t.permitido('F) o clube A revoga a sua', format($q$select public.classe_concluida_anteriormente_revogar(%L, 'Conferência refeita: era outra classe')$q$, t.ativa('membro_a2', 'amigo')));
reset role;
select t.como('lider_b'); select t.pedir_clube('clube_b');
select t.permitido('F) o MESMO clube B (da revogada) registra de novo: nasce a nova ativa', t.reg('membro_a2', 'amigo', '2018-02-02'));
reset role;
select t.eq('F) 3 linhas (2 revogadas + 1 ativa do B)', t.nach('membro_a2', 'amigo') || '|' || t.nativ('membro_a2', 'amigo') || '|' || (select (club_id_origem = t.id('clube_b') and id <> (select id from t.id_prior_b))::text from public.curriculum_achievements where id = t.ativa('membro_a2', 'amigo')), '3|1|true');

-- F2) o bug da 525: conclusão do APP revogada + reinvestir no MESMO clube
select t.como('membro_a'); select t.pedir_clube('clube_a');
select t.permitido('F) membro_a inicia Companheiro no A', format($q$select public.classe_iniciar(%L)$q$, t.classe('companheiro')));
reset role;
select t.concluir('membro_a', 'companheiro', 'clube_a');
select t.eq('F) conclusão do app: 1 ativa; a Rede a enxerga', t.nativ('membro_a', 'companheiro') || '|' || t.rede('clube_a', t.mc('membro_a', 'companheiro', 'clube_a')), '1|1');
create table t.id_app_a as select t.ativa('membro_a', 'companheiro') as id;
grant select on t.id_app_a to public;
select t.como('lider_a'); select t.pedir_clube('clube_a');
select t.permitido('F) lider_a revoga a conquista do app (curriculum_achievement_revogar)', format($q$select public.curriculum_achievement_revogar(%L, 'Correção posterior da diretoria')$q$, (select id from t.id_app_a)));
reset role;
insert into t.snap select 'app_a_revogada', to_jsonb(a) from public.curriculum_achievements a where a.id = (select id from t.id_app_a);
select t.eq('F) revogada, matrícula ainda investida: 0 ativas e a Rede NÃO publica (revogada sem substituta)', t.nativ('membro_a', 'companheiro') || '|' || t.rede('clube_a', t.mc('membro_a', 'companheiro', 'clube_a')), '0|0');
select t.reabrir('membro_a', 'companheiro', 'clube_a');   -- o que o snapshot_revogar faz com a matrícula
select t.concluir('membro_a', 'companheiro', 'clube_a');   -- reinveste no MESMO clube
select t.eq('F) reinvestir no MESMO clube gera NOVA conquista ativa (a revogada não engole): 2 linhas, 1 ativa, id diferente, mesma matrícula',
  t.nach('membro_a', 'companheiro') || '|' || t.nativ('membro_a', 'companheiro') || '|' ||
  (select (id <> (select id from t.id_app_a) and member_class_id = t.mc('membro_a', 'companheiro', 'clube_a') and club_id_origem = t.id('clube_a') and origem = 'conclusao_no_app')::text
     from public.curriculum_achievements where id = t.ativa('membro_a', 'companheiro')),
  '2|1|true');
select t.eq('F) a linha revogada ficou byte a byte igual (ator, clube, data, motivo)',
  (select (to_jsonb(a) = (select j from t.snap where chave = 'app_a_revogada'))::text from public.curriculum_achievements a where a.id = (select id from t.id_app_a)), 'true');
select t.eq('F) e a Rede volta a publicar a matrícula reinvestida (1 revogada + 1 ativa)', t.rede('clube_a', t.mc('membro_a', 'companheiro', 'clube_a')), 1);
select t.eq('F) nenhum reconhecimento indevido', t.nrec('membro_a', 'companheiro'), 0);

-- ==================== D) reconhecimento de conclusão existente (registro anterior x matrícula em andamento) ====================
select t.como('membro_b'); select t.pedir_clube('clube_b');
select t.permitido('D) membro_b inicia Amigo no B', format($q$select public.classe_iniciar(%L)$q$, t.classe('amigo')));
reset role;
select t.como('lider_a'); select t.pedir_clube('clube_a');
select t.permitido('D) a liderança do A registra Amigo anterior de membro_b', t.reg('membro_b', 'amigo', '2020-07-07'));
reset role;
select t.concluir('membro_b', 'amigo', 'clube_b');
select t.eq('D) a matrícula do B investe e RECONHECE a conquista do A: 1 ativa (registro_anterior, A), 1 reconhecimento, matrícula investida',
  t.nach('membro_b', 'amigo') || '|' || t.nativ('membro_b', 'amigo') || '|' || t.nrec('membro_b', 'amigo') || '|'
  || (select origem || '/' || (club_id_origem = t.id('clube_a'))::text from public.curriculum_achievements where id = t.ativa('membro_b', 'amigo')) || '|'
  || (select status from public.member_classes where id = t.mc('membro_b', 'amigo', 'clube_b')),
  '1|1|1|registro_anterior/true|investida');

-- ==================== H) três clubes + I) progresso isolado ====================
select t.como('tres'); select t.pedir_clube('clube_a');
select t.permitido('H) tres inicia Amigo no A', format($q$select public.classe_iniciar(%L)$q$, t.classe('amigo')));
select t.pedir_clube('clube_b');
select t.permitido('H) ...no B', format($q$select public.classe_iniciar(%L)$q$, t.classe('amigo')));
select t.pedir_clube('clube_c');
select t.permitido('H) ...e no C', format($q$select public.classe_iniciar(%L)$q$, t.classe('amigo')));
reset role;
select t.concluir('tres', 'amigo', 'clube_a');
select t.eq('I) concluir no A: as matrículas do B e do C seguem em andamento, isoladas',
  (select string_agg(status, ',' order by club_id::text) from public.member_classes where usuario_id = t.id('tres') and class_id = t.classe('amigo') and club_id in (t.id('clube_b'), t.id('clube_c'))), 'em_andamento,em_andamento');
select t.concluir('tres', 'amigo', 'clube_c');
select t.concluir('tres', 'amigo', 'clube_b');
select t.eq('H) 3 clubes: 1 ativa (do A, a primeira) + 2 reconhecimentos; as 3 matrículas investidas',
  t.nach('tres', 'amigo') || '|' || t.nativ('tres', 'amigo') || '|' || t.nrec('tres', 'amigo') || '|'
  || (select (club_id_origem = t.id('clube_a'))::text from public.curriculum_achievements where id = t.ativa('tres', 'amigo')) || '|'
  || (select count(*) from public.member_classes where usuario_id = t.id('tres') and class_id = t.classe('amigo') and status = 'investida'),
  '1|1|2|true|3');
select t.eq('H) cada reconhecimento aponta o clube da própria matrícula',
  (select string_agg((club_id = t.id('clube_b'))::text || (club_id = t.id('clube_c'))::text, ',' order by club_id::text) from public.class_completion_recognitions where usuario_id = t.id('tres')),
  (select string_agg(x, ',' order by o) from (select case when t.id('clube_b')::text < t.id('clube_c')::text then 'truefalse' else 'falsetrue' end as x, 1 as o
        union all select case when t.id('clube_b')::text < t.id('clube_c')::text then 'falsetrue' else 'truefalse' end, 2) z));

-- ==================== G) o BANCO recusa a 2ª ativa equivalente ====================
insert into public.curriculum_achievements (usuario_id, tipo, classe_id, club_id_origem, concluida_em)
values (t.id('membro_b'), 'classe', t.classe('guia'), t.id('clube_a'), now());
select t.eq('G) classe_codigo preenchido no insert direto', (select classe_codigo from public.curriculum_achievements where usuario_id = t.id('membro_b') and classe_id = t.classe('guia')), 'guia');
select t.throws('G) insert direto de 2ª ativa equivalente em OUTRO CLUBE viola o índice',
  format($q$insert into public.curriculum_achievements (usuario_id, tipo, classe_id, club_id_origem, concluida_em) values (%L, 'classe', %L, %L, now())$q$, t.id('membro_b'), t.classe('guia'), t.id('clube_b')),
  'ux_curriculum_achievements_classe_ativa_pessoa');
select t.throws('G) ...em OUTRA VERSÃO oficial (2026.3) e outro clube: também viola (equivalência por código oficial)',
  format($q$insert into public.curriculum_achievements (usuario_id, tipo, classe_id, club_id_origem, concluida_em) values (%L, 'classe', %L, %L, now())$q$, t.id('membro_b'), t.classe_v('2026.3', 'guia'), t.id('clube_c')),
  'ux_curriculum_achievements_classe_ativa_pessoa');
select t.throws('G) ...e no MESMO clube e mesma classe também viola',
  format($q$insert into public.curriculum_achievements (usuario_id, tipo, classe_id, club_id_origem, concluida_em) values (%L, 'classe', %L, %L, now())$q$, t.id('membro_b'), t.classe('guia'), t.id('clube_a')), 'duplicate key');
insert into public.curriculum_achievements (usuario_id, tipo, classe_id, club_id_origem, concluida_em)
values (t.id('membro_a2'), 'classe', t.classe('guia'), t.id('clube_a'), now());
select t.eq('G) OUTRA pessoa, mesma classe: permitido', (select count(*) from public.curriculum_achievements where classe_id = t.classe('guia') and status = 'ativa'), 2);
update public.curriculum_achievements set classe_codigo = 'forjado' where usuario_id = t.id('membro_b') and classe_id = t.classe('guia');
select t.eq('G) classe_codigo não é forjável (recalculado pelo gatilho)', (select classe_codigo from public.curriculum_achievements where usuario_id = t.id('membro_b') and classe_id = t.classe('guia')), 'guia');
-- classe fora do catálogo oficial: só equivale a ela mesma
insert into public.curriculum_achievements (usuario_id, tipo, classe_id, club_id_origem, concluida_em)
values (t.id('membro_b'), 'classe', '00000000-0000-4000-a000-000000000002', t.id('clube_a'), now());
select t.eq('G) classe do piloto (não oficial): chave "id:<uuid>", nunca confundida com código oficial',
  (select classe_codigo from public.curriculum_achievements where usuario_id = t.id('membro_b') and classe_id = '00000000-0000-4000-a000-000000000002'), 'id:00000000-0000-4000-a000-000000000002');
select t.throws('G) ...e a 2ª ativa da MESMA classe do piloto em outro clube viola',
  format($q$insert into public.curriculum_achievements (usuario_id, tipo, classe_id, club_id_origem, concluida_em) values (%L, 'classe', '00000000-0000-4000-a000-000000000002', %L, now())$q$, t.id('membro_b'), t.id('clube_b')), 'duplicate key');
-- revogada libera a vaga do índice (o histórico fica)
update public.curriculum_achievements set status = 'revogada', revogada_em = now(), revogada_motivo = 'teste' where usuario_id = t.id('membro_b') and classe_id = t.classe('guia');
insert into public.curriculum_achievements (usuario_id, tipo, classe_id, club_id_origem, concluida_em)
values (t.id('membro_b'), 'classe', t.classe('guia'), t.id('clube_b'), now());
select t.eq('G) depois de revogada, nova ativa é aceita: 2 linhas, 1 ativa', (select count(*) || '|' || count(*) filter (where status = 'ativa') from public.curriculum_achievements where usuario_id = t.id('membro_b') and classe_id = t.classe('guia')), '2|1');
select t.eq('G) especialidade fora da regra: classe_codigo nulo (check)', (select count(*) from public.curriculum_achievements where tipo <> 'classe' and classe_codigo is not null), 0);
select t.eq('G) todo registro de classe tem classe_codigo', (select count(*) from public.curriculum_achievements where tipo = 'classe' and classe_codigo is null), 0);

-- ==================== consulta portátil por equivalência ====================
select t.eq('equivalência: curriculo_pessoa_concluiu enxerga a conclusão por outra versão oficial da mesma classe',
  public.curriculo_pessoa_concluiu('classe', t.id('membro_a'), t.classe_v('2026.3', 'amigo'))::text || '|' || public.curriculo_pessoa_concluiu('classe', t.id('membro_a'), t.classe('pioneiro'))::text, 'true|false');

-- ==================== regressão: nenhum estado final tem 2 ativas equivalentes ====================
select t.eq('invariante: nenhuma pessoa tem 2 ativas da mesma classe equivalente', (select count(*) from public._conquista_classe_duplicatas_ativas()), 0);
select t.eq('invariante: o histórico da revogada do B (registro anterior) segue idêntico no fim',
  (select (to_jsonb(a) = (select j from t.snap where chave = 'prior_b_revogada'))::text from public.curriculum_achievements a where a.id = (select id from t.id_prior_b)), 'true');

-- ==================== K) verificação de duplicatas pré-existentes (o que a migration faz abortar) ====================
drop index public.ux_curriculum_achievements_classe_ativa_pessoa;
drop index public.ux_curriculum_achievements_classe;
insert into public.curriculum_achievements (usuario_id, tipo, classe_id, club_id_origem, concluida_em)
values (t.id('membro_b'), 'classe', t.classe('guia'), t.id('clube_c'), now());
select t.eq('K) com o índice fora do ar e uma duplicata ativa forjada, a verificação da migration enxerga exatamente 1 grupo',
  (select count(*) || '|' || min(qtd) || '|' || min(classe_codigo) || '|' || (min(usuario_id::text) = t.id('membro_b')::text)::text from public._conquista_classe_duplicatas_ativas()), '1|2|guia|true');
select t.eq('K) a função de verificação é fechada para o app', (select count(*) from information_schema.routine_privileges where routine_name = '_conquista_classe_duplicatas_ativas' and grantee in ('anon', 'authenticated', 'PUBLIC')), 0);

select t.fim();
rollback;
