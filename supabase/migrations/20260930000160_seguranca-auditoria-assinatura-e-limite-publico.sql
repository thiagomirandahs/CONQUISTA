-- =============================================================================
--  160 — Auditoria de segurança (26/09): correções no banco
--
--  A) Assinatura desenhada: o desenho só pode ser o arquivo DA PRÓPRIA assinatura.
--     Antes: a policy de INSERT do bucket 'assinaturas-desenhadas' aceitava QUALQUER nome dentro de
--     <club>/<documento>/ para quem enxerga o documento, e a RPC de registro só conferia o prefixo
--     <club>/<documento>/. Um signatário podia registrar como SEU o PNG que OUTRO signatário do mesmo
--     documento subiu (ou subir um arquivo "no lugar" do de outro, se chegasse antes) — o PDF final
--     (H2) imprimiria o desenho errado. Agora o caminho é EXATAMENTE
--     <club>/<documento>/<signature_id>.png e o signature_id tem que ser uma assinatura ATIVA do
--     próprio auth.uid() naquele documento (no upload E no registro).
--
--  B) Limite de taxa das RPCs públicas (entrada_abrir_publico / convite_hierarquia_abrir):
--     a origem era o PRIMEIRO valor de x-forwarded-for — que o cliente escreve. Trocar esse valor a
--     cada chamada anulava o limite por origem (10/10min) e deixava UMA máquina esgotar o teto global
--     (300/10min) e travar os links de todos os clubes. Agora a origem vem, nesta ordem, de
--     cf-connecting-ip (reescrito pela borda, o cliente não controla), x-real-ip e, só na falta dos
--     dois (ambiente local/testes), do primeiro x-forwarded-for.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- A) assinatura desenhada
-- ---------------------------------------------------------------------------
create or replace function public._assinatura_desenho_caminho_ok(p_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(p_name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\.png$', false)
     and exists (
       select 1
         from public.document_signatures s
         join public.class_documents d on d.id = s.documento_id
        where s.id::text = regexp_replace(split_part(p_name, '/', 3), '\.png$', '')
          and s.documento_id::text = split_part(p_name, '/', 2)
          and d.club_id_origem::text = split_part(p_name, '/', 1)
          and s.club_id_origem = d.club_id_origem
          and s.signatario_id = auth.uid()
          and s.status = 'registrada'
     );
$$;
revoke all on function public._assinatura_desenho_caminho_ok(text) from public, anon;
grant execute on function public._assinatura_desenho_caminho_ok(text) to authenticated;  -- usada pela policy do Storage

drop policy if exists "assinatura desenhada: signatario envia" on storage.objects;
create policy "assinatura desenhada: signatario envia" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'assinaturas-desenhadas'
    and public._assinatura_desenho_caminho_ok(name)
  );

create or replace function public.documento_assinatura_desenho_registrar(p_signature_id uuid, p_path text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_s record;
begin
  select * into v_s from public.document_signatures where id = p_signature_id;
  if not found then raise exception 'Assinatura não encontrada.'; end if;
  if v_s.signatario_id is distinct from auth.uid() then raise exception 'Sem permissão.'; end if;
  if v_s.status <> 'registrada' then raise exception 'Assinatura não está mais ativa.'; end if;
  if v_s.dados ? 'desenho_path' then raise exception 'Este desenho já foi registrado.'; end if;
  -- caminho EXATO desta assinatura (antes: só o prefixo <club>/<documento>/)
  if p_path is distinct from (v_s.club_id_origem::text || '/' || v_s.documento_id::text || '/' || v_s.id::text || '.png') then
    raise exception 'Caminho não corresponde a esta assinatura.';
  end if;
  update public.document_signatures set dados = coalesce(dados, '{}'::jsonb) || jsonb_build_object('desenho_path', p_path) where id = p_signature_id;
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.documento_assinatura_desenho_registrar(uuid, text) from public, anon;
grant execute on function public.documento_assinatura_desenho_registrar(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- B) origem do limite de taxa público
-- ---------------------------------------------------------------------------
create or replace function public._entrada_origem() returns text
language sql stable set search_path = '' as $$
  with h as (select coalesce(nullif(current_setting('request.headers', true), ''), '{}')::json as j)
  select encode(extensions.digest(
    coalesce(
      nullif(btrim(h.j ->> 'cf-connecting-ip'), ''),
      nullif(btrim(h.j ->> 'x-real-ip'), ''),
      nullif(btrim(split_part(coalesce(h.j ->> 'x-forwarded-for', ''), ',', 1)), ''),
      'desconhecida'),
    'sha256'), 'hex')
  from h;
$$;
revoke all on function public._entrada_origem() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- C) privilégio residual: anon tinha SELECT em public.unidades (herança do schema legado). Sem policy
--    para anon a leitura já voltava vazia, mas o GRANT não tem uso — defesa em profundidade.
-- ---------------------------------------------------------------------------
revoke all on public.unidades from anon;
