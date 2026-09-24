-- Fase 4.2 (migration 46): hierarquia institucional (Clube→Distrito→Região, níveis opcionais) +
-- workflow declarativo/versionado de investidura. Cenários pedidos: autoridade correta; autoridade de
-- outro clube/região; pessoa com múltiplos vínculos; remoção posterior do cargo; workflow com nível
-- opcional; tentativa de pular etapa; aprovação/reprovação/correção; concorrência (serialização por
-- lock + unicidade); histórico imutável; Tenant 001/002; emissão final antes/depois da última aprovação.
--
-- O workflow ATIVO hoje pra classes-regulares (2 etapas, ambas no clube) já é 100% coberto pelos testes
-- 32/35/37/39. Este arquivo prova que o MOTOR generaliza pra N etapas em outros níveis da hierarquia —
-- usando um workflow de TESTE (4 etapas: clube → distrito → região(opcional) → investidura), criado só
-- nesta transação (nunca ativado de verdade: a exigência distrital/regional pra Classes Regulares NÃO
-- tem fonte oficial — ver o comentário de pesquisa na migration 46). Curso de Leitura: fixture SINTÉTICA.
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
-- (migration 84: ANO explícito e vigência fechada. O valor é o do ANO CORRENTE no Brasil — assim o
-- teste não vence na virada do ano, que era o que acontecia com as datas fixas de 2026.)
insert into public.dynamic_content_values (definicao_id, ano, valor, vigente_desde, vigente_ate, fonte_url, fonte_descricao)
select d.id, a.y, 'Livro do Curso de Leitura do ano [DADO DE TESTE]', make_date(a.y, 1, 1), make_date(a.y, 12, 31), 'https://exemplo.test/fixture', 'FIXTURE DE TESTE — não é o livro oficial'
from public.dynamic_content_definitions d, (select extract(year from public._data_no_brasil())::int as y) a where d.chave = 'curso_leitura_amigo';

create function t.conclui_amigo(p_pessoa text, p_clube text, p_unidade text, p_nasc date, p_chave_mc text) returns void
language plpgsql as $$
begin
  perform t.mk(p_pessoa, initcap(replace(p_pessoa, '_', ' ')), 'desbravador', 'ativo', p_clube, p_unidade, p_nasc);
  perform t.como(p_pessoa); perform t.pedir_clube(p_clube);
  perform t.permitido(p_pessoa || ' inicia Amigo', format($f$select public.classe_iniciar(%L)$f$, t.classe('amigo')));
  reset role;
  insert into t.ids (chave, id) select p_chave_mc, id from public.member_classes where usuario_id = t.id(p_pessoa) and club_id = t.id(p_clube) and class_id = t.classe('amigo');
  perform t.como(p_pessoa); perform t.pedir_clube(p_clube);
  perform t.permitido('escolhas de ' || p_pessoa, format($f$select public.requisito_escolher(r, array[(select o.id from public.requirement_options o join public.requirement_option_groups g on g.id = o.grupo_id where g.alvo_id = r order by o.ordem limit 1)], '{}')
    from unnest(array[t.req('amigo.V.1'), t.req('amigo.VII.1')]) r$f$), 2);
  perform t.permitido('IX.1 de ' || p_pessoa, format($f$select public.requisito_escolher(%L, '{}', array['Cestaria [DADO DE TESTE]'])$f$, t.req('amigo.IX.1')));
  reset role;
end $$;

-- ==================== hierarquia: Clube A e Clube B em árvores DIFERENTES ====================
-- A: Distrito A → Região A (2 níveis acima do clube). B: Distrito B, SEM região (nível opcional ausente).
insert into public.organizational_units (id, type, nome, slug, metadata) values
  (public.curriculo_uuid('t41:regiao_a'), 'regiao', 'Região Teste A', 't41-regiao-a', '{"test_only":true}'),
  (public.curriculo_uuid('t41:distrito_a'), 'distrito', 'Distrito Teste A', 't41-distrito-a', '{"test_only":true}'),
  (public.curriculo_uuid('t41:distrito_b'), 'distrito', 'Distrito Teste B', 't41-distrito-b', '{"test_only":true}')
on conflict (id) do nothing;
insert into t.ids (chave, id) values ('regiao_a', public.curriculo_uuid('t41:regiao_a')), ('distrito_a', public.curriculo_uuid('t41:distrito_a')), ('distrito_b', public.curriculo_uuid('t41:distrito_b'));
update public.organizational_units set parent_id = t.id('regiao_a') where id = t.id('distrito_a');
update public.organizational_units set parent_id = t.id('distrito_a') where id = t.id('clube_a');
update public.organizational_units set parent_id = t.id('distrito_b') where id = t.id('clube_b'); -- B tem distrito, mas NENHUMA região acima

-- autoridades: coordenadora distrital de A; coordenadora regional de A; coordenador distrital de B (outro distrito)
select t.mk('coord_dist_a', 'Coordenadora Distrital A', 'desbravador', 'pendente', 'clube_a'); -- só existência de profile; o vínculo real é abaixo
delete from public.organization_memberships where user_id = t.id('coord_dist_a');
select t.mk2('coord_dist_a', 'coordenador_distrital', 'ativo', 'distrito_a');
select t.mk('coord_reg_a', 'Coordenadora Regional A', 'desbravador', 'pendente', 'clube_a');
delete from public.organization_memberships where user_id = t.id('coord_reg_a');
select t.mk2('coord_reg_a', 'coordenador_regional', 'ativo', 'regiao_a');
select t.mk('coord_dist_b', 'Coordenador Distrital B', 'desbravador', 'pendente', 'clube_b');
delete from public.organization_memberships where user_id = t.id('coord_dist_b');
select t.mk2('coord_dist_b', 'coordenador_distrital', 'ativo', 'distrito_b');

-- ==================== 0) hierarquia — papel × tipo de unidade + níveis opcionais ====================
select t.throws('papel de CLUBE não vale num DISTRITO (gatilho recusa)', format($q$insert into public.organization_memberships (user_id, organizational_unit_id, role, status) values (%L, %L, 'diretoria', 'ativo')$q$, t.id('coord_dist_a'), t.id('distrito_a')), 'não é válido');
select t.throws('coordenador_distrital não vale num CLUBE', format($q$insert into public.organization_memberships (user_id, organizational_unit_id, role, status) values (%L, %L, 'coordenador_distrital', 'ativo')$q$, t.id('coord_dist_a'), t.id('clube_a')), 'não é válido');
select t.eq('unidade_ancestral: do clube A sobe até achar distrito e região', public.unidade_ancestral(t.id('clube_a'), 'distrito') || '|' || public.unidade_ancestral(t.id('clube_a'), 'regiao'), t.id('distrito_a')::text || '|' || t.id('regiao_a')::text);
select t.eq('unidade_ancestral: clube B tem distrito mas NÃO tem região (nível opcional ausente — NULL, não erro)', public.unidade_ancestral(t.id('clube_b'), 'distrito')::text || '|' || (public.unidade_ancestral(t.id('clube_b'), 'regiao') is null)::text, t.id('distrito_b')::text || '|true');
select t.eq('unidade_ancestral do próprio clube (escopo_tipo=clube) é ele mesmo — self-inclusivo', public.unidade_ancestral(t.id('clube_a'), 'clube'), t.id('clube_a'));

-- ==================== workflow de TESTE: 4 etapas (clube → distrito → região(opcional) → investidura) ====================
-- Publicado como 'classes-regulares' v2 (versão maior = a ativa) só nesta transação; v1 (a real, 2
-- etapas, ambas no clube) fica intacta no banco, só desativada enquanto durar o teste — o rollback
-- restaura tudo (nenhuma regra institucional real é alterada).
update public.investiture_workflows set ativo = false where chave = 'classes-regulares' and versao = 1;
insert into public.investiture_workflows (id, chave, versao, nome, descricao, ativo) values
  (public.curriculo_uuid('t41:workflow:2'), 'classes-regulares', 2, '[TESTE] com etapas distrital e regional',
   'Workflow FICTÍCIO só pra provar que o motor generaliza — NÃO é a regra real (ver pesquisa na migration 46).', true);
insert into t.ids (chave, id) values ('workflow_teste', public.curriculo_uuid('t41:workflow:2'));
insert into public.investiture_workflow_stages (id, workflow_id, ordem, chave, nome, escopo_tipo, papeis_permitidos, obrigatoria, pular_se_nivel_ausente, permite_mesmo_decisor) values
  (public.curriculo_uuid('t41:stage:2:1'), t.id('workflow_teste'), 1, 'revisao_clube', 'Revisão do clube', 'clube', array['instrutor','diretoria'], true, false, true),
  (public.curriculo_uuid('t41:stage:2:2'), t.id('workflow_teste'), 2, 'aprovacao_intermediaria', 'Aprovação distrital', 'distrito', array['coordenador_distrital'], true, false, false),
  (public.curriculo_uuid('t41:stage:2:3'), t.id('workflow_teste'), 3, 'aprovacao_intermediaria', 'Aprovação regional (nível opcional)', 'regiao', array['coordenador_regional'], true, true, false),
  (public.curriculo_uuid('t41:stage:2:4'), t.id('workflow_teste'), 4, 'investidura', 'Investidura', 'clube', array['instrutor','diretoria'], true, false, false);

-- ==================== conclui Amigo por multi_dois_papeis no CLUBE A (com o workflow de teste ativo) ====================
select t.como('multi_dois_papeis'); select t.pedir_clube('clube_a');
select t.permitido('multi inicia Amigo no A', format($q$select public.classe_iniciar(%L)$q$, t.classe('amigo')));
reset role;
insert into t.ids (chave, id) select 'mc', id from public.member_classes where usuario_id = t.id('multi_dois_papeis') and club_id = t.id('clube_a') and class_id = t.classe('amigo');
select t.como('multi_dois_papeis'); select t.pedir_clube('clube_a');
select t.permitido('registra escolhas (V.1, VII.1, IX.1)', format($q$select public.requisito_escolher(r, array[(select o.id from public.requirement_options o join public.requirement_option_groups g on g.id = o.grupo_id where g.alvo_id = r order by o.ordem limit 1)], '{}')
  from unnest(array[t.req('amigo.V.1'), t.req('amigo.VII.1')]) r$q$), 2);
select t.permitido('...IX.1 texto livre', format($q$select public.requisito_escolher(%L, '{}', array['Cestaria [DADO DE TESTE]'])$q$, t.req('amigo.IX.1')));
select t.como('lider_a'); select t.pedir_clube('clube_a');
select t.permitido('lider_a aprova os 25 requisitos (selar cria a corrida do workflow de TESTE, 4 etapas)', format($q$select public.requisito_avaliar(mr.id, 'aprovado', 'ok') from public.member_requirements mr where mr.member_class_id = %L$q$, t.id('mc')), 25);
reset role;
insert into t.ids (chave, id) select 'run', id from public.investiture_workflow_runs where member_class_id = t.id('mc');

select t.eq('a corrida usa o workflow de TESTE v2, com 4 etapas, aguardando a etapa 1', (select workflow_versao from public.investiture_workflow_runs where id = t.id('run')) || '|' || (select current_stage_ordem from public.investiture_workflow_runs where id = t.id('run')) || '|' || (select status from public.member_classes where id = t.id('mc')), '2|1|aguardando_revisao');

-- ==================== 1) tentativa de PULAR ETAPA ====================
select t.como('lider_a'); select t.pedir_clube('clube_a');
select t.throws('investidura direta, pulando revisão/distrital/regional, é recusada', format($q$select public.investidura_registrar(%L)$q$, t.id('mc')), 'não permitida');
reset role;
select t.como('coord_dist_a');
select t.throws('mesmo a autoridade distrital correta não decide a etapa distrital antes da etapa 1 (revisão do clube é a atual)', format($q$select public.workflow_etapa_intermediaria_decidir(%L, 'aprovado', 'adiantando')$q$, t.id('mc')), 'não é uma etapa intermediária');
reset role;

-- ==================== 2) autoridade CORRETA decide a etapa 1 (revisão do clube) ====================
select t.como('lider_a'); select t.pedir_clube('clube_a');
select t.permitido('lider_a (diretoria do clube A) aprova a revisão do clube — etapa 1', format($q$select public.revisao_final_decidir(%L, 'aprovado', 'Revisão do clube ok')$q$, t.id('mc')));
reset role;
select t.eq('avança pra etapa 2 (distrital); member_classes CONTINUA aguardando_revisao (não é a última etapa)', (select current_stage_ordem from public.investiture_workflow_runs where id = t.id('run')) || '|' || (select status from public.member_classes where id = t.id('mc')), '2|aguardando_revisao');

-- ==================== 3) autoridade de OUTRO distrito/clube (e sem vínculo nenhum) é recusada ====================
select t.como('coord_dist_b'); -- coordenador distrital do distrito de B, não do de A
select t.throws('coordenador do distrito B NÃO decide a etapa distrital da investidura de A (autoridade de outra região)', format($q$select public.workflow_etapa_intermediaria_decidir(%L, 'aprovado', 'tentando de fora')$q$, t.id('mc')), 'Sem permissão');
reset role;
select t.como('lider_a'); -- diretoria do clube, sem vínculo distrital nenhum
select t.throws('a diretoria do clube (sem vínculo distrital) também não decide a etapa distrital', format($q$select public.workflow_etapa_intermediaria_decidir(%L, 'aprovado', 'papel errado')$q$, t.id('mc')), 'Sem permissão');
reset role;
select t.como('membro_a'); -- pessoa sem vínculo nenhum além de desbravador no clube
select t.throws('membro comum não decide etapa nenhuma', format($q$select public.workflow_etapa_intermediaria_decidir(%L, 'aprovado', 'x')$q$, t.id('mc')), 'Sem permissão');
reset role;

-- ==================== 4) autoridade CORRETA decide distrital; região (nível PRESENTE em A) é decidida de verdade, não pulada ====================
select t.como('coord_dist_a');
select t.permitido('coord_dist_a (autoridade distrital correta) aprova a etapa distrital', format($q$select public.workflow_etapa_intermediaria_decidir(%L, 'aprovado', 'Aprovado pelo distrito')$q$, t.id('mc')));
reset role;
select t.eq('clube A TEM região: a etapa 3 (regional) NÃO foi pulada — está pendente, aguardando autoridade regional', (select current_stage_ordem from public.investiture_workflow_runs where id = t.id('run')), 3);
select t.como('coord_reg_a');
select t.permitido('coord_reg_a (autoridade regional correta) aprova a etapa regional', format($q$select public.workflow_etapa_intermediaria_decidir(%L, 'aprovado', 'Aprovado pela região')$q$, t.id('mc')));
reset role;
select t.eq('avançou pra etapa 4 (investidura); member_classes fica APTO (próxima etapa É a investidura)', (select current_stage_ordem from public.investiture_workflow_runs where id = t.id('run')) || '|' || (select status from public.member_classes where id = t.id('mc')), '4|apto_investidura');

-- ==================== 5) emissão do documento: acompanhamento sempre disponível; FINAL só depois da última aprovação ====================
select t.como('lider_a'); select t.pedir_clube('clube_a');
select t.permitido('Caderno de ACOMPANHAMENTO emite normalmente (clube+distrito+região já aprovados, mas ainda não investido)', format($q$select public.documento_emitir(%L, 'acompanhamento')$q$, t.id('mc')));
select t.throws('documento FINAL ANTES da investidura (última aprovação) é recusado, mesmo com as 3 etapas anteriores aprovadas', format($q$select public.documento_emitir(%L, 'final')$q$, t.id('mc')), 'após a investidura');
reset role;

-- ==================== 6) workflow com NÍVEL OPCIONAL ausente: clube B não tem região — a etapa é pulada de verdade ====================
select t.conclui_amigo('pessoa_b', 'clube_b', 'B1', date '2014-05-05', 'mc_b');
select t.como('lider_b'); select t.pedir_clube('clube_b');
select t.permitido('lider_b aprova os 25 requisitos de pessoa_b (seleção cria a corrida no clube B)', format($q$select public.requisito_avaliar(mr.id, 'aprovado', 'ok') from public.member_requirements mr where mr.member_class_id = %L$q$, t.id('mc_b')), 25);
select t.permitido('lider_b aprova a revisão do clube (etapa 1) de pessoa_b', format($q$select public.revisao_final_decidir(%L, 'aprovado', 'ok')$q$, t.id('mc_b')));
reset role;
insert into t.ids (chave, id) select 'run_b', id from public.investiture_workflow_runs where member_class_id = t.id('mc_b');
select t.como('coord_dist_b');
select t.permitido('coord_dist_b aprova a etapa distrital de pessoa_b', format($q$select public.workflow_etapa_intermediaria_decidir(%L, 'aprovado', 'ok')$q$, t.id('mc_b')));
reset role;
select t.eq('NÍVEL OPCIONAL AUSENTE: clube B não tem região — a etapa 3 foi PULADA automaticamente (foi direto pra 4, investidura)', (select current_stage_ordem from public.investiture_workflow_runs where id = t.id('run_b')) || '|' || (select status from public.member_classes where id = t.id('mc_b')), '4|apto_investidura');
select t.eq('o pulo ficou registrado, imutável, com decisão "pulada_nivel_ausente" e escopo_organizational_unit NULO', (select decisao || '|' || (escopo_organizational_unit_id is null)::text from public.workflow_stage_decisions where run_id = t.id('run_b') and escopo_tipo = 'regiao'), 'pulada_nivel_ausente|true');

-- ==================== 7) pessoa com MÚLTIPLOS vínculos + SEGREGAÇÃO de funções ====================
select t.conclui_amigo('seg_teste', 'clube_a', 'A1', date '2014-05-05', 'mc2');
select t.como('lider_a'); select t.pedir_clube('clube_a');
select t.permitido('lider_a aprova os 25 requisitos de seg_teste', format($q$select public.requisito_avaliar(mr.id, 'aprovado', 'ok') from public.member_requirements mr where mr.member_class_id = %L$q$, t.id('mc2')), 25);
select t.permitido('lider_a decide a etapa 1 (clube) desta 2ª investidura', format($q$select public.revisao_final_decidir(%L, 'aprovado', 'ok')$q$, t.id('mc2')));
reset role;
-- lider_a ACUMULA cargo: já é diretoria do clube A e agora TAMBÉM coordenador distrital de A (multi-vínculo real)
select t.mk2('lider_a', 'coordenador_distrital', 'ativo', 'distrito_a');
select t.como('lider_a');
select t.throws('SEGREGAÇÃO: lider_a NÃO decide a etapa distrital desta MESMA investidura (já decidiu a do clube — autoridades deveriam ser distintas, mesmo tendo o cargo acumulado)',
  format($q$select public.workflow_etapa_intermediaria_decidir(%L, 'aprovado', 'usando o cargo acumulado')$q$, t.id('mc2')), 'Segregação de funções');
reset role;
select t.como('coord_dist_a'); -- pessoa DISTINTA, mesma autoridade formal — sem problema
select t.permitido('coord_dist_a (pessoa distinta) decide a etapa distrital normalmente', format($q$select public.workflow_etapa_intermediaria_decidir(%L, 'aprovado', 'ok')$q$, t.id('mc2')));
reset role;

-- ==================== 8) reprovação numa etapa intermediária ====================
select t.como('coord_reg_a');
select t.permitido('coord_reg_a reprova a etapa regional de seg_teste (decisão negativa)', format($q$select public.workflow_etapa_intermediaria_decidir(%L, 'reprovado', 'Documentação incompleta')$q$, t.id('mc2')));
reset role;
select t.eq('reprovação: matrícula volta a em_andamento; a corrida fica cancelada (histórico preservado, nada apagado)', (select status from public.member_classes where id = t.id('mc2')) || '|' || (select status from public.investiture_workflow_runs where member_class_id = t.id('mc2') order by created_at desc limit 1), 'em_andamento|cancelado');
select t.eq('...e continuam existindo as 3 decisões já tomadas nesta corrida cancelada (clube, distrital, regional=reprovado)', (select count(*) from public.workflow_stage_decisions where run_id = (select id from public.investiture_workflow_runs where member_class_id = t.id('mc2') order by created_at desc limit 1)), 3);

-- ==================== 9) histórico IMUTÁVEL (decisões de mc, já com as 3 primeiras etapas decididas) ====================
select t.como('lider_a'); select t.pedir_clube('clube_a');
select t.bloqueado('liderança NÃO edita uma decisão já tomada (workflow_stage_decisions)', format($q$update public.workflow_stage_decisions set decisao = 'reprovado' where run_id = %L and stage_chave = 'revisao_clube'$q$, t.id('run')));
select t.bloqueado('...nem apaga', format($q$delete from public.workflow_stage_decisions where run_id = %L$q$, t.id('run')));
reset role;
select t.throws('nem quem roda SQL como dono do banco edita', format($q$update public.workflow_stage_decisions set observacao = 'editado' where run_id = %L and stage_chave = 'revisao_clube'$q$, t.id('run')), 'imutável');
select t.throws('...nem apaga', format($q$delete from public.workflow_stage_decisions where id = (select id from public.workflow_stage_decisions where run_id = %L and stage_chave = 'revisao_clube')$q$, t.id('run')), 'não pode ser apagado');
select t.eq('cada decisão registra escopo/papel/decisor/decisão/data/observação/versão do workflow (checagem completa da etapa 1 de mc)',
  (select (stage_chave = 'revisao_clube') and (escopo_tipo = 'clube') and (escopo_organizational_unit_id = t.id('clube_a')) and (papel_utilizado = 'diretoria')
       and (decisor_id = t.id('lider_a')) and (decisao = 'aprovado') and (workflow_versao = 2) and (observacao is not null) and (decidido_em is not null) and (metodo = 'aprovacao_sistema')
   from public.workflow_stage_decisions where run_id = t.id('run') and stage_chave = 'revisao_clube'), true);

-- ==================== 10) remoção posterior do cargo — autoria histórica preservada, autoridade FUTURA some ====================
-- usa uma corrida NOVA (mc3), com a etapa distrital ainda pendente, pra provar os dois lados: o que já
-- foi decidido fica intocado; o que ainda NÃO foi decidido deixa de ser possível pra quem perdeu o vínculo.
select t.conclui_amigo('terceiro', 'clube_a', 'A2', date '2014-05-05', 'mc3');
select t.como('lider_a'); select t.pedir_clube('clube_a');
select t.permitido('lider_a aprova os 25 requisitos de terceiro', format($q$select public.requisito_avaliar(mr.id, 'aprovado', 'ok') from public.member_requirements mr where mr.member_class_id = %L$q$, t.id('mc3')), 25);
select t.permitido('lider_a decide a etapa 1 (clube) desta 3ª investidura', format($q$select public.revisao_final_decidir(%L, 'aprovado', 'ok')$q$, t.id('mc3')));
reset role;
insert into t.ids (chave, id) select 'run3', id from public.investiture_workflow_runs where member_class_id = t.id('mc3');
delete from public.organization_memberships where user_id = t.id('coord_dist_a') and organizational_unit_id = t.id('distrito_a');
select t.eq('coord_dist_a perdeu o vínculo distrital: as decisões HISTÓRICAS dela (mc e mc2) continuam com nome/papel/escopo intactos',
  (select count(*) from public.workflow_stage_decisions d join public.profiles p on p.id = d.decisor_id
     where d.decisor_id = t.id('coord_dist_a') and d.papel_utilizado = 'coordenador_distrital' and d.escopo_organizational_unit_id = t.id('distrito_a') and p.nome = 'Coordenadora Distrital A'), 2);
select t.como('coord_dist_a');
select t.throws('...mas ela NÃO decide mais NADA daqui pra frente (perdeu a autoridade de verdade, não só o registro)', format($q$select public.workflow_etapa_intermediaria_decidir(%L, 'aprovado', 'tentando sem vínculo')$q$, t.id('mc3')), 'Sem permissão');
reset role;

-- ==================== 11) concorrência: a etapa já decidida nunca é readjudicada nem duplicada ====================
-- (o motor serializa via "for update" no run + unicidade física (run_id,stage_id); o efeito observável
-- é este: reenviar a MESMA decisão da MESMA etapa já concluída é sempre recusado, e nunca há 2 linhas.)
select t.como('lider_a'); select t.pedir_clube('clube_a');
select t.throws('reenviar a decisão da etapa 1 de mc (já concluída) é recusado — a matrícula não está mais aguardando ESSA etapa', format($q$select public.revisao_final_decidir(%L, 'aprovado', 'de novo')$q$, t.id('mc')), 'não está aguardando revisão final');
reset role;
select t.eq('só existe UMA decisão pra (corrida, etapa) — a unicidade física impede duplicata mesmo sob nova tentativa', (select count(*) from public.workflow_stage_decisions where run_id = t.id('run') and stage_chave = 'revisao_clube'), 1);

-- ==================== 12) investidura final: etapa 4, autoridade do clube — gera o documento FINAL ====================
select t.como('lider_a'); select t.pedir_clube('clube_a');
select t.permitido('lider_a registra a investidura de mc (etapa 4 — última)', format($q$select public.investidura_registrar(%L, current_date, 'Cerimônia [TESTE]')$q$, t.id('mc')));
reset role;
select t.eq('workflow concluído; member_classes investida', (select status from public.investiture_workflow_runs where id = t.id('run')) || '|' || (select status from public.member_classes where id = t.id('mc')), 'concluido|investida');
select t.como('lider_a'); select t.pedir_clube('clube_a');
select t.permitido('AGORA o documento FINAL é emitido (todas as etapas obrigatórias satisfeitas)', format($q$select public.documento_emitir(%L, 'final')$q$, t.id('mc')));
reset role;
select t.eq('workflow_historico mostra as 4 etapas de mc; distrital e regional foram DECIDIDAS de verdade (não puladas, pois A tem os 2 níveis)',
  (select count(*) filter (where e ->> 'chave' = 'aprovacao_intermediaria' and e -> 'decisao' ->> 'decisao' = 'aprovado')
   from json_array_elements((public.workflow_historico(t.id('mc')) -> 'runs' -> 0 -> 'etapas')::json) e), 2);

-- ==================== 13) Tenant 001 (A) × Tenant 002 (B) — isolamento também no workflow ====================
-- (usa 'terceiro'/mc3: pessoa SÓ do clube A, sem vínculo nenhum com B — diferente de multi_dois_papeis,
-- que tem vínculo dual A+B DE PROPÓSITO e por isso lider_b legitimamente enxerga o histórico dela — ver
-- teste 39, "Clube B reconhece". Isolamento de verdade se prova com quem NÃO tem vínculo algum no B.)
select t.como('lider_b'); select t.pedir_clube('clube_b');
select t.eq('lider_b (liderança do B, sem vínculo com terceiro, pessoa só do A) NÃO vê o histórico de workflow dela', t.nv(format($q$select count(*) from public.workflow_stage_decisions where run_id = %L$q$, t.id('run3'))), 0);
select t.throws('lider_b não decide nenhuma etapa da investidura de terceiro (do clube A)', format($q$select public.workflow_etapa_intermediaria_decidir(%L, 'aprovado', 'x')$q$, t.id('mc3')), 'Sem permissão');
reset role;
select t.como_anon();
select t.eq('anon não lê run nem decisão nenhuma (RLS liga)', t.nv(format($q$select count(*) from public.investiture_workflow_runs where id = %L$q$, t.id('run3'))) + t.nv(format($q$select count(*) from public.workflow_stage_decisions where run_id = %L$q$, t.id('run3'))), 0);
reset role;

select t.fim();
rollback;
