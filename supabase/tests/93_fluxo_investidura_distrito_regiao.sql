-- Migration 330: cartão de classe → revisão do clube → aprovação do DISTRITO → aprovação da REGIÃO → apto.
-- Cenários: pula etapa quando não há nível; distrital de outro distrito não aprova nem vê; regional só
-- depois do distrital; quem aprova vê o cartão completo (evidências só na etapa/escopo dele); devolver
-- (com e sem requisitos marcados) volta ao clube; processos antigos (v1) intactos; sino.
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
insert into public.dynamic_content_values (definicao_id, ano, valor, vigente_desde, vigente_ate, fonte_url, fonte_descricao)
select d.id, a.y, 'Livro do Curso de Leitura do ano [DADO DE TESTE]', make_date(a.y, 1, 1), make_date(a.y, 12, 31), 'https://exemplo.test/fixture', 'FIXTURE DE TESTE'
from public.dynamic_content_definitions d, (select extract(year from public._data_no_brasil())::int as y) a where d.chave = 'curso_leitura_amigo'
on conflict do nothing;
create function t.pedir_escopo(p_chave text) returns void language plpgsql as $$
begin perform set_config('request.headers', json_build_object('x-escopo-atual', t.id(p_chave)::text)::text, true); end $$;

-- conclui Amigo (todas as aprovações pela liderança do clube) — a conclusão sela e abre a corrida
create function t.conclui_amigo(p_pessoa text, p_clube text, p_unidade text, p_lider text, p_chave_mc text) returns void
language plpgsql as $$
begin
  perform t.mk(p_pessoa, initcap(replace(p_pessoa, '_', ' ')), 'desbravador', 'ativo', p_clube, p_unidade, date '2014-05-05');
  perform t.como(p_pessoa); perform t.pedir_clube(p_clube);
  perform public.classe_iniciar(t.classe('amigo'));
  reset role;
  insert into t.ids (chave, id) select p_chave_mc, id from public.member_classes where usuario_id = t.id(p_pessoa) and club_id = t.id(p_clube) and class_id = t.classe('amigo');
  perform t.como(p_pessoa); perform t.pedir_clube(p_clube);
  perform public.requisito_escolher(r, array[(select o.id from public.requirement_options o join public.requirement_option_groups g on g.id = o.grupo_id where g.alvo_id = r order by o.ordem limit 1)], '{}')
    from unnest(array[t.req('amigo.V.1'), t.req('amigo.VII.1')]) r;
  perform public.requisito_escolher(t.req('amigo.IX.1'), '{}', array['Cestaria [DADO DE TESTE]']);
  perform t.como(p_lider); perform t.pedir_clube(p_clube);
  perform public.requisito_avaliar(mr.id, 'aprovado', 'ok') from public.member_requirements mr where mr.member_class_id = t.id(p_chave_mc);
  reset role;
end $$;
create function t.etapa(p_mc text) returns text language sql as $$
  select r.workflow_versao || '|' || r.current_stage_ordem || '|' || r.status || '|' || (select status from public.member_classes where id = t.id(p_mc))
    from public.investiture_workflow_runs r join public.class_completion_snapshots sn on sn.id = r.snapshot_id
   where r.member_class_id = t.id(p_mc) order by sn.versao desc limit 1 $$;

-- ==================== árvore: clube A → Distrito A → Região R; Distrito B (outro) ; clube B sem pai ====================
insert into public.organizational_units (id, type, nome, slug, metadata) values
  (public.curriculo_uuid('t93:regiao_r'), 'regiao', 'Região 93', 't93-regiao-r', '{"test_only":true}'),
  (public.curriculo_uuid('t93:distrito_a'), 'distrito', 'Distrito 93 A', 't93-distrito-a', '{"test_only":true}'),
  (public.curriculo_uuid('t93:distrito_b'), 'distrito', 'Distrito 93 B', 't93-distrito-b', '{"test_only":true}');
insert into t.ids (chave, id) values ('regiao_r', public.curriculo_uuid('t93:regiao_r')), ('distrito_a', public.curriculo_uuid('t93:distrito_a')), ('distrito_b', public.curriculo_uuid('t93:distrito_b'));
update public.organizational_units set parent_id = t.id('regiao_r') where id in (t.id('distrito_a'), t.id('distrito_b'));
update public.organizational_units set parent_id = t.id('distrito_a') where id = t.id('clube_a');
update public.organizational_units set parent_id = null where id = t.id('clube_b');

select t.mk('dist_a', 'Coord Distrito A', 'desbravador', 'pendente', 'clube_a');
delete from public.organization_memberships where user_id = t.id('dist_a');
select t.mk2('dist_a', 'coordenador_distrital', 'ativo', 'distrito_a');
select t.mk('dist_b', 'Coord Distrito B', 'desbravador', 'pendente', 'clube_a');
delete from public.organization_memberships where user_id = t.id('dist_b');
select t.mk2('dist_b', 'coordenador_distrital', 'ativo', 'distrito_b');
select t.mk('reg_r', 'Coord Regiao R', 'desbravador', 'pendente', 'clube_a');
delete from public.organization_memberships where user_id = t.id('reg_r');
select t.mk2('reg_r', 'coordenador_regional', 'ativo', 'regiao_r');

-- ==================== 0) versões ====================
select t.eq('regulares: v2 ativa (4 etapas) e v1 arquivada; avançadas v1 ativa',
  (select string_agg(chave || ':' || versao || ':' || ativo || ':' || (select count(*) from public.investiture_workflow_stages s where s.workflow_id = w.id), ',' order by chave, versao)
     from public.investiture_workflows w where chave in ('classes-regulares', 'classes-avancadas')),
  'classes-avancadas:1:true:4,classes-regulares:1:false:2,classes-regulares:2:true:4');

-- ==================== 1) processo ANTIGO (v1) fica na v1 ====================
update public.investiture_workflows set ativo = (versao = 1) where chave = 'classes-regulares';   -- simula "antes da 330"
select t.conclui_amigo('antigo', 'clube_a', 'A1', 'lider_a', 'mc_antigo');
update public.investiture_workflows set ativo = (versao = 2) where chave = 'classes-regulares';   -- 330 aplicada
select t.eq('corrida antiga nasceu na v1', t.etapa('mc_antigo'), '1|1|em_andamento|aguardando_revisao');
select t.como('lider_a'); select t.pedir_clube('clube_a');
select public.revisao_final_decidir(t.id('mc_antigo'), 'aprovado', 'ok antigo');
reset role;
select t.eq('processo antigo NÃO passa por distrito/região (continua na v1): apto direto, mesmo com o clube tendo distrito', t.etapa('mc_antigo'), '1|2|em_andamento|apto_investidura');

-- ==================== 2) processo NOVO no clube A (tem distrito e região) ====================
select t.conclui_amigo('nova', 'clube_a', 'A1', 'lider_a', 'mc_nova');
select t.eq('conclusão nova abre corrida na v2, etapa 1 (revisão do clube)', t.etapa('mc_nova'), '2|1|em_andamento|aguardando_revisao');
update public.member_requirements set evidencia_texto = 'Resposta da Nova', evidencia_path = t.id('nova')::text || '/requisitos/foto-nova.jpg'
 where id = (select id from public.member_requirements where member_class_id = t.id('mc_nova') order by id limit 1);
insert into storage.buckets (id, name, public) values ('comprovacoes', 'comprovacoes', false) on conflict (id) do nothing;
insert into storage.objects (bucket_id, name, owner) values ('comprovacoes', t.id('nova')::text || '/requisitos/foto-nova.jpg', null);

select t.como('dist_a');
select t.throws('distrital não decide antes da revisão do clube', format($q$select public.coordenacao_investidura_decidir(%L, 'aprovado')$q$, t.id('mc_nova')), 'não encontrado');
select t.eq('...nem vê a foto antes da etapa dele', t.nv($q$select count(*) from storage.objects where bucket_id = 'comprovacoes' and name like '%foto-nova.jpg'$q$), 0);
reset role;

select t.como('lider_a'); select t.pedir_clube('clube_a');
select t.eq('liderança do clube vê o cartão completo (requisitos com texto) na revisão do clube',
  (select count(*) from json_array_elements(public.investidura_cartao(t.id('mc_nova')) -> 'requisitos') x where x ->> 'evidencia_texto' = 'Resposta da Nova')::int, 1);
select public.revisao_final_decidir(t.id('mc_nova'), 'aprovado', 'Revisão do clube ok');
reset role;
select t.eq('aprovado pelo clube → aguardando DISTRITO (matrícula segue aguardando_revisao)', t.etapa('mc_nova'), '2|2|em_andamento|aguardando_revisao');
select t.eq('sino: a coordenação do Distrito A recebeu aviso (sem nome de criança no push)',
  (select count(*) from public.notificacoes where para_usuario = t.id('dist_a') and tipo = 'investidura' and corpo not like '%Nova%')::int, 1);
select t.eq('...e o distrital B e a regional ainda não', (select count(*) from public.notificacoes where para_usuario in (t.id('dist_b'), t.id('reg_r')) and tipo = 'investidura')::int, 0);

-- portal: o que depende de você
select t.como('dist_a'); select t.pedir_escopo('distrito_a');
select t.eq('portal do Distrito A lista o cartão (nome, classe, clube, quem aprovou no clube)',
  (select (i ->> 'pessoa_nome') || '|' || (i ->> 'classe_nome') || '|' || (i -> 'etapa' ->> 'escopo_tipo') || '|' || (i -> 'aprovacoes' -> 0 ->> 'escopo_tipo') || '|' || ((i ->> 'concluida_em') is not null)
     from json_array_elements(public.escopo_investiduras_pendentes()) i), 'Nova|Amigo|distrito|clube|true');
select t.eq('...o resumo do portal NÃO traz evidência', (public.escopo_investiduras_pendentes()::text like '%Resposta da Nova%'), false);
select t.eq('distrital A vê o cartão completo na etapa dele (texto)', (public.investidura_cartao(t.id('mc_nova'))::text like '%Resposta da Nova%'), true);
select t.eq('distrital A vê a FOTO (policy do bucket) na etapa dele', t.nv($q$select count(*) from storage.objects where bucket_id = 'comprovacoes' and name like '%foto-nova.jpg'$q$), 1);
select t.eq('...mas o painel geral continua sem acesso a member_requirements pela RLS', t.nv('select count(*) from public.member_requirements'), 0);
select t.como('dist_b'); select t.pedir_escopo('distrito_b');
select t.eq('distrital de OUTRO distrito: portal vazio', json_array_length(public.escopo_investiduras_pendentes()), 0);
select t.throws('distrital de OUTRO distrito não vê o cartão', format($q$select public.investidura_cartao(%L)$q$, t.id('mc_nova')), 'não encontrado');
select t.eq('distrital de OUTRO distrito não vê a foto', t.nv($q$select count(*) from storage.objects where bucket_id = 'comprovacoes' and name like '%foto-nova.jpg'$q$), 0);
select t.throws('distrital de OUTRO distrito não aprova', format($q$select public.coordenacao_investidura_decidir(%L, 'aprovado')$q$, t.id('mc_nova')), 'não encontrado');
select t.como('reg_r'); select t.pedir_escopo('regiao_r');
select t.eq('regional: ainda nada (é a vez do distrito)', json_array_length(public.escopo_investiduras_pendentes()), 0);
select t.throws('regional NÃO aprova antes do distrital', format($q$select public.coordenacao_investidura_decidir(%L, 'aprovado')$q$, t.id('mc_nova')), 'não encontrado');
select t.como('lider_a'); select t.pedir_clube('clube_a');
select t.throws('a diretoria do clube não decide a etapa do distrito', format($q$select public.coordenacao_investidura_decidir(%L, 'aprovado')$q$, t.id('mc_nova')), 'não encontrado');
reset role;

select t.como('dist_a'); select t.pedir_escopo('distrito_a');
select t.throws('devolver sem motivo é recusado', format($q$select public.coordenacao_investidura_decidir(%L, 'devolvido', '  ')$q$, t.id('mc_nova')), 'motivo');
select public.coordenacao_investidura_decidir(t.id('mc_nova'), 'aprovado', 'Distrito confere');
reset role;
select t.eq('aprovado pelo distrito → aguardando REGIÃO', t.etapa('mc_nova'), '2|3|em_andamento|aguardando_revisao');
select t.eq('decisão distrital registra quem, papel, unidade e comentário (imutável)',
  (select (decisor_id = t.id('dist_a')) and papel_utilizado = 'coordenador_distrital' and escopo_organizational_unit_id = t.id('distrito_a') and observacao = 'Distrito confere'
     from public.workflow_stage_decisions d join public.investiture_workflow_runs r on r.id = d.run_id where r.member_class_id = t.id('mc_nova') and d.ordem = 2), true);
select t.eq('sino: regional avisada; liderança do clube avisada da aprovação do distrito',
  (select count(*) from public.notificacoes where para_usuario = t.id('reg_r') and tipo = 'investidura')::text || '|' ||
  (select count(*) from public.notificacoes where club_id = t.id('clube_a') and para = 'lideranca' and tipo = 'investidura' and titulo like '%distrito%'), '1|1');
select t.como('dist_a');
select t.eq('distrital que JÁ aprovou (e está acima do clube) segue vendo a foto enquanto a região decide', t.nv($q$select count(*) from storage.objects where bucket_id = 'comprovacoes' and name like '%foto-nova.jpg'$q$), 1);
select t.throws('...mas não decide a etapa da região', format($q$select public.coordenacao_investidura_decidir(%L, 'aprovado')$q$, t.id('mc_nova')), 'Sem permissão');
select t.como('reg_r'); select t.pedir_escopo('regiao_r');
select t.eq('agora a região vê o cartão no portal', json_array_length(public.escopo_investiduras_pendentes()), 1);
select t.eq('...e a foto', t.nv($q$select count(*) from storage.objects where bucket_id = 'comprovacoes' and name like '%foto-nova.jpg'$q$), 1);

-- ==================== 3) região DEVOLVE marcando 2 requisitos ====================
reset role;
insert into t.ids (chave, id) select 'req1', id from public.member_requirements where member_class_id = t.id('mc_nova') order by id limit 1;
insert into t.ids (chave, id) select 'req2', id from public.member_requirements where member_class_id = t.id('mc_nova') order by id offset 1 limit 1;
select t.como('reg_r'); select t.pedir_escopo('regiao_r');
select t.throws('requisito de OUTRO cartão é recusado', format($q$select public.coordenacao_investidura_decidir(%L, 'devolvido', 'x motivo', jsonb_build_array(jsonb_build_object('member_requirement_id', %L)))$q$,
  t.id('mc_nova'), (select id from public.member_requirements where member_class_id = t.id('mc_antigo') limit 1)), 'não é deste cartão');
select public.coordenacao_investidura_decidir(t.id('mc_nova'), 'devolvido', 'Refazer a foto e o texto',
  jsonb_build_array(jsonb_build_object('member_requirement_id', t.id('req1'), 'comentario', 'A foto não mostra o nó'), jsonb_build_object('member_requirement_id', t.id('req2'))));
reset role;
select t.eq('devolver: os requisitos marcados voltam para correção; os outros seguem aprovados',
  (select count(*) filter (where status = 'correcao_solicitada') || '|' || count(*) filter (where status = 'aprovado') from public.member_requirements where member_class_id = t.id('mc_nova')),
  '2|' || ((select count(*) from public.member_requirements where member_class_id = t.id('mc_nova')) - 2)::text);
select t.eq('...com o comentário por requisito (ou o motivo geral) no histórico de avaliação',
  (select string_agg(comentario, ' / ' order by comentario) from public.requirement_approvals where member_requirement_id in (t.id('req1'), t.id('req2')) and decisao = 'correcao_solicitada'),
  'Aprovação da região: A foto não mostra o nó / Aprovação da região: Refazer a foto e o texto');
select t.eq('...a corrida é cancelada e a matrícula volta pro clube (em andamento)', t.etapa('mc_nova'), '2|3|cancelado|em_andamento');
select t.eq('...decisão de devolução gravada (quem/motivo)', (select decisao || '|' || observacao from public.workflow_stage_decisions d join public.investiture_workflow_runs r on r.id = d.run_id where r.member_class_id = t.id('mc_nova') and d.ordem = 3), 'correcao_solicitada|Refazer a foto e o texto');
select t.eq('sino: clube avisado da devolução', (select count(*) from public.notificacoes where club_id = t.id('clube_a') and para = 'lideranca' and titulo like '%devolvido%')::int, 1);
select t.como('dist_a');
select t.eq('com a corrida encerrada, a coordenação perde o acesso à foto', t.nv($q$select count(*) from storage.objects where bucket_id = 'comprovacoes' and name like '%foto-nova.jpg'$q$), 0);
reset role;

-- reenvio + reaprovação no clube: sela de novo e o ciclo recomeça no clube (corrida nova v2)
select t.como('nova'); select t.pedir_clube('clube_a');
select public.requisito_salvar(mr.requirement_id, 'Refeito [TESTE]') from public.member_requirements mr where mr.id in (t.id('req1'), t.id('req2'));
select public.requisito_enviar(mr.requirement_id) from public.member_requirements mr where mr.id in (t.id('req1'), t.id('req2'));
select t.como('lider_a'); select t.pedir_clube('clube_a');
select public.requisito_avaliar(id, 'aprovado', 'corrigido') from public.member_requirements where id in (t.id('req1'), t.id('req2'));
reset role;
select t.eq('reaprovado no clube → nova corrida, de volta à revisão do clube', t.etapa('mc_nova'), '2|1|em_andamento|aguardando_revisao');

-- ==================== 4) DEVOLVER sem requisito marcado: volta direto pra revisão do clube ====================
select t.como('lider_a'); select t.pedir_clube('clube_a');
select public.revisao_final_decidir(t.id('mc_nova'), 'aprovado', 'de novo');
select t.como('dist_a');
select public.coordenacao_investidura_decidir(t.id('mc_nova'), 'devolvido', 'Falta a assinatura do conselheiro');
reset role;
select t.eq('sem requisito marcado: sela de novo e cai na revisão do clube (corrida nova)', t.etapa('mc_nova'), '2|1|em_andamento|aguardando_revisao');
select t.como('lider_a'); select t.pedir_clube('clube_a');
select t.eq('a fila do clube mostra o motivo da devolução e a etapa atual',
  (select (i -> 'devolucao' ->> 'motivo') || '|' || (i -> 'etapa_atual' ->> 'chave') from json_array_elements(public.classe_revisoes_pendentes()) i where (i ->> 'member_class_id')::uuid = t.id('mc_nova')),
  'Falta a assinatura do conselheiro|revisao_clube');
select public.revisao_final_decidir(t.id('mc_nova'), 'aprovado', 'terceira');
select t.como('dist_a'); select public.coordenacao_investidura_decidir(t.id('mc_nova'), 'aprovado', 'ok');
select t.como('reg_r'); select public.coordenacao_investidura_decidir(t.id('mc_nova'), 'aprovado', 'ok região');
reset role;
select t.eq('distrito + região aprovaram → APTO à investidura (corrida na etapa 4)', t.etapa('mc_nova'), '2|4|em_andamento|apto_investidura');
select t.eq('sino: clube avisado "apto"', (select count(*) from public.notificacoes where club_id = t.id('clube_a') and para = 'lideranca' and corpo like '%apto à investidura%')::int, 1);
select t.como('nova'); select t.pedir_clube('clube_a');
select t.eq('a própria pessoa vê a linha do tempo com a etapa atual', (public.workflow_historico(t.id('mc_nova')) -> 'runs' -> -1 ->> 'etapa_atual_ordem'), '4');
select t.como('lider_a'); select t.pedir_clube('clube_a');
select t.permitido('investidura continua registrada pelo clube', format($q$select public.investidura_registrar(%L)$q$, t.id('mc_nova')));
reset role;
select t.eq('investida', (select status from public.member_classes where id = t.id('mc_nova')), 'investida');

-- ==================== 5) clube SEM distrito/região: etapas puladas sozinhas ====================
select t.conclui_amigo('sem_pai', 'clube_b', 'B1', 'lider_b', 'mc_b');
select t.como('lider_b'); select t.pedir_clube('clube_b');
select public.revisao_final_decidir(t.id('mc_b'), 'aprovado', 'ok');
reset role;
select t.eq('clube sem pai: distrito e região pulados (registrado) → apto direto',
  t.etapa('mc_b') || '|' || (select string_agg(d.decisao, ',' order by d.ordem) from public.workflow_stage_decisions d join public.investiture_workflow_runs r on r.id = d.run_id where r.member_class_id = t.id('mc_b')),
  '2|4|em_andamento|apto_investidura|aprovado,pulada_nivel_ausente,pulada_nivel_ausente');

-- clube com região mas sem distrito: pula só o distrito
update public.organizational_units set parent_id = t.id('regiao_r') where id = t.id('clube_b');
select t.conclui_amigo('so_regiao', 'clube_b', 'B1', 'lider_b', 'mc_b2');
select t.como('lider_b'); select t.pedir_clube('clube_b');
select public.revisao_final_decidir(t.id('mc_b2'), 'aprovado', 'ok');
reset role;
select t.eq('clube só com região: pula o distrito, aguarda a região', t.etapa('mc_b2'), '2|3|em_andamento|aguardando_revisao');

select t.fim();
rollback;
