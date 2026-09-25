-- =====================================================================
-- Importador: cada requisito do manifesto passa a dizer COMO se comprova (tipo_evidencia).
-- Rodar DEPOIS da 20260930000104 e ANTES da migration de importação do manifesto 2026.3. Idempotente.
--
-- Achado em produção: todos os class_requirements das 6 Classes Regulares nasciam com
-- tipo_evidencia='nenhuma' (o importador das migrations 39/42 gravava fixo 'nenhuma', false). A tela
-- Minha Classe só mostra a caixa "Sua resposta" para 'texto' e o campo de foto para 'foto' — então o
-- desbravador não tinha como comprovar nada (ex.: a redação sobre ser bom cidadão).
--
-- Mudança (e só ela): cada requisito aceita duas chaves OPCIONAIS no pacote:
--   tipo_evidencia        'nenhuma' | 'texto' | 'foto'  (ausente = 'nenhuma'; outro valor = recusado)
--   evidencia_obrigatoria boolean  (ausente = true para texto/foto, false para nenhuma;
--                                   'nenhuma' + obrigatória = recusado — não há o que enviar)
-- gravadas em class_requirements. Versões já importadas (2026.1/2026.2) NÃO são tocadas — um pacote
-- sem as chaves continua importando exatamente como antes.
-- Corpo idêntico ao da migration 42 fora esse ponto.
-- =====================================================================
create or replace function public.curriculo_importar_classes_regulares(p_pacote jsonb, p_hash text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_versao_txt text := p_pacote ->> 'manifesto_versao';
  v_gerado_em date := (p_pacote ->> 'gerado_em')::date;
  v_omds jsonb := p_pacote -> 'omds';
  v_classes jsonb := p_pacote -> 'classes';
  v_ids_esperados text[] := array['amigo', 'companheiro', 'excursionista', 'guia', 'pesquisador', 'pioneiro'];
  v_ids_recebidos text[];
  v_ver_id uuid; v_ver record; v_vigente_desde date; v_arquivadas jsonb;
  c jsonb; s jsonb; r jsonb; v_omd jsonb;
  v_class_id uuid; v_sec_id uuid; v_req_id uuid; v_grp_id uuid; v_def_id uuid;
  v_tipo text; v_status text; v_evid text; v_evid_obrig boolean; v_lacuna text; v_ref text; v_chave text; v_n int; v_opcoes jsonb; i int;
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

  v_ver_id := public.curriculo_uuid('version:classes-regulares-dsa:' || v_versao_txt);
  select * into v_ver from public.curriculum_versions where id = v_ver_id;
  if found then
    if v_ver.fonte_hash = p_hash then
      return jsonb_build_object('ok', true, 'ja_importado', true, 'curriculum_version_id', v_ver_id, 'fonte_hash', p_hash);
    end if;
    raise exception 'Importação: a versão % já existe com outro conteúdo (hash % ≠ %). Uma versão publicada nunca é editada — gere uma versão nova do manifesto.', v_versao_txt, v_ver.fonte_hash, p_hash;
  end if;

  select max((x ->> 'vigente_desde')::date) into v_vigente_desde from jsonb_array_elements(v_classes) x;
  if v_vigente_desde is null then raise exception 'Importação: classe sem vigente_desde.'; end if;

  -- versão nova do MESMO identificador: a publicada anterior é ARQUIVADA (não editada, não apagada —
  -- o histórico de quem andou nela fica intacto). Explícito no resultado.
  with a as (
    update public.curriculum_versions set status = 'arquivado'
     where origem = 'oficial' and identificador = 'classes-regulares-dsa' and status = 'publicado' and id <> v_ver_id
    returning id, versao
  ) select coalesce(jsonb_agg(jsonb_build_object('id', id, 'versao', versao)), '[]'::jsonb) into v_arquivadas from a;

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
                                                          'alterado_por_omd', 'confirmado_por_omd', 'escolha', 'grupo_sem_repeticao',
                                                          'tipo_evidencia', 'evidencia_obrigatoria'], 'o requisito ' || (r ->> 'id'));
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
        -- tipo de comprovação (migration 105): ausente = 'nenhuma' (liderança confere pessoalmente);
        -- evidencia_obrigatoria ausente = true para texto/foto, false para nenhuma.
        v_evid := coalesce(r ->> 'tipo_evidencia', 'nenhuma');
        if r ? 'tipo_evidencia' and jsonb_typeof(r -> 'tipo_evidencia') <> 'string' then
          raise exception 'Importação: requisito % com tipo_evidencia não textual.', r ->> 'id';
        end if;
        if v_evid not in ('nenhuma', 'texto', 'foto') then
          raise exception 'Importação: requisito % com tipo_evidencia "%" — só nenhuma, texto ou foto.', r ->> 'id', v_evid;
        end if;
        if r ? 'evidencia_obrigatoria' then
          if jsonb_typeof(r -> 'evidencia_obrigatoria') <> 'boolean' then
            raise exception 'Importação: requisito % com evidencia_obrigatoria não booleano.', r ->> 'id';
          end if;
          v_evid_obrig := (r ->> 'evidencia_obrigatoria')::boolean;
        else
          v_evid_obrig := v_evid in ('texto', 'foto');
        end if;
        if v_evid = 'nenhuma' and v_evid_obrig then
          raise exception 'Importação: requisito % exige evidência mas tipo_evidencia é nenhuma.', r ->> 'id';
        end if;
        if r ? 'proveniencia_pendente' then raise exception 'Importação: requisito % com pendência.', r ->> 'id'; end if;
        if (v_tipo = 'anual_dinamico' and v_lacuna is distinct from 'requisito_anual_dinamico')
           or (v_tipo = 'escolha_n_de_m' and v_lacuna is distinct from 'escolha_n_de_m')
           or (v_tipo = 'escolha_n_de_m_sem_repeticao' and v_lacuna is distinct from 'escolha_sem_repeticao')
           or (v_tipo = 'simples' and v_lacuna is not null) then
          raise exception 'Importação: requisito % — tipo "%" incompatível com lacuna_schema "%".', r ->> 'id', v_tipo, coalesce(v_lacuna, '(nenhuma)');
        end if;
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
        values (v_req_id, v_sec_id, r ->> 'codigo', r ->> 'descricao_resumida', v_evid, v_evid_obrig, (r ->> 'ordem')::int, true, v_def_id,
                r ->> 'id', v_status, r ->> 'alterado_por_omd', r ->> 'confirmado_por_omd', r ->> 'observacao');
        v_n_reqs := v_n_reqs + 1;

        if v_tipo in ('escolha_n_de_m', 'escolha_n_de_m_sem_repeticao') then
          v_opcoes := null; v_n := 1;
          if r ? 'escolha' then
            perform public._curriculo_exigir_chaves(r -> 'escolha', array['n', 'opcoes'], 'escolha de ' || (r ->> 'id'));
            if jsonb_typeof(r -> 'escolha' -> 'n') <> 'number' then raise exception 'Importação: requisito % com escolha.n não numérico.', r ->> 'id'; end if;
            v_n := (r -> 'escolha' ->> 'n')::int;
            if v_n < 1 then raise exception 'Importação: requisito % com n=% (mínimo 1).', r ->> 'id', v_n; end if;
            -- opcoes ausente = o cartão não lista opções (categoria/escopo está no texto oficial): grupo aberto, texto livre
            if r -> 'escolha' ? 'opcoes' then
              if jsonb_typeof(r -> 'escolha' -> 'opcoes') <> 'array' or jsonb_array_length(r -> 'escolha' -> 'opcoes') = 0 then
                raise exception 'Importação: requisito % com escolha.opcoes vazio — omita a chave quando o cartão não lista opções.', r ->> 'id';
              end if;
              v_opcoes := r -> 'escolha' -> 'opcoes';
              if v_n > jsonb_array_length(v_opcoes) then raise exception 'Importação: requisito % com n=% maior que as % opções.', r ->> 'id', v_n, jsonb_array_length(v_opcoes); end if;
            end if;
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
    'arquivadas', v_arquivadas,
    'classes', v_n_classes, 'secoes', v_n_secoes, 'requisitos', v_n_reqs, 'grupos_n_de_m', v_n_grupos, 'opcoes', v_n_opcoes, 'requisitos_dinamicos', v_n_dinamicos);
end;
$$;
revoke all on function public.curriculo_importar_classes_regulares(jsonb, text) from public, anon, authenticated;


notify pgrst, 'reload schema';

insert into public.migracoes_aplicadas (arquivo)
values ('2026-09-30-importador-tipo-de-comprovacao.sql')
on conflict (arquivo) do update set aplicada_em = now();
