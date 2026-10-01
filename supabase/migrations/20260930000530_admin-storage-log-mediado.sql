-- =============================================================================
--  530 — LOG DE ACESSO DO ADMIN DA PLATAFORMA AO STORAGE: acesso MEDIADO por RPC.
--
--  Problema (PENDENCIAS-FASE8-CLASSIFICADAS, item 1): a policy de SELECT de storage.objects (bucket
--  'comunidade') gravava plataforma_acesso_log como EFEITO COLATERAL, e o Storage a avalia POR OBJETO;
--  listar uma pasta podia registrar arquivos que o admin nunca abriu (e a leitura era liberada sem
--  que o log representasse o arquivo realmente aberto).
--
--  Solução (ver STORAGE-LOG-ADMIN-DESENHO.md):
--   1. admin_comunidade_foto_assinar(p_tipo, p_id): RPC security definer. Exige admin da plataforma, confere
--      o contexto (a MESMA regra da moderação: _plataforma_pode_item = item 'comunidade'/coordenação em
--      análise ou denunciado), confere que o arquivo existe e grava EXATAMENTE 1 linha de log por chamada
--      (sem dedupe, fail-closed). Devolve só o caminho autorizado + TTL; o SQL não assina. Quem assina é a
--      Edge Function admin-comunidade-foto (chave de serviço, URL de 60 s), que chama esta RPC com o JWT do
--      admin. Nunca há URL assinada nem token no banco.
--   2. A policy de SELECT do bucket 'comunidade' deixa de dar leitura (e de gravar log) ao admin da
--      plataforma: _comunidade_pode_ver_foto perde os dois ramos do admin e vira STABLE (sem escrita).
--      Admin que também é membro de um clube segue as regras de membro daquele clube.
--   3. plataforma_acesso_log ganha bucket e contexto (aditivo, nullable). A tabela segue append-only.
--
--  Compat: nada que o front antigo chama muda de assinatura. O painel antigo nunca abria foto pelo
--  Storage (só aprovava/recusava). Ordem de publicação: banco (530) -> deploy da Edge Function ->
--  front novo. Idempotente.
-- =============================================================================

alter table public.plataforma_acesso_log add column if not exists bucket text;
alter table public.plataforma_acesso_log add column if not exists contexto text;

-- ---------------------------------------------------------------------------
--  1. RPC mediada: autoriza (e registra) UMA assinatura
-- ---------------------------------------------------------------------------
create or replace function public.admin_comunidade_foto_assinar(p_tipo text, p_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := public._exigir_admin_plataforma();
  v_path text; v_club uuid; v_ctx text; v_apagada timestamptz; v_status text;
begin
  if p_tipo is null or p_tipo not in ('post', 'story') or p_id is null then
    raise exception 'Conteúdo não encontrado.';
  end if;
  -- contexto permitido: exatamente o da moderação (item da Comunidade em análise ou denunciado)
  if not public._plataforma_pode_item(p_tipo, p_id) then
    raise exception 'Conteúdo não encontrado.';
  end if;
  if p_tipo = 'post' then
    select p.foto_path, p.club_id, p.status, p.foto_apagada_em
      into v_path, v_club, v_status, v_apagada from public.comunidade_posts p where p.id = p_id;
  else
    select s.foto_path, s.club_id, s.status, s.foto_apagada_em
      into v_path, v_club, v_status, v_apagada from public.rede_stories s where s.id = p_id;
  end if;
  if v_path is null or v_apagada is not null
     or not exists (select 1 from storage.objects o where o.bucket_id = 'comunidade' and o.name = v_path) then
    raise exception 'Este item não tem foto disponível.';
  end if;
  v_ctx := case when v_status = 'em_analise' then 'em_analise' else 'denunciado' end;
  -- 1 linha por assinatura: nada de dedupe; se o log falhar a exceção propaga e NADA é autorizado (fail-closed)
  insert into public.plataforma_acesso_log (admin_user_id, o_que, item_tipo, item_id, item_club_id, bucket, contexto)
  values (v_uid, 'foto_assinada', p_tipo, p_id, v_club, 'comunidade', v_ctx);
  return jsonb_build_object('ok', true, 'bucket', 'comunidade', 'path', v_path, 'contexto', v_ctx, 'ttl_segundos', 60);
end;
$$;
revoke all on function public.admin_comunidade_foto_assinar(text, uuid) from public, anon;
grant execute on function public.admin_comunidade_foto_assinar(text, uuid) to authenticated;

-- ---------------------------------------------------------------------------
--  2. Policy de leitura do bucket: sem ramo de admin da plataforma, sem escrita (STABLE)
-- ---------------------------------------------------------------------------
create or replace function public._comunidade_pode_ver_foto(p_name text)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); x jsonb := public._rede_contexto(); v_club uuid := (x ->> 'unidade')::uuid;
        v_modo text := x ->> 'modo'; p record; s record; v_papel text;
begin
  if v_uid is null then return false; end if;
  select * into p from public.comunidade_posts where foto_path = p_name;
  if found then
    if p.autor_id = v_uid then return true; end if;
    if p.foto_apagada_em is not null or p.foto_expira_em <= now() then return false; end if;
    if v_club is null then return false; end if;
    if p.club_id = v_club and public.pode_administrar_clube(v_club) then return true; end if;
    if not public._rede_item_visivel(v_uid, v_club, v_modo, p.club_id, p.alcance, p.autor_id, p.status)
       or not public._rede_unidade_ligada(v_club) then
      return false;
    end if;
  else
    select * into s from public.rede_stories where foto_path = p_name;
    if not found then
      return split_part(coalesce(p_name, ''), '/', 2) = v_uid::text;
    end if;
    if s.autor_id = v_uid then return true; end if;
    if s.foto_apagada_em is not null or s.expira_em is not null and s.expira_em <= now() then return false; end if;
    if v_club is null then return false; end if;
    if s.club_id = v_club and public.pode_administrar_clube(v_club) then return true; end if;
    if s.expira_em is null or not public._rede_unidade_ligada(v_club)
       or not public._rede_item_visivel(v_uid, v_club, v_modo, s.club_id, 'clube', s.autor_id, s.status) then
      return false;
    end if;
  end if;
  v_papel := public._comunidade_papel(v_uid, v_club);
  return v_papel is not null and (v_papel <> 'desbravador' or public._comunidade_autorizado(v_uid, v_club));
end;
$$;
revoke all on function public._comunidade_pode_ver_foto(text) from public, anon;
grant execute on function public._comunidade_pode_ver_foto(text) to authenticated;
