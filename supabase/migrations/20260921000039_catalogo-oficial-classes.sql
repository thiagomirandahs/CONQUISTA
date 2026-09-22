-- =====================================================================
-- Catálogo oficial de Classes — fase 3, parte 1 (o MOTOR de importação). Rodar DEPOIS da
-- 20260921000038. Idempotente. NÃO importa conteúdo: a importação de verdade é a migration
-- 20260921000040, GERADA por supabase/curriculo-manifesto/gerar-importacao.mjs a partir do
-- manifesto validado (única fonte — nada é recopiado à mão pra SQL/React, nem raspado da web).
--
-- O que esta migration adiciona:
--   A) Proveniência no catálogo: curriculum_versions.fonte_detalhes (documentos-base, OMDs,
--      arquivos + sha256), classes.{manifesto_id, idade_minima, vigente_desde, fonte_url,
--      fonte_publicado_em, proveniencia}, class_sections.manifesto_id, class_requirements.
--      {manifesto_id, status_fonte, alterado_por_omd, confirmado_por_omd, observacao_fonte},
--      requirement_option_groups.pool_sem_repeticao. Cada requisito exibido continua rastreável
--      até o manifesto/OMD/página oficial — requisito_origem() devolve isso pra auditoria.
--   B) curriculo_uuid(chave): ids DETERMINÍSTICOS (md5 de "versão:item do manifesto") — rodar a
--      importação de novo com o mesmo manifesto não duplica nada; conteúdo diferente com a mesma
--      versão é RECUSADO (versão publicada nunca é editada).
--   C) curriculo_importar_classes_regulares(pacote, hash): converte o manifesto pro schema das
--      migrations 36/38 SEM alterar texto nem semântica — e FALHA (não aproxima) em qualquer
--      chave desconhecida, tipo desconhecido, status pendente, OMD não confirmada, escolha
--      inválida ou classe fora das 6 Regulares. Anual/dinâmico vira referência ao slot
--      (dynamic_content_definitions) — nunca "2026" materializado; N-de-M e sem_repeticao viram
--      requirement_option_groups/requirement_options (migration 38). Não cria progresso pra ninguém.
--   D) [PILOTO/TESTE] preservado, mas INVISÍVEL no fluxo normal quando existe catálogo oficial
--      publicado do mesmo tipo (listagem e RPCs de iniciar/atribuir).
--   E) Elegibilidade SÓ com respaldo no manifesto: idade_minima (o único critério que a fonte
--      declara). Nenhuma sequência/pré-requisito inventado.
--   F) minha_classe() passa a entregar escolha (grupo/opções/sem_repeticao/contagem) e conteúdo
--      dinâmico resolvido pra hoje — tudo do banco; requisito_origem() pra "Origem do requisito".
-- =====================================================================

-- ---------------------------------------------------------------------
-- A) proveniência
-- ---------------------------------------------------------------------
alter table public.curriculum_versions add column if not exists fonte_detalhes jsonb;

alter table public.classes
  add column if not exists manifesto_id text,
  add column if not exists idade_minima int check (idade_minima is null or idade_minima >= 0),
  add column if not exists vigente_desde date,
  add column if not exists fonte_url text,
  add column if not exists fonte_publicado_em date,
  add column if not exists proveniencia jsonb;
create unique index if not exists ux_classes_manifesto_id on public.classes (curriculum_version_id, manifesto_id) where manifesto_id is not null;

alter table public.class_sections add column if not exists manifesto_id text;

alter table public.class_requirements
  add column if not exists manifesto_id text,
  add column if not exists status_fonte text check (status_fonte is null or status_fonte in ('CONFIRMADO', 'ALTERADO_POR_OMD')),
  add column if not exists alterado_por_omd text,
  add column if not exists confirmado_por_omd text,
  add column if not exists observacao_fonte text;
create index if not exists idx_class_requirements_manifesto_id on public.class_requirements (manifesto_id) where manifesto_id is not null;

alter table public.requirement_option_groups add column if not exists pool_sem_repeticao text;

-- ---------------------------------------------------------------------
-- B) ids determinísticos
-- ---------------------------------------------------------------------
create or replace function public.curriculo_uuid(p_chave text) returns uuid
language sql immutable strict as $$ select md5('cq-curriculo-oficial:' || p_chave)::uuid $$;
revoke all on function public.curriculo_uuid(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- C) importador (só migration/SQL; nenhum papel da API executa)
-- ---------------------------------------------------------------------
create or replace function public._curriculo_exigir_chaves(p_obj jsonb, p_permitidas text[], p_onde text) returns void
language plpgsql immutable as $$
declare v_extras text;
begin
  if jsonb_typeof(p_obj) <> 'object' then raise exception 'Importação: % não é um objeto.', p_onde; end if;
  select string_agg(k, ', ' order by k) into v_extras from jsonb_object_keys(p_obj) k where k <> all (p_permitidas);
  if v_extras is not null then
    raise exception 'Importação: % tem chave(s) que o schema não representa (%): recusado, não aproximado.', p_onde, v_extras;
  end if;
end;
$$;
revoke all on function public._curriculo_exigir_chaves(jsonb, text[], text) from public, anon, authenticated;

create or replace function public.curriculo_importar_classes_regulares(p_pacote jsonb, p_hash text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_versao_txt text := p_pacote ->> 'manifesto_versao';
  v_gerado_em date := (p_pacote ->> 'gerado_em')::date;
  v_omds jsonb := p_pacote -> 'omds';
  v_classes jsonb := p_pacote -> 'classes';
  v_ids_esperados text[] := array['amigo', 'companheiro', 'excursionista', 'guia', 'pesquisador', 'pioneiro'];
  v_ids_recebidos text[];
  v_ver_id uuid; v_ver record; v_vigente_desde date;
  c jsonb; s jsonb; r jsonb; v_omd jsonb;
  v_class_id uuid; v_sec_id uuid; v_req_id uuid; v_grp_id uuid; v_def_id uuid;
  v_tipo text; v_status text; v_lacuna text; v_ref text; v_chave text; v_n int; v_opcoes jsonb; i int;
  v_n_classes int := 0; v_n_secoes int := 0; v_n_reqs int := 0; v_n_grupos int := 0; v_n_opcoes int := 0; v_n_dinamicos int := 0;
begin
  if v_versao_txt is null or v_gerado_em is null or jsonb_typeof(v_omds) <> 'array' or jsonb_typeof(v_classes) <> 'array' then
    raise exception 'Importação: pacote inválido (manifesto_versao, gerado_em, omds e classes são obrigatórios).';
  end if;
  if p_hash !~ '^[0-9a-f]{64}$' then raise exception 'Importação: hash sha256 inválido.'; end if;
  perform public._curriculo_exigir_chaves(p_pacote, array['manifesto_versao', 'gerado_em', 'arquivos', 'omds', 'classes'], 'o pacote');

  select array_agg(x ->> 'id' order by x ->> 'id') into v_ids_recebidos from jsonb_array_elements(v_classes) x;
  if v_ids_recebidos is distinct from v_ids_esperados then
    raise exception 'Importação: esperadas exatamente as 6 Classes Regulares (%); recebido: %.', array_to_string(v_ids_esperados, ', '), array_to_string(coalesce(v_ids_recebidos, '{}'), ', ');
  end if;

  -- versão publicada nunca é editada: mesmo hash = no-op; hash diferente = versão nova obrigatória
  v_ver_id := public.curriculo_uuid('version:classes-regulares-dsa:' || v_versao_txt);
  select * into v_ver from public.curriculum_versions where id = v_ver_id;
  if found then
    if v_ver.fonte_hash = p_hash then
      return jsonb_build_object('ok', true, 'ja_importado', true, 'curriculum_version_id', v_ver_id, 'fonte_hash', p_hash);
    end if;
    raise exception 'Importação: a versão % já existe com outro conteúdo (hash % ≠ %). Uma versão publicada nunca é editada — gere uma versão nova do manifesto.', v_versao_txt, v_ver.fonte_hash, p_hash;
  end if;

  -- vigência da VERSÃO: quando a última das 6 passou a valer (a partir daí todas estão em vigor)
  select max((x ->> 'vigente_desde')::date) into v_vigente_desde from jsonb_array_elements(v_classes) x;
  if v_vigente_desde is null then raise exception 'Importação: classe sem vigente_desde.'; end if;

  insert into public.curriculum_versions (id, origem, identificador, versao, vigente_desde, status, fonte_url, fonte_descricao, fonte_hash, fonte_arquivo, importado_em, importado_por, fonte_detalhes)
  values (
    v_ver_id, 'oficial', 'classes-regulares-dsa', v_versao_txt, v_vigente_desde, 'publicado', null,
    'Classes Regulares de Desbravadores (DSA) — Amigo, Companheiro, Pesquisador, Pioneiro, Excursionista e Guia — currículo regular vigente em '
      || extract(year from v_vigente_desde)::int || '. Importado do manifesto curricular ' || v_versao_txt
      || ' (supabase/curriculo-manifesto, gerado em ' || v_gerado_em || '), por migration; proveniência completa em fonte_detalhes.',
    p_hash,
    'supabase/curriculo-manifesto: omds.json + classes/{amigo,companheiro,pesquisador,pioneiro,excursionista,guia}.json (só classe_regular)',
    now(), null,
    jsonb_build_object(
      'manifesto_versao', v_versao_txt, 'gerado_em', v_gerado_em, 'arquivos', p_pacote -> 'arquivos', 'omds', v_omds,
      'documentos_base', (select jsonb_agg(jsonb_build_object('classe', x ->> 'id', 'url', x -> 'fonte_base' ->> 'url', 'publicado_em', x -> 'fonte_base' ->> 'publicado_em') order by x ->> 'id')
                          from jsonb_array_elements(v_classes) x)
    )
  );

  for c in select x from jsonb_array_elements(v_classes) x order by x ->> 'id' loop
    perform public._curriculo_exigir_chaves(c, array['id', 'nome', 'idade_minima', 'fonte_base', 'vigente_desde', 'vigente_desde_nota', 'secoes', 'cobertura', 'observacao_estrutural'], 'a classe ' || (c ->> 'id'));
    perform public._curriculo_exigir_chaves(c -> 'fonte_base', array['url', 'publicado_em', 'nota_publicado_em'], 'fonte_base de ' || (c ->> 'id'));
    if coalesce(c ->> 'nome', '') = '' or coalesce(c -> 'fonte_base' ->> 'url', '') = '' or c ->> 'vigente_desde' is null
       or jsonb_typeof(c -> 'idade_minima') <> 'number' or jsonb_typeof(c -> 'secoes') <> 'array' or jsonb_array_length(c -> 'secoes') = 0 then
      raise exception 'Importação: classe % incompleta (nome, fonte_base.url, vigente_desde, idade_minima numérica e seções são obrigatórios).', c ->> 'id';
    end if;
    v_class_id := public.curriculo_uuid('class:' || v_versao_txt || ':' || (c ->> 'id'));
    insert into public.classes (id, curriculum_version_id, codigo, nome, faixa_etaria, ordem, ativo, manifesto_id, idade_minima, vigente_desde, fonte_url, fonte_publicado_em, proveniencia)
    values (v_class_id, v_ver_id, c ->> 'id', c ->> 'nome', null, (c ->> 'idade_minima')::int, true, c ->> 'id', (c ->> 'idade_minima')::int,
            (c ->> 'vigente_desde')::date, c -> 'fonte_base' ->> 'url', (c -> 'fonte_base' ->> 'publicado_em')::date,
            jsonb_strip_nulls(jsonb_build_object('vigente_desde_nota', c -> 'vigente_desde_nota', 'nota_publicado_em', c -> 'fonte_base' -> 'nota_publicado_em',
                                                 'cobertura', c -> 'cobertura', 'observacao_estrutural', c -> 'observacao_estrutural')));
    v_n_classes := v_n_classes + 1;

    for s in select x from jsonb_array_elements(c -> 'secoes') x loop
      perform public._curriculo_exigir_chaves(s, array['id', 'codigo', 'nome', 'ordem', 'requisitos'], 'a seção ' || (s ->> 'id'));
      if coalesce(s ->> 'id', '') = '' or coalesce(s ->> 'codigo', '') = '' or coalesce(s ->> 'nome', '') = '' or jsonb_typeof(s -> 'ordem') <> 'number'
         or jsonb_typeof(s -> 'requisitos') <> 'array' then
        raise exception 'Importação: seção % incompleta.', s ->> 'id';
      end if;
      v_sec_id := public.curriculo_uuid('section:' || v_versao_txt || ':' || (s ->> 'id'));
      insert into public.class_sections (id, class_id, codigo, nome, ordem, manifesto_id)
      values (v_sec_id, v_class_id, s ->> 'codigo', s ->> 'nome', (s ->> 'ordem')::int, s ->> 'id');
      v_n_secoes := v_n_secoes + 1;

      for r in select x from jsonb_array_elements(s -> 'requisitos') x loop
        perform public._curriculo_exigir_chaves(r, array['id', 'codigo', 'ordem', 'descricao_resumida', 'tipo', 'lacuna_schema', 'observacao', 'status',
                                                          'alterado_por_omd', 'confirmado_por_omd', 'escolha', 'grupo_sem_repeticao'], 'o requisito ' || (r ->> 'id'));
        if coalesce(r ->> 'id', '') = '' or coalesce(r ->> 'codigo', '') = '' or coalesce(r ->> 'descricao_resumida', '') = '' or jsonb_typeof(r -> 'ordem') <> 'number' then
          raise exception 'Importação: requisito % incompleto (id, codigo, ordem, descricao_resumida).', r ->> 'id';
        end if;
        v_tipo := coalesce(r ->> 'tipo', 'simples');
        v_status := coalesce(r ->> 'status', 'CONFIRMADO');
        v_lacuna := r ->> 'lacuna_schema';
        if v_tipo not in ('simples', 'anual_dinamico', 'escolha_n_de_m', 'escolha_n_de_m_sem_repeticao') then
          raise exception 'Importação: requisito % com tipo "%" que o schema não representa.', r ->> 'id', v_tipo;
        end if;
        if v_status = 'PENDENTE_DE_VALIDACAO' then
          raise exception 'Importação: requisito % está PENDENTE_DE_VALIDACAO — não pode ser publicado.', r ->> 'id';
        end if;
        if v_status not in ('CONFIRMADO', 'ALTERADO_POR_OMD') then
          raise exception 'Importação: requisito % com status "%" desconhecido.', r ->> 'id', v_status;
        end if;
        if v_status = 'ALTERADO_POR_OMD' and r ->> 'alterado_por_omd' is null then
          raise exception 'Importação: requisito % ALTERADO_POR_OMD sem alterado_por_omd.', r ->> 'id';
        end if;
        if r ? 'proveniencia_pendente' then raise exception 'Importação: requisito % com pendência.', r ->> 'id'; end if;
        -- coerência tipo × lacuna_schema (a marca do manifesto tem que bater com o mecanismo usado)
        if (v_tipo = 'anual_dinamico' and v_lacuna is distinct from 'requisito_anual_dinamico')
           or (v_tipo = 'escolha_n_de_m' and v_lacuna is distinct from 'escolha_n_de_m')
           or (v_tipo = 'escolha_n_de_m_sem_repeticao' and v_lacuna is distinct from 'escolha_sem_repeticao')
           or (v_tipo = 'simples' and v_lacuna is not null) then
          raise exception 'Importação: requisito % — tipo "%" incompatível com lacuna_schema "%".', r ->> 'id', v_tipo, coalesce(v_lacuna, '(nenhuma)');
        end if;
        -- OMDs referenciadas: precisam existir no registro do pacote e estar CONFIRMADO
        foreach v_ref in array array_remove(array[r ->> 'alterado_por_omd', r ->> 'confirmado_por_omd'], null) loop
          select x into v_omd from jsonb_array_elements(v_omds) x where x ->> 'id' = v_ref;
          if v_omd is null then raise exception 'Importação: requisito % referencia OMD % ausente do registro.', r ->> 'id', v_ref; end if;
          if v_omd ->> 'status' <> 'CONFIRMADO' then
            raise exception 'Importação: requisito % apoiado na OMD % (status %) — só OMD CONFIRMADO pode sustentar um requisito publicado.', r ->> 'id', v_ref, v_omd ->> 'status';
          end if;
        end loop;

        v_req_id := public.curriculo_uuid('req:' || v_versao_txt || ':' || (r ->> 'id'));
        v_def_id := null;
        if v_tipo = 'anual_dinamico' then
          if r ? 'escolha' or r ? 'grupo_sem_repeticao' then raise exception 'Importação: requisito % anual com escolha.', r ->> 'id'; end if;
          -- o slot é POR CLASSE e independe da versão (o "Curso de Leitura do ano" de Amigo é um conceito
          -- que persiste entre versões da classe); o valor de cada ano entra depois, com fonte, em
          -- dynamic_content_values — nunca materializado aqui
          v_chave := 'curso_leitura_' || (c ->> 'id');
          insert into public.dynamic_content_definitions (id, chave, nome, descricao)
          values (public.curriculo_uuid('dyn:' || v_chave), v_chave, 'Curso de Leitura do ano — ' || (c ->> 'nome'),
                  'Livro do Curso de Leitura do ano civil para a classe ' || (c ->> 'nome') || '. Cadastrar um valor por ano (com fonte) em dynamic_content_values.')
          on conflict (chave) do nothing;
          select id into v_def_id from public.dynamic_content_definitions where chave = v_chave;
          v_n_dinamicos := v_n_dinamicos + 1;
        end if;

        insert into public.class_requirements (id, section_id, codigo, descricao, tipo_evidencia, evidencia_obrigatoria, ordem, ativo, conteudo_dinamico_definicao_id,
                                               manifesto_id, status_fonte, alterado_por_omd, confirmado_por_omd, observacao_fonte)
        values (v_req_id, v_sec_id, r ->> 'codigo', r ->> 'descricao_resumida', 'nenhuma', false, (r ->> 'ordem')::int, true, v_def_id,
                r ->> 'id', v_status, r ->> 'alterado_por_omd', r ->> 'confirmado_por_omd', r ->> 'observacao');
        v_n_reqs := v_n_reqs + 1;

        if v_tipo in ('escolha_n_de_m', 'escolha_n_de_m_sem_repeticao') then
          v_opcoes := null; v_n := 1;
          if r ? 'escolha' then
            perform public._curriculo_exigir_chaves(r -> 'escolha', array['n', 'opcoes'], 'escolha de ' || (r ->> 'id'));
            if jsonb_typeof(r -> 'escolha' -> 'n') <> 'number' or jsonb_typeof(r -> 'escolha' -> 'opcoes') <> 'array' or jsonb_array_length(r -> 'escolha' -> 'opcoes') = 0 then
              raise exception 'Importação: requisito % com escolha inválida (n numérico e opções não vazias).', r ->> 'id';
            end if;
            v_n := (r -> 'escolha' ->> 'n')::int; v_opcoes := r -> 'escolha' -> 'opcoes';
            if v_n < 1 or v_n > jsonb_array_length(v_opcoes) then raise exception 'Importação: requisito % com n=% fora de 1..%.', r ->> 'id', v_n, jsonb_array_length(v_opcoes); end if;
          elsif v_tipo = 'escolha_n_de_m' then
            raise exception 'Importação: requisito % é escolha_n_de_m sem bloco escolha.', r ->> 'id';
          end if;
          if v_tipo = 'escolha_n_de_m_sem_repeticao' and coalesce(r ->> 'grupo_sem_repeticao', '') = '' then
            raise exception 'Importação: requisito % sem_repeticao sem grupo_sem_repeticao (o pool).', r ->> 'id';
          end if;
          if v_tipo = 'escolha_n_de_m' and r ? 'grupo_sem_repeticao' then
            raise exception 'Importação: requisito % escolha_n_de_m com grupo_sem_repeticao.', r ->> 'id';
          end if;
          v_grp_id := public.curriculo_uuid('group:' || v_versao_txt || ':' || (r ->> 'id'));
          insert into public.requirement_option_groups (id, alvo_tipo, alvo_id, n_minimo, sem_repeticao, pool_sem_repeticao)
          values (v_grp_id, 'class_requirement', v_req_id, v_n, v_tipo = 'escolha_n_de_m_sem_repeticao', r ->> 'grupo_sem_repeticao');
          v_n_grupos := v_n_grupos + 1;
          if v_opcoes is not null then
            for i in 0 .. jsonb_array_length(v_opcoes) - 1 loop
              if jsonb_typeof(v_opcoes -> i) <> 'string' or coalesce(v_opcoes ->> i, '') = '' then raise exception 'Importação: requisito % com opção não textual.', r ->> 'id'; end if;
              insert into public.requirement_options (id, grupo_id, rotulo, specialty_id, ordem)
              values (public.curriculo_uuid('option:' || v_versao_txt || ':' || (r ->> 'id') || ':' || (i + 1)), v_grp_id, v_opcoes ->> i, null, (i + 1) * 10);
              v_n_opcoes := v_n_opcoes + 1;
            end loop;
          end if;
        elsif r ? 'escolha' or r ? 'grupo_sem_repeticao' then
          raise exception 'Importação: requisito % (tipo %) carrega escolha/grupo_sem_repeticao.', r ->> 'id', v_tipo;
        end if;
      end loop;
    end loop;
  end loop;

  return jsonb_build_object('ok', true, 'ja_importado', false, 'curriculum_version_id', v_ver_id, 'fonte_hash', p_hash, 'manifesto_versao', v_versao_txt,
    'classes', v_n_classes, 'secoes', v_n_secoes, 'requisitos', v_n_reqs, 'grupos_n_de_m', v_n_grupos, 'opcoes', v_n_opcoes, 'requisitos_dinamicos', v_n_dinamicos);
end;
$$;
revoke all on function public.curriculo_importar_classes_regulares(jsonb, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- D) piloto invisível no fluxo normal quando existe catálogo oficial do mesmo tipo
-- ---------------------------------------------------------------------
create or replace function public.catalogo_oficial_publicado(p_tipo text) returns boolean
language sql stable security definer set search_path = '' as $$
  select case p_tipo
    when 'class' then exists (select 1 from public.classes c join public.curriculum_versions v on v.id = c.curriculum_version_id where v.origem = 'oficial' and v.status = 'publicado' and c.ativo)
    when 'specialty' then exists (select 1 from public.specialties s join public.curriculum_versions v on v.id = s.curriculum_version_id where v.origem = 'oficial' and v.status = 'publicado' and s.ativo)
    else false end;
$$;
revoke all on function public.catalogo_oficial_publicado(text) from public, anon, authenticated;

-- publicada E no fluxo normal (piloto só enquanto não há oficial)
create or replace function public._classe_no_fluxo_normal(p_class_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.classe_esta_publicada(p_class_id) and exists (
    select 1 from public.classes c join public.curriculum_versions v on v.id = c.curriculum_version_id
    where c.id = p_class_id and (v.origem <> 'piloto_teste' or not public.catalogo_oficial_publicado('class'))
  );
$$;
revoke all on function public._classe_no_fluxo_normal(uuid) from public, anon, authenticated;

create or replace function public._especialidade_no_fluxo_normal(p_specialty_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.especialidade_esta_publicada(p_specialty_id) and exists (
    select 1 from public.specialties s join public.curriculum_versions v on v.id = s.curriculum_version_id
    where s.id = p_specialty_id and (v.origem <> 'piloto_teste' or not public.catalogo_oficial_publicado('specialty'))
  );
$$;
revoke all on function public._especialidade_no_fluxo_normal(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- E) elegibilidade — SÓ o que a fonte declara (idade_minima). Sem nascimento cadastrado, não
--    bloqueia (não inventa). Nenhuma sequência entre classes: o manifesto não declara.
-- ---------------------------------------------------------------------
create or replace function public._classe_motivo_inelegivel(p_usuario_id uuid, p_class_id uuid) returns text
language sql stable security definer set search_path = '' as $$
  select case
    when c.idade_minima is not null and p.nascimento is not null
         and extract(year from age(current_date, p.nascimento))::int < c.idade_minima
      then format('Esta classe é a partir de %s anos.', c.idade_minima)
  end
  from public.classes c
  left join public.profiles p on p.id = p_usuario_id
  where c.id = p_class_id;
$$;
revoke all on function public._classe_motivo_inelegivel(uuid, uuid) from public, anon, authenticated;

-- ==================== RPCs de Classe redefinidas (36/37) com piloto-invisível + elegibilidade ====================
create or replace function public.classes_disponiveis() returns json
language sql stable security definer set search_path = '' as $$
  select coalesce(json_agg(json_build_object(
    'class_id', c.id, 'codigo', c.codigo, 'nome', c.nome, 'faixa_etaria', c.faixa_etaria,
    'idade_minima', c.idade_minima, 'manifesto_id', c.manifesto_id, 'vigente_desde', c.vigente_desde,
    'elegivel', public._classe_motivo_inelegivel(auth.uid(), c.id) is null,
    'motivo_inelegivel', public._classe_motivo_inelegivel(auth.uid(), c.id),
    'curriculum_version', json_build_object('id', v.id, 'origem', v.origem, 'identificador', v.identificador, 'versao', v.versao)
  ) order by c.ordem, c.nome), '[]'::json)
  from public.classes c
  join public.curriculum_versions v on v.id = c.curriculum_version_id
  where c.ativo and v.status = 'publicado'
    and (v.origem <> 'piloto_teste' or not public.catalogo_oficial_publicado('class'))
    and public.membro_ativo_no_clube(public.clube_atual_id())
    and not exists (
      select 1 from public.member_classes mc
      where mc.usuario_id = auth.uid() and mc.club_id = public.clube_atual_id() and mc.class_id = c.id and mc.status <> 'cancelada'
    );
$$;

create or replace function public.classe_iniciar(p_class_id uuid) returns json
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_club uuid := public.clube_atual_id(); v_mc_id uuid; v_faltando text[]; v_motivo text;
begin
  if v_uid is null or v_club is null or not public.membro_ativo_no_clube(v_club) then
    raise exception 'Sem clube em uso.';
  end if;
  perform public._exigir_classes_habilitado(v_club);
  if not public._classe_no_fluxo_normal(p_class_id) then raise exception 'Classe não encontrada.'; end if;
  v_motivo := public._classe_motivo_inelegivel(v_uid, p_class_id);
  if v_motivo is not null then raise exception '%', v_motivo; end if;
  v_faltando := public.dependencias_pendentes('class', p_class_id, v_uid, v_club);
  if array_length(v_faltando, 1) > 0 then
    raise exception 'Falta concluir antes: %', array_to_string(v_faltando, ', ');
  end if;
  v_mc_id := public._classe_matricular(v_uid, v_club, p_class_id);
  return json_build_object('ok', true, 'member_class_id', v_mc_id);
end;
$$;

create or replace function public.classe_atribuir(p_usuario_id uuid, p_class_id uuid) returns json
language plpgsql security definer set search_path = '' as $$
declare v_club uuid := public.clube_atual_id(); v_mc_id uuid; v_faltando text[]; v_motivo text;
begin
  if v_club is null or not public.pode_gerir_no_clube(v_club) then
    raise exception 'Sem permissão (apenas diretoria/instrutor deste clube).';
  end if;
  perform public._exigir_classes_habilitado(v_club);
  if not exists (
    select 1 from public.organization_memberships m
    where m.user_id = p_usuario_id and m.organizational_unit_id = v_club and m.role <> 'pais' and m.status = 'ativo'
      and m.starts_at <= now() and (m.ends_at is null or m.ends_at > now())
  ) then
    raise exception 'Pessoa sem vínculo ativo neste clube.';
  end if;
  if not public._classe_no_fluxo_normal(p_class_id) then raise exception 'Classe não encontrada.'; end if;
  v_motivo := public._classe_motivo_inelegivel(p_usuario_id, p_class_id);
  if v_motivo is not null then raise exception '%', v_motivo; end if;
  v_faltando := public.dependencias_pendentes('class', p_class_id, p_usuario_id, v_club);
  if array_length(v_faltando, 1) > 0 then
    raise exception 'Falta concluir antes: %', array_to_string(v_faltando, ', ');
  end if;
  v_mc_id := public._classe_matricular(p_usuario_id, v_club, p_class_id);
  return json_build_object('ok', true, 'member_class_id', v_mc_id);
end;
$$;

-- ==================== RPCs de Especialidade (37) com piloto-invisível (mesma regra; hoje não há oficial) ====================
create or replace function public.especialidades_disponiveis() returns json
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_club uuid := public.clube_atual_id();
begin
  if v_uid is null or v_club is null then return '[]'::json; end if;
  return coalesce((
    select json_agg(json_build_object(
      'specialty_id', sp.id, 'codigo', sp.codigo, 'nome', sp.nome, 'categoria', sp.categoria, 'nivel', sp.nivel,
      'curriculum_version', json_build_object('id', v.id, 'origem', v.origem, 'identificador', v.identificador, 'versao', v.versao),
      'dependencias_pendentes', public.dependencias_pendentes('specialty', sp.id, v_uid, v_club)
    ) order by sp.ordem, sp.nome)
    from public.specialties sp
    join public.curriculum_versions v on v.id = sp.curriculum_version_id
    where sp.ativo and v.status = 'publicado'
      and (v.origem <> 'piloto_teste' or not public.catalogo_oficial_publicado('specialty'))
      and public.membro_ativo_no_clube(v_club)
      and not exists (
        select 1 from public.member_specialties ms
        where ms.usuario_id = v_uid and ms.club_id = v_club and ms.specialty_id = sp.id and ms.status <> 'cancelada'
      )
  ), '[]'::json);
end;
$$;

create or replace function public.especialidade_iniciar(p_specialty_id uuid, p_oferta_id uuid default null) returns json
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_club uuid := public.clube_atual_id(); v_ms_id uuid; v_faltando text[];
begin
  if v_uid is null or v_club is null or not public.membro_ativo_no_clube(v_club) then raise exception 'Sem clube em uso.'; end if;
  perform public._exigir_classes_habilitado(v_club);
  if not public._especialidade_no_fluxo_normal(p_specialty_id) then raise exception 'Especialidade não encontrada.'; end if;
  if p_oferta_id is not null and not exists (select 1 from public.specialty_offerings where id = p_oferta_id and club_id = v_club and specialty_id = p_specialty_id) then
    raise exception 'Turma/oferta não encontrada neste clube.';
  end if;
  v_faltando := public.dependencias_pendentes('specialty', p_specialty_id, v_uid, v_club);
  if array_length(v_faltando, 1) > 0 then raise exception 'Falta concluir antes: %', array_to_string(v_faltando, ', '); end if;
  v_ms_id := public._especialidade_matricular(v_uid, v_club, p_specialty_id, p_oferta_id);
  return json_build_object('ok', true, 'member_specialty_id', v_ms_id);
end;
$$;

create or replace function public.especialidade_atribuir(p_usuario_id uuid, p_specialty_id uuid, p_oferta_id uuid default null) returns json
language plpgsql security definer set search_path = '' as $$
declare v_club uuid := public.clube_atual_id(); v_ms_id uuid; v_faltando text[];
begin
  if v_club is null or not public.pode_gerir_no_clube(v_club) then
    raise exception 'Sem permissão (apenas diretoria/instrutor deste clube).';
  end if;
  perform public._exigir_classes_habilitado(v_club);
  if not exists (
    select 1 from public.organization_memberships m
    where m.user_id = p_usuario_id and m.organizational_unit_id = v_club and m.role <> 'pais' and m.status = 'ativo'
      and m.starts_at <= now() and (m.ends_at is null or m.ends_at > now())
  ) then
    raise exception 'Pessoa sem vínculo ativo neste clube.';
  end if;
  if not public._especialidade_no_fluxo_normal(p_specialty_id) then raise exception 'Especialidade não encontrada.'; end if;
  if p_oferta_id is not null and not exists (select 1 from public.specialty_offerings where id = p_oferta_id and club_id = v_club and specialty_id = p_specialty_id) then
    raise exception 'Turma/oferta não encontrada neste clube.';
  end if;
  v_faltando := public.dependencias_pendentes('specialty', p_specialty_id, p_usuario_id, v_club);
  if array_length(v_faltando, 1) > 0 then raise exception 'Falta concluir antes: %', array_to_string(v_faltando, ', '); end if;
  v_ms_id := public._especialidade_matricular(p_usuario_id, v_club, p_specialty_id, p_oferta_id);
  return json_build_object('ok', true, 'member_specialty_id', v_ms_id);
end;
$$;

-- ---------------------------------------------------------------------
-- F) minha_classe() com escolha + conteúdo dinâmico (tudo do banco) e requisito_origem()
-- ---------------------------------------------------------------------
create or replace function public.minha_classe(p_member_class_id uuid default null) returns json
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_club uuid := public.clube_atual_id(); v_mc record;
begin
  if v_uid is null or v_club is null then return null; end if;
  if p_member_class_id is not null then
    select * into v_mc from public.member_classes where id = p_member_class_id and usuario_id = v_uid and club_id = v_club;
  else
    select * into v_mc from public.member_classes
     where usuario_id = v_uid and club_id = v_club
     order by (status = 'em_andamento') desc, iniciada_em desc
     limit 1;
  end if;
  if v_mc.id is null then return null; end if;

  return json_build_object(
    'member_class', json_build_object(
      'id', v_mc.id, 'status', v_mc.status, 'iniciada_em', v_mc.iniciada_em, 'concluida_em', v_mc.concluida_em,
      'percentual', public.classe_percentual(v_mc.id)
    ),
    'classe', (select json_build_object('id', c.id, 'codigo', c.codigo, 'nome', c.nome, 'faixa_etaria', c.faixa_etaria,
                                        'idade_minima', c.idade_minima, 'manifesto_id', c.manifesto_id, 'vigente_desde', c.vigente_desde,
                                        'fonte_url', c.fonte_url, 'fonte_publicado_em', c.fonte_publicado_em)
               from public.classes c where c.id = v_mc.class_id),
    'curriculum_version', (
      select json_build_object('id', ver.id, 'origem', ver.origem, 'identificador', ver.identificador, 'versao', ver.versao,
               'status', ver.status, 'fonte_url', ver.fonte_url, 'fonte_descricao', ver.fonte_descricao,
               'vigente_desde', ver.vigente_desde, 'fonte_hash', ver.fonte_hash, 'importado_em', ver.importado_em)
      from public.classes c join public.curriculum_versions ver on ver.id = c.curriculum_version_id where c.id = v_mc.class_id
    ),
    'investidura', (
      select json_build_object('status', ir.status, 'solicitado_em', ir.solicitado_em, 'revisado_em', ir.revisado_em, 'comentario', ir.comentario)
      from public.investiture_reviews ir where ir.member_class_id = v_mc.id
    ),
    'secoes', (
      select coalesce(json_agg(json_build_object(
        'id', s.id, 'codigo', s.codigo, 'nome', s.nome, 'ordem', s.ordem,
        'requisitos', (
          select coalesce(json_agg(json_build_object(
            'id', r.id, 'codigo', r.codigo, 'descricao', r.descricao, 'manifesto_id', r.manifesto_id, 'status_fonte', r.status_fonte,
            'tipo_evidencia', r.tipo_evidencia, 'evidencia_obrigatoria', r.evidencia_obrigatoria,
            'member_requirement_id', mr.id, 'status', coalesce(mr.status, 'nao_iniciado'),
            'evidencia_texto', mr.evidencia_texto, 'evidencia_path', mr.evidencia_path, 'enviado_em', mr.enviado_em,
            -- conteúdo anual/dinâmico resolvido PRA HOJE pelo servidor (valor null = ano ainda sem cadastro)
            'conteudo_dinamico', (select public.conteudo_dinamico_resolver(d.chave, current_date)
                                  from public.dynamic_content_definitions d where d.id = r.conteudo_dinamico_definicao_id),
            -- regra N-de-M declarativa (migration 38): o front só apresenta; a conta é do servidor
            'escolha', (
              select json_build_object(
                'grupo_id', g.id, 'n_minimo', g.n_minimo, 'sem_repeticao', g.sem_repeticao, 'pool_sem_repeticao', g.pool_sem_repeticao,
                'satisfeitas_automaticamente', (public.opcoes_satisfeitas_automaticamente(g.id, v_uid) ->> 'satisfeitas')::int,
                'opcoes', (select coalesce(json_agg(json_build_object('id', o.id, 'rotulo', o.rotulo, 'specialty_id', o.specialty_id) order by o.ordem), '[]'::json)
                           from public.requirement_options o where o.grupo_id = g.id)
              )
              from public.requirement_option_groups g where g.alvo_tipo = 'class_requirement' and g.alvo_id = r.id
            ),
            'avaliacoes', (
              select coalesce(json_agg(json_build_object(
                'decisao', a.decisao, 'avaliado_por_nome', p.nome, 'avaliado_papel', a.avaliado_papel,
                'comentario', a.comentario, 'created_at', a.created_at
              ) order by a.created_at), '[]'::json)
              from public.requirement_approvals a
              join public.profiles p on p.id = a.avaliado_por
              where mr.id is not null and a.member_requirement_id = mr.id
            )
          ) order by r.ordem, r.codigo), '[]'::json)
          from public.class_requirements r
          left join public.member_requirements mr on mr.requirement_id = r.id and mr.member_class_id = v_mc.id
          where r.section_id = s.id and r.ativo
        )
      ) order by s.ordem), '[]'::json)
      from public.class_sections s where s.class_id = v_mc.class_id
    )
  );
end;
$$;

-- "Origem do requisito": proveniência completa de um requisito do catálogo publicado — manifesto,
-- status na fonte, OMDs (entrada do registro, com URL), página oficial da classe (carimbo ≠ vigência),
-- versão importada (hash, arquivos, data). Não é pra poluir o card; é pra auditoria/administração.
create or replace function public.requisito_origem(p_requirement_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'requisito', jsonb_build_object('id', r.id, 'manifesto_id', r.manifesto_id, 'codigo', r.codigo, 'descricao', r.descricao,
                                    'status_fonte', r.status_fonte, 'observacao_fonte', r.observacao_fonte,
                                    'alterado_por_omd', (select x from jsonb_array_elements(coalesce(v.fonte_detalhes -> 'omds', '[]'::jsonb)) x where x ->> 'id' = r.alterado_por_omd),
                                    'confirmado_por_omd', (select x from jsonb_array_elements(coalesce(v.fonte_detalhes -> 'omds', '[]'::jsonb)) x where x ->> 'id' = r.confirmado_por_omd),
                                    'conteudo_dinamico', (select jsonb_build_object('chave', d.chave, 'nome', d.nome) from public.dynamic_content_definitions d where d.id = r.conteudo_dinamico_definicao_id),
                                    'escolha', (select jsonb_build_object('n_minimo', g.n_minimo, 'sem_repeticao', g.sem_repeticao, 'pool_sem_repeticao', g.pool_sem_repeticao,
                                                                          'opcoes', (select coalesce(jsonb_agg(o.rotulo order by o.ordem), '[]'::jsonb) from public.requirement_options o where o.grupo_id = g.id))
                                                from public.requirement_option_groups g where g.alvo_tipo = 'class_requirement' and g.alvo_id = r.id)),
    'secao', jsonb_build_object('manifesto_id', s.manifesto_id, 'codigo', s.codigo, 'nome', s.nome),
    'classe', jsonb_build_object('manifesto_id', c.manifesto_id, 'nome', c.nome, 'idade_minima', c.idade_minima, 'vigente_desde', c.vigente_desde,
                                 'fonte_url', c.fonte_url, 'fonte_publicado_em', c.fonte_publicado_em, 'proveniencia', c.proveniencia),
    'versao', jsonb_build_object('id', v.id, 'origem', v.origem, 'identificador', v.identificador, 'versao', v.versao, 'status', v.status,
                                 'vigente_desde', v.vigente_desde, 'fonte_hash', v.fonte_hash, 'fonte_arquivo', v.fonte_arquivo,
                                 'importado_em', v.importado_em, 'fonte_descricao', v.fonte_descricao,
                                 'manifesto_versao', v.fonte_detalhes ->> 'manifesto_versao', 'gerado_em', v.fonte_detalhes ->> 'gerado_em',
                                 'arquivos', v.fonte_detalhes -> 'arquivos')
  )
  from public.class_requirements r
  join public.class_sections s on s.id = r.section_id
  join public.classes c on c.id = s.class_id
  join public.curriculum_versions v on v.id = c.curriculum_version_id
  where r.id = p_requirement_id and public.classe_esta_publicada(c.id);
$$;
revoke all on function public.requisito_origem(uuid) from public, anon;
grant execute on function public.requisito_origem(uuid) to authenticated;

notify pgrst, 'reload schema';

insert into public.migracoes_aplicadas (arquivo)
values ('2026-09-21-catalogo-oficial-classes.sql')
on conflict (arquivo) do update set aplicada_em = now();
