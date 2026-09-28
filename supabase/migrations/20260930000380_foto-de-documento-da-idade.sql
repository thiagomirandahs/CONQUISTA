-- =============================================================================
-- 380 — Foto do DOCUMENTO para comprovar a idade (com as proteções do plano 1)
-- =============================================================================
-- Decisão do dono (28/09, "plano 1"): nos requisitos "Ter pelo menos N anos" o desbravador envia a
-- foto do documento. Como é dado sensível de criança (LGPD), a foto:
--   * NÃO entra em member_requirements nem em requirement_submissions (histórico imutável, e a
--     coordenação lê as tentativas na investidura) — fica numa tabela própria, apagável;
--   * só é vista pelo DONO e pela liderança que avalia (pode_avaliar_curriculo) do clube em uso;
--   * é APAGADA depois que o requisito é aprovado: fica só "idade conferida por Fulano em tal data".
--     O arquivo físico sai pela API do Storage (o app de quem aprovou, e de novo o app do dono como
--     reserva) — o Supabase não deixa apagar arquivo por SQL (protect_objects_delete).
-- Quais requisitos pedem documento: catálogo requisitos_com_documento, por manifesto_id (estável entre
-- versões do currículo). Nenhuma versão publicada do currículo é alterada.
-- Envio é obrigatório: uma tentativa nova desses requisitos só é aceita com a foto enviada.
-- =============================================================================

create table if not exists public.requisitos_com_documento (
  manifesto_id text primary key check (manifesto_id ~ '^[a-z_]+(\.[A-Za-z0-9]+)+$'),
  orientacao text not null
);
alter table public.requisitos_com_documento enable row level security;
revoke all on public.requisitos_com_documento from public, anon, authenticated;

insert into public.requisitos_com_documento (manifesto_id, orientacao) values
  ('amigo.I.1', 'Foto de um documento com nome e data de nascimento (RG, certidão de nascimento ou carteirinha).'),
  ('companheiro.I.1', 'Foto de um documento com nome e data de nascimento (RG, certidão de nascimento ou carteirinha).'),
  ('pesquisador.I.1', 'Foto de um documento com nome e data de nascimento (RG, certidão de nascimento ou carteirinha).'),
  ('pioneiro.I.1', 'Foto de um documento com nome e data de nascimento (RG, certidão de nascimento ou carteirinha).'),
  ('excursionista.I.1', 'Foto de um documento com nome e data de nascimento (RG, certidão de nascimento ou carteirinha).'),
  ('guia.I.1', 'Foto de um documento com nome e data de nascimento (RG, certidão de nascimento ou carteirinha).')
on conflict (manifesto_id) do nothing;

create table if not exists public.comprovacoes_documento (
  id uuid primary key default gen_random_uuid(),
  member_requirement_id uuid not null unique references public.member_requirements(id) on delete cascade,
  club_id uuid not null references public.organizational_units(id) on delete cascade,
  usuario_id uuid not null references public.profiles(id) on delete cascade,
  evidencia_path text,
  status text not null default 'enviado' check (status in ('enviado', 'conferido')),
  conferido_por uuid references public.profiles(id) on delete set null,
  conferido_em timestamptz,
  foto_apagada_em timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (evidencia_path is null or evidencia_path like usuario_id::text || '/documentos/%')
);
create index if not exists comprovacoes_documento_path_idx on public.comprovacoes_documento (evidencia_path) where evidencia_path is not null;
alter table public.comprovacoes_documento enable row level security;
revoke all on public.comprovacoes_documento from public, anon, authenticated;

create or replace function public._requisito_exige_documento(p_requirement_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.class_requirements r join public.requisitos_com_documento d on d.manifesto_id = r.manifesto_id
                  where r.id = p_requirement_id);
$$;
revoke all on function public._requisito_exige_documento(uuid) from public, anon, authenticated;

-- ---------- o desbravador envia (ou troca) a foto ----------
-- Devolve o caminho ANTIGO (se trocou) para o app apagar o arquivo que ficou sem uso.
create or replace function public.documento_enviar(p_requirement_id uuid, p_path text)
returns json language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_club uuid := public.clube_atual_id(); v_mr record; v_doc public.comprovacoes_documento;
begin
  if v_uid is null or v_club is null then raise exception 'Sem clube em uso.'; end if;
  perform public._exigir_classes_habilitado(v_club);
  if coalesce(p_path, '') !~ ('^' || v_uid::text || '/documentos/[^/]+$') then raise exception 'Arquivo inválido.'; end if;
  select * into v_mr from public.member_requirements
   where requirement_id = p_requirement_id and usuario_id = v_uid and club_id = v_club for update;
  if not found or not public._requisito_exige_documento(p_requirement_id) then
    raise exception 'Este requisito não pede foto de documento.';
  end if;
  if v_mr.status not in ('nao_iniciado', 'em_andamento', 'correcao_solicitada') then
    raise exception 'Este requisito não pode mais ser alterado.';
  end if;
  select * into v_doc from public.comprovacoes_documento where member_requirement_id = v_mr.id for update;
  if found then
    update public.comprovacoes_documento set evidencia_path = p_path, status = 'enviado', updated_at = now(),
           conferido_por = null, conferido_em = null, foto_apagada_em = null
     where id = v_doc.id;
  else
    insert into public.comprovacoes_documento (member_requirement_id, club_id, usuario_id, evidencia_path)
    values (v_mr.id, v_club, v_uid, p_path);
  end if;
  update public.member_requirements set status = case when status in ('nao_iniciado', 'correcao_solicitada') then 'em_andamento' else status end,
         updated_at = now() where id = v_mr.id;
  return json_build_object('ok', true, 'caminho_antigo', nullif(v_doc.evidencia_path, p_path));
end $$;
revoke all on function public.documento_enviar(uuid, text) from public, anon;
grant execute on function public.documento_enviar(uuid, text) to authenticated;

-- ---------- estado (dono: por classe; liderança: por requisito) ----------
create or replace function public._documento_json(d public.comprovacoes_documento)
returns json language sql stable security definer set search_path = '' as $$
  select json_build_object('status', d.status, 'evidencia_path', d.evidencia_path,
    'conferido_em', d.conferido_em, 'foto_apagada_em', d.foto_apagada_em,
    'conferido_por_nome', (select p.nome from public.profiles p where p.id = d.conferido_por));
$$;
revoke all on function public._documento_json(public.comprovacoes_documento) from public, anon, authenticated;

-- Para a tela Minha Classe: { requirement_id: {exige, orientacao, documento} } dos requisitos que pedem documento.
create or replace function public.documentos_da_minha_classe(p_member_class_id uuid)
returns json language sql stable security definer set search_path = '' as $$
  select coalesce(json_object_agg(mr.requirement_id, json_build_object(
           'orientacao', d.orientacao,
           'documento', (select public._documento_json(c) from public.comprovacoes_documento c where c.member_requirement_id = mr.id))), '{}'::json)
    from public.member_requirements mr
    join public.class_requirements r on r.id = mr.requirement_id
    join public.requisitos_com_documento d on d.manifesto_id = r.manifesto_id
   where mr.member_class_id = p_member_class_id and mr.usuario_id = auth.uid() and mr.club_id = public.clube_atual_id();
$$;
revoke all on function public.documentos_da_minha_classe(uuid) from public, anon;
grant execute on function public.documentos_da_minha_classe(uuid) to authenticated;

-- Para a fila de avaliação: o documento de UM requisito (só avaliador do clube em uso). Coordenação não.
create or replace function public.documento_do_requisito(p_member_requirement_id uuid)
returns json language plpgsql stable security definer set search_path = '' as $$
declare v_club uuid := public.clube_atual_id(); v_mr record; v_doc public.comprovacoes_documento;
begin
  if auth.uid() is null or v_club is null then return null; end if;
  select * into v_mr from public.member_requirements where id = p_member_requirement_id and club_id = v_club;
  if not found or not (v_mr.usuario_id = auth.uid() or public.pode_avaliar_curriculo(v_club)) then return null; end if;
  if not public._requisito_exige_documento(v_mr.requirement_id) then return null; end if;
  select * into v_doc from public.comprovacoes_documento where member_requirement_id = v_mr.id;
  return json_build_object('exige', true,
    'orientacao', (select d.orientacao from public.class_requirements r join public.requisitos_com_documento d on d.manifesto_id = r.manifesto_id where r.id = v_mr.requirement_id),
    'documento', case when v_doc.id is null then null else public._documento_json(v_doc) end);
end $$;
revoke all on function public.documento_do_requisito(uuid) from public, anon;
grant execute on function public.documento_do_requisito(uuid) to authenticated;

-- Depois que o app apagou o arquivo no Storage: some o caminho, fica o registro de quem conferiu.
-- Dono ou avaliador do clube; só vale para documento já CONFERIDO (enviado nunca é apagado por aqui).
create or replace function public.documento_marcar_apagado(p_member_requirement_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_club uuid := public.clube_atual_id(); v_doc public.comprovacoes_documento;
begin
  select * into v_doc from public.comprovacoes_documento where member_requirement_id = p_member_requirement_id and club_id = v_club for update;
  if not found or v_doc.status <> 'conferido' then return; end if;
  if not (v_doc.usuario_id = auth.uid() or public.pode_avaliar_curriculo(v_club)) then raise exception 'Sem permissão.'; end if;
  if exists (select 1 from storage.objects o where o.bucket_id = 'comprovacoes' and o.name = v_doc.evidencia_path) then
    raise exception 'A foto ainda está no armazenamento — apague o arquivo antes.';
  end if;
  update public.comprovacoes_documento set evidencia_path = null, foto_apagada_em = coalesce(foto_apagada_em, now()), updated_at = now()
   where id = v_doc.id;
end $$;
revoke all on function public.documento_marcar_apagado(uuid) from public, anon;
grant execute on function public.documento_marcar_apagado(uuid) to authenticated;

-- ---------- regras automáticas ----------
-- Tentativa nova de requisito que pede documento só entra com a foto enviada.
create or replace function public._exigir_documento_na_tentativa() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_req uuid;
begin
  select requirement_id into v_req from public.member_requirements where id = new.member_requirement_id;
  if public._requisito_exige_documento(v_req) and not exists (
       select 1 from public.comprovacoes_documento d
        where d.member_requirement_id = new.member_requirement_id and d.status = 'enviado' and d.evidencia_path is not null) then
    raise exception 'Envie a foto do documento antes de enviar para avaliação.';
  end if;
  return new;
end $$;
revoke all on function public._exigir_documento_na_tentativa() from public, anon, authenticated;
drop trigger if exists trg_exigir_documento_na_tentativa on public.requirement_submissions;
create trigger trg_exigir_documento_na_tentativa before insert on public.requirement_submissions
  for each row execute function public._exigir_documento_na_tentativa();

-- Aprovou o requisito: o documento vira "conferido por <quem aprovou> em <agora>".
create or replace function public._documento_conferido_na_aprovacao() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'aprovado' and old.status is distinct from 'aprovado' then
    update public.comprovacoes_documento set status = 'conferido', conferido_por = auth.uid(), conferido_em = now(), updated_at = now()
     where member_requirement_id = new.id and status = 'enviado';
  end if;
  return new;
end $$;
revoke all on function public._documento_conferido_na_aprovacao() from public, anon, authenticated;
drop trigger if exists trg_documento_conferido_na_aprovacao on public.member_requirements;
create trigger trg_documento_conferido_na_aprovacao after update of status on public.member_requirements
  for each row execute function public._documento_conferido_na_aprovacao();

-- ---------- Storage (bucket privado 'comprovacoes', pasta <uid>/documentos/) ----------
-- O envio já é coberto pela policy "comprovacao dono envia" (pasta começa com o uid).
-- Leitura: o dono já lê a própria pasta; a liderança que avalia lê o documento do clube em uso
-- (enviado, e o conferido até o app apagar — o Storage exige ver o arquivo para apagá-lo).
create or replace function public.avaliador_ve_documento(p_objeto text)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.pode_avaliar_curriculo(public.clube_atual_id())
     and exists (select 1 from public.comprovacoes_documento d
                  where d.evidencia_path = p_objeto and d.club_id = public.clube_atual_id() and d.status in ('enviado', 'conferido'));
$$;
revoke all on function public.avaliador_ve_documento(text) from public, anon;
grant execute on function public.avaliador_ve_documento(text) to authenticated;

drop policy if exists "documento: avaliador do clube le" on storage.objects;
create policy "documento: avaliador do clube le" on storage.objects for select to authenticated
  using (bucket_id = 'comprovacoes' and public.avaliador_ve_documento(name));

-- Apagar: o dono apaga arquivo da própria pasta de documentos que não está em uso por um envio
-- pendente (troca de foto / documento já conferido); o avaliador do clube apaga o já CONFERIDO.
create or replace function public.pode_apagar_documento(p_objeto text)
returns boolean language sql stable security definer set search_path = '' as $$
  select (storage.foldername(p_objeto))[2] = 'documentos' and array_length(storage.foldername(p_objeto), 1) = 2 and (
      ((storage.foldername(p_objeto))[1] = auth.uid()::text
        and not exists (select 1 from public.comprovacoes_documento d where d.evidencia_path = p_objeto and d.status = 'enviado'))
   or (public.pode_avaliar_curriculo(public.clube_atual_id())
        and exists (select 1 from public.comprovacoes_documento d
                     where d.evidencia_path = p_objeto and d.club_id = public.clube_atual_id() and d.status = 'conferido')));
$$;
revoke all on function public.pode_apagar_documento(text) from public, anon;
grant execute on function public.pode_apagar_documento(text) to authenticated;

drop policy if exists "documento: dono ou avaliador apaga" on storage.objects;
create policy "documento: dono ou avaliador apaga" on storage.objects for delete to authenticated
  using (bucket_id = 'comprovacoes' and public.pode_apagar_documento(name));
