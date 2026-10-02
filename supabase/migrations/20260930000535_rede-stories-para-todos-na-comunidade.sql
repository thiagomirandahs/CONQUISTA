-- =============================================================================
--  535 — REDE DBV: STORIES PARA TODOS NA COMUNIDADE
--
--  Decisão do dono (02/10/2026, definitiva): qualquer participante da Rede pode publicar um story para a
--  aba "Comunidade" (todos os clubes da Rede veem por 24 h). NÃO existe módulo de amigos, nem "seguir", nem
--  aprovação prévia (nem da diretoria nem da plataforma). A autorização dos pais para participar da Rede
--  (491) continua sendo exigida como já é. Moderação POSTERIOR: denúncia esconde na hora; a diretoria do
--  clube DO AUTOR e a plataforma revisam.
--
--  O que muda (tudo sobre a estrutura que já existe: mesma tabela, mesmas RPCs, mesmo bucket, mesma limpeza):
--   1. rede_stories.alcance in ('clube', 'comunidade')  (a 515 congelava em 'clube').
--   2. rede_story_publicar(p_foto_path, p_texto, p_alcance DEFAULT 'clube'): a chamada antiga (2 argumentos)
--      continua idêntica e cria 'clube'. 'comunidade' nasce PUBLICADO (segue rede_foto_exige_aprovacao(),
--      a regra única de story/foto do clube; NÃO usa a regra de aprovação dos posts da Comunidade).
--   3. rede_stories(p_alcance DEFAULT 'clube'):
--        'clube'      = EXATAMENTE o comportamento anterior: stories do meu clube/área (qualquer alcance do
--                       story; os de alcance 'comunidade' publicados por gente do meu clube aparecem aqui também).
--                       O app antigo chama rede_stories() sem argumentos e nunca recebe story de outro clube.
--        'comunidade' = só stories de alcance 'comunidade', de todos os clubes com a Rede ligada, pela MESMA
--                       função central de visibilidade dos posts da Comunidade (_rede_item_visivel).
--   4. _rede_story_visivel (visto, denúncia) e _comunidade_pode_ver_foto (policy do bucket PRIVADO: é ela que
--      decide a URL assinada) passam a usar o alcance DO STORY. O bucket não abre: sem policy/grant novos.
--   5. _plataforma_pode_item('story'): a plataforma revisa story de alcance 'comunidade' denunciado/em análise
--      (como já faz com post da Comunidade), sempre registrado em plataforma_acesso_log.
--   6. comunidade_denunciar('story'): a checagem "só denuncia quem pode ver" passa a valer também para story
--      já escondido (antes, com o UUID de um story oculto de OUTRO clube dava para registrar denúncia).
--
--  O que NÃO muda: tabela/colunas, 24 h (rede_horas_de_story), limites (2/min, 10/dia), triagem do texto,
--  só FOTO (sem vídeo), caminho <unidade>/<autor>/<uuid>.webp|jpg no bucket 'comunidade', saneamento (529),
--  fila de apagar (472/480: gatilho + rotina diária, independem do alcance), catálogo do GC (531),
--  rede_story_apagar (só o autor), comunidade_moderar (só a diretoria do clube do story), rede_story_visto.
--  Menor visto de fora do clube continua reduzido pelo _comunidade_autor_json (1º nome + inicial, sem unidade,
--  sem foto de rosto no avatar). Stories antigos continuam 'clube'.
--
--  Toda função security definer com search_path ''. Sem tabela nova. Idempotente.
-- =============================================================================

-- ---------------------------------------------------------------------------
--  1. Schema
-- ---------------------------------------------------------------------------
alter table public.rede_stories drop constraint if exists rede_stories_alcance_so_clube;
alter table public.rede_stories drop constraint if exists rede_stories_alcance_valido;
alter table public.rede_stories add constraint rede_stories_alcance_valido check (alcance in ('clube', 'comunidade'));

create index if not exists rede_stories_comunidade_ativos_idx
  on public.rede_stories (expira_em desc) where status = 'publicado' and alcance = 'comunidade';

-- ---------------------------------------------------------------------------
--  2. Visibilidade por id (visto, denúncia): agora com o alcance do story
-- ---------------------------------------------------------------------------
create or replace function public._rede_story_visivel(p_story uuid, p_uid uuid)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare x jsonb := public._rede_contexto(); s record;
begin
  select club_id, autor_id, status, expira_em, alcance into s from public.rede_stories where id = p_story;
  if not found then return false; end if;
  return public._rede_item_visivel(p_uid, (x ->> 'unidade')::uuid, x ->> 'modo', s.club_id, s.alcance, s.autor_id, s.status)
     and ((s.status = 'publicado' and s.expira_em > now())
          or (s.autor_id = p_uid and s.status in ('publicado', 'em_analise') and coalesce(s.expira_em, 'infinity') > now()));
end;
$$;
revoke all on function public._rede_story_visivel(uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
--  3. Publicar: p_alcance no FIM, com default (a chamada antiga de 2 argumentos segue igual)
-- ---------------------------------------------------------------------------
drop function if exists public.rede_story_publicar(text, text);
create or replace function public.rede_story_publicar(p_foto_path text, p_texto text default null, p_alcance text default 'clube')
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare c jsonb := public._exigir_comunidade(true); v_uid uuid := auth.uid(); v_club uuid; v_papel text;
        v_txt text := public._comunidade_limpar(p_texto); v_tri jsonb; v_status text; v_id uuid;
        v_min bigint; v_dia bigint; v_alc text := coalesce(nullif(btrim(p_alcance), ''), 'clube');
begin
  v_club := (c ->> 'club')::uuid; v_papel := c ->> 'papel';
  if v_alc not in ('clube', 'comunidade') then raise exception 'Alcance inválido.'; end if;
  if p_foto_path is null then raise exception 'Escolha uma foto para o story.'; end if;
  if length(v_txt) > 120 then raise exception 'O texto do story pode ter até 120 caracteres.'; end if;

  -- limite próprio do story (as tentativas bloqueadas também contam no minuto); vale somando os dois alcances
  select count(*) filter (where created_at > now() - interval '1 minute'), count(*) into v_min, v_dia
    from public.rede_stories where autor_id = v_uid and created_at > now() - interval '1 day';
  v_min := v_min + (select count(*) from public.comunidade_bloqueios b where b.autor_id = v_uid and b.created_at > now() - interval '1 minute');
  if v_min >= 2 then
    return jsonb_build_object('ok', false, 'motivo', 'limite', 'mensagem', 'Calma! Espere um minutinho antes de publicar de novo 🙂');
  end if;
  if v_dia >= 10 then
    return jsonb_build_object('ok', false, 'motivo', 'limite', 'mensagem', 'Você chegou ao limite de stories de hoje. Amanhã tem mais 🙂');
  end if;

  if p_foto_path !~ ('^' || v_club::text || '/' || v_uid::text || '/[0-9a-f-]{36}\.(jpg|webp)$') then
    raise exception 'Foto inválida.';
  end if;
  if not exists (select 1 from storage.objects o where o.bucket_id = 'comunidade' and o.name = p_foto_path) then
    raise exception 'A foto não chegou. Tente enviar de novo.';
  end if;
  if exists (select 1 from public.comunidade_posts where foto_path = p_foto_path)
     or exists (select 1 from public.rede_stories where foto_path = p_foto_path) then
    raise exception 'Essa foto já foi usada.';
  end if;

  if v_txt is not null then
    v_tri := public._comunidade_triar(v_txt);
    if not (v_tri ->> 'ok')::boolean then
      return public._comunidade_bloquear(v_uid, v_club, 'post', v_tri, v_txt);
    end if;
  end if;

  -- 535: SEM aprovação prévia também no alcance 'comunidade' (decisão do dono). A regra é a única do story:
  -- rede_foto_exige_aprovacao() sem argumento (hoje false = publica direto).
  v_status := case when public.rede_foto_exige_aprovacao() then 'em_analise' else 'publicado' end;
  insert into public.rede_stories (club_id, autor_id, autor_papel, foto_path, texto, status, publicado_em, expira_em, alcance)
  values (v_club, v_uid, v_papel, p_foto_path, v_txt, v_status,
          case when v_status = 'publicado' then now() end,
          case when v_status = 'publicado' then now() + make_interval(hours => public.rede_horas_de_story()) end,
          v_alc)
  returning id into v_id;

  if v_status = 'em_analise' then
    perform public._comunidade_avisar_diretoria(v_club, '📷 Story aguardando aprovação',
      'Um story de um membro do clube está esperando a sua aprovação para aparecer na Rede DBV.');
  end if;
  return jsonb_build_object('ok', true, 'id', v_id, 'status', v_status, 'alcance', v_alc,
    'mensagem', case when v_status = 'em_analise'
                     then 'Story enviado! Ele aparece por 24 h assim que a diretoria do seu clube aprovar 🙂'
                     when v_alc = 'comunidade' then 'Story publicado para todos os clubes da Rede! Fica no ar por 24 h ✨'
                     else 'Story publicado! Fica no ar por 24 h ✨' end);
end;
$$;
revoke all on function public.rede_story_publicar(text, text, text) from public, anon;
grant execute on function public.rede_story_publicar(text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
--  4. Fileira: p_alcance com default que preserva o comportamento anterior
-- ---------------------------------------------------------------------------
drop function if exists public.rede_stories();
create or replace function public.rede_stories(p_alcance text default 'clube')
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare c jsonb := public._exigir_comunidade(false); v_uid uuid := auth.uid();
        v_ctx uuid := (c ->> 'club')::uuid; v_modo text := c ->> 'modo';
        v_alc text := coalesce(nullif(btrim(p_alcance), ''), 'clube');
begin
  if v_alc not in ('clube', 'comunidade') then raise exception 'Alcance inválido.'; end if;
  return (
    with vis as (
      select s.*, coalesce(s.publicado_em, s.created_at) as quando,
             exists (select 1 from public.rede_stories_vistos v where v.story_id = s.id and v.usuario_id = v_uid) as visto
        from public.rede_stories s
       where ((s.status = 'publicado' and s.expira_em > now())
              or (s.autor_id = v_uid and s.status in ('publicado', 'em_analise') and coalesce(s.expira_em, 'infinity') > now()))
         and case when v_alc = 'comunidade'
                  -- aba Comunidade: só o que foi publicado PARA a Comunidade, pela mesma regra dos posts de lá
                  then s.alcance = 'comunidade'
                       and public._rede_item_visivel(v_uid, v_ctx, v_modo, s.club_id, 'comunidade', s.autor_id, s.status)
                  -- aba Meu Clube (e app antigo): só o mesmo clube/área, seja qual for o alcance do story
                  else public._rede_item_visivel(v_uid, v_ctx, v_modo, s.club_id, 'clube', s.autor_id, s.status) end),
    grupos as (
      select v.autor_id, v.autor_id = v_uid as meu, bool_and(v.visto or v.autor_id = v_uid) as todos_vistos, max(v.quando) as ultimo,
             (array_agg(v.club_id order by v.quando desc))[1] as club,
             jsonb_agg(jsonb_build_object('id', v.id, 'foto', v.foto_path, 'texto', v.texto, 'criado_em', v.quando,
                                          'expira_em', v.expira_em, 'visto', v.visto, 'alcance', v.alcance,
                                          'status', case when v.autor_id = v_uid then v.status end)
                       order by v.quando) as stories
        from vis v group by v.autor_id
       order by (v.autor_id = v_uid) desc, bool_and(v.visto or v.autor_id = v_uid), max(v.quando) desc
       limit 60)
    select coalesce(jsonb_agg(jsonb_build_object('autor', public._comunidade_autor_json(g.autor_id, g.club), 'meu', g.meu,
                                                 'todos_vistos', g.todos_vistos, 'stories', g.stories)
                              order by g.meu desc, g.todos_vistos, g.ultimo desc), '[]'::jsonb)
      from grupos g);
end;
$$;
revoke all on function public.rede_stories(text) from public, anon;
grant execute on function public.rede_stories(text) to authenticated;

-- ---------------------------------------------------------------------------
--  5. Storage (bucket PRIVADO): quem abre o arquivo do story = quem pode ver o story (alcance dele)
--     Mesmo corpo da 530; única diferença: s.alcance no lugar do 'clube' fixo.
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
       or not public._rede_item_visivel(v_uid, v_club, v_modo, s.club_id, s.alcance, s.autor_id, s.status) then
      return false;
    end if;
  end if;
  v_papel := public._comunidade_papel(v_uid, v_club);
  return v_papel is not null and (v_papel <> 'desbravador' or public._comunidade_autorizado(v_uid, v_club));
end;
$$;
revoke all on function public._comunidade_pode_ver_foto(text) from public, anon;
grant execute on function public._comunidade_pode_ver_foto(text) to authenticated;

-- ---------------------------------------------------------------------------
--  6. Plataforma: revisa story de alcance 'comunidade' (ou de coordenação) denunciado / em análise
-- ---------------------------------------------------------------------------
create or replace function public._plataforma_pode_item(p_tipo text, p_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select case p_tipo
    when 'post' then exists (
      select 1 from public.comunidade_posts p join public.organizational_units u on u.id = p.club_id
       where p.id = p_id and (p.alcance = 'comunidade' or u.type <> 'clube')
         and (p.status in ('em_analise', 'oculto_denuncia')
              or exists (select 1 from public.comunidade_denuncias d where d.alvo_tipo = 'post' and d.alvo_id = p.id and d.resultado = 'pendente')))
    when 'comentario' then exists (
      select 1 from public.comunidade_comentarios k join public.comunidade_posts p on p.id = k.post_id
        join public.organizational_units u on u.id = p.club_id
       where k.id = p_id and (p.alcance = 'comunidade' or u.type <> 'clube')
         and (k.status in ('em_analise', 'oculto_denuncia')
              or exists (select 1 from public.comunidade_denuncias d where d.alvo_tipo = 'comentario' and d.alvo_id = k.id and d.resultado = 'pendente')))
    when 'story' then exists (
      select 1 from public.rede_stories s join public.organizational_units u on u.id = s.club_id
       where s.id = p_id and (s.alcance = 'comunidade' or u.type <> 'clube')
         and (s.status in ('em_analise', 'oculto_denuncia')
              or exists (select 1 from public.comunidade_denuncias d where d.alvo_tipo = 'story' and d.alvo_id = s.id and d.resultado = 'pendente')))
    else false end;
$$;
revoke all on function public._plataforma_pode_item(text, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
--  7. Denunciar: mesmo corpo da 515; o ramo 'story' agora exige que quem denuncia PODERIA ver o story
--     (alcance + mesmo clube/área + dentro das 24 h), inclusive quando ele já está escondido por denúncia.
-- ---------------------------------------------------------------------------
create or replace function public.comunidade_denunciar(p_tipo text, p_id uuid, p_motivo text default 'outro')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare c jsonb := public._exigir_comunidade(false); v_uid uuid := auth.uid();
        v_club uuid; v_status text; v_autor uuid; v_post uuid; v_conf boolean; v_primeira boolean; v_ocultar boolean;
        v_ctx uuid := (c ->> 'club')::uuid; v_modo text := c ->> 'modo'; v_vis boolean := true;
begin
  if coalesce(p_motivo, '') not in ('ofensivo', 'perigoso', 'contato', 'imagem', 'outro') then
    raise exception 'Motivo inválido.';
  end if;
  if (select count(*) from public.comunidade_denuncias where denunciante_id = v_uid and created_at > now() - interval '1 day')
     >= (public.comunidade_limites() ->> 'denuncias_por_dia')::int then
    return jsonb_build_object('ok', false, 'mensagem', 'Você já fez muitas denúncias hoje. Se for urgente, fale com a diretoria do seu clube.');
  end if;
  if p_tipo = 'post' then
    select club_id, status, autor_id into v_club, v_status, v_autor from public.comunidade_posts where id = p_id for update;
    v_vis := exists (select 1 from public.comunidade_posts p
                      where p.id = p_id and public._rede_item_visivel(v_uid, v_ctx, v_modo, p.club_id, p.alcance, p.autor_id, 'publicado'));
  elsif p_tipo = 'comentario' then
    select k.club_id, k.status, k.autor_id, k.post_id into v_club, v_status, v_autor, v_post
      from public.comunidade_comentarios k where k.id = p_id for update;
    if found and not exists (select 1 from public.comunidade_posts p where p.id = v_post and p.status in ('publicado', 'oculto_denuncia')) then
      v_status := null;
    end if;
    v_vis := exists (select 1 from public.comunidade_posts p
                      where p.id = v_post and public._rede_item_visivel(v_uid, v_ctx, v_modo, p.club_id, p.alcance, p.autor_id, 'publicado'));
  elsif p_tipo = 'story' then
    select s.club_id, s.status, s.autor_id into v_club, v_status, v_autor from public.rede_stories s where s.id = p_id for update;
    v_vis := exists (select 1 from public.rede_stories s
                      where s.id = p_id and s.expira_em > now()
                        and public._rede_item_visivel(v_uid, v_ctx, v_modo, s.club_id, s.alcance, s.autor_id, 'publicado'));
  else
    raise exception 'Tipo inválido.';
  end if;
  if v_club is null or coalesce(v_status, '') not in ('publicado', 'oculto_denuncia') or not v_vis
     or not public._rede_unidade_ligada(v_club) then
    raise exception 'Este conteúdo não está disponível.';
  end if;
  if v_autor = v_uid then raise exception 'Você não pode denunciar o que você mesmo publicou.'; end if;
  if exists (select 1 from public.comunidade_denuncias where alvo_tipo = p_tipo and alvo_id = p_id and denunciante_id = v_uid) then
    return jsonb_build_object('ok', true, 'ocultou', false, 'mensagem', 'Você já denunciou isto. Obrigado por cuidar da Comunidade!');
  end if;

  v_conf := public._comunidade_denunciante_confiavel(v_uid);
  v_primeira := not exists (select 1 from public.comunidade_denuncias where alvo_tipo = p_tipo and alvo_id = p_id and resultado = 'pendente');
  v_ocultar := v_conf and v_status = 'publicado';
  insert into public.comunidade_denuncias (club_id, alvo_tipo, alvo_id, denunciante_id, denunciante_club_id, motivo, ocultou)
  values (v_club, p_tipo, p_id, v_uid, (c ->> 'club')::uuid, p_motivo, v_ocultar);
  if v_ocultar then
    if p_tipo = 'post' then
      update public.comunidade_posts set status = 'oculto_denuncia' where id = p_id;
    elsif p_tipo = 'comentario' then
      update public.comunidade_comentarios set status = 'oculto_denuncia' where id = p_id;
    else
      update public.rede_stories set status = 'oculto_denuncia' where id = p_id;
    end if;
    insert into public.comunidade_moderacao_log (club_id, alvo_tipo, alvo_id, acao, por, via, motivo)
    values (v_club, p_tipo, p_id, 'ocultado_por_denuncia', null, 'sistema', p_motivo);
  end if;
  if v_primeira then
    perform public._comunidade_avisar_diretoria(v_club, '🚩 Conteúdo denunciado na Comunidade',
      'Um conteúdo de um membro do clube foi denunciado' || case when v_ocultar then ' e está escondido' else '' end
      || ' até a sua revisão. Veja em Gestão → Comunidade.');
  end if;
  return jsonb_build_object('ok', true, 'ocultou', v_ocultar,
    'mensagem', case when exists (select 1 from public.organizational_units u where u.id = v_club and u.type <> 'clube')
                     then case when v_ocultar then 'Obrigado! O conteúdo foi escondido e a equipe da plataforma vai revisar.'
                               else 'Obrigado! A equipe da plataforma vai revisar.' end
                     when v_ocultar then 'Obrigado! O conteúdo foi escondido e a diretoria do clube vai revisar.'
                     else 'Obrigado! A diretoria do clube vai revisar.' end);
end;
$$;
revoke all on function public.comunidade_denunciar(text, uuid, text) from public, anon;
grant execute on function public.comunidade_denunciar(text, uuid, text) to authenticated;
