-- Aplica 490 (Rede DBV para a COORDENAÇÃO) e 491 (autorização dos pais é a do PAPEL: criança entra
-- liberada; o responsável só desliga pelo app) em PRODUÇÃO. Pode rodar mais de uma vez.
-- Para sozinho se a produção não estiver entre a 481 e a 491.
do $g$ begin
  if (select max(version) from supabase_migrations.schema_migrations) not between '20260930000481' and '20260930000491' then
    raise exception 'ABORTADO: produção fora do esperado (está em %)', (select max(version) from supabase_migrations.schema_migrations);
  end if;
end $g$;

-- ======================= 20260930000490_rede-dbv-coordenacao =======================
-- =============================================================================
-- 490 — REDE DBV para a COORDENAÇÃO (distrito, região, campo, união, divisão)
-- =============================================================================
-- Pedido do dono (28/09/2026): "libere a rede social também pra coordenação".
-- Até a 481 só entrava quem tinha vínculo ATIVO num clube com o recurso 'comunidade' ligado. Quem
-- coordena (vínculo ativo numa unidade NÃO-clube, papéis coordenador_* / diretor_* da migration 130)
-- muitas vezes não tem clube e ficava de fora.
--
-- Como a rede decide o CONTEXTO (_rede_contexto):
--   * clube em uso (x-clube-atual) com o recurso ligado -> entra como MEMBRO do clube (como sempre);
--   * sem clube (ou clube sem o recurso), ou o app pediu 'x-rede-como: coordenacao' (entrou pelo portal
--     /institucional) e a pessoa TEM vínculo de coordenação -> entra como COORDENAÇÃO, na unidade do
--     escopo em uso (x-escopo-atual, validado por escopo_atual_id) ou, sem escopo pedido, no primeiro
--     vínculo de coordenação (o que tem a rede liberada primeiro).
--   O header é só uma PREFERÊNCIA: o servidor nunca cria acesso por ele (vínculo ativo é conferido).
--
-- Unidade de coordenação na rede = a própria unidade (club_id das tabelas da comunidade aponta para
-- organizational_units, então um distrito cabe ali sem coluna nova). Consequências:
--   * a rede abre para o coordenador só se PELO MENOS UM clube da área dele tem o recurso ligado
--     (_rede_unidade_ligada); senão "A Rede DBV ainda não está liberada na sua área";
--   * o post dele fica no ar enquanto a área tiver a rede (mesma regra "recurso desligado some");
--   * identidade: "Nome Sobrenome" + "Coordenação · <unidade>" + selo (autor.coordenacao = true);
--   * foto de rosto: coordenador é ADULTO — usa a foto do perfil sem a autorização de imagem (que é
--     regra de criança, 470);
--   * denúncia/remoção de conteúdo de coordenador: não existe diretoria de distrito — a fila é a do
--     ADMIN DA PLATAFORMA (admin_comunidade_painel já lista todas as denúncias; a fila da diretoria de
--     um clube filtra pelo club_id do conteúdo, então nunca mostra conteúdo de coordenação);
--   * adulto de outro clube não comenta em post de criança; o coordenador PODE, mas só se o clube da
--     criança está dentro da área dele (árvore parent_id); fora dela, não;
--   * "Meu clube" do feed vira "Minha área": posts de toda a subárvore da unidade (para um clube,
--     a subárvore é ele mesmo — o comportamento de clube não muda).
-- Tudo o resto continua: triagem, limites, três avisos/suspensão, publicação direta com confirmação,
-- sem mensagem privada. Pais continuam sem publicar; criança continua exigindo a autorização dos pais.
-- =============================================================================

-- -----------------------------------------------------------------------------
--  1. Helpers
-- -----------------------------------------------------------------------------
-- A rede está ligada nesta unidade? Clube: o recurso dele. Coordenação: algum clube da subárvore.
create or replace function public._rede_unidade_ligada(p_unit uuid)
returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((
    select case when u.type = 'clube' then public.recurso_habilitado_no_clube(u.id, 'comunidade')
                else exists (select 1 from public._clubes_descendentes(u.id) d
                              where public.recurso_habilitado_no_clube(d.club_id, 'comunidade')) end
      from public.organizational_units u where u.id = p_unit), false);
$$;
revoke all on function public._rede_unidade_ligada(uuid) from public, anon, authenticated;

-- A unidade e tudo abaixo dela (clube = só ele mesmo).
create or replace function public._rede_unidades_da_area(p_area uuid)
returns table (id uuid)
language sql stable security definer set search_path = '' as $$
  with recursive desce as (
    select u.id, 0 as n from public.organizational_units u where u.id = p_area
    union all
    select o.id, d.n + 1 from public.organizational_units o join desce d on o.parent_id = d.id where d.n < 12)
  select desce.id from desce;
$$;
revoke all on function public._rede_unidades_da_area(uuid) from public, anon, authenticated;

-- Vínculo ATIVO de coordenação (unidade não-clube) desta pessoa, com a rede ligada na área?
create or replace function public._rede_coordenacao_na_rede(p_uid uuid)
returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.organization_memberships m
      join public.organizational_units u on u.id = m.organizational_unit_id and u.type <> 'clube'
     where m.user_id = p_uid and m.status = 'ativo'
       and m.starts_at <= now() and (m.ends_at is null or m.ends_at > now())
       and public._rede_unidade_ligada(u.id));
$$;
revoke all on function public._rede_coordenacao_na_rede(uuid) from public, anon, authenticated;

-- Em qual unidade (e em qual MODO) a pessoa está na rede nesta requisição. Nunca levanta erro.
create or replace function public._rede_contexto()
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_club uuid; v_como text; v_esc uuid;
begin
  if v_uid is null then return jsonb_build_object('modo', null, 'unidade', null); end if;
  begin
    v_como := current_setting('request.headers', true)::jsonb ->> 'x-rede-como';
  exception when others then v_como := null;
  end;
  v_club := public.clube_atual_id();

  -- vínculo de coordenação: o escopo pedido (validado) ou, sem pedido, o primeiro (rede ligada primeiro)
  v_esc := public.escopo_atual_id();
  if v_esc is null then
    select m.organizational_unit_id into v_esc
      from public.organization_memberships m
      join public.organizational_units u on u.id = m.organizational_unit_id and u.type <> 'clube'
     where m.user_id = v_uid and m.status = 'ativo'
       and m.starts_at <= now() and (m.ends_at is null or m.ends_at > now())
     order by public._rede_unidade_ligada(u.id) desc, m.starts_at, m.created_at, m.id
     limit 1;
  end if;

  if v_club is not null and (v_esc is null
       or (coalesce(v_como, '') <> 'coordenacao' and public.recurso_habilitado_no_clube(v_club, 'comunidade'))) then
    return jsonb_build_object('modo', 'clube', 'unidade', v_club);
  end if;
  if v_esc is not null then
    return jsonb_build_object('modo', 'coordenacao', 'unidade', v_esc);
  end if;
  return jsonb_build_object('modo', null, 'unidade', null);
end;
$$;
revoke all on function public._rede_contexto() from public, anon, authenticated;

-- -----------------------------------------------------------------------------
--  2. O portão de todas as RPCs da rede (agora com o modo coordenação)
-- -----------------------------------------------------------------------------
create or replace function public._exigir_comunidade(p_para_publicar boolean default false)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); x jsonb := public._rede_contexto(); v_club uuid; v_modo text; v_papel text; v_ate timestamptz;
begin
  v_club := (x ->> 'unidade')::uuid; v_modo := x ->> 'modo';
  if v_uid is null or v_club is null then
    raise exception 'Entre num clube para usar a Comunidade.';
  end if;
  if v_modo = 'coordenacao' then
    if not public._rede_unidade_ligada(v_club) then
      raise exception 'A Rede DBV ainda não está liberada na sua área.';
    end if;
  elsif not public.recurso_habilitado_no_clube(v_club, 'comunidade') then
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
  return jsonb_build_object('uid', v_uid, 'club', v_club, 'papel', v_papel, 'modo', v_modo);
end;
$$;
revoke all on function public._exigir_comunidade(boolean) from public, anon, authenticated;

create or replace function public.comunidade_meu_status()
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
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
    'suspenso_ate', v_ate,
    'em_observacao', public._comunidade_em_observacao(v_uid),
    'limites', public.comunidade_limites());
end;
$$;
revoke all on function public.comunidade_meu_status() from public, anon;
grant execute on function public.comunidade_meu_status() to authenticated;

-- -----------------------------------------------------------------------------
--  3. Quem participa, identidade e foto
-- -----------------------------------------------------------------------------
create or replace function public._rede_participa(p_uid uuid, p_club uuid)
returns boolean
language sql stable security definer set search_path = '' as $$
  select public._rede_unidade_ligada(p_club)
     and coalesce(public._comunidade_papel(p_uid, p_club), '') <> ''
     and (public._comunidade_papel(p_uid, p_club) <> 'desbravador' or public._comunidade_autorizado(p_uid, p_club));
$$;
revoke all on function public._rede_participa(uuid, uuid) from public, anon, authenticated;

-- Foto de rosto: criança/membro de clube continua pela autorização de imagem (470). Coordenação é
-- adulto e aparece com a foto do perfil (a autorização de imagem é regra de criança).
create or replace function public._rede_imagem_autorizada(p_uid uuid)
returns boolean
language sql stable security definer set search_path = '' as $$
  select (exists (
            select 1 from public.rede_autorizacao_imagem a
             where a.usuario_id = p_uid and a.arquivada and not a.desligada_pelo_responsavel
               and public._comunidade_papel(p_uid, a.club_id) is not null)
          and not exists (select 1 from public.rede_autorizacao_imagem a
                           where a.usuario_id = p_uid and a.desligada_pelo_responsavel))
      or (public._rede_coordenacao_na_rede(p_uid)
          and not exists (select 1 from public.rede_autorizacao_imagem a
                           where a.usuario_id = p_uid and a.desligada_pelo_responsavel));
$$;
revoke all on function public._rede_imagem_autorizada(uuid) from public, anon, authenticated;

create or replace function public._comunidade_autor_json(p_autor uuid, p_club uuid)
returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', p_autor,
    'nome', public._comunidade_nome_publico(pr.nome),
    'clube', case when u.type is distinct from 'clube' and u.id is not null then 'Coordenação · ' || u.nome else u.nome end,
    'coordenacao', coalesce(u.type <> 'clube', false),
    'foto', case when public._rede_imagem_autorizada(p_autor) then pr.foto end)
    from public.profiles pr left join public.organizational_units u on u.id = p_club
   where pr.id = p_autor;
$$;
revoke all on function public._comunidade_autor_json(uuid, uuid) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
--  4. Storage (bucket 'comunidade' e foto de perfil): mesma regra, unidade do contexto da rede
-- -----------------------------------------------------------------------------
create or replace function public._comunidade_pode_enviar_foto(p_name text)
returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_club uuid := (public._rede_contexto() ->> 'unidade')::uuid; v_papel text;
begin
  if v_uid is null or v_club is null then return false; end if;
  if coalesce(p_name, '') !~ ('^' || v_club::text || '/' || v_uid::text || '/[0-9a-f-]{36}\.(jpg|webp)$') then return false; end if;
  if not public._rede_unidade_ligada(v_club) then return false; end if;
  v_papel := public._comunidade_papel(v_uid, v_club);
  if v_papel is null or v_papel = 'pais' then return false; end if;
  if v_papel = 'desbravador' and not public._comunidade_autorizado(v_uid, v_club) then return false; end if;
  return public._comunidade_suspenso_ate(v_uid) is null;
end;
$$;
revoke all on function public._comunidade_pode_enviar_foto(text) from public, anon, authenticated;
grant execute on function public._comunidade_pode_enviar_foto(text) to authenticated;   -- a policy do Storage roda como authenticated

create or replace function public._comunidade_pode_ver_foto(p_name text)
returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_club uuid := (public._rede_contexto() ->> 'unidade')::uuid; p record; s record; v_papel text;
begin
  if v_uid is null then return false; end if;
  select * into p from public.comunidade_posts where foto_path = p_name;
  if found then
    if p.autor_id = v_uid or public.eh_admin_plataforma(v_uid) then return true; end if;
    if p.foto_apagada_em is not null or p.foto_expira_em <= now() then return false; end if;
    if v_club is null then return false; end if;
    if p.club_id = v_club and public.pode_administrar_clube(v_club) then return true; end if;
    if p.status <> 'publicado' or not public._rede_unidade_ligada(p.club_id)
       or not public._rede_unidade_ligada(v_club) then
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
    if s.status <> 'publicado' or s.expira_em is null or not public._rede_unidade_ligada(s.club_id)
       or not public._rede_unidade_ligada(v_club) or not public._rede_participa(s.autor_id, s.club_id) then
      return false;
    end if;
  end if;
  v_papel := public._comunidade_papel(v_uid, v_club);
  return v_papel is not null and (v_papel <> 'desbravador' or public._comunidade_autorizado(v_uid, v_club));
end;
$$;
revoke all on function public._comunidade_pode_ver_foto(text) from public, anon, authenticated;
grant execute on function public._comunidade_pode_ver_foto(text) to authenticated;

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
                    and public._rede_imagem_autorizada(pr.id));
end;
$$;
revoke all on function public._rede_pode_ver_foto_perfil(text) from public, anon, authenticated;
grant execute on function public._rede_pode_ver_foto_perfil(text) to authenticated;

-- -----------------------------------------------------------------------------
--  5. RPCs da rede: "recurso ligado no clube" -> "rede ligada na unidade" (clube: idêntico)
--     (corpo = o da 431/471/480/481, só com as trocas marcadas)
-- -----------------------------------------------------------------------------
-- _comunidade_post_visivel
create or replace function public._comunidade_post_visivel(p_post uuid, p_uid uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (
    select 1 from public.comunidade_posts p
     where p.id = p_post
       and ((p.status = 'publicado' and public._rede_unidade_ligada(p.club_id))
            or (p.autor_id = p_uid and p.status = 'em_analise')));
$function$;

-- _rede_story_visivel
create or replace function public._rede_story_visivel(p_story uuid, p_uid uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (
    select 1 from public.rede_stories s
     where s.id = p_story
       and ((s.status = 'publicado' and s.expira_em > now()
             and public._rede_unidade_ligada(s.club_id)
             and public._rede_participa(s.autor_id, s.club_id))
            or (s.autor_id = p_uid and s.status in ('publicado', 'em_analise') and coalesce(s.expira_em, 'infinity') > now())));
$function$;

-- comunidade_comentarios
create or replace function public.comunidade_comentarios(p_post uuid, p_antes timestamp with time zone DEFAULT NULL::timestamp with time zone, p_limite integer DEFAULT 20)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare c jsonb := public._exigir_comunidade(false); v_uid uuid := auth.uid();
        v_lim int := least(greatest(coalesce(p_limite, 20), 1), 50); v_itens jsonb; v_n int;
begin
  if not exists (select 1 from public.comunidade_posts p where p.id = p_post and p.status = 'publicado'
                  and public._rede_unidade_ligada(p.club_id)) then
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
$function$;

-- comunidade_curtir
create or replace function public.comunidade_curtir(p_post uuid, p_curtir boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare c jsonb := public._exigir_comunidade(false); v_uid uuid := auth.uid();
begin
  if not exists (select 1 from public.comunidade_posts p where p.id = p_post and p.status = 'publicado'
                  and public._rede_unidade_ligada(p.club_id)) then
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
$function$;

-- comunidade_feed
create or replace function public.comunidade_feed(p_antes timestamp with time zone DEFAULT NULL::timestamp with time zone, p_antes_id uuid DEFAULT NULL::uuid, p_limite integer DEFAULT 10)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare c jsonb := public._exigir_comunidade(false); v_uid uuid := auth.uid();
        v_lim int := least(greatest(coalesce(p_limite, 10), 1), 20); v_itens jsonb; v_n int; v_antes timestamptz; v_antes_id uuid;
begin
  with pagina as (
    select p.id, p.created_at from public.comunidade_posts p
     where ((p.status = 'publicado' and public._rede_unidade_ligada(p.club_id))
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
$function$;

-- comunidade_publicar
create or replace function public.comunidade_publicar(p_legenda text, p_foto_path text DEFAULT NULL::text, p_repost_de uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
                                 and public._rede_unidade_ligada(p.club_id)) then
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
$function$;

-- comunidade_comentar
create or replace function public.comunidade_comentar(p_post uuid, p_texto text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare c jsonb := public._exigir_comunidade(true); v_uid uuid := auth.uid(); v_club uuid; v_papel text;
        v_txt text := public._comunidade_limpar(p_texto); v_post record; v_tri jsonb; v_lim text; v_id uuid;
begin
  v_club := (c ->> 'club')::uuid; v_papel := c ->> 'papel';
  if v_txt is null then raise exception 'Escreva o comentário.'; end if;
  if length(v_txt) > 300 then raise exception 'O comentário pode ter até 300 caracteres.'; end if;
  select * into v_post from public.comunidade_posts where id = p_post;
  if not found or v_post.status <> 'publicado' or not public._rede_unidade_ligada(v_post.club_id) then
    raise exception 'Esta publicação não está disponível.';
  end if;
  -- adulto de OUTRO clube não comenta em publicação de criança
  -- 490: a COORDENAÇÃO comenta em publicação de criança só se o clube dela está na sua área
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
$function$;

-- comunidade_denunciar
create or replace function public.comunidade_denunciar(p_tipo text, p_id uuid, p_motivo text DEFAULT 'outro'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
    -- 490: conteúdo de coordenação não tem diretoria de clube: vai para a fila do admin da plataforma
    'mensagem', case when exists (select 1 from public.organizational_units u where u.id = v_club and u.type <> 'clube')
                     then case when v_ocultar then 'Obrigado! O conteúdo foi escondido e a equipe da plataforma vai revisar.'
                               else 'Obrigado! A equipe da plataforma vai revisar.' end
                     when v_ocultar then 'Obrigado! O conteúdo foi escondido e a diretoria do clube vai revisar.'
                     else 'Obrigado! A diretoria do clube vai revisar.' end);
end;
$function$;

-- rede_feed
create or replace function public.rede_feed(p_filtro text DEFAULT 'todos'::text, p_antes timestamp with time zone DEFAULT NULL::timestamp with time zone, p_antes_id uuid DEFAULT NULL::uuid, p_limite integer DEFAULT 10)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare c jsonb := public._exigir_comunidade(false); v_uid uuid := auth.uid(); v_club uuid := (c ->> 'club')::uuid;
        v_lim int := least(greatest(coalesce(p_limite, 10), 1), 20); v_itens jsonb; v_n int; v_antes timestamptz; v_antes_id uuid;
begin
  if coalesce(p_filtro, 'todos') not in ('todos', 'meu_clube') then raise exception 'Filtro inválido.'; end if;
  with pagina as (
    select p.id, p.created_at from public.comunidade_posts p
     where ((p.status = 'publicado' and public._rede_unidade_ligada(p.club_id))
            or (p.autor_id = v_uid and p.status = 'em_analise'))
       -- 490: "Meu clube" / "Minha área" = a subárvore da unidade (para um clube, só ele mesmo)
       and (coalesce(p_filtro, 'todos') = 'todos' or p.club_id in (select a.id from public._rede_unidades_da_area(v_club) a))
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
$function$;

-- rede_perfil
create or replace function public.rede_perfil(p_usuario uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
    'clube', public._comunidade_autor_json(v_alvo, v_club) ->> 'clube',                  -- 490: "Coordenação · X"
    'coordenacao', exists (select 1 from public.organizational_units u where u.id = v_club and u.type <> 'clube'),
    'papel', v_papel,
    'desde', extract(year from v_desde)::int,
    'foto', case when public._rede_imagem_autorizada(v_alvo) then pr.foto end,
    'imagem_autorizada', public._rede_imagem_autorizada(v_alvo),
    'publicacoes', (select count(*) from public.comunidade_posts p where p.autor_id = v_alvo and p.status = 'publicado'
                      and public._rede_unidade_ligada(p.club_id)),
    'conquistas', (select count(*) from public.comunidade_posts p where p.autor_id = v_alvo and p.status = 'publicado'
                     and p.tipo = 'conquista' and public._rede_unidade_ligada(p.club_id)),
    'pontos', public._rede_pontos(v_alvo));
end;
$function$;

-- rede_perfil_posts
create or replace function public.rede_perfil_posts(p_usuario uuid DEFAULT NULL::uuid, p_aba text DEFAULT 'publicacoes'::text, p_antes timestamp with time zone DEFAULT NULL::timestamp with time zone, p_antes_id uuid DEFAULT NULL::uuid, p_limite integer DEFAULT 12)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
     where ((p.status = 'publicado' and public._rede_unidade_ligada(p.club_id))
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
$function$;

-- rede_salvar
create or replace function public.rede_salvar(p_post uuid, p_salvar boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare c jsonb := public._exigir_comunidade(false); v_uid uuid := auth.uid();
begin
  if coalesce(p_salvar, true) then
    if not exists (select 1 from public.comunidade_posts p where p.id = p_post and p.status = 'publicado'
                    and public._rede_unidade_ligada(p.club_id)) then
      raise exception 'Esta publicação não está disponível.';
    end if;
    insert into public.rede_salvos (usuario_id, post_id, club_id) values (v_uid, p_post, (c ->> 'club')::uuid)
    on conflict (usuario_id, post_id) do nothing;
  else
    delete from public.rede_salvos where usuario_id = v_uid and post_id = p_post;
  end if;
  return jsonb_build_object('ok', true, 'eu_salvei', coalesce(p_salvar, true));
end;
$function$;

-- rede_stories
create or replace function public.rede_stories()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare c jsonb := public._exigir_comunidade(false); v_uid uuid := auth.uid();
begin
  return (
    with vis as (
      select s.*, coalesce(s.publicado_em, s.created_at) as quando,
             exists (select 1 from public.rede_stories_vistos v where v.story_id = s.id and v.usuario_id = v_uid) as visto
        from public.rede_stories s
       where ((s.status = 'publicado' and s.expira_em > now()
               and public._rede_unidade_ligada(s.club_id)
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
$function$;

-- rede_buscar
create or replace function public.rede_buscar(p_termo text DEFAULT NULL::text, p_clube uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$;


;
insert into supabase_migrations.schema_migrations(version, name) values ('20260930000490', 'rede-dbv-coordenacao') on conflict do nothing;

-- ======================= 20260930000491_rede-dbv-autorizacao-dos-pais-no-papel =======================
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

;
insert into supabase_migrations.schema_migrations(version, name) values ('20260930000491', 'rede-dbv-autorizacao-dos-pais-no-papel') on conflict do nothing;

select 'OK' as resultado,
  (select max(version) from supabase_migrations.schema_migrations) as ledger,
  (select count(*) from public.organization_memberships m join public.organizational_units u on u.id = m.organizational_unit_id
    where u.slug = 'filhos-da-conquista' and m.status = 'ativo') as ativos_filhos_da_conquista;
