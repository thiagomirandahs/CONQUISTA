-- =====================================================================
--  Item 1 (mega-prompt de fechamento) — H2: representação final assinada.
--
--  H1 (class_documents.pdf_hash/pdf_storage_path, migration 88) é o PDF BASE
--  que as assinaturas declaram (document_signatures.pdf_hash = hash do H1 no
--  instante da assinatura, migration 89) — isso NÃO MUDA aqui: a assinatura
--  continua declarando H1, nunca H2.
--
--  H2 é uma representação FINAL, gerada DEPOIS de existir ao menos uma
--  assinatura, mostrando o documento + a lista de signatários (nome, papel,
--  data, se tem desenho) + o hash do H1 que foi assinado + QR de verificação.
--  H2 tem o PRÓPRIO hash — nunca sobrescreve H1, nunca referencia o próprio
--  hash dentro de si mesma (isso seria circular).
--
--  Cada estado de assinaturas (quem assinou, quem revogou) tem NO MÁXIMO uma
--  linha de H2 — regenerar com o MESMO conjunto de assinaturas devolve a
--  MESMA linha (idempotência real, não por sorte de bytes idênticos: o
--  servidor calcula o hash do ESTADO e faz UPSERT nele, a Edge Function nunca
--  decide se já existe). Uma assinatura NOVA (ou uma revogação) muda o
--  estado → produz uma linha NOVA (H2 anterior continua no histórico,
--  nunca é apagada: é isso que a verificação pública pode mostrar como
--  "H2 vigente" vs. "H2 de uma versão anterior de assinaturas").
-- =====================================================================

-- ---------------------------------------------------------------------
-- A) document_final_renders — append-only, nunca sobrescreve.
-- ---------------------------------------------------------------------
create table if not exists public.document_final_renders (
  id                       uuid primary key default gen_random_uuid(),
  -- desempate de "qual é o vigente" quando duas linhas nascem na MESMA transação (now() é estável
  -- dentro de uma transação — criado_em sozinho empataria; um bigserial nunca empata).
  criado_seq               bigserial,
  documento_id             uuid not null references public.class_documents(id) on delete cascade,
  club_id_origem           uuid not null,
  pdf_versao_h1            int not null,
  estado_assinaturas_hash  text not null,
  storage_path             text not null,
  pdf_hash                 text not null check (pdf_hash ~ '^[0-9a-f]{64}$'),
  criado_por               uuid not null references public.profiles(id),
  criado_em                timestamptz not null default now(),
  unique (documento_id, estado_assinaturas_hash)
);
comment on table public.document_final_renders is
  'H2: representação final assinada (documento + lista de signatários + hash do H1). Uma linha por ESTADO de assinaturas do documento — nunca por chamada. Nunca editada: um estado novo (assinatura nova ou revogação) gera uma linha nova, a anterior fica no histórico.';
comment on column public.document_final_renders.estado_assinaturas_hash is
  'sha256 de todas as document_signatures deste documento (id+status, em ordem) — calculado pelo SERVIDOR, nunca recebido do cliente. É a chave de idempotência: mesmo estado, mesma linha.';

create index if not exists ix_document_final_renders_documento on public.document_final_renders (documento_id, criado_seq desc);

-- SEM on delete DE PROPÓSITO — mesma trilha de auditoria de requirement_approvals.avaliado_por/
-- investiture_reviews.revisado_por/curriculum_achievements.revogada_por (teste 63): quem gerou a
-- representação final não pode ser excluído sem que a trilha vire uma pessoa fantasma; o registro
-- em si é histórico imutável (não é revogável/anonimizável como as outras três, é pior).
comment on constraint document_final_renders_criado_por_fkey on public.document_final_renders is
  'SEM on delete DE PROPÓSITO — trilha de auditoria (quem gerou o H2); ver teste 63.';

alter table public.document_final_renders enable row level security;
revoke all on public.document_final_renders from public, anon, authenticated;
-- leitura só pelas RPCs (security definer) — igual document_signatures/class_documents: nenhuma
-- policy de SELECT direta pro cliente, tudo passa por documento_pdf_final_dados/documento_verificar.

drop trigger if exists trg_imutavel on public.document_final_renders;
create trigger trg_imutavel before update or delete on public.document_final_renders
for each row execute function public._proteger_registro_imutavel(); -- nenhuma coluna mutável: é histórico, ponto.

-- ---------------------------------------------------------------------
-- B) estado das assinaturas, calculado pelo SERVIDOR (chave de idempotência e de regeneração).
-- ---------------------------------------------------------------------
create or replace function public._documento_estado_assinaturas_hash(p_documento_id uuid) returns text
language sql stable security definer set search_path = '' as $$
  select encode(extensions.digest(coalesce(string_agg(s.id::text || ':' || s.status, ',' order by s.id), '(nenhuma)'), 'sha256'), 'hex')
  from public.document_signatures s where s.documento_id = p_documento_id;
$$;
revoke all on function public._documento_estado_assinaturas_hash(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- C) dados para a Edge Function montar o H2 — reaproveita documento_conteudo (já sanitizado) e
--    documento_pdf_dados (mesma checagem de autorização), acrescenta a lista de assinaturas e,
--    se já existir uma linha para o estado ATUAL, devolve ela direto (a Edge Function nem monta
--    PDF nenhum nesse caso — é aqui que a idempotência de verdade acontece).
-- ---------------------------------------------------------------------
create or replace function public.documento_pdf_final_dados(p_token text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_d record; v_conteudo jsonb; v_estado_hash text; v_existente record;
begin
  select * into v_d from public.class_documents where token_publico = p_token;
  if not found then return null; end if;
  if not public._pode_ver_conquista_curricular(v_d.usuario_id, v_d.club_id_origem) then return null; end if;
  if v_d.pdf_hash is null then raise exception 'Gere o PDF base (H1) antes da representação final.'; end if;
  if not exists (select 1 from public.document_signatures s where s.documento_id = v_d.id and s.status = 'registrada') then
    raise exception 'Este documento ainda não tem nenhuma assinatura registrada — a representação final só existe depois da primeira assinatura.';
  end if;

  v_conteudo := public.documento_conteudo(p_token);
  if v_conteudo is null then return null; end if;

  v_estado_hash := public._documento_estado_assinaturas_hash(v_d.id);
  select * into v_existente from public.document_final_renders
   where documento_id = v_d.id and estado_assinaturas_hash = v_estado_hash;

  return jsonb_build_object(
    'conteudo', v_conteudo,
    'documento_id', v_d.id, 'club_id_origem', v_d.club_id_origem, 'usuario_id', v_d.usuario_id,
    'pdf_versao_h1', v_d.pdf_versao, 'pdf_hash_h1', v_d.pdf_hash,
    'estado_assinaturas_hash', v_estado_hash,
    'render_existente', case when found then jsonb_build_object(
      'id', v_existente.id, 'pdf_hash', v_existente.pdf_hash, 'storage_path', v_existente.storage_path,
      'criado_em', v_existente.criado_em
    ) end,
    'assinaturas', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'nome', pr.nome, 'papel', s.signatario_papel, 'assinado_em', s.assinado_em,
        'tem_desenho', coalesce(s.dados, '{}'::jsonb) ? 'desenho_path', 'desenho_path', s.dados ->> 'desenho_path'
      ) order by s.assinado_em), '[]'::jsonb)
      from public.document_signatures s join public.profiles pr on pr.id = s.signatario_id
      where s.documento_id = v_d.id and s.status = 'registrada'
    )
  );
end;
$$;
revoke all on function public.documento_pdf_final_dados(text) from public, anon;
grant execute on function public.documento_pdf_final_dados(text) to authenticated;

-- ---------------------------------------------------------------------
-- D) registrar o H2 gerado — idempotente por ESTADO (nunca por chamada): duas chamadas com o mesmo
--    conjunto de assinaturas devolvem a MESMA linha, a segunda upload no Storage é só um upsert do
--    MESMO caminho (o path já é derivado do hash do estado — ver Edge Function).
-- ---------------------------------------------------------------------
create or replace function public.documento_pdf_final_registrar(p_token text, p_hash text, p_storage_path text, p_pdf_versao_h1 int) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_d record; v_estado_hash text; v_id uuid; v_uid uuid := auth.uid();
begin
  select * into v_d from public.class_documents where token_publico = p_token;
  if not found then raise exception 'Documento não encontrado.'; end if;
  if not public._pode_ver_conquista_curricular(v_d.usuario_id, v_d.club_id_origem) then
    raise exception 'Sem permissão para registrar a representação final deste documento.';
  end if;
  if p_pdf_versao_h1 <> v_d.pdf_versao then
    raise exception 'O PDF base (H1) mudou de versão desde que esta representação foi montada — gere de novo.';
  end if;
  if p_hash !~ '^[0-9a-f]{64}$' then raise exception 'Hash inválido.'; end if;
  if p_storage_path is null or p_storage_path !~ ('^' || v_d.club_id_origem::text || '/') then
    raise exception 'Caminho de armazenamento não corresponde a este documento.';
  end if;
  if not exists (select 1 from public.document_signatures s where s.documento_id = v_d.id and s.status = 'registrada') then
    raise exception 'Este documento ainda não tem nenhuma assinatura registrada.';
  end if;

  v_estado_hash := public._documento_estado_assinaturas_hash(v_d.id);

  insert into public.document_final_renders (documento_id, club_id_origem, pdf_versao_h1, estado_assinaturas_hash, storage_path, pdf_hash, criado_por)
  values (v_d.id, v_d.club_id_origem, p_pdf_versao_h1, v_estado_hash, p_storage_path, p_hash, v_uid)
  on conflict (documento_id, estado_assinaturas_hash) do nothing
  returning id into v_id;

  if v_id is null then
    -- já existia (chamada repetida pro MESMO estado) — devolve a linha existente, sem duplicar nada.
    select id into v_id from public.document_final_renders where documento_id = v_d.id and estado_assinaturas_hash = v_estado_hash;
    return jsonb_build_object('ok', true, 'id', v_id, 'gerado_agora', false);
  end if;
  return jsonb_build_object('ok', true, 'id', v_id, 'gerado_agora', true);
end;
$$;
revoke all on function public.documento_pdf_final_registrar(text, text, text, int) from public, anon;
grant execute on function public.documento_pdf_final_registrar(text, text, text, int) to authenticated;

-- ---------------------------------------------------------------------
-- E) verificação pública ganha o H2 vigente (hash + quantas assinaturas incluídas) — nunca o
--    storage_path (é privado). Documento → versão(H1) → assinaturas → H2 → estado, tudo num lugar.
-- ---------------------------------------------------------------------
create or replace function public.documento_verificar(p_token text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_d record; v_s record; c jsonb; v_estado text; v_integro boolean; v_h2 record;
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

  select r.pdf_hash, r.criado_em,
         (select count(*) from public.document_signatures s2 where s2.documento_id = v_d.id and s2.status = 'registrada') as assinaturas_incluidas
    into v_h2
    from public.document_final_renders r
   where r.documento_id = v_d.id
   order by r.criado_seq desc limit 1;

  return jsonb_build_object(
    'encontrado', true,
    'nome', c -> 'pessoa' ->> 'nome',
    'classe', c -> 'classe' ->> 'nome',
    'clube_emissor', c -> 'clube_origem' ->> 'nome',
    'versao_curricular', (c -> 'curriculum_version' ->> 'identificador') || ' ' || (c -> 'curriculum_version' ->> 'versao'),
    'tipo', v_d.tipo,
    'data_conclusao', c -> 'matricula' ->> 'concluida_em',
    'data_investidura', case when v_d.tipo = 'final' then
      (select i.data_investidura from public.class_investitures i where i.snapshot_id = v_s.id and i.status = 'registrada' order by i.created_at desc limit 1)
    end,
    'estado', v_estado,
    'integro', v_integro,
    'conferencia', v_d.conferencia,
    'emitido_em', v_d.emitido_em,
    'template', (select tpl.chave || '/' || tpl.versao from public.document_templates tpl where tpl.id = v_d.template_id),
    'pdf_versao_h1', v_d.pdf_versao,
    'pdf_hash_h1', v_d.pdf_hash,
    'assinaturas', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'nome', pr.nome, 'papel', s.signatario_papel, 'data', s.assinado_em, 'status', s.status
      ) order by s.assinado_em), '[]'::jsonb)
      from public.document_signatures s join public.profiles pr on pr.id = s.signatario_id
      where s.documento_id = v_d.id and s.status = 'registrada'
    ),
    'h2', case when v_h2.pdf_hash is not null then jsonb_build_object(
      'pdf_hash', v_h2.pdf_hash, 'gerado_em', v_h2.criado_em, 'assinaturas_incluidas', v_h2.assinaturas_incluidas
    ) end
  );
end;
$$;
revoke all on function public.documento_verificar(text) from public;
grant execute on function public.documento_verificar(text) to anon, authenticated;

notify pgrst, 'reload schema';

insert into public.migracoes_aplicadas (arquivo)
values ('2026-09-30-representacao-final-assinada-h2.sql')
on conflict (arquivo) do update set aplicada_em = now();
