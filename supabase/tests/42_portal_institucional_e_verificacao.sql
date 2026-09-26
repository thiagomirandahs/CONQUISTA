-- Fase 4.3 (migration 47): escopo institucional + portal enxuto + red-team da verificação pública.
-- Cenários: escopo em uso por requisição (header próprio, duas abas); hierarquia NÃO dá acesso a dado
-- operacional/pessoal dos clubes abaixo; painel só agregado; "nada exige sua atuação" quando não há
-- etapa (Classes Regulares: sempre); enumeração de token; documento de outro tenant; revogado;
-- inexistente; sem login; manipulação do token; autoridade acima do clube tentando acessar o que não
-- pode. Curso de Leitura: fixture SINTÉTICA de teste.
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
create table t.ids_txt (chave text primary key, id text not null); grant all on t.ids_txt to public;
-- (migration 84: ANO explícito e vigência fechada. O valor é o do ANO CORRENTE no Brasil — assim o
-- teste não vence na virada do ano, que era o que acontecia com as datas fixas de 2026.)
insert into public.dynamic_content_values (definicao_id, ano, valor, vigente_desde, vigente_ate, fonte_url, fonte_descricao)
select d.id, a.y, 'Livro do Curso de Leitura do ano [DADO DE TESTE]', make_date(a.y, 1, 1), make_date(a.y, 12, 31), 'https://exemplo.test/fixture', 'FIXTURE DE TESTE — não é o livro oficial'
from public.dynamic_content_definitions d, (select extract(year from public._data_no_brasil())::int as y) a where d.chave = 'curso_leitura_amigo';

-- pedir um ESCOPO institucional nesta requisição (equivalente ao t.pedir_clube, header próprio)
create function t.pedir_escopo(p_escopo_id uuid) returns void language plpgsql as $$
begin
  perform set_config('request.headers', json_build_object('x-escopo-atual', p_escopo_id::text)::text, true);
end $$;
create function t.pedir_escopo(p_chave text) returns void language sql as $$ select t.pedir_escopo(t.id(p_chave)); $$;
-- pedir clube E escopo na MESMA requisição (prova que os dois contextos convivem sem se misturar)
create function t.pedir_clube_e_escopo(p_clube text, p_escopo text) returns void language plpgsql as $$
begin
  perform set_config('request.headers', json_build_object('x-clube-atual', t.id(p_clube)::text, 'x-escopo-atual', t.id(p_escopo)::text)::text, true);
end $$;

-- ==================== hierarquia: Distrito A (com clube A) e Distrito B (com clube B) ====================
insert into public.organizational_units (id, type, nome, slug, metadata) values
  (public.curriculo_uuid('t42:regiao_a'), 'regiao', 'Região 4.3 A', 't42-regiao-a', '{"test_only":true}'),
  (public.curriculo_uuid('t42:distrito_a'), 'distrito', 'Distrito 4.3 A', 't42-distrito-a', '{"test_only":true}'),
  (public.curriculo_uuid('t42:distrito_b'), 'distrito', 'Distrito 4.3 B', 't42-distrito-b', '{"test_only":true}')
on conflict (id) do nothing;
insert into t.ids (chave, id) values ('regiao_a', public.curriculo_uuid('t42:regiao_a')), ('distrito_a', public.curriculo_uuid('t42:distrito_a')), ('distrito_b', public.curriculo_uuid('t42:distrito_b'));
update public.organizational_units set parent_id = t.id('regiao_a') where id = t.id('distrito_a');
-- este teste é do portal/verificação, não do fluxo: fixa o workflow ANTIGO (v1, 2 etapas no clube) — o fluxo
-- clube→distrito→região da v2 (migration 330) é coberto pelo teste 93
update public.investiture_workflows set ativo = (versao = 1) where chave = 'classes-regulares';
update public.organizational_units set parent_id = t.id('distrito_a') where id = t.id('clube_a');
update public.organizational_units set parent_id = t.id('distrito_b') where id = t.id('clube_b');

-- coord_a: SÓ vínculo distrital em A (nenhum vínculo de clube — o caso mais estrito)
select t.mk('coord_a', 'Coordenadora Distrital 43A', 'desbravador', 'pendente', 'clube_a');
delete from public.organization_memberships where user_id = t.id('coord_a');
select t.mk2('coord_a', 'coordenador_distrital', 'ativo', 'distrito_a');
-- coord_reg_a: regional de A (enxerga distrito A e, por baixo, o clube A)
select t.mk('coord_reg_a', 'Coordenadora Regional 43A', 'desbravador', 'pendente', 'clube_a');
delete from public.organization_memberships where user_id = t.id('coord_reg_a');
select t.mk2('coord_reg_a', 'coordenador_regional', 'ativo', 'regiao_a');
-- coord_b: distrital de B (outro tenant)
select t.mk('coord_b', 'Coordenador Distrital 43B', 'desbravador', 'pendente', 'clube_b');
delete from public.organization_memberships where user_id = t.id('coord_b');
select t.mk2('coord_b', 'coordenador_distrital', 'ativo', 'distrito_b');
-- dupla_jornada: diretoria do clube A E coordenadora distrital de A (uma conta, duas jornadas)
select t.mk('dupla_jornada', 'Dupla Jornada', 'diretoria', 'ativo', 'clube_a');
select t.mk2('dupla_jornada', 'coordenador_distrital', 'ativo', 'distrito_a');

-- ==================== 1) escopo em uso: explícito, validado, sem padrão ====================
select t.como('coord_a');
select t.eq('sem header de escopo, escopo_atual_id() é NULO (escopo institucional é explícito, nunca "cai" em algum)', (public.escopo_atual_id() is null)::text, 'true');
select t.pedir_escopo('distrito_a');
select t.eq('com header válido, o escopo em uso é o distrito A', public.escopo_atual_id(), t.id('distrito_a'));
select t.pedir_escopo('distrito_b');
select t.eq('MANIPULAÇÃO: pedir um escopo em que NÃO tem vínculo devolve NULO (nunca erro, nunca vaza, nunca honra)', (public.escopo_atual_id() is null)::text, 'true');
select t.pedir_escopo('clube_a');
select t.eq('pedir um CLUBE como escopo institucional é ignorado (contextos não se misturam)', (public.escopo_atual_id() is null)::text, 'true');
reset role;
select t.como('membro_a'); select t.pedir_escopo('distrito_a');
select t.eq('membro comum de clube não tem escopo institucional nenhum', (public.escopo_atual_id() is null)::text, 'true');
select t.eq('...e o contexto institucional dele vem vazio', (public.meu_contexto_institucional() ->> 'escopos'), '[]');
reset role;

-- ==================== 2) as duas jornadas convivem na MESMA requisição, sem se misturar ====================
select t.como('dupla_jornada'); select t.pedir_clube_e_escopo('clube_a', 'distrito_a');
select t.eq('a mesma pessoa, na mesma requisição: clube em uso É o clube A E escopo em uso É o distrito A (não se atropelam)',
  public.clube_atual_id()::text || '|' || public.escopo_atual_id()::text, t.id('clube_a')::text || '|' || t.id('distrito_a')::text);
select t.eq('meu_contexto() (clube) segue igual, sem enxergar o distrito — nada quebrou', (select count(*) from jsonb_array_elements(public.meu_contexto() -> 'vinculos') v where v ->> 'club_id' = t.id('distrito_a')::text), 0);
select t.eq('meu_contexto_institucional() lista o distrito com o papel e as capacidades', (public.meu_contexto_institucional() -> 'escopos' -> 0 ->> 'papel') || '|' || (public.meu_contexto_institucional() -> 'escopos' -> 0 -> 'capacidades' ->> 'ver_painel'), 'coordenador_distrital|true');
reset role;

-- ==================== conclui e investe uma Amigo no clube A (pra o painel ter o que contar) ====================
select t.como('multi_dois_papeis'); select t.pedir_clube('clube_a');
select t.permitido('multi inicia Amigo no A', format($q$select public.classe_iniciar(%L)$q$, t.classe('amigo')));
reset role;
insert into t.ids (chave, id) select 'mc', id from public.member_classes where usuario_id = t.id('multi_dois_papeis') and club_id = t.id('clube_a') and class_id = t.classe('amigo');
select t.como('multi_dois_papeis'); select t.pedir_clube('clube_a');
select t.permitido('escolhas', format($q$select public.requisito_escolher(r, array[(select o.id from public.requirement_options o join public.requirement_option_groups g on g.id = o.grupo_id where g.alvo_id = r order by o.ordem limit 1)], '{}')
  from unnest(array[t.req('amigo.V.1'), t.req('amigo.VII.1')]) r$q$), 2);
select t.permitido('IX.1', format($q$select public.requisito_escolher(%L, '{}', array['Cestaria [DADO DE TESTE]'])$q$, t.req('amigo.IX.1')));
select t.permitido('guarda uma evidência PRIVADA (o portal jamais pode expor isto)', format($q$select public.requisito_salvar(%L, 'Resposta privada do menor [TESTE]', null)$q$, t.req('amigo.I.1')));
select t.como('lider_a'); select t.pedir_clube('clube_a');
select t.permitido('lider_a aprova os 25', format($q$select public.requisito_avaliar(mr.id, 'aprovado', 'comentário interno [TESTE]') from public.member_requirements mr where mr.member_class_id = %L$q$, t.id('mc')), 25);
select t.permitido('revisão final', format($q$select public.revisao_final_decidir(%L, 'aprovado', 'ok')$q$, t.id('mc')));
select t.permitido('investidura', format($q$select public.investidura_registrar(%L, current_date, 'Cerimônia [TESTE]')$q$, t.id('mc')));
select t.permitido('emite o documento FINAL', format($q$select public.documento_emitir(%L, 'final')$q$, t.id('mc')));
reset role;
insert into t.ids_txt (chave, id) select 'token_final', token_publico from public.class_documents where member_class_id = t.id('mc') and tipo = 'final';

-- ==================== 3) PAINEL: só agregado, e só dos clubes abaixo ====================
select t.como('coord_a'); select t.pedir_escopo('distrito_a');
select t.eq('painel do distrito A traz 1 clube (o clube A) — e só ele', (select json_array_length(public.escopo_painel())), 1);
select t.eq('...com o nome do clube e as contagens (membros ativos > 0, 1 investido)',
  (select (c ->> 'nome') || '|' || ((c ->> 'membros_ativos')::int > 0)::text || '|' || (c ->> 'investidos_total') from json_array_elements(public.escopo_painel()) c),
  'Filhos da Conquista|true|1');
select t.eq('MINIMIZAÇÃO: o painel NÃO contém nome de pessoa, evidência, comentário interno, foto, telefone nem e-mail',
  ((public.escopo_painel()::text like '%Multi Dois Papeis%') or (public.escopo_painel()::text like '%Resposta privada%')
   or (public.escopo_painel()::text like '%comentário interno%') or (public.escopo_painel()::text like '%@teste.local%'))::text, 'false');
select t.como('coord_reg_a'); select t.pedir_escopo('regiao_a');
select t.eq('a regional enxerga o mesmo clube por baixo do distrito (desce a árvore inteira)', (select json_array_length(public.escopo_painel())), 1);
select t.como('coord_b'); select t.pedir_escopo('distrito_b');
select t.eq('OUTRO TENANT: o distrital de B não vê o clube A no painel dele (vê só o B)',
  (select (c ->> 'nome') from json_array_elements(public.escopo_painel()) c), 'Clube B (teste)');
reset role;

-- ==================== 4) HIERARQUIA NÃO É ACESSO: o coordenador não lê nada de operacional/pessoal ====================
select t.como('coord_a'); select t.pedir_escopo('distrito_a');
-- o que importa é não enxergar NINGUÉM dos clubes abaixo. (Ver um colega coordenador do MESMO distrito
-- é esperado e não é hierarquia: `compartilha_clube_com` casa por unidade organizacional compartilhada,
-- exatamente como dois membros do mesmo clube se enxergam.)
select t.eq('coordenador distrital NÃO lê NENHUM perfil de gente dos clubes abaixo (nem liderança, nem membro, nem a pessoa da investidura)',
  t.nv(format($q$select count(*) from public.profiles where id in (%L, %L, %L)$q$, t.id('multi_dois_papeis'), t.id('lider_a'), t.id('membro_a'))), 0);
select t.eq('...e o conjunto TOTAL de perfis que ele enxerga é exatamente {ele mesmo, colega do mesmo distrito} — mais ninguém no banco inteiro',
  t.nv(format($q$select count(*) from public.profiles where id not in (%L, %L)$q$, t.id('coord_a'), t.id('dupla_jornada'))), 0);
select t.eq('...NÃO lê member_classes', t.nv('select count(*) from public.member_classes'), 0);
select t.eq('...NÃO lê member_requirements (evidências)', t.nv('select count(*) from public.member_requirements'), 0);
select t.eq('...NÃO lê requirement_approvals (comentários internos)', t.nv('select count(*) from public.requirement_approvals'), 0);
select t.eq('...NÃO lê fotos, chat, mensalidades nem responsáveis',
  t.nv('select count(*) from public.fotos') + t.nv('select count(*) from public.chat_mensagens') + t.nv('select count(*) from public.mensalidades') + t.nv('select count(*) from public.responsaveis'), 0);
select t.eq('...e continua SEM clube em uso (não tem vínculo de clube nenhum — o app operacional segue fechado pra ele)', (public.clube_atual_id() is null)::text, 'true');
select t.eq('...nem o snapshot/documento/decisões do clube abaixo',
  t.nv('select count(*) from public.class_completion_snapshots') + t.nv('select count(*) from public.class_documents') + t.nv('select count(*) from public.workflow_stage_decisions'), 0);
reset role;

-- ==================== 5) "nada exige sua atuação": Classes Regulares NÃO têm etapa distrital ====================
select t.como('coord_a'); select t.pedir_escopo('distrito_a');
select t.eq('não há investidura aguardando esta autoridade (nenhum cartão chegou na etapa distrital ainda)', (select json_array_length(public.escopo_investiduras_pendentes())), 0);
select t.como('coord_reg_a'); select t.pedir_escopo('regiao_a');
select t.eq('idem para a regional', (select json_array_length(public.escopo_investiduras_pendentes())), 0);
reset role;
-- e quando o workflow EXIGE a etapa distrital, aí sim aparece (mesmo motor da fase 4.2)
update public.investiture_workflows set ativo = false where chave = 'classes-regulares';
insert into public.investiture_workflows (id, chave, versao, nome, descricao, ativo) values
  (public.curriculo_uuid('t42:wf:2'), 'classes-regulares', 90, '[TESTE] com etapa distrital', 'Fictício, só pra provar o portal — não é regra real.', true);
insert into public.investiture_workflow_stages (id, workflow_id, ordem, chave, nome, escopo_tipo, papeis_permitidos, obrigatoria, pular_se_nivel_ausente, permite_mesmo_decisor) values
  (public.curriculo_uuid('t42:st:1'), public.curriculo_uuid('t42:wf:2'), 1, 'revisao_clube', 'Revisão do clube', 'clube', array['instrutor','diretoria'], true, false, true),
  (public.curriculo_uuid('t42:st:2'), public.curriculo_uuid('t42:wf:2'), 2, 'aprovacao_intermediaria', 'Aprovação distrital', 'distrito', array['coordenador_distrital'], true, false, false),
  (public.curriculo_uuid('t42:st:3'), public.curriculo_uuid('t42:wf:2'), 3, 'investidura', 'Investidura', 'clube', array['instrutor','diretoria'], true, false, false);
select t.mk('aguarda_dist', 'Aguarda Distrital', 'desbravador', 'ativo', 'clube_a', 'A1', date '2014-05-05');
select t.como('aguarda_dist'); select t.pedir_clube('clube_a');
select t.permitido('aguarda_dist inicia Amigo', format($q$select public.classe_iniciar(%L)$q$, t.classe('amigo')));
reset role;
insert into t.ids (chave, id) select 'mc_dist', id from public.member_classes where usuario_id = t.id('aguarda_dist') and club_id = t.id('clube_a') and class_id = t.classe('amigo');
select t.como('aguarda_dist'); select t.pedir_clube('clube_a');
select t.permitido('escolhas', format($q$select public.requisito_escolher(r, array[(select o.id from public.requirement_options o join public.requirement_option_groups g on g.id = o.grupo_id where g.alvo_id = r order by o.ordem limit 1)], '{}')
  from unnest(array[t.req('amigo.V.1'), t.req('amigo.VII.1')]) r$q$), 2);
select t.permitido('IX.1', format($q$select public.requisito_escolher(%L, '{}', array['Cestaria [DADO DE TESTE]'])$q$, t.req('amigo.IX.1')));
select t.como('lider_a'); select t.pedir_clube('clube_a');
select t.permitido('lider_a aprova os 25 e a revisão do clube', format($q$select public.requisito_avaliar(mr.id, 'aprovado', 'ok') from public.member_requirements mr where mr.member_class_id = %L$q$, t.id('mc_dist')), 25);
select t.permitido('revisão do clube (etapa 1)', format($q$select public.revisao_final_decidir(%L, 'aprovado', 'ok')$q$, t.id('mc_dist')));
reset role;
select t.como('coord_a'); select t.pedir_escopo('distrito_a');
select t.eq('AGORA sim: a investidura parada na etapa distrital aparece pra ESTA autoridade, com o mínimo pra decidir',
  (select (i ->> 'pessoa_nome') || '|' || (i ->> 'classe_nome') || '|' || (i -> 'etapa' ->> 'escopo_tipo') from json_array_elements(public.escopo_investiduras_pendentes()) i where i ->> 'pessoa_nome' = 'Aguarda Distrital'),
  'Aguarda Distrital|Amigo|distrito');
select t.eq('...e mesmo aqui NÃO vazam evidências nem comentários internos do clube', ((public.escopo_investiduras_pendentes()::text like '%Resposta privada%') or (public.escopo_investiduras_pendentes()::text like '%comentário interno%'))::text, 'false');
select t.como('coord_b'); select t.pedir_escopo('distrito_b');
select t.eq('OUTRO TENANT: o distrital de B não vê a investidura parada no distrito A', (select json_array_length(public.escopo_investiduras_pendentes())), 0);
reset role;

-- ==================== 6) RED-TEAM da rota pública /verificar/<token> ====================
select t.como_anon();
select t.eq('TOKEN INEXISTENTE: encontrado=false (mesma forma de resposta, sem sinal de existência)', public.documento_verificar('ZZZZZZZZZZZZZZZZZZZZ') ->> 'encontrado', 'false');
select t.eq('ENUMERAÇÃO por token curto/vizinho: nada encontrado', (public.documento_verificar('A') ->> 'encontrado') || '|' || (public.documento_verificar('AAAAAAAAAAAAAAAAAAAA') ->> 'encontrado') || '|' || (public.documento_verificar('00000000000000000000') ->> 'encontrado'), 'false|false|false');
select t.eq('MANIPULAÇÃO: token válido com 1 caractere trocado não resolve',
  (select public.documento_verificar(overlay(id placing case when substr(id, 1, 1) = 'A' then 'B' else 'A' end from 1 for 1)) ->> 'encontrado' from t.ids_txt where chave = 'token_final'), 'false');
select t.eq('INJEÇÃO no token (aspas/%/_/;) não resolve nem quebra',
  (public.documento_verificar($$' or 1=1 --$$) ->> 'encontrado') || '|' || (public.documento_verificar('%') ->> 'encontrado') || '|' || (public.documento_verificar('_') ->> 'encontrado'), 'false|false|false');
select t.eq('ENUMERAÇÃO por leitura direta: anon não lê class_documents nem a lista de tokens', t.nv('select count(*) from public.class_documents'), 0);
select t.eq('anon não chama as RPCs do portal institucional (nem existe escopo pra ele)',
  t.n('select case when public.escopo_painel() is null then 0 else 1 end'), -1);
-- o que a verificação pública REVELA (mínimo) e o que NÃO revela
select t.eq('token VÁLIDO: revela só status/tipo/titular/classe/datas/emissora — e integridade',
  (select (d ->> 'encontrado') || '|' || (d ->> 'estado') || '|' || (d ->> 'tipo') || '|' || (d ->> 'nome') || '|' || (d ->> 'classe') || '|' || (d ->> 'clube_emissor') || '|' || (d ->> 'integro')
   from (select public.documento_verificar((select id from t.ids_txt where chave = 'token_final')) d) x),
  'true|valido|final|Multi Dois Papeis|Amigo|Filhos da Conquista|true');
select t.eq('NÃO revela nascimento, telefone, endereço, e-mail, evidência, comentário interno, avaliações nem IDs internos',
  (select ((d like '%2013-%') or (d like '%@teste.local%') or (d like '%Resposta privada%') or (d like '%comentário interno%')
        or (d like '%' || t.id('mc')::text || '%') or (d like '%' || t.id('clube_a')::text || '%') or (d like '%' || t.id('multi_dois_papeis')::text || '%')
        or (d like '%avaliacoes%') or (d like '%secoes%') or (d like '%requisito%'))::text
   from (select public.documento_verificar((select id from t.ids_txt where chave = 'token_final'))::text d) x), 'false');
reset role;

-- ==================== 7) documento REVOGADO: a URL continua funcionando e diz REVOGADO ====================
select t.como('lider_a'); select t.pedir_clube('clube_a');
select t.permitido('a liderança do clube emissor revoga o snapshot (cascata: investidura + conquista)',
  format($q$select public.snapshot_revogar((select id from public.class_completion_snapshots where member_class_id = %L and status = 'selado'), 'Erro de avaliação [TESTE]')$q$, t.id('mc')));
reset role;
select t.como_anon();
select t.eq('a URL pública NÃO some: o mesmo token resolve e passa a dizer REVOGADO (com integridade ainda íntegra)',
  (select (d ->> 'encontrado') || '|' || (d ->> 'estado') || '|' || (d ->> 'integro') from (select public.documento_verificar((select id from t.ids_txt where chave = 'token_final')) d) x),
  'true|revogado|true');
reset role;
select t.eq('a revogação ficou auditada (motivo, autoria, data) e nada foi apagado',
  (select (revogado_motivo is not null and revogado_por is not null and revogado_em is not null)::text from public.class_completion_snapshots where member_class_id = t.id('mc')), 'true');

-- ==================== 8) interface de dados de assinatura: preparada e VAZIA ====================
select t.eq('document_signatures existe, está vazia e nenhuma RPC escreve nela nesta fase', (select count(*) from public.document_signatures), 0);
select t.eq('...e o único método de decisão usado de verdade continua sendo aprovacao_sistema',
  (select count(*) from public.workflow_stage_decisions where metodo <> 'aprovacao_sistema'), 0);
select t.como('lider_a'); select t.pedir_clube('clube_a');
select t.bloqueado('ninguém escreve assinatura pela API (sem RPC e sem grant)', $q$insert into public.document_signatures (snapshot_id, club_id_origem, metodo) values (gen_random_uuid(), gen_random_uuid(), 'assinatura_eletronica')$q$);
reset role;

select t.fim();
rollback;
