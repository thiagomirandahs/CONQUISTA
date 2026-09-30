-- =============================================================================
--  Fase 7 — Motor de RELATÓRIO ESTRUTURADO + conteúdo de CADA tentativa (Classes)
--
--  O que já existia (migration 87): cada envio congela uma linha imutável em requirement_submissions
--  (texto/foto) e cada decisão fica em requirement_approvals ligada àquela tentativa. Faltava:
--    1) o requisito poder trazer um MODELO de formulário (campos próprios por requisito, não 9 telas);
--    2) a tentativa guardar o CONTEÚDO estruturado e VÁRIOS anexos (não só 1 texto + 1 foto);
--    3) o avaliador e o histórico enxergarem esse conteúdo;
--    4) o arquivo anexado de uma tentativa continuar visível para a liderança do clube.
--
--  Compatibilidade: requisito SEM modelo continua exatamente como era (nenhuma comprovação antiga muda).
--  Requisito COM modelo grava, além do conteúdo, um RESUMO em texto em evidencia_texto (PDF/telas antigas
--  seguem mostrando algo legível).
--
--  Onde mora o modelo: tabela requisito_modelos (versionada, imutável), ligada ao requisito pelo
--  manifesto_id (ex.: 'amigo.I.4') — assim vale para qualquer versão do currículo e NÃO exige versão nova
--  do currículo publicado (que é imutável). Os modelos vêm do manifesto
--  supabase/curriculo-manifesto/modelos-de-relatorio/classes.json (gerado, nunca editado à mão no banco).
-- =============================================================================

-- ==================== 1) modelos de relatório (catálogo global, só leitura por RPC) ====================
create table if not exists public.requisito_modelos (
  id uuid primary key default gen_random_uuid(),
  alvo text not null check (alvo in ('classe')),
  chave text not null check (chave ~ '^[A-Za-z0-9_.-]{3,120}$'),      -- manifesto_id do requisito
  versao int not null default 1 check (versao >= 1),
  schema jsonb not null check (jsonb_typeof(schema) = 'object' and schema ->> 'versao' = '1' and jsonb_typeof(schema -> 'campos') = 'array'),
  categoria text,
  familia text,
  nota text,
  fonte text,
  created_at timestamptz not null default now(),
  unique (alvo, chave, versao)
);
alter table public.requisito_modelos enable row level security;
revoke all on public.requisito_modelos from public, anon, authenticated;

drop trigger if exists trg_requisito_modelo_imutavel on public.requisito_modelos;
create trigger trg_requisito_modelo_imutavel before update or delete on public.requisito_modelos
  for each row execute function public._proteger_registro_imutavel();

-- ==================== 2) validação de conteúdo no SERVIDOR (o cliente só espelha) ====================
-- Mesmas regras de src/lib/relatorio/modelo.js. Devolve a lista de problemas (vazia = ok).
create or replace function public._relatorio_validar_campos(p_campos jsonb, p_dados jsonb, p_envio boolean, p_pref text default '')
returns text[]
language plpgsql stable set search_path = '' as $$
declare
  v_erros text[] := '{}';
  c jsonb; v jsonb; k text; t text; v_rot text; v_obrig boolean; v_max int; v_txt text; v_marc int; v_n int;
  it jsonb; op jsonb; e jsonb; i int; v_sub text[];
begin
  if p_dados is null or jsonb_typeof(p_dados) <> 'object' then return array[p_pref || 'conteúdo inválido']; end if;
  for k in select jsonb_object_keys(p_dados) loop
    if not exists (select 1 from jsonb_array_elements(p_campos) x where x ->> 'chave' = k and x ->> 'tipo' <> 'anexos') then
      v_erros := v_erros || (p_pref || 'campo desconhecido: ' || left(k, 40));
    end if;
  end loop;

  for c in select * from jsonb_array_elements(p_campos) loop
    t := c ->> 'tipo'; k := c ->> 'chave'; v_rot := coalesce(c ->> 'rotulo', k);
    v_obrig := coalesce((c ->> 'obrigatorio')::boolean, false);
    continue when t = 'anexos';
    v := p_dados -> k;
    if v is null or v = 'null'::jsonb then
      if p_envio and v_obrig then v_erros := v_erros || (p_pref || 'Preencha: ' || v_rot); end if;
      continue;
    end if;

    if t in ('texto_curto', 'texto_longo') then
      if jsonb_typeof(v) <> 'string' then v_erros := v_erros || (p_pref || v_rot || ': texto inválido');
      else
        v_txt := v #>> '{}';
        v_max := least(coalesce((c ->> 'max')::int, case t when 'texto_curto' then 200 else 2000 end), 4000);
        if length(v_txt) > v_max then v_erros := v_erros || (p_pref || v_rot || ': passou de ' || v_max || ' caracteres'); end if;
        if p_envio and v_obrig and btrim(v_txt) = '' then v_erros := v_erros || (p_pref || 'Preencha: ' || v_rot); end if;
        if p_envio and (c ->> 'min') is not null and length(btrim(v_txt)) < (c ->> 'min')::int then
          v_erros := v_erros || (p_pref || v_rot || ': escreva pelo menos ' || (c ->> 'min') || ' caracteres');
        end if;
      end if;
    elsif t = 'numero' then
      if jsonb_typeof(v) <> 'number' then v_erros := v_erros || (p_pref || v_rot || ': número inválido');
      else
        if coalesce((c ->> 'inteiro')::boolean, false) and (v #>> '{}')::numeric <> trunc((v #>> '{}')::numeric) then
          v_erros := v_erros || (p_pref || v_rot || ': use número inteiro');
        end if;
        if p_envio and (c ->> 'min') is not null and (v #>> '{}')::numeric < (c ->> 'min')::numeric then
          v_erros := v_erros || (p_pref || v_rot || ': mínimo ' || (c ->> 'min'));
        end if;
        if (c ->> 'max') is not null and (v #>> '{}')::numeric > (c ->> 'max')::numeric then
          v_erros := v_erros || (p_pref || v_rot || ': máximo ' || (c ->> 'max'));
        end if;
      end if;
    elsif t = 'data' then
      v_txt := case when jsonb_typeof(v) = 'string' then v #>> '{}' end;
      if v_txt is null or v_txt !~ '^\d{4}-\d{2}-\d{2}$' then v_erros := v_erros || (p_pref || v_rot || ': data inválida');
      else
        begin
          perform v_txt::date;
          if coalesce((c ->> 'nao_futura')::boolean, false) and v_txt::date > (now() at time zone 'America/Sao_Paulo')::date then
            v_erros := v_erros || (p_pref || v_rot || ': não pode ser no futuro');
          end if;
        exception when others then v_erros := v_erros || (p_pref || v_rot || ': data inválida');
        end;
      end if;
    elsif t = 'selecao' then
      if jsonb_typeof(v) <> 'string' or not exists (select 1 from jsonb_array_elements(c -> 'opcoes') o where o ->> 'chave' = v #>> '{}') then
        v_erros := v_erros || (p_pref || v_rot || ': opção inválida');
      end if;
    elsif t = 'checklist' then
      if jsonb_typeof(v) <> 'object' then v_erros := v_erros || (p_pref || v_rot || ': checklist inválido');
      else
        v_marc := 0;
        for k in select jsonb_object_keys(v) loop
          if not exists (select 1 from jsonb_array_elements(c -> 'itens') x where x ->> 'chave' = k) then v_erros := v_erros || (p_pref || v_rot || ': item desconhecido'); end if;
          if jsonb_typeof(v -> k) <> 'boolean' then v_erros := v_erros || (p_pref || v_rot || ': valor inválido');
          elsif (v -> k)::text = 'true' then v_marc := v_marc + 1; end if;
        end loop;
        if (c ->> 'max_marcados') is not null and v_marc > (c ->> 'max_marcados')::int then v_erros := v_erros || (p_pref || v_rot || ': marque no máximo ' || (c ->> 'max_marcados')); end if;
        if p_envio then
          if (c ->> 'min_marcados') is not null and v_marc < (c ->> 'min_marcados')::int then v_erros := v_erros || (p_pref || v_rot || ': marque pelo menos ' || (c ->> 'min_marcados')); end if;
          for it in select * from jsonb_array_elements(c -> 'itens') loop
            if coalesce((it ->> 'obrigatorio')::boolean, false) and coalesce((v -> (it ->> 'chave'))::text, 'false') <> 'true' then
              v_erros := v_erros || (p_pref || v_rot || ': falta marcar "' || (it ->> 'rotulo') || '"');
            end if;
          end loop;
        end if;
      end if;
    elsif t = 'lista' then
      if jsonb_typeof(v) <> 'array' then v_erros := v_erros || (p_pref || v_rot || ': lista inválida');
      else
        v_max := coalesce((c ->> 'max')::int, 30);
        if jsonb_array_length(v) > v_max then v_erros := v_erros || (p_pref || v_rot || ': no máximo ' || v_max || ' itens'); end if;
        if exists (select 1 from jsonb_array_elements(v) x where jsonb_typeof(x) <> 'string'
                     or length(x #>> '{}') > case when c ->> 'tipo_item' = 'texto_longo' then 2000 else 200 end) then
          v_erros := v_erros || (p_pref || v_rot || ': item inválido');
        elsif p_envio then
          select count(*) into v_n from jsonb_array_elements(v) x where btrim(x #>> '{}') <> '';
          if v_n < coalesce((c ->> 'min')::int, case when v_obrig then 1 else 0 end) then
            v_erros := v_erros || (p_pref || v_rot || ': preencha pelo menos ' || coalesce(c ->> 'min', '1') || ' item(ns)');
          end if;
        end if;
      end if;
    elsif t = 'entradas' then
      if jsonb_typeof(v) <> 'array' then v_erros := v_erros || (p_pref || v_rot || ': entradas inválidas');
      else
        if jsonb_array_length(v) > (c ->> 'max')::int then v_erros := v_erros || (p_pref || v_rot || ': no máximo ' || (c ->> 'max')); end if;
        if p_envio and jsonb_array_length(v) < (c ->> 'min')::int then
          v_erros := v_erros || (p_pref || v_rot || ': faltam entradas (' || jsonb_array_length(v) || '/' || (c ->> 'min') || ')');
        end if;
        i := 0;
        for e in select * from jsonb_array_elements(v) loop
          i := i + 1;
          v_erros := v_erros || public._relatorio_validar_campos(c -> 'campos', e, p_envio, p_pref || coalesce(c ->> 'rotulo_item', 'Item') || ' ' || i || ': ');
        end loop;
      end if;
    elsif t = 'escolha' then
      if jsonb_typeof(v) <> 'object' or jsonb_typeof(v -> 'opcao') <> 'string' then v_erros := v_erros || (p_pref || v_rot || ': escolha inválida');
      else
        select o into op from jsonb_array_elements(c -> 'opcoes') o where o ->> 'chave' = v ->> 'opcao';
        if op is null then v_erros := v_erros || (p_pref || v_rot || ': opção inválida');
        elsif coalesce((op ->> 'pendente')::boolean, false) then v_erros := v_erros || (p_pref || v_rot || ': esta opção ainda não está disponível');
        else
          v_erros := v_erros || public._relatorio_validar_campos(coalesce(op -> 'campos', '[]'::jsonb), coalesce(v -> 'dados', '{}'::jsonb), p_envio, p_pref || (op ->> 'rotulo') || ': ');
        end if;
      end if;
    elsif t = 'confirmacao' then
      if jsonb_typeof(v) <> 'boolean' then v_erros := v_erros || (p_pref || v_rot || ': valor inválido');
      elsif p_envio and v_obrig and v::text <> 'true' then v_erros := v_erros || (p_pref || 'Confirme: ' || v_rot);
      end if;
    end if;
  end loop;
  return v_erros;
end;
$$;
revoke all on function public._relatorio_validar_campos(jsonb, jsonb, boolean, text) from public, anon, authenticated;

-- Valida conteúdo + anexos contra o modelo. p_envio = false (rascunho: só forma) | true (envio: exige o obrigatório).
create or replace function public._relatorio_validar(p_schema jsonb, p_conteudo jsonb, p_anexos jsonb, p_envio boolean)
returns text[]
language plpgsql stable set search_path = '' as $$
declare v_erros text[] := '{}'; v_anx jsonb; v_max int; v_qtd int;
begin
  if p_conteudo is null then p_conteudo := '{}'::jsonb; end if;
  if length(p_conteudo::text) > 40000 then return array['conteúdo grande demais']; end if;
  v_erros := public._relatorio_validar_campos(p_schema -> 'campos', p_conteudo, p_envio, '');
  p_anexos := coalesce(p_anexos, '[]'::jsonb);
  if jsonb_typeof(p_anexos) <> 'array' then return v_erros || 'anexos inválidos'::text; end if;
  select x into v_anx from jsonb_array_elements(p_schema -> 'campos') x where x ->> 'tipo' = 'anexos' limit 1;
  v_qtd := jsonb_array_length(p_anexos);
  if v_anx is null then
    if v_qtd > 0 then v_erros := v_erros || 'este requisito não aceita anexos'::text; end if;
  else
    v_max := coalesce((v_anx ->> 'max')::int, 10);
    if v_qtd > v_max then v_erros := v_erros || ('no máximo ' || v_max || ' anexo(s)'); end if;
    if p_envio and v_qtd < coalesce((v_anx ->> 'min')::int, 0) then v_erros := v_erros || ('Envie pelo menos ' || (v_anx ->> 'min') || ' anexo(s)'); end if;
    if exists (select 1 from jsonb_array_elements(p_anexos) a
                where jsonb_typeof(a) <> 'object' or a ->> 'campo' is distinct from (v_anx ->> 'chave') or coalesce(a ->> 'path', '') = '') then
      v_erros := v_erros || 'anexo inválido'::text;
    end if;
  end if;
  return v_erros;
end;
$$;
revoke all on function public._relatorio_validar(jsonb, jsonb, jsonb, boolean) from public, anon, authenticated;

-- Os arquivos anexados têm de ser DO PRÓPRIO usuário, no clube em uso, e existir de fato no bucket privado.
-- Formatos aceitos (os mesmos da migration 87): <usuario>/… (antigo) ou <clube>/<usuario>/… (novo).
create or replace function public._anexos_do_dono_erros(p_anexos jsonb, p_uid uuid, p_club uuid)
returns text[]
language plpgsql stable security definer set search_path = '' as $$
declare v_erros text[] := '{}'; a jsonb; v_path text; v_seg text[];
begin
  for a in select * from jsonb_array_elements(coalesce(p_anexos, '[]'::jsonb)) loop
    v_path := a ->> 'path';
    if v_path is null or length(v_path) > 300 or v_path ~ '\.\.' or v_path !~ '^[A-Za-z0-9_./-]+$' then
      v_erros := v_erros || 'anexo com caminho inválido'::text; continue;
    end if;
    v_seg := string_to_array(v_path, '/');
    if not (
         (v_seg[1] = p_uid::text)
      or (v_seg[1] = p_club::text and v_seg[2] = p_uid::text)
    ) then
      v_erros := v_erros || 'anexo que não é seu ou é de outro clube'::text; continue;
    end if;
    if not exists (select 1 from storage.objects o where o.bucket_id = 'comprovacoes' and o.name = v_path) then
      v_erros := v_erros || 'anexo não encontrado (envie o arquivo de novo)'::text;
    end if;
  end loop;
  return v_erros;
end;
$$;
revoke all on function public._anexos_do_dono_erros(jsonb, uuid, uuid) from public, anon, authenticated;

-- Resumo legível (para telas/PDF antigos que só sabem mostrar texto). Nunca é fonte de verdade.
create or replace function public._relatorio_resumo(p_campos jsonb, p_dados jsonb, p_pref text default '')
returns text
language plpgsql immutable set search_path = '' as $$
declare c jsonb; v jsonb; t text; k text; r text := ''; e jsonb; i int; op jsonb; it jsonb;
begin
  for c in select * from jsonb_array_elements(p_campos) loop
    t := c ->> 'tipo'; k := c ->> 'chave'; v := p_dados -> k;
    continue when t = 'anexos' or v is null or v = 'null'::jsonb;
    if t in ('texto_curto', 'texto_longo', 'data') then r := r || p_pref || (c ->> 'rotulo') || ': ' || (v #>> '{}') || E'\n';
    elsif t = 'numero' then r := r || p_pref || (c ->> 'rotulo') || ': ' || (v #>> '{}') || coalesce(' ' || (c ->> 'unidade'), '') || E'\n';
    elsif t = 'selecao' then r := r || p_pref || (c ->> 'rotulo') || ': ' || coalesce((select o ->> 'rotulo' from jsonb_array_elements(c -> 'opcoes') o where o ->> 'chave' = v #>> '{}'), v #>> '{}') || E'\n';
    elsif t = 'confirmacao' then r := r || p_pref || case when v::text = 'true' then 'Sim' else 'Não' end || ' — ' || (c ->> 'rotulo') || E'\n';
    elsif t = 'checklist' then
      r := r || p_pref || (c ->> 'rotulo') || ': ';
      for it in select * from jsonb_array_elements(c -> 'itens') loop
        if (v -> (it ->> 'chave'))::text = 'true' then r := r || (it ->> 'rotulo') || '; '; end if;
      end loop;
      r := r || E'\n';
    elsif t = 'lista' then
      r := r || p_pref || (c ->> 'rotulo') || E':\n';
      i := 0;
      for e in select * from jsonb_array_elements(v) loop i := i + 1; r := r || p_pref || '  ' || i || '. ' || (e #>> '{}') || E'\n'; end loop;
    elsif t = 'entradas' then
      i := 0;
      for e in select * from jsonb_array_elements(v) loop
        i := i + 1;
        r := r || p_pref || coalesce(c ->> 'rotulo_item', 'Item') || ' ' || i || E':\n' || public._relatorio_resumo(c -> 'campos', e, p_pref || '  ');
      end loop;
    elsif t = 'escolha' then
      select o into op from jsonb_array_elements(c -> 'opcoes') o where o ->> 'chave' = v ->> 'opcao';
      if op is not null then
        r := r || p_pref || (c ->> 'rotulo') || ': ' || (op ->> 'rotulo') || E'\n' || public._relatorio_resumo(coalesce(op -> 'campos', '[]'::jsonb), coalesce(v -> 'dados', '{}'::jsonb), p_pref || '  ');
      end if;
    end if;
  end loop;
  return left(r, 12000);
end;
$$;
revoke all on function public._relatorio_resumo(jsonb, jsonb, text) from public, anon, authenticated;

-- ==================== 3) Classes: rascunho estruturado e conteúdo de cada tentativa ====================
alter table public.member_requirements
  add column if not exists rascunho jsonb,
  add column if not exists rascunho_anexos jsonb not null default '[]'::jsonb;

alter table public.requirement_submissions
  add column if not exists conteudo jsonb,
  add column if not exists anexos jsonb not null default '[]'::jsonb,
  add column if not exists modelo_versao int;

do $$
declare v_nome text;
begin
  for v_nome in
    select con.conname from pg_constraint con
     where con.conrelid = 'public.requirement_submissions'::regclass and con.contype = 'c'
       and pg_get_constraintdef(con.oid) like '%tipo_evidencia_entregue%'
  loop
    execute format('alter table public.requirement_submissions drop constraint %I', v_nome);
  end loop;
end $$;
alter table public.requirement_submissions add constraint requirement_submissions_tipo_evidencia_entregue_check
  check (tipo_evidencia_entregue in ('nenhuma', 'texto', 'foto', 'arquivo', 'relatorio'));

-- modelo vigente de um requisito de classe (o de maior versão para o manifesto_id dele)
create or replace function public._modelo_da_classe(p_requirement_id uuid)
returns public.requisito_modelos
language sql stable security definer set search_path = '' as $$
  select m.* from public.requisito_modelos m
    join public.class_requirements r on r.manifesto_id = m.chave
   where r.id = p_requirement_id and m.alvo = 'classe'
   order by m.versao desc limit 1;
$$;
revoke all on function public._modelo_da_classe(uuid) from public, anon, authenticated;

create or replace function public._erros_em_texto(p_erros text[]) returns text
language sql immutable set search_path = '' as $$
  select array_to_string((select array_agg(x) from (select unnest(p_erros) x limit 5) s), '; ');
$$;
revoke all on function public._erros_em_texto(text[]) from public, anon, authenticated;

-- ==================== 4) RPCs de Classes ====================
-- Rascunho do formulário (validação só de FORMA: rascunho pode estar incompleto).
create or replace function public.requisito_relatorio_salvar(p_requirement_id uuid, p_conteudo jsonb, p_anexos jsonb default '[]'::jsonb)
returns json
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid(); v_club uuid := public.clube_atual_id(); v_mr record; v_mod public.requisito_modelos; v_erros text[];
begin
  if v_uid is null or v_club is null then raise exception 'Sem clube em uso.'; end if;
  perform public._exigir_classes_habilitado(v_club);
  select * into v_mr from public.member_requirements
   where requirement_id = p_requirement_id and usuario_id = v_uid and club_id = v_club for update;
  if not found or not public._classe_do_catalogo_oficial((select mc.class_id from public.member_classes mc where mc.id = v_mr.member_class_id)) then
    raise exception 'Requisito não encontrado para você neste clube.';
  end if;
  if v_mr.status = 'aprovado' then raise exception 'Este requisito já foi aprovado.'; end if;
  if v_mr.status = 'aguardando_avaliacao' then raise exception 'Este requisito já foi enviado. Aguarde a avaliação.'; end if;
  v_mod := public._modelo_da_classe(p_requirement_id);
  if v_mod.id is null then raise exception 'Este requisito não tem formulário.'; end if;
  v_erros := public._relatorio_validar(v_mod.schema, p_conteudo, p_anexos, false) || public._anexos_do_dono_erros(p_anexos, v_uid, v_club);
  if array_length(v_erros, 1) > 0 then raise exception 'Formulário: %', public._erros_em_texto(v_erros); end if;
  update public.member_requirements
     set rascunho = p_conteudo, rascunho_anexos = coalesce(p_anexos, '[]'::jsonb),
         status = case when status in ('nao_iniciado', 'correcao_solicitada') then 'em_andamento' else status end,
         updated_at = now()
   where id = v_mr.id;
  return json_build_object('ok', true);
end;
$$;
revoke all on function public.requisito_relatorio_salvar(uuid, jsonb, jsonb) from public, anon;
grant execute on function public.requisito_relatorio_salvar(uuid, jsonb, jsonb) to authenticated;

-- Formulário + rascunho + última avaliação, para o DONO do requisito montar a tela.
create or replace function public.requisito_formulario(p_requirement_id uuid)
returns json
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_club uuid := public.clube_atual_id(); v_mr record; v_mod public.requisito_modelos;
begin
  if v_uid is null or v_club is null then raise exception 'Sem clube em uso.'; end if;
  perform public._exigir_classes_habilitado(v_club);
  select * into v_mr from public.member_requirements
   where requirement_id = p_requirement_id and usuario_id = v_uid and club_id = v_club;
  if not found or not public._classe_do_catalogo_oficial((select mc.class_id from public.member_classes mc where mc.id = v_mr.member_class_id)) then
    raise exception 'Requisito não encontrado para você neste clube.';
  end if;
  v_mod := public._modelo_da_classe(p_requirement_id);
  return json_build_object(
    'tem_formulario', v_mod.id is not null,
    'modelo', case when v_mod.id is null then null else json_build_object('versao', v_mod.versao, 'schema', v_mod.schema, 'categoria', v_mod.categoria, 'familia', v_mod.familia, 'nota', v_mod.nota) end,
    'member_requirement_id', v_mr.id,
    'status', v_mr.status,
    'rascunho', v_mr.rascunho,
    'anexos', v_mr.rascunho_anexos,
    'tentativas', (select count(*) from public.requirement_submissions s where s.member_requirement_id = v_mr.id),
    'ultima_avaliacao', (
      select json_build_object('decisao', ap.decisao, 'comentario', ap.comentario, 'avaliado_em', ap.created_at, 'avaliado_papel', ap.avaliado_papel, 'avaliado_por_nome', av.nome)
        from public.requirement_approvals ap left join public.profiles av on av.id = ap.avaliado_por
       where ap.member_requirement_id = v_mr.id order by ap.created_at desc limit 1)
  );
end;
$$;
revoke all on function public.requisito_formulario(uuid) from public, anon;
grant execute on function public.requisito_formulario(uuid) to authenticated;

-- Envio: requisito COM formulário valida no servidor e CONGELA conteúdo + anexos na tentativa (imutável).
-- Requisito SEM formulário: caminho idêntico ao da migration 87.
create or replace function public.requisito_enviar(p_requirement_id uuid) returns json
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid(); v_club uuid := public.clube_atual_id();
  v_mr record; v_req record; v_bloq text[]; v_tipo text; v_prox_tentativa int; v_submission_id uuid;
  v_mod public.requisito_modelos; v_erros text[]; v_resumo text; v_primeiro text; v_usa_modelo boolean;
begin
  if v_uid is null or v_club is null then raise exception 'Sem clube em uso.'; end if;
  perform public._exigir_classes_habilitado(v_club);
  select * into v_mr from public.member_requirements
   where requirement_id = p_requirement_id and usuario_id = v_uid and club_id = v_club for update;
  if not found or not public._classe_do_catalogo_oficial((select mc.class_id from public.member_classes mc where mc.id = v_mr.member_class_id)) then
    raise exception 'Requisito não encontrado para você neste clube.';
  end if;
  if v_mr.status = 'aprovado' then raise exception 'Este requisito já foi aprovado.'; end if;
  select * into v_req from public.class_requirements where id = p_requirement_id;
  v_mod := public._modelo_da_classe(p_requirement_id);
  -- MODO COMPATÍVEL: quem nunca abriu o formulário (rascunho vazio) — tela antiga em cache, requisito já em andamento
  -- com texto/foto — segue pelo caminho de sempre. Quem usou o formulário é validado por inteiro, no servidor.
  v_usa_modelo := v_mod.id is not null and v_mr.rascunho is not null;

  if not v_usa_modelo then
    if v_req.evidencia_obrigatoria and coalesce(trim(v_mr.evidencia_texto), '') = '' and coalesce(v_mr.evidencia_path, '') = '' then
      raise exception 'Este requisito exige uma evidência antes de enviar.';
    end if;
  else
    v_erros := public._relatorio_validar(v_mod.schema, coalesce(v_mr.rascunho, '{}'::jsonb), v_mr.rascunho_anexos, true)
            || public._anexos_do_dono_erros(v_mr.rascunho_anexos, v_uid, v_club);
    if array_length(v_erros, 1) > 0 then raise exception 'Formulário incompleto: %', public._erros_em_texto(v_erros); end if;
  end if;

  v_bloq := public._requisito_bloqueios(v_mr.id);
  if array_length(v_bloq, 1) > 0 then raise exception 'Requisito bloqueado: %', array_to_string(v_bloq, ' '); end if;
  perform public._fixar_conteudo_do_requisito(v_mr.id, 'envio');

  select coalesce(max(tentativa_numero), 0) + 1 into v_prox_tentativa
    from public.requirement_submissions where member_requirement_id = v_mr.id;

  if not v_usa_modelo then
    v_tipo := case
      when v_mr.evidencia_path is not null and v_req.tipo_evidencia = 'arquivo' then 'arquivo'
      when v_mr.evidencia_path is not null then 'foto'
      when coalesce(trim(v_mr.evidencia_texto), '') <> '' then 'texto'
      else 'nenhuma'
    end;
    insert into public.requirement_submissions (member_requirement_id, tentativa_numero, tipo_evidencia_entregue, evidencia_texto, evidencia_path)
    values (v_mr.id, v_prox_tentativa, v_tipo, v_mr.evidencia_texto, v_mr.evidencia_path)
    returning id into v_submission_id;
  else
    v_resumo := public._relatorio_resumo(v_mod.schema -> 'campos', coalesce(v_mr.rascunho, '{}'::jsonb));
    v_primeiro := v_mr.rascunho_anexos -> 0 ->> 'path';
    insert into public.requirement_submissions
      (member_requirement_id, tentativa_numero, tipo_evidencia_entregue, evidencia_texto, evidencia_path, conteudo, anexos, modelo_versao)
    values (v_mr.id, v_prox_tentativa, 'relatorio', nullif(v_resumo, ''), v_primeiro, coalesce(v_mr.rascunho, '{}'::jsonb), v_mr.rascunho_anexos, v_mod.versao)
    returning id into v_submission_id;
    -- telas/PDF antigos leem estes dois campos: recebem o resumo legível
    update public.member_requirements set evidencia_texto = nullif(v_resumo, ''), evidencia_path = coalesce(v_primeiro, evidencia_path) where id = v_mr.id;
  end if;

  update public.member_requirements set status = 'aguardando_avaliacao', enviado_em = now(), updated_at = now() where id = v_mr.id;
  return json_build_object('ok', true, 'submission_id', v_submission_id, 'tentativa_numero', v_prox_tentativa);
end;
$$;
revoke all on function public.requisito_enviar(uuid) from public, anon;
grant execute on function public.requisito_enviar(uuid) to authenticated;

-- Histórico: agora com o CONTEÚDO e os anexos de cada tentativa (e o modelo, para desenhar o relatório).
create or replace function public.requisito_historico(p_member_requirement_id uuid) returns json
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_club uuid := public.clube_atual_id(); v_mr record; v_mod public.requisito_modelos;
begin
  if v_uid is null or v_club is null then raise exception 'Sem clube em uso.'; end if;
  select * into v_mr from public.member_requirements
   where id = p_member_requirement_id and club_id = v_club
     and (usuario_id = v_uid or public.pode_gerir_no_clube(v_club));
  if not found then raise exception 'Requisito não encontrado para você neste clube.'; end if;
  v_mod := public._modelo_da_classe(v_mr.requirement_id);

  return json_build_object(
    'requirement_id', v_mr.requirement_id,
    'status_atual', v_mr.status,
    'modelo', case when v_mod.id is null then null else json_build_object('versao', v_mod.versao, 'schema', v_mod.schema, 'familia', v_mod.familia) end,
    'tentativas', (
      select coalesce(json_agg(json_build_object(
        'submission_id', sub.id,
        'tentativa_numero', sub.tentativa_numero,
        'tipo_evidencia', sub.tipo_evidencia_entregue,
        'evidencia_texto', sub.evidencia_texto,
        'evidencia_path', sub.evidencia_path,
        'conteudo', sub.conteudo,
        'anexos', sub.anexos,
        'modelo_versao', sub.modelo_versao,
        'enviado_em', sub.enviado_em,
        'decisao', ap.decisao,
        'avaliado_por_nome', av.nome,
        'avaliado_papel', ap.avaliado_papel,
        'comentario', ap.comentario,
        'avaliado_em', ap.created_at
      ) order by sub.tentativa_numero), '[]'::json)
      from public.requirement_submissions sub
      left join public.requirement_approvals ap on ap.submission_id = sub.id
      left join public.profiles av on av.id = ap.avaliado_por
      where sub.member_requirement_id = v_mr.id
    )
  );
end;
$$;
revoke all on function public.requisito_historico(uuid) from public, anon;
grant execute on function public.requisito_historico(uuid) to authenticated;

-- Fila de avaliação: a tentativa mais recente agora traz conteudo/anexos/modelo (mesma base da migration 87).
create or replace function public.classe_avaliacoes_pendentes() returns json
language plpgsql stable security definer set search_path = '' as $$
declare v_club uuid := public.clube_atual_id();
begin
  if v_club is null or not public.pode_gerir_no_clube(v_club) then return '[]'::json; end if;
  perform public._exigir_classes_habilitado(v_club);
  return coalesce((
    select json_agg(json_build_object(
      'member_requirement_id', mr.id,
      'submission_id', sub.id,
      'tentativa_numero', sub.tentativa_numero,
      'usuario_id', p.id, 'usuario_nome', p.nome, 'usuario_foto', p.foto,
      'classe_nome', c.nome, 'secao_nome', s.nome,
      'requisito_id', r.id, 'requisito_codigo', r.codigo, 'requisito_descricao', r.descricao,
      'tipo_evidencia', coalesce(sub.tipo_evidencia_entregue, r.tipo_evidencia),
      'evidencia_texto', coalesce(sub.evidencia_texto, mr.evidencia_texto),
      'evidencia_path', coalesce(sub.evidencia_path, mr.evidencia_path),
      'conteudo', sub.conteudo,
      'anexos', coalesce(sub.anexos, '[]'::jsonb),
      'modelo', (select json_build_object('versao', m.versao, 'schema', m.schema, 'familia', m.familia)
                   from public.requisito_modelos m where m.alvo = 'classe' and m.chave = r.manifesto_id and m.versao = sub.modelo_versao),
      'enviado_em', mr.enviado_em,
      'escolha', public._requisito_escolha_estado(mr.id),
      'conteudo_dinamico', (select public._conteudo_do_requisito(mr.id, d.chave) from public.dynamic_content_definitions d where d.id = r.conteudo_dinamico_definicao_id),
      'bloqueios', to_json(public._requisito_bloqueios(mr.id)),
      'unidade_nome', u.nome
    ) order by mr.enviado_em)
    from public.member_requirements mr
    join public.member_classes mc on mc.id = mr.member_class_id
    join public.class_requirements r on r.id = mr.requirement_id
    join public.class_sections s on s.id = r.section_id
    join public.classes c on c.id = s.class_id
    join public.profiles p on p.id = mr.usuario_id
    left join lateral (
      select * from public.requirement_submissions s2
       where s2.member_requirement_id = mr.id order by s2.tentativa_numero desc limit 1
    ) sub on true
    left join public.organization_memberships om on om.user_id = mr.usuario_id and om.organizational_unit_id = mr.club_id and om.status = 'ativo'
    left join public.unidades u on u.id = om.unidade_id
    where mr.club_id = v_club and mr.status = 'aguardando_avaliacao'
      and public._classe_do_catalogo_oficial(mc.class_id)
  ), '[]'::json);
end;
$$;
revoke all on function public.classe_avaliacoes_pendentes() from public, anon;
grant execute on function public.classe_avaliacoes_pendentes() to authenticated;

-- ==================== 5) quem confirma NUNCA é o próprio membro ====================
-- (vale para Classes E Especialidades — requirement_approvals é polimórfica). Erro dedicado, sem oráculo.
create or replace function public._bloquear_autoaprovacao() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_dono uuid;
begin
  if new.member_requirement_id is not null then
    select usuario_id into v_dono from public.member_requirements where id = new.member_requirement_id;
  elsif new.member_specialty_requirement_id is not null then
    select usuario_id into v_dono from public.member_specialty_requirements where id = new.member_specialty_requirement_id;
  end if;
  if v_dono is not null and new.avaliado_por is not null and v_dono = new.avaliado_por then
    raise exception 'Você não pode avaliar o seu próprio requisito.';
  end if;
  return new;
end;
$$;
revoke all on function public._bloquear_autoaprovacao() from public, anon, authenticated;
drop trigger if exists trg_bloquear_autoaprovacao on public.requirement_approvals;
create trigger trg_bloquear_autoaprovacao before insert on public.requirement_approvals
  for each row execute function public._bloquear_autoaprovacao();

-- ==================== 6) arquivos anexados continuam visíveis à liderança e não ficam "órfãos" ====================
create or replace function public.lideranca_ve_comprovacao(p_objeto text)
 returns boolean
 language sql
 stable security definer
 set search_path to ''
as $function$
  select public.pode_gerir_no_clube(public.clube_atual_id())
     and exists (
       select 1 from public.member_requirements x
        where x.evidencia_path = p_objeto and x.club_id = public.clube_atual_id()
       union all
       select 1 from public.member_requirements x, jsonb_array_elements(x.rascunho_anexos) a
        where a ->> 'path' = p_objeto and x.club_id = public.clube_atual_id()
       union all
       select 1 from public.requirement_submissions x
        where x.evidencia_path = p_objeto and x.club_id = public.clube_atual_id()
       union all
       select 1 from public.requirement_submissions x, jsonb_array_elements(x.anexos) a
        where a ->> 'path' = p_objeto and x.club_id = public.clube_atual_id()
       union all
       select 1 from public.member_specialty_requirements x
        where x.evidencia_path = p_objeto and x.club_id = public.clube_atual_id()
       union all
       select 1 from public.entregas x
        where x.foto_url = p_objeto and x.club_id = public.clube_atual_id()
       union all
       select 1 from public.missoes_feitas x
        where x.foto_url = p_objeto and x.club_id = public.clube_atual_id()
       union all
       select 1 from public.devocional x
        where x.foto_url = p_objeto and x.club_id = public.clube_atual_id()
       union all
       select 1 from public.experience_submissions x
        where x.arquivo_path = p_objeto and x.club_id = public.clube_atual_id()
     );
$function$;

create or replace function public._comprovacao_referenciada(p_nome text) returns boolean
language sql stable security definer set search_path = '' as $$
  select (auth.uid() is not null and p_nome not like auth.uid()::text || '/%')
      or exists (select 1 from public.member_requirements where evidencia_path = p_nome)
      or exists (select 1 from public.member_requirements x, jsonb_array_elements(x.rascunho_anexos) a where a ->> 'path' = p_nome)
      or exists (select 1 from public.requirement_submissions where evidencia_path = p_nome)
      or exists (select 1 from public.requirement_submissions x, jsonb_array_elements(x.anexos) a where a ->> 'path' = p_nome)
      or exists (select 1 from public.member_specialty_requirements where evidencia_path = p_nome)
      or exists (select 1 from public.class_completion_snapshots where strpos(conteudo::text, p_nome) > 0);
$$;
revoke all on function public._comprovacao_referenciada(text) from public, anon;
grant execute on function public._comprovacao_referenciada(text) to authenticated;

select public._manutencao_instalar_guarda();
notify pgrst, 'reload schema';
