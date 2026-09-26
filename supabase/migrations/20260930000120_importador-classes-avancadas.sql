-- =====================================================================
-- 120 — Classes Avançadas no motor curricular (manifesto 2026.4).
-- Rodar DEPOIS da 20260930000109 e ANTES da migration de importação do manifesto 2026.4 (121). Idempotente.
--
-- O que muda (e só isto):
--  1) classes.tipo_classe ('regular' | 'avancada') + classes.classe_regular_codigo (a regular pareada).
--  2) curriculum_dependencies.modo: 'concluida' (padrão, comportamento de sempre) | 'iniciada_ou_concluida'.
--     Regra oficial aplicada às avançadas: a DSA diz que as avançadas seguem "a idade da classe regular
--     correspondente" e são pareadas a ela no mesmo cartão (https://www.adventistas.org/pt/desbravadores/classes/).
--     A fonte oficial NÃO diz que a regular precisa estar concluída antes — então a avançada exige a regular
--     pareada INICIADA ou CONCLUÍDA (feita junto ou depois), nunca sozinha. Trocar para 'concluida' é uma linha
--     (update curriculum_dependencies set modo = 'concluida' ...) se o manual/OMD disser o contrário.
--  3) dependencias_pendentes: dependência de CLASSE passa a valer por CÓDIGO no catálogo oficial, em qualquer
--     versão — quem concluiu (ou está fazendo) Amigo na 2026.3 satisfaz a dependência da avançada da 2026.4.
--     Antes era por class_id exato, o que quebraria a cada versão nova do manifesto.
--  4) _classe_motivo_inelegivel: além da idade, diz com clareza quando falta a regular pareada ("Comece a classe
--     Amigo primeiro…") — aparece em classes_disponiveis (elegivel=false + motivo) e é o erro de classe_iniciar
--     e classe_atribuir (que já chamam esta função antes de matricular).
--  5) classes_disponiveis: devolve avancada / classe_regular_codigo; ordena a avançada logo depois da regular.
--  6) curriculo_importar_classes_regulares: aceita a chave opcional `classes_avancadas` no pacote (cada uma com
--     classe_regular_ref, idade_minima = a da regular, fonte_base, vigente_desde, cobertura, seção única). Grava
--     tipo_classe/classe_regular_codigo e a dependência avançada → regular (modo iniciada_ou_concluida). Pacotes
--     sem a chave (2026.1–2026.3) importam exatamente como antes. Corpo das regulares idêntico ao da migration 105.
-- =====================================================================

alter table public.classes add column if not exists tipo_classe text not null default 'regular';
alter table public.classes add column if not exists classe_regular_codigo text;
do $$ begin
  alter table public.classes add constraint classes_tipo_classe_check check (tipo_classe in ('regular', 'avancada'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.classes add constraint classes_avancada_tem_regular check ((tipo_classe = 'avancada') = (classe_regular_codigo is not null));
exception when duplicate_object then null; end $$;

alter table public.curriculum_dependencies add column if not exists modo text not null default 'concluida';
do $$ begin
  alter table public.curriculum_dependencies add constraint curriculum_dependencies_modo_check check (modo in ('concluida', 'iniciada_ou_concluida'));
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------
-- dependência de classe satisfeita? (por código, no catálogo oficial, em qualquer versão)
-- ---------------------------------------------------------------------
create or replace function public._dependencia_de_classe_satisfeita(p_usuario_id uuid, p_depende_de_id uuid, p_modo text)
returns boolean
language sql stable security definer set search_path = '' as $$
  with alvo as (
    select c.codigo, v.origem from public.classes c join public.curriculum_versions v on v.id = c.curriculum_version_id where c.id = p_depende_de_id
  ), equivalentes as (
    -- a própria classe e, se ela é do catálogo oficial, a MESMA classe (mesmo código) em qualquer versão oficial
    select c.id from public.classes c join public.curriculum_versions v on v.id = c.curriculum_version_id, alvo
    where c.id = p_depende_de_id or (alvo.origem = 'oficial' and v.origem = 'oficial' and c.codigo = alvo.codigo)
  )
  select exists (
    select 1 from public.curriculum_achievements a
    where a.usuario_id = p_usuario_id and a.tipo = 'classe' and a.status = 'ativa' and a.classe_id in (select id from equivalentes)
  ) or (p_modo = 'iniciada_ou_concluida' and exists (
    select 1 from public.member_classes mc
    where mc.usuario_id = p_usuario_id and mc.status <> 'cancelada' and mc.class_id in (select id from equivalentes)
  ));
$$;
revoke all on function public._dependencia_de_classe_satisfeita(uuid, uuid, text) from public, anon, authenticated;

create or replace function public.dependencias_pendentes(p_alvo_tipo text, p_alvo_id uuid, p_usuario_id uuid, p_club_id uuid) returns text[]
language plpgsql stable security definer set search_path = '' as $$
declare r record; v_ok boolean; v_nome text; v_faltando text[] := '{}';
begin
  for r in select * from public.curriculum_dependencies where alvo_tipo = p_alvo_tipo and alvo_id = p_alvo_id and obrigatorio loop
    if r.depende_de_tipo = 'class' then
      v_ok := public._dependencia_de_classe_satisfeita(p_usuario_id, r.depende_de_id, r.modo);
      select nome into v_nome from public.classes where id = r.depende_de_id;
    else
      v_ok := public.curriculo_pessoa_concluiu('especialidade', p_usuario_id, null, r.depende_de_id);
      select nome into v_nome from public.specialties where id = r.depende_de_id;
    end if;
    if not v_ok then
      v_faltando := array_append(v_faltando, coalesce(v_nome, r.depende_de_id::text));
    end if;
  end loop;
  return v_faltando;
end;
$$;
-- interna do servidor desde a migration 56 (rpcs-cross-tenant): NÃO volta pra API
revoke all on function public.dependencias_pendentes(text, uuid, uuid, uuid) from public, anon, authenticated;
-- (p_club_id continua sem uso no corpo — checagem portátil desde a migration 38; mantido pela assinatura.)

-- ---------------------------------------------------------------------
-- motivo de inelegibilidade: idade (como antes) e, agora, a regular pareada da avançada
-- ---------------------------------------------------------------------
create or replace function public._classe_motivo_inelegivel(p_usuario_id uuid, p_class_id uuid)
returns text
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select format('Esta classe é a partir de %s anos.', c.idade_minima)
       from public.classes c left join public.profiles p on p.id = p_usuario_id
      where c.id = p_class_id and c.idade_minima is not null and p.nascimento is not null
        and extract(year from age(current_date, p.nascimento))::int < c.idade_minima),
    (select case when d.modo = 'iniciada_ou_concluida'
                 then format('Comece a classe %s primeiro: a Classe Avançada é feita junto com ela ou depois dela.', r.nome)
                 else format('Conclua a classe %s primeiro.', r.nome) end
       from public.curriculum_dependencies d join public.classes r on r.id = d.depende_de_id
      where d.alvo_tipo = 'class' and d.alvo_id = p_class_id and d.depende_de_tipo = 'class' and d.obrigatorio
        and not public._dependencia_de_classe_satisfeita(p_usuario_id, d.depende_de_id, d.modo)
      order by r.ordem, r.nome limit 1)
  );
$$;
revoke all on function public._classe_motivo_inelegivel(uuid, uuid) from public, anon, authenticated;

create or replace function public.classes_disponiveis()
returns json
language sql stable security definer set search_path = '' as $$
  select coalesce(json_agg(json_build_object(
    'class_id', c.id, 'codigo', c.codigo, 'nome', c.nome, 'faixa_etaria', c.faixa_etaria,
    'idade_minima', c.idade_minima, 'manifesto_id', c.manifesto_id, 'vigente_desde', c.vigente_desde,
    'avancada', c.tipo_classe = 'avancada', 'classe_regular_codigo', c.classe_regular_codigo,
    'elegivel', public._classe_motivo_inelegivel(auth.uid(), c.id) is null,
    'motivo_inelegivel', public._classe_motivo_inelegivel(auth.uid(), c.id),
    'curriculum_version', json_build_object('id', v.id, 'origem', v.origem, 'identificador', v.identificador, 'versao', v.versao)
  ) order by c.ordem, c.tipo_classe = 'avancada', c.nome), '[]'::json)
  from public.classes c
  join public.curriculum_versions v on v.id = c.curriculum_version_id
  where c.ativo and v.status = 'publicado' and v.origem = 'oficial'
    and public.membro_ativo_no_clube(public.clube_atual_id())
    and not exists (
      select 1 from public.member_classes mc
      where mc.usuario_id = auth.uid() and mc.club_id = public.clube_atual_id() and mc.class_id = c.id and mc.status <> 'cancelada'
    );
$$;
revoke all on function public.classes_disponiveis() from public, anon;
grant execute on function public.classes_disponiveis() to authenticated;

-- ---------------------------------------------------------------------
-- importador: uma classe (regular ou avançada) com seções/requisitos/grupos — corpo do laço da migration 105
-- ---------------------------------------------------------------------
create or replace function public._curriculo_importar_uma_classe(p_ver_id uuid, p_versao_txt text, p_omds jsonb, c jsonb, p_tipo text, p_regular_codigo text)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  s jsonb; r jsonb; v_omd jsonb;
  v_class_id uuid; v_sec_id uuid; v_req_id uuid; v_grp_id uuid; v_def_id uuid;
  v_tipo text; v_status text; v_evid text; v_evid_obrig boolean; v_lacuna text; v_ref text; v_chave text; v_n int; v_opcoes jsonb; i int;
  v_n_secoes int := 0; v_n_reqs int := 0; v_n_grupos int := 0; v_n_opcoes int := 0; v_n_dinamicos int := 0;
begin
  if p_tipo = 'regular' then
    perform public._curriculo_exigir_chaves(c, array['id', 'nome', 'idade_minima', 'fonte_base', 'vigente_desde', 'vigente_desde_nota', 'secoes', 'cobertura', 'observacao_estrutural'], 'a classe ' || (c ->> 'id'));
  else
    perform public._curriculo_exigir_chaves(c, array['id', 'nome', 'classe_regular_ref', 'idade_minima', 'fonte_base', 'vigente_desde', 'vigente_desde_nota', 'secoes', 'cobertura', 'cobertura_nota'], 'a classe avançada ' || (c ->> 'id'));
  end if;
  perform public._curriculo_exigir_chaves(c -> 'fonte_base', array['url', 'publicado_em', 'nota_publicado_em'], 'fonte_base de ' || (c ->> 'id'));
  if coalesce(c ->> 'nome', '') = '' or coalesce(c -> 'fonte_base' ->> 'url', '') = '' or c ->> 'vigente_desde' is null
     or jsonb_typeof(c -> 'idade_minima') <> 'number' or jsonb_typeof(c -> 'secoes') <> 'array' or jsonb_array_length(c -> 'secoes') = 0 then
    raise exception 'Importação: classe % incompleta (nome, fonte_base.url, vigente_desde, idade_minima numérica e seções são obrigatórios).', c ->> 'id';
  end if;
  v_class_id := public.curriculo_uuid('class:' || p_versao_txt || ':' || (c ->> 'id'));
  insert into public.classes (id, curriculum_version_id, codigo, nome, faixa_etaria, ordem, ativo, manifesto_id, idade_minima, vigente_desde, fonte_url, fonte_publicado_em, proveniencia,
                              tipo_classe, classe_regular_codigo)
  values (v_class_id, p_ver_id, c ->> 'id', c ->> 'nome', null, (c ->> 'idade_minima')::int, true, c ->> 'id', (c ->> 'idade_minima')::int,
          (c ->> 'vigente_desde')::date, c -> 'fonte_base' ->> 'url', (c -> 'fonte_base' ->> 'publicado_em')::date,
          jsonb_strip_nulls(jsonb_build_object('vigente_desde_nota', c -> 'vigente_desde_nota', 'nota_publicado_em', c -> 'fonte_base' -> 'nota_publicado_em',
                                               'cobertura', c -> 'cobertura', 'observacao_estrutural', c -> 'observacao_estrutural', 'cobertura_nota', c -> 'cobertura_nota')),
          p_tipo, p_regular_codigo);

  for s in select x from jsonb_array_elements(c -> 'secoes') x loop
    perform public._curriculo_exigir_chaves(s, array['id', 'codigo', 'nome', 'ordem', 'requisitos'], 'a seção ' || (s ->> 'id'));
    if coalesce(s ->> 'id', '') = '' or coalesce(s ->> 'codigo', '') = '' or coalesce(s ->> 'nome', '') = '' or jsonb_typeof(s -> 'ordem') <> 'number'
       or jsonb_typeof(s -> 'requisitos') <> 'array' then
      raise exception 'Importação: seção % incompleta.', s ->> 'id';
    end if;
    v_sec_id := public.curriculo_uuid('section:' || p_versao_txt || ':' || (s ->> 'id'));
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
      if v_tipo = 'anual_dinamico' and p_tipo <> 'regular' then
        raise exception 'Importação: requisito % anual_dinamico numa classe avançada — o slot anual é só das regulares.', r ->> 'id';
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
        select x into v_omd from jsonb_array_elements(p_omds) x where x ->> 'id' = v_ref;
        if v_omd is null then raise exception 'Importação: requisito % referencia OMD % ausente do registro.', r ->> 'id', v_ref; end if;
        if v_omd ->> 'status' <> 'CONFIRMADO' then
          raise exception 'Importação: requisito % apoiado na OMD % (status %) — só OMD CONFIRMADO pode sustentar um requisito publicado.', r ->> 'id', v_ref, v_omd ->> 'status';
        end if;
      end loop;

      v_req_id := public.curriculo_uuid('req:' || p_versao_txt || ':' || (r ->> 'id'));
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
        v_grp_id := public.curriculo_uuid('group:' || p_versao_txt || ':' || (r ->> 'id'));
        insert into public.requirement_option_groups (id, alvo_tipo, alvo_id, n_minimo, sem_repeticao, pool_sem_repeticao)
        values (v_grp_id, 'class_requirement', v_req_id, v_n, v_tipo = 'escolha_n_de_m_sem_repeticao', r ->> 'grupo_sem_repeticao');
        v_n_grupos := v_n_grupos + 1;
        if v_opcoes is not null then
          for i in 0 .. jsonb_array_length(v_opcoes) - 1 loop
            if jsonb_typeof(v_opcoes -> i) <> 'string' or coalesce(v_opcoes ->> i, '') = '' then raise exception 'Importação: requisito % com opção não textual.', r ->> 'id'; end if;
            insert into public.requirement_options (id, grupo_id, rotulo, specialty_id, ordem)
            values (public.curriculo_uuid('option:' || p_versao_txt || ':' || (r ->> 'id') || ':' || (i + 1)), v_grp_id, v_opcoes ->> i, null, (i + 1) * 10);
            v_n_opcoes := v_n_opcoes + 1;
          end loop;
        end if;
      elsif r ? 'escolha' or r ? 'grupo_sem_repeticao' then
        raise exception 'Importação: requisito % (tipo %) carrega escolha/grupo_sem_repeticao.', r ->> 'id', v_tipo;
      end if;
    end loop;
  end loop;

  return jsonb_build_object('class_id', v_class_id, 'secoes', v_n_secoes, 'requisitos', v_n_reqs, 'grupos', v_n_grupos, 'opcoes', v_n_opcoes, 'dinamicos', v_n_dinamicos);
end;
$$;
revoke all on function public._curriculo_importar_uma_classe(uuid, text, jsonb, jsonb, text, text) from public, anon, authenticated;

create or replace function public.curriculo_importar_classes_regulares(p_pacote jsonb, p_hash text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_versao_txt text := p_pacote ->> 'manifesto_versao';
  v_gerado_em date := (p_pacote ->> 'gerado_em')::date;
  v_omds jsonb := p_pacote -> 'omds';
  v_classes jsonb := p_pacote -> 'classes';
  v_avancadas jsonb := coalesce(p_pacote -> 'classes_avancadas', '[]'::jsonb);
  v_ids_esperados text[] := array['amigo', 'companheiro', 'excursionista', 'guia', 'pesquisador', 'pioneiro'];
  v_ids_recebidos text[];
  v_ver_id uuid; v_ver record; v_vigente_desde date; v_arquivadas jsonb; v_res jsonb; v_reg record;
  c jsonb;
  v_n_classes int := 0; v_n_avancadas int := 0; v_n_secoes int := 0; v_n_reqs int := 0; v_n_grupos int := 0; v_n_opcoes int := 0; v_n_dinamicos int := 0;
begin
  if v_versao_txt is null or v_gerado_em is null or jsonb_typeof(v_omds) <> 'array' or jsonb_typeof(v_classes) <> 'array' or jsonb_typeof(v_avancadas) <> 'array' then
    raise exception 'Importação: pacote inválido (manifesto_versao, gerado_em, omds e classes são obrigatórios; classes_avancadas, se houver, é lista).';
  end if;
  if p_hash !~ '^[0-9a-f]{64}$' then raise exception 'Importação: hash sha256 inválido.'; end if;
  perform public._curriculo_exigir_chaves(p_pacote, array['manifesto_versao', 'gerado_em', 'arquivos', 'omds', 'classes', 'classes_avancadas'], 'o pacote');

  select array_agg(x ->> 'id' order by x ->> 'id') into v_ids_recebidos from jsonb_array_elements(v_classes) x;
  if v_ids_recebidos is distinct from v_ids_esperados then
    raise exception 'Importação: esperadas exatamente as 6 Classes Regulares (%); recebido: %.', array_to_string(v_ids_esperados, ', '), array_to_string(coalesce(v_ids_recebidos, '{}'), ', ');
  end if;
  -- cada avançada aponta pra UMA regular do pacote (no máximo uma avançada por regular) e tem a MESMA idade dela
  for c in select x from jsonb_array_elements(v_avancadas) x loop
    if coalesce(c ->> 'classe_regular_ref', '') <> all (v_ids_esperados) then
      raise exception 'Importação: classe avançada % sem classe_regular_ref válida (%).', c ->> 'id', coalesce(c ->> 'classe_regular_ref', '(nenhuma)');
    end if;
    if (c ->> 'id') = any (v_ids_esperados) then raise exception 'Importação: classe avançada % com id de classe regular.', c ->> 'id'; end if;
    if (select count(*) from jsonb_array_elements(v_avancadas) y where y ->> 'classe_regular_ref' = c ->> 'classe_regular_ref') > 1 then
      raise exception 'Importação: mais de uma classe avançada para a regular %.', c ->> 'classe_regular_ref';
    end if;
    if (c -> 'idade_minima') is distinct from (select x -> 'idade_minima' from jsonb_array_elements(v_classes) x where x ->> 'id' = c ->> 'classe_regular_ref') then
      raise exception 'Importação: classe avançada % com idade_minima diferente da regular pareada % (a avançada segue a idade da regular).', c ->> 'id', c ->> 'classe_regular_ref';
    end if;
  end loop;

  v_ver_id := public.curriculo_uuid('version:classes-regulares-dsa:' || v_versao_txt);
  select * into v_ver from public.curriculum_versions where id = v_ver_id;
  if found then
    if v_ver.fonte_hash = p_hash then
      return jsonb_build_object('ok', true, 'ja_importado', true, 'curriculum_version_id', v_ver_id, 'fonte_hash', p_hash);
    end if;
    raise exception 'Importação: a versão % já existe com outro conteúdo (hash % ≠ %). Uma versão publicada nunca é editada — gere uma versão nova do manifesto.', v_versao_txt, v_ver.fonte_hash, p_hash;
  end if;

  select max((x ->> 'vigente_desde')::date) into v_vigente_desde from jsonb_array_elements(v_classes || v_avancadas) x;
  if v_vigente_desde is null then raise exception 'Importação: classe sem vigente_desde.'; end if;

  with a as (
    update public.curriculum_versions set status = 'arquivado'
     where origem = 'oficial' and identificador = 'classes-regulares-dsa' and status = 'publicado' and id <> v_ver_id
    returning id, versao
  ) select coalesce(jsonb_agg(jsonb_build_object('id', id, 'versao', versao)), '[]'::jsonb) into v_arquivadas from a;

  insert into public.curriculum_versions (id, origem, identificador, versao, vigente_desde, status, fonte_url, fonte_descricao, fonte_hash, fonte_arquivo, importado_em, importado_por, fonte_detalhes)
  values (
    v_ver_id, 'oficial', 'classes-regulares-dsa', v_versao_txt, v_vigente_desde, 'publicado', null,
    'Classes Regulares de Desbravadores (DSA) — Amigo, Companheiro, Pesquisador, Pioneiro, Excursionista e Guia'
      || case when jsonb_array_length(v_avancadas) > 0 then ', com ' || jsonb_array_length(v_avancadas) || ' Classes Avançadas pareadas' else '' end
      || ' — currículo vigente em ' || extract(year from v_vigente_desde)::int || '. Importado do manifesto curricular ' || v_versao_txt
      || ' (supabase/curriculo-manifesto, gerado em ' || v_gerado_em || '), por migration; proveniência completa em fonte_detalhes.',
    p_hash,
    'supabase/curriculo-manifesto: omds.json + classes/{amigo,companheiro,pesquisador,pioneiro,excursionista,guia}.json (classe_regular'
      || case when jsonb_array_length(v_avancadas) > 0 then ' + classe_avancada' else '' end || ')',
    now(), null,
    jsonb_build_object(
      'manifesto_versao', v_versao_txt, 'gerado_em', v_gerado_em, 'arquivos', p_pacote -> 'arquivos', 'omds', v_omds,
      'documentos_base', (select jsonb_agg(jsonb_build_object('classe', x ->> 'id', 'url', x -> 'fonte_base' ->> 'url', 'publicado_em', x -> 'fonte_base' ->> 'publicado_em') order by x ->> 'id')
                          from jsonb_array_elements(v_classes) x),
      'documentos_base_avancadas', (select jsonb_agg(jsonb_build_object('classe', x ->> 'id', 'regular', x ->> 'classe_regular_ref', 'url', x -> 'fonte_base' ->> 'url', 'publicado_em', x -> 'fonte_base' ->> 'publicado_em') order by x ->> 'id')
                          from jsonb_array_elements(v_avancadas) x)
    )
  );

  for c in select x from jsonb_array_elements(v_classes) x order by x ->> 'id' loop
    v_res := public._curriculo_importar_uma_classe(v_ver_id, v_versao_txt, v_omds, c, 'regular', null);
    v_n_classes := v_n_classes + 1; v_n_secoes := v_n_secoes + (v_res ->> 'secoes')::int; v_n_reqs := v_n_reqs + (v_res ->> 'requisitos')::int;
    v_n_grupos := v_n_grupos + (v_res ->> 'grupos')::int; v_n_opcoes := v_n_opcoes + (v_res ->> 'opcoes')::int; v_n_dinamicos := v_n_dinamicos + (v_res ->> 'dinamicos')::int;
  end loop;
  for c in select x from jsonb_array_elements(v_avancadas) x order by x ->> 'id' loop
    v_res := public._curriculo_importar_uma_classe(v_ver_id, v_versao_txt, v_omds, c, 'avancada', c ->> 'classe_regular_ref');
    v_n_avancadas := v_n_avancadas + 1; v_n_secoes := v_n_secoes + (v_res ->> 'secoes')::int; v_n_reqs := v_n_reqs + (v_res ->> 'requisitos')::int;
    v_n_grupos := v_n_grupos + (v_res ->> 'grupos')::int; v_n_opcoes := v_n_opcoes + (v_res ->> 'opcoes')::int;
    -- pré-requisito: a regular pareada DESTA versão (a checagem vale por código em qualquer versão oficial)
    select id into v_reg from public.classes where curriculum_version_id = v_ver_id and codigo = c ->> 'classe_regular_ref';
    insert into public.curriculum_dependencies (alvo_tipo, alvo_id, depende_de_tipo, depende_de_id, obrigatorio, modo, observacao)
    values ('class', (v_res ->> 'class_id')::uuid, 'class', v_reg.id, true, 'iniciada_ou_concluida',
            'Classe Avançada pareada à regular ' || (c ->> 'classe_regular_ref') || ': feita junto com a regular ou depois (a avançada segue a idade da regular correspondente — https://www.adventistas.org/pt/desbravadores/classes/).');
  end loop;

  return jsonb_build_object('ok', true, 'ja_importado', false, 'curriculum_version_id', v_ver_id, 'fonte_hash', p_hash, 'manifesto_versao', v_versao_txt,
    'arquivadas', v_arquivadas,
    'classes', v_n_classes, 'classes_avancadas', v_n_avancadas, 'secoes', v_n_secoes, 'requisitos', v_n_reqs, 'grupos_n_de_m', v_n_grupos, 'opcoes', v_n_opcoes, 'requisitos_dinamicos', v_n_dinamicos);
end;
$$;
revoke all on function public.curriculo_importar_classes_regulares(jsonb, text) from public, anon, authenticated;

notify pgrst, 'reload schema';

insert into public.migracoes_aplicadas (arquivo)
values ('2026-09-30-importador-classes-avancadas.sql')
on conflict (arquivo) do update set aplicada_em = now();
