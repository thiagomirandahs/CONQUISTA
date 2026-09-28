-- =============================================================================
-- 480 — REDE DBV: PUBLICAÇÃO DIRETA (posts e stories) e STORIES de 24 h
-- =============================================================================
-- Decisão do dono (29/09/2026): enquanto não houver IA de imagem, foto (de post OU de story)
-- PUBLICA DIRETO, sem esperar a diretoria. O app mostra antes uma confirmação clara
-- ("Tem certeza? Fica visível para todos os clubes da Rede DBV." · Publicar / Voltar).
-- A moderação passa a ser POR DENÚNCIA (esconde na hora e avisa a diretoria), como já era
-- para texto. Continua tudo o resto: triagem de texto no servidor, bucket de 300 KB, EXIF fora
-- (o app redesenha a foto), três avisos, limites, autorização de USO (pais) e de IMAGEM
-- (foto de ROSTO no avatar/perfil só com o papel arquivado).
--
-- A regra fica NUM LUGAR SÓ: public.rede_foto_exige_aprovacao(). Hoje devolve false.
-- Voltar para "passa pela diretoria" = migration nova trocando o `select false` por `select true`
-- (posts e stories passam a nascer 'em_analise', a fila de fotos da moderação volta a encher
-- e, no story, as 24 h contam da APROVAÇÃO). É `stable` (não `immutable`) de propósito: o
-- planejador não congela o valor dentro das funções que a chamam.
--
-- STORIES: foto (mesma compressão do post, retrato 9:16 até 1080×1920, alvo ≤ 150 KB) + texto
-- curto opcional (até 120, com triagem). Duram 24 h (rede_horas_de_story()). Denúncia usa a MESMA
-- moderação (alvo_tipo 'story'); a fileira mostra quem tem story ativo, agrupado por pessoa (os
-- meus primeiro) e marca o "visto" por usuário. Arquivos no MESMO bucket 'comunidade' e no mesmo
-- caminho <clube>/<eu>/<uuid>.webp|jpg (as policies de envio da 432/472 valem); expirado ou fora
-- do ar entra na fila de apagar da 472 (motivo 'story') e a Edge Function limpar-fotos-rede apaga.
-- =============================================================================

-- -----------------------------------------------------------------------------
--  1. A regra (um lugar só) e a duração do story
-- -----------------------------------------------------------------------------
create or replace function public.rede_foto_exige_aprovacao() returns boolean
language sql stable set search_path = '' as $$ select false $$;   -- 29/09/2026: publica direto
revoke all on function public.rede_foto_exige_aprovacao() from public, anon;
grant execute on function public.rede_foto_exige_aprovacao() to authenticated;

create or replace function public.rede_horas_de_story() returns int
language sql immutable set search_path = '' as $$ select 24 $$;   -- mudar = migration nova
revoke all on function public.rede_horas_de_story() from public, anon;
grant execute on function public.rede_horas_de_story() to authenticated;


-- -----------------------------------------------------------------------------
--  2. Tabelas dos stories
-- -----------------------------------------------------------------------------
create table if not exists public.rede_stories (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.organizational_units(id) on delete cascade,   -- clube de quem publicou
  autor_id uuid not null references public.profiles(id) on delete cascade,
  autor_papel text not null,
  foto_path text not null unique,
  texto text check (texto is null or length(texto) <= 120),
  status text not null check (status in ('em_analise', 'publicado', 'oculto_denuncia', 'recusado', 'removido', 'apagado', 'retirado')),
  created_at timestamptz not null default now(),
  publicado_em timestamptz,
  expira_em timestamptz,                  -- null enquanto em análise; publicado_em + 24 h
  moderado_por uuid references public.profiles(id) on delete set null,
  moderado_em timestamptz,
  foto_apagada_em timestamptz
);
create index if not exists rede_stories_ativos_idx on public.rede_stories (expira_em desc) where status = 'publicado';
create index if not exists rede_stories_autor_idx on public.rede_stories (autor_id, created_at desc);
alter table public.rede_stories enable row level security;
revoke all on public.rede_stories from public, anon, authenticated;

create table if not exists public.rede_stories_vistos (
  story_id uuid not null references public.rede_stories(id) on delete cascade,
  usuario_id uuid not null references public.profiles(id) on delete cascade,
  club_id uuid not null references public.organizational_units(id) on delete cascade,   -- clube em uso de quem viu
  visto_em timestamptz not null default now(),
  primary key (story_id, usuario_id)
);
create index if not exists rede_stories_vistos_usuario_idx on public.rede_stories_vistos (usuario_id);
alter table public.rede_stories_vistos enable row level security;
revoke all on public.rede_stories_vistos from public, anon, authenticated;

-- denúncia e histórico aceitam 'story'
alter table public.comunidade_denuncias drop constraint if exists comunidade_denuncias_alvo_tipo_check;
alter table public.comunidade_denuncias add constraint comunidade_denuncias_alvo_tipo_check check (alvo_tipo in ('post', 'comentario', 'story'));
alter table public.comunidade_moderacao_log drop constraint if exists comunidade_moderacao_log_alvo_tipo_check;
alter table public.comunidade_moderacao_log add constraint comunidade_moderacao_log_alvo_tipo_check check (alvo_tipo in ('post', 'comentario', 'usuario', 'story'));

-- fila de apagar aceita story
alter table public.rede_fotos_para_apagar add column if not exists story_id uuid references public.rede_stories(id) on delete set null;
alter table public.rede_fotos_para_apagar drop constraint if exists rede_fotos_para_apagar_motivo_check;
alter table public.rede_fotos_para_apagar add constraint rede_fotos_para_apagar_motivo_check
  check (motivo in ('expirada', 'recusada', 'removida', 'apagada', 'retirada', 'orfa', 'story'));

select public._manutencao_instalar_guarda();


-- -----------------------------------------------------------------------------
--  3. Posts com foto: publicam direto (comunidade_publicar da 472; só muda o status inicial,
--     a mensagem e a checagem de foto já usada também em story)
-- -----------------------------------------------------------------------------
create or replace function public.comunidade_publicar(p_legenda text, p_foto_path text default null, p_repost_de uuid default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare c jsonb := public._exigir_comunidade(true); v_uid uuid := auth.uid(); v_club uuid; v_papel text;
        v_leg text := public._comunidade_limpar(p_legenda); v_tri jsonb; v_lim text; v_orig record;
        v_repost uuid := p_repost_de; v_status text; v_id uuid;
begin
  v_club := (c ->> 'club')::uuid; v_papel := c ->> 'papel';
  if length(v_leg) > 500 then raise exception 'A legenda pode ter até 500 caracteres.'; end if;
  if v_repost is not null and p_foto_path is not null then raise exception 'Ao compartilhar não dá para trocar a foto.'; end if;
  if v_leg is null and p_foto_path is null and v_repost is null then raise exception 'Escreva algo ou escolha uma foto.'; end if;

  v_lim := public._comunidade_limite(v_uid, 'post');
  if v_lim is not null then
    return jsonb_build_object('ok', false, 'motivo', 'limite', 'mensagem', v_lim);
  end if;

  if v_repost is not null then
    select id, repost_de into v_orig from public.comunidade_posts where id = v_repost;
    if found and v_orig.repost_de is not null then v_repost := v_orig.repost_de; end if;
    if not found or not exists (select 1 from public.comunidade_posts p where p.id = v_repost and p.status = 'publicado'
                                 and public.recurso_habilitado_no_clube(p.club_id, 'comunidade')) then
      raise exception 'Esta publicação não está disponível.';
    end if;
  end if;

  if p_foto_path is not null then
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
  end if;

  if v_leg is not null then
    v_tri := public._comunidade_triar(v_leg);
    if not (v_tri ->> 'ok')::boolean then
      return public._comunidade_bloquear(v_uid, v_club, 'post', v_tri, v_leg);
    end if;
  end if;

  v_status := case when p_foto_path is not null and public.rede_foto_exige_aprovacao() then 'em_analise' else 'publicado' end;
  insert into public.comunidade_posts (club_id, autor_id, autor_papel, legenda, foto_path, repost_de, status, publicado_em)
  values (v_club, v_uid, v_papel, v_leg, p_foto_path, v_repost, v_status, case when v_status = 'publicado' then now() end)
  returning id into v_id;

  if v_status = 'em_analise' then
    perform public._comunidade_avisar_diretoria(v_club, '📷 Foto aguardando aprovação',
      'Uma foto de um membro do clube está esperando a sua aprovação para aparecer na Comunidade.');
  end if;
  return jsonb_build_object('ok', true, 'id', v_id, 'status', v_status,
    'mensagem', case when v_status = 'em_analise'
                     then 'Foto enviada! Ela aparece na Comunidade assim que a diretoria do seu clube aprovar 🙂'
                     when v_repost is not null then 'Compartilhado na Comunidade! 🔁'
                     else 'Publicado! 🎉' end,
    'post', public._comunidade_post_json(v_id, v_uid, 0));
end;
$$;
revoke all on function public.comunidade_publicar(text, text, uuid) from public, anon;
grant execute on function public.comunidade_publicar(text, text, uuid) to authenticated;


-- -----------------------------------------------------------------------------
--  4. Story: visibilidade, JSON, publicar, fileira, visto, apagar
-- -----------------------------------------------------------------------------
-- Visível para p_uid: publicado, dentro das 24 h, clube com o recurso ligado e o autor ainda
-- participa da rede (vínculo ativo; criança com a autorização dos pais). Ou é meu (inclusive em análise).
create or replace function public._rede_story_visivel(p_story uuid, p_uid uuid)
returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.rede_stories s
     where s.id = p_story
       and ((s.status = 'publicado' and s.expira_em > now()
             and public.recurso_habilitado_no_clube(s.club_id, 'comunidade')
             and public._rede_participa(s.autor_id, s.club_id))
            or (s.autor_id = p_uid and s.status in ('publicado', 'em_analise') and coalesce(s.expira_em, 'infinity') > now())));
$$;
revoke all on function public._rede_story_visivel(uuid, uuid) from public, anon, authenticated;

create or replace function public.rede_story_publicar(p_foto_path text, p_texto text default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare c jsonb := public._exigir_comunidade(true); v_uid uuid := auth.uid(); v_club uuid; v_papel text;
        v_txt text := public._comunidade_limpar(p_texto); v_tri jsonb; v_status text; v_id uuid;
        v_min bigint; v_dia bigint;
begin
  v_club := (c ->> 'club')::uuid; v_papel := c ->> 'papel';
  if p_foto_path is null then raise exception 'Escolha uma foto para o story.'; end if;
  if length(v_txt) > 120 then raise exception 'O texto do story pode ter até 120 caracteres.'; end if;

  -- limite próprio do story (as tentativas bloqueadas também contam no minuto)
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

  v_status := case when public.rede_foto_exige_aprovacao() then 'em_analise' else 'publicado' end;
  insert into public.rede_stories (club_id, autor_id, autor_papel, foto_path, texto, status, publicado_em, expira_em)
  values (v_club, v_uid, v_papel, p_foto_path, v_txt, v_status,
          case when v_status = 'publicado' then now() end,
          case when v_status = 'publicado' then now() + make_interval(hours => public.rede_horas_de_story()) end)
  returning id into v_id;

  if v_status = 'em_analise' then
    perform public._comunidade_avisar_diretoria(v_club, '📷 Story aguardando aprovação',
      'Um story de um membro do clube está esperando a sua aprovação para aparecer na Rede DBV.');
  end if;
  return jsonb_build_object('ok', true, 'id', v_id, 'status', v_status,
    'mensagem', case when v_status = 'em_analise'
                     then 'Story enviado! Ele aparece por 24 h assim que a diretoria do seu clube aprovar 🙂'
                     else 'Story publicado! Fica no ar por 24 h ✨' end);
end;
$$;
revoke all on function public.rede_story_publicar(text, text) from public, anon;
grant execute on function public.rede_story_publicar(text, text) to authenticated;

-- Fileira: um item por pessoa (os meus primeiro, depois quem tem story não visto, depois o mais recente).
create or replace function public.rede_stories()
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare c jsonb := public._exigir_comunidade(false); v_uid uuid := auth.uid();
begin
  return (
    with vis as (
      select s.*, coalesce(s.publicado_em, s.created_at) as quando,
             exists (select 1 from public.rede_stories_vistos v where v.story_id = s.id and v.usuario_id = v_uid) as visto
        from public.rede_stories s
       where ((s.status = 'publicado' and s.expira_em > now()
               and public.recurso_habilitado_no_clube(s.club_id, 'comunidade')
               and public._rede_participa(s.autor_id, s.club_id))
              or (s.autor_id = v_uid and s.status in ('publicado', 'em_analise') and coalesce(s.expira_em, 'infinity') > now()))),
    grupos as (
      select v.autor_id, v.autor_id = v_uid as meu, bool_and(v.visto or v.autor_id = v_uid) as todos_vistos, max(v.quando) as ultimo,
             (array_agg(v.club_id order by v.quando desc))[1] as club,
             jsonb_agg(jsonb_build_object('id', v.id, 'foto', v.foto_path, 'texto', v.texto, 'criado_em', v.quando,
                                          'expira_em', v.expira_em, 'visto', v.visto,
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
revoke all on function public.rede_stories() from public, anon;
grant execute on function public.rede_stories() to authenticated;

create or replace function public.rede_story_visto(p_story uuid)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare c jsonb := public._exigir_comunidade(false); v_uid uuid := auth.uid();
begin
  if not public._rede_story_visivel(p_story, v_uid) then raise exception 'Este story não está disponível.'; end if;
  if not exists (select 1 from public.rede_stories s where s.id = p_story and s.autor_id = v_uid) then
    insert into public.rede_stories_vistos (story_id, usuario_id, club_id) values (p_story, v_uid, (c ->> 'club')::uuid)
    on conflict (story_id, usuario_id) do nothing;
  end if;
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.rede_story_visto(uuid) from public, anon;
grant execute on function public.rede_story_visto(uuid) to authenticated;

-- Apagar o meu (o que está em revisão por denúncia a diretoria decide)
create or replace function public.rede_story_apagar(p_story uuid)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_n int;
begin
  if auth.uid() is null then raise exception 'Sessão expirada.'; end if;
  update public.rede_stories set status = 'apagado'
   where id = p_story and autor_id = auth.uid() and status in ('publicado', 'em_analise');
  get diagnostics v_n = row_count;
  if v_n = 0 then raise exception 'Não foi possível apagar (não é seu ou está em revisão).'; end if;
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.rede_story_apagar(uuid) from public, anon;
grant execute on function public.rede_story_apagar(uuid) to authenticated;


-- -----------------------------------------------------------------------------
--  5. Denúncia (431) com 'story': esconde na hora e avisa a diretoria do clube de quem publicou
-- -----------------------------------------------------------------------------
create or replace function public.comunidade_denunciar(p_tipo text, p_id uuid, p_motivo text default 'outro')
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare c jsonb := public._exigir_comunidade(false); v_uid uuid := auth.uid();
        v_club uuid; v_status text; v_autor uuid; v_post uuid; v_conf boolean; v_primeira boolean; v_ocultar boolean;
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
  elsif p_tipo = 'comentario' then
    select k.club_id, k.status, k.autor_id, k.post_id into v_club, v_status, v_autor, v_post
      from public.comunidade_comentarios k where k.id = p_id for update;
    if found and not exists (select 1 from public.comunidade_posts p where p.id = v_post and p.status in ('publicado', 'oculto_denuncia')) then
      v_status := null;
    end if;
  elsif p_tipo = 'story' then
    select s.club_id, s.status, s.autor_id into v_club, v_status, v_autor from public.rede_stories s where s.id = p_id for update;
    if found and v_status = 'publicado' and not public._rede_story_visivel(p_id, v_uid) then v_status := null; end if;
  else
    raise exception 'Tipo inválido.';
  end if;
  if v_club is null or coalesce(v_status, '') not in ('publicado', 'oculto_denuncia')
     or not public.recurso_habilitado_no_clube(v_club, 'comunidade') then
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
    'mensagem', case when v_ocultar then 'Obrigado! O conteúdo foi escondido e a diretoria do clube vai revisar.'
                     else 'Obrigado! A diretoria do clube vai revisar.' end);
end;
$$;
revoke all on function public.comunidade_denunciar(text, uuid, text) from public, anon;
grant execute on function public.comunidade_denunciar(text, uuid, text) to authenticated;


-- -----------------------------------------------------------------------------
--  6. Moderação (472) com 'story' — Manter/Ocultar/Remover e, se a regra voltar, Aprovar/Recusar
-- -----------------------------------------------------------------------------
create or replace function public._comunidade_aplicar_moderacao(p_tipo text, p_id uuid, p_acao text, p_motivo text,
                                                               p_via text, p_club_exigido uuid)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_club uuid; v_status text; v_autor uuid; v_pend boolean; v_novo text; v_res text; v_log text := p_acao;
begin
  if p_tipo = 'post' then
    select club_id, status, autor_id into v_club, v_status, v_autor from public.comunidade_posts where id = p_id for update;
  elsif p_tipo = 'comentario' then
    select club_id, status, autor_id into v_club, v_status, v_autor from public.comunidade_comentarios where id = p_id for update;
  elsif p_tipo = 'story' then
    select club_id, status, autor_id into v_club, v_status, v_autor from public.rede_stories where id = p_id for update;
  else
    raise exception 'Tipo inválido.';
  end if;
  if v_club is null or (p_club_exigido is not null and v_club <> p_club_exigido) then
    raise exception 'Conteúdo não encontrado.';
  end if;
  v_pend := exists (select 1 from public.comunidade_denuncias d where d.alvo_tipo = p_tipo and d.alvo_id = p_id and d.resultado = 'pendente');

  if p_acao in ('aprovar_foto', 'recusar_foto') then
    if p_tipo not in ('post', 'story') or v_status <> 'em_analise' then raise exception 'Só fotos em análise podem ser aprovadas ou recusadas.'; end if;
    v_novo := case p_acao when 'aprovar_foto' then 'publicado' else 'recusado' end;
  elsif p_acao = 'restaurar' then
    if not (v_status = 'oculto_denuncia' or (v_status = 'publicado' and v_pend)) then raise exception 'Não há nada para restaurar.'; end if;
    v_novo := 'publicado'; v_res := 'improcedente';
  elsif p_acao = 'ocultar' then
    if v_status <> 'publicado' or not v_pend then raise exception 'Só dá para ocultar conteúdo denunciado que ainda está no ar.'; end if;
    v_novo := 'oculto_denuncia'; v_log := 'ocultado_por_denuncia';
  elsif p_acao = 'remover' then
    if v_status not in ('publicado', 'oculto_denuncia', 'em_analise') then raise exception 'Este conteúdo já saiu da Comunidade.'; end if;
    v_novo := 'removido'; v_res := 'procedente';
  else
    raise exception 'Ação inválida.';
  end if;

  if p_tipo = 'post' then
    update public.comunidade_posts
       set status = v_novo, moderado_por = auth.uid(), moderado_em = now(),
           publicado_em = case when v_novo = 'publicado' then coalesce(publicado_em, now()) else publicado_em end
     where id = p_id;
  elsif p_tipo = 'story' then
    -- aprovado agora: as 24 h contam a partir da aprovação (restaurar mantém o prazo original)
    update public.rede_stories
       set status = v_novo, moderado_por = auth.uid(), moderado_em = now(),
           publicado_em = case when v_novo = 'publicado' then coalesce(publicado_em, now()) else publicado_em end,
           expira_em = case when v_novo = 'publicado' then coalesce(expira_em, now() + make_interval(hours => public.rede_horas_de_story()))
                            else expira_em end
     where id = p_id;
  else
    update public.comunidade_comentarios set status = v_novo, moderado_por = auth.uid(), moderado_em = now() where id = p_id;
  end if;
  if v_res is not null then
    update public.comunidade_denuncias set resultado = v_res, resolvido_em = now()
     where alvo_tipo = p_tipo and alvo_id = p_id and resultado = 'pendente';
  end if;
  insert into public.comunidade_moderacao_log (club_id, alvo_tipo, alvo_id, acao, por, via, motivo)
  values (v_club, p_tipo, p_id, v_log, auth.uid(), p_via, left(public._comunidade_limpar(p_motivo), 300));

  if p_acao = 'remover' then
    perform public._comunidade_registrar_aviso(v_autor, v_club, 'conteudo_removido', p_id);
    perform public._comunidade_avisar_pessoa(v_autor, v_club, 'Um conteúdo seu saiu da Comunidade',
      'A diretoria revisou e removeu um conteúdo seu. Lembre: respeito e segurança em primeiro lugar 🙂');
  elsif p_acao = 'aprovar_foto' then
    perform public._comunidade_avisar_pessoa(v_autor, v_club, '📷 Sua foto foi aprovada!', 'Ela já aparece na Comunidade.');
  elsif p_acao = 'recusar_foto' then
    perform public._comunidade_avisar_pessoa(v_autor, v_club, 'Sua foto não foi aprovada',
      'A diretoria do seu clube não aprovou a foto. Você pode tentar outra 🙂');
  end if;
  return jsonb_build_object('ok', true, 'status', v_novo);
end;
$$;
revoke all on function public._comunidade_aplicar_moderacao(text, uuid, text, text, text, uuid) from public, anon, authenticated;

create or replace function public._comunidade_item_fila(p_tipo text, p_id uuid, p_com_clube boolean)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v jsonb;
begin
  if p_tipo = 'post' then
    select jsonb_build_object('tipo', 'post', 'id', p.id, 'texto', p.legenda, 'foto', p.foto_path, 'status', p.status,
                              'autor', case when p_com_clube then public._comunidade_primeiro_nome(pr.nome) else pr.nome end,
                              'clube', case when p_com_clube then u.nome end, 'criado_em', p.created_at,
                              'repost', p.repost_de is not null)
      into v from public.comunidade_posts p join public.profiles pr on pr.id = p.autor_id
      join public.organizational_units u on u.id = p.club_id where p.id = p_id;
  elsif p_tipo = 'story' then
    select jsonb_build_object('tipo', 'story', 'id', s.id, 'texto', s.texto, 'foto', s.foto_path, 'status', s.status,
                              'autor', case when p_com_clube then public._comunidade_primeiro_nome(pr.nome) else pr.nome end,
                              'clube', case when p_com_clube then u.nome end, 'criado_em', s.created_at, 'expira_em', s.expira_em)
      into v from public.rede_stories s join public.profiles pr on pr.id = s.autor_id
      join public.organizational_units u on u.id = s.club_id where s.id = p_id;
  else
    select jsonb_build_object('tipo', 'comentario', 'id', k.id, 'texto', k.texto, 'foto', null, 'status', k.status,
                              'autor', case when p_com_clube then public._comunidade_primeiro_nome(pr.nome) else pr.nome end,
                              'clube', case when p_com_clube then u.nome end, 'criado_em', k.created_at, 'post_id', k.post_id)
      into v from public.comunidade_comentarios k join public.profiles pr on pr.id = k.autor_id
      join public.organizational_units u on u.id = k.club_id where k.id = p_id;
  end if;
  return v;
end;
$$;
revoke all on function public._comunidade_item_fila(text, uuid, boolean) from public, anon, authenticated;

-- fila de fotos: posts E stories em análise (com a regra de hoje, fica vazia)
create or replace function public._comunidade_fila(p_club uuid)
returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'fotos', (select coalesce(jsonb_agg(public._comunidade_item_fila(x.tipo, x.id, p_club is null) order by x.created_at), '[]'::jsonb)
                from (select 'post'::text as tipo, p.id, p.created_at from public.comunidade_posts p
                       where p.status = 'em_analise' and (p_club is null or p.club_id = p_club)
                      union all
                      select 'story', s.id, s.created_at from public.rede_stories s
                       where s.status = 'em_analise' and (p_club is null or s.club_id = p_club)) x),
    'denuncias', (select coalesce(jsonb_agg(public._comunidade_item_fila(d.alvo_tipo, d.alvo_id, p_club is null)
                                            || jsonb_build_object('denuncias', d.n, 'motivos', d.motivos) order by d.primeira), '[]'::jsonb)
                    from (select alvo_tipo, alvo_id, count(*) as n, jsonb_agg(distinct motivo) as motivos, min(created_at) as primeira
                            from public.comunidade_denuncias
                           where resultado = 'pendente' and (p_club is null or club_id = p_club)
                           group by alvo_tipo, alvo_id) d),
    'suspensos', (select coalesce(jsonb_agg(jsonb_build_object('usuario_id', s.usuario_id,
                                    'nome', case when p_club is null then public._comunidade_primeiro_nome(pr.nome) else pr.nome end,
                                    'ate', s.ate) order by s.ate), '[]'::jsonb)
                    from public.comunidade_suspensoes s join public.profiles pr on pr.id = s.usuario_id
                   where s.encerrada_em is null and s.ate > now() and (p_club is null or s.club_id = p_club)),
    'historico', (select coalesce(jsonb_agg(h.j order by h.created_at desc), '[]'::jsonb) from (
                    select l.created_at, jsonb_build_object('acao', l.acao, 'alvo_tipo', l.alvo_tipo, 'via', l.via, 'motivo', l.motivo,
                             'por', coalesce(public._comunidade_primeiro_nome(pr.nome), 'Sistema'), 'quando', l.created_at) as j
                      from public.comunidade_moderacao_log l left join public.profiles pr on pr.id = l.por
                     where p_club is null or l.club_id = p_club
                     order by l.created_at desc limit 30) h),
    'foto_exige_aprovacao', public.rede_foto_exige_aprovacao()
  );
$$;
revoke all on function public._comunidade_fila(uuid) from public, anon, authenticated;


-- -----------------------------------------------------------------------------
--  7. Storage: quem abre o arquivo do story; o autor não apaga story no ar
-- -----------------------------------------------------------------------------
create or replace function public._comunidade_pode_ver_foto(p_name text)
returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_club uuid := public.clube_atual_id(); p record; s record; v_papel text;
begin
  if v_uid is null then return false; end if;
  select * into p from public.comunidade_posts where foto_path = p_name;
  if found then
    if p.autor_id = v_uid or public.eh_admin_plataforma(v_uid) then return true; end if;
    if p.foto_apagada_em is not null or p.foto_expira_em <= now() then return false; end if;
    if v_club is null then return false; end if;
    if p.club_id = v_club and public.pode_administrar_clube(v_club) then return true; end if;
    if p.status <> 'publicado' or not public.recurso_habilitado_no_clube(p.club_id, 'comunidade')
       or not public.recurso_habilitado_no_clube(v_club, 'comunidade') then
      return false;
    end if;
  else
    select * into s from public.rede_stories where foto_path = p_name;
    if not found then
      return split_part(coalesce(p_name, ''), '/', 2) = v_uid::text;
    end if;
    if s.autor_id = v_uid or public.eh_admin_plataforma(v_uid) then return true; end if;
    if s.foto_apagada_em is not null or s.expira_em is not null and s.expira_em <= now() then return false; end if;
    if v_club is null then return false; end if;
    if s.club_id = v_club and public.pode_administrar_clube(v_club) then return true; end if;
    if s.status <> 'publicado' or s.expira_em is null or not public.recurso_habilitado_no_clube(s.club_id, 'comunidade')
       or not public.recurso_habilitado_no_clube(v_club, 'comunidade') or not public._rede_participa(s.autor_id, s.club_id) then
      return false;
    end if;
  end if;
  v_papel := public._comunidade_papel(v_uid, v_club);
  return v_papel is not null and (v_papel <> 'desbravador' or public._comunidade_autorizado(v_uid, v_club));
end;
$$;
revoke all on function public._comunidade_pode_ver_foto(text) from public, anon;
grant execute on function public._comunidade_pode_ver_foto(text) to authenticated;

create or replace function public._comunidade_pode_apagar_foto(p_name text)
returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null
     and split_part(coalesce(p_name, ''), '/', 2) = auth.uid()::text
     and not exists (select 1 from public.comunidade_posts p
                      where p.foto_path = p_name and p.status in ('publicado', 'em_analise', 'oculto_denuncia'))
     and not exists (select 1 from public.rede_stories s
                      where s.foto_path = p_name and s.status in ('publicado', 'em_analise', 'oculto_denuncia')
                        and coalesce(s.expira_em, 'infinity') > now());
$$;
revoke all on function public._comunidade_pode_apagar_foto(text) from public, anon;
grant execute on function public._comunidade_pode_apagar_foto(text) to authenticated;


-- -----------------------------------------------------------------------------
--  8. Vida útil do story: fora do ar = fila na hora; expirado = marcação diária; órfã não confunde
-- -----------------------------------------------------------------------------
create or replace function public._rede_story_fora_do_ar() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status is distinct from old.status and new.status in ('recusado', 'removido', 'apagado', 'retirado') then
    insert into public.rede_fotos_para_apagar (club_id, caminho, motivo, story_id, bytes)
    values (new.club_id, new.foto_path, 'story', new.id, public._rede_tamanho_objeto('comunidade', new.foto_path))
    on conflict (bucket, caminho) do nothing;
  end if;
  return new;
end;
$$;
revoke all on function public._rede_story_fora_do_ar() from public, anon, authenticated;
drop trigger if exists trg_rede_story_fora_do_ar on public.rede_stories;
create trigger trg_rede_story_fora_do_ar after update of status on public.rede_stories
  for each row execute function public._rede_story_fora_do_ar();

create or replace function public.rede_marcar_fotos_para_apagar()
returns int
language plpgsql security definer set search_path = '' as $$
declare v_n int := 0; v_k int;
begin
  insert into public.rede_fotos_para_apagar (club_id, caminho, motivo, post_id, bytes)
  select p.club_id, p.foto_path,
         case when p.status = 'recusado' then 'recusada' when p.status = 'removido' then 'removida'
              when p.status = 'apagado' then 'apagada' when p.status = 'retirado' then 'retirada' else 'expirada' end,
         p.id, public._rede_tamanho_objeto('comunidade', p.foto_path)
    from public.comunidade_posts p
   where p.foto_path is not null and p.foto_apagada_em is null
     and (p.foto_expira_em <= now() or p.status in ('recusado', 'removido', 'apagado', 'retirado'))
  on conflict (bucket, caminho) do nothing;
  get diagnostics v_k = row_count; v_n := v_n + v_k;

  -- stories: passou das 24 h (ou saiu do ar e escapou do gatilho). Em análise há mais de 7 dias também sai.
  insert into public.rede_fotos_para_apagar (club_id, caminho, motivo, story_id, bytes)
  select s.club_id, s.foto_path, 'story', s.id, public._rede_tamanho_objeto('comunidade', s.foto_path)
    from public.rede_stories s
   where s.foto_apagada_em is null
     and (s.expira_em <= now() or s.status in ('recusado', 'removido', 'apagado', 'retirado')
          or (s.status = 'em_analise' and s.created_at < now() - interval '7 days'))
  on conflict (bucket, caminho) do nothing;
  get diagnostics v_k = row_count; v_n := v_n + v_k;

  insert into public.rede_fotos_para_apagar (club_id, caminho, motivo, bytes)
  select u.id, o.name, 'orfa', nullif(o.metadata ->> 'size', '')::bigint
    from storage.objects o
    join public.organizational_units u on u.id::text = split_part(o.name, '/', 1)
   where o.bucket_id = 'comunidade' and o.created_at < now() - interval '1 day'
     and not exists (select 1 from public.comunidade_posts p where p.foto_path = o.name)
     and not exists (select 1 from public.rede_stories s where s.foto_path = o.name)
  on conflict (bucket, caminho) do nothing;
  get diagnostics v_k = row_count; v_n := v_n + v_k;

  insert into public.rede_limpeza_log (origem, marcadas) values ('marcacao', v_n);
  return v_n;
end;
$$;
revoke all on function public.rede_marcar_fotos_para_apagar() from public, anon, authenticated;

create or replace function public.rede_fotos_confirmar(p_apagadas uuid[], p_falhas uuid[] default '{}', p_erro text default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_arq int; v_bytes bigint;
begin
  update public.rede_fotos_para_apagar set apagada_em = now(), erro = null
   where id = any(coalesce(p_apagadas, '{}')) and apagada_em is null;
  get diagnostics v_arq = row_count;
  select coalesce(sum(bytes), 0) into v_bytes from public.rede_fotos_para_apagar where id = any(coalesce(p_apagadas, '{}'));
  update public.comunidade_posts p set foto_apagada_em = now()
    from public.rede_fotos_para_apagar f
   where f.id = any(coalesce(p_apagadas, '{}')) and f.post_id = p.id and p.foto_apagada_em is null;
  update public.rede_stories s set foto_apagada_em = now()
    from public.rede_fotos_para_apagar f
   where f.id = any(coalesce(p_apagadas, '{}')) and f.story_id = s.id and s.foto_apagada_em is null;
  update public.rede_fotos_para_apagar set tentativas = tentativas + 1, erro = left(p_erro, 300)
   where id = any(coalesce(p_falhas, '{}')) and apagada_em is null;
  insert into public.rede_limpeza_log (origem, arquivos, bytes, erros, detalhe)
  values ('edge', v_arq, v_bytes, coalesce(array_length(p_falhas, 1), 0), left(p_erro, 300));
  return jsonb_build_object('arquivos', v_arq, 'bytes', v_bytes);
end;
$$;
revoke all on function public.rede_fotos_confirmar(uuid[], uuid[], text) from public, anon, authenticated;
grant execute on function public.rede_fotos_confirmar(uuid[], uuid[], text) to service_role;
