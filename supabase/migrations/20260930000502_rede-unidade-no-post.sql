-- =============================================================================
-- 502 — Rede DBV: a UNIDADE do autor no post/comentário/story/perfil ("Clube · Unidade · há X")
-- =============================================================================
-- Fase 6, item 5 (30/09/2026). O front já mostrava a unidade quando o servidor mandasse
-- (componentes.jsx `subtituloDoAutor`, RedePerfil `perfil.unidade`) — mas nenhuma RPC mandava.
--
-- De onde vem: o VÍNCULO da pessoa NO CLUBE DO CONTEÚDO (organization_memberships.unidade_id →
-- public.unidades.nome). É um nome organizacional ("Águias", "Falcão"), não dado pessoal; só sai o
-- NOME (nem id, nem cor, nem conselheiro).
--
-- Regras:
--   * só vínculo ATIVO e vigente no clube `p_club` (suspenso/encerrado/pendente → null);
--   * a unidade tem de pertencer a esse clube (unidades.club_id = p_club);
--   * autor de COORDENAÇÃO (p_club é distrito/região…) → null (coordenação não tem unidade);
--   * membro sem unidade → null. O front nunca inventa unidade.
--
-- Nada de autorização muda: `_comunidade_autor_json` continua sem EXECUTE para anon/authenticated
-- (só as RPCs gateadas a chamam) e `rede_perfil` continua passando por `_exigir_comunidade`.
-- Um subselect escalar por autor (índice em organization_memberships(user_id, organizational_unit_id));
-- nenhuma chamada extra do app.
--
-- Só `create or replace` das duas funções (mesmas assinaturas e grants da 500). Idempotente.
-- =============================================================================

create or replace function public._comunidade_autor_json(p_autor uuid, p_club uuid)
returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', p_autor,
    'nome', public._comunidade_nome_publico(pr.nome),
    'clube', case when u.type is distinct from 'clube' and u.id is not null then 'Coordenação · ' || u.nome else u.nome end,
    'coordenacao', coalesce(u.type <> 'clube', false),
    -- 502: nome da unidade do vínculo ATIVO no clube do conteúdo; null para coordenação e para quem não tem unidade
    'unidade', case when u.type = 'clube' then (
        select un.nome
          from public.organization_memberships m
          join public.unidades un on un.id = m.unidade_id and un.club_id = p_club
         where m.user_id = p_autor and m.organizational_unit_id = p_club
           and m.status = 'ativo' and m.starts_at <= now() and (m.ends_at is null or m.ends_at > now())
         order by (m.role <> 'pais') desc, m.created_at desc, m.id desc
         limit 1) end,
    -- 500: personagem (desenho) sai sempre; a foto de rosto só sem personagem E com a autorização de imagem
    'avatar_tipo', case when pr.avatar_tipo = 'personagem' then 'personagem' end,
    'avatar', case when pr.avatar_tipo = 'personagem' then pr.avatar end,
    'foto', case when pr.avatar_tipo is distinct from 'personagem' and public._rede_imagem_autorizada(p_autor) then pr.foto end)
    from public.profiles pr left join public.organizational_units u on u.id = p_club
   where pr.id = p_autor;
$$;
revoke all on function public._comunidade_autor_json(uuid, uuid) from public, anon, authenticated;

create or replace function public.rede_perfil(p_usuario uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare c jsonb := public._exigir_comunidade(false); v_uid uuid := auth.uid(); v_alvo uuid := coalesce(p_usuario, auth.uid());
        v_club uuid; v_papel text; v_desde timestamptz; pr public.profiles; v_eu boolean; v_personagem boolean; v_autor jsonb;
begin
  v_eu := v_alvo = v_uid;
  v_club := case when v_eu then (c ->> 'club')::uuid else public._rede_clube_do_perfil(v_alvo, (c ->> 'club')::uuid) end;
  if v_club is null then raise exception 'Este perfil não está disponível.'; end if;
  select * into pr from public.profiles where id = v_alvo;
  v_papel := public._comunidade_papel(v_alvo, v_club);
  v_personagem := coalesce(pr.avatar_tipo, 'foto') = 'personagem';
  v_autor := public._comunidade_autor_json(v_alvo, v_club);   -- 490: "Coordenação · X"; 502: unidade
  select min(m.starts_at) into v_desde from public.organization_memberships m
   where m.user_id = v_alvo and m.organizational_unit_id = v_club;
  return jsonb_build_object(
    'id', v_alvo,
    'eu', v_eu,
    'nome', public._comunidade_nome_publico(pr.nome),
    'clube', v_autor ->> 'clube',
    'unidade', v_autor ->> 'unidade',
    'coordenacao', exists (select 1 from public.organizational_units u where u.id = v_club and u.type <> 'clube'),
    'papel', v_papel,
    'desde', extract(year from v_desde)::int,
    -- 500: personagem (desenho) para todos; foto só sem personagem e com autorização de imagem
    'avatar_tipo', case when v_personagem then 'personagem' end,
    'avatar', case when v_personagem then pr.avatar end,
    'foto', case when not v_personagem and public._rede_imagem_autorizada(v_alvo) then pr.foto end,
    -- 500: a flag de consentimento é só do dono do perfil (explica por que a foto não aparece)
    'imagem_autorizada', case when v_eu then public._rede_imagem_autorizada(v_alvo) end,
    'publicacoes', (select count(*) from public.comunidade_posts p where p.autor_id = v_alvo and p.status = 'publicado'
                      and public._rede_unidade_ligada(p.club_id)),
    'conquistas', (select count(*) from public.comunidade_posts p where p.autor_id = v_alvo and p.status = 'publicado'
                     and p.tipo = 'conquista' and public._rede_unidade_ligada(p.club_id)),
    'pontos', public._rede_pontos(v_alvo));
end;
$function$;
revoke all on function public.rede_perfil(uuid) from public, anon;
grant execute on function public.rede_perfil(uuid) to authenticated;
