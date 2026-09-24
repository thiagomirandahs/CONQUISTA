-- Fase 4 (migration 44): snapshot curricular IMUTÁVEL + fluxo formal de conclusão / revisão final / investidura.
-- Cenários pedidos: snapshot de uma conclusão válida; currículo depois arquivado/alterado sem mexer no snapshot;
-- conteúdo dinâmico congelado; aprovação/revisor preservados; tentativa de editar snapshot; investidura antes da
-- revisão; investidura válida; tentativa duplicada; Clube B reconhecendo a conquista emitida no A sem poder
-- alterá-la; remoção do vínculo do avaliador sem destruir a autoria; revogação/correção auditável sem apagar.
-- Curso de Leitura real segue sem fonte DSA: o valor aqui é FIXTURE SINTÉTICA marcada como teste.
begin;
\ir _lib.sql
\ir _curriculo_regular_2026.sql
\ir _fixtures.sql

insert into public.club_features (club_id, feature, enabled) values (t.id('clube_a'), 'classes', true), (t.id('clube_b'), 'classes', true)
on conflict (club_id, feature) do update set enabled = true;
create function t.classe(p text) returns uuid language sql stable as $$
  select c.id from public.classes c join public.curriculum_versions v on v.id = c.curriculum_version_id where v.origem = 'oficial' and v.status = 'publicado' and c.manifesto_id = p $$;
create function t.req(p text) returns uuid language sql stable as $$
  select r.id from public.class_requirements r join public.class_sections s on s.id = r.section_id join public.classes c on c.id = s.class_id
  join public.curriculum_versions v on v.id = c.curriculum_version_id where r.manifesto_id = p and v.origem = 'oficial' and v.status = 'publicado' $$;
create function t.mr(p text) returns uuid language sql stable as $$
  select id from public.member_requirements where member_class_id = t.id('mc') and requirement_id = t.req(p) $$;
create function t.snap(p_versao int) returns uuid language sql stable as $$
  select id from public.class_completion_snapshots where member_class_id = t.id('mc') and versao = p_versao $$;
create function t.eventos(p_tipo text) returns bigint language sql stable as $$
  select count(*) from public.class_completion_events where member_class_id = t.id('mc') and tipo = p_tipo $$;

-- fixture SINTÉTICA do conteúdo anual (o livro real de 2026 não tem fonte DSA — ver AUDITORIA)
-- (migration 84: ANO explícito e vigência fechada. O valor é o do ANO CORRENTE no Brasil — assim o
-- teste não vence na virada do ano, que era o que acontecia com as datas fixas de 2026.)
insert into public.dynamic_content_values (definicao_id, ano, valor, vigente_desde, vigente_ate, fonte_url, fonte_descricao)
select d.id, a.y, 'Livro do Curso de Leitura do ano [DADO DE TESTE]', make_date(a.y, 1, 1), make_date(a.y, 12, 31), 'https://exemplo.test/fixture', 'FIXTURE DE TESTE — não é o livro oficial'
from public.dynamic_content_definitions d, (select extract(year from public._data_no_brasil())::int as y) a where d.chave = 'curso_leitura_amigo';

-- ==================== conclusão válida de Amigo por multi_dois_papeis (13 anos; desbravador no A, conselheiro no B) ====================
select t.como('multi_dois_papeis'); select t.pedir_clube('clube_a');
select t.permitido('multi inicia Amigo no A', format($q$select public.classe_iniciar(%L)$q$, t.classe('amigo')));
reset role;
insert into t.ids (chave, id) select 'mc', id from public.member_classes where usuario_id = t.id('multi_dois_papeis') and club_id = t.id('clube_a') and class_id = t.classe('amigo');
select t.como('multi_dois_papeis'); select t.pedir_clube('clube_a');
select t.permitido('multi registra as escolhas (V.1, VII.1: 1ª opção; IX.1: texto livre)',
  format($q$select public.requisito_escolher(r, array[(select o.id from public.requirement_options o join public.requirement_option_groups g on g.id = o.grupo_id where g.alvo_id = r order by o.ordem limit 1)], '{}') from unnest(array[%L::uuid, %L::uuid]) r$q$, t.req('amigo.V.1'), t.req('amigo.VII.1')), 2);
select t.permitido('...IX.1', format($q$select public.requisito_escolher(%L, '{}', array['Cestaria [DADO DE TESTE]'])$q$, t.req('amigo.IX.1')));
select t.permitido('multi guarda uma resposta PRIVADA em I.1 (o snapshot não pode copiá-la)', format($q$select public.requisito_salvar(%L, 'Minha resposta privada [TESTE]', null)$q$, t.req('amigo.I.1')));
select t.como('lider_a'); select t.pedir_clube('clube_a');
select t.permitido('lider_a aprova os 25 requisitos', format($q$select public.requisito_avaliar(mr.id, 'aprovado', 'ok') from public.member_requirements mr where mr.member_class_id = %L$q$, t.id('mc')), 25);
reset role;

-- ==================== 1) snapshot de uma conclusão válida ====================
select t.eq('estados: 100% aprovado → requisitos_concluidos (evento) → snapshot selado → aguardando_revisao (NÃO investida)',
  (select status from public.member_classes where id = t.id('mc')) || '|' || t.eventos('requisitos_concluidos') || '|' || t.eventos('snapshot_selado') || '|' || t.eventos('revisao_solicitada'), 'aguardando_revisao|1|1|1');
select t.eq('snapshot v1 selado, com hash sha256, ligado à matrícula/pessoa/clube de origem/classe/versão', (select count(*) from public.class_completion_snapshots
  where id = t.snap(1) and status = 'selado' and hash ~ '^[0-9a-f]{64}$' and usuario_id = t.id('multi_dois_papeis') and club_id_origem = t.id('clube_a') and classe_id = t.classe('amigo')
    and curriculum_version_id = public.curriculo_uuid('version:classes-regulares-dsa:' || (select texto::jsonb ->> 'manifesto_versao' from t.manifesto)) and gerado_por = t.id('lider_a')), 1);
select t.eq('hash canônico bate com o conteúdo (snapshot_verificar integro=true)', t.txt(format($q$select (public.snapshot_verificar(%L)->>'integro')$q$, t.snap(1))), 'true');
select t.eq('conteúdo: pessoa, clube de origem, classe (manifesto_id/nome/idade), versão (manifesto_versao + hash do manifesto), formato',
  (select (c->'pessoa'->>'nome') || '|' || (c->'clube_origem'->>'slug') || '|' || (c->'classe'->>'manifesto_id') || '|' || (c->'classe'->>'idade_minima') || '|' || (c->'curriculum_version'->>'manifesto_versao') || '|' || (c->'curriculum_version'->>'fonte_hash') || '|' || (c->>'formato')
     from public.class_completion_snapshots s, lateral (select s.conteudo c) x where s.id = t.snap(1)),
  'Multi Dois Papeis|filhos-da-conquista|amigo|10|' || (select texto::jsonb ->> 'manifesto_versao' from t.manifesto) || '|' || (select hash from t.manifesto) || '|conquista.snapshot_classe/1');
select t.eq('conteúdo: 9 seções, 25 requisitos com texto/proveniência, todos aprovados, percentual 100',
  (select jsonb_array_length(c->'secoes') || '|' || (select count(*) from jsonb_array_elements(c->'secoes') s, jsonb_array_elements(s->'requisitos') r) || '|'
       || (select count(*) from jsonb_array_elements(c->'secoes') s, jsonb_array_elements(s->'requisitos') r where r->>'status' = 'aprovado' and r->>'descricao' <> '' and r->>'manifesto_id' <> '') || '|' || (c->>'percentual')
     from public.class_completion_snapshots s, lateral (select s.conteudo c) x where s.id = t.snap(1)), '9|25|25|100');
select t.eq('conteúdo: I.5 traz status_fonte/OMDs e as OMDs citadas estão no snapshot com URL (sem depender do catálogo)',
  (select (r->>'status_fonte') || '|' || (r->>'alterado_por_omd') || '|' || (r->>'confirmado_por_omd') || '|' || (select count(*) from jsonb_array_elements(c->'curriculum_version'->'omds') o where o->>'id' in ('OMD-012-2017', 'OMD-021-2024') and o->>'url' <> '')
     from public.class_completion_snapshots s, lateral (select s.conteudo c) x, jsonb_array_elements(c->'secoes') sec, jsonb_array_elements(sec->'requisitos') r where s.id = t.snap(1) and r->>'manifesto_id' = 'amigo.I.5'),
  'ALTERADO_POR_OMD|OMD-012-2017|OMD-021-2024|2');
select t.eq('conteúdo: escolhas registradas (V.1 = Natação principiante I; IX.1 = texto livre) e as opções do cartão',
  (select string_agg((r->>'manifesto_id') || '=' || (r->'escolha'->'escolhidas'->>0) || '/' || jsonb_array_length(r->'escolha'->'opcoes'), ',' order by r->>'manifesto_id')
     from public.class_completion_snapshots s, jsonb_array_elements(s.conteudo->'secoes') sec, jsonb_array_elements(sec->'requisitos') r where s.id = t.snap(1) and r->>'manifesto_id' in ('amigo.V.1', 'amigo.IX.1')),
  'amigo.IX.1=Cestaria [DADO DE TESTE]/0,amigo.V.1=Natação principiante I/4');
select t.eq('conteúdo: conteúdo dinâmico CONGELADO em I.4 — valor, ANO, período e fonte (o fixado na aprovação)',
  (select (r->'conteudo_dinamico'->>'valor') || '|' || (r->'conteudo_dinamico'->>'ano') || '|' || (r->'conteudo_dinamico'->>'vigente_desde') || '|' || (r->'conteudo_dinamico'->>'vigente_ate') || '|' || (r->'conteudo_dinamico'->>'fonte_descricao')
     from public.class_completion_snapshots s, jsonb_array_elements(s.conteudo->'secoes') sec, jsonb_array_elements(sec->'requisitos') r where s.id = t.snap(1) and r->>'manifesto_id' = 'amigo.I.4'),
  'Livro do Curso de Leitura do ano [DADO DE TESTE]|' || extract(year from public._data_no_brasil())::int || '|' || make_date(extract(year from public._data_no_brasil())::int, 1, 1) || '|' || make_date(extract(year from public._data_no_brasil())::int, 12, 31) || '|FIXTURE DE TESTE — não é o livro oficial');
-- MUDOU NA 8.5 (item 6). Este assert exigia o `comentario` do avaliador DENTRO do snapshot — ou
-- seja, congelava um vazamento. O snapshot é portátil: ele atravessa clube por desenho, e é lido
-- pela liderança de qualquer clube em que a pessoa entre depois. O comentário que o avaliador
-- escreveu é julgamento interno do clube emissor sobre uma criança, e viajava junto.
--
-- O mais revelador é que o assert vizinho (logo abaixo) já era o mecanismo certo — ele varre o
-- snapshot INTEIRO procurando o texto privado do desbravador. Ele não pegava o comentário do
-- avaliador só porque a fixture grava 'ok' nesse campo, um valor curto demais para ser procurado.
-- Agora a fixture grava um marcador, e a varredura cobre os dois lados.
select t.eq('conteúdo: aprovações com avaliador (nome), papel, clube e data — e NADA além disso',
  (select (r->'aprovacoes'->0->'avaliado_por'->>'nome') || '|' || (r->'aprovacoes'->0->>'papel') || '|' || ((r->'aprovacoes'->0->>'club_id')::uuid = t.id('clube_a'))::text || '|' || ((r->'aprovacoes'->0->>'em') is not null)::text
     from public.class_completion_snapshots s, jsonb_array_elements(s.conteudo->'secoes') sec, jsonb_array_elements(sec->'requisitos') r where s.id = t.snap(1) and r->>'manifesto_id' = 'amigo.I.1'),
  'Lider A|diretoria|true|true');
select t.eq('conteúdo: o comentário do avaliador NÃO entra no snapshot portátil',
  (select ((r->'aprovacoes'->0) ? 'comentario')::text
     from public.class_completion_snapshots s, jsonb_array_elements(s.conteudo->'secoes') sec, jsonb_array_elements(sec->'requisitos') r where s.id = t.snap(1) and r->>'manifesto_id' = 'amigo.I.1'),
  'false');
select t.eq('conteúdo: nem o uuid de quem avaliou (identificador interno não atravessa clube)',
  (select ((r->'aprovacoes'->0->'avaliado_por') ? 'id')::text
     from public.class_completion_snapshots s, jsonb_array_elements(s.conteudo->'secoes') sec, jsonb_array_elements(sec->'requisitos') r where s.id = t.snap(1) and r->>'manifesto_id' = 'amigo.I.1'),
  'false');
select t.eq('conteúdo: NÃO copia a evidência privada — só a referência (tem_texto=true) e nunca o texto',
  (select ((r->'evidencia'->>'tem_texto')::boolean)::text || '|' || (s.conteudo::text like '%Minha resposta privada%')::text
     from public.class_completion_snapshots s, jsonb_array_elements(s.conteudo->'secoes') sec, jsonb_array_elements(sec->'requisitos') r where s.id = t.snap(1) and r->>'manifesto_id' = 'amigo.I.1'), 'true|false');
select t.eq('conteúdo: prazo e proveniência da página oficial da classe (carimbo ≠ vigência)',
  (select ((c->'prazo'->>'minimo_atingido')::boolean)::text || '|' || (c->'classe'->>'fonte_publicado_em') || '|' || (c->'classe'->>'vigente_desde') || '|' || ((c->'classe'->>'fonte_url') like 'https://www.adventistas.org/%')::text
     from public.class_completion_snapshots s, lateral (select s.conteudo c) x where s.id = t.snap(1)), 'true|2017-11-04|2018-01-01|true');

-- ==================== 2) currículo arquivado/alterado depois — snapshot intacto ====================
update public.curriculum_versions set status = 'arquivado' where id = (select curriculum_version_id from public.class_completion_snapshots where id = t.snap(1));
update public.class_requirements set descricao = descricao || ' [EDITADO DEPOIS]' where id = t.req('amigo.I.1');
update public.dynamic_content_values set valor = 'Livro TROCADO depois' where fonte_descricao = 'FIXTURE DE TESTE — não é o livro oficial';
select t.eq('catálogo arquivado + texto de requisito editado + valor do ano trocado: o snapshot NÃO mudou (texto original, valor original, hash íntegro)',
  (select ((select r->>'descricao' from jsonb_array_elements(s.conteudo->'secoes') sec, jsonb_array_elements(sec->'requisitos') r where r->>'manifesto_id' = 'amigo.I.1') like '%EDITADO%')::text || '|'
       || (select r->'conteudo_dinamico'->>'valor' from jsonb_array_elements(s.conteudo->'secoes') sec, jsonb_array_elements(sec->'requisitos') r where r->>'manifesto_id' = 'amigo.I.4') || '|'
       || (s.conteudo->'curriculum_version'->>'status') || '|' || (public.snapshot_verificar(s.id)->>'integro')
     from public.class_completion_snapshots s where s.id = t.snap(1)), 'false|Livro do Curso de Leitura do ano [DADO DE TESTE]|publicado|true');
-- devolve o catálogo (o resto do fluxo continua nele)
update public.curriculum_versions set status = 'publicado' where id = (select curriculum_version_id from public.class_completion_snapshots where id = t.snap(1));
update public.class_requirements set descricao = replace(descricao, ' [EDITADO DEPOIS]', '') where descricao like '% [EDITADO DEPOIS]';
update public.dynamic_content_values set valor = 'Livro do Curso de Leitura do ano [DADO DE TESTE]' where fonte_descricao = 'FIXTURE DE TESTE — não é o livro oficial';

-- ==================== 3) tentativa de editar o snapshot: ninguém ====================
select t.como('lider_a'); select t.pedir_clube('clube_a');
select t.bloqueado('a liderança do clube de origem NÃO edita o snapshot (UPDATE direto)', format($q$update public.class_completion_snapshots set conteudo = '{}'::jsonb where id = %L$q$, t.snap(1)));
select t.bloqueado('...nem apaga', format($q$delete from public.class_completion_snapshots where id = %L$q$, t.snap(1)));
select t.como('multi_dois_papeis');
select t.bloqueado('a própria pessoa NÃO edita', format($q$update public.class_completion_snapshots set hash = repeat('0', 64) where id = %L$q$, t.snap(1)));
reset role;
select t.throws('nem quem roda SQL como dono do banco: UPDATE de conteúdo é recusado pelo gatilho', format($q$update public.class_completion_snapshots set conteudo = conteudo || '{"x":1}' where id = %L$q$, t.snap(1)), 'imutável');
select t.throws('...UPDATE do hash idem', format($q$update public.class_completion_snapshots set hash = repeat('0', 64) where id = %L$q$, t.snap(1)), 'imutável');
select t.throws('...DELETE idem', format($q$delete from public.class_completion_snapshots where id = %L$q$, t.snap(1)), 'não pode ser apagado');
select t.throws('eventos de auditoria também são imutáveis', format($q$update public.class_completion_events set tipo = 'snapshot_selado' where member_class_id = %L and tipo = 'requisitos_concluidos'$q$, t.id('mc')), 'imutável');
select t.throws('...e não se apagam', format($q$delete from public.class_completion_events where member_class_id = %L$q$, t.id('mc')), 'não pode ser apagado');

-- ==================== 4) investidura antes da revisão final: não ====================
select t.como('lider_a'); select t.pedir_clube('clube_a');
select t.throws('investidura com a revisão ainda pendente é recusada', format($q$select public.investidura_registrar(%L)$q$, t.id('mc')), 'revisão final');
select t.eq('...e nada mudou', (select status from public.member_classes where id = t.id('mc')) || '|' || (select count(*) from public.class_investitures where member_class_id = t.id('mc')), 'aguardando_revisao|0');

-- ==================== 5) correção na revisão final (auditada; snapshot v1 preservado; v2 nasce depois) ====================
select t.throws('pedir correção sem apontar requisito é recusado', format($q$select public.revisao_final_decidir(%L, 'correcao_solicitada', 'refaça')$q$, t.id('mc')), 'ao menos um requisito');
select t.permitido('lider_a pede correção do I.2 na revisão final', format($q$select public.revisao_final_decidir(%L, 'correcao_solicitada', 'O texto do I.2 precisa citar a Lei completa.', array[%L::uuid])$q$, t.id('mc'), t.mr('amigo.I.2')));
reset role;
select t.eq('correção: matrícula volta a em_andamento; I.2 reaberto com avaliação registrada ("Revisão final: …"); revisão marcada; evento; snapshot v1 continua selado',
  (select status from public.member_classes where id = t.id('mc')) || '|' || (select status from public.member_requirements where id = t.mr('amigo.I.2')) || '|'
  || (select count(*) from public.requirement_approvals where member_requirement_id = t.mr('amigo.I.2') and decisao = 'correcao_solicitada' and comentario like 'Revisão final:%' and avaliado_por = t.id('lider_a')) || '|'
  || (select status from public.investiture_reviews where snapshot_id = t.snap(1)) || '|' || t.eventos('revisao_correcao') || '|' || (select status from public.class_completion_snapshots where id = t.snap(1)),
  'em_andamento|correcao_solicitada|1|correcao_solicitada|1|selado');
select t.como('multi_dois_papeis'); select t.pedir_clube('clube_a');
select t.permitido('multi reenvia o I.2', format($q$select public.requisito_enviar(%L)$q$, t.req('amigo.I.2')));
select t.como('lider_a'); select t.pedir_clube('clube_a');
select t.permitido('lider_a aprova o I.2 de novo', format($q$select public.requisito_avaliar(%L, 'aprovado', 'agora sim')$q$, t.mr('amigo.I.2')));
reset role;
select t.eq('nova conclusão: snapshot v2 selado, v1 SUBSTITUÍDO (não editado, não apagado), matrícula aguardando revisão de novo',
  (select status from public.class_completion_snapshots where id = t.snap(1)) || '|' || (select status from public.class_completion_snapshots where id = t.snap(2)) || '|' || (select status from public.member_classes where id = t.id('mc')) || '|' || t.eventos('snapshot_substituido'),
  'substituido|selado|aguardando_revisao|1');
select t.eq('v1 e v2 têm hashes diferentes (o I.2 ganhou nova avaliação) e ambos íntegros', (select (s1.hash <> s2.hash)::text || '|' || (public.snapshot_verificar(s1.id)->>'integro') || '|' || (public.snapshot_verificar(s2.id)->>'integro')
  from public.class_completion_snapshots s1, public.class_completion_snapshots s2 where s1.id = t.snap(1) and s2.id = t.snap(2)), 'true|true|true');
select t.eq('v2 guarda o histórico do I.2: correção pedida na revisão E a nova aprovação', (select jsonb_array_length(r->'aprovacoes') from public.class_completion_snapshots s, jsonb_array_elements(s.conteudo->'secoes') sec, jsonb_array_elements(sec->'requisitos') r where s.id = t.snap(2) and r->>'manifesto_id' = 'amigo.I.2'), 3);

-- ==================== 6) revisão aprovada → apto; investidura reconfere o dinâmico; investidura válida ====================
select t.como('lider_a'); select t.pedir_clube('clube_a');
select t.permitido('lider_a aprova a revisão final (v2)', format($q$select public.revisao_final_decidir(%L, 'aprovado', 'Tudo certo.')$q$, t.id('mc')));
reset role;
select t.eq('apto para investidura ≠ investido: status apto_investidura, revisão aprovada por lider_a (diretoria), sem investidura, sem conquista',
  (select status from public.member_classes where id = t.id('mc')) || '|' || (select status || '/' || revisado_papel from public.investiture_reviews where snapshot_id = t.snap(2)) || '|' || (select count(*) from public.class_investitures where member_class_id = t.id('mc')) || '|' || (select count(*) from public.curriculum_achievements where usuario_id = t.id('multi_dois_papeis') and tipo = 'classe'),
  'apto_investidura|aprovado/diretoria|0|0');
-- MUDOU NA 84. Este bloco provava que, sem o conteúdo do ano, a investidura era recusada — ou seja,
-- que a virada do ano (ou um valor apagado) REABRIA um requisito já aprovado e travava a classe na
-- porta da investidura. Agora o conteúdo que a criança fez fica FIXADO no requisito na aprovação, e
-- é ele que vale na reconferência: a investidura continua reconferindo tudo AGORA (pendências,
-- escolhas, dependências), só não troca o livro que foi lido.
delete from public.dynamic_content_values where fonte_descricao = 'FIXTURE DE TESTE — não é o livro oficial';
select t.eq('sem o conteúdo do ano publicado, o I.4 JÁ APROVADO não vira bloqueado: vale o valor fixado na aprovação',
  coalesce(array_length(public._requisito_bloqueios(t.mr('amigo.I.4')), 1), 0)::text || '|' || (select (conteudo_fixado ->> 'valor') || '/' || (conteudo_fixado ->> 'fixado_no') from public.member_requirements where id = t.mr('amigo.I.4')),
  '0|Livro do Curso de Leitura do ano [DADO DE TESTE]/aprovacao');
-- (migration 84: ANO explícito e vigência fechada. O valor é o do ANO CORRENTE no Brasil — assim o
-- teste não vence na virada do ano, que era o que acontecia com as datas fixas de 2026.)
insert into public.dynamic_content_values (definicao_id, ano, valor, vigente_desde, vigente_ate, fonte_url, fonte_descricao)
select d.id, a.y, 'Livro do Curso de Leitura do ano [DADO DE TESTE]', make_date(a.y, 1, 1), make_date(a.y, 12, 31), 'https://exemplo.test/fixture', 'FIXTURE DE TESTE — não é o livro oficial'
from public.dynamic_content_definitions d, (select extract(year from public._data_no_brasil())::int as y) a where d.chave = 'curso_leitura_amigo';
select t.como('lider_a'); select t.pedir_clube('clube_a');
select t.throws('data futura é recusada', format($q$select public.investidura_registrar(%L, current_date + 1)$q$, t.id('mc')), 'inválida');
select t.permitido('investidura registrada (data, clube, quem registrou, snapshot v2)', format($q$select public.investidura_registrar(%L, current_date, 'Cerimônia [TESTE]')$q$, t.id('mc')));
select t.throws('tentativa DUPLICADA é recusada', format($q$select public.investidura_registrar(%L)$q$, t.id('mc')), 'já registrada');
reset role;
select t.eq('investida: evento de investidura com snapshot v2, registrado por lider_a (diretoria) no clube A, data de hoje; matrícula investida_em; revisão "investido"',
  (select count(*) from public.class_investitures where member_class_id = t.id('mc') and snapshot_id = t.snap(2) and registrado_por = t.id('lider_a') and registrado_papel = 'diretoria' and club_id = t.id('clube_a') and data_investidura = current_date and status = 'registrada')
  || '|' || (select status || '/' || (investida_em is not null)::text from public.member_classes where id = t.id('mc')) || '|' || (select status from public.investiture_reviews where snapshot_id = t.snap(2)) || '|' || t.eventos('investidura_registrada'),
  '1|investida/true|investido|1');
insert into t.ids (chave, id) select 'ach', id from public.curriculum_achievements where usuario_id = t.id('multi_dois_papeis') and tipo = 'classe';
select t.eq('conquista PORTÁTIL emitida na investidura: uma só, ativa, origem A, ligada ao snapshot v2', (select count(*) from public.curriculum_achievements where id = t.id('ach') and status = 'ativa' and club_id_origem = t.id('clube_a') and snapshot_id = t.snap(2) and classe_id = t.classe('amigo')), 1);
select t.eq('só uma conquista de classe (idempotente)', (select count(*) from public.curriculum_achievements where usuario_id = t.id('multi_dois_papeis') and tipo = 'classe'), 1);

-- ==================== 7) Clube B reconhece, mas não altera ====================
select t.como('lider_b'); select t.pedir_clube('clube_b');
select t.eq('lider_b VÊ a conquista, o snapshot v2 e a investidura (pessoa com vínculo ativo no B)',
  t.nv(format($q$select count(*) from public.curriculum_achievements where id = %L$q$, t.id('ach'))) * 100 + t.nv(format($q$select count(*) from public.class_completion_snapshots where id = %L$q$, t.snap(2))) * 10 + t.nv(format($q$select count(*) from public.class_investitures where snapshot_id = %L$q$, t.snap(2))), 111);
select t.eq('...e pode verificar a integridade', t.txt(format($q$select public.snapshot_verificar(%L)->>'integro'$q$, t.snap(2))), 'true');
select t.throws('lider_b NÃO revoga a conquista', format($q$select public.curriculum_achievement_revogar(%L, 'x')$q$, t.id('ach')), 'clube que emitiu');
select t.throws('lider_b NÃO revoga o snapshot', format($q$select public.snapshot_revogar(%L, 'x')$q$, t.snap(2)), 'clube que emitiu');
select t.bloqueado('lider_b NÃO edita o snapshot', format($q$update public.class_completion_snapshots set status = 'revogado' where id = %L$q$, t.snap(2)));
select t.bloqueado('lider_b NÃO edita a investidura', format($q$update public.class_investitures set data_investidura = current_date - 1 where snapshot_id = %L$q$, t.snap(2)));
reset role;
select t.eq('a regra curricular em QUALQUER clube reconhece a classe Amigo investida no A (histórico portátil)', public.curriculo_pessoa_concluiu('classe', t.id('multi_dois_papeis'), t.classe('amigo'), null), true);
select t.como('lider_b'); select t.pedir_clube('clube_b');
select t.eq('lider_b NÃO vê os eventos operacionais do A', t.nv(format($q$select count(*) from public.class_completion_events where member_class_id = %L$q$, t.id('mc'))), 0);
select t.como('membro_b');
select t.eq('membro comum do B não vê nada disso', t.nv(format($q$select count(*) from public.class_completion_snapshots where id = %L$q$, t.snap(2))) + t.nv(format($q$select count(*) from public.class_investitures where snapshot_id = %L$q$, t.snap(2))), 0);
reset role;

-- ==================== 8) avaliador/revisor perde o vínculo — a autoria histórica fica ====================
delete from public.organization_memberships where user_id = t.id('lider_a') and organizational_unit_id = t.id('clube_a');
select t.eq('lider_a saiu do clube: o snapshot v2 continua com "Lider A" como avaliador; as 27 avaliações dele existem (25 + correção + reaprovação); a investidura e a revisão continuam assinadas por ele',
  (select (r->'aprovacoes'->0->'avaliado_por'->>'nome') from public.class_completion_snapshots s, jsonb_array_elements(s.conteudo->'secoes') sec, jsonb_array_elements(sec->'requisitos') r where s.id = t.snap(2) and r->>'manifesto_id' = 'amigo.I.1')
  || '|' || (select count(*) from public.requirement_approvals a join public.member_requirements mr on mr.id = a.member_requirement_id where mr.member_class_id = t.id('mc') and a.avaliado_por = t.id('lider_a'))
  || '|' || (select (registrado_por = t.id('lider_a'))::text from public.class_investitures where snapshot_id = t.snap(2)) || '|' || (select (revisado_por = t.id('lider_a'))::text from public.investiture_reviews where snapshot_id = t.snap(2)),
  'Lider A|27|true|true');
select t.como('multi_dois_papeis');
select t.eq('...e o snapshot continua íntegro (a própria pessoa verifica)', t.txt(format($q$select public.snapshot_verificar(%L)->>'integro'$q$, t.snap(2))), 'true');
reset role;

-- ==================== 9) revogação/correção auditável — nada apagado ====================
select t.como('dir_a_membro_b'); select t.pedir_clube('clube_a');
select t.throws('revogar sem motivo é recusado', format($q$select public.snapshot_revogar(%L, '  ')$q$, t.snap(2)), 'motivo');
select t.permitido('outra diretoria do clube de ORIGEM revoga o snapshot v2 com motivo', format($q$select public.snapshot_revogar(%L, 'Erro na avaliação do I.2 — refazer.')$q$, t.snap(2)));
select t.throws('revogar de novo é recusado', format($q$select public.snapshot_revogar(%L, 'de novo')$q$, t.snap(2)), 'já está revogado');
reset role;
select t.eq('revogação em cascata AUDITADA: snapshot revogado (com autor/motivo), investidura revogada, conquista revogada, matrícula volta a em_andamento; 3 eventos',
  (select status || '/' || (revogado_por = t.id('dir_a_membro_b'))::text || '/' || revogado_motivo from public.class_completion_snapshots where id = t.snap(2)) || '|'
  || (select status from public.class_investitures where snapshot_id = t.snap(2)) || '|' || (select status from public.curriculum_achievements where id = t.id('ach')) || '|'
  || (select status from public.member_classes where id = t.id('mc')) || '|' || t.eventos('snapshot_revogado') || t.eventos('investidura_revogada') || t.eventos('conquista_revogada'),
  'revogado/true/Erro na avaliação do I.2 — refazer.|revogada|revogada|em_andamento|111');
select t.eq('NADA foi apagado: 2 snapshots, 1 investidura, 1 conquista, todas as avaliações, todos os eventos',
  (select count(*) from public.class_completion_snapshots where member_class_id = t.id('mc')) * 1000 + (select count(*) from public.class_investitures where member_class_id = t.id('mc')) * 100
  + (select count(*) from public.curriculum_achievements where usuario_id = t.id('multi_dois_papeis') and tipo = 'classe') * 10 + (select count(*) from public.class_completion_events where member_class_id = t.id('mc')) - 13, 2110);
select t.eq('o conteúdo e o hash do snapshot revogado continuam intactos (revogar ≠ editar)', t.txt(format($q$select public.snapshot_verificar(%L)->>'integro'$q$, t.snap(2))), 'true');
select t.eq('a conquista revogada deixa de satisfazer regra curricular em qualquer clube', public.curriculo_pessoa_concluiu('classe', t.id('multi_dois_papeis'), t.classe('amigo'), null), false);

select t.fim();
rollback;
