-- Fase 9.1 (migration 86) — CURRÍCULO: o que a revisão adversarial das migrations 83/84 achou.
--
-- Cada bloco é um achado CONFIRMADO pelo cético, com o cenário dele. Todos ficam vermelhos sem a 86:
--   C1  matrícula ANTIGA numa classe de versão que não é oficial (a PILOTO da 36) continuava servida
--       por Minha Classe, pelas filas e contagens da liderança, e aceitava salvar/enviar/avaliar; e
--       as leituras de classe não olhavam o recurso 'classes';
--   C2  requisito_origem entregava o requisito [TESTE] a qualquer conta logada;
--   S4  curriculum_dependencies (using true) mostrava a dependência do catálogo de teste;
--   C3  um manifesto INCOMPLETO passava se o slot que faltava tinha uma linha avulsa (sem manifesto);
--   C4  o hash não era conferido contra o pacote, o arquivo não precisava ser o do ano, e a fonte
--       trocada com o mesmo hash virava "já estava" em silêncio;
--   C5  um admin da plataforma ligava especialidades pelo ONBOARDING (sem catálogo oficial, sem auditoria);
--   C7  a revisão final gravava a avaliação da correção sem o conteúdo avaliado;
--   C8  o dia de referência do conteúdo anual era o de São Paulo para qualquer clube.
begin;
\ir _lib.sql
\ir _curriculo_regular_2026.sql
\ir _fixtures.sql

\o /dev/null
insert into public.club_features (club_id, feature, enabled) values (t.id('clube_a'), 'classes', true), (t.id('clube_b'), 'classes', true)
on conflict (club_id, feature) do update set enabled = true;
insert into t.ids (chave, id) values
  ('classe_piloto', '00000000-0000-4000-a000-000000000002'::uuid),
  ('versao_oficial_esp', '00000000-0000-4000-a000-000000000641'::uuid),
  ('esp_oficial', '00000000-0000-4000-a000-000000000642'::uuid);
-- o requisito da classe PILOTO que a dependência de TESTE (semeada pela 37, existe em produção) aponta
insert into t.ids (chave, id) select 'req_dep_piloto', alvo_id from public.curriculum_dependencies where observacao like 'Dependência de TESTE%';
create function t.classe(p text) returns uuid language sql stable as $$
  select c.id from public.classes c join public.curriculum_versions v on v.id = c.curriculum_version_id where v.origem = 'oficial' and v.status = 'publicado' and c.manifesto_id = p $$;
create function t.req(p text) returns uuid language sql stable as $$
  select r.id from public.class_requirements r join public.class_sections s on s.id = r.section_id join public.classes c on c.id = s.class_id
  join public.curriculum_versions v on v.id = c.curriculum_version_id where r.manifesto_id = p and v.origem = 'oficial' and v.status = 'publicado' $$;
\o

-- =============================================================================
-- C1) Classe de versão que não é oficial: nem leitura, nem escrita, nem contagem
-- =============================================================================
-- Dado ANTIGO (existe no staging): membro_b tem uma matrícula na classe PILOTO, no clube B, com um
-- requisito aguardando avaliação e outro devolvido para correção.
\o /dev/null
select public._classe_matricular(t.id('membro_b'), t.id('clube_b'), t.id('classe_piloto'));
insert into t.ids (chave, id) select 'mc_piloto', id from public.member_classes where usuario_id = t.id('membro_b') and class_id = t.id('classe_piloto');
insert into t.ids (chave, id) select 'mr_piloto', mr.id from public.member_requirements mr where mr.member_class_id = t.id('mc_piloto') order by mr.id limit 1;
insert into t.ids (chave, id) select 'mr_piloto_2', mr.id from public.member_requirements mr where mr.member_class_id = t.id('mc_piloto') order by mr.id offset 1 limit 1;
insert into t.ids (chave, id) select 'req_piloto_2', requirement_id from public.member_requirements where id = t.id('mr_piloto_2');
update public.member_requirements set status = 'aguardando_avaliacao', enviado_em = now(), evidencia_texto = 'resposta antiga [TESTE]' where id = t.id('mr_piloto');
update public.member_requirements set status = 'correcao_solicitada' where id = t.id('mr_piloto_2');
\o
select t.como('membro_b'); select t.pedir_clube('clube_b');
select t.eq('[C1 leitura] minha_classe() não serve a matrícula da classe PILOTO', t.txt($q$select coalesce(public.minha_classe()::text, 'NULL')$q$), 'NULL');
select t.eq('[C1 leitura] ...nem pedindo pelo id dela', t.txt(format($q$select coalesce(public.minha_classe(%L)::text, 'NULL')$q$, t.id('mc_piloto'))), 'NULL');
select t.eq('[C1 leitura] a explicação do requisito dela é NULL (como "não existe")', t.txt(format($q$select coalesce(public.explicar_requisito_classe(%L)::text, 'NULL')$q$, t.id('mr_piloto'))), 'NULL');
select t.throws('[C1 escrita] salvar um requisito dela é "não encontrado"', format($q$select public.requisito_salvar(%L, 'x', null)$q$, t.id('req_piloto_2')), 'não encontrado');
select t.throws('[C1 escrita] ...enviar também', format($q$select public.requisito_enviar(%L)$q$, t.id('req_piloto_2')), 'não encontrado');
select t.throws('[C1 escrita] ...e escolher opção', format($q$select public.requisito_escolher(%L, '{}', array['x'])$q$, t.id('req_piloto_2')), 'não encontrado');
select t.eq('[C1 Início] o card "Seu instrutor pediu uma correção" não aparece para a classe PILOTO',
  t.n($q$select count(*) from json_array_elements(public.meu_inicio()) i where i->>'rota' = '/minha-classe' or i::text ilike '%PILOTO%'$q$), 0);
select t.como('lider_b'); select t.pedir_clube('clube_b');
select t.eq('[C1 fila] classe_avaliacoes_pendentes não traz o requisito da classe PILOTO', t.n($q$select json_array_length(public.classe_avaliacoes_pendentes())$q$), 0);
select t.eq('[C1 Gestão] a fila única não conta o envio PILOTO', t.txt($q$select public.avaliacoes_pendentes()->>'classes'$q$), '0');
select t.throws('[C1 escrita] a liderança não avalia o requisito PILOTO ("não encontrado")', format($q$select public.requisito_avaliar(%L, 'aprovado', null)$q$, t.id('mr_piloto')), 'não encontrado');
select t.throws('[C1 escrita] ...nem pede a revisão final da matrícula PILOTO', format($q$select public.classe_revisao_solicitar(%L)$q$, t.id('mc_piloto')), 'não encontrada');
reset role;
\o /dev/null
update public.member_classes set status = 'aguardando_revisao' where id = t.id('mc_piloto');
\o
select t.como('lider_b'); select t.pedir_clube('clube_b');
select t.eq('[C1 fila] a revisão final pendente da matrícula PILOTO não aparece', t.n($q$select json_array_length(public.classe_revisoes_pendentes())$q$), 0);
select t.eq('[C1 Gestão] ...nem na contagem de investiduras', t.txt($q$select public.avaliacoes_pendentes()->>'investiduras'$q$), '0');
reset role;
-- 'classes' DESLIGADO no B: as leituras recusam como as escritas já recusavam
\o /dev/null
update public.club_features set enabled = false where club_id = t.id('clube_b') and feature = 'classes';
\o
select t.como('membro_b'); select t.pedir_clube('clube_b');
select t.throws('[C1 recurso] minha_classe recusa com classes desligado', $q$select public.minha_classe()$q$, 'desabilitado');
select t.como('lider_b'); select t.pedir_clube('clube_b');
select t.throws('[C1 recurso] classe_avaliacoes_pendentes recusa com classes desligado', $q$select public.classe_avaliacoes_pendentes()$q$, 'desabilitado');
select t.throws('[C1 recurso] classe_revisoes_pendentes também', $q$select public.classe_revisoes_pendentes()$q$, 'desabilitado');
select t.como('membro_b'); select t.pedir_clube('clube_b');
select t.eq('[C1 recurso] quem não é liderança continua recebendo a fila vazia (sem mudar o contrato)', t.n($q$select json_array_length(public.classe_avaliacoes_pendentes())$q$), 0);
reset role;
\o /dev/null
update public.club_features set enabled = true where club_id = t.id('clube_b') and feature = 'classes';
\o

-- =============================================================================
-- C2 + S4) O catálogo de TESTE não sai pela origem do requisito nem pelas dependências
-- =============================================================================
-- (a especialidade OFICIAL de fixture, publicada como a plataforma faria — para o controle)
\o /dev/null
insert into public.curriculum_versions (id, origem, identificador, versao, status, fonte_descricao)
values (t.id('versao_oficial_esp'), 'oficial', 'especialidades-oficiais-fixture-64', '1', 'publicado', 'FIXTURE do teste 64.');
insert into public.specialties (id, curriculum_version_id, codigo, nome, ordem)
values (t.id('esp_oficial'), t.id('versao_oficial_esp'), 'oficial_fixture_64', 'Especialidade Oficial (fixture 64)', 10);
-- uma dependência OFICIAL (especialidade oficial exige a classe Amigo oficial)
insert into public.curriculum_dependencies (alvo_tipo, alvo_id, depende_de_tipo, depende_de_id, obrigatorio, observacao)
values ('specialty', t.id('esp_oficial'), 'class', t.classe('amigo'), true, 'dependência oficial (fixture 64)');
\o
select t.como('membro_a'); select t.pedir_clube('clube_a');
select t.eq('[S4] curriculum_dependencies por REST: a dependência de TESTE não aparece, a oficial sim',
  t.txt($q$select string_agg(observacao, ',') from public.curriculum_dependencies$q$), 'dependência oficial (fixture 64)');
select t.eq('[C2] requisito_origem do requisito da classe PILOTO não responde a membro', t.txt(format($q$select coalesce(public.requisito_origem(%L)::text, 'NULL')$q$, t.id('req_dep_piloto'))), 'NULL');
select t.eq('[C2] (controle) o requisito oficial continua com a origem', t.txt(format($q$select public.requisito_origem(%L)->'versao'->>'origem'$q$, t.req('amigo.I.1'))), 'oficial');
reset role;
select t.como_cron();
select t.ok('[C2] (controle) a plataforma (sessão sem usuário) continua lendo a origem de qualquer versão', public.requisito_origem(t.id('req_dep_piloto')) is not null);
reset role;

-- =============================================================================
-- C3 + C4) A publicação do conteúdo anual confere o que recebe
-- =============================================================================
-- A serialização canônica do banco é a MESMA do gerador JS: o fixture do manifesto 2026.3 guarda o
-- texto canônico que o JS gerou e o sha256 dele (acentos, travessões, aspas, barras — dado real).
select t.eq('[C4] _json_canonico reproduz, byte a byte, o texto canônico que o gerador JS produziu',
  t.txt($q$select (public._json_canonico(texto::jsonb) = texto)::text from t.manifesto$q$), 'true');
select t.eq('[C4] ...e o sha256 do banco é o hash que o gerador gravou',
  t.txt($q$select (encode(extensions.digest(public._json_canonico(texto::jsonb), 'sha256'), 'hex') = hash)::text from t.manifesto$q$), 'true');
\o /dev/null
create function t.pacote(p_ano int, p_itens jsonb, p_arquivo text default null) returns jsonb language sql as $$
  select jsonb_build_object('formato', 'conquista.conteudo_anual/1', 'ano', p_ano,
                            'arquivo', coalesce(p_arquivo, 'supabase/curriculo-manifesto/conteudo-anual/' || p_ano || '.json'), 'itens', p_itens) $$;
-- o sha256 do pacote canônico (sem a 86 não há _json_canonico: devolve o sha256 do texto do jsonb, e os asserts
-- que dependem dele ficam vermelhos em vez de derrubar o arquivo)
create function t.hash(p jsonb) returns text language plpgsql as $$
declare v text;
begin
  execute 'select encode(extensions.digest(public._json_canonico($1), ''sha256''), ''hex'')' into v using p;
  return v;
exception when undefined_function then return encode(extensions.digest(p::text, 'sha256'), 'hex');
end $$;
-- os slots do catálogo OFICIAL publicado, com um item de ano inteiro cada (menos os que se pedir para tirar)
create function t.itens(p_ano int, p_sem text default null) returns jsonb language sql as $$
  select jsonb_agg(jsonb_build_object('chave', d.chave, 'valor', 'Livro ' || p_ano || ' ' || d.chave || ' [TESTE]',
           'vigente_desde', p_ano || '-01-01', 'vigente_ate', p_ano || '-12-31',
           'fonte_url', 'https://exemplo.invalid/fonte', 'fonte_descricao', 'fixture do teste 64') order by d.chave)
    from public.dynamic_content_definitions d
   where d.chave is distinct from p_sem
     and exists (select 1 from public.class_requirements r join public.class_sections s on s.id = r.section_id
                   join public.classes c on c.id = s.class_id join public.curriculum_versions v on v.id = c.curriculum_version_id
                  where r.conteudo_dinamico_definicao_id = d.id and r.ativo and c.ativo and v.status = 'publicado' and v.origem = 'oficial') $$;
\o
select t.throws('[C4] hash bem formado que NÃO é o do pacote é recusado (antes: gravado como fonte_hash)',
  format('select public.conteudo_anual_publicar(%L::jsonb, %L)', t.pacote(2096, t.itens(2096)), repeat('0', 64)), 'não confere');
select t.throws('[C4] pacote de 2096 que diz vir de outro arquivo (1999.json) é recusado — mesmo com o hash certo',
  format('select public.conteudo_anual_publicar(%L::jsonb, %L)', t.pacote(2096, t.itens(2096), 'x/1999.json'), t.hash(t.pacote(2096, t.itens(2096), 'x/1999.json'))), 'não é o manifesto de 2096');
-- C3: uma linha AVULSA de amigo em 2097 (SQL direto, sem manifesto) e um manifesto de 2097 SEM amigo
\o /dev/null
insert into public.dynamic_content_values (definicao_id, ano, valor, vigente_desde, vigente_ate, fonte_url, fonte_descricao)
select id, 2097, 'SEM-MANIFESTO [TESTE]', '2097-01-01', '2097-12-31', 'https://exemplo.invalid/avulsa', 'linha avulsa (teste 64)'
  from public.dynamic_content_definitions where chave = 'curso_leitura_amigo';
\o
select t.throws('[C3] manifesto de 2097 sem amigo é recusado: a linha avulsa NÃO cobre o slot (antes: publicava)',
  format('select public.conteudo_anual_publicar(%L::jsonb, %L)', t.pacote(2097, t.itens(2097, 'curso_leitura_amigo')), t.hash(t.pacote(2097, t.itens(2097, 'curso_leitura_amigo')))),
  'curso_leitura_amigo');
select t.eq('[C3] ...e nada de 2097 foi publicado por manifesto', (select count(*) from public.dynamic_content_values where ano = 2097 and fonte_hash is not null), 0);
-- controle: o manifesto COMPLETO de 2096, com o hash certo, publica; de novo é no-op
select t.eq('[C4] (controle) o manifesto completo de 2096, hash certo e arquivo do ano, publica os 6 slots',
  t.txt(format($q$select public.conteudo_anual_publicar(%L::jsonb, %L) ->> 'publicados'$q$, t.pacote(2096, t.itens(2096)), t.hash(t.pacote(2096, t.itens(2096))))), '6');
select t.eq('[C4] (controle) o mesmo manifesto de novo é no-op',
  t.txt(format($q$select public.conteudo_anual_publicar(%L::jsonb, %L) ->> 'ja_estavam'$q$, t.pacote(2096, t.itens(2096)), t.hash(t.pacote(2096, t.itens(2096))))), '6');
-- a linha publicada foi mexida fora da publicação (a fonte trocada): o no-op não esconde mais isso
\o /dev/null
update public.dynamic_content_values set fonte_url = 'https://outra.fonte.invalid/2096'
 where ano = 2096 and definicao_id = (select id from public.dynamic_content_definitions where chave = 'curso_leitura_guia');
\o
select t.throws('[C4] mesmo manifesto com a fonte alterada no banco é RECUSADO (antes: "ja_estavam" em silêncio)',
  format('select public.conteudo_anual_publicar(%L::jsonb, %L)', t.pacote(2096, t.itens(2096)), t.hash(t.pacote(2096, t.itens(2096)))), 'alterada fora da publicação');

-- =============================================================================
-- C5) Admin da plataforma NÃO liga especialidades pelo onboarding
-- =============================================================================
\o /dev/null
select t.signup('admin_64', '{"tipo":"fundador","nome":"Admin da Plataforma 64"}'::jsonb);
insert into public.platform_admins (user_id, papel, motivo) values (t.id('admin_64'), 'operacao', 'teste 64');
\o
select t.como('admin_64');
\o /dev/null
select public.onboarding_iniciar();
select public.onboarding_etapa('conta', '{"nome":"Cliente 64","email":"c64@teste.local"}'::jsonb);
select public.onboarding_etapa('dados_basicos', '{"documento":"00.000.000/0001-64","telefone":"81999990064"}'::jsonb);
select public.onboarding_etapa('clube', '{"nome":"Clube 64","plano":"completo"}'::jsonb);
select public.onboarding_etapa('identidade', '{"sigla":"C4"}'::jsonb);
select public.onboarding_etapa('diretor', '{}'::jsonb);
select public.onboarding_etapa('configuracao', '{"pix":""}'::jsonb);
\o
select t.throws('[C5] o admin da plataforma NÃO liga especialidades pela etapa "recursos" do onboarding (plano que inclui tudo)',
  $q$select public.onboarding_etapa('recursos', '{"recursos":{"especialidades":true}}'::jsonb)$q$, 'liberado pela plataforma');
reset role;
insert into t.ids (chave, id) select 'clube_64', club_id from public.onboarding_sessions where user_id = t.id('admin_64');
select t.eq('[C5] ...e o clube novo continua com especialidades desligado', public.recurso_habilitado_no_clube(t.id('clube_64'), 'especialidades'), false);
select t.como('admin_64');
select t.permitido('[C5] (controle) pela RPC auditada da plataforma liga (há catálogo oficial publicado)',
  format($q$select public.admin_recurso_do_clube_definir(%L, 'especialidades', true)$q$, t.id('clube_64')));
reset role;
select t.eq('[C5] (controle) ...ligado e auditado', public.recurso_habilitado_no_clube(t.id('clube_64'), 'especialidades')::text || '|'
  || (select count(*) from public.auditoria_operacoes where operacao = 'recurso_alterado_pela_plataforma' and club_id = t.id('clube_64')), 'true|1');
select t.eq('[C5] a marca da RPC não sobra na transação depois dela', coalesce(current_setting('conquista.recurso_pela_plataforma', true), ''), '');

-- =============================================================================
-- C7) A correção da revisão final grava o conteúdo avaliado
-- =============================================================================
\o /dev/null
insert into public.dynamic_content_values (definicao_id, ano, valor, vigente_desde, vigente_ate, fonte_url, fonte_descricao)
select d.id, a.y, 'Livro do ano (fixture 64) [DADO DE TESTE]', make_date(a.y, 1, 1), make_date(a.y, 12, 31), 'https://exemplo.test/fixture', 'FIXTURE DE TESTE'
from public.dynamic_content_definitions d, (select extract(year from public._data_no_brasil())::int as y) a where d.chave = 'curso_leitura_amigo';
\o
select t.como('membro_a'); select t.pedir_clube('clube_a');
select t.permitido('membro_a inicia Amigo (oficial) no A', format($q$select public.classe_iniciar(%L)$q$, t.classe('amigo')));
select t.eq('[C1] (controle) minha_classe serve a matrícula OFICIAL', t.txt($q$select public.minha_classe()->'curriculum_version'->>'origem'$q$), 'oficial');
reset role;
insert into t.ids (chave, id) select 'mc', id from public.member_classes where usuario_id = t.id('membro_a') and club_id = t.id('clube_a') and class_id = t.classe('amigo');
select t.como('membro_a'); select t.pedir_clube('clube_a');
select t.permitido('membro_a registra as escolhas (V.1, VII.1: 1ª opção)',
  format($q$select public.requisito_escolher(r, array[(select o.id from public.requirement_options o join public.requirement_option_groups g on g.id = o.grupo_id where g.alvo_id = r order by o.ordem limit 1)], '{}') from unnest(array[%L::uuid, %L::uuid]) r$q$, t.req('amigo.V.1'), t.req('amigo.VII.1')), 2);
select t.permitido('...IX.1 (texto livre)', format($q$select public.requisito_escolher(%L, '{}', array['Cestaria [DADO DE TESTE]'])$q$, t.req('amigo.IX.1')));
select t.como('lider_a'); select t.pedir_clube('clube_a');
select t.permitido('lider_a aprova os 25 requisitos', format($q$select public.requisito_avaliar(mr.id, 'aprovado', 'ok') from public.member_requirements mr where mr.member_class_id = %L$q$, t.id('mc')), 25);
reset role;
insert into t.ids (chave, id) select 'mr_i4', id from public.member_requirements where member_class_id = t.id('mc') and requirement_id = t.req('amigo.I.4');
select t.eq('a matrícula chegou à revisão final, e o I.4 tem o conteúdo do ano fixado na aprovação',
  (select status from public.member_classes where id = t.id('mc')) || '|' || (select conteudo_fixado ->> 'valor' from public.member_requirements where id = t.id('mr_i4')),
  'aguardando_revisao|Livro do ano (fixture 64) [DADO DE TESTE]');
select t.como('lider_a'); select t.pedir_clube('clube_a');
select t.permitido('lider_a pede correção do I.4 na revisão final',
  format($q$select public.revisao_final_decidir(%L, 'correcao_solicitada', 'Refazer o I.4.', array[%L::uuid])$q$, t.id('mc'), t.id('mr_i4')));
reset role;
select t.eq('[C7] a avaliação da revisão final gravou o conteúdo avaliado (= o fixado no requisito)',
  (select (a.conteudo_avaliado is not null and a.conteudo_avaliado = mr.conteudo_fixado)::text
     from public.requirement_approvals a join public.member_requirements mr on mr.id = a.member_requirement_id
    where a.member_requirement_id = t.id('mr_i4') and a.comentario like 'Revisão final:%' order by a.created_at desc limit 1), 'true');

-- =============================================================================
-- C8) O dia de referência é o do CLUBE (e o fuso é validado)
-- =============================================================================
\o /dev/null
insert into public.organizational_units (type, nome, slug, pais, timezone, metadata) values
  ('clube', 'Clube Rio Branco (64)', 'clube-rb-64', 'BR', 'America/Rio_Branco', '{"test_only":true}'),
  ('clube', 'Clube Kiritimati (64)', 'clube-k-64', 'KI', 'Pacific/Kiritimati', '{"test_only":true}'),
  ('clube', 'Clube Pago Pago (64)', 'clube-p-64', 'AS', 'Pacific/Pago_Pago', '{"test_only":true}');
insert into t.ids (chave, id) select 'clube_rb', id from public.organizational_units where slug = 'clube-rb-64';
insert into t.ids (chave, id) select 'clube_k', id from public.organizational_units where slug = 'clube-k-64';
insert into t.ids (chave, id) select 'clube_p', id from public.organizational_units where slug = 'clube-p-64';
-- o dia de hoje no fuso de um clube, calculado pelo próprio teste
create function t.dia_local(p_chave text) returns date language sql stable as $$
  select (now() at time zone (select timezone from public.organizational_units where id = t.id(p_chave)))::date $$;
\o
select t.eq('[C8] às 04:30 UTC de 01/01/2027: no Acre ainda é 31/12; em A (Recife) e sem clube (São Paulo), já é 01/01',
  t.txt(format($q$select public._data_do_clube(%L, '2027-01-01 04:30+00')::text || '|' || public._data_do_clube(%L, '2027-01-01 04:30+00')::text
                   || '|' || public._data_do_clube(null, '2027-01-01 04:30+00')::text$q$, t.id('clube_rb'), t.id('clube_a'))),
  '2026-12-31|2027-01-01|2027-01-01');
-- Kiritimati (UTC+14) e Pago Pago (UTC-11) estão SEMPRE em dias diferentes (25h de diferença): um
-- conteúdo vigente só no dia de hoje em Kiritimati vale para o requisito do clube de lá e NÃO para o
-- de Pago Pago. Pelo dia de São Paulo (antes), os dois recebiam a MESMA resposta.
\o /dev/null
insert into public.dynamic_content_definitions (chave, nome, descricao) values ('fuso_64', 'Fuso (teste 64)', 'slot de teste do dia de referência');
insert into public.dynamic_content_values (definicao_id, ano, valor, vigente_desde, vigente_ate, fonte_url, fonte_descricao)
select d.id, extract(year from t.dia_local('clube_k'))::int, 'só hoje em Kiritimati [TESTE]',
       t.dia_local('clube_k'), t.dia_local('clube_k'), 'https://exemplo.invalid/fuso', 'fixture 64'
  from public.dynamic_content_definitions d where d.chave = 'fuso_64';
select public._classe_matricular(t.id('membro_a'), t.id('clube_k'), t.classe('guia'));
select public._classe_matricular(t.id('membro_a'), t.id('clube_p'), t.classe('guia'));
\o
select t.eq('[C8] o conteúdo de "hoje" é resolvido pelo dia NO CLUBE do requisito (Kiritimati: vale; Pago Pago: ainda não)',
  (select coalesce(public._conteudo_do_requisito(mr.id, 'fuso_64') ->> 'valor', 'NULL') from public.member_requirements mr
     join public.member_classes mc on mc.id = mr.member_class_id where mc.club_id = t.id('clube_k') and mr.requirement_id = t.req('guia.I.1'))
  || ' / ' ||
  (select coalesce(public._conteudo_do_requisito(mr.id, 'fuso_64') ->> 'valor', 'NULL') from public.member_requirements mr
     join public.member_classes mc on mc.id = mr.member_class_id where mc.club_id = t.id('clube_p') and mr.requirement_id = t.req('guia.I.1')),
  'só hoje em Kiritimati [TESTE] / NULL');
select t.eq('[C8] nenhuma das funções que escolhem "o conteúdo de hoje" usa mais o dia fixo de São Paulo',
  (select count(*) from pg_proc where pronamespace = 'public'::regnamespace
      and proname in ('_conteudo_do_requisito', '_fixar_conteudo_do_requisito')
      and prosrc ~ '_data_do_clube' and prosrc !~ '_data_no_brasil'), 2);
select t.ok('[C8] _requisito_bloqueios não escolhe mais conteúdo do dia (108: o Curso de Leitura não bloqueia) — e nunca pelo dia de São Paulo',
  (select prosrc !~ '_data_no_brasil' from pg_proc where pronamespace = 'public'::regnamespace and proname = '_requisito_bloqueios'));
select t.throws('[C8] fuso que não existe é recusado ao criar um clube', $q$insert into public.organizational_units (type, nome, slug, pais, timezone) values ('clube', 'Clube Marte', 'clube-marte-64', 'BR', 'Marte/Olimpo')$q$, 'Fuso horário inválido');
select t.throws('[C8] ...e ao trocar o de um clube', format($q$update public.organizational_units set timezone = 'hora do Brasil' where id = %L$q$, t.id('clube_a')), 'Fuso horário inválido');
select t.throws('[C8] ...e na conta comercial (o onboarding copia de lá para o clube)', $q$insert into public.billing_accounts (nome, timezone) values ('Conta 64', 'GMT-3 Brasília')$q$, 'Fuso horário inválido');

select t.fim();
rollback;
