-- 541 — Todos os participantes da Rede podem comentar em posts visíveis.
-- Base: migrations 490, 515 e 517; aplicar depois da 540.
-- Mantém vínculo ativo, autorização do responsável, visibilidade, suspensão,
-- triagem, limites e moderação. Não libera publicação de posts para pais.
BEGIN;

create or replace function public.comunidade_comentar(p_post uuid, p_texto text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare c jsonb := public._exigir_comunidade(false); v_uid uuid := auth.uid(); v_club uuid; v_papel text;
        v_txt text := public._comunidade_limpar(p_texto); v_post record; v_tri jsonb; v_lim text; v_id uuid; v_ate timestamptz;
begin
  v_club := (c ->> 'club')::uuid; v_papel := c ->> 'papel';
  if v_txt is null then raise exception 'Escreva o comentário.'; end if;
  if length(v_txt) > 300 then raise exception 'O comentário pode ter até 300 caracteres.'; end if;
  select * into v_post from public.comunidade_posts where id = p_post;
  if not found or v_post.status <> 'publicado' or not public._rede_pode_ver_item(p_post, v_uid) then
    raise exception 'Esta publicação não está disponível.';
  end if;
  -- 541: qualquer participante autorizado pode comentar em qualquer post visível.
  v_ate := public._comunidade_suspenso_ate(v_uid);
  if v_ate is not null then
    raise exception 'Sua Comunidade está pausada até %. Depois disso você pode comentar de novo 🙂',
      to_char(v_ate at time zone 'America/Sao_Paulo', 'DD/MM "às" HH24:MI');
  end if;
  v_lim := public._comunidade_limite(v_uid, 'comentario');
  if v_lim is not null then
    return jsonb_build_object('ok', false, 'motivo', 'limite', 'mensagem', v_lim);
  end if;
  v_tri := public._comunidade_triar(v_txt);
  if not (v_tri ->> 'ok')::boolean then
    return public._comunidade_bloquear(v_uid, v_club, 'comentario', v_tri, v_txt);
  end if;
  insert into public.comunidade_comentarios (post_id, club_id, autor_id, autor_papel, texto)
  values (p_post, v_club, v_uid, v_papel, v_txt) returning id into v_id;
  return jsonb_build_object('ok', true, 'comentario', jsonb_build_object(
    'id', v_id, 'texto', v_txt, 'autor', public._comunidade_autor_json(v_uid, v_club), 'meu', true, 'criado_em', now()));
end;
$$;

revoke all on function public.comunidade_comentar(uuid, text) from public, anon;
grant execute on function public.comunidade_comentar(uuid, text) to authenticated;

create or replace function public.comunidade_meu_status()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); x jsonb := public._rede_contexto(); v_club uuid; v_modo text;
        v_papel text; v_aut boolean; v_ate timestamptz; v_nome text;
begin
  v_club := (x ->> 'unidade')::uuid; v_modo := x ->> 'modo';
  if v_uid is null or v_club is null then
    return jsonb_build_object('pode_ver', false, 'motivo', 'sem_clube');
  end if;
  select u.nome into v_nome from public.organizational_units u where u.id = v_club;
  if not public._rede_unidade_ligada(v_club) then
    return jsonb_build_object('pode_ver', false, 'modo', v_modo, 'unidade', v_nome,
      'motivo', case when v_modo = 'coordenacao' then 'area_sem_rede' else 'recurso_desligado' end);
  end if;
  v_papel := public._comunidade_papel(v_uid, v_club);
  if v_papel is null then
    return jsonb_build_object('pode_ver', false, 'motivo', 'sem_vinculo');
  end if;
  v_aut := v_papel <> 'desbravador' or public._comunidade_autorizado(v_uid, v_club);
  v_ate := public._comunidade_suspenso_ate(v_uid);
  return jsonb_build_object(
    'pode_ver', v_aut,
    'motivo', case when not v_aut then 'sem_autorizacao' end,
    'papel', v_papel,
    'modo', v_modo,
    'coordenacao', v_modo = 'coordenacao',
    'unidade_id', v_club,
    'unidade', v_nome,
    'pode_comentar', v_aut and v_ate is null,
    'pode_publicar', v_aut and v_papel <> 'pais' and v_ate is null,
    'pode_publicar_comunidade', v_aut and v_ate is null and v_modo <> 'coordenacao' and public.pode_gerir_atividades(v_club),
    'suspenso_ate', v_ate,
    'em_observacao', public._comunidade_em_observacao(v_uid),
    'limites', public.comunidade_limites());
end;
$$;

COMMIT;
