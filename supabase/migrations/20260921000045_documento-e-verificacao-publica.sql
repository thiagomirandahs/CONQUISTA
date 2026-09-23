-- =====================================================================
-- Fase 4.1 — Documento (Caderno Digital DesbravaClube) + verificação pública. Rodar DEPOIS da
-- 20260921000044. Idempotente. AINDA SEM assinatura digital/ICP/desenhada — só a camada de dados +
-- RPCs; o visual (HTML/PDF por impressão) e o QR ficam no front.
--
-- Separação conceitual (o PDF NÃO é a fonte da verdade):
--   snapshot selado (class_completion_snapshots, migration 44)
--     → documento emitido (class_documents: aponta pro snapshot + template versionado + token público)
--       → representação PDF (front: página imprimível, função pura do snapshot — regenerável)
--         → verificação pública (documento_verificar(token): só o resumo mínimo + integridade + estado)
--
-- O renderer lê SEMPRE o conteúdo do snapshot (self-contained), nunca o currículo corrente — se o
-- catálogo 2027 mudar/arquivar, o documento 2026 continua reproduzível. O QR aponta pra verificação
-- (a URL /verificar/<token>), nunca carrega os dados curriculares.
--
-- Estados do documento:
--   - 'acompanhamento': antes da investidura (snapshot selado) — Caderno de acompanhamento/conclusão,
--     NUNCA comprovante de investidura.
--   - 'final': só depois de investidura_registrar (member_class 'investida' + investidura ativa).
--   O ESTADO exibido (válido/substituído/revogado) é derivado AO VIVO do status do snapshot, nunca
--   gravado — snapshot 'substituido'/'revogado' reflete na hora.
--
-- Nunca afirma ser registro oficial da Igreja/SGC (nomenclatura no front + disclaimer).
-- =====================================================================

-- ---------------------------------------------------------------------
-- A) templates versionados: melhoria visual futura = versão nova; documento emitido fixa o template
-- ---------------------------------------------------------------------
create table if not exists public.document_templates (
  id uuid primary key default gen_random_uuid(),
  chave text not null,
  versao int not null check (versao >= 1),
  nome text not null,
  descricao text,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  unique (chave, versao)
);
insert into public.document_templates (chave, versao, nome, descricao)
values ('caderno-desbravaclube', 1, 'Caderno Digital DesbravaClube', 'Identidade visual própria (não reproduz arte/logotipo oficial). Conteúdo curricular fiel ao snapshot selado.')
on conflict (chave, versao) do nothing;

alter table public.document_templates enable row level security;
revoke all on public.document_templates from public, anon, authenticated;
drop policy if exists "leitura publica" on public.document_templates;
create policy "leitura publica" on public.document_templates for select to authenticated using (true);
grant select on public.document_templates to authenticated;

-- ---------------------------------------------------------------------
-- B) documento emitido
-- ---------------------------------------------------------------------
-- token público: 20 bytes aleatórios → 20 chars base32 Crockford (sem I/L/O/U; ~100 bits). Não é UUID,
-- não é enumerável, não revela id interno.
create or replace function public._documento_token() returns text
language sql volatile security definer set search_path = '' as $$
  select string_agg(substr('0123456789ABCDEFGHJKMNPQRSTVWXYZ', (get_byte(b, i) % 32) + 1, 1), '')
  from (select extensions.gen_random_bytes(20) b) g, generate_series(0, 19) i;
$$;
revoke all on function public._documento_token() from public, anon, authenticated;

create table if not exists public.class_documents (
  id uuid primary key default gen_random_uuid(),
  snapshot_id uuid not null references public.class_completion_snapshots(id) on delete restrict,
  member_class_id uuid references public.member_classes(id) on delete set null,
  usuario_id uuid references public.profiles(id) on delete set null,
  club_id_origem uuid not null references public.organizational_units(id),
  tipo text not null check (tipo in ('acompanhamento', 'final')),
  template_id uuid not null references public.document_templates(id),
  token_publico text not null unique,
  conferencia text not null,
  emitido_por uuid references public.profiles(id) on delete set null,
  emitido_em timestamptz not null default now(),
  created_at timestamptz not null default now(),
  -- idempotência: um documento por (snapshot, tipo, template) — reemitir devolve o mesmo token/conferência
  unique (snapshot_id, tipo, template_id)
);
create index if not exists idx_class_documents_usuario on public.class_documents (usuario_id);
create index if not exists idx_class_documents_snapshot on public.class_documents (snapshot_id);

alter table public.class_documents enable row level security;
revoke insert, update, delete on public.class_documents from authenticated, anon;
-- leitura autenticada: dono / liderança do clube emissor / liderança de clube com vínculo ativo (= snapshot).
-- O público NÃO lê a tabela — usa só a RPC documento_verificar (resumo mínimo).
drop policy if exists "dono, emissor ou lideranca de clube com vinculo ativo" on public.class_documents;
create policy "dono, emissor ou lideranca de clube com vinculo ativo" on public.class_documents for select to authenticated
using (public._pode_ver_conquista_curricular(usuario_id, club_id_origem));

-- ---------------------------------------------------------------------
-- C) emitir (dono do próprio, ou liderança do clube em uso)
-- ---------------------------------------------------------------------
create or replace function public.documento_emitir(p_member_class_id uuid, p_tipo text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_club uuid := public.clube_atual_id(); v_mc record; v_snap record; v_tpl record;
        v_tipo text; v_token text; v_conf text; v_id uuid; v_ja boolean;
begin
  if v_uid is null or v_club is null then raise exception 'Sem clube em uso.'; end if;
  select * into v_mc from public.member_classes where id = p_member_class_id and club_id = v_club;
  if not found then raise exception 'Classe do membro não encontrada neste clube.'; end if;
  -- dono (vínculo ativo) OU liderança do clube em uso
  if not ((v_mc.usuario_id = v_uid and public.membro_ativo_no_clube(v_club)) or public.pode_gerir_no_clube(v_club)) then
    raise exception 'Sem permissão para emitir este documento.';
  end if;
  perform public._exigir_classes_habilitado(v_club);

  select * into v_snap from public.class_completion_snapshots where member_class_id = v_mc.id and status = 'selado' order by versao desc limit 1;
  if not found then raise exception 'Ainda não há uma conclusão selada para emitir o documento.'; end if;

  -- tipo: 'final' só com investidura registrada; senão 'acompanhamento'. p_tipo pode forçar, respeitando a regra.
  v_tipo := coalesce(p_tipo, case when v_mc.status = 'investida' then 'final' else 'acompanhamento' end);
  if v_tipo not in ('acompanhamento', 'final') then raise exception 'Tipo de documento inválido.'; end if;
  if v_tipo = 'final' and not (v_mc.status = 'investida' and exists (
      select 1 from public.class_investitures i where i.member_class_id = v_mc.id and i.snapshot_id = v_snap.id and i.status = 'registrada')) then
    raise exception 'O documento final só pode ser emitido após a investidura registrada.';
  end if;

  select * into v_tpl from public.document_templates where chave = 'caderno-desbravaclube' and ativo order by versao desc limit 1;
  if not found then raise exception 'Template do documento não encontrado.'; end if;

  select * into v_id from public.class_documents where snapshot_id = v_snap.id and tipo = v_tipo and template_id = v_tpl.id;
  if found then
    select id into v_id from public.class_documents where snapshot_id = v_snap.id and tipo = v_tipo and template_id = v_tpl.id;
    v_ja := true;
  else
    v_token := public._documento_token();
    -- conferência: determinística do (hash do snapshot + token + versão do template) → 8 hex maiúsculos.
    -- token é estável por emissão (idempotente) ⇒ conferência estável ⇒ regeneração determinística.
    v_conf := upper(substr(encode(extensions.digest(v_snap.hash || ':' || v_token || ':' || v_tpl.versao::text, 'sha256'), 'hex'), 1, 8));
    insert into public.class_documents (snapshot_id, member_class_id, usuario_id, club_id_origem, tipo, template_id, token_publico, conferencia, emitido_por)
    values (v_snap.id, v_mc.id, v_mc.usuario_id, v_mc.club_id, v_tipo, v_tpl.id, v_token, v_conf, v_uid)
    returning id into v_id;
    v_ja := false;
  end if;

  return (select jsonb_build_object('ok', true, 'ja_existia', v_ja, 'token', d.token_publico, 'tipo', d.tipo, 'conferencia', d.conferencia,
            'template', jsonb_build_object('chave', v_tpl.chave, 'versao', v_tpl.versao), 'emitido_em', d.emitido_em)
          from public.class_documents d where d.id = v_id);
end;
$$;
revoke all on function public.documento_emitir(uuid, text) from public, anon;
grant execute on function public.documento_emitir(uuid, text) to authenticated;

-- documentos já emitidos de uma matrícula (dono/liderança) — pra tela oferecer "ver/imprimir"
create or replace function public.documentos_da_matricula(p_member_class_id uuid) returns json
language sql stable security definer set search_path = '' as $$
  select coalesce(json_agg(json_build_object('token', d.token_publico, 'tipo', d.tipo, 'conferencia', d.conferencia, 'emitido_em', d.emitido_em,
            'template', json_build_object('chave', tpl.chave, 'versao', tpl.versao)) order by d.emitido_em), '[]'::json)
  from public.class_documents d join public.document_templates tpl on tpl.id = d.template_id
  where d.member_class_id = p_member_class_id and public._pode_ver_conquista_curricular(d.usuario_id, d.club_id_origem);
$$;
revoke all on function public.documentos_da_matricula(uuid) from public, anon;
grant execute on function public.documentos_da_matricula(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- D) estado derivado (compartilhado por render e verificação)
-- ---------------------------------------------------------------------
create or replace function public._documento_estado(p_status_snapshot text, p_tipo text) returns text
language sql immutable as $$
  select case p_status_snapshot
    when 'revogado' then 'revogado'
    when 'substituido' then 'substituido'
    when 'selado' then case when p_tipo = 'final' then 'valido' else 'acompanhamento' end
    else 'desconhecido' end;
$$;
revoke all on function public._documento_estado(text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- E) conteúdo do documento pra renderizar (dono/liderança) — SANITIZADO
--    do snapshot: seções/requisitos/situação/escolhas/datas/aprovações (avaliador nome+papel).
--    NUNCA evidências, comentários internos, URLs assinadas, ids internos, dado operacional do clube.
-- ---------------------------------------------------------------------
create or replace function public.documento_conteudo(p_token text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_d record; v_s record; c jsonb; v_integro boolean;
begin
  select * into v_d from public.class_documents where token_publico = p_token;
  if not found then return null; end if;
  select * into v_s from public.class_completion_snapshots where id = v_d.snapshot_id;
  if not found then return null; end if;
  if not public._pode_ver_conquista_curricular(v_s.usuario_id, v_s.club_id_origem) then return null; end if;
  c := v_s.conteudo;
  v_integro := v_s.hash = public._snapshot_hash(v_s.conteudo);

  return jsonb_build_object(
    'documento', jsonb_build_object(
      'tipo', v_d.tipo, 'conferencia', v_d.conferencia, 'emitido_em', v_d.emitido_em,
      'template', (select jsonb_build_object('chave', tpl.chave, 'versao', tpl.versao, 'nome', tpl.nome) from public.document_templates tpl where tpl.id = v_d.template_id),
      'estado', public._documento_estado(v_s.status, v_d.tipo), 'integro', v_integro),
    'pessoa', jsonb_build_object('nome', c -> 'pessoa' ->> 'nome'),
    'clube_emissor', jsonb_build_object('nome', c -> 'clube_origem' ->> 'nome'),
    'classe', jsonb_build_object('nome', c -> 'classe' ->> 'nome', 'idade_minima', c -> 'classe' -> 'idade_minima', 'fonte_url', c -> 'classe' ->> 'fonte_url'),
    'curriculum_version', jsonb_build_object('identificador', c -> 'curriculum_version' ->> 'identificador', 'versao', c -> 'curriculum_version' ->> 'versao',
                            'manifesto_versao', c -> 'curriculum_version' ->> 'manifesto_versao', 'vigente_desde', c -> 'curriculum_version' ->> 'vigente_desde'),
    -- a chave 'investidura' só existe no documento tipo='final' (omitida, não null, no acompanhamento).
    -- O Caderno de acompanhamento declara explicitamente "não é comprovante de investidura" — não
    -- pode então exibir a data de investidura mesmo que o MESMO snapshot subjacente tenha sido usado
    -- numa investidura depois (achado da inspeção visual desta fase).
    'periodo', jsonb_build_object('iniciada_em', c -> 'matricula' ->> 'iniciada_em', 'concluida_em', c -> 'matricula' ->> 'concluida_em')
      || case when v_d.tipo = 'final' then jsonb_build_object('investidura',
           (select jsonb_build_object('data', i.data_investidura, 'registrado_por_nome', (select nome from public.profiles where id = i.registrado_por), 'registrado_papel', i.registrado_papel)
            from public.class_investitures i where i.member_class_id = v_d.member_class_id and i.snapshot_id = v_s.id and i.status = 'registrada'))
         else '{}'::jsonb end,
    'revisao', (select jsonb_build_object('revisado_em', ir.revisado_em, 'revisado_por_nome', (select nome from public.profiles where id = ir.revisado_por), 'revisado_papel', ir.revisado_papel)
                from public.investiture_reviews ir where ir.snapshot_id = v_s.id and ir.status in ('aprovado', 'investido') order by ir.revisado_em desc limit 1),
    'secoes', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'codigo', sec ->> 'codigo', 'nome', sec ->> 'nome', 'ordem', (sec ->> 'ordem')::int,
        'requisitos', (
          select coalesce(jsonb_agg(jsonb_build_object(
            'codigo', r ->> 'codigo', 'descricao', r ->> 'descricao', 'situacao', r ->> 'status', 'status_fonte', r ->> 'status_fonte',
            'conteudo_dinamico', case when r -> 'conteudo_dinamico' ->> 'valor' is not null then jsonb_build_object('nome', r -> 'conteudo_dinamico' ->> 'nome', 'valor', r -> 'conteudo_dinamico' ->> 'valor') end,
            'escolha', case when r ? 'escolha' and r -> 'escolha' is not null then jsonb_build_object('n_minimo', r -> 'escolha' -> 'n_minimo', 'escolhidas', r -> 'escolha' -> 'escolhidas') end,
            -- responsável pela aprovação: nome + papel + data (NUNCA comentário/evidência)
            'aprovado_por', (select jsonb_build_object('nome', a -> 'avaliado_por' ->> 'nome', 'papel', a ->> 'papel', 'em', a ->> 'em')
                             from jsonb_array_elements(coalesce(r -> 'aprovacoes', '[]'::jsonb)) a where a ->> 'decisao' = 'aprovado' order by a ->> 'em' desc limit 1)
          ) order by (r ->> 'ordem')::int, r ->> 'codigo'), '[]'::jsonb)
          from jsonb_array_elements(sec -> 'requisitos') r
        )
      ) order by (sec ->> 'ordem')::int), '[]'::jsonb)
      from jsonb_array_elements(c -> 'secoes') sec
    ),
    'percentual', c -> 'percentual'
  );
end;
$$;
revoke all on function public.documento_conteudo(text) from public, anon;
grant execute on function public.documento_conteudo(text) to authenticated;

-- ---------------------------------------------------------------------
-- F) verificação PÚBLICA (anon): só o mínimo. Sem requisitos/evidências/avaliadores/histórico.
--    Não enumerável: token de 100 bits; "não encontrado" tem a mesma forma que "encontrado".
-- ---------------------------------------------------------------------
create or replace function public.documento_verificar(p_token text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_d record; v_s record; c jsonb; v_estado text; v_integro boolean;
begin
  if p_token is null or length(p_token) < 12 or length(p_token) > 64 or p_token !~ '^[0-9A-Za-z]+$' then
    return jsonb_build_object('encontrado', false);
  end if;
  select * into v_d from public.class_documents where token_publico = p_token;
  if not found then return jsonb_build_object('encontrado', false); end if;
  select * into v_s from public.class_completion_snapshots where id = v_d.snapshot_id;
  if not found then return jsonb_build_object('encontrado', false); end if;
  c := v_s.conteudo;
  v_estado := public._documento_estado(v_s.status, v_d.tipo);
  v_integro := v_s.hash = public._snapshot_hash(v_s.conteudo);

  return jsonb_build_object(
    'encontrado', true,
    'nome', c -> 'pessoa' ->> 'nome',
    'classe', c -> 'classe' ->> 'nome',
    'clube_emissor', c -> 'clube_origem' ->> 'nome',
    'versao_curricular', (c -> 'curriculum_version' ->> 'identificador') || ' ' || (c -> 'curriculum_version' ->> 'versao'),
    'tipo', v_d.tipo,
    'data_conclusao', c -> 'matricula' ->> 'concluida_em',
    -- mesma regra de documento_conteudo: só o tipo='final' expõe data de investidura
    'data_investidura', case when v_d.tipo = 'final' then
      (select i.data_investidura from public.class_investitures i where i.snapshot_id = v_s.id and i.status = 'registrada' order by i.created_at desc limit 1)
    end,
    'estado', v_estado,
    'integro', v_integro,
    'conferencia', v_d.conferencia,
    'emitido_em', v_d.emitido_em,
    'template', (select tpl.chave || '/' || tpl.versao from public.document_templates tpl where tpl.id = v_d.template_id)
  );
end;
$$;
revoke all on function public.documento_verificar(text) from public;
grant execute on function public.documento_verificar(text) to anon, authenticated;

notify pgrst, 'reload schema';

insert into public.migracoes_aplicadas (arquivo)
values ('2026-09-21-documento-e-verificacao-publica.sql')
on conflict (arquivo) do update set aplicada_em = now();
