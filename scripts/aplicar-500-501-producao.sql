-- Aplica 500 (Rede DBV: avatar-personagem entre clubes; foto real só com autorização; imagem_autorizada
-- só para o próprio) e 501 (arquivo da foto de quem usa personagem fica FECHADO entre clubes — só
-- restringe) em PRODUÇÃO. Pode rodar mais de uma vez. SQL Editor não segura transação: cada comando é
-- idempotente (create or replace) e não há tabela temporária.
-- Para sozinho se a produção não estiver entre a 491 e a 501.
do $g$ begin
  if (select max(version) from supabase_migrations.schema_migrations) not between '20260930000491' and '20260930000501' then
    raise exception 'ABORTADO: produção fora do esperado (está em %)', (select max(version) from supabase_migrations.schema_migrations);
  end if;
end $g$;

-- ======================= 20260930000500_rede-dbv-avatar-personagem =======================
-- =============================================================================
-- 500 — Rede DBV: AVATAR-PERSONAGEM entre clubes (e a flag de consentimento só para o dono)
-- =============================================================================
-- Auditoria UX/UI Fase 6, seção 4 (29/09/2026). Causa confirmada:
--   * as RPCs da Rede devolviam só `foto` (gateada por _rede_imagem_autorizada, 470/490) e NADA de
--     `avatar`/`avatar_tipo`. Quem escolheu o personagem no app do clube (salvar_avatar, 20260824)
--     virava iniciais na Rede — e, se tivesse uma foto antiga gravada em profiles.foto com a
--     autorização arquivada, a Rede mostrava o ROSTO que o app do clube esconde.
--   * `rede_perfil` devolvia `imagem_autorizada` de QUALQUER pessoa: é a flag de consentimento de
--     imagem de uma criança, e só interessa ao próprio dono (para explicar por que a foto não aparece).
--
-- Decisões do dono:
--   * o avatar-personagem É mostrado entre clubes (é um desenho de peças, sem rosto — não é dado
--     biométrico nem imagem da criança; não passa pelo gate de imagem);
--   * a foto real CONTINUA dependendo de _rede_imagem_autorizada (papel arquivado pela diretoria e
--     responsável não desligou). Nada muda no Storage: bucket privado, policy 490 intacta;
--   * quando a pessoa escolheu o personagem, `foto` = null (como o app do clube: Avatar.jsx mostra o
--     personagem antes da foto), mesmo com a autorização arquivada — a escolha dela vale;
--   * `imagem_autorizada` só quando `eu = true`; para os outros vem null.
--
-- Só `create or replace` das duas funções (mesmas assinaturas e grants da 490/471). Sem tabela nova.
-- Idempotente: pode rodar de novo sem efeito.
-- =============================================================================

create or replace function public._comunidade_autor_json(p_autor uuid, p_club uuid)
returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', p_autor,
    'nome', public._comunidade_nome_publico(pr.nome),
    'clube', case when u.type is distinct from 'clube' and u.id is not null then 'Coordenação · ' || u.nome else u.nome end,
    'coordenacao', coalesce(u.type <> 'clube', false),
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
        v_club uuid; v_papel text; v_desde timestamptz; pr public.profiles; v_eu boolean; v_personagem boolean;
begin
  v_eu := v_alvo = v_uid;
  v_club := case when v_eu then (c ->> 'club')::uuid else public._rede_clube_do_perfil(v_alvo, (c ->> 'club')::uuid) end;
  if v_club is null then raise exception 'Este perfil não está disponível.'; end if;
  select * into pr from public.profiles where id = v_alvo;
  v_papel := public._comunidade_papel(v_alvo, v_club);
  v_personagem := coalesce(pr.avatar_tipo, 'foto') = 'personagem';
  select min(m.starts_at) into v_desde from public.organization_memberships m
   where m.user_id = v_alvo and m.organizational_unit_id = v_club;
  return jsonb_build_object(
    'id', v_alvo,
    'eu', v_eu,
    'nome', public._comunidade_nome_publico(pr.nome),
    'clube', public._comunidade_autor_json(v_alvo, v_club) ->> 'clube',                  -- 490: "Coordenação · X"
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

insert into supabase_migrations.schema_migrations(version, name) values ('20260930000500', 'rede-dbv-avatar-personagem') on conflict do nothing;

-- ======================= 20260930000501_rede-foto-personagem-fecha-arquivo =======================
-- =============================================================================
-- 501 — Rede DBV: quem escolheu o PERSONAGEM tem o arquivo da foto FECHADO entre clubes
-- =============================================================================
-- Aperto de privacidade aprovado pelo dono (29/09/2026). A 500 já faz as RPCs da Rede devolverem
-- `foto = null` para quem escolheu o personagem, mas a policy de Storage da 490
-- (_rede_pode_ver_foto_perfil) ainda deixava um membro de OUTRO clube ler `perfis/<uid>-x.jpg`
-- montando o caminho na mão, se a autorização de imagem estivesse arquivada.
--
-- Agora a Rede só libera o arquivo quando o dono NÃO está com avatar_tipo = 'personagem'
-- (null conta como "não personagem"). Só restringe; nada é aberto.
-- Intactos: o acesso do próprio dono e as policies do app do clube (pode_ver_imagem, 031).
-- Mesma assinatura, grants, security definer e search_path ''. Idempotente.
-- =============================================================================

create or replace function public._rede_pode_ver_foto_perfil(p_name text)
returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_club uuid := (public._rede_contexto() ->> 'unidade')::uuid; v_dono text; v_papel text;
begin
  if v_uid is null or v_club is null then return false; end if;
  v_dono := substring(coalesce(p_name, '') from '^perfis/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})-');
  if v_dono is null then return false; end if;
  if not public._rede_unidade_ligada(v_club) then return false; end if;
  v_papel := public._comunidade_papel(v_uid, v_club);
  if v_papel is null or (v_papel = 'desbravador' and not public._comunidade_autorizado(v_uid, v_club)) then return false; end if;
  return exists (select 1 from public.profiles pr
                  where pr.id::text = v_dono and pr.foto is not null and right(pr.foto, length(p_name) + 1) = '/' || p_name
                    and pr.avatar_tipo is distinct from 'personagem'   -- 501
                    and public._rede_imagem_autorizada(pr.id));
end;
$$;
revoke all on function public._rede_pode_ver_foto_perfil(text) from public, anon, authenticated;
grant execute on function public._rede_pode_ver_foto_perfil(text) to authenticated;

insert into supabase_migrations.schema_migrations(version, name) values ('20260930000501', 'rede-foto-personagem-fecha-arquivo') on conflict do nothing;

select 'OK' as resultado,
  (select max(version) from supabase_migrations.schema_migrations) as ledger,
  (select count(*) from public.organization_memberships m join public.organizational_units u on u.id = m.organizational_unit_id
    where u.slug = 'filhos-da-conquista' and m.status = 'ativo') as ativos_filhos_da_conquista;
