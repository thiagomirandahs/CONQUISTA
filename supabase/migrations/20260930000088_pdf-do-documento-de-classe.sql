-- =====================================================================
--  FASE 4 (Bloco 1) — PDF autoritativo do documento de classe.
--
--  NÃO cria um segundo sistema de documentos. Evolui as duas peças que já
--  existiam (class_documents ganha os campos do PDF; um bucket novo guarda
--  só os BYTES) — o modelo de dados (snapshot → documento → verificação) e
--  toda a sanitização de privacidade (documento_conteudo, já auditada)
--  continuam exatamente como estavam.
--
--  Quem gera o PDF é a Edge Function `gerar-documento-pdf` (fora deste
--  arquivo), rodando com a chave de serviço só para o UPLOAD no Storage —
--  a AUTORIZAÇÃO de quem pode pedir o PDF é sempre checada no Postgres
--  (mesma regra de `documento_emitir`: dono do vínculo ativo OU liderança
--  do clube), nas duas RPCs abaixo. A Edge Function nunca decide sozinha
--  quem pode gerar o quê.
-- =====================================================================

-- ---------------------------------------------------------------------
-- A) class_documents ganha os campos do PDF (não uma tabela nova).
--    pdf_hash é o hash dos BYTES do arquivo final — DIFERENTE do hash do
--    snapshot (class_completion_snapshots.hash, que é do CONTEÚDO
--    curricular). Um documento pode ter snapshot íntegro e ainda assim
--    precisar de um PDF novo (mudou o template, por exemplo) — são dois
--    fatos distintos, por isso dois hashes distintos.
-- ---------------------------------------------------------------------
alter table public.class_documents
  add column if not exists pdf_hash text,
  add column if not exists pdf_storage_path text,
  add column if not exists pdf_versao int not null default 0,
  add column if not exists pdf_gerado_em timestamptz;

alter table public.class_documents
  drop constraint if exists class_documents_pdf_hash_check;
alter table public.class_documents
  add constraint class_documents_pdf_hash_check check (pdf_hash is null or pdf_hash ~ '^[0-9a-f]{64}$');

comment on column public.class_documents.pdf_hash is
  'SHA-256 dos BYTES do PDF gerado — não confundir com class_completion_snapshots.hash (hash do conteúdo curricular).';
comment on column public.class_documents.pdf_versao is
  'Incrementa a cada geração. Depois de assinado (document_signatures com status=registrada para este documento), documento_pdf_registrar recusa sobrescrever — a correção vira um NOVO class_documents (novo tipo/snapshot), nunca um pdf_versao por cima de um PDF já assinado.';

-- ---------------------------------------------------------------------
-- B) bucket PRIVADO dos PDFs — mesma convenção de path já usada na
--    evolução do Storage de evidências (migration 87): <club_id>/<usuario_id>/...
--    Só PDF, tamanho pequeno (documento de texto, não mídia).
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('documentos-emitidos', 'documentos-emitidos', false, 10485760, array['application/pdf'])
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Ninguém faz upload direto (nem o dono, nem a liderança): só a Edge Function, com a chave de
-- serviço, que ignora RLS por natureza. Por isso não existe policy de INSERT para `authenticated`
-- aqui — é proposital, é a MESMA garantia que os outros buckets privados do projeto têm pra dado
-- sensível (o cliente nunca escreve direto).
drop policy if exists "pdf de documento: dono ou lideranca le" on storage.objects;
create policy "pdf de documento: dono ou lideranca le" on storage.objects for select to authenticated
  using (
    bucket_id = 'documentos-emitidos'
    and (storage.foldername(name))[1] ~ '^[0-9a-f-]{36}$'
    and public._pode_ver_conquista_curricular(
          nullif((storage.foldername(name))[2], '')::uuid,
          (storage.foldername(name))[1]::uuid)
  );

-- ---------------------------------------------------------------------
-- C) dados para a Edge Function montar o PDF — REUTILIZA documento_conteudo
--    (já sanitizado, já testado) em vez de duplicar a lógica de privacidade.
--    Só acrescenta o que documento_conteudo não tinha motivo de expor: os
--    ids técnicos que a Edge Function precisa pra montar o CAMINHO do
--    arquivo no Storage (club_id_origem, usuario_id, documento_id).
-- ---------------------------------------------------------------------
create or replace function public.documento_pdf_dados(p_token text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_d record; v_conteudo jsonb;
begin
  select * into v_d from public.class_documents where token_publico = p_token;
  if not found then return null; end if;
  if not public._pode_ver_conquista_curricular(v_d.usuario_id, v_d.club_id_origem) then return null; end if;

  v_conteudo := public.documento_conteudo(p_token);
  if v_conteudo is null then return null; end if;

  return jsonb_build_object(
    'conteudo', v_conteudo,
    'documento_id', v_d.id,
    'club_id_origem', v_d.club_id_origem,
    'usuario_id', v_d.usuario_id,
    'pdf_versao_atual', v_d.pdf_versao,
    'ja_assinado', exists (select 1 from public.document_signatures s where s.documento_id = v_d.id and s.status = 'registrada')
  );
end;
$$;
revoke all on function public.documento_pdf_dados(text) from public, anon;
grant execute on function public.documento_pdf_dados(text) to authenticated;

-- ---------------------------------------------------------------------
-- D) registrar o PDF gerado — chamada pela Edge Function DEPOIS do upload,
--    repassando o JWT de quem pediu (não a chave de serviço): a mesma
--    checagem de autorização de documento_emitir vale aqui, e é o
--    Postgres quem decide, não a função.
-- ---------------------------------------------------------------------
create or replace function public.documento_pdf_registrar(p_token text, p_hash text, p_storage_path text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_d record; v_versao int;
begin
  select * into v_d from public.class_documents where token_publico = p_token;
  if not found then raise exception 'Documento não encontrado.'; end if;
  if not public._pode_ver_conquista_curricular(v_d.usuario_id, v_d.club_id_origem) then
    raise exception 'Sem permissão para registrar o PDF deste documento.';
  end if;
  if p_hash !~ '^[0-9a-f]{64}$' then raise exception 'Hash inválido.'; end if;
  -- o caminho tem que começar pela pasta do CLUBE DO PRÓPRIO documento — nunca um caminho de outro
  -- clube/documento colado por engano ou de propósito.
  if p_storage_path is null or p_storage_path !~ ('^' || v_d.club_id_origem::text || '/') then
    raise exception 'Caminho de armazenamento não corresponde a este documento.';
  end if;
  if exists (select 1 from public.document_signatures s where s.documento_id = v_d.id and s.status = 'registrada') then
    raise exception 'Este documento já tem assinatura registrada — não é possível substituir o PDF. Emita um novo documento se precisar corrigir algo.';
  end if;

  update public.class_documents
     set pdf_hash = p_hash, pdf_storage_path = p_storage_path, pdf_gerado_em = now(), pdf_versao = pdf_versao + 1
   where id = v_d.id
   returning pdf_versao into v_versao;

  return jsonb_build_object('ok', true, 'pdf_versao', v_versao, 'pdf_hash', p_hash);
end;
$$;
revoke all on function public.documento_pdf_registrar(text, text, text) from public, anon;
grant execute on function public.documento_pdf_registrar(text, text, text) to authenticated;

-- ---------------------------------------------------------------------
-- E) Central de Documentos (Gestão → Documentos) — listagem pra LIDERANÇA do clube em uso.
--    Só leitura: nenhuma ação de correção/aprovação pedagógica passa por aqui (isso continua sendo
--    o fluxo de requisito/avaliação já existente — esta tela não toca em member_requirements).
--    Estado exibido é DERIVADO, nunca uma coluna nova de status: já existe status em 3 lugares
--    (class_completion_snapshots.status, class_documents.pdf_hash/pdf_versao, document_signatures)
--    e a Parte H (assinatura) desta fase NÃO foi implementada nesta rodada — por isso os estados de
--    assinatura aparecem como 'pronto_para_assinatura' (o que já é verdade hoje: PDF pronto, sem
--    assinatura nenhuma no sistema ainda) em vez de inventar 'parcialmente_assinado'/'assinado' sem
--    o mecanismo que os produziria.
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
      'estado', case
        when s.status = 'revogado' then 'revogado'
        when s.status = 'substituido' then 'substituido'
        when d.pdf_hash is null then 'em_preparacao'
        when not exists (select 1 from public.document_signatures sg where sg.documento_id = d.id and sg.status = 'registrada') then 'pronto_para_assinatura'
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
revoke all on function public.documentos_do_clube() from public, anon;
grant execute on function public.documentos_do_clube() to authenticated;

notify pgrst, 'reload schema';

insert into public.migracoes_aplicadas (arquivo)
values ('2026-09-30-pdf-do-documento-de-classe.sql')
on conflict (arquivo) do update set aplicada_em = now();
