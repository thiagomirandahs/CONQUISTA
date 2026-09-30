-- =============================================================================
--  515 — REDE DBV: dois alcances ("Meu Clube" x "Comunidade"), quem publica, conquistas seguras,
--        menores protegidos entre clubes e auditoria do admin da plataforma.
--
--  Decisão do dono (ver REDE-DBV-AUDITORIA-MATRIZ.md, seções 2–4). Resumo:
--   D1  comunidade_posts.alcance ('clube' | 'comunidade'), padrão SEMPRE 'clube'. Nada vira 'comunidade'
--       por automação, repost ou mudança de recurso. Stories ficam só 'clube' (constraint).
--       Backfill (só na 1ª aplicação): posts de diretoria|instrutor de CLUBE -> 'comunidade'; o resto 'clube'.
--   D2  alcance 'comunidade' só para quem tem pode_gerir_atividades (diretoria|instrutor, migr. 210–212).
--       rede_publicar ganha p_alcance (DEFAULT 'clube'): o app antigo continua funcionando e cria 'clube'.
--   D3  tipos novos: atividade|conquista|evento|aviso|foto_clube (sem vídeo). Legados livre|foto|desafio
--       só no alcance 'clube' (compat do app antigo).
--   D4  admin da plataforma: só vê/modera item 'comunidade' (ou de unidade de coordenação) denunciado ou em
--       análise; toda leitura/ação vai para plataforma_acesso_log (append-only).
--   D5  foto no alcance 'comunidade' exige aprovação; servidor confere 1 imagem, jpeg|webp, <= 300 KB.
--   D6  conquista só por rede_publicar_conquista(origem real); p_conquista livre não é mais aceito.
--   G4/G6/G7/G10 (auditoria): desbravador não comenta conteúdo de outro clube; autor que saiu do clube some do
--       feed; menor não aparece em busca/perfil/nome completo/unidade fora do próprio clube; comentários
--       paginam com desempate por id.
--
--  Regras de implementação: toda função security definer com search_path ''; helpers internos sem EXECUTE
--  para anon/authenticated; RPCs novas só para authenticated. Sem policy/grant novos em tabelas.
--  Idempotente: create or replace / if not exists; o backfill só roda quando a coluna ainda não existe.
-- =============================================================================

-- ---------------------------------------------------------------------------
--  1. Schema
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'comunidade_posts' and column_name = 'alcance') then
    alter table public.comunidade_posts add column alcance text not null default 'clube';
    -- Backfill conservador e único: só o que a diretoria/instrutores de um CLUBE já publicava fica na Comunidade.
    update public.comunidade_posts p set alcance = 'comunidade'
      from public.organizational_units u
     where u.id = p.club_id and u.type = 'clube' and p.autor_papel in ('diretoria', 'instrutor');
  end if;
end $$;

alter table public.comunidade_posts drop constraint if exists comunidade_posts_alcance_valido;
alter table public.comunidade_posts add constraint comunidade_posts_alcance_valido check (alcance in ('clube', 'comunidade'));

alter table public.comunidade_posts drop constraint if exists comunidade_posts_tipo_valido;
alter table public.comunidade_posts add constraint comunidade_posts_tipo_valido
  check (tipo in ('livre', 'foto', 'desafio', 'conquista', 'atividade', 'evento', 'aviso', 'foto_clube'));

-- origem real da conquista (classe/especialidade concluída). Só a RPC rede_publicar_conquista preenche.
alter table public.comunidade_posts add column if not exists conquista_origem_tipo text;
alter table public.comunidade_posts add column if not exists conquista_origem_id uuid;
alter table public.comunidade_posts drop constraint if exists comunidade_posts_conquista_origem_valida;
alter table public.comunidade_posts add constraint comunidade_posts_conquista_origem_valida
  check ((conquista_origem_tipo is null and conquista_origem_id is null)
      or (conquista_origem_tipo in ('classe', 'especialidade') and conquista_origem_id is not null));

create unique index if not exists comunidade_posts_conquista_origem_uk
  on public.comunidade_posts (conquista_origem_tipo, conquista_origem_id, alcance)
  where conquista_origem_id is not null and status in ('publicado', 'em_analise', 'oculto_denuncia');
create index if not exists comunidade_posts_alcance_feed_idx
  on public.comunidade_posts (created_at desc, id desc) where status = 'publicado' and alcance = 'comunidade';

-- stories: só 'clube' (congelado; nenhuma publicação nova em alcance comunidade)
alter table public.rede_stories add column if not exists alcance text not null default 'clube';
alter table public.rede_stories drop constraint if exists rede_stories_alcance_so_clube;
alter table public.rede_stories add constraint rede_stories_alcance_so_clube check (alcance = 'clube');

-- log de acesso do admin da plataforma (append-only)
create table if not exists public.plataforma_acesso_log (
  id            uuid primary key default gen_random_uuid(),
  admin_user_id uuid not null,            -- sem FK de propósito: o log sobrevive à conta
  o_que         text not null,            -- ex.: 'foto', 'painel_comunidade', 'moderar_remover'
  item_tipo     text,
  item_id       uuid,
  item_club_id  uuid,                     -- clube do item (proveniência; sem FK: o log é append-only e sobrevive ao clube)
  quando        timestamptz not null default now()
);
create index if not exists plataforma_acesso_log_quando_idx on public.plataforma_acesso_log (quando desc);
alter table public.plataforma_acesso_log enable row level security;
revoke all on public.plataforma_acesso_log from public, anon, authenticated;

create or replace function public._plataforma_log_imutavel()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  raise exception 'O registro de acesso da plataforma não se altera.';
end;
$$;
revoke all on function public._plataforma_log_imutavel() from public, anon, authenticated;

drop trigger if exists plataforma_acesso_log_imutavel on public.plataforma_acesso_log;
create trigger plataforma_acesso_log_imutavel before update or delete on public.plataforma_acesso_log
  for each row execute function public._plataforma_log_imutavel();
drop trigger if exists plataforma_acesso_log_sem_truncate on public.plataforma_acesso_log;
create trigger plataforma_acesso_log_sem_truncate before truncate on public.plataforma_acesso_log
  for each statement execute function public._plataforma_log_imutavel();

-- ---------------------------------------------------------------------------
--  2. Helpers
-- ---------------------------------------------------------------------------
-- 1º nome + inicial do 2º nome ("Maria S."): a forma que a Comunidade mostra de menores/conquistas.
create or replace function public._rede_nome_reduzido(p_nome text)
returns text language plpgsql immutable set search_path = '' as $$
declare v_partes text[]; v_primeiro text; v_seg text; i int;
begin
  v_partes := regexp_split_to_array(btrim(regexp_replace(coalesce(p_nome, ''), '\s+', ' ', 'g')), ' ');
  v_primeiro := nullif(v_partes[1], '');
  if v_primeiro is null then return 'Desbravador(a)'; end if;
  for i in 2 .. coalesce(array_length(v_partes, 1), 1) loop
    if lower(v_partes[i]) not in ('de', 'da', 'do', 'dos', 'das', 'e', 'di', 'du', 'del') then
      v_seg := v_partes[i];
      exit;
    end if;
  end loop;
  return initcap(v_primeiro) || coalesce(' ' || upper(left(v_seg, 1)) || '.', '');
end;
$$;
revoke all on function public._rede_nome_reduzido(text) from public, anon, authenticated;

-- quem chama tem vínculo ativo NESTE clube (ou numa unidade de coordenação que o contém)?
create or replace function public._rede_leitor_do_clube(p_club uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists (
    select 1 from public.organization_memberships m
      cross join lateral public._rede_unidades_da_area(m.organizational_unit_id) a
     where m.user_id = auth.uid() and m.status = 'ativo'
       and m.starts_at <= now() and (m.ends_at is null or m.ends_at > now())
       and a.id = p_club);
$$;
revoke all on function public._rede_leitor_do_clube(uuid) from public, anon, authenticated;

-- unidades ACIMA (pais, avós...) de uma unidade, sem ela mesma: a coordenação que enxerga o clube
create or replace function public._rede_unidades_acima(p_unit uuid)
returns table(id uuid) language sql stable security definer set search_path = '' as $$
  with recursive sobe as (
    select u.parent_id as id, 1 as n from public.organizational_units u where u.id = p_unit and u.parent_id is not null
    union all
    select o.parent_id, s.n + 1 from public.organizational_units o join sobe s on o.id = s.id
     where o.parent_id is not null and s.n < 12)
  select sobe.id from sobe;
$$;
revoke all on function public._rede_unidades_acima(uuid) from public, anon, authenticated;

-- FUNÇÃO CENTRAL DE VISIBILIDADE. Quem vê este item? (feed, post, comentários, curtir, salvar, foto, perfil)
--   p_ctx_club/p_modo = contexto do leitor (_rede_contexto). Sempre exige: item publicado (ou em análise
--   só para o autor), rede ligada no clube do item e AUTOR ainda participando do clube (G6).
--   'clube'     -> só o mesmo clube (coordenação: clubes da sua área; clube: a coordenação acima dele) e o próprio autor.
--   'comunidade'-> qualquer participante da Rede (desbravador não publica aí; o autor de menor aparece reduzido,
--                  ver _comunidade_autor_json).
create or replace function public._rede_item_visivel(p_uid uuid, p_ctx_club uuid, p_modo text, p_item_club uuid,
                                                     p_alcance text, p_autor uuid, p_status text)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare v_papel_autor text; v_mesmo boolean;
begin
  if p_uid is null or p_item_club is null or p_ctx_club is null then return false; end if;
  if p_status = 'em_analise' then return p_autor = p_uid; end if;
  if p_status <> 'publicado' then return false; end if;
  if not public._rede_unidade_ligada(p_item_club) then return false; end if;
  v_papel_autor := public._comunidade_papel(p_autor, p_item_club);
  if v_papel_autor is null or (v_papel_autor = 'desbravador' and not public._comunidade_autorizado(p_autor, p_item_club)) then
    return false;
  end if;
  if p_autor = p_uid then return true; end if;
  -- "mesmo lugar": o mesmo clube, ou um dentro da área do outro (coordenação <-> clubes abaixo dela)
  v_mesmo := p_item_club = p_ctx_club
          or exists (select 1 from public._rede_unidades_da_area(p_ctx_club) a where a.id = p_item_club)
          or exists (select 1 from public._rede_unidades_da_area(p_item_club) a where a.id = p_ctx_club);
  if p_alcance = 'comunidade' then return true; end if;
  return v_mesmo;
end;
$$;
revoke all on function public._rede_item_visivel(uuid, uuid, text, uuid, text, uuid, text) from public, anon, authenticated;

-- versão por id de post, com o contexto de quem chama
create or replace function public._rede_pode_ver_item(p_post uuid, p_uid uuid)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare x jsonb := public._rede_contexto(); p record;
begin
  select club_id, alcance, autor_id, status into p from public.comunidade_posts where id = p_post;
  if not found then return false; end if;
  return public._rede_item_visivel(p_uid, (x ->> 'unidade')::uuid, x ->> 'modo', p.club_id, p.alcance, p.autor_id, p.status);
end;
$$;
revoke all on function public._rede_pode_ver_item(uuid, uuid) from public, anon, authenticated;

-- o nome antigo vira apelido da função central
create or replace function public._comunidade_post_visivel(p_post uuid, p_uid uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public._rede_pode_ver_item(p_post, p_uid);
$$;

-- registra um acesso/ação do admin da plataforma (quem, o quê, item, quando). Falha => false (quem chama nega).
create or replace function public._plataforma_acesso_registrar(p_o_que text, p_item_tipo text, p_item_id uuid, p_club uuid default null)
returns boolean language plpgsql volatile security definer set search_path = '' as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then return false; end if;
  if exists (select 1 from public.plataforma_acesso_log l
              where l.admin_user_id = v_uid and l.o_que = p_o_que and l.item_id is not distinct from p_item_id
                and l.quando > now() - interval '1 minute') then
    return true;
  end if;
  insert into public.plataforma_acesso_log (admin_user_id, o_que, item_tipo, item_id, item_club_id)
  values (v_uid, left(p_o_que, 80), p_item_tipo, p_item_id, p_club);
  return true;
exception when others then
  return false;
end;
$$;
revoke all on function public._plataforma_acesso_registrar(text, text, uuid, uuid) from public, anon, authenticated;

-- a plataforma só enxerga/modera item 'comunidade' (ou de unidade de coordenação) denunciado ou em análise
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
       where s.id = p_id and u.type <> 'clube'
         and (s.status in ('em_analise', 'oculto_denuncia')
              or exists (select 1 from public.comunidade_denuncias d where d.alvo_tipo = 'story' and d.alvo_id = s.id and d.resultado = 'pendente')))
    else false end;
$$;
revoke all on function public._plataforma_pode_item(text, uuid) from public, anon, authenticated;

-- foto exige aprovação por alcance (o legado sem argumento continua false: Meu Clube publica direto)
create or replace function public.rede_foto_exige_aprovacao(p_alcance text)
returns boolean language sql stable set search_path = '' as $$ select coalesce(p_alcance, 'clube') = 'comunidade' $$;
revoke all on function public.rede_foto_exige_aprovacao(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
--  3. Menores: autor, perfil, busca, foto de perfil
-- ---------------------------------------------------------------------------
create or replace function public._comunidade_autor_json(p_autor uuid, p_club uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  with x as (
    select public._comunidade_papel(p_autor, p_club) as papel,
           (p_autor = auth.uid() or public._rede_leitor_do_clube(p_club)) as intimo)
  select jsonb_build_object(
    'id', p_autor,
    -- 515: menor visto de fora do clube dele = 1º nome + inicial, sem unidade, sem foto de rosto
    'nome', case when x.papel = 'desbravador' and not x.intimo then public._rede_nome_reduzido(pr.nome)
                 else public._comunidade_nome_publico(pr.nome) end,
    'clube', case when u.type is distinct from 'clube' and u.id is not null then 'Coordenação · ' || u.nome else u.nome end,
    'coordenacao', coalesce(u.type <> 'clube', false),
    'unidade', case when u.type = 'clube' and (x.papel is distinct from 'desbravador' or x.intimo) then (
        select un.nome
          from public.organization_memberships m
          join public.unidades un on un.id = m.unidade_id and un.club_id = p_club
         where m.user_id = p_autor and m.organizational_unit_id = p_club
           and m.status = 'ativo' and m.starts_at <= now() and (m.ends_at is null or m.ends_at > now())
         order by (m.role <> 'pais') desc, m.created_at desc, m.id desc
         limit 1) end,
    'avatar_tipo', case when pr.avatar_tipo = 'personagem' then 'personagem' end,
    'avatar', case when pr.avatar_tipo = 'personagem' then pr.avatar end,
    'foto', case when pr.avatar_tipo is distinct from 'personagem' and public._rede_imagem_autorizada(p_autor)
                  and (x.papel is distinct from 'desbravador' or x.intimo) then pr.foto end)
    from x cross join public.profiles pr left join public.organizational_units u on u.id = p_club
   where pr.id = p_autor;
$$;

-- perfil de OUTRA pessoa: menor só dentro do próprio clube (vale para rede_perfil e rede_perfil_posts)
create or replace function public._rede_clube_do_perfil(p_uid uuid, p_club_preferido uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  select x.club from (
    select m.organizational_unit_id as club, (m.organizational_unit_id = p_club_preferido) as preferido, m.starts_at
      from public.organization_memberships m
     where m.user_id = p_uid and m.status = 'ativo' and m.role <> 'pais'
       and m.starts_at <= now() and (m.ends_at is null or m.ends_at > now())
       and public._rede_participa(p_uid, m.organizational_unit_id)
       and (m.role <> 'desbravador' or public._rede_leitor_do_clube(m.organizational_unit_id))) x
   order by x.preferido desc, x.starts_at limit 1;
$$;

create or replace function public._rede_pode_ver_foto_perfil(p_name text)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_club uuid := (public._rede_contexto() ->> 'unidade')::uuid; v_dono text; v_papel text;
begin
  if v_uid is null or v_club is null then return false; end if;
  v_dono := substring(coalesce(p_name, '') from '^perfis/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})-');
  if v_dono is null then return false; end if;
  if not public._rede_unidade_ligada(v_club) then return false; end if;
  v_papel := public._comunidade_papel(v_uid, v_club);
  if v_papel is null or (v_papel = 'desbravador' and not public._comunidade_autorizado(v_uid, v_club)) then return false; end if;
  -- 515: rosto de menor só para quem é do clube dele
  if v_dono::uuid <> v_uid
     and exists (select 1 from public.organization_memberships om
                  where om.user_id = v_dono::uuid and om.role = 'desbravador' and om.status = 'ativo'
                    and om.starts_at <= now() and (om.ends_at is null or om.ends_at > now()))
     and not exists (select 1 from public.organization_memberships om
                      where om.user_id = v_dono::uuid and om.role = 'desbravador' and om.status = 'ativo'
                        and om.starts_at <= now() and (om.ends_at is null or om.ends_at > now())
                        and public._rede_leitor_do_clube(om.organizational_unit_id)) then
    return false;
  end if;
  return exists (select 1 from public.profiles pr
                  where pr.id::text = v_dono and pr.foto is not null and right(pr.foto, length(p_name) + 1) = '/' || p_name
                    and pr.avatar_tipo is distinct from 'personagem'
                    and public._rede_imagem_autorizada(pr.id));
end;
$$;

create or replace function public.rede_buscar(p_termo text default null, p_clube uuid default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare c jsonb := public._exigir_comunidade(false); v_t text := public._rede_busca_norm(p_termo);
begin
  if p_clube is null and length(v_t) < 2 then
    return jsonb_build_object('pessoas', '[]'::jsonb, 'clubes', '[]'::jsonb);
  end if;
  if p_clube is not null and not public._rede_unidade_ligada(p_clube) then
    raise exception 'Este clube não participa da Rede DBV.';
  end if;
  return jsonb_build_object(
    'pessoas', (select coalesce(jsonb_agg(y.j order by y.nome), '[]'::jsonb) from (select x.* from (
                  select distinct on (m.user_id) m.user_id,
                         public._comunidade_nome_publico(pr.nome) as nome,
                         public._comunidade_autor_json(m.user_id, m.organizational_unit_id) as j
                    from public.organization_memberships m
                    join public.profiles pr on pr.id = m.user_id
                    join public.organizational_units u on u.id = m.organizational_unit_id
                   where m.status = 'ativo' and m.role <> 'pais'
                     and m.starts_at <= now() and (m.ends_at is null or m.ends_at > now())
                     and (p_clube is null or m.organizational_unit_id = p_clube)
                     -- 515 (G7): menor nunca aparece na busca de quem é de outro clube
                     and (m.role <> 'desbravador' or public._rede_leitor_do_clube(m.organizational_unit_id))
                     and (v_t = '' or public._rede_busca_norm(public._comunidade_nome_publico(pr.nome)) like '%' || v_t || '%'
                          or (p_clube is null and public._rede_busca_norm(u.nome) like '%' || v_t || '%'))
                     and public._rede_participa(m.user_id, m.organizational_unit_id)
                   order by m.user_id, m.starts_at) x
                 order by x.nome limit 20) y),
    'clubes', case when p_clube is not null then '[]'::jsonb else
               (select coalesce(jsonb_agg(jsonb_build_object('id', u.id, 'nome', u.nome,
                          'membros', (select count(distinct m.user_id) from public.organization_memberships m
                                       where m.organizational_unit_id = u.id and m.status = 'ativo' and m.role <> 'pais'
                                         and public._rede_participa(m.user_id, u.id))) order by u.nome), '[]'::jsonb)
                  from (select u2.* from public.organizational_units u2
                         where u2.type = 'clube' and public._rede_busca_norm(u2.nome) like '%' || v_t || '%'
                           and public._rede_unidade_ligada(u2.id)
                         order by u2.nome limit 10) u) end);
end;
$$;

create or replace function public.rede_perfil(p_usuario uuid default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare c jsonb := public._exigir_comunidade(false); v_uid uuid := auth.uid(); v_alvo uuid := coalesce(p_usuario, auth.uid());
        v_club uuid; v_papel text; v_desde timestamptz; pr public.profiles; v_eu boolean; v_personagem boolean; v_autor jsonb;
        v_ctx uuid := (c ->> 'club')::uuid; v_modo text := c ->> 'modo';
begin
  v_eu := v_alvo = v_uid;
  v_club := case when v_eu then (c ->> 'club')::uuid else public._rede_clube_do_perfil(v_alvo, (c ->> 'club')::uuid) end;
  if v_club is null then raise exception 'Este perfil não está disponível.'; end if;
  select * into pr from public.profiles where id = v_alvo;
  v_papel := public._comunidade_papel(v_alvo, v_club);
  v_personagem := coalesce(pr.avatar_tipo, 'foto') = 'personagem';
  v_autor := public._comunidade_autor_json(v_alvo, v_club);
  select min(m.starts_at) into v_desde from public.organization_memberships m
   where m.user_id = v_alvo and m.organizational_unit_id = v_club;
  return jsonb_build_object(
    'id', v_alvo,
    'eu', v_eu,
    'nome', v_autor ->> 'nome',
    'clube', v_autor ->> 'clube',
    'unidade', v_autor ->> 'unidade',
    'coordenacao', exists (select 1 from public.organizational_units u where u.id = v_club and u.type <> 'clube'),
    'papel', v_papel,
    'desde', extract(year from v_desde)::int,
    'avatar_tipo', case when v_personagem then 'personagem' end,
    'avatar', case when v_personagem then pr.avatar end,
    'foto', v_autor ->> 'foto',
    'imagem_autorizada', case when v_eu then public._rede_imagem_autorizada(v_alvo) end,
    -- 515: só conta o que este leitor pode ver (alcance)
    'publicacoes', (select count(*) from public.comunidade_posts p where p.autor_id = v_alvo and p.status = 'publicado'
                      and public._rede_item_visivel(v_uid, v_ctx, v_modo, p.club_id, p.alcance, p.autor_id, p.status)),
    'conquistas', (select count(*) from public.comunidade_posts p where p.autor_id = v_alvo and p.status = 'publicado'
                     and p.tipo = 'conquista'
                     and public._rede_item_visivel(v_uid, v_ctx, v_modo, p.club_id, p.alcance, p.autor_id, p.status)),
    'pontos', public._rede_pontos(v_alvo));
end;
$$;

-- ---------------------------------------------------------------------------
--  4. Post JSON, feed, perfil-posts
-- ---------------------------------------------------------------------------
create or replace function public._comunidade_post_json(p_post uuid, p_uid uuid, p_nivel integer default 0)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare p public.comunidade_posts; v_repost jsonb;
begin
  select * into p from public.comunidade_posts where id = p_post;
  if not found then return null; end if;
  if p.repost_de is not null and p_nivel = 0 then
    v_repost := case when public._rede_pode_ver_item(p.repost_de, p_uid)
                     then public._comunidade_post_json(p.repost_de, p_uid, 1)
                     else jsonb_build_object('indisponivel', true) end;
  end if;
  return jsonb_build_object(
    'id', p.id,
    'tipo', p.tipo,
    'alcance', p.alcance,
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

-- p_filtro: 'meu_clube' (o que é do meu clube/área), 'comunidade' (só o publicado na Comunidade);
-- 'todos' (app antigo) = 'comunidade'.
create or replace function public.rede_feed(p_filtro text default 'todos', p_antes timestamptz default null,
                                            p_antes_id uuid default null, p_limite integer default 10)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare c jsonb := public._exigir_comunidade(false); v_uid uuid := auth.uid(); v_club uuid := (c ->> 'club')::uuid;
        v_modo text := c ->> 'modo'; v_f text := coalesce(p_filtro, 'todos');
        v_lim int := least(greatest(coalesce(p_limite, 10), 1), 20); v_itens jsonb; v_n int; v_antes timestamptz; v_antes_id uuid;
begin
  if v_f not in ('todos', 'comunidade', 'meu_clube') then raise exception 'Filtro inválido.'; end if;
  if v_f = 'todos' then v_f := 'comunidade'; end if;
  with pagina as (
    select p.id, p.created_at from public.comunidade_posts p
     where public._rede_item_visivel(v_uid, v_club, v_modo, p.club_id, p.alcance, p.autor_id, p.status)
       and (case when v_f = 'comunidade' then p.alcance = 'comunidade'
                 else (p.club_id in (select a.id from public._rede_unidades_da_area(v_club) a)
                       or p.club_id in (select b.id from public._rede_unidades_acima(v_club) b)) end)
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

-- feed legado da fase 1: agora também só a Comunidade (alcance) e sob a função central
create or replace function public.comunidade_feed(p_antes timestamptz default null, p_antes_id uuid default null,
                                                  p_limite integer default 10)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare c jsonb := public._exigir_comunidade(false); v_uid uuid := auth.uid(); v_club uuid := (c ->> 'club')::uuid;
        v_modo text := c ->> 'modo';
        v_lim int := least(greatest(coalesce(p_limite, 10), 1), 20); v_itens jsonb; v_n int; v_antes timestamptz; v_antes_id uuid;
begin
  with pagina as (
    select p.id, p.created_at from public.comunidade_posts p
     where public._rede_item_visivel(v_uid, v_club, v_modo, p.club_id, p.alcance, p.autor_id, p.status)
       and p.alcance = 'comunidade'
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

create or replace function public.comunidade_post(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare c jsonb := public._exigir_comunidade(false); v_uid uuid := auth.uid();
begin
  if not public._rede_pode_ver_item(p_id, v_uid) then
    raise exception 'Esta publicação não está disponível.';
  end if;
  return public._comunidade_post_json(p_id, v_uid, 0);
end;
$$;

create or replace function public.rede_perfil_posts(p_usuario uuid default null, p_aba text default 'publicacoes',
                                                    p_antes timestamptz default null, p_antes_id uuid default null,
                                                    p_limite integer default 12)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare c jsonb := public._exigir_comunidade(false); v_uid uuid := auth.uid(); v_alvo uuid := coalesce(p_usuario, auth.uid());
        v_ctx uuid := (c ->> 'club')::uuid; v_modo text := c ->> 'modo';
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
     where public._rede_item_visivel(v_uid, v_ctx, v_modo, p.club_id, p.alcance, p.autor_id, p.status)
       and (p.status = 'publicado' or (p_aba <> 'salvos' and v_alvo = v_uid and p.autor_id = v_uid and p.status = 'em_analise'))
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

-- ---------------------------------------------------------------------------
--  5. Curtir, salvar, comentar
-- ---------------------------------------------------------------------------
create or replace function public.comunidade_curtir(p_post uuid, p_curtir boolean default true)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare c jsonb := public._exigir_comunidade(false); v_uid uuid := auth.uid();
begin
  if not public._rede_pode_ver_item(p_post, v_uid)
     or not exists (select 1 from public.comunidade_posts p where p.id = p_post and p.status = 'publicado') then
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

create or replace function public.rede_salvar(p_post uuid, p_salvar boolean default true)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare c jsonb := public._exigir_comunidade(false); v_uid uuid := auth.uid();
begin
  if coalesce(p_salvar, true) then
    if not public._rede_pode_ver_item(p_post, v_uid)
       or not exists (select 1 from public.comunidade_posts p where p.id = p_post and p.status = 'publicado') then
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

-- G10: desempate por id. p_antes_id é opcional (app antigo segue enviando só p_antes).
drop function if exists public.comunidade_comentarios(uuid, timestamptz, integer);
create or replace function public.comunidade_comentarios(p_post uuid, p_antes timestamptz default null,
                                                         p_limite integer default 20, p_antes_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare c jsonb := public._exigir_comunidade(false); v_uid uuid := auth.uid();
        v_lim int := least(greatest(coalesce(p_limite, 20), 1), 50); v_itens jsonb; v_n int; v_ult jsonb;
begin
  if not public._rede_pode_ver_item(p_post, v_uid)
     or not exists (select 1 from public.comunidade_posts p where p.id = p_post and p.status = 'publicado') then
    raise exception 'Esta publicação não está disponível.';
  end if;
  with pagina as (
    select k.* from public.comunidade_comentarios k
     where k.post_id = p_post and k.status = 'publicado'
       and (p_antes is null
            or case when p_antes_id is null then k.created_at < p_antes else (k.created_at, k.id) < (p_antes, p_antes_id) end)
     order by k.created_at desc, k.id desc limit v_lim)
  select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'texto', x.texto, 'autor', public._comunidade_autor_json(x.autor_id, x.club_id),
                                               'meu', x.autor_id = v_uid, 'criado_em', x.created_at)
                            order by x.created_at desc, x.id desc), '[]'::jsonb), count(*)
    into v_itens, v_n from pagina x;
  if v_n = v_lim then
    select e into v_ult from jsonb_array_elements(v_itens) with ordinality as a(e, i) order by i desc limit 1;
  end if;
  return jsonb_build_object('itens', v_itens,
    'proximo', case when v_n = v_lim then (v_ult ->> 'criado_em')::timestamptz end,
    'proximo_id', case when v_n = v_lim then (v_ult ->> 'id')::uuid end);
end;
$$;
revoke all on function public.comunidade_comentarios(uuid, timestamptz, integer, uuid) from public, anon;
grant execute on function public.comunidade_comentarios(uuid, timestamptz, integer, uuid) to authenticated;

-- ---------------------------------------------------------------------------
--  6. Stories (só 'clube') sob a função central
-- ---------------------------------------------------------------------------
create or replace function public._rede_story_visivel(p_story uuid, p_uid uuid)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare x jsonb := public._rede_contexto(); s record;
begin
  select club_id, autor_id, status, expira_em into s from public.rede_stories where id = p_story;
  if not found then return false; end if;
  return public._rede_item_visivel(p_uid, (x ->> 'unidade')::uuid, x ->> 'modo', s.club_id, 'clube', s.autor_id, s.status)
     and ((s.status = 'publicado' and s.expira_em > now())
          or (s.autor_id = p_uid and s.status in ('publicado', 'em_analise') and coalesce(s.expira_em, 'infinity') > now()));
end;
$$;

create or replace function public.rede_stories()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare c jsonb := public._exigir_comunidade(false); v_uid uuid := auth.uid();
        v_ctx uuid := (c ->> 'club')::uuid; v_modo text := c ->> 'modo';
begin
  return (
    with vis as (
      select s.*, coalesce(s.publicado_em, s.created_at) as quando,
             exists (select 1 from public.rede_stories_vistos v where v.story_id = s.id and v.usuario_id = v_uid) as visto
        from public.rede_stories s
       where public._rede_item_visivel(v_uid, v_ctx, v_modo, s.club_id, 'clube', s.autor_id, s.status)
         and ((s.status = 'publicado' and s.expira_em > now())
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

-- ---------------------------------------------------------------------------
--  7. Foto (Storage): alcance + admin da plataforma auditado
-- ---------------------------------------------------------------------------
create or replace function public._comunidade_pode_ver_foto(p_name text)
returns boolean language plpgsql volatile security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); x jsonb := public._rede_contexto(); v_club uuid := (x ->> 'unidade')::uuid;
        v_modo text := x ->> 'modo'; p record; s record; v_papel text;
begin
  if v_uid is null then return false; end if;
  select * into p from public.comunidade_posts where foto_path = p_name;
  if found then
    if p.autor_id = v_uid then return true; end if;
    -- 515 (D4): o admin da plataforma só abre foto de item 'comunidade' denunciado/em análise, e fica registrado
    if public.eh_admin_plataforma(v_uid) and public._plataforma_pode_item('post', p.id) then
      return public._plataforma_acesso_registrar('foto', 'post', p.id, p.club_id);
    end if;
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
    if public.eh_admin_plataforma(v_uid) and public._plataforma_pode_item('story', s.id) then
      return public._plataforma_acesso_registrar('foto', 'story', s.id, s.club_id);
    end if;
    if s.foto_apagada_em is not null or s.expira_em is not null and s.expira_em <= now() then return false; end if;
    if v_club is null then return false; end if;
    if s.club_id = v_club and public.pode_administrar_clube(v_club) then return true; end if;
    if s.expira_em is null or not public._rede_unidade_ligada(v_club)
       or not public._rede_item_visivel(v_uid, v_club, v_modo, s.club_id, 'clube', s.autor_id, s.status) then
      return false;
    end if;
  end if;
  v_papel := public._comunidade_papel(v_uid, v_club);
  return v_papel is not null and (v_papel <> 'desbravador' or public._comunidade_autorizado(v_uid, v_club));
end;
$$;

-- ---------------------------------------------------------------------------
--  8. Publicar (alcance, quem pode, tipos, foto) e conquista segura
-- ---------------------------------------------------------------------------
-- corpo único da publicação de post (antes em comunidade_publicar). Interno: só as RPCs abaixo chamam.
create or replace function public._comunidade_publicar_interno(p_legenda text, p_foto_path text, p_repost_de uuid, p_alcance text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare c jsonb := public._exigir_comunidade(true); v_uid uuid := auth.uid(); v_club uuid; v_papel text;
        v_leg text := public._comunidade_limpar(p_legenda); v_tri jsonb; v_lim text; v_orig record;
        v_repost uuid := p_repost_de; v_status text; v_id uuid; v_alc text := coalesce(p_alcance, 'clube'); v_tam bigint; v_mime text;
begin
  v_club := (c ->> 'club')::uuid; v_papel := c ->> 'papel';
  if v_alc not in ('clube', 'comunidade') then raise exception 'Alcance inválido.'; end if;
  -- repost nunca cria conteúdo na Comunidade
  if v_repost is not null and v_alc = 'comunidade' then raise exception 'Compartilhar só vale dentro do seu clube.'; end if;
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
    if not found or not exists (select 1 from public.comunidade_posts p where p.id = v_repost and p.status = 'publicado')
       or not public._rede_pode_ver_item(v_repost, v_uid) then
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
    -- 515 (D5): servidor confere tamanho e tipo (o bucket já limita; aqui a regra fica explícita e testável)
    v_tam := public._rede_tamanho_objeto('comunidade', p_foto_path);
    if v_tam is not null and v_tam > 307200 then raise exception 'A foto é grande demais (máximo 300 KB).'; end if;
    select o.metadata ->> 'mimetype' into v_mime from storage.objects o where o.bucket_id = 'comunidade' and o.name = p_foto_path;
    if v_mime is not null and v_mime not in ('image/jpeg', 'image/webp') then raise exception 'A foto precisa ser JPEG ou WebP.'; end if;
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

  v_status := case when p_foto_path is not null and (v_alc = 'comunidade' or public.rede_foto_exige_aprovacao())
                   then 'em_analise' else 'publicado' end;
  insert into public.comunidade_posts (club_id, autor_id, autor_papel, legenda, foto_path, repost_de, status, publicado_em, alcance)
  values (v_club, v_uid, v_papel, v_leg, p_foto_path, v_repost, v_status, case when v_status = 'publicado' then now() end, v_alc)
  returning id into v_id;

  if v_status = 'em_analise' then
    perform public._comunidade_avisar_diretoria(v_club, '📷 Foto aguardando aprovação',
      case when v_alc = 'comunidade'
           then 'Uma publicação com foto para a Comunidade está esperando a sua aprovação.'
           else 'Uma foto de um membro do clube está esperando a sua aprovação para aparecer na Comunidade.' end);
  end if;
  return jsonb_build_object('ok', true, 'id', v_id, 'status', v_status,
    'mensagem', case when v_status = 'em_analise'
                     then 'Foto enviada! Ela aparece na Comunidade assim que a diretoria do seu clube aprovar 🙂'
                     when v_repost is not null then 'Compartilhado na Comunidade! 🔁'
                     else 'Publicado! 🎉' end,
    'post', public._comunidade_post_json(v_id, v_uid, 0));
end;
$$;
revoke all on function public._comunidade_publicar_interno(text, text, uuid, text) from public, anon, authenticated;

-- compartilhar (repost) sempre no alcance 'clube'
create or replace function public.comunidade_publicar(p_legenda text, p_foto_path text default null, p_repost_de uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform public._exigir_comunidade(true);   -- gate explícito (a checagem completa está em _comunidade_publicar_interno)
  return public._comunidade_publicar_interno(p_legenda, p_foto_path, p_repost_de, 'clube');
end;
$$;

-- a assinatura antiga (6 argumentos) sai: a nova tem p_alcance com DEFAULT e atende o app antigo
drop function if exists public.rede_publicar(text, text, text, text, uuid, text);
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

-- D6: a conquista é montada pelo servidor a partir do registro REAL (classe investida / especialidade
-- concluída) do PRÓPRIO clube, só por quem gere atividades. Nome reduzido; nunca relatório, evidência,
-- parecer, foto, documento ou PDF. Nada de texto livre do cliente.
create or replace function public.rede_publicar_conquista(p_origem_tipo text, p_origem_id uuid, p_alcance text default 'clube')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare c jsonb := public._exigir_comunidade(true); v_uid uuid := auth.uid(); v_club uuid := (c ->> 'club')::uuid;
        v_alc text := coalesce(nullif(btrim(p_alcance), ''), 'clube');
        v_membro uuid; v_titulo text; v_nome text; v_clube_nome text; v_leg text; v_lim text; v_id uuid; v_verbo text;
begin
  if v_alc not in ('clube', 'comunidade') then raise exception 'Alcance inválido.'; end if;
  if coalesce(p_origem_tipo, '') not in ('classe', 'especialidade') then raise exception 'Origem da conquista inválida.'; end if;
  if (c ->> 'modo') = 'coordenacao' or not public.pode_gerir_atividades(v_club) then
    raise exception 'Só a diretoria e os instrutores do clube publicam conquistas.';
  end if;

  if p_origem_tipo = 'classe' then
    select mc.usuario_id, cl.nome into v_membro, v_titulo
      from public.member_classes mc join public.classes cl on cl.id = mc.class_id
     where mc.id = p_origem_id and mc.club_id = v_club and mc.status = 'investida'
       and not exists (select 1 from public.curriculum_achievements a where a.member_class_id = mc.id and a.status = 'revogada');
    v_verbo := 'concluiu a classe ';
  else
    select ms.usuario_id, sp.nome into v_membro, v_titulo
      from public.member_specialties ms join public.specialties sp on sp.id = ms.specialty_id
     where ms.id = p_origem_id and ms.club_id = v_club and ms.status = 'concluida'
       and not exists (select 1 from public.curriculum_achievements a where a.member_specialty_id = ms.id and a.status = 'revogada');
    v_verbo := 'concluiu a especialidade ';
  end if;
  if v_membro is null then
    raise exception 'Não encontramos essa conquista concluída no seu clube.';
  end if;
  if not public._rede_participa(v_membro, v_club) or coalesce(public._comunidade_papel(v_membro, v_club), 'pais') = 'pais' then
    raise exception 'Este membro não participa da Rede neste clube.';
  end if;
  if exists (select 1 from public.comunidade_posts p
              where p.conquista_origem_tipo = p_origem_tipo and p.conquista_origem_id = p_origem_id and p.alcance = v_alc
                and p.status in ('publicado', 'em_analise', 'oculto_denuncia')) then
    raise exception 'Esta conquista já foi publicada.';
  end if;

  v_lim := public._comunidade_limite(v_uid, 'post');
  if v_lim is not null then
    return jsonb_build_object('ok', false, 'motivo', 'limite', 'mensagem', v_lim);
  end if;

  select public._rede_nome_reduzido(pr.nome) into v_nome from public.profiles pr where pr.id = v_membro;
  select u.nome into v_clube_nome from public.organizational_units u where u.id = v_club;
  v_leg := left(v_nome || ' ' || v_verbo || v_titulo || ' no clube ' || v_clube_nome || ' 🎉', 500);

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

-- status: o app mostra "Publicar na Comunidade" só a quem pode
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
    'pode_publicar', v_aut and v_papel <> 'pais' and v_ate is null,
    'pode_publicar_comunidade', v_aut and v_ate is null and v_modo <> 'coordenacao' and public.pode_gerir_atividades(v_club),
    'suspenso_ate', v_ate,
    'em_observacao', public._comunidade_em_observacao(v_uid),
    'limites', public.comunidade_limites());
end;
$$;

-- ---------------------------------------------------------------------------
--  9. Admin da plataforma: só Comunidade denunciada/em análise, tudo registrado
-- ---------------------------------------------------------------------------
create or replace function public._comunidade_fila(p_club uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'fotos', (select coalesce(jsonb_agg(public._comunidade_item_fila(x.tipo, x.id, p_club is null) order by x.created_at), '[]'::jsonb)
                from (select 'post'::text as tipo, p.id, p.created_at from public.comunidade_posts p
                       where p.status = 'em_analise' and (p_club is null or p.club_id = p_club)
                         and (p_club is not null or public._plataforma_pode_item('post', p.id))
                      union all
                      select 'story', s.id, s.created_at from public.rede_stories s
                       where s.status = 'em_analise' and (p_club is null or s.club_id = p_club)
                         and (p_club is not null or public._plataforma_pode_item('story', s.id))) x),
    'denuncias', (select coalesce(jsonb_agg(public._comunidade_item_fila(d.alvo_tipo, d.alvo_id, p_club is null)
                                            || jsonb_build_object('denuncias', d.n, 'motivos', d.motivos) order by d.primeira), '[]'::jsonb)
                    from (select alvo_tipo, alvo_id, count(*) as n, jsonb_agg(distinct motivo) as motivos, min(created_at) as primeira
                            from public.comunidade_denuncias
                           where resultado = 'pendente' and (p_club is null or club_id = p_club)
                             and (p_club is not null or public._plataforma_pode_item(alvo_tipo, alvo_id))
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

-- passa a ser VOLÁTIL (escreve no log de acesso)
create or replace function public.admin_comunidade_painel()
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
begin
  perform public._exigir_admin_plataforma();
  if not public._plataforma_acesso_registrar('painel_comunidade', 'painel', null, null) then
    raise exception 'Não foi possível registrar o acesso. Tente de novo.';
  end if;
  return jsonb_build_object(
    'clubes_com_recurso', (select count(*) from public.organizational_units u where u.type = 'clube'
                             and public.recurso_habilitado_no_clube(u.id, 'comunidade')),
    'posts', (select coalesce(jsonb_object_agg(status, n), '{}'::jsonb) from
               (select status, count(*) n from public.comunidade_posts group by status) s),
    'denuncias_pendentes', (select count(*) from public.comunidade_denuncias where resultado = 'pendente'),
    'bloqueios_7d', (select count(*) from public.comunidade_bloqueios where created_at > now() - interval '7 days'),
    'suspensos', (select count(*) from public.comunidade_suspensoes where encerrada_em is null and ate > now()),
    'bloqueios', (select coalesce(jsonb_agg(b.j order by b.created_at desc), '[]'::jsonb) from (
                    select x.created_at, jsonb_build_object('quando', x.created_at, 'clube', u.nome, 'alvo', x.alvo,
                             'motivo', x.motivo, 'regra', x.regra, 'trecho', x.trecho) j
                      from public.comunidade_bloqueios x join public.organizational_units u on u.id = x.club_id
                     order by x.created_at desc limit 50) b),
    'fila', public._comunidade_fila(null));
end;
$$;

create or replace function public.admin_comunidade_moderar(p_tipo text, p_id uuid, p_acao text, p_motivo text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v jsonb;
begin
  perform public._exigir_admin_plataforma();
  if not public._plataforma_pode_item(p_tipo, p_id) then
    raise exception 'Conteúdo não encontrado.';
  end if;
  if not public._plataforma_acesso_registrar('moderar_' || coalesce(p_acao, ''), p_tipo, p_id, null) then
    raise exception 'Não foi possível registrar o acesso. Tente de novo.';
  end if;
  v := public._comunidade_aplicar_moderacao(p_tipo, p_id, p_acao, p_motivo, 'plataforma', null);
  perform public._admin_auditar('comunidade_moderar', p_tipo, p_id, jsonb_build_object('acao', p_acao));
  return v;
end;
$$;

-- ---------------------------------------------------------------------------
--  10. Denunciar: só denuncia quem pode ver o conteúdo (sem oráculo de UUID entre clubes)
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
    if found and v_status = 'publicado' and not public._rede_story_visivel(p_id, v_uid) then v_status := null; end if;
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

-- a tabela nova também entra na guarda de manutenção (teste 100)
select public._manutencao_instalar_guarda();
