-- =============================================================================
-- 491 — Rede DBV: a autorização dos pais é a do PAPEL (assinada na admissão)
-- =============================================================================
-- Decisão do dono (29/09/2026): o termo de autorização dos pais é assinado PRESENCIALMENTE, no
-- papel, na admissão do clube — o app não precisa pedir de novo. Então o desbravador entra na Rede
-- DBV LIBERADO por padrão; o responsável vinculado continua podendo DESLIGAR pelo app (Meus filhos),
-- e o "não" dele vale na hora (a 432 já retira o que o filho publicou quando ele revoga).
-- Antes: só entrava com autorizado = true registrado no app. Agora: bloqueia só com autorizado = false
-- de um responsável ainda vinculado (aprovado, no mesmo clube).
-- A autorização de USO DE IMAGEM (foto de rosto, 470) não muda: continua arquivada pela diretoria.
-- =============================================================================
create or replace function public._comunidade_autorizado(p_uid uuid, p_club uuid)
returns boolean
language sql stable security definer set search_path = '' as $$
  select not exists (
    select 1 from public.comunidade_autorizacoes a
     where a.club_id = p_club and a.desbravador_id = p_uid and not a.autorizado
       and exists (select 1 from public.responsaveis r
                    where r.responsavel_id = a.responsavel_id and r.desbravador_id = p_uid
                      and r.club_id = p_club and r.status = 'aprovado'));
$$;
revoke all on function public._comunidade_autorizado(uuid, uuid) from public, anon, authenticated;
