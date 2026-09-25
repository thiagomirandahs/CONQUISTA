-- =====================================================================
--  Revisão DOCUMENTAL — diferente de avaliação curricular (revisao_final_decidir, que reabre
--  REQUISITO). Aqui a revisão é sobre o DOCUMENTO/PDF gerado: dado ausente, documento incompleto,
--  inconsistência, apresentação — nunca reescreve aprovação/evidência/tentativa/avaliador/data
--  histórica (essas colunas nem existem nesta tabela nova, por desenho).
--
--  Modelo REUTILIZA a forma de investiture_reviews (mesma tabela de status pendente/decidido,
--  mesmo padrão "só RPC escreve") — não é uma tabela inventada do zero.
--
--  A revisão vale só pra VERSÃO do PDF em que foi feita (pdf_versao_revisada). Gerar um PDF novo
--  depois de 'correcao_solicitada' exige revisão de novo — nunca herda aprovação de uma versão
--  anterior. E `documento_assinar` passa a EXIGIR revisão aprovada da versão atual: sem isso, "pular"
--  a revisão e ir direto pra assinatura deixa de ser possível.
-- =====================================================================

create table if not exists public.document_reviews (
  id uuid primary key default gen_random_uuid(),
  documento_id uuid not null references public.class_documents(id) on delete cascade,
  club_id_origem uuid not null references public.organizational_units(id) on delete cascade,
  usuario_id uuid references public.profiles(id) on delete set null, -- titular do documento (denorm p/ RLS)
  pdf_versao_revisada int not null,
  status text not null check (status in ('aprovado', 'correcao_solicitada')),
  revisor_id uuid references public.profiles(id) on delete set null,
  revisor_papel text,
  motivo text,       -- obrigatório quando status='correcao_solicitada': o que está errado
  orientacao text,   -- o que fazer pra corrigir
  decidido_em timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index if not exists idx_document_reviews_doc on public.document_reviews (documento_id, pdf_versao_revisada, decidido_em desc);
alter table public.document_reviews enable row level security;
revoke insert, update, delete on public.document_reviews from authenticated, anon;
drop policy if exists "dono, emissor ou lideranca de clube com vinculo ativo" on public.document_reviews;
create policy "dono, emissor ou lideranca de clube com vinculo ativo" on public.document_reviews for select to authenticated
using (public._pode_ver_conquista_curricular(usuario_id, club_id_origem));
drop trigger if exists trg_imutavel on public.document_reviews;
create trigger trg_imutavel before update or delete on public.document_reviews
for each row execute function public._proteger_registro_imutavel(); -- nenhuma coluna mutável: decisão já tomada não muda, só uma NOVA linha pra versão nova

-- ---------------------------------------------------------------------
-- Decidir a revisão da versão ATUAL do PDF. Mesma autoridade de quem gera o PDF/assina
-- (pode_gerir_no_clube) — não inventei um papel "revisor documental" que não existe na hierarquia.
-- ---------------------------------------------------------------------
create or replace function public.documento_revisar(p_token text, p_decisao text, p_motivo text default null, p_orientacao text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_d record; v_papel text; v_id uuid;
begin
  if p_decisao not in ('aprovado', 'correcao_solicitada') then raise exception 'Decisão inválida.'; end if;
  select * into v_d from public.class_documents where token_publico = p_token;
  if not found then raise exception 'Documento não encontrado.'; end if;
  if not public.pode_gerir_no_clube(v_d.club_id_origem) then raise exception 'Sem permissão (apenas diretoria/instrutor do clube emissor).'; end if;
  if v_d.pdf_hash is null then raise exception 'Gere o PDF antes de revisar.'; end if;
  if exists (select 1 from public.document_signatures s where s.documento_id = v_d.id and s.status = 'registrada') then
    raise exception 'Este documento já tem assinatura registrada — revisão não se aplica mais.';
  end if;

  v_papel := coalesce(public.papel_no_clube(v_uid, v_d.club_id_origem), '?');

  if p_decisao = 'correcao_solicitada' then
    if coalesce(trim(p_motivo), '') = '' then raise exception 'Explique o que está errado no documento (motivo obrigatório).'; end if;
  end if;

  insert into public.document_reviews (documento_id, club_id_origem, usuario_id, pdf_versao_revisada, status, revisor_id, revisor_papel, motivo, orientacao)
  values (v_d.id, v_d.club_id_origem, v_d.usuario_id, v_d.pdf_versao, p_decisao, v_uid, v_papel, p_motivo, p_orientacao)
  returning id into v_id;

  perform public._auditar('documento_revisado', v_d.club_id_origem, v_d.usuario_id, jsonb_build_object('documento_id', v_d.id, 'pdf_versao', v_d.pdf_versao, 'decisao', p_decisao));

  return jsonb_build_object('ok', true, 'review_id', v_id, 'decisao', p_decisao);
end;
$$;
revoke all on function public.documento_revisar(text, text, text, text) from public, anon;
grant execute on function public.documento_revisar(text, text, text, text) to authenticated;

-- estado da revisão da versão ATUAL do PDF (null = ainda não revisada nesta versão)
create or replace function public._documento_revisao_atual(p_documento_id uuid, p_pdf_versao int) returns public.document_reviews
language sql stable security definer set search_path = '' as $$
  select * from public.document_reviews
   where documento_id = p_documento_id and pdf_versao_revisada = p_pdf_versao
   order by decidido_em desc limit 1;
$$;
revoke all on function public._documento_revisao_atual(uuid, int) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- documento_assinar passa a EXIGIR revisão aprovada da versão ATUAL do PDF — sem isso, "pular" a
-- revisão pra assinatura direto deixa de ser possível. Resto do corpo idêntico à migration 89/90.
-- ---------------------------------------------------------------------
create or replace function public.documento_assinar(p_token text, p_consentimento_texto text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_d record; v_s record; v_elegivel record; v_id uuid; v_revisao public.document_reviews;
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

  v_revisao := public._documento_revisao_atual(v_d.id, v_d.pdf_versao);
  if v_revisao is null or v_revisao.status <> 'aprovado' then
    raise exception 'Este documento precisa passar pela revisão documental (aprovada) antes de ser assinado.';
  end if;

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

  perform public._auditar('documento_assinado', v_d.club_id_origem, v_d.usuario_id, jsonb_build_object('documento_id', v_d.id, 'signature_id', v_id, 'papel', v_elegivel.papel_utilizado));

  return jsonb_build_object('ok', true, 'signature_id', v_id, 'pdf_hash', v_d.pdf_hash);
end;
$$;
revoke all on function public.documento_assinar(text, text) from public, anon;
grant execute on function public.documento_assinar(text, text) to authenticated;

-- ---------------------------------------------------------------------
-- documentos_do_clube ganha os estados reais de revisão (em vez de só derivar de pdf_hash).
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
      'revisao', (select jsonb_build_object('status', r.status, 'motivo', r.motivo, 'orientacao', r.orientacao, 'decidido_em', r.decidido_em)
                  from public._documento_revisao_atual(d.id, d.pdf_versao) r),
      'estado', case
        when s.status = 'revogado' then 'revogado'
        when s.status = 'substituido' then 'substituido'
        when d.pdf_hash is null then 'em_preparacao'
        when (select r.status from public._documento_revisao_atual(d.id, d.pdf_versao) r) = 'correcao_solicitada' then 'correcao_solicitada'
        when (select r.status from public._documento_revisao_atual(d.id, d.pdf_versao) r) is distinct from 'aprovado' then 'pronto_revisao'
        when (select count(*) from public.document_signatures sg where sg.documento_id = d.id and sg.status = 'registrada') = 0 then 'pronto_assinatura'
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

notify pgrst, 'reload schema';

insert into public.migracoes_aplicadas (arquivo)
values ('2026-09-30-revisao-documental.sql')
on conflict (arquivo) do update set aplicada_em = now();
