-- =============================================================================
--  517 — REDE DBV: lista de conquistas publicáveis, aviso/evento só da liderança, comentário na Comunidade
--        só de adulto com papel, e audiolivros sem fonte documentada desligados.
--
--  C1  rede_conquistas_publicaveis(p_alcance): lista, para a diretoria/instrutor do clube atual, as conquistas REAIS
--      (classe investida / especialidade concluída, não revogada) de membros do PRÓPRIO clube que ainda não foram
--      publicadas no alcance pedido, com a prévia EXATA do texto que o servidor publicaria (nome reduzido). Mesma
--      base e mesmas regras de rede_publicar_conquista (que passa a usar os mesmos helpers e recusa o que não está
--      na lista). Nada vem do cliente (sem nome/título/club_id como parâmetro).
--  C2  aviso e evento (qualquer alcance): só diretoria|instrutor (pode_gerir_atividades). 'atividade' não é do desbravador.
--  C3  comentário em publicação de alcance 'comunidade': só adulto com vínculo ativo e papel diretoria|instrutor|conselheiro
--      no clube atual (nem pais, tesoureiro, coordenação por cargo, nem admin da plataforma sem vínculo). Desbravador
--      mantém a regra de 515 (só no PRÓPRIO clube).
--  C4  audiolivros: 'O Desejado de Todas as Nações' e 'O Maior Discurso de Cristo' ficam DESLIGADOS (ativo=false; nada apagado).
--      Motivo: o repositório só tem o ID do vídeo/playlist e a frase "links do dono conferidos" (migration 370), sem
--      registro verificável de origem (URL do canal, data de conferência, licença): o Desejado não tem playlist nem data;
--      o Maior Discurso nem o canal tem. O admin religa quando a fonte for documentada.
--  Nenhuma tabela nova (por isso sem _manutencao_instalar_guarda).
-- =============================================================================

-- ---------------------------------------------------------------------------
--  1. Conquistas: base única, regras e texto
-- ---------------------------------------------------------------------------
create or replace function public._rede_conquistas_do_clube(p_club uuid)
returns table(origem_tipo text, origem_id uuid, membro_id uuid, titulo text, rotulo text, concluida_em timestamptz)
language sql stable security definer set search_path = '' as $$
  select 'classe'::text, mc.id, mc.usuario_id, cl.nome, 'Classe'::text, coalesce(mc.investida_em, mc.concluida_em, mc.updated_at)
    from public.member_classes mc join public.classes cl on cl.id = mc.class_id
   where mc.club_id = p_club and mc.status = 'investida'
     and not exists (select 1 from public.curriculum_achievements a where a.member_class_id = mc.id and a.status = 'revogada')
  union all
  select 'especialidade'::text, ms.id, ms.usuario_id, sp.nome, 'Especialidade'::text, coalesce(ms.concluida_em, ms.updated_at)
    from public.member_specialties ms join public.specialties sp on sp.id = ms.specialty_id
   where ms.club_id = p_club and ms.status = 'concluida'
     and not exists (select 1 from public.curriculum_achievements a where a.member_specialty_id = ms.id and a.status = 'revogada');
$$;
revoke all on function public._rede_conquistas_do_clube(uuid) from public, anon, authenticated;

create or replace function public._rede_conquista_membro_ok(p_club uuid, p_membro uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public._rede_participa(p_membro, p_club) and coalesce(public._comunidade_papel(p_membro, p_club), 'pais') <> 'pais';
$$;
revoke all on function public._rede_conquista_membro_ok(uuid, uuid) from public, anon, authenticated;

create or replace function public._rede_conquista_ja_publicada(p_tipo text, p_id uuid, p_alcance text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.comunidade_posts p
                  where p.conquista_origem_tipo = p_tipo and p.conquista_origem_id = p_id and p.alcance = p_alcance
                    and p.status in ('publicado', 'em_analise', 'oculto_denuncia'));
$$;
revoke all on function public._rede_conquista_ja_publicada(text, uuid, text) from public, anon, authenticated;

-- o texto que o servidor publica (e que a lista mostra como prévia): nome reduzido + conquista + clube
create or replace function public._rede_conquista_legenda(p_nome text, p_tipo text, p_titulo text, p_clube_nome text)
returns text language sql immutable set search_path = '' as $$
  select left(public._rede_nome_reduzido(p_nome)
              || case when p_tipo = 'classe' then ' concluiu a classe ' else ' concluiu a especialidade ' end
              || p_titulo || ' no clube ' || p_clube_nome || ' 🎉', 500);
$$;
revoke all on function public._rede_conquista_legenda(text, text, text, text) from public, anon, authenticated;

create or replace function public.rede_conquistas_publicaveis(p_alcance text default 'clube')
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare x jsonb := public._rede_contexto(); v_uid uuid := auth.uid(); v_club uuid := (x ->> 'unidade')::uuid;
        v_alc text := coalesce(nullif(btrim(p_alcance), ''), 'clube'); v_nome_clube text;
begin
  if v_alc not in ('clube', 'comunidade') then raise exception 'Alcance inválido.'; end if;
  -- mesmas portas de rede_publicar_conquista; quem não pode publicar recebe lista vazia (sem erro, sem pista)
  if v_uid is null or v_club is null or (x ->> 'modo') is distinct from 'clube'
     or not public.recurso_habilitado_no_clube(v_club, 'comunidade')
     or not public.pode_gerir_atividades(v_club)
     or public._comunidade_suspenso_ate(v_uid) is not null then
    return '[]'::jsonb;
  end if;
  select u.nome into v_nome_clube from public.organizational_units u where u.id = v_club;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'origem_tipo', q.origem_tipo, 'origem_id', q.origem_id, 'titulo', q.titulo, 'rotulo', q.rotulo,
             'concluida_em', q.concluida_em,
             'previa', public._rede_conquista_legenda(q.nome, q.origem_tipo, q.titulo, v_nome_clube))
           order by q.concluida_em desc, q.origem_id)
      from (select c.origem_tipo, c.origem_id, c.titulo, c.rotulo, c.concluida_em, pr.nome
              from public._rede_conquistas_do_clube(v_club) c
              join public.profiles pr on pr.id = c.membro_id
             where public._rede_conquista_membro_ok(v_club, c.membro_id)
               and not public._rede_conquista_ja_publicada(c.origem_tipo, c.origem_id, v_alc)
             order by c.concluida_em desc, c.origem_id
             limit 200) q), '[]'::jsonb);
end;
$$;
revoke all on function public.rede_conquistas_publicaveis(text) from public, anon;
grant execute on function public.rede_conquistas_publicaveis(text) to authenticated;

-- publicar: mesma base da lista (a origem tem de estar nela). Mensagens de 515 mantidas.
create or replace function public.rede_publicar_conquista(p_origem_tipo text, p_origem_id uuid, p_alcance text default 'clube')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare c jsonb := public._exigir_comunidade(true); v_uid uuid := auth.uid(); v_club uuid := (c ->> 'club')::uuid;
        v_alc text := coalesce(nullif(btrim(p_alcance), ''), 'clube');
        v_o record; v_nome text; v_clube_nome text; v_leg text; v_lim text; v_id uuid;
begin
  if v_alc not in ('clube', 'comunidade') then raise exception 'Alcance inválido.'; end if;
  if coalesce(p_origem_tipo, '') not in ('classe', 'especialidade') then raise exception 'Origem da conquista inválida.'; end if;
  if (c ->> 'modo') = 'coordenacao' or not public.pode_gerir_atividades(v_club) then
    raise exception 'Só a diretoria e os instrutores do clube publicam conquistas.';
  end if;

  select * into v_o from public._rede_conquistas_do_clube(v_club) o
   where o.origem_tipo = p_origem_tipo and o.origem_id = p_origem_id;
  if not found then
    raise exception 'Não encontramos essa conquista concluída no seu clube.';
  end if;
  if not public._rede_conquista_membro_ok(v_club, v_o.membro_id) then
    raise exception 'Este membro não participa da Rede neste clube.';
  end if;
  if public._rede_conquista_ja_publicada(p_origem_tipo, p_origem_id, v_alc) then
    raise exception 'Esta conquista já foi publicada.';
  end if;

  v_lim := public._comunidade_limite(v_uid, 'post');
  if v_lim is not null then
    return jsonb_build_object('ok', false, 'motivo', 'limite', 'mensagem', v_lim);
  end if;

  select pr.nome into v_nome from public.profiles pr where pr.id = v_o.membro_id;
  select u.nome into v_clube_nome from public.organizational_units u where u.id = v_club;
  v_leg := public._rede_conquista_legenda(v_nome, p_origem_tipo, v_o.titulo, v_clube_nome);

  insert into public.comunidade_posts (club_id, autor_id, autor_papel, legenda, status, publicado_em, tipo, alcance,
                                       conquista_categoria, conquista_origem_tipo, conquista_origem_id)
  values (v_club, v_uid, c ->> 'papel', v_leg, 'publicado', now(), 'conquista', v_alc, p_origem_tipo, p_origem_tipo, p_origem_id)
  returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id, 'status', 'publicado', 'mensagem', 'Conquista publicada! 🎉',
                            'post', public._comunidade_post_json(v_id, v_uid, 0));
end;
$$;
revoke all on function public.rede_publicar_conquista(text, uuid, text) from public, anon;
grant execute on function public.rede_publicar_conquista(text, uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
--  2. rede_publicar: aviso/evento só da liderança (qualquer alcance); atividade não é do desbravador
-- ---------------------------------------------------------------------------
create or replace function public.rede_publicar(p_tipo text, p_legenda text default null, p_foto_path text default null,
                                                p_foto_alt text default null, p_desafio uuid default null,
                                                p_conquista text default null, p_alcance text default 'clube')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare c jsonb := public._exigir_comunidade(true); v_uid uuid := auth.uid(); v_club uuid;
        v_leg text := public._comunidade_limpar(p_legenda); v_alt text := public._comunidade_limpar(p_foto_alt);
        v_tri jsonb; v_d public.rede_desafios; v_r jsonb; v_id uuid; v_ant record;
        v_alc text := coalesce(nullif(btrim(p_alcance), ''), 'clube');
begin
  v_club := (c ->> 'club')::uuid;
  if v_alc not in ('clube', 'comunidade') then raise exception 'Alcance inválido.'; end if;
  if coalesce(p_tipo, '') not in ('atividade', 'conquista', 'evento', 'aviso', 'foto_clube', 'livre', 'foto', 'desafio') then
    raise exception 'Tipo de publicação inválido.';
  end if;
  -- D6: conquista não é mais texto livre
  if p_tipo = 'conquista' then
    raise exception 'Conquistas são publicadas pela diretoria ou pelos instrutores a partir do registro real (classe ou especialidade concluída).';
  end if;
  -- D2: só quem gere atividades publica na Comunidade
  if v_alc = 'comunidade' then
    if (c ->> 'modo') = 'coordenacao' or not public.pode_gerir_atividades(v_club) then
      raise exception 'Só a diretoria e os instrutores do clube publicam na Comunidade. Você pode publicar no Meu Clube 🙂';
    end if;
    if p_tipo in ('livre', 'foto', 'desafio') then
      raise exception 'Este tipo de publicação só existe no Meu Clube.';
    end if;
  end if;
  -- 517: aviso e evento são da liderança do clube (diretoria|instrutor), em qualquer alcance
  if p_tipo in ('aviso', 'evento') and ((c ->> 'modo') = 'coordenacao' or not public.pode_gerir_atividades(v_club)) then
    raise exception 'Avisos e eventos são publicados só pela diretoria e pelos instrutores do clube. Você pode publicar uma foto ou um recado no Meu Clube 🙂';
  end if;
  if p_tipo = 'atividade' and (c ->> 'papel') = 'desbravador' then
    raise exception 'Atividades do clube são publicadas pela liderança. Você pode publicar uma foto ou um recado no Meu Clube 🙂';
  end if;
  if length(v_leg) > 300 then raise exception 'O texto pode ter até 300 caracteres.'; end if;
  if length(v_alt) > 200 then raise exception 'A descrição da imagem pode ter até 200 caracteres.'; end if;
  if p_tipo in ('foto', 'foto_clube') and p_foto_path is null then raise exception 'Escolha uma foto.'; end if;
  if p_tipo = 'foto_clube' and v_alt is null then raise exception 'Descreva a foto para quem não consegue vê-la.'; end if;
  if p_foto_path is null then v_alt := null; end if;

  if p_tipo = 'desafio' then
    select * into v_d from public.rede_desafios d where d.id = p_desafio;
    if not found or not v_d.ativo or now() < v_d.inicio or now() > v_d.fim then
      raise exception 'Este desafio não está aberto.';
    end if;
    select pa.post_id, po.status into v_ant from public.rede_desafio_participacoes pa
      join public.comunidade_posts po on po.id = pa.post_id
     where pa.desafio_id = p_desafio and pa.usuario_id = v_uid;
    if found then
      if v_ant.status in ('publicado', 'em_analise', 'oculto_denuncia') then
        raise exception 'Você já participou deste desafio 🙂';
      end if;
      delete from public.rede_desafio_participacoes where desafio_id = p_desafio and usuario_id = v_uid;
    end if;
  elsif p_desafio is not null then
    raise exception 'Só publicações de desafio levam um desafio.';
  end if;

  if v_alt is not null then
    v_tri := public._comunidade_triar(v_alt);
    if not (v_tri ->> 'ok')::boolean then
      return public._comunidade_bloquear(v_uid, v_club, 'post', v_tri, v_alt);
    end if;
  end if;

  v_r := public._comunidade_publicar_interno(v_leg, p_foto_path, null, v_alc);
  if not coalesce((v_r ->> 'ok')::boolean, false) then return v_r; end if;
  v_id := (v_r ->> 'id')::uuid;

  update public.comunidade_posts
     set tipo = p_tipo, foto_alt = v_alt, desafio_id = case when p_tipo = 'desafio' then p_desafio end
   where id = v_id;
  if p_tipo = 'desafio' then
    insert into public.rede_desafio_participacoes (desafio_id, usuario_id, club_id, post_id, pontos)
    values (p_desafio, v_uid, v_club, v_id, v_d.pontos);
  end if;
  return v_r || jsonb_build_object('post', public._comunidade_post_json(v_id, v_uid, 0),
    'mensagem', case when p_tipo = 'desafio' and (v_r ->> 'status') = 'publicado'
                     then 'Participação registrada! +' || v_d.pontos || ' pontos na rede 🏅'
                     else v_r ->> 'mensagem' end);
end;
$$;
revoke all on function public.rede_publicar(text, text, text, text, uuid, text, text) from public, anon;
grant execute on function public.rede_publicar(text, text, text, text, uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
--  3. Comentar: na Comunidade, só adulto com papel (diretoria|instrutor|conselheiro) no clube atual
-- ---------------------------------------------------------------------------
create or replace function public.comunidade_comentar(p_post uuid, p_texto text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare c jsonb := public._exigir_comunidade(true); v_uid uuid := auth.uid(); v_club uuid; v_papel text;
        v_txt text := public._comunidade_limpar(p_texto); v_post record; v_tri jsonb; v_lim text; v_id uuid;
begin
  v_club := (c ->> 'club')::uuid; v_papel := c ->> 'papel';
  if v_txt is null then raise exception 'Escreva o comentário.'; end if;
  if length(v_txt) > 300 then raise exception 'O comentário pode ter até 300 caracteres.'; end if;
  select * into v_post from public.comunidade_posts where id = p_post;
  if not found or v_post.status <> 'publicado' or not public._rede_pode_ver_item(p_post, v_uid) then
    raise exception 'Esta publicação não está disponível.';
  end if;
  -- 515 (G4): desbravador só comenta no conteúdo do PRÓPRIO clube
  if v_papel = 'desbravador' and v_post.club_id <> v_club then
    raise exception 'Você comenta só nas publicações do seu clube. Você pode curtir 🙂';
  end if;
  -- 517: na Comunidade (interclubes) comenta só adulto com papel no clube atual; coordenação por cargo e admin da
  -- plataforma (sem vínculo de clube) não comentam; tesoureiro e responsáveis também não
  if v_post.alcance = 'comunidade' and v_papel <> 'desbravador'
     and ((c ->> 'modo') = 'coordenacao' or v_papel not in ('diretoria', 'instrutor', 'conselheiro')) then
    raise exception 'Na Comunidade comentam só a diretoria, os instrutores e os conselheiros dos clubes. Você pode curtir 🙂';
  end if;
  -- adulto de OUTRO clube não comenta em publicação de criança; a coordenação só na sua área
  if v_post.autor_papel = 'desbravador' and v_papel <> 'desbravador' and v_post.club_id <> v_club then
    if (c ->> 'modo') = 'coordenacao' then
      if v_post.club_id not in (select a.id from public._rede_unidades_da_area(v_club) a) then
        raise exception 'A coordenação só comenta em publicações de desbravadores dos clubes da sua área. Você pode curtir 🙂';
      end if;
    else
      raise exception 'Adultos de outro clube não comentam em publicações de desbravadores. Você pode curtir 🙂';
    end if;
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

-- ---------------------------------------------------------------------------
--  4. Audiolivros sem fonte documentada: desligados (nada apagado; o admin religa ao documentar a fonte)
-- ---------------------------------------------------------------------------
update public.audiolivros
   set ativo = false, updated_at = now()
 where titulo in ('O Desejado de Todas as Nações', 'O Maior Discurso de Cristo') and ativo;

-- o catálogo de leitura também não oferece áudio de livro desligado (mesma regra da 516)
update public.leitura_materiais m
   set audio_confirmado = false
  from public.audiolivros a
 where m.audiolivro_id = a.id and a.ativo = false and m.audio_confirmado;
