-- =============================================================================
-- 471 — REDE DBV: tipos de publicação, DESAFIOS DA REDE, participação, SALVOS, feed com abas e perfil
-- =============================================================================
--   * Publicação ganha tipo: 'livre' (texto), 'foto', 'desafio' (vinculada a um desafio ativo) e
--     'conquista' (texto curto categorizado: classe, especialidade, investidura, acampamento, outra).
--     Legenda da rede: até 300. "Descrição da imagem" (alt, acessibilidade) até 200, e TAMBÉM passa
--     pela triagem (é texto que outras pessoas leem).
--   * Desafios da rede: criados SÓ pelo ADMIN DA PLATAFORMA (sem club_id: exceção no teste 20).
--     Participar = publicar com desafio_id. Participação única por pessoa por desafio (se o post
--     sair do ar por moderação/apagado, a pessoa pode participar de novo).
--   * Pontos da rede ficam SÓ na rede (perfil). NÃO entram em public.pontos nem no ranking do clube
--     (decisão pendente do dono).
--   * Salvos: cada um só vê/mexe nos próprios.
--   * Todas as RPCs passam por _exigir_comunidade (recurso desligado = bloqueia tudo).
-- Classes NÃO aparecem na rede (decisão do dono): nada aqui lê currículo.
-- =============================================================================

-- -----------------------------------------------------------------------------
--  1. Desafios da rede (da PLATAFORMA)
-- -----------------------------------------------------------------------------
create table if not exists public.rede_desafios (
  id uuid primary key default gen_random_uuid(),
  titulo text not null check (length(btrim(titulo)) between 3 and 80),
  descricao text not null default '' check (length(descricao) <= 500),
  pontos int not null default 10 check (pontos between 0 and 1000),
  inicio timestamptz not null default now(),
  fim timestamptz not null,
  ativo boolean not null default true,
  criado_por uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  check (fim > inicio)
);
create index if not exists rede_desafios_periodo_idx on public.rede_desafios (ativo, fim desc);
alter table public.rede_desafios enable row level security;
revoke all on public.rede_desafios from public, anon, authenticated;

-- -----------------------------------------------------------------------------
--  2. Colunas novas na publicação
-- -----------------------------------------------------------------------------
alter table public.comunidade_posts add column if not exists tipo text not null default 'livre';
alter table public.comunidade_posts drop constraint if exists comunidade_posts_tipo_valido;
alter table public.comunidade_posts add constraint comunidade_posts_tipo_valido check (tipo in ('livre', 'foto', 'desafio', 'conquista'));
alter table public.comunidade_posts add column if not exists desafio_id uuid references public.rede_desafios(id) on delete set null;
alter table public.comunidade_posts add column if not exists conquista_categoria text;
alter table public.comunidade_posts drop constraint if exists comunidade_posts_conquista_valida;
alter table public.comunidade_posts add constraint comunidade_posts_conquista_valida
  check (conquista_categoria is null or conquista_categoria in ('classe', 'especialidade', 'investidura', 'acampamento', 'outra'));
alter table public.comunidade_posts add column if not exists foto_alt text;
alter table public.comunidade_posts drop constraint if exists comunidade_posts_alt_tamanho;
alter table public.comunidade_posts add constraint comunidade_posts_alt_tamanho check (foto_alt is null or length(foto_alt) <= 200);
-- vida útil da foto (migration 472 cuida da limpeza): depois de foto_expira_em o post continua, sem a foto
alter table public.comunidade_posts add column if not exists foto_expira_em timestamptz;
alter table public.comunidade_posts add column if not exists foto_apagada_em timestamptz;
create index if not exists comunidade_posts_desafio_idx on public.comunidade_posts (desafio_id) where desafio_id is not null;

-- -----------------------------------------------------------------------------
--  3. Participação (1 por pessoa por desafio) e salvos
-- -----------------------------------------------------------------------------
create table if not exists public.rede_desafio_participacoes (
  desafio_id uuid not null references public.rede_desafios(id) on delete cascade,
  usuario_id uuid not null references public.profiles(id) on delete cascade,
  club_id uuid not null references public.organizational_units(id) on delete cascade,   -- clube de quem participou
  post_id uuid not null references public.comunidade_posts(id) on delete cascade,
  pontos int not null default 0,
  created_at timestamptz not null default now(),
  primary key (desafio_id, usuario_id)
);
create index if not exists rede_participacoes_usuario_idx on public.rede_desafio_participacoes (usuario_id);
alter table public.rede_desafio_participacoes enable row level security;
revoke all on public.rede_desafio_participacoes from public, anon, authenticated;

create table if not exists public.rede_salvos (
  usuario_id uuid not null references public.profiles(id) on delete cascade,
  post_id uuid not null references public.comunidade_posts(id) on delete cascade,
  club_id uuid not null references public.organizational_units(id) on delete cascade,   -- clube em uso de quem salvou
  created_at timestamptz not null default now(),
  primary key (usuario_id, post_id)
);
create index if not exists rede_salvos_lista_idx on public.rede_salvos (usuario_id, created_at desc);
alter table public.rede_salvos enable row level security;
revoke all on public.rede_salvos from public, anon, authenticated;

select public._manutencao_instalar_guarda();


-- -----------------------------------------------------------------------------
--  4. JSON do post (substitui o da 431: + tipo, desafio, conquista, alt e "eu salvei")
-- -----------------------------------------------------------------------------
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
    'tipo', p.tipo,
    'legenda', p.legenda,
    'foto', case when p.foto_apagada_em is null and (p.foto_expira_em is null or p.foto_expira_em > now()) then p.foto_path end,
    'foto_expirada', coalesce(p.foto_path is not null and (p.foto_apagada_em is not null or p.foto_expira_em <= now()), false),
    'foto_alt', p.foto_alt,
    'desafio', (select jsonb_build_object('id', d.id, 'titulo', d.titulo) from public.rede_desafios d where d.id = p.desafio_id),
    'conquista', p.conquista_categoria,
    'status', case when p.autor_id = p_uid then p.status end,
    'autor', public._comunidade_autor_json(p.autor_id, p.club_id),
    'clube_id', p.club_id,
    'crianca', p.autor_papel = 'desbravador',
    'meu', p.autor_id = p_uid,
    'criado_em', p.created_at,
    'curtidas', (select count(*) from public.comunidade_curtidas c where c.post_id = p.id),
    'comentarios', (select count(*) from public.comunidade_comentarios k where k.post_id = p.id and k.status = 'publicado'),
    'eu_curti', exists (select 1 from public.comunidade_curtidas c where c.post_id = p.id and c.usuario_id = p_uid),
    'eu_salvei', exists (select 1 from public.rede_salvos s where s.post_id = p.id and s.usuario_id = p_uid),
    'repost', v_repost);
end;
$$;
revoke all on function public._comunidade_post_json(uuid, uuid, int) from public, anon, authenticated;


-- -----------------------------------------------------------------------------
--  5. Publicar na rede (tipos). Reaproveita comunidade_publicar (triagem, limites, foto em análise,
--     aviso à diretoria) e só completa os campos novos na MESMA transação.
-- -----------------------------------------------------------------------------
create or replace function public.rede_publicar(p_tipo text, p_legenda text default null, p_foto_path text default null,
                                                p_foto_alt text default null, p_desafio uuid default null,
                                                p_conquista text default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare c jsonb := public._exigir_comunidade(true); v_uid uuid := auth.uid(); v_club uuid;
        v_leg text := public._comunidade_limpar(p_legenda); v_alt text := public._comunidade_limpar(p_foto_alt);
        v_tri jsonb; v_d public.rede_desafios; v_r jsonb; v_id uuid; v_ant record;
begin
  v_club := (c ->> 'club')::uuid;
  if coalesce(p_tipo, '') not in ('livre', 'foto', 'desafio', 'conquista') then raise exception 'Tipo de publicação inválido.'; end if;
  if length(v_leg) > 300 then raise exception 'O texto pode ter até 300 caracteres.'; end if;
  if length(v_alt) > 200 then raise exception 'A descrição da imagem pode ter até 200 caracteres.'; end if;
  if p_tipo = 'foto' and p_foto_path is null then raise exception 'Escolha uma foto.'; end if;
  if p_foto_path is null then v_alt := null; end if;

  if p_tipo = 'conquista' then
    if coalesce(p_conquista, '') not in ('classe', 'especialidade', 'investidura', 'acampamento', 'outra') then
      raise exception 'Escolha o tipo da conquista.';
    end if;
    if v_leg is null then raise exception 'Conte qual foi a conquista.'; end if;
  end if;

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
      delete from public.rede_desafio_participacoes where desafio_id = p_desafio and usuario_id = v_uid;  -- a anterior saiu do ar
    end if;
  elsif p_desafio is not null then
    raise exception 'Só publicações de desafio levam um desafio.';
  end if;

  -- a descrição da imagem também é texto público: passa pela mesma triagem
  if v_alt is not null then
    v_tri := public._comunidade_triar(v_alt);
    if not (v_tri ->> 'ok')::boolean then
      return public._comunidade_bloquear(v_uid, v_club, 'post', v_tri, v_alt);
    end if;
  end if;

  v_r := public.comunidade_publicar(v_leg, p_foto_path, null);
  if not coalesce((v_r ->> 'ok')::boolean, false) then return v_r; end if;
  v_id := (v_r ->> 'id')::uuid;

  update public.comunidade_posts
     set tipo = p_tipo, foto_alt = v_alt,
         desafio_id = case when p_tipo = 'desafio' then p_desafio end,
         conquista_categoria = case when p_tipo = 'conquista' then p_conquista end
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
revoke all on function public.rede_publicar(text, text, text, text, uuid, text) from public, anon;
grant execute on function public.rede_publicar(text, text, text, text, uuid, text) to authenticated;


-- -----------------------------------------------------------------------------
--  6. Feed com abas: 'todos' (todos os clubes com o recurso) ou 'meu_clube'
-- -----------------------------------------------------------------------------
create or replace function public.rede_feed(p_filtro text default 'todos', p_antes timestamptz default null,
                                            p_antes_id uuid default null, p_limite int default 10)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare c jsonb := public._exigir_comunidade(false); v_uid uuid := auth.uid(); v_club uuid := (c ->> 'club')::uuid;
        v_lim int := least(greatest(coalesce(p_limite, 10), 1), 20); v_itens jsonb; v_n int; v_antes timestamptz; v_antes_id uuid;
begin
  if coalesce(p_filtro, 'todos') not in ('todos', 'meu_clube') then raise exception 'Filtro inválido.'; end if;
  with pagina as (
    select p.id, p.created_at from public.comunidade_posts p
     where ((p.status = 'publicado' and public.recurso_habilitado_no_clube(p.club_id, 'comunidade'))
            or (p.autor_id = v_uid and p.status = 'em_analise'))
       and (coalesce(p_filtro, 'todos') = 'todos' or p.club_id = v_club)
       and (p_antes is null
            or (p.created_at, p.id) < (p_antes, coalesce(p_antes_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)))
     order by p.created_at desc, p.id desc
     limit v_lim)
  select coalesce(jsonb_agg(public._comunidade_post_json(x.id, v_uid, 0) order by x.created_at desc, x.id desc), '[]'::jsonb), count(*)
    into v_itens, v_n from pagina x;
  if v_n = v_lim then
    select (e ->> 'criado_em')::timestamptz, (e ->> 'id')::uuid into v_antes, v_antes_id
      from jsonb_array_elements(v_itens) with ordinality as a(e, i) order by i desc limit 1;
  end if;
  return jsonb_build_object('itens', v_itens,
    'proximo', case when v_n = v_lim then jsonb_build_object('antes', v_antes, 'antes_id', v_antes_id) end);
end;
$$;
revoke all on function public.rede_feed(text, timestamptz, uuid, int) from public, anon;
grant execute on function public.rede_feed(text, timestamptz, uuid, int) to authenticated;


-- -----------------------------------------------------------------------------
--  7. Salvar (só o próprio usuário vê os próprios salvos)
-- -----------------------------------------------------------------------------
create or replace function public.rede_salvar(p_post uuid, p_salvar boolean default true)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare c jsonb := public._exigir_comunidade(false); v_uid uuid := auth.uid();
begin
  if coalesce(p_salvar, true) then
    if not exists (select 1 from public.comunidade_posts p where p.id = p_post and p.status = 'publicado'
                    and public.recurso_habilitado_no_clube(p.club_id, 'comunidade')) then
      raise exception 'Esta publicação não está disponível.';
    end if;
    insert into public.rede_salvos (usuario_id, post_id, club_id) values (v_uid, p_post, (c ->> 'club')::uuid)
    on conflict (usuario_id, post_id) do nothing;
  else
    delete from public.rede_salvos where usuario_id = v_uid and post_id = p_post;
  end if;
  return jsonb_build_object('ok', true, 'eu_salvei', coalesce(p_salvar, true));
end;
$$;
revoke all on function public.rede_salvar(uuid, boolean) from public, anon;
grant execute on function public.rede_salvar(uuid, boolean) to authenticated;


-- -----------------------------------------------------------------------------
--  8. Desafios (lista para quem está na rede)
-- -----------------------------------------------------------------------------
create or replace function public._rede_desafio_json(p_d public.rede_desafios, p_uid uuid)
returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', p_d.id, 'titulo', p_d.titulo, 'descricao', p_d.descricao, 'pontos', p_d.pontos,
    'inicio', p_d.inicio, 'fim', p_d.fim,
    'dias_restantes', greatest(0, ceil(extract(epoch from (p_d.fim - now())) / 86400)::int),
    'participantes', (select count(*) from public.rede_desafio_participacoes pa join public.comunidade_posts po on po.id = pa.post_id
                       where pa.desafio_id = p_d.id and po.status = 'publicado'),
    'participei', exists (select 1 from public.rede_desafio_participacoes pa join public.comunidade_posts po on po.id = pa.post_id
                           where pa.desafio_id = p_d.id and pa.usuario_id = p_uid
                             and po.status in ('publicado', 'em_analise', 'oculto_denuncia')));
$$;
revoke all on function public._rede_desafio_json(public.rede_desafios, uuid) from public, anon, authenticated;

-- "Desafio da semana" = o aberto que começou por último; os outros abertos vêm na lista.
create or replace function public.rede_desafios()
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare c jsonb := public._exigir_comunidade(false); v_uid uuid := auth.uid(); v_semana uuid;
begin
  select d.id into v_semana from public.rede_desafios d
   where d.ativo and now() between d.inicio and d.fim order by d.inicio desc, d.created_at desc limit 1;
  return jsonb_build_object(
    'semana', (select public._rede_desafio_json(d, v_uid) from public.rede_desafios d where d.id = v_semana),
    'outros', (select coalesce(jsonb_agg(public._rede_desafio_json(d, v_uid) order by d.fim), '[]'::jsonb)
                 from public.rede_desafios d
                where d.ativo and now() between d.inicio and d.fim and d.id is distinct from v_semana));
end;
$$;
revoke all on function public.rede_desafios() from public, anon;
grant execute on function public.rede_desafios() to authenticated;


-- -----------------------------------------------------------------------------
--  9. Perfil público da rede
-- -----------------------------------------------------------------------------
-- Clube do perfil: o clube em uso de quem olha, se a pessoa também estiver nele; senão o vínculo
-- mais antigo num clube com a rede ligada.
create or replace function public._rede_clube_do_perfil(p_uid uuid, p_club_preferido uuid)
returns uuid
language sql stable security definer set search_path = '' as $$
  select x.club from (
    select m.organizational_unit_id as club, (m.organizational_unit_id = p_club_preferido) as preferido, m.starts_at
      from public.organization_memberships m
     where m.user_id = p_uid and m.status = 'ativo' and m.role <> 'pais'
       and m.starts_at <= now() and (m.ends_at is null or m.ends_at > now())
       and public._rede_participa(p_uid, m.organizational_unit_id)) x
   order by x.preferido desc, x.starts_at limit 1;
$$;
revoke all on function public._rede_clube_do_perfil(uuid, uuid) from public, anon, authenticated;

create or replace function public._rede_pontos(p_uid uuid)
returns int
language sql stable security definer set search_path = '' as $$
  select coalesce(sum(pa.pontos), 0)::int from public.rede_desafio_participacoes pa
    join public.comunidade_posts po on po.id = pa.post_id
   where pa.usuario_id = p_uid and po.status = 'publicado';
$$;
revoke all on function public._rede_pontos(uuid) from public, anon, authenticated;

create or replace function public.rede_perfil(p_usuario uuid default null)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare c jsonb := public._exigir_comunidade(false); v_uid uuid := auth.uid(); v_alvo uuid := coalesce(p_usuario, auth.uid());
        v_club uuid; v_papel text; v_desde timestamptz; pr public.profiles; v_eu boolean;
begin
  v_eu := v_alvo = v_uid;
  v_club := case when v_eu then (c ->> 'club')::uuid else public._rede_clube_do_perfil(v_alvo, (c ->> 'club')::uuid) end;
  if v_club is null then raise exception 'Este perfil não está disponível.'; end if;
  select * into pr from public.profiles where id = v_alvo;
  v_papel := public._comunidade_papel(v_alvo, v_club);
  select min(m.starts_at) into v_desde from public.organization_memberships m
   where m.user_id = v_alvo and m.organizational_unit_id = v_club;
  return jsonb_build_object(
    'id', v_alvo,
    'eu', v_eu,
    'nome', public._comunidade_nome_publico(pr.nome),
    'clube', (select u.nome from public.organizational_units u where u.id = v_club),
    'papel', v_papel,
    'desde', extract(year from v_desde)::int,
    'foto', case when public._rede_imagem_autorizada(v_alvo) then pr.foto end,
    'imagem_autorizada', public._rede_imagem_autorizada(v_alvo),
    'publicacoes', (select count(*) from public.comunidade_posts p where p.autor_id = v_alvo and p.status = 'publicado'
                      and public.recurso_habilitado_no_clube(p.club_id, 'comunidade')),
    'conquistas', (select count(*) from public.comunidade_posts p where p.autor_id = v_alvo and p.status = 'publicado'
                     and p.tipo = 'conquista' and public.recurso_habilitado_no_clube(p.club_id, 'comunidade')),
    'pontos', public._rede_pontos(v_alvo));
end;
$$;
revoke all on function public.rede_perfil(uuid) from public, anon;
grant execute on function public.rede_perfil(uuid) to authenticated;

-- Abas do perfil: publicacoes | conquistas | desafios | salvos (salvos: SÓ os meus)
create or replace function public.rede_perfil_posts(p_usuario uuid default null, p_aba text default 'publicacoes',
                                                    p_antes timestamptz default null, p_antes_id uuid default null, p_limite int default 12)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare c jsonb := public._exigir_comunidade(false); v_uid uuid := auth.uid(); v_alvo uuid := coalesce(p_usuario, auth.uid());
        v_lim int := least(greatest(coalesce(p_limite, 12), 1), 30); v_itens jsonb; v_n int; v_antes timestamptz; v_antes_id uuid;
begin
  if coalesce(p_aba, '') not in ('publicacoes', 'conquistas', 'desafios', 'salvos') then raise exception 'Aba inválida.'; end if;
  if p_aba = 'salvos' and v_alvo <> v_uid then raise exception 'Os salvos são só seus.'; end if;
  if v_alvo <> v_uid and public._rede_clube_do_perfil(v_alvo, (c ->> 'club')::uuid) is null then
    raise exception 'Este perfil não está disponível.';
  end if;
  with base as (
    select p.id, case when p_aba = 'salvos' then s.created_at else p.created_at end as ordem
      from public.comunidade_posts p
      left join public.rede_salvos s on p_aba = 'salvos' and s.post_id = p.id and s.usuario_id = v_uid
     where ((p.status = 'publicado' and public.recurso_habilitado_no_clube(p.club_id, 'comunidade'))
            or (p_aba <> 'salvos' and v_alvo = v_uid and p.autor_id = v_uid and p.status = 'em_analise'))
       and case p_aba
             when 'salvos' then s.usuario_id is not null
             when 'conquistas' then p.autor_id = v_alvo and p.tipo = 'conquista'
             when 'desafios' then p.autor_id = v_alvo and p.tipo = 'desafio'
             else p.autor_id = v_alvo and p.repost_de is null end),
  pagina as (
    select b.* from base b
     where p_antes is null or (b.ordem, b.id) < (p_antes, coalesce(p_antes_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid))
     order by b.ordem desc, b.id desc limit v_lim)
  select coalesce(jsonb_agg(public._comunidade_post_json(x.id, v_uid, 0) || jsonb_build_object('_ordem', x.ordem)
                            order by x.ordem desc, x.id desc), '[]'::jsonb), count(*)
    into v_itens, v_n from pagina x;
  if v_n = v_lim then
    select (e ->> '_ordem')::timestamptz, (e ->> 'id')::uuid into v_antes, v_antes_id
      from jsonb_array_elements(v_itens) with ordinality as a(e, i) order by i desc limit 1;
  end if;
  return jsonb_build_object('itens', v_itens,
    'proximo', case when v_n = v_lim then jsonb_build_object('antes', v_antes, 'antes_id', v_antes_id) end);
end;
$$;
revoke all on function public.rede_perfil_posts(uuid, text, timestamptz, uuid, int) from public, anon;
grant execute on function public.rede_perfil_posts(uuid, text, timestamptz, uuid, int) to authenticated;


-- -----------------------------------------------------------------------------
-- 10. Admin da plataforma: cadastro simples de desafios
-- -----------------------------------------------------------------------------
create or replace function public.admin_rede_desafios()
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public._exigir_admin_plataforma();
  return (select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'titulo', d.titulo, 'descricao', d.descricao, 'pontos', d.pontos,
            'inicio', d.inicio, 'fim', d.fim, 'ativo', d.ativo,
            'participantes', (select count(*) from public.rede_desafio_participacoes pa where pa.desafio_id = d.id))
            order by d.inicio desc), '[]'::jsonb) from public.rede_desafios d);
end;
$$;
revoke all on function public.admin_rede_desafios() from public, anon;
grant execute on function public.admin_rede_desafios() to authenticated;

create or replace function public.admin_rede_desafio_salvar(p_id uuid, p_titulo text, p_descricao text, p_pontos int,
                                                            p_inicio timestamptz, p_fim timestamptz, p_ativo boolean default true)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  perform public._exigir_admin_plataforma();
  if p_inicio is null or p_fim is null or p_fim <= p_inicio then raise exception 'O fim precisa ser depois do início.'; end if;
  if p_id is null then
    insert into public.rede_desafios (titulo, descricao, pontos, inicio, fim, ativo, criado_por)
    values (btrim(p_titulo), coalesce(btrim(p_descricao), ''), coalesce(p_pontos, 10), p_inicio, p_fim, coalesce(p_ativo, true), auth.uid())
    returning id into v_id;
  else
    update public.rede_desafios
       set titulo = btrim(p_titulo), descricao = coalesce(btrim(p_descricao), ''), pontos = coalesce(p_pontos, 10),
           inicio = p_inicio, fim = p_fim, ativo = coalesce(p_ativo, true)
     where id = p_id returning id into v_id;
    if v_id is null then raise exception 'Desafio não encontrado.'; end if;
  end if;
  perform public._admin_auditar('rede_desafio_salvar', 'rede_desafio', v_id,
    jsonb_build_object('titulo', btrim(p_titulo), 'pontos', p_pontos, 'ativo', coalesce(p_ativo, true)));
  return public.admin_rede_desafios();
end;
$$;
revoke all on function public.admin_rede_desafio_salvar(uuid, text, text, int, timestamptz, timestamptz, boolean) from public, anon;
grant execute on function public.admin_rede_desafio_salvar(uuid, text, text, int, timestamptz, timestamptz, boolean) to authenticated;
