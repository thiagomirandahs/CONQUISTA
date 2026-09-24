-- =============================================================================
--  Fase 9.1 (item 8) — conteúdo anual das Classes com ANO explícito, vigência FECHADA,
--  sem valor de outro ano, e o valor que a criança usou fica gravado no requisito.
--
--  O que estava errado (auditoria da fase 9, frente "classes-conteudo"):
--
--    · `dynamic_content_values.vigente_ate` podia ser NULL, e um período aberto cobria TODOS os
--      anos seguintes: o livro de 2026 continuaria valendo em 2027 sem aviso. O staging tem os seis
--      "Livro do ano" assim, e o teste 35 consagrava o comportamento ("período aberto vale até ser
--      fechado"). Não havia coluna de ano.
--    · O "hoje" era `current_date` da sessão, em UTC: das 21h às 23h59 de 31/12, no Brasil, o
--      servidor já resolvia o ano seguinte.
--    · O valor era re-resolvido "para hoje" em toda leitura e reconferência, inclusive de requisito
--      JÁ enviado ou aprovado. Com períodos fechados, na virada do ano um requisito aprovado em
--      dezembro viraria "bloqueado" em janeiro (a revisão, o selo e a investidura reconferem), e o
--      reselo de 2027 gravaria o livro de 2027 para quem leu o de 2026.
--    · Não existia caminho de publicação: o valor entrava por INSERT à mão, sem ano, às vezes sem
--      fonte, fora de qualquer manifesto validado.
--
--  O que muda:
--
--    1. `_data_no_brasil(instante)`: a data de referência é a do Brasil (America/Sao_Paulo).
--    2. `dynamic_content_values` ganha `ano` (obrigatório) e a vigência precisa estar FECHADA e
--       DENTRO desse ano (`vigente_ate` obrigatório). Linhas abertas que já existam são fechadas em
--       31/12 do ano em que começam (o mesmo corte vale para período que atravessava o ano). Em
--       produção a tabela nasce vazia; no staging são os seis "Livro do ano [STAGING]", que passam
--       a valer só até 31/12/2026 — é exatamente a regra que o dono pediu.
--    3. O resolvedor procura SÓ o ano da data pedida (nenhum fallback de outro ano) e devolve `ano`
--       e `ano_referencia` (o ano procurado, para a tela dizer "o conteúdo de 2027 ainda não está
--       disponível"). Sem valor, o requisito continua BLOQUEADO com motivo claro.
--    4. O valor é FIXADO no requisito (`member_requirements.conteudo_fixado`) no primeiro envio —
--       ou na aprovação, quando a liderança aprova direto — e daí em diante é ele que vale: na
--       avaliação, nos bloqueios, no selo, no snapshot, na investidura e na tela. A avaliação grava
--       também o que foi avaliado (`requirement_approvals.conteudo_avaliado`). Requisito ainda não
--       enviado continua resolvendo pelo dia de hoje. Requisitos já enviados/aprovados antes desta
--       migration são fixados com o valor que valia na data do envio (ou da última mudança).
--    5. `conteudo_anual_publicar(pacote, hash)`: a ÚNICA porta de publicação, só da plataforma. O
--       pacote vem do manifesto validado (supabase/curriculo-manifesto/conteudo-anual, gerador
--       `npm run curriculo:conteudo-anual:gerar`), com ano, vigência fechada e fonte por item. Mesmo
--       manifesto = no-op; outro manifesto para um ano já publicado = recusado; e o ano precisa
--       ficar coberto de 01/01 a 31/12 para todo slot usado pelo catálogo oficial publicado — senão
--       nada é publicado. O procedimento está em supabase/curriculo-manifesto/PUBLICACAO-CONTEUDO-ANUAL.md.
--    6. Especialidade não usa conteúdo dinâmico até o envio/avaliação de especialidade conferirem
--       o valor como a classe confere (hoje não conferem): um CHECK impede cadastrar isso por engano.
--
--  Aplicada pelo SQL Editor numa transação só, como postgres. Pode rodar de novo.
-- =============================================================================


-- -----------------------------------------------------------------------------
--  1. A data de referência é a do Brasil
-- -----------------------------------------------------------------------------
-- O conteúdo é da plataforma e o piloto é todo no Brasil; quando houver clube em outro fuso, o fuso
-- passa a vir do clube (organizational_units.timezone) — hoje não há.
create or replace function public._data_no_brasil(p_instante timestamptz default now())
returns date
language sql stable set search_path = '' as $$
  select (p_instante at time zone 'America/Sao_Paulo')::date;
$$;
-- (pura: só converte um instante; não lê tabela nenhuma — pode ser chamada por quem estiver logado)
revoke all on function public._data_no_brasil(timestamptz) from public, anon;
grant execute on function public._data_no_brasil(timestamptz) to authenticated;


-- -----------------------------------------------------------------------------
--  2. Ano explícito e vigência fechada dentro do ano
-- -----------------------------------------------------------------------------
alter table public.dynamic_content_values add column if not exists ano int;
alter table public.dynamic_content_values add column if not exists fonte_hash text;
alter table public.dynamic_content_values add column if not exists manifesto_arquivo text;
alter table public.dynamic_content_values add column if not exists publicado_em timestamptz;
comment on column public.dynamic_content_values.ano is 'Ano civil do conteúdo. A vigência fica sempre dentro dele: nenhum valor vale em outro ano.';
comment on column public.dynamic_content_values.fonte_hash is 'sha256 do pacote do manifesto que publicou (conteudo_anual_publicar). NULL = entrou por SQL direto.';

do $$
declare v_fechadas int;
begin
  update public.dynamic_content_values
     set vigente_ate = make_date(extract(year from vigente_desde)::int, 12, 31)
   where vigente_ate is null or vigente_ate > make_date(extract(year from vigente_desde)::int, 12, 31);
  get diagnostics v_fechadas = row_count;
  update public.dynamic_content_values set ano = extract(year from vigente_desde)::int where ano is null;
  raise notice '[84] % período(s) aberto(s) ou atravessando o ano fechado(s) em 31/12 do ano em que começam', v_fechadas;
end $$;

alter table public.dynamic_content_values alter column ano set not null;
alter table public.dynamic_content_values alter column vigente_ate set not null;
alter table public.dynamic_content_values drop constraint if exists dynamic_content_values_vigencia_no_ano;
alter table public.dynamic_content_values add constraint dynamic_content_values_vigencia_no_ano check (
  ano between 2000 and 2999
  and vigente_desde >= make_date(ano, 1, 1)
  and vigente_ate <= make_date(ano, 12, 31)
  and vigente_ate >= vigente_desde);
create index if not exists idx_dynamic_content_values_definicao_ano on public.dynamic_content_values (definicao_id, ano);


-- -----------------------------------------------------------------------------
--  3. O resolvedor: só o ano da data pedida
-- -----------------------------------------------------------------------------
create or replace function public.conteudo_dinamico_resolver(p_chave text, p_data date default public._data_no_brasil())
returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'chave', d.chave, 'valor', v.valor, 'ano', v.ano, 'ano_referencia', extract(year from p_data)::int,
    'vigente_desde', v.vigente_desde, 'vigente_ate', v.vigente_ate,
    'fonte_url', v.fonte_url, 'fonte_descricao', v.fonte_descricao, 'valor_id', v.id
  )
  from public.dynamic_content_definitions d
  left join public.dynamic_content_values v on v.definicao_id = d.id
    and v.ano = extract(year from p_data)::int
    and p_data between v.vigente_desde and v.vigente_ate
  where d.chave = p_chave
  order by v.vigente_desde desc nulls last
  limit 1;
$$;


-- -----------------------------------------------------------------------------
--  4. O valor fixado no requisito
-- -----------------------------------------------------------------------------
alter table public.member_requirements add column if not exists conteudo_fixado jsonb;
comment on column public.member_requirements.conteudo_fixado is
  'Conteúdo anual (Curso de Leitura...) fixado no 1º envio ou na aprovação. Daí em diante vale ele, não o de hoje: a virada do ano não reabre nem troca o que a criança fez.';
alter table public.requirement_approvals add column if not exists conteudo_avaliado jsonb;
comment on column public.requirement_approvals.conteudo_avaliado is 'O conteúdo anual que estava fixado no requisito quando esta avaliação foi feita.';

-- o conteúdo de um requisito: o fixado, se houver; senão o de hoje (Brasil)
create or replace function public._conteudo_do_requisito(p_member_requirement_id uuid, p_chave text)
returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select mr.conteudo_fixado from public.member_requirements mr where mr.id = p_member_requirement_id),
    public.conteudo_dinamico_resolver(p_chave, public._data_no_brasil()));
$$;
revoke all on function public._conteudo_do_requisito(uuid, text) from public, anon, authenticated;

-- fixa uma vez só; sem valor não fixa nada (quem chama já recusou pelos bloqueios)
create or replace function public._fixar_conteudo_do_requisito(p_member_requirement_id uuid, p_momento text)
returns void
language plpgsql security definer set search_path = '' as $$
declare v_mr record; v_chave text; v_cont jsonb;
begin
  select * into v_mr from public.member_requirements where id = p_member_requirement_id;
  if not found or v_mr.conteudo_fixado is not null then return; end if;
  select d.chave into v_chave
    from public.class_requirements r join public.dynamic_content_definitions d on d.id = r.conteudo_dinamico_definicao_id
   where r.id = v_mr.requirement_id;
  if v_chave is null then return; end if;
  v_cont := public.conteudo_dinamico_resolver(v_chave, public._data_no_brasil());
  if v_cont ->> 'valor' is null then return; end if;
  update public.member_requirements
     set conteudo_fixado = v_cont || jsonb_build_object('fixado_em', now(), 'fixado_no', p_momento)
   where id = v_mr.id;
end;
$$;
revoke all on function public._fixar_conteudo_do_requisito(uuid, text) from public, anon, authenticated;

create or replace function public._requisito_bloqueios(p_member_requirement_id uuid)
returns text[]
language plpgsql stable security definer set search_path = '' as $$
declare v_mr record; v_req record; v_out text[] := '{}'; v_dep text[]; v_cont jsonb; v_nome text; v_esc jsonb;
begin
  select * into v_mr from public.member_requirements where id = p_member_requirement_id;
  if not found then return v_out; end if;
  select * into v_req from public.class_requirements where id = v_mr.requirement_id;

  v_dep := public.dependencias_pendentes('class_requirement', v_mr.requirement_id, v_mr.usuario_id, v_mr.club_id);
  if coalesce(array_length(v_dep, 1), 0) > 0 then
    v_out := array_append(v_out, 'Falta concluir antes: ' || array_to_string(v_dep, ', ') || '.');
  end if;

  -- conteúdo anual: o FIXADO no envio/aprovação vale para sempre; sem ele, o do ano de hoje (Brasil).
  -- Nunca o de outro ano.
  if v_req.conteudo_dinamico_definicao_id is not null then
    select public._conteudo_do_requisito(v_mr.id, d.chave), d.nome into v_cont, v_nome
      from public.dynamic_content_definitions d where d.id = v_req.conteudo_dinamico_definicao_id;
    if v_cont is null or v_cont ->> 'valor' is null then
      v_out := array_append(v_out, 'O conteúdo oficial de '
        || coalesce(v_cont ->> 'ano_referencia', extract(year from public._data_no_brasil())::text)
        || ' (' || coalesce(v_nome, 'conteúdo do ano') || ') ainda não está disponível.');
    end if;
  end if;

  v_esc := public._requisito_escolha_estado(p_member_requirement_id);
  if v_esc is not null then
    if jsonb_array_length(v_esc -> 'violacoes_sem_repeticao') > 0 then
      v_out := array_append(v_out, 'Não vale repetir especialidade já realizada antes desta classe: '
        || (select string_agg(x #>> '{}', ', ') from jsonb_array_elements(v_esc -> 'violacoes_sem_repeticao') x) || '.');
    end if;
    if not (v_esc ->> 'satisfeito')::boolean then
      v_out := array_append(v_out, format('Escolha pelo menos %s %s (%s de %s até agora).',
        v_esc ->> 'n_minimo',
        case when (v_esc ->> 'total_opcoes')::int > 0 then 'das ' || (v_esc ->> 'total_opcoes') || ' opções' else 'e informe qual foi' end,
        v_esc ->> 'validas', v_esc ->> 'n_minimo'));
    end if;
  end if;
  return v_out;
end;
$$;

create or replace function public.requisito_enviar(p_requirement_id uuid)
returns json
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_club uuid := public.clube_atual_id(); v_mr record; v_req record; v_bloq text[];
begin
  if v_uid is null or v_club is null then raise exception 'Sem clube em uso.'; end if;
  perform public._exigir_classes_habilitado(v_club);
  select * into v_mr from public.member_requirements
   where requirement_id = p_requirement_id and usuario_id = v_uid and club_id = v_club for update;
  if not found then raise exception 'Requisito não encontrado para você neste clube.'; end if;
  if v_mr.status = 'aprovado' then raise exception 'Este requisito já foi aprovado.'; end if;
  select * into v_req from public.class_requirements where id = p_requirement_id;
  if v_req.evidencia_obrigatoria and coalesce(trim(v_mr.evidencia_texto), '') = '' and coalesce(v_mr.evidencia_path, '') = '' then
    raise exception 'Este requisito exige uma evidência antes de enviar.';
  end if;
  v_bloq := public._requisito_bloqueios(v_mr.id);
  if array_length(v_bloq, 1) > 0 then raise exception 'Requisito bloqueado: %', array_to_string(v_bloq, ' '); end if;
  -- o conteúdo do ano em que a criança ENVIOU passa a ser o do requisito (correção e reenvio não trocam)
  perform public._fixar_conteudo_do_requisito(v_mr.id, 'envio');
  update public.member_requirements set status = 'aguardando_avaliacao', enviado_em = now(), updated_at = now() where id = v_mr.id;
  return json_build_object('ok', true);
end;
$$;

create or replace function public.requisito_avaliar(p_member_requirement_id uuid, p_decisao text, p_comentario text default null)
returns json
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_club uuid := public.clube_atual_id(); v_mr record; v_papel text; v_bloq text[]; v_conteudo jsonb;
begin
  if p_decisao not in ('aprovado', 'correcao_solicitada') then raise exception 'Decisão inválida.'; end if;
  if v_uid is null or v_club is null or not public.pode_gerir_no_clube(v_club) then
    raise exception 'Sem permissão (apenas diretoria/instrutor deste clube).';
  end if;
  perform public._exigir_classes_habilitado(v_club);
  select * into v_mr from public.member_requirements where id = p_member_requirement_id and club_id = v_club for update;
  if not found then raise exception 'Requisito não encontrado neste clube.'; end if;

  if p_decisao = 'aprovado' then
    v_bloq := public._requisito_bloqueios(v_mr.id);
    if array_length(v_bloq, 1) > 0 then raise exception 'Requisito bloqueado: %', array_to_string(v_bloq, ' '); end if;
    -- aprovado direto (sem envio, ex.: observado em reunião): fixa aqui o conteúdo avaliado
    perform public._fixar_conteudo_do_requisito(v_mr.id, 'aprovacao');
  end if;
  select conteudo_fixado into v_conteudo from public.member_requirements where id = v_mr.id;

  v_papel := public.papel_no_clube(v_uid, v_club);
  insert into public.requirement_approvals (member_requirement_id, requirement_id, curriculum_version_id, club_id, decisao, avaliado_por, avaliado_papel, comentario, conteudo_avaliado)
  select v_mr.id, v_mr.requirement_id, ver.id, v_club, p_decisao, v_uid, coalesce(v_papel, '?'), p_comentario, v_conteudo
  from public.class_requirements r
  join public.class_sections s on s.id = r.section_id
  join public.classes c on c.id = s.class_id
  join public.curriculum_versions ver on ver.id = c.curriculum_version_id
  where r.id = v_mr.requirement_id;

  update public.member_requirements set status = p_decisao, updated_at = now() where id = v_mr.id;  -- gatilho de conclusão roda aqui, já com a aprovação gravada
  return json_build_object('ok', true);
end;
$$;

-- Os leitores do conteúdo, trocados sobre a definição REAL (mesmo padrão das migrations 69/70/83):
-- funções grandes que montam JSON, onde reescrever à mão seria o jeito mais fácil de mudar sem
-- perceber algo que ninguém pediu. Cada troca tem de acontecer, senão a migration PARA.
do $$
declare
  v_trocas constant text[][] := array[
    array['public.minha_classe(uuid)',
          $a$'conteudo_dinamico', (select public.conteudo_dinamico_resolver(d.chave, current_date)$a$,
          $b$'conteudo_dinamico', (select public._conteudo_do_requisito(mr.id, d.chave)$b$],
    array['public.classe_avaliacoes_pendentes()',
          $a$'conteudo_dinamico', (select public.conteudo_dinamico_resolver(d.chave, current_date) from$a$,
          $b$'conteudo_dinamico', (select public._conteudo_do_requisito(mr.id, d.chave) from$b$],
    array['public._classe_snapshot_conteudo(uuid)',
          $a$coalesce(public.conteudo_dinamico_resolver(d.chave, current_date), '{}'::jsonb)$a$,
          $b$coalesce(public._conteudo_do_requisito(mr.id, d.chave), '{}'::jsonb)$b$],
    array['public.explicar_requisito_classe(uuid)',
          $a$select public.conteudo_dinamico_resolver(chave, current_date) into v_conteudo$a$,
          $b$select public._conteudo_do_requisito(v_mr.id, chave) into v_conteudo$b$]
  ];
  -- (explicar_requisito_especialidade, reescrita na 83, já chama o resolvedor sem data: vale o
  -- padrão dele, que a seção 3 acima tornou o dia no Brasil)
  v_fonte text; v_novo text; i int;
begin
  for i in 1 .. array_length(v_trocas, 1) loop
    v_fonte := pg_get_functiondef(v_trocas[i][1]::regprocedure);
    if position(v_trocas[i][3] in v_fonte) > 0 then continue; end if;  -- já trocada (a migration rodou antes)
    v_novo := replace(v_fonte, v_trocas[i][2], v_trocas[i][3]);
    if v_novo = v_fonte then
      raise exception '% mudou de forma: o trecho do conteúdo anual não está lá — revise a troca', v_trocas[i][1];
    end if;
    execute v_novo;
  end loop;

  -- o gate desta migration: NENHUMA função resolve conteúdo anual pelo current_date (UTC) de novo
  if exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace
              and p.prosrc ~ 'conteudo_dinamico_resolver\([^)]*current_date') then
    raise exception 'ainda há função resolvendo conteúdo anual com current_date: %',
      (select string_agg(p.proname, ', ') from pg_proc p where p.pronamespace = 'public'::regnamespace
        and p.prosrc ~ 'conteudo_dinamico_resolver\([^)]*current_date');
  end if;
end $$;

-- Requisitos já enviados/aprovados antes desta migration: fixa o valor que valia no dia do envio
-- (ou da última mudança, para o aprovado direto). Sem valor naquele dia, fica sem fixar e segue
-- resolvendo pelo dia de hoje — o mesmo comportamento de antes, só para esse resto.
do $$
declare v_n int;
begin
  update public.member_requirements mr
     set conteudo_fixado = x.v || jsonb_build_object('fixado_em', now(), 'fixado_no', 'migration_84', 'data_de_referencia', x.dia)
    from (
      select mr2.id, public._data_no_brasil(coalesce(mr2.enviado_em, mr2.updated_at)) as dia,
             public.conteudo_dinamico_resolver(d.chave, public._data_no_brasil(coalesce(mr2.enviado_em, mr2.updated_at))) as v
        from public.member_requirements mr2
        join public.class_requirements r on r.id = mr2.requirement_id
        join public.dynamic_content_definitions d on d.id = r.conteudo_dinamico_definicao_id
       where mr2.conteudo_fixado is null and (mr2.status = 'aprovado' or mr2.enviado_em is not null)
    ) x
   where mr.id = x.id and x.v ->> 'valor' is not null;
  get diagnostics v_n = row_count;
  raise notice '[84] % requisito(s) já enviado(s)/aprovado(s) com o conteúdo anual fixado', v_n;
end $$;


-- -----------------------------------------------------------------------------
--  5. A porta de publicação (só a plataforma)
-- -----------------------------------------------------------------------------
create or replace function public.conteudo_anual_publicar(p_pacote jsonb, p_hash text)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_ano int; v_arquivo text; v_item jsonb; v_def_id uuid; v_chave text; v_desde date; v_ate date;
  v_valor text; v_url text; v_desc text; v_novos int := 0; v_ja int := 0; v_lacunas text;
begin
  if p_hash is null or p_hash !~ '^[0-9a-f]{64}$' then raise exception 'Publicação: hash sha256 inválido.'; end if;
  if p_pacote is null or jsonb_typeof(p_pacote) <> 'object' then raise exception 'Publicação: pacote inválido.'; end if;
  perform public._curriculo_exigir_chaves(p_pacote, array['formato', 'ano', 'arquivo', 'itens'], 'o pacote');
  if p_pacote ->> 'formato' is distinct from 'conquista.conteudo_anual/1' then
    raise exception 'Publicação: formato desconhecido (esperado conquista.conteudo_anual/1).';
  end if;
  if jsonb_typeof(p_pacote -> 'ano') is distinct from 'number' or (p_pacote ->> 'ano') !~ '^2[0-9]{3}$' then
    raise exception 'Publicação: "ano" precisa ser o ano civil, com 4 dígitos.';
  end if;
  v_ano := (p_pacote ->> 'ano')::int;
  v_arquivo := nullif(btrim(coalesce(p_pacote ->> 'arquivo', '')), '');
  if v_arquivo is null then raise exception 'Publicação: "arquivo" (o manifesto de origem) é obrigatório.'; end if;
  if jsonb_typeof(p_pacote -> 'itens') is distinct from 'array' or jsonb_array_length(p_pacote -> 'itens') = 0 then
    raise exception 'Publicação: nenhum item no pacote.';
  end if;

  for v_item in select x from jsonb_array_elements(p_pacote -> 'itens') x loop
    perform public._curriculo_exigir_chaves(v_item, array['chave', 'valor', 'vigente_desde', 'vigente_ate', 'fonte_url', 'fonte_descricao'], 'um item');
    v_chave := v_item ->> 'chave';
    select id into v_def_id from public.dynamic_content_definitions where chave = v_chave;
    if v_def_id is null then
      raise exception 'Publicação: a chave "%" não é um conteúdo dinâmico do catálogo.', coalesce(v_chave, '(vazia)');
    end if;
    if coalesce(v_item ->> 'vigente_desde', '') !~ '^\d{4}-\d{2}-\d{2}$' or coalesce(v_item ->> 'vigente_ate', '') !~ '^\d{4}-\d{2}-\d{2}$' then
      raise exception 'Publicação: % precisa de vigência FECHADA (vigente_desde e vigente_ate, AAAA-MM-DD).', v_chave;
    end if;
    v_desde := (v_item ->> 'vigente_desde')::date;
    v_ate := (v_item ->> 'vigente_ate')::date;
    if extract(year from v_desde)::int <> v_ano or extract(year from v_ate)::int <> v_ano or v_ate < v_desde then
      raise exception 'Publicação: a vigência de % (% a %) precisa estar dentro de %.', v_chave, v_desde, v_ate, v_ano;
    end if;
    v_valor := btrim(coalesce(v_item ->> 'valor', ''));
    v_url := btrim(coalesce(v_item ->> 'fonte_url', ''));
    v_desc := btrim(coalesce(v_item ->> 'fonte_descricao', ''));
    if v_valor = '' then raise exception 'Publicação: % sem valor.', v_chave; end if;
    if v_url !~ '^https://[^[:space:]]+$' then raise exception 'Publicação: % sem fonte_url https (de onde veio o conteúdo).', v_chave; end if;
    if v_desc = '' then raise exception 'Publicação: % sem fonte_descricao.', v_chave; end if;

    -- publicado é publicado: o mesmo ano só volta a entrar pelo MESMO manifesto (no-op)
    if exists (select 1 from public.dynamic_content_values v
                where v.definicao_id = v_def_id and v.ano = v_ano and v.fonte_hash is distinct from p_hash) then
      raise exception 'Publicação: % já tem conteúdo de % publicado por outro manifesto (ou fora dele). Nada foi publicado — ver PUBLICACAO-CONTEUDO-ANUAL.md, "Corrigir um conteúdo já publicado".', v_chave, v_ano;
    end if;
    if exists (select 1 from public.dynamic_content_values v
                where v.definicao_id = v_def_id and v.ano = v_ano and v.fonte_hash = p_hash
                  and v.vigente_desde = v_desde and v.vigente_ate = v_ate and v.valor = v_valor) then
      v_ja := v_ja + 1;
      continue;
    end if;
    insert into public.dynamic_content_values (definicao_id, ano, valor, vigente_desde, vigente_ate, fonte_url, fonte_descricao, fonte_hash, manifesto_arquivo, publicado_em)
    values (v_def_id, v_ano, v_valor, v_desde, v_ate, v_url, v_desc, p_hash, v_arquivo, now());
    v_novos := v_novos + 1;
  end loop;

  -- sem lacuna: todo slot usado pelo catálogo OFICIAL publicado precisa cobrir o ano inteiro
  -- (a sobreposição já é recusada pelo gatilho da tabela; então somar os dias basta)
  select string_agg(d.chave, ', ' order by d.chave) into v_lacunas
    from public.dynamic_content_definitions d
   where exists (select 1 from public.class_requirements r
                   join public.class_sections s on s.id = r.section_id
                   join public.classes c on c.id = s.class_id
                   join public.curriculum_versions ver on ver.id = c.curriculum_version_id
                  where r.conteudo_dinamico_definicao_id = d.id and r.ativo and c.ativo
                    and ver.status = 'publicado' and ver.origem = 'oficial')
     and coalesce((select sum(v.vigente_ate - v.vigente_desde + 1) from public.dynamic_content_values v
                    where v.definicao_id = d.id and v.ano = v_ano), 0)
         <> (make_date(v_ano, 12, 31) - make_date(v_ano, 1, 1) + 1);
  if v_lacunas is not null then
    raise exception 'Publicação de %: o ano não fica coberto de 01/01 a 31/12 para: %. Nada foi publicado.', v_ano, v_lacunas;
  end if;

  return jsonb_build_object('ok', true, 'ano', v_ano, 'publicados', v_novos, 'ja_estavam', v_ja, 'fonte_hash', p_hash, 'arquivo', v_arquivo);
end;
$$;
revoke all on function public.conteudo_anual_publicar(jsonb, text) from public, anon, authenticated;


-- -----------------------------------------------------------------------------
--  6. Especialidade não usa conteúdo dinâmico (ainda)
-- -----------------------------------------------------------------------------
-- O envio e a avaliação de especialidade não conferem o valor do ano (a de classe confere). Até
-- conferirem, cadastrar isso num requisito de especialidade seria abrir a regra (d) por engano.
alter table public.specialty_requirements drop constraint if exists specialty_requirements_sem_conteudo_dinamico;
alter table public.specialty_requirements add constraint specialty_requirements_sem_conteudo_dinamico
  check (conteudo_dinamico_definicao_id is null);

notify pgrst, 'reload schema';
