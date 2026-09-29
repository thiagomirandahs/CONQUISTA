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
