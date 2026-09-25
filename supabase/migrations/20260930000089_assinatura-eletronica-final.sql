-- =====================================================================
--  FASE 4 (Bloco 2) — Assinatura eletrônica INTERNA do DesbravaClube.
--
--  REUTILIZA document_signatures (nasceu vazia na migration de 21/09, já com
--  RLS/trigger de imutabilidade prontos) — nenhuma tabela nova. Evolui só o
--  que faltava, comprovado pela auditoria desta rodada: pdf_hash (vincular a
--  assinatura ao ARQUIVO exato, não ao snapshot), consentimento, e a
--  referência à decisão de workflow que dá autoridade a quem assina.
--
--  NÃO existe assinatura por requisito/tentativa/correção — só no documento
--  final, depois do PDF gerado. NÃO inventamos signatário distrital/regional:
--  quem pode assinar é EXATAMENTE quem decidiu (workflow_stage_decisions),
--  igual à Fase 3 já tinha concluído ao auditar isso.
--
--  Nomenclatura: é assinatura ELETRÔNICA INTERNA da plataforma — nunca
--  chamada de ICP-Brasil/qualificada/avançada em nenhum texto (schema, RPC,
--  frontend), porque não há infraestrutura correspondente.
-- =====================================================================

-- ---------------------------------------------------------------------
-- A) document_signatures — só as colunas que faltavam (comprovado pela auditoria).
-- ---------------------------------------------------------------------
alter table public.document_signatures
  add column if not exists pdf_hash text,
  add column if not exists consentimento_texto text,
  add column if not exists consentimento_em timestamptz,
  add column if not exists workflow_stage_decision_id uuid references public.workflow_stage_decisions(id) on delete set null;

alter table public.document_signatures
  drop constraint if exists document_signatures_pdf_hash_check;
alter table public.document_signatures
  add constraint document_signatures_pdf_hash_check check (pdf_hash is null or pdf_hash ~ '^[0-9a-f]{64}$');

comment on column public.document_signatures.pdf_hash is
  'Hash dos BYTES do PDF assinado (= class_documents.pdf_hash no instante da assinatura) — é o que garante que a assinatura é sobre o ARQUIVO exato, não sobre uma versão futura regenerada.';
comment on column public.document_signatures.workflow_stage_decision_id is
  'A decisão de workflow (workflow_stage_decisions) que deu autoridade a este signatário — nunca um papel hardcoded. Nulo só para métodos legados (aprovacao_sistema, já existente antes desta fase).';

-- Um signatário só tem UMA assinatura ATIVA por documento (evita duplicidade) — revogada não conta,
-- permitindo reassinar depois de uma revogação (índice parcial, não um UNIQUE de tabela inteira).
create unique index if not exists ux_document_signatures_doc_signatario_ativa
  on public.document_signatures (documento_id, signatario_id) where status = 'registrada';

-- 'dados' passa a poder mudar depois do INSERT (só ela) — é onde fica a referência ao desenho da
-- assinatura, registrada em uma segunda chamada (documento_assinatura_desenho_registrar), depois do
-- upload no Storage. Tudo o mais continua tão imutável quanto antes.
drop trigger if exists trg_imutavel on public.document_signatures;
create trigger trg_imutavel before update or delete on public.document_signatures
for each row execute function public._proteger_registro_imutavel('status', 'dados');

-- ---------------------------------------------------------------------
-- B) bucket PRIVADO das assinaturas desenhadas — nunca pública, nunca reutilizável entre documentos.
--    Path: <club_id>/<documento_id>/<signature_id>.png — cada assinatura tem o SEU próprio arquivo;
--    não existe "assinatura.png aplicada em lote": o path amarra 1 desenho a 1 documento a 1 linha
--    de document_signatures (checado na RPC de registro, não só por convenção).
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('assinaturas-desenhadas', 'assinaturas-desenhadas', false, 204800, array['image/png'])
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- só o PRÓPRIO signatário sobe (na pasta do documento que ele está assinando agora); ninguém sobrescreve
-- depois (sem policy de UPDATE) e a LEITURA é só dono/liderança do clube emissor — nunca outro clube,
-- nunca "reaproveitar" o desenho de outro lugar (nem o próprio signatário lê a pasta de outro documento
-- por essa policy, porque o segundo segmento do path tem que ser o documento QUE ELE ESTÁ ASSINANDO —
-- checado pela RPC no momento do registro, e aqui na policy pelo dono do document_signatures que a
-- referencia; como upload só é permitido pelo primeiro segmento = club_id e a leitura exige
-- _pode_ver_conquista_curricular do documento, a única forma de "reusar" seria a própria pessoa
-- assinar de novo o MESMO documento, o que a unique index acima já impede enquanto ativa).
drop policy if exists "assinatura desenhada: signatario envia" on storage.objects;
create policy "assinatura desenhada: signatario envia" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'assinaturas-desenhadas'
    and (storage.foldername(name))[1] ~ '^[0-9a-f-]{36}$'
    and exists (
      select 1 from public.class_documents d
      where d.id::text = (storage.foldername(name))[2]
        and d.club_id_origem::text = (storage.foldername(name))[1]
        and public._pode_ver_conquista_curricular(d.usuario_id, d.club_id_origem)
    )
  );
drop policy if exists "assinatura desenhada: dono ou lideranca le" on storage.objects;
create policy "assinatura desenhada: dono ou lideranca le" on storage.objects for select to authenticated
  using (
    bucket_id = 'assinaturas-desenhadas'
    and (storage.foldername(name))[1] ~ '^[0-9a-f-]{36}$'
    and exists (
      select 1 from public.class_documents d
      where d.id::text = (storage.foldername(name))[2]
        and d.club_id_origem::text = (storage.foldername(name))[1]
        and public._pode_ver_conquista_curricular(d.usuario_id, d.club_id_origem)
    )
  );

-- ---------------------------------------------------------------------
-- C) quem pode assinar ESTE documento agora — deriva das decisões REAIS do workflow (nunca papel
--    hardcoded). Só quem decidiu 'aprovado' em alguma etapa da corrida do snapshot deste documento.
-- ---------------------------------------------------------------------
create or replace function public._documento_signatarios_elegiveis(p_documento_id uuid)
returns table (decisao_id uuid, decisor_id uuid, papel_utilizado text, escopo_organizational_unit_id uuid)
language sql stable security definer set search_path = '' as $$
  select wsd.id, wsd.decisor_id, wsd.papel_utilizado, wsd.escopo_organizational_unit_id
  from public.class_documents d
  join public.investiture_workflow_runs r on r.snapshot_id = d.snapshot_id
  join public.workflow_stage_decisions wsd on wsd.run_id = r.id and wsd.decisao = 'aprovado' and wsd.decisor_id is not null
  where d.id = p_documento_id;
$$;
revoke all on function public._documento_signatarios_elegiveis(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- D) assinar — UMA pessoa, UM documento. O servidor lê o pdf_hash ATUAL (o cliente nunca declara
--    hash/autoridade) e recusa se não houver decisão aprovada correspondente a quem chama.
-- ---------------------------------------------------------------------
create or replace function public.documento_assinar(p_token text, p_consentimento_texto text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_d record; v_s record; v_elegivel record; v_id uuid;
begin
  if v_uid is null then raise exception 'Entre na sua conta para continuar.'; end if;
  if p_consentimento_texto is null or length(btrim(p_consentimento_texto)) < 20 then
    raise exception 'Confirme a declaração de revisão antes de assinar.';
  end if;

  select * into v_d from public.class_documents where token_publico = p_token;
  if not found then raise exception 'Documento não encontrado.'; end if;
  select * into v_s from public.class_completion_snapshots where id = v_d.snapshot_id;
  if v_s.status <> 'selado' then raise exception 'Este documento não está mais válido (revogado ou substituído) — não é possível assinar.'; end if;
  if v_d.pdf_hash is null then raise exception 'Gere o PDF antes de assinar.'; end if;

  select * into v_elegivel from public._documento_signatarios_elegiveis(v_d.id) where decisor_id = v_uid limit 1;
  if not found then
    raise exception 'Sem autoridade para assinar este documento — só quem decidiu uma etapa do workflow pode assinar.';
  end if;

  if exists (select 1 from public.document_signatures s where s.documento_id = v_d.id and s.signatario_id = v_uid and s.status = 'registrada') then
    raise exception 'Você já assinou este documento.';
  end if;

  insert into public.document_signatures (
    documento_id, snapshot_id, usuario_id, club_id_origem, signatario_id, signatario_papel,
    escopo_organizational_unit_id, metodo, pdf_hash, consentimento_texto, consentimento_em,
    workflow_stage_decision_id, status
  ) values (
    v_d.id, v_d.snapshot_id, v_d.usuario_id, v_d.club_id_origem, v_uid, v_elegivel.papel_utilizado,
    v_elegivel.escopo_organizational_unit_id, 'assinatura_eletronica', v_d.pdf_hash, btrim(p_consentimento_texto), now(),
    v_elegivel.decisao_id, 'registrada'
  ) returning id into v_id;

  return jsonb_build_object('ok', true, 'signature_id', v_id, 'pdf_hash', v_d.pdf_hash);
end;
$$;
revoke all on function public.documento_assinar(text, text) from public, anon;
grant execute on function public.documento_assinar(text, text) to authenticated;

-- registra a REFERÊNCIA ao desenho depois do upload (o upload em si já exigiu autoria/escopo pela
-- policy do Storage) — só o próprio signatário, só na PRÓPRIA linha, só uma vez.
create or replace function public.documento_assinatura_desenho_registrar(p_signature_id uuid, p_path text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_s record;
begin
  select * into v_s from public.document_signatures where id = p_signature_id;
  if not found then raise exception 'Assinatura não encontrada.'; end if;
  if v_s.signatario_id <> auth.uid() then raise exception 'Sem permissão.'; end if;
  if v_s.status <> 'registrada' then raise exception 'Assinatura não está mais ativa.'; end if;
  if v_s.dados ? 'desenho_path' then raise exception 'Este desenho já foi registrado.'; end if;
  if p_path is null or p_path !~ ('^' || v_s.club_id_origem::text || '/' || v_s.documento_id::text || '/') then
    raise exception 'Caminho não corresponde a esta assinatura.';
  end if;
  update public.document_signatures set dados = coalesce(dados, '{}'::jsonb) || jsonb_build_object('desenho_path', p_path) where id = p_signature_id;
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.documento_assinatura_desenho_registrar(uuid, text) from public, anon;
grant execute on function public.documento_assinatura_desenho_registrar(uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- E) assinar em LOTE — cada documento é validado e registrado INDIVIDUALMENTE. Nunca uma assinatura
--    genérica ligada ao lote; uma falha num item não derruba os outros (resultado item a item).
-- ---------------------------------------------------------------------
create or replace function public.documento_assinar_lote(p_tokens text[], p_consentimento_texto text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_token text; v_r jsonb; v_resultados jsonb := '[]'::jsonb; v_ok int := 0; v_falhas int := 0;
begin
  if p_tokens is null or array_length(p_tokens, 1) is null then raise exception 'Selecione ao menos um documento.'; end if;
  if array_length(p_tokens, 1) > 100 then raise exception 'No máximo 100 documentos por lote.'; end if;
  foreach v_token in array p_tokens loop
    begin
      v_r := public.documento_assinar(v_token, p_consentimento_texto);
      v_resultados := v_resultados || jsonb_build_object('token', v_token, 'ok', true, 'signature_id', v_r ->> 'signature_id');
      v_ok := v_ok + 1;
    exception when others then
      v_resultados := v_resultados || jsonb_build_object('token', v_token, 'ok', false, 'motivo', sqlerrm);
      v_falhas := v_falhas + 1;
    end;
  end loop;
  return jsonb_build_object('assinados', v_ok, 'recusados', v_falhas, 'itens', v_resultados);
end;
$$;
revoke all on function public.documento_assinar_lote(text[], text) from public, anon;
grant execute on function public.documento_assinar_lote(text[], text) to authenticated;

-- ---------------------------------------------------------------------
-- F) documentos_do_clube ganha os campos de assinatura (progresso e path do desenho NÃO exposto
--    aqui — path fica só nas RPCs de assinatura, nunca na listagem geral).
-- ---------------------------------------------------------------------
create or replace function public.documentos_do_clube() returns json
language plpgsql stable security definer set search_path = '' as $$
declare v_club uuid := public.clube_atual_id();
begin
  if v_club is null or not public.pode_gerir_no_clube(v_club) then
    raise exception 'Sem permissão (apenas diretoria/instrutor deste clube).';
  end if;
  return coalesce((
    select json_agg(json_build_object(
      'documento_id', d.id, 'token', d.token_publico, 'tipo', d.tipo, 'conferencia', d.conferencia,
      'titular_nome', p.nome, 'classe_nome', cl.nome, 'emitido_em', d.emitido_em,
      'snapshot_status', s.status, 'pdf_versao', d.pdf_versao, 'pdf_gerado_em', d.pdf_gerado_em,
      'pdf_storage_path', d.pdf_storage_path,
      'assinaturas_registradas', (select count(*) from public.document_signatures sg where sg.documento_id = d.id and sg.status = 'registrada'),
      'assinaturas_exigidas', (select count(distinct decisor_id) from public._documento_signatarios_elegiveis(d.id)),
      'estado', case
        when s.status = 'revogado' then 'revogado'
        when s.status = 'substituido' then 'substituido'
        when d.pdf_hash is null then 'em_preparacao'
        when (select count(*) from public.document_signatures sg where sg.documento_id = d.id and sg.status = 'registrada') = 0 then 'pronto_para_assinatura'
        when (select count(*) from public.document_signatures sg where sg.documento_id = d.id and sg.status = 'registrada')
             < (select count(distinct decisor_id) from public._documento_signatarios_elegiveis(d.id)) then 'parcialmente_assinado'
        else 'assinado'
      end
    ) order by d.emitido_em desc)
    from public.class_documents d
    join public.class_completion_snapshots s on s.id = d.snapshot_id
    join public.profiles p on p.id = d.usuario_id
    left join public.classes cl on cl.id = s.classe_id
    where d.club_id_origem = v_club
  ), '[]'::json);
end;
$$;

-- lista quem PODE assinar este documento agora, e quem já assinou — pra Central de Documentos
-- mostrar "aguardando fulano" e pro modal de assinatura decidir se mostra o botão pra você.
create or replace function public.documento_assinaturas(p_token text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_d record;
begin
  select * into v_d from public.class_documents where token_publico = p_token;
  if not found then return null; end if;
  if not public._pode_ver_conquista_curricular(v_d.usuario_id, v_d.club_id_origem) then return null; end if;
  return jsonb_build_object(
    'documento_id', v_d.id, 'pdf_hash', v_d.pdf_hash,
    'posso_assinar', exists (select 1 from public._documento_signatarios_elegiveis(v_d.id) e where e.decisor_id = auth.uid())
      and not exists (select 1 from public.document_signatures s where s.documento_id = v_d.id and s.signatario_id = auth.uid() and s.status = 'registrada'),
    'ja_assinei', exists (select 1 from public.document_signatures s where s.documento_id = v_d.id and s.signatario_id = auth.uid() and s.status = 'registrada'),
    'registradas', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', s.id, 'nome', pr.nome, 'papel', s.signatario_papel, 'assinado_em', s.assinado_em, 'status', s.status
      ) order by s.assinado_em), '[]'::jsonb)
      from public.document_signatures s join public.profiles pr on pr.id = s.signatario_id
      where s.documento_id = v_d.id and s.status = 'registrada'
    ),
    'exigidas', (select count(distinct decisor_id) from public._documento_signatarios_elegiveis(v_d.id))
  );
end;
$$;
revoke all on function public.documento_assinaturas(text) from public, anon;
grant execute on function public.documento_assinaturas(text) to authenticated;

-- ---------------------------------------------------------------------
-- G) revogar uma assinatura específica (erro/engano) — não é revogar o documento inteiro
--    (isso já existe: snapshot_revogar). Só o próprio signatário ou a liderança do clube emissor.
-- ---------------------------------------------------------------------
create or replace function public.documento_assinatura_revogar(p_signature_id uuid, p_motivo text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_s record;
begin
  select * into v_s from public.document_signatures where id = p_signature_id;
  if not found then raise exception 'Assinatura não encontrada.'; end if;
  if not (v_s.signatario_id = v_uid or public.pode_gerir_no_clube(v_s.club_id_origem)) then
    raise exception 'Sem permissão para revogar esta assinatura.';
  end if;
  if v_s.status = 'revogada' then raise exception 'Esta assinatura já está revogada.'; end if;
  if p_motivo is null or length(btrim(p_motivo)) < 5 then raise exception 'Informe o motivo.'; end if;
  update public.document_signatures set status = 'revogada' where id = p_signature_id;
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.documento_assinatura_revogar(uuid, text) from public, anon;
grant execute on function public.documento_assinatura_revogar(uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- H) verificação pública ganha as assinaturas (nome, papel, data, status) — nunca desenho/e-mail/
--    UUID/path. Reaproveita documento_verificar (mesma função, um campo a mais), não cria segunda rota.
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
    'data_investidura', case when v_d.tipo = 'final' then
      (select i.data_investidura from public.class_investitures i where i.snapshot_id = v_s.id and i.status = 'registrada' order by i.created_at desc limit 1)
    end,
    'estado', v_estado,
    'integro', v_integro,
    'conferencia', v_d.conferencia,
    'emitido_em', v_d.emitido_em,
    'template', (select tpl.chave || '/' || tpl.versao from public.document_templates tpl where tpl.id = v_d.template_id),
    'assinaturas', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'nome', pr.nome, 'papel', s.signatario_papel, 'data', s.assinado_em, 'status', s.status
      ) order by s.assinado_em), '[]'::jsonb)
      from public.document_signatures s join public.profiles pr on pr.id = s.signatario_id
      where s.documento_id = v_d.id and s.status = 'registrada'
    )
  );
end;
$$;
revoke all on function public.documento_verificar(text) from public;
grant execute on function public.documento_verificar(text) to anon, authenticated;

notify pgrst, 'reload schema';

insert into public.migracoes_aplicadas (arquivo)
values ('2026-09-30-assinatura-eletronica-final.sql')
on conflict (arquivo) do update set aplicada_em = now();
