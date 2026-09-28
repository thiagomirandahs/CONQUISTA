-- =============================================================================
-- 431 — COMUNIDADE (fase 1): regras e RPCs do feed
-- =============================================================================
-- Tudo aqui é security definer com search_path '' e passa por _exigir_comunidade():
--   * sessão com clube em uso e vínculo ATIVO nele;
--   * recurso 'comunidade' ligado no clube em uso (desligado = bloqueia TUDO, inclusive ler);
--   * desbravador só entra com AUTORIZAÇÃO registrada pelo responsável vinculado (432);
--   * para publicar/comentar/compartilhar: não pode ser 'pais' (acompanham, não publicam) e não
--     pode estar suspenso.
-- O feed mostra publicações de TODOS os clubes com o recurso ligado (fase 1: o alcance é decidido
-- pela plataforma ao ligar o recurso; alcance nacional/regional é decisão pendente do dono).
-- Perfil público = PRIMEIRO NOME + nome do clube. Nunca sobrenome, idade, escola, cidade ou foto
-- de perfil (a foto de perfil pode ser o rosto da criança).
-- SEM mensagem privada: não existe tabela nem RPC para isso, de propósito.
-- =============================================================================

-- -----------------------------------------------------------------------------
--  1. Helpers internos
-- -----------------------------------------------------------------------------
create or replace function public._comunidade_papel(p_uid uuid, p_club uuid)
returns text
language sql stable security definer set search_path = '' as $$
  select m.role from public.organization_memberships m
   where m.user_id = p_uid and m.organizational_unit_id = p_club and m.status = 'ativo'
     and m.starts_at <= now() and (m.ends_at is null or m.ends_at > now())
   order by m.starts_at
   limit 1;
$$;
revoke all on function public._comunidade_papel(uuid, uuid) from public, anon, authenticated;

-- A autorização só vale enquanto o vínculo pais↔filho (responsaveis, aprovado, no mesmo clube) existir.
create or replace function public._comunidade_autorizado(p_uid uuid, p_club uuid)
returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.comunidade_autorizacoes a
     where a.club_id = p_club and a.desbravador_id = p_uid and a.autorizado
       and exists (select 1 from public.responsaveis r
                    where r.responsavel_id = a.responsavel_id and r.desbravador_id = p_uid
                      and r.club_id = p_club and r.status = 'aprovado'));
$$;
revoke all on function public._comunidade_autorizado(uuid, uuid) from public, anon, authenticated;

create or replace function public._comunidade_suspenso_ate(p_uid uuid)
returns timestamptz
language sql stable security definer set search_path = '' as $$
  select max(s.ate) from public.comunidade_suspensoes s
   where s.usuario_id = p_uid and s.encerrada_em is null and s.ate > now();
$$;
revoke all on function public._comunidade_suspenso_ate(uuid) from public, anon, authenticated;

-- Conta nova = perfil criado há menos de N dias: limites menores ("em observação").
create or replace function public._comunidade_em_observacao(p_uid uuid)
returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select p.created_at from public.profiles p where p.id = p_uid), now())
         > now() - make_interval(days => (public.comunidade_limites() ->> 'dias_observacao')::int);
$$;
revoke all on function public._comunidade_em_observacao(uuid) from public, anon, authenticated;

create or replace function public._comunidade_primeiro_nome(p_nome text)
returns text
language sql immutable set search_path = '' as $$
  select coalesce(nullif(initcap(split_part(btrim(coalesce(p_nome, '')), ' ', 1)), ''), 'Desbravador(a)');
$$;
revoke all on function public._comunidade_primeiro_nome(text) from public, anon, authenticated;

-- O portão de TODAS as RPCs do feed. Devolve {uid, club, papel}.
create or replace function public._exigir_comunidade(p_para_publicar boolean default false)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_club uuid := public.clube_atual_id(); v_papel text; v_ate timestamptz;
begin
  if v_uid is null or v_club is null then
    raise exception 'Entre num clube para usar a Comunidade.';
  end if;
  if not public.recurso_habilitado_no_clube(v_club, 'comunidade') then
    raise exception 'A Comunidade não está liberada neste clube.';
  end if;
  v_papel := public._comunidade_papel(v_uid, v_club);
  if v_papel is null then
    raise exception 'Sem vínculo ativo neste clube.';
  end if;
  if v_papel = 'desbravador' and not public._comunidade_autorizado(v_uid, v_club) then
    raise exception 'Para usar a Comunidade, peça ao seu responsável para autorizar pelo app 🙂';
  end if;
  if p_para_publicar then
    if v_papel = 'pais' then
      raise exception 'Responsáveis acompanham a Comunidade, mas não publicam nem comentam.';
    end if;
    v_ate := public._comunidade_suspenso_ate(v_uid);
    if v_ate is not null then
      raise exception 'Sua Comunidade está pausada até %. Depois disso você pode publicar de novo 🙂',
        to_char(v_ate at time zone 'America/Sao_Paulo', 'DD/MM "às" HH24:MI');
    end if;
  end if;
  return jsonb_build_object('uid', v_uid, 'club', v_club, 'papel', v_papel);
end;
$$;
revoke all on function public._exigir_comunidade(boolean) from public, anon, authenticated;

-- Limite por minuto/dia (menor para conta nova). Tentativas BLOQUEADAS contam no limite por minuto
-- (ninguém fica martelando a triagem). Devolve a mensagem, ou null se pode.
create or replace function public._comunidade_limite(p_uid uuid, p_tipo text)
returns text
language plpgsql stable security definer set search_path = '' as $$
declare l jsonb := public.comunidade_limites(); v_obs boolean := public._comunidade_em_observacao(p_uid);
        v_n_min bigint; v_n_dia bigint; v_min int; v_dia int;
begin
  if p_tipo = 'post' then
    select count(*) filter (where created_at > now() - interval '1 minute'), count(*) into v_n_min, v_n_dia
      from public.comunidade_posts where autor_id = p_uid and created_at > now() - interval '1 day';
    v_min := (l ->> 'posts_por_minuto')::int;
    v_dia := case when v_obs then (l ->> 'posts_por_dia_observacao')::int else (l ->> 'posts_por_dia')::int end;
  else
    select count(*) filter (where created_at > now() - interval '1 minute'), count(*) into v_n_min, v_n_dia
      from public.comunidade_comentarios where autor_id = p_uid and created_at > now() - interval '1 day';
    v_min := (l ->> 'comentarios_por_minuto')::int;
    v_dia := case when v_obs then (l ->> 'comentarios_por_dia_observacao')::int else (l ->> 'comentarios_por_dia')::int end;
  end if;
  v_n_min := v_n_min + (select count(*) from public.comunidade_bloqueios b
                         where b.autor_id = p_uid and b.created_at > now() - interval '1 minute');
  if v_n_min >= v_min then
    return 'Calma! Espere um minutinho antes de ' || case when p_tipo = 'post' then 'publicar' else 'comentar' end || ' de novo 🙂';
  end if;
  if v_n_dia >= v_dia then
    return case when v_obs then 'Nos primeiros dias a conta tem um limite menor. ' else '' end
           || 'Você chegou ao limite de hoje. Amanhã tem mais 🙂';
  end if;
  return null;
end;
$$;
revoke all on function public._comunidade_limite(uuid, text) from public, anon, authenticated;

-- Aviso pessoal para cada pessoa da DIRETORIA do clube (sino + push pelo gatilho de notificacoes).
-- O texto nunca leva nome de criança nem o conteúdo: sai na tela de bloqueio do celular.
create or replace function public._comunidade_avisar_diretoria(p_club uuid, p_titulo text, p_corpo text)
returns void
language plpgsql security definer set search_path = '' as $$
declare v_u record;
begin
  for v_u in select distinct m.user_id from public.organization_memberships m
              where m.organizational_unit_id = p_club and m.role = 'diretoria' and m.status = 'ativo'
                and m.starts_at <= now() and (m.ends_at is null or m.ends_at > now()) loop
    begin
      insert into public.notificacoes (titulo, corpo, tipo, link, para, para_usuario, club_id)
      values (left(p_titulo, 120), left(p_corpo, 240), 'comunidade', '/gestao/comunidade', 'todos', v_u.user_id, p_club);
    exception when others then
      raise warning 'aviso da comunidade não enviado: %', sqlerrm;   -- o aviso nunca derruba a ação
    end;
  end loop;
end;
$$;
revoke all on function public._comunidade_avisar_diretoria(uuid, text, text) from public, anon, authenticated;

create or replace function public._comunidade_avisar_pessoa(p_uid uuid, p_club uuid, p_titulo text, p_corpo text)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.notificacoes (titulo, corpo, tipo, link, para, para_usuario, club_id)
  values (left(p_titulo, 120), left(p_corpo, 240), 'comunidade', '/comunidade', 'todos', p_uid, p_club);
exception when others then
  raise warning 'aviso da comunidade não enviado: %', sqlerrm;
end;
$$;
revoke all on function public._comunidade_avisar_pessoa(uuid, uuid, text, text) from public, anon, authenticated;

-- Aviso (strike). No 3º dentro da janela (contado desde a última suspensão): suspensão temporária
-- do feed + diretoria avisada. Devolve true se suspendeu agora.
create or replace function public._comunidade_registrar_aviso(p_uid uuid, p_club uuid, p_origem text, p_ref uuid)
returns boolean
language plpgsql security definer set search_path = '' as $$
declare l jsonb := public.comunidade_limites(); v_desde timestamptz; v_n bigint; v_ate timestamptz;
begin
  insert into public.comunidade_avisos (club_id, usuario_id, origem, referencia) values (p_club, p_uid, p_origem, p_ref);
  select max(s.created_at) into v_desde from public.comunidade_suspensoes s where s.usuario_id = p_uid;
  select count(*) into v_n from public.comunidade_avisos a
   where a.usuario_id = p_uid
     and a.created_at > now() - make_interval(days => (l ->> 'janela_avisos_dias')::int)
     and (v_desde is null or a.created_at > v_desde);
  if v_n >= (l ->> 'avisos_para_suspender')::int and public._comunidade_suspenso_ate(p_uid) is null then
    v_ate := now() + make_interval(days => (l ->> 'dias_suspensao')::int);
    insert into public.comunidade_suspensoes (club_id, usuario_id, ate, motivo)
    values (p_club, p_uid, v_ate, 'avisos repetidos (' || v_n || ')');
    insert into public.comunidade_moderacao_log (club_id, alvo_tipo, alvo_id, acao, por, via, motivo)
    values (p_club, 'usuario', p_uid, 'suspenso', null, 'sistema', 'avisos repetidos');
    perform public._comunidade_avisar_diretoria(p_club, '⏸️ Comunidade pausada para um membro',
      'Um membro do clube recebeu ' || v_n || ' avisos na Comunidade e ficou pausado por '
      || (l ->> 'dias_suspensao') || ' dias. Veja em Gestão → Comunidade.');
    return true;
  end if;
  return false;
end;
$$;
revoke all on function public._comunidade_registrar_aviso(uuid, uuid, text, uuid) from public, anon, authenticated;

-- Registra a tentativa bloqueada (com dígitos mascarados) e o aviso. Devolve a resposta da RPC.
create or replace function public._comunidade_bloquear(p_uid uuid, p_club uuid, p_alvo text, p_triagem jsonb, p_texto text)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_susp boolean;
begin
  insert into public.comunidade_bloqueios (club_id, autor_id, alvo, motivo, regra, trecho)
  values (p_club, p_uid, p_alvo, p_triagem ->> 'motivo', p_triagem ->> 'regra',
          left(regexp_replace(coalesce(p_texto, ''), '[0-9]', '#', 'g'), 280));
  v_susp := public._comunidade_registrar_aviso(p_uid, p_club, 'texto_bloqueado', null);
  return jsonb_build_object('ok', false, 'motivo', p_triagem ->> 'motivo',
    'mensagem', public._comunidade_msg_bloqueio(p_triagem ->> 'motivo', p_alvo)
                || case when v_susp then ' Você recebeu avisos demais e sua Comunidade ficou pausada por alguns dias.' else '' end,
    'suspenso', v_susp);
end;
$$;
revoke all on function public._comunidade_bloquear(uuid, uuid, text, jsonb, text) from public, anon, authenticated;

-- Texto puro: sem caracteres de controle (mantém \n), aparado.
create or replace function public._comunidade_limpar(p_texto text)
returns text
language sql immutable set search_path = '' as $$
  select nullif(btrim(regexp_replace(coalesce(p_texto, ''), '[\x01-\x09\x0B\x0C\x0E-\x1F\x7F]', '', 'g')), '');
$$;
revoke all on function public._comunidade_limpar(text) from public, anon, authenticated;

-- Um post é visível para p_uid? (publicado num clube com o recurso ligado; ou é do próprio autor)
create or replace function public._comunidade_post_visivel(p_post uuid, p_uid uuid)
returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.comunidade_posts p
     where p.id = p_post
       and ((p.status = 'publicado' and public.recurso_habilitado_no_clube(p.club_id, 'comunidade'))
            or (p.autor_id = p_uid and p.status = 'em_analise')));
$$;
revoke all on function public._comunidade_post_visivel(uuid, uuid) from public, anon, authenticated;

create or replace function public._comunidade_autor_json(p_autor uuid, p_club uuid)
returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'nome', public._comunidade_primeiro_nome((select p.nome from public.profiles p where p.id = p_autor)),
    'clube', (select u.nome from public.organizational_units u where u.id = p_club));
$$;
revoke all on function public._comunidade_autor_json(uuid, uuid) from public, anon, authenticated;

create or replace function public._comunidade_post_json(p_post uuid, p_uid uuid, p_nivel int default 0)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare p public.comunidade_posts; v_repost jsonb;
begin
  select * into p from public.comunidade_posts where id = p_post;
  if not found then return null; end if;
  if p.repost_de is not null and p_nivel = 0 then
    v_repost := case when public._comunidade_post_visivel(p.repost_de, p_uid)
                     then public._comunidade_post_json(p.repost_de, p_uid, 1)
                     else jsonb_build_object('indisponivel', true) end;
  end if;
  return jsonb_build_object(
    'id', p.id,
    'legenda', p.legenda,
    'foto', p.foto_path,
    'status', case when p.autor_id = p_uid then p.status end,
    'autor', public._comunidade_autor_json(p.autor_id, p.club_id),
    'clube_id', p.club_id,
    'crianca', p.autor_papel = 'desbravador',
    'meu', p.autor_id = p_uid,
    'criado_em', p.created_at,
    'curtidas', (select count(*) from public.comunidade_curtidas c where c.post_id = p.id),
    'comentarios', (select count(*) from public.comunidade_comentarios k where k.post_id = p.id and k.status = 'publicado'),
    'eu_curti', exists (select 1 from public.comunidade_curtidas c where c.post_id = p.id and c.usuario_id = p_uid),
    'repost', v_repost);
end;
$$;
revoke all on function public._comunidade_post_json(uuid, uuid, int) from public, anon, authenticated;


-- -----------------------------------------------------------------------------
--  2. Situação da pessoa (a tela decide o que mostrar; o servidor decide o que vale)
-- -----------------------------------------------------------------------------
-- Não levanta erro: devolve o porquê. Assim a tela explica ("peça autorização", "recurso desligado").
create or replace function public.comunidade_meu_status()
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_club uuid := public.clube_atual_id(); v_papel text; v_aut boolean; v_ate timestamptz;
begin
  if v_uid is null or v_club is null then
    return jsonb_build_object('pode_ver', false, 'motivo', 'sem_clube');
  end if;
  if not public.recurso_habilitado_no_clube(v_club, 'comunidade') then
    return jsonb_build_object('pode_ver', false, 'motivo', 'recurso_desligado');
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
    'pode_publicar', v_aut and v_papel <> 'pais' and v_ate is null,
    'suspenso_ate', v_ate,
    'em_observacao', public._comunidade_em_observacao(v_uid),
    'limites', public.comunidade_limites());
end;
$$;
revoke all on function public.comunidade_meu_status() from public, anon;
grant execute on function public.comunidade_meu_status() to authenticated;


-- -----------------------------------------------------------------------------
--  3. Publicar (texto, foto opcional) e compartilhar DENTRO do app (repost)
-- -----------------------------------------------------------------------------
-- Texto sem foto: triagem -> publicado. Com foto: triagem da legenda -> 'em_analise' até a
-- diretoria do clube do autor aprovar (ainda não há IA de imagem; quando houver, a IA decide a
-- foto e só o duvidoso cai na fila — ver COMUNIDADE-FASE1.md).
-- Compartilhar = repost apontando para o ORIGINAL (nunca download/link externo).
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
    if found and v_orig.repost_de is not null then v_repost := v_orig.repost_de; end if;   -- sempre o original
    if not found or not exists (select 1 from public.comunidade_posts p where p.id = v_repost and p.status = 'publicado'
                                 and public.recurso_habilitado_no_clube(p.club_id, 'comunidade')) then
      raise exception 'Esta publicação não está disponível.';
    end if;
  end if;

  if p_foto_path is not null then
    if p_foto_path !~ ('^' || v_club::text || '/' || v_uid::text || '/[0-9a-f-]{36}\.jpg$') then
      raise exception 'Foto inválida.';
    end if;
    if not exists (select 1 from storage.objects o where o.bucket_id = 'comunidade' and o.name = p_foto_path) then
      raise exception 'A foto não chegou. Tente enviar de novo.';
    end if;
    if exists (select 1 from public.comunidade_posts where foto_path = p_foto_path) then
      raise exception 'Essa foto já foi usada.';
    end if;
  end if;

  if v_leg is not null then
    v_tri := public._comunidade_triar(v_leg);
    if not (v_tri ->> 'ok')::boolean then
      return public._comunidade_bloquear(v_uid, v_club, 'post', v_tri, v_leg);
    end if;
  end if;

  v_status := case when p_foto_path is not null then 'em_analise' else 'publicado' end;
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
--  4. Feed paginado (keyset, 10 por página: leve no 4G fraco)
-- -----------------------------------------------------------------------------
create or replace function public.comunidade_feed(p_antes timestamptz default null, p_antes_id uuid default null, p_limite int default 10)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare c jsonb := public._exigir_comunidade(false); v_uid uuid := auth.uid();
        v_lim int := least(greatest(coalesce(p_limite, 10), 1), 20); v_itens jsonb; v_n int; v_antes timestamptz; v_antes_id uuid;
begin
  with pagina as (
    select p.id, p.created_at from public.comunidade_posts p
     where ((p.status = 'publicado' and public.recurso_habilitado_no_clube(p.club_id, 'comunidade'))
            or (p.autor_id = v_uid and p.status = 'em_analise'))
       and (p_antes is null
            or (p.created_at, p.id) < (p_antes, coalesce(p_antes_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)))
     order by p.created_at desc, p.id desc
     limit v_lim)
  select coalesce(jsonb_agg(public._comunidade_post_json(x.id, v_uid, 0) order by x.created_at desc, x.id desc), '[]'::jsonb),
         count(*)
    into v_itens, v_n
    from pagina x;
  if v_n = v_lim then
    select (e ->> 'criado_em')::timestamptz, (e ->> 'id')::uuid into v_antes, v_antes_id
      from jsonb_array_elements(v_itens) with ordinality as a(e, i) order by i desc limit 1;
  end if;
  return jsonb_build_object('itens', v_itens,
    'proximo', case when v_n = v_lim then jsonb_build_object('antes', v_antes, 'antes_id', v_antes_id) end);
end;
$$;
revoke all on function public.comunidade_feed(timestamptz, uuid, int) from public, anon;
grant execute on function public.comunidade_feed(timestamptz, uuid, int) to authenticated;

-- Uma publicação (link INTERNO /comunidade/p/:id)
create or replace function public.comunidade_post(p_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare c jsonb := public._exigir_comunidade(false); v_uid uuid := auth.uid();
begin
  if not public._comunidade_post_visivel(p_id, v_uid) then
    raise exception 'Esta publicação não está disponível.';
  end if;
  return public._comunidade_post_json(p_id, v_uid, 0);
end;
$$;
revoke all on function public.comunidade_post(uuid) from public, anon;
grant execute on function public.comunidade_post(uuid) to authenticated;


-- -----------------------------------------------------------------------------
--  5. Curtir
-- -----------------------------------------------------------------------------
create or replace function public.comunidade_curtir(p_post uuid, p_curtir boolean default true)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare c jsonb := public._exigir_comunidade(false); v_uid uuid := auth.uid();
begin
  if not exists (select 1 from public.comunidade_posts p where p.id = p_post and p.status = 'publicado'
                  and public.recurso_habilitado_no_clube(p.club_id, 'comunidade')) then
    raise exception 'Esta publicação não está disponível.';
  end if;
  if coalesce(p_curtir, true) then
    insert into public.comunidade_curtidas (post_id, usuario_id, club_id) values (p_post, v_uid, (c ->> 'club')::uuid)
    on conflict (post_id, usuario_id) do nothing;
  else
    delete from public.comunidade_curtidas where post_id = p_post and usuario_id = v_uid;
  end if;
  return jsonb_build_object('curtidas', (select count(*) from public.comunidade_curtidas where post_id = p_post),
                            'eu_curti', coalesce(p_curtir, true));
end;
$$;
revoke all on function public.comunidade_curtir(uuid, boolean) from public, anon;
grant execute on function public.comunidade_curtir(uuid, boolean) to authenticated;


-- -----------------------------------------------------------------------------
--  6. Comentar e listar comentários
-- -----------------------------------------------------------------------------
create or replace function public.comunidade_comentar(p_post uuid, p_texto text)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare c jsonb := public._exigir_comunidade(true); v_uid uuid := auth.uid(); v_club uuid; v_papel text;
        v_txt text := public._comunidade_limpar(p_texto); v_post record; v_tri jsonb; v_lim text; v_id uuid;
begin
  v_club := (c ->> 'club')::uuid; v_papel := c ->> 'papel';
  if v_txt is null then raise exception 'Escreva o comentário.'; end if;
  if length(v_txt) > 300 then raise exception 'O comentário pode ter até 300 caracteres.'; end if;
  select * into v_post from public.comunidade_posts where id = p_post;
  if not found or v_post.status <> 'publicado' or not public.recurso_habilitado_no_clube(v_post.club_id, 'comunidade') then
    raise exception 'Esta publicação não está disponível.';
  end if;
  -- adulto de OUTRO clube não comenta em publicação de criança
  if v_post.autor_papel = 'desbravador' and v_papel <> 'desbravador' and v_post.club_id <> v_club then
    raise exception 'Adultos de outro clube não comentam em publicações de desbravadores. Você pode curtir 🙂';
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

create or replace function public.comunidade_comentarios(p_post uuid, p_antes timestamptz default null, p_limite int default 20)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare c jsonb := public._exigir_comunidade(false); v_uid uuid := auth.uid();
        v_lim int := least(greatest(coalesce(p_limite, 20), 1), 50); v_itens jsonb; v_n int;
begin
  if not exists (select 1 from public.comunidade_posts p where p.id = p_post and p.status = 'publicado'
                  and public.recurso_habilitado_no_clube(p.club_id, 'comunidade')) then
    raise exception 'Esta publicação não está disponível.';
  end if;
  with pagina as (
    select k.* from public.comunidade_comentarios k
     where k.post_id = p_post and k.status = 'publicado' and (p_antes is null or k.created_at < p_antes)
     order by k.created_at desc, k.id desc limit v_lim)
  select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'texto', x.texto, 'autor', public._comunidade_autor_json(x.autor_id, x.club_id),
                                               'meu', x.autor_id = v_uid, 'criado_em', x.created_at)
                            order by x.created_at desc, x.id desc), '[]'::jsonb), count(*)
    into v_itens, v_n from pagina x;
  return jsonb_build_object('itens', v_itens,
    'proximo', case when v_n = v_lim then (select min((e ->> 'criado_em')::timestamptz) from jsonb_array_elements(v_itens) e) end);
end;
$$;
revoke all on function public.comunidade_comentarios(uuid, timestamptz, int) from public, anon;
grant execute on function public.comunidade_comentarios(uuid, timestamptz, int) to authenticated;


-- -----------------------------------------------------------------------------
--  7. Apagar o que é meu
-- -----------------------------------------------------------------------------
-- Conteúdo que está em revisão (oculto por denúncia) não se apaga: a diretoria decide.
create or replace function public.comunidade_apagar(p_tipo text, p_id uuid)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_n int; v_foto text;
begin
  if v_uid is null then raise exception 'Sessão expirada.'; end if;
  if p_tipo = 'post' then
    update public.comunidade_posts set status = 'apagado'
     where id = p_id and autor_id = v_uid and status in ('publicado', 'em_analise')
    returning foto_path into v_foto;
  elsif p_tipo = 'comentario' then
    update public.comunidade_comentarios set status = 'apagado'
     where id = p_id and autor_id = v_uid and status = 'publicado';
  else
    raise exception 'Tipo inválido.';
  end if;
  get diagnostics v_n = row_count;
  if v_n = 0 then raise exception 'Não foi possível apagar (não é seu ou está em revisão).'; end if;
  return jsonb_build_object('ok', true, 'foto', v_foto);   -- o app apaga o arquivo do Storage
end;
$$;
revoke all on function public.comunidade_apagar(text, uuid) from public, anon;
grant execute on function public.comunidade_apagar(text, uuid) to authenticated;


-- -----------------------------------------------------------------------------
--  8. Denunciar
-- -----------------------------------------------------------------------------
-- Some NA HORA para todos (status 'oculto_denuncia') e a diretoria do clube de quem publicou é
-- avisada. Exceção: quem denuncia demais sem procedência (N improcedentes na janela) perde o poder
-- de esconder na hora — a denúncia ainda entra na fila, mas o conteúdo fica até a diretoria olhar.
create or replace function public._comunidade_denunciante_confiavel(p_uid uuid)
returns boolean
language sql stable security definer set search_path = '' as $$
  select (select count(*) from public.comunidade_denuncias d
           where d.denunciante_id = p_uid and d.resultado = 'improcedente'
             and d.created_at > now() - make_interval(days => (public.comunidade_limites() ->> 'janela_denuncias_dias')::int))
         < (public.comunidade_limites() ->> 'denuncias_improcedentes_para_perder')::int;
$$;
revoke all on function public._comunidade_denunciante_confiavel(uuid) from public, anon, authenticated;

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
    else
      update public.comunidade_comentarios set status = 'oculto_denuncia' where id = p_id;
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
