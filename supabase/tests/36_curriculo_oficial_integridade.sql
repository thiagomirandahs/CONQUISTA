-- GATE PERMANENTE de integridade curricular (fase 3): o catálogo oficial importado no banco tem
-- que ser EQUIVALENTE ao manifesto (supabase/curriculo-manifesto) — quantidade, ids, seções,
-- requisitos (texto exato), regras N-de-M/sem_repeticao, opções, conteúdo dinâmico, dependências,
-- proveniência (OMDs, documentos-base, arquivos, hash) e vigência. Se alguém editar um requisito
-- à mão no SQL (ou mexer no manifesto sem regerar a migration — `curriculo:importacao:check`), este
-- teste FALHA. No fim, ele mesmo adultera um requisito e prova que a comparação pega.
-- Não usa fixtures de pessoas: é 100% estrutural (o pacote vem de _curriculo_regular_2026.sql,
-- gerado do manifesto pelo mesmo script que gera a migration 40).
begin;
\ir _lib.sql
\ir _curriculo_regular_2026.sql

create function t.pacote() returns jsonb language sql stable as $$ select texto::jsonb from t.manifesto $$;
-- (2026.4) regulares (`classes`) + avançadas (`classes_avancadas`, seção única já como `secoes`) — o gate cobre as 12
create function t.todas() returns jsonb language sql stable as $$ select (t.pacote() -> 'classes') || coalesce(t.pacote() -> 'classes_avancadas', '[]'::jsonb) $$;
create function t.versao_id() returns uuid language sql stable as $$
  select public.curriculo_uuid('version:classes-regulares-dsa:' || (t.pacote() ->> 'manifesto_versao')) $$;

-- ==================== 0) hash: texto do pacote → sha256 → banco ====================
select t.eq('o hash gravado no fixture é o sha256 do próprio texto do pacote (o gerador não mentiu)',
  (select encode(extensions.digest(texto, 'sha256'), 'hex') = hash from t.manifesto), true);
select t.eq('existe EXATAMENTE uma curriculum_version oficial de Classes Regulares, publicada',
  (select count(*) from public.curriculum_versions where origem = 'oficial' and identificador = 'classes-regulares-dsa' and status = 'publicado'), 1);
select t.eq('...com o id determinístico da versão do manifesto', (select id from public.curriculum_versions where origem = 'oficial' and identificador = 'classes-regulares-dsa' and status = 'publicado'), t.versao_id());
select t.eq('...e fonte_hash = sha256 do pacote canônico do manifesto', (select fonte_hash from public.curriculum_versions where id = t.versao_id()), (select hash from t.manifesto));
select t.eq('...manifesto_versao/gerado_em preservados em fonte_detalhes',
  (select (fonte_detalhes ->> 'manifesto_versao') || '|' || (fonte_detalhes ->> 'gerado_em') from public.curriculum_versions where id = t.versao_id()),
  (select (t.pacote() ->> 'manifesto_versao') || '|' || (t.pacote() ->> 'gerado_em')));
select t.eq('...importado_em preenchido, importado_por nulo (migration, sem usuário), fonte_arquivo aponta pro manifesto',
  (select count(*) from public.curriculum_versions where id = t.versao_id() and importado_em is not null and importado_por is null and fonte_arquivo like 'supabase/curriculo-manifesto%'), 1);
select t.eq('vigência da versão = a última vigente_desde entre as 6 classes (2026-01-01, OMD 021/2024 obrigatória)',
  (select vigente_desde::text from public.curriculum_versions where id = t.versao_id()),
  (select max(c ->> 'vigente_desde') from jsonb_array_elements(t.pacote() -> 'classes') c));

-- ==================== 1) classes: 6, exatamente uma vez, campos iguais ====================
select t.eq('12 classes na versão oficial (6 regulares + 6 avançadas, 2026.4)', (select count(*) from public.classes where curriculum_version_id = t.versao_id()), 12);
select t.eq('...6 regulares e 6 avançadas, cada avançada pareada a uma regular diferente',
  (select count(*) filter (where tipo_classe = 'regular' and classe_regular_codigo is null) || '|' || count(*) filter (where tipo_classe = 'avancada') || '|' || count(distinct classe_regular_codigo)
     from public.classes where curriculum_version_id = t.versao_id()), '6|6|6');
select t.eq('12 manifesto_id distintos (nenhuma duplicada)', (select count(distinct manifesto_id) from public.classes where curriculum_version_id = t.versao_id()), 12);
select t.eq('só existem essas 12 classes oficiais PUBLICADAS (nenhuma outra versão publicada ao mesmo tempo)',
  (select count(*) from public.classes c join public.curriculum_versions v on v.id = c.curriculum_version_id where v.origem = 'oficial' and v.status = 'publicado'), 12);
select t.eq('avançada segue a idade da regular pareada (mesma idade_minima) e aponta pro código dela',
  (select count(*) from public.classes a join public.classes r on r.curriculum_version_id = a.curriculum_version_id and r.codigo = a.classe_regular_codigo and r.tipo_classe = 'regular'
    where a.curriculum_version_id = t.versao_id() and a.tipo_classe = 'avancada' and a.idade_minima = r.idade_minima), 6);
select t.eq('a 2026.3 (migration 106) segue no banco, ARQUIVADA, intacta: 6 regulares, 149 requisitos, nenhuma avançada',
  (select status from public.curriculum_versions where id = public.curriculo_uuid('version:classes-regulares-dsa:2026.3')) || '|' ||
  (select count(*) from public.classes where curriculum_version_id = public.curriculo_uuid('version:classes-regulares-dsa:2026.3') and tipo_classe = 'regular') || '|' ||
  (select count(*) from public.class_requirements r join public.class_sections s on s.id = r.section_id join public.classes c on c.id = s.class_id
     where c.curriculum_version_id = public.curriculo_uuid('version:classes-regulares-dsa:2026.3')), 'arquivado|6|149');
-- a versão anterior (2026.1, migration 40) NÃO foi editada nem apagada pela revisão 2026.2: está ARQUIVADA, intacta
select t.eq('a versão 2026.1 continua no banco, arquivada, com o hash original (não foi alterada silenciosamente)',
  (select status || '|' || fonte_hash from public.curriculum_versions where id = public.curriculo_uuid('version:classes-regulares-dsa:2026.1')),
  'arquivado|b2430a5117859466e581999d0633636eb4efee1e268384bd70be119be0646e53');
select t.eq('...com as 6 classes e os 149 requisitos dela intactos (inclusive o amigo.IX.1 antigo, com a opção artificial)',
  (select count(*) from public.classes where curriculum_version_id = public.curriculo_uuid('version:classes-regulares-dsa:2026.1')) * 1000
  + (select count(*) from public.class_requirements where id = public.curriculo_uuid('req:2026.1:amigo.IX.1')) * 100
  + (select count(*) from public.requirement_options where id = public.curriculo_uuid('option:2026.1:amigo.IX.1:1')) * 10
  + (select count(*) from public.class_requirements r join public.class_sections s on s.id = r.section_id join public.classes c on c.id = s.class_id
      where c.curriculum_version_id = public.curriculo_uuid('version:classes-regulares-dsa:2026.1')) - 149, 6110);
-- a 2026.2 (migration 43) também NÃO foi editada pela revisão 2026.3: arquivada, com os requisitos dela como eram (evidência 'nenhuma')
select t.eq('a versão 2026.2 continua no banco, arquivada, com 149 requisitos todos "nenhuma" (como foi importada)',
  (select status from public.curriculum_versions where id = public.curriculo_uuid('version:classes-regulares-dsa:2026.2')) || '|' ||
  (select count(*) filter (where r.tipo_evidencia = 'nenhuma' and not r.evidencia_obrigatoria) from public.class_requirements r join public.class_sections s on s.id = r.section_id join public.classes c on c.id = s.class_id
      where c.curriculum_version_id = public.curriculo_uuid('version:classes-regulares-dsa:2026.2')), 'arquivado|149');
select t.eq('as duas versões compartilham os MESMOS slots dinâmicos (curso_leitura_<classe>: 6, não 12)', (select count(*) from public.dynamic_content_definitions where chave like 'curso_leitura_%'), 6);
select t.eq('classes: manifesto → banco sem diferença (manifesto_id, nome, idade_minima, vigente_desde, fonte_url, publicado_em, id determinístico)',
  (select count(*) from (
    (select c ->> 'id', c ->> 'nome', (c ->> 'idade_minima')::int, (c ->> 'vigente_desde')::date, c -> 'fonte_base' ->> 'url', (c -> 'fonte_base' ->> 'publicado_em')::date,
            public.curriculo_uuid('class:' || (t.pacote() ->> 'manifesto_versao') || ':' || (c ->> 'id'))
       from jsonb_array_elements(t.todas()) c
     except
     select manifesto_id, nome, idade_minima, vigente_desde, fonte_url, fonte_publicado_em, id from public.classes where curriculum_version_id = t.versao_id())
    union all
    (select manifesto_id, nome, idade_minima, vigente_desde, fonte_url, fonte_publicado_em, id from public.classes where curriculum_version_id = t.versao_id()
     except
     select c ->> 'id', c ->> 'nome', (c ->> 'idade_minima')::int, (c ->> 'vigente_desde')::date, c -> 'fonte_base' ->> 'url', (c -> 'fonte_base' ->> 'publicado_em')::date,
            public.curriculo_uuid('class:' || (t.pacote() ->> 'manifesto_versao') || ':' || (c ->> 'id'))
       from jsonb_array_elements(t.todas()) c)
  ) d), 0);
select t.eq('classes: notas de proveniência preservadas (vigente_desde_nota, nota_publicado_em, cobertura, observacao_estrutural, cobertura_nota) e o pareamento da avançada',
  (select count(*) from jsonb_array_elements(t.todas()) c join public.classes cl on cl.manifesto_id = c ->> 'id' and cl.curriculum_version_id = t.versao_id()
    where cl.proveniencia is distinct from jsonb_strip_nulls(jsonb_build_object('vigente_desde_nota', c -> 'vigente_desde_nota', 'nota_publicado_em', c -> 'fonte_base' -> 'nota_publicado_em',
                                                                                'cobertura', c -> 'cobertura', 'observacao_estrutural', c -> 'observacao_estrutural', 'cobertura_nota', c -> 'cobertura_nota'))
       or cl.classe_regular_codigo is distinct from c ->> 'classe_regular_ref'
       or cl.tipo_classe <> case when c ? 'classe_regular_ref' then 'avancada' else 'regular' end), 0);
select t.eq('nenhuma classe oficial nasceu com publicado_em == vigente_desde (o carimbo da página nunca vira vigência)',
  (select count(*) from public.classes where curriculum_version_id = t.versao_id() and fonte_publicado_em = vigente_desde), 0);

-- ==================== 2) seções ====================
create view t.m_sec as
  select c ->> 'id' as classe_id, s ->> 'id' as secao_id, s ->> 'codigo' as codigo, s ->> 'nome' as nome, (s ->> 'ordem')::int as ordem
  from jsonb_array_elements(t.todas()) c, jsonb_array_elements(c -> 'secoes') s;
create view t.b_sec as
  select cl.manifesto_id as classe_id, s.manifesto_id as secao_id, s.codigo, s.nome, s.ordem
  from public.class_sections s join public.classes cl on cl.id = s.class_id where cl.curriculum_version_id = t.versao_id();
select t.eq('seções: contagem banco = manifesto', (select count(*) from t.b_sec), (select count(*) from t.m_sec));
select t.eq('seções: manifesto → banco sem diferença (classe, id, código, nome, ordem)',
  (select count(*) from ((select * from t.m_sec except select * from t.b_sec) union all (select * from t.b_sec except select * from t.m_sec)) d), 0);

-- ==================== 3) requisitos: texto EXATO, tipo, status, OMDs, observação, N-de-M, opções, pool ====================
create view t.m_req as
  select c ->> 'id' as classe_id, s ->> 'id' as secao_id, r ->> 'id' as req_id, r ->> 'codigo' as codigo, (r ->> 'ordem')::int as ordem,
         r ->> 'descricao_resumida' as descricao, coalesce(r ->> 'tipo', 'simples') as tipo, coalesce(r ->> 'status', 'CONFIRMADO') as status,
         r ->> 'alterado_por_omd' as alterado_por_omd, r ->> 'confirmado_por_omd' as confirmado_por_omd, r ->> 'observacao' as observacao,
         case when coalesce(r ->> 'tipo', 'simples') like 'escolha%' then coalesce((r -> 'escolha' ->> 'n')::int, 1) end as n_minimo,
         r -> 'escolha' -> 'opcoes' as opcoes, r ->> 'grupo_sem_repeticao' as pool,
         coalesce(r ->> 'tipo_evidencia', 'nenhuma') as tipo_evidencia,
         coalesce((r ->> 'evidencia_obrigatoria')::boolean, coalesce(r ->> 'tipo_evidencia', 'nenhuma') in ('texto', 'foto')) as evidencia_obrigatoria
  from jsonb_array_elements(t.todas()) c, jsonb_array_elements(c -> 'secoes') s, jsonb_array_elements(s -> 'requisitos') r;
create view t.b_req as
  select cl.manifesto_id as classe_id, s.manifesto_id as secao_id, r.manifesto_id as req_id, r.codigo, r.ordem, r.descricao,
         case when r.conteudo_dinamico_definicao_id is not null then 'anual_dinamico'
              when g.id is not null and g.sem_repeticao then 'escolha_n_de_m_sem_repeticao'
              when g.id is not null then 'escolha_n_de_m' else 'simples' end as tipo,
         r.status_fonte as status, r.alterado_por_omd, r.confirmado_por_omd, r.observacao_fonte as observacao,
         g.n_minimo, (select jsonb_agg(o.rotulo order by o.ordem) from public.requirement_options o where o.grupo_id = g.id) as opcoes, g.pool_sem_repeticao as pool,
         r.tipo_evidencia, r.evidencia_obrigatoria
  from public.class_requirements r
  join public.class_sections s on s.id = r.section_id
  join public.classes cl on cl.id = s.class_id
  left join public.requirement_option_groups g on g.alvo_tipo = 'class_requirement' and g.alvo_id = r.id
  where cl.curriculum_version_id = t.versao_id();
create function t.divergencias_req() returns bigint language sql stable as $$
  select count(*) from ((select * from t.m_req except select * from t.b_req) union all (select * from t.b_req except select * from t.m_req)) d $$;

select t.eq('requisitos: contagem banco = manifesto (212)', (select count(*) from t.b_req), (select count(*) from t.m_req));
select t.eq('requisitos: 149 nas 6 Regulares (o número da fase 2.5) + 63 nas 6 Avançadas (9+12+11+10+11+10, página oficial)',
  (select count(*) filter (where classe_id in (select x ->> 'id' from jsonb_array_elements(t.pacote() -> 'classes') x)) || '|' || count(*) from t.m_req), '149|212');
select t.eq('requisitos: manifesto → banco SEM diferença (texto exato, tipo, status, OMDs, observação, n, opções em ordem, pool, tipo_evidencia, obrigatoriedade)', t.divergencias_req(), 0);
select t.eq('requisitos: ids determinísticos (req:<versão>:<manifesto_id>)',
  (select count(*) from public.class_requirements r join public.class_sections s on s.id = r.section_id join public.classes cl on cl.id = s.class_id
    where cl.curriculum_version_id = t.versao_id() and r.id <> public.curriculo_uuid('req:' || (t.pacote() ->> 'manifesto_versao') || ':' || r.manifesto_id)), 0);
select t.eq('requisitos: todos ativos, tipo_evidencia só nenhuma/texto/foto, obrigatória exatamente quando é texto/foto (2026.3, migration 105)',
  (select count(*) from public.class_requirements r join public.class_sections s on s.id = r.section_id join public.classes cl on cl.id = s.class_id
    where cl.curriculum_version_id = t.versao_id()
      and not (r.ativo and r.tipo_evidencia in ('nenhuma', 'texto', 'foto') and r.evidencia_obrigatoria = (r.tipo_evidencia in ('texto', 'foto')))), 0);
select t.eq('requisitos: o desbravador consegue comprovar — há requisitos de texto E de foto em cada uma das 6 classes',
  (select count(*) from (select cl.id from public.classes cl join public.class_sections s on s.class_id = cl.id join public.class_requirements r on r.section_id = s.id
    where cl.curriculum_version_id = t.versao_id() and cl.tipo_classe = 'regular' group by cl.id
    having count(*) filter (where r.tipo_evidencia = 'texto') > 0 and count(*) filter (where r.tipo_evidencia = 'foto') > 0) x), 6);
select t.eq('a produção escrita não ficou "nenhuma": toda redação/relatório/diário do manifesto é texto',
  (select count(*) from t.b_req where descricao ~* '(redação|relatório|diário)' and tipo_evidencia = 'nenhuma'), 0);
select t.eq('nenhum requisito oficial PENDENTE (status_fonte só CONFIRMADO/ALTERADO_POR_OMD)',
  (select count(*) from t.b_req where status not in ('CONFIRMADO', 'ALTERADO_POR_OMD')), 0);
select t.eq('requisitos ALTERADO_POR_OMD: mesma contagem do relatório de cobertura (regulares + avançadas)', (select count(*) from t.b_req where status = 'ALTERADO_POR_OMD'),
  (select count(*) from t.m_req where status = 'ALTERADO_POR_OMD'));

-- ==================== 4) regras: N-de-M / sem_repeticao / dinâmico ====================
select t.eq('grupos N-de-M: um por requisito de escolha, nenhum a mais',
  (select count(*) from public.requirement_option_groups g join public.class_requirements r on r.id = g.alvo_id and g.alvo_tipo = 'class_requirement'
     join public.class_sections s on s.id = r.section_id join public.classes cl on cl.id = s.class_id where cl.curriculum_version_id = t.versao_id()),
  (select count(*) from t.m_req where tipo like 'escolha%'));
select t.eq('opções: contagem banco = manifesto', (select count(*) from t.b_req b, jsonb_array_elements(b.opcoes) where b.opcoes is not null), (select sum(jsonb_array_length(opcoes)) from t.m_req where opcoes is not null));
select t.eq('sem_repeticao: todo requisito escolha_n_de_m_sem_repeticao virou grupo sem_repeticao=true com o pool do manifesto (e nenhum outro)',
  (select count(*) from t.b_req where (tipo = 'escolha_n_de_m_sem_repeticao') <> (pool is not null)), 0);
select t.eq('dinâmico: todo requisito anual referencia o slot curso_leitura_<classe> — e NENHUM outro referencia slot',
  (select count(*) from public.class_requirements r join public.class_sections s on s.id = r.section_id join public.classes cl on cl.id = s.class_id
     left join public.dynamic_content_definitions d on d.id = r.conteudo_dinamico_definicao_id
    where cl.curriculum_version_id = t.versao_id()
      and ((r.manifesto_id in (select req_id from t.m_req where tipo = 'anual_dinamico')) <> (d.chave = 'curso_leitura_' || cl.manifesto_id))), 0);
select t.eq('dinâmico: nenhum "2026" materializado no texto de requisito anual, e nenhum valor anual cadastrado pela importação (o ano entra depois, com fonte)',
  (select count(*) from t.b_req where tipo = 'anual_dinamico' and descricao ~ '20[0-9][0-9]')
  + (select count(*) from public.dynamic_content_values v join public.dynamic_content_definitions d on d.id = v.definicao_id where d.chave like 'curso_leitura_%'), 0);
select t.eq('dependências: exatamente 6, uma por avançada → a regular pareada da MESMA versão, obrigatória, modo iniciada_ou_concluida',
  (select count(*) from public.curriculum_dependencies dep
     join public.classes a on a.id = dep.alvo_id join public.classes r on r.id = dep.depende_de_id
    where dep.alvo_tipo = 'class' and dep.depende_de_tipo = 'class' and dep.obrigatorio and dep.modo = 'iniciada_ou_concluida'
      and a.curriculum_version_id = t.versao_id() and r.curriculum_version_id = t.versao_id()
      and a.tipo_classe = 'avancada' and r.tipo_classe = 'regular' and r.codigo = a.classe_regular_codigo), 6);
select t.eq('dependências: nenhuma outra aponta pras classes/requisitos oficiais (regular não depende de nada; requisito não depende de nada)',
  (select count(*) from public.curriculum_dependencies dep
    where (dep.alvo_tipo = 'class' and dep.alvo_id in (select id from public.classes where curriculum_version_id = t.versao_id() and tipo_classe = 'regular'))
       or (dep.alvo_tipo = 'class_requirement' and dep.alvo_id in (select r.id from public.class_requirements r join public.class_sections s on s.id = r.section_id join public.classes cl on cl.id = s.class_id where cl.curriculum_version_id = t.versao_id()))
       or (dep.depende_de_tipo = 'class' and dep.depende_de_id in (select id from public.classes where curriculum_version_id = t.versao_id() and tipo_classe = 'avancada'))), 0);
select t.eq('Pesquisador de Campo e Bosque item 11 publicado como a página viva mostra (sem_repeticao, 4 áreas, OMD 007/2014 = exclusão simples)',
  (select tipo || '|' || status || '|' || alterado_por_omd || '|' || jsonb_array_length(opcoes) from t.b_req where req_id = 'pesquisador_de_campo_e_bosque.11'),
  'escolha_n_de_m_sem_repeticao|ALTERADO_POR_OMD|OMD-007-2014|4');
select t.eq('prazo: nenhuma classe oficial ganhou prazo (a fonte não determina)', (select count(*) from public.classes where curriculum_version_id = t.versao_id() and (prazo_minimo_dias is not null or prazo_maximo_dias is not null)), 0);

-- ==================== 5) proveniência: OMDs, documentos-base, arquivos ====================
select t.eq('toda OMD citada por requisito existe em fonte_detalhes.omds com status CONFIRMADO e URL',
  (select count(*) from (select alterado_por_omd as ref from t.b_req union select confirmado_por_omd from t.b_req) x
    where x.ref is not null and not exists (
      select 1 from public.curriculum_versions v, jsonb_array_elements(v.fonte_detalhes -> 'omds') o
      where v.id = t.versao_id() and o ->> 'id' = x.ref and o ->> 'status' = 'CONFIRMADO' and coalesce(o ->> 'url', '') <> '')), 0);
select t.eq('a OMD 022/2026 (pendente) está no registro só pra rastreabilidade — e NENHUM requisito a cita',
  (select count(*) from public.curriculum_versions v, jsonb_array_elements(v.fonte_detalhes -> 'omds') o where v.id = t.versao_id() and o ->> 'id' = 'OMD-022-2026' and o ->> 'status' = 'PENDENTE_DE_VALIDACAO') * 10
  + (select count(*) from t.b_req where 'OMD-022-2026' in (alterado_por_omd, confirmado_por_omd)), 10);
select t.eq('documentos_base_avancadas: as 6 avançadas, cada uma com a página oficial e a regular pareada',
  (select count(*) from public.curriculum_versions v, jsonb_array_elements(v.fonte_detalhes -> 'documentos_base_avancadas') d
     join jsonb_array_elements(t.pacote() -> 'classes_avancadas') c on c ->> 'id' = d ->> 'classe'
    where v.id = t.versao_id() and d ->> 'url' = c -> 'fonte_base' ->> 'url' and d ->> 'regular' = c ->> 'classe_regular_ref'), 6);
select t.eq('documentos_base: 6 páginas oficiais (uma por classe regular), iguais às fonte_base do manifesto',
  (select count(*) from public.curriculum_versions v, jsonb_array_elements(v.fonte_detalhes -> 'documentos_base') d
     join jsonb_array_elements(t.pacote() -> 'classes') c on c ->> 'id' = d ->> 'classe'
    where v.id = t.versao_id() and d ->> 'url' = c -> 'fonte_base' ->> 'url' and d ->> 'publicado_em' = c -> 'fonte_base' ->> 'publicado_em'), 6);
select t.eq('arquivos: 7 arquivos do manifesto (omds.json + 6 classes) com sha256 individual',
  (select count(*) from public.curriculum_versions v, jsonb_array_elements(v.fonte_detalhes -> 'arquivos') a where v.id = t.versao_id() and a ->> 'sha256' ~ '^[0-9a-f]{64}$' and a ->> 'arquivo' like 'supabase/curriculo-manifesto/%'), 7);
select t.eq('fonte_detalhes = o que está no pacote (omds e arquivos idênticos)',
  (select (fonte_detalhes -> 'omds' = t.pacote() -> 'omds') and (fonte_detalhes -> 'arquivos' = t.pacote() -> 'arquivos') from public.curriculum_versions where id = t.versao_id()), true);

-- ==================== 6) idempotência: rodar a importação de novo não duplica nada ====================
select t.eq('reimportar o MESMO pacote é no-op (ja_importado=true)',
  (select (public.curriculo_importar_classes_regulares(texto::jsonb, hash) ->> 'ja_importado')::boolean from t.manifesto), true);
select t.eq('...e continua tudo igual (212 requisitos, 12 classes, 0 divergências)',
  (select count(*) from t.b_req) * 100 + (select count(*) from public.classes where curriculum_version_id = t.versao_id()) * 10 + t.divergencias_req(), 21320);
select t.throws('o MESMO manifesto_versao com conteúdo diferente é RECUSADO (versão publicada nunca é editada)',
  (select format($q$select public.curriculo_importar_classes_regulares(%L::jsonb, %L)$q$, jsonb_set(texto::jsonb, '{classes,0,nome}', '"Amigo editado"'), repeat('0', 64)) from t.manifesto), 'outro conteúdo');

-- ==================== 7) o gate morde: adulterar o banco à mão é detectado ====================
update public.class_requirements set descricao = descricao || ' (editado à mão)' where id = public.curriculo_uuid('req:' || (t.pacote() ->> 'manifesto_versao') || ':companheiro.I.5');
select t.eq('editar o texto de UM requisito no SQL gera divergência (2 linhas: a do manifesto sem par + a do banco sem par)', t.divergencias_req(), 2);
delete from public.requirement_options where id = public.curriculo_uuid('option:' || (t.pacote() ->> 'manifesto_versao') || ':amigo.V.1:4');
select t.eq('apagar UMA opção de escolha também é detectado', t.divergencias_req(), 4);
update public.requirement_option_groups set sem_repeticao = false where id = public.curriculo_uuid('group:' || (t.pacote() ->> 'manifesto_versao') || ':companheiro.IX.1');
select t.eq('desligar sem_repeticao de um grupo também é detectado', t.divergencias_req(), 6);

select t.fim();
rollback;
