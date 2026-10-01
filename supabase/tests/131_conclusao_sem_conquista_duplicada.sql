-- Conclusão curricular pertence à PESSOA (migration 525): a matrícula que conclui NÃO cria uma 2ª conquista de classe.
--  * A) fluxo REAL: matrícula em andamento no A + registro anterior pelo B -> concluir/investir no A não duplica; a matrícula
--    segue o próprio workflow (snapshot, revisão, investidura, documento intactos); proveniência imutável; nenhuma aprovação inventada;
--  * B) duas matrículas em andamento (uma por clube): a 2ª que investe reconhece a conquista da 1ª;
--  * C) conquista revogada: nova conclusão cria conquista normal; revogar a reconhecida promove a matrícula já investida;
--  * D) isolamento (tabela fechada, RPC sem oráculo, outro clube/usuário não vê); E) progresso em andamento isolado;
--  * F) idempotência; G) selo/documentos existentes; H) 519/521/523 sem regressão.
begin;
\ir _lib.sql
\ir _curriculo_regular_2026.sql
\ir _fixtures.sql
insert into public.club_features (club_id, feature, enabled) values (t.id('clube_a'), 'classes', true), (t.id('clube_b'), 'classes', true)
on conflict (club_id, feature) do update set enabled = true;

create function t.classe(p_codigo text) returns uuid language sql stable security definer as $$
  select public.curriculo_uuid('class:2026.4:' || p_codigo) $$;
create function t.req(p text) returns uuid language sql stable as $$
  select r.id from public.class_requirements r join public.class_sections s on s.id = r.section_id join public.classes c on c.id = s.class_id
  join public.curriculum_versions v on v.id = c.curriculum_version_id where r.manifesto_id = p and v.origem = 'oficial' and v.status = 'publicado' $$;
create function t.mc(p_chave text, p_codigo text, p_clube text) returns uuid language sql stable security definer as $$
  select id from public.member_classes where usuario_id = t.id(p_chave) and club_id = t.id(p_clube) and class_id = t.classe(p_codigo) $$;
create function t.concluir(p_chave text, p_codigo text, p_clube text) returns void language sql security definer as $$
  update public.member_classes set status = 'investida', concluida_em = now() - interval '2 days', investida_em = now() - interval '1 day'
   where id = t.mc(p_chave, p_codigo, p_clube) $$;
create function t.reg(p_chave text, p_codigo text, p_data text default '2020-05-10') returns text language sql stable as $$
  select format($q$select public.classe_concluida_anteriormente_registrar(%L, %L, %L::date, false, 'Cartão da classe, conferido pela diretoria', null)$q$, t.id(p_chave), t.classe(p_codigo), p_data) $$;
-- conquistas da pessoa para a classe: total / ativas
create function t.nach(p_chave text, p_codigo text) returns bigint language sql stable security definer as $$
  select count(*) from public.curriculum_achievements where usuario_id = t.id(p_chave) and classe_id = t.classe(p_codigo) $$;
create function t.nativ(p_chave text, p_codigo text) returns bigint language sql stable security definer as $$
  select count(*) from public.curriculum_achievements where usuario_id = t.id(p_chave) and classe_id = t.classe(p_codigo) and status = 'ativa' $$;
create function t.nrec(p_chave text, p_codigo text) returns bigint language sql stable security definer as $$
  select count(*) from public.class_completion_recognitions where usuario_id = t.id(p_chave) and class_id = t.classe(p_codigo) $$;
create function t.aprov() returns bigint language sql stable security definer as $$ select count(*) from public.requirement_approvals $$;
create function t.rec(p_mc uuid) returns json language sql stable as $$ select public.classe_conclusao_reconhecida(p_mc) $$;

update public.profiles set nascimento = (current_date - interval '13 years')::date where id in (t.id('membro_a'), t.id('membro_a2'), t.id('membro_b'));
-- vínculos extras: membro_a e membro_a2 também no B; membro_b também no A (multiclube de verdade)
select t.mk2('membro_a', 'desbravador', 'ativo', 'clube_b', 'B1');
select t.mk2('membro_a2', 'desbravador', 'ativo', 'clube_b', 'B1');
select t.mk2('membro_b', 'desbravador', 'ativo', 'clube_a', 'A1');

-- conteúdo anual de fixture (como o teste 39) para o fluxo real da Amigo
insert into public.dynamic_content_values (definicao_id, ano, valor, vigente_desde, vigente_ate, fonte_url, fonte_descricao)
select d.id, a.y, 'Livro do Curso de Leitura do ano [DADO DE TESTE]', make_date(a.y, 1, 1), make_date(a.y, 12, 31), 'https://exemplo.test/fixture', 'FIXTURE DE TESTE — não é o livro oficial'
from public.dynamic_content_definitions d, (select extract(year from public._data_no_brasil())::int as y) a where d.chave = 'curso_leitura_amigo';

-- ==================== A) fluxo REAL: andamento no A + registro anterior pelo B ====================
select t.como('multi_dois_papeis'); select t.pedir_clube('clube_a');
select t.permitido('A) multi inicia Amigo no A', format($q$select public.classe_iniciar(%L)$q$, t.classe('amigo')));
select t.permitido('A) escolhas V.1/VII.1 e IX.1',
  format($q$select public.requisito_escolher(r, array[(select o.id from public.requirement_options o join public.requirement_option_groups g on g.id = o.grupo_id where g.alvo_id = r order by o.ordem limit 1)], '{}') from unnest(array[%L::uuid, %L::uuid]) r$q$, t.req('amigo.V.1'), t.req('amigo.VII.1')), 2);
select t.permitido('A) IX.1 texto livre', format($q$select public.requisito_escolher(%L, '{}', array['Cestaria [DADO DE TESTE]'])$q$, t.req('amigo.IX.1')));
reset role;
select t.como('lider_a'); select t.pedir_clube('clube_a');
select t.permitido('A) lider_a aprova os 25 requisitos', format($q$select public.requisito_avaliar(mr.id, 'aprovado', 'ok') from public.member_requirements mr where mr.member_class_id = %L$q$, t.mc('multi_dois_papeis', 'amigo', 'clube_a')), 25);
reset role;
select t.eq('A) matrícula do A: aguardando_revisao (snapshot selado), SEM conquista alguma ainda', (select status from public.member_classes where id = t.mc('multi_dois_papeis', 'amigo', 'clube_a')) || '|' || t.nach('multi_dois_papeis', 'amigo'), 'aguardando_revisao|0');
select t.como('multi_dois_papeis'); select t.pedir_clube('clube_a');
select t.eq('A) antes de qualquer registro: reconhecida=false', t.rec(t.mc('multi_dois_papeis', 'amigo', 'clube_a'))::text, '{"reconhecida" : false}');
reset role;
-- a liderança do B registra a conclusão anterior (cenário do dono) — hoje permitido
select t.como('lider_b'); select t.pedir_clube('clube_b');
select t.permitido('A) lider_b registra Amigo como concluída anteriormente (pessoa tem matrícula em andamento no A)', t.reg('multi_dois_papeis', 'amigo'));
reset role;
select t.eq('A) existe 1 conquista ativa (registro_anterior, B); A ainda sem conquista própria',
  (select count(*) || '|' || min(origem) || '|' || min(club_id_origem::text) from public.curriculum_achievements where usuario_id = t.id('multi_dois_papeis') and classe_id = t.classe('amigo') and status = 'ativa'),
  '1|registro_anterior|' || t.id('clube_b')::text);
create table t.foto_a as select (select count(*) from public.requirement_approvals) as aprov,
  (select count(*) from public.member_requirements where member_class_id = t.mc('multi_dois_papeis', 'amigo', 'clube_a') and status = 'aprovado') as reqs,
  (select hash from public.class_completion_snapshots where member_class_id = t.mc('multi_dois_papeis', 'amigo', 'clube_a') and status = 'selado') as hash;

select t.como('lider_a'); select t.pedir_clube('clube_a');
select t.permitido('A) lider_a aprova a revisão final', format($q$select public.revisao_final_decidir(%L, 'aprovado', 'Tudo certo.')$q$, t.mc('multi_dois_papeis', 'amigo', 'clube_a')));
select t.permitido('A) lider_a registra a investidura no A (a matrícula conclui o próprio fluxo)', format($q$select public.investidura_registrar(%L, current_date, 'Cerimônia [TESTE]')$q$, t.mc('multi_dois_papeis', 'amigo', 'clube_a')));
reset role;
select t.eq('A) a matrícula do A está investida (workflow dela NÃO foi cancelado nem apagado)', (select status from public.member_classes where id = t.mc('multi_dois_papeis', 'amigo', 'clube_a')), 'investida');
select t.eq('A) contagem de curriculum_achievements da pessoa+classe = 1 (só o registro do B), ativa', t.nach('multi_dois_papeis', 'amigo') || '|' || t.nativ('multi_dois_papeis', 'amigo'), '1|1');
select t.eq('A) ...e a única conquista continua sendo o registro_anterior do B (nada trocou)',
  (select origem || '|' || (club_id_origem = t.id('clube_b'))::text from public.curriculum_achievements where usuario_id = t.id('multi_dois_papeis') and classe_id = t.classe('amigo')), 'registro_anterior|true');
select t.eq('A) proveniência: 1 linha com ator=lider_a, papel diretoria, clube da matrícula=A, origem registro_anterior, clube de origem=B, data da conquista e quando',
  (select (r.ator_id = t.id('lider_a') and r.ator_papel = 'diretoria' and r.club_id = t.id('clube_a') and r.origem_conquista = 'registro_anterior' and r.club_origem_id = t.id('clube_b')
           and r.member_class_id = t.mc('multi_dois_papeis', 'amigo', 'clube_a') and r.usuario_id = t.id('multi_dois_papeis') and r.class_id = t.classe('amigo')
           and r.achievement_id = (select id from public.curriculum_achievements where usuario_id = t.id('multi_dois_papeis') and classe_id = t.classe('amigo'))
           and to_char(r.conquista_concluida_em at time zone 'America/Sao_Paulo', 'YYYY-MM-DD') = '2020-05-10' and not r.data_desconhecida and r.reconhecida_em is not null)
     from public.class_completion_recognitions r where r.usuario_id = t.id('multi_dois_papeis')), true);
select t.eq('A) nenhuma aprovação inventada: requirement_approvals e requisitos aprovados idênticos à foto antes da investidura',
  t.aprov()::text || '|' || (select count(*) from public.member_requirements where member_class_id = t.mc('multi_dois_papeis', 'amigo', 'clube_a') and status = 'aprovado'),
  (select aprov || '|' || reqs from t.foto_a));
select t.eq('A) a matrícula do A tem investidura registrada e snapshot selado com o MESMO hash de antes (histórico dela intacto)',
  (select count(*) from public.class_investitures where member_class_id = t.mc('multi_dois_papeis', 'amigo', 'clube_a') and status = 'registrada') || '|'
  || (select (hash = (select hash from t.foto_a))::text || '|' || (public.snapshot_verificar(id)->>'integro') from public.class_completion_snapshots where member_class_id = t.mc('multi_dois_papeis', 'amigo', 'clube_a') and status = 'selado'),
  '1|true|true');
select t.como('multi_dois_papeis'); select t.pedir_clube('clube_a');
select t.eq('A) a tela: "Conclusão já reconhecida (registro anterior em Clube B (teste), 10/05/2020)"', t.rec(t.mc('multi_dois_papeis', 'amigo', 'clube_a'))->>'texto', 'Conclusão já reconhecida (registro anterior em Clube B (teste), 10/05/2020)');
select t.eq('A) campos da leitura: origem, clube_nome, neste_clube=false, data_desconhecida=false',
  (t.rec(t.mc('multi_dois_papeis', 'amigo', 'clube_a'))->>'origem') || '|' || (t.rec(t.mc('multi_dois_papeis', 'amigo', 'clube_a'))->>'clube_nome') || '|' || (t.rec(t.mc('multi_dois_papeis', 'amigo', 'clube_a'))->>'neste_clube') || '|' || (t.rec(t.mc('multi_dois_papeis', 'amigo', 'clube_a'))->>'data_desconhecida'),
  'registro_anterior|Clube B (teste)|false|false');
select t.eq('A) minhas_classes: chaves antigas intactas + conclusao_reconhecida/reconhecimento',
  t.txt($q$select string_agg(k, ',' order by o) from (select json_object_keys(x) k, row_number() over () o from (select (public.minhas_classes()->>0)::json x) y) z$q$),
  'member_class_id,class_id,codigo,nome,status,iniciada_em,concluida_em,percentual,conclusao_reconhecida,reconhecimento');
select t.eq('A) minhas_classes: conclusao_reconhecida=true e texto', t.txt($q$select (x->>'conclusao_reconhecida') || '|' || (x->'reconhecimento'->>'texto') from (select (public.minhas_classes()->>0)::json x) y$q$),
  'true|Conclusão já reconhecida (registro anterior em Clube B (teste), 10/05/2020)');
reset role;
-- G) documentos existentes/novos da matrícula do A seguem funcionando (histórico DESSA matrícula)
select t.como('lider_a'); select t.pedir_clube('clube_a');
select t.eq('G) documento FINAL da matrícula do A é emitido normalmente', (public.documento_emitir(t.mc('multi_dois_papeis', 'amigo', 'clube_a'), 'final') ->> 'tipo') || '|' || (public.documento_emitir(t.mc('multi_dois_papeis', 'amigo', 'clube_a'), 'final') ->> 'ja_existia'), 'final|true');
reset role;
select t.eq('G) ...e emitir não criou conquista nem reconhecimento extra', t.nach('multi_dois_papeis', 'amigo') || '|' || t.nrec('multi_dois_papeis', 'amigo'), '1|1');

-- F) idempotência: reabrir e investir de novo a MESMA matrícula não duplica conquista nem reconhecimento
update public.member_classes set status = 'em_andamento' where id = t.mc('multi_dois_papeis', 'amigo', 'clube_a');
update public.member_classes set status = 'investida' where id = t.mc('multi_dois_papeis', 'amigo', 'clube_a');
select t.eq('F) reprocessar a investidura: ainda 1 conquista e 1 reconhecimento', t.nach('multi_dois_papeis', 'amigo') || '|' || t.nrec('multi_dois_papeis', 'amigo'), '1|1');
-- a proveniência é imutável
select t.throws('F) reconhecimento não pode ser alterado', format($q$update public.class_completion_recognitions set club_origem_id = %L where usuario_id = %L$q$, t.id('clube_a'), t.id('multi_dois_papeis')), 'imutável');
select t.throws('F) reconhecimento não pode ser apagado', format($q$delete from public.class_completion_recognitions where usuario_id = %L$q$, t.id('multi_dois_papeis')), 'imutável');
select t.throws('F) nem esvaziado', 'truncate public.class_completion_recognitions', 'imutável');

-- D) isolamento
select t.como('multi_dois_papeis'); select t.pedir_clube('clube_a');
select t.throws('D) a tabela de reconhecimento é fechada (nem o dono lê direto)', 'select * from public.class_completion_recognitions', 'permission denied');
reset role;
select t.como_anon();
select t.throws('D) anon não chama a RPC', format($q$select public.classe_conclusao_reconhecida(%L)$q$, t.mc('multi_dois_papeis', 'amigo', 'clube_a')), 'permission denied');
reset role;
select t.como('membro_a'); select t.pedir_clube('clube_a');
select t.eq('D) outro usuário não lê o reconhecimento da matrícula alheia (null, sem oráculo)', coalesce(t.rec(t.mc('multi_dois_papeis', 'amigo', 'clube_a'))::text, 'NULO'), 'NULO');
reset role;
select t.como('lider_b'); select t.pedir_clube('clube_b');
select t.eq('D) liderança do OUTRO clube não lê o reconhecimento da matrícula do A (null)', coalesce(t.rec(t.mc('multi_dois_papeis', 'amigo', 'clube_a'))::text, 'NULO'), 'NULO');
select t.pedir_clube('clube_a');
select t.eq('D) ...nem pedindo o clube A pelo header (sem vínculo no A)', coalesce(t.rec(t.mc('multi_dois_papeis', 'amigo', 'clube_a'))::text, 'NULO'), 'NULO');
reset role;
select t.como('lider_a'); select t.pedir_clube('clube_a');
select t.eq('D) a liderança do clube da matrícula lê (avalia currículo)', t.rec(t.mc('multi_dois_papeis', 'amigo', 'clube_a'))->>'reconhecida', 'true');
select t.eq('D) UUID forjado -> null', coalesce(public.classe_conclusao_reconhecida('11111111-1111-4111-8111-111111111111')::text, 'NULO'), 'NULO');
reset role;
select t.como('conselheiro_a'); select t.pedir_clube('clube_a');
select t.eq('D) conselheiro (não avalia currículo) não lê', coalesce(t.rec(t.mc('multi_dois_papeis', 'amigo', 'clube_a'))::text, 'NULO'), 'NULO');
reset role;

-- C1) revogar a conquista reconhecida: a matrícula investida do A NÃO fica sem conclusão (vira a conquista própria dela)
select t.como('lider_b'); select t.pedir_clube('clube_b');
select t.permitido('C) lider_b revoga o registro anterior (com motivo)', format($q$select public.classe_concluida_anteriormente_revogar(%L, 'Registro lançado por engano')$q$,
  (select id from public.curriculum_achievements where usuario_id = t.id('multi_dois_papeis') and classe_id = t.classe('amigo') and status = 'ativa')));
reset role;
select t.eq('C) agora 2 linhas (a revogada do B + a PRÓPRIA do A), só 1 ativa', t.nach('multi_dois_papeis', 'amigo') || '|' || t.nativ('multi_dois_papeis', 'amigo'), '2|1');
select t.eq('C) a ativa é do A, origem conclusao_no_app, ligada à matrícula e ao snapshot da investidura, data = investida_em',
  (select (a.club_id_origem = t.id('clube_a') and a.origem = 'conclusao_no_app' and a.member_class_id = t.mc('multi_dois_papeis', 'amigo', 'clube_a')
           and a.snapshot_id = (select snapshot_id from public.class_investitures where member_class_id = a.member_class_id and status = 'registrada')
           and a.concluida_em = (select investida_em from public.member_classes where id = a.member_class_id))
     from public.curriculum_achievements a where a.usuario_id = t.id('multi_dois_papeis') and a.classe_id = t.classe('amigo') and a.status = 'ativa'), true);
select t.eq('C) o histórico do reconhecimento fica (1 linha) e a tela deixa de dizer "reconhecida"', t.nrec('multi_dois_papeis', 'amigo')::text || '|' || (select (public._classe_reconhecimento_json(t.mc('multi_dois_papeis', 'amigo', 'clube_a')) is null)::text), '1|true');
select t.eq('C) nenhuma aprovação foi criada pela promoção', t.aprov(), (select aprov from t.foto_a));

-- C2) conquista de outro clube revogada ANTES de a matrícula concluir: a conclusão cria conquista normal
select t.como('membro_a2'); select t.pedir_clube('clube_a');
select t.permitido('C) membro_a2 inicia Amigo no A', format($q$select public.classe_iniciar(%L)$q$, t.classe('amigo')));
reset role;
select t.como('lider_b'); select t.pedir_clube('clube_b');
select t.permitido('C) lider_b registra Amigo anterior de membro_a2', t.reg('membro_a2', 'amigo'));
select t.permitido('C) ...e revoga em seguida', format($q$select public.classe_concluida_anteriormente_revogar(%L, 'Cartão era de outra pessoa')$q$,
  (select id from public.curriculum_achievements where usuario_id = t.id('membro_a2') and classe_id = t.classe('amigo') and status = 'ativa')));
reset role;
select t.concluir('membro_a2', 'amigo', 'clube_a');
select t.eq('C) concluir no A com a conquista do B REVOGADA cria a conquista normal do A (sem reconhecimento)',
  t.nach('membro_a2', 'amigo') || '|' || t.nativ('membro_a2', 'amigo') || '|' || t.nrec('membro_a2', 'amigo') || '|'
  || (select origem || '/' || (club_id_origem = t.id('clube_a'))::text from public.curriculum_achievements where usuario_id = t.id('membro_a2') and classe_id = t.classe('amigo') and status = 'ativa'),
  '2|1|0|conclusao_no_app/true');

-- B) duas matrículas em andamento (A e B) da mesma pessoa: a 2ª que conclui reconhece a conquista da 1ª
select t.como('membro_a'); select t.pedir_clube('clube_a');
select t.permitido('B) membro_a inicia Amigo no A', format($q$select public.classe_iniciar(%L)$q$, t.classe('amigo')));
select t.pedir_clube('clube_b');
select t.permitido('B) ...e Amigo no B (a 519 só bloqueia depois que existe conclusão)', format($q$select public.classe_iniciar(%L)$q$, t.classe('amigo')));
reset role;
select t.eq('E) antes de concluir: duas matrículas independentes, 0 conquistas, requisitos do B intactos',
  (select count(*) from public.member_classes where usuario_id = t.id('membro_a') and class_id = t.classe('amigo'))::text || '|' || t.nach('membro_a', 'amigo')
  || '|' || (select count(*) from public.member_requirements where member_class_id = t.mc('membro_a', 'amigo', 'clube_b') and status <> 'nao_iniciado'), '2|0|0');
select t.concluir('membro_a', 'amigo', 'clube_a');
select t.eq('B) a 1ª conclusão (A) cria a conquista (origem conclusao_no_app, clube A), sem reconhecimento', t.nach('membro_a', 'amigo') || '|' || t.nrec('membro_a', 'amigo'), '1|0');
select t.eq('E) a matrícula do B segue em andamento, isolada (conquista do A não a conclui)', (select status from public.member_classes where id = t.mc('membro_a', 'amigo', 'clube_b')), 'em_andamento');
select t.eq('E) ...e o percentual do B continua 0', public.classe_percentual(t.mc('membro_a', 'amigo', 'clube_b'))::text, '0');
select t.concluir('membro_a', 'amigo', 'clube_b');
select t.eq('B) a 2ª conclusão (B) NÃO cria 2ª conquista: continua 1 (do A) + 1 reconhecimento', t.nach('membro_a', 'amigo') || '|' || t.nativ('membro_a', 'amigo') || '|' || t.nrec('membro_a', 'amigo'), '1|1|1');
select t.eq('B) a matrícula do B ficou investida (não foi cancelada nem apagada)', (select status from public.member_classes where id = t.mc('membro_a', 'amigo', 'clube_b')), 'investida');
select t.eq('B) proveniência: clube da matrícula=B, origem conclusao_no_app, clube de origem=A',
  (select (r.club_id = t.id('clube_b') and r.origem_conquista = 'conclusao_no_app' and r.club_origem_id = t.id('clube_a') and r.member_class_id = t.mc('membro_a', 'amigo', 'clube_b'))
     from public.class_completion_recognitions r where r.usuario_id = t.id('membro_a')), true);
select t.como('membro_a'); select t.pedir_clube('clube_b');
select t.eq('B) a tela do B: "Conclusão já reconhecida (conclusão no app em Clube A (teste), dd/mm/aaaa)"',
  t.rec(t.mc('membro_a', 'amigo', 'clube_b'))->>'texto',
  'Conclusão já reconhecida (conclusão no app em ' || (select nome from public.organizational_units where id = t.id('clube_a')) || ', ' || to_char((now() - interval '1 day') at time zone 'America/Sao_Paulo', 'DD/MM/YYYY') || ')');
select t.eq('B) no B: minhas_classes -> conclusao_reconhecida=true', (public.minhas_classes()->0->>'conclusao_reconhecida'), 'true');
select t.pedir_clube('clube_a');
select t.eq('B) no A (matrícula que gerou a conquista): minhas_classes -> conclusao_reconhecida=false e reconhecimento nulo', (public.minhas_classes()->0->>'conclusao_reconhecida') || '|' || coalesce(public.minhas_classes()->0->>'reconhecimento', 'NULO'), 'false|NULO');
reset role;
-- F) conclusão reprocessada no B
update public.member_classes set status = 'em_andamento' where id = t.mc('membro_a', 'amigo', 'clube_b');
update public.member_classes set status = 'investida' where id = t.mc('membro_a', 'amigo', 'clube_b');
select t.eq('F) reprocessar a investidura do B: ainda 1 conquista e 1 reconhecimento', t.nach('membro_a', 'amigo') || '|' || t.nrec('membro_a', 'amigo'), '1|1');
-- outra classe da mesma pessoa não é afetada (reconhecimento é por classe equivalente)
select t.como('membro_a'); select t.pedir_clube('clube_a');
select t.permitido('B) outra classe (Companheiro) no A segue o fluxo normal', format($q$select public.classe_iniciar(%L)$q$, t.classe('companheiro')));
reset role;
select t.concluir('membro_a', 'companheiro', 'clube_a');
select t.eq('B) concluir outra classe cria a conquista dela normalmente', t.nach('membro_a', 'companheiro') || '|' || t.nrec('membro_a', 'companheiro'), '1|0');

-- C3) conquista do APP (não só registro anterior) revogada: a matrícula reconhecedora, se tem investidura registrada, assume a conclusão.
-- (a investidura do B foi simulada por UPDATE de status; aqui damos a ela o snapshot + a investidura que o fluxo real teria gravado)
insert into public.class_completion_snapshots (member_class_id, usuario_id, club_id_origem, classe_id, curriculum_version_id, versao, conteudo, hash)
select mc.id, mc.usuario_id, mc.club_id, mc.class_id, c.curriculum_version_id, 1, '{}'::jsonb, repeat('a', 64)
  from public.member_classes mc join public.classes c on c.id = mc.class_id where mc.id = t.mc('membro_a', 'amigo', 'clube_b');
insert into public.class_investitures (member_class_id, snapshot_id, usuario_id, club_id, registrado_papel, data_investidura)
select mc.id, (select id from public.class_completion_snapshots where member_class_id = mc.id), mc.usuario_id, mc.club_id, 'diretoria', current_date
  from public.member_classes mc where mc.id = t.mc('membro_a', 'amigo', 'clube_b');
update public.curriculum_achievements set status = 'revogada', revogada_em = now(), revogada_motivo = 'revogada pelo teste'
 where usuario_id = t.id('membro_a') and classe_id = t.classe('amigo') and status = 'ativa' and club_id_origem = t.id('clube_a');
select t.eq('C) revogou a do A: o B (investido, com investidura registrada) assume — 2 linhas, 1 ativa, do B, ligada à matrícula do B',
  t.nach('membro_a', 'amigo') || '|' || t.nativ('membro_a', 'amigo') || '|' || coalesce((select (club_id_origem = t.id('clube_b') and member_class_id = t.mc('membro_a', 'amigo', 'clube_b') and origem = 'conclusao_no_app')::text
     from public.curriculum_achievements where usuario_id = t.id('membro_a') and classe_id = t.classe('amigo') and status = 'ativa'), 'x'), '2|1|true');
select t.eq('C) o histórico de reconhecimento permanece (1 linha) e a tela do B deixa de mostrar "reconhecida"',
  t.nrec('membro_a', 'amigo')::text || '|' || (select (public._classe_reconhecimento_json(t.mc('membro_a', 'amigo', 'clube_b')) is null)::text), '1|true');

-- H) regressão 519/521/523: a classe com conquista ativa não é oferecida/iniciada nem registrada de novo
select t.como('membro_a2'); select t.pedir_clube('clube_b');
select t.throws('H) 519: classe_iniciar no B recusa a Amigo já concluída no A', format($q$select public.classe_iniciar(%L)$q$, t.classe('amigo')), 'já foi concluída por você em');
reset role;
select t.como('lider_b'); select t.pedir_clube('clube_b');
select t.throws('H) 521: registro anterior recusado quando já há conclusão ativa em outro clube', t.reg('membro_a2', 'amigo'), 'já consta como concluída');
reset role;
select t.eq('H) nada disso criou conquista nem reconhecimento', t.nach('membro_a2', 'amigo') || '|' || t.nrec('membro_a2', 'amigo'), '2|0');

select t.fim();
rollback;
