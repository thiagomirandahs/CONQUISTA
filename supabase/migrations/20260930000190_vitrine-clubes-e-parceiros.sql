-- =============================================================================
--  VITRINE DO SITE: "Clubes que estão com a gente" (cartão de visita digital) e "Nossos parceiros".
--
--  1) club_showcase: o cartão de visita PÚBLICO de um clube. É OPT-IN:
--       * sem linha = clube fora da vitrine. Esta migration NÃO cria linha para ninguém — o Tenant 001
--         ('filhos-da-conquista') e todos os outros clubes começam DESLIGADOS.
--       * só aparece com ativo = true E aceite_contato = true (a diretoria aceitou publicar o contato),
--         não ocultado pela moderação da plataforma e com o clube 'ativo'.
--       * cada campo de contato (nome do diretor, WhatsApp, e-mail) tem a sua chave publicar_*.
--       * NUNCA sai daqui dado de membro/criança, foto de membro, contagem de membros ou dado interno:
--         o cartão só carrega o que a diretoria digitou nele + a identidade PÚBLICA do clube (nome, sigla,
--         lema, cor e logo — o mesmo que entrada_abrir_publico já mostra a quem abre o link do clube).
--     Escrita: só a liderança do clube (pode_gerir_no_clube) ou o admin da plataforma. A moderação
--     (ocultar) é só do admin da plataforma e a diretoria não consegue desfazê-la.
--
--  2) site_partners: anunciantes/patrocinadores. Só o admin da plataforma cadastra; logo no bucket
--     PÚBLICO 'parceiros' (só imagem, 2 MB). Aparece só se ativo e dentro do período [inicio, fim).
--
--  3) Leitura anônima SÓ por RPC security definer que devolve os campos publicados (as tabelas não têm
--     grant para anon/authenticated), com rate limit leve por origem (hash do IP, como a 104).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1) tabelas
-- ---------------------------------------------------------------------------
create table if not exists public.club_showcase (
  club_id uuid primary key references public.organizational_units(id) on delete cascade,
  ativo boolean not null default false,
  aceite_contato boolean not null default false,
  aceite_em timestamptz,
  aceite_por uuid references auth.users(id) on delete set null,
  apresentacao text check (apresentacao is null or length(apresentacao) <= 600),
  cidade text check (cidade is null or length(cidade) <= 60),
  estado text check (estado is null or estado ~ '^[A-Z]{2}$'),
  reuniao_dia text check (reuniao_dia is null or length(reuniao_dia) <= 40),
  reuniao_horario text check (reuniao_horario is null or length(reuniao_horario) <= 40),
  reuniao_local text check (reuniao_local is null or length(reuniao_local) <= 120),
  diretor_nome text check (diretor_nome is null or length(diretor_nome) <= 80),
  diretor_whatsapp text check (diretor_whatsapp is null or diretor_whatsapp ~ '^[0-9]{12,13}$'),
  diretor_email text check (diretor_email is null or (length(diretor_email) <= 120 and diretor_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')),
  publicar_nome boolean not null default false,
  publicar_whatsapp boolean not null default false,
  publicar_email boolean not null default false,
  link_inscricao text check (link_inscricao is null or (length(link_inscricao) <= 300 and link_inscricao ~ '^https?://[^\s/?#]+\.[^\s]*$')),
  oculto_moderacao boolean not null default false,
  oculto_motivo text check (oculto_motivo is null or length(oculto_motivo) <= 300),
  oculto_em timestamptz,
  oculto_por uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  -- trava ESTRUTURAL do opt-in: não existe cartão ligado sem o aceite de publicar o contato
  constraint club_showcase_opt_in check (not ativo or aceite_contato)
);
alter table public.club_showcase enable row level security;
revoke all on public.club_showcase from public, anon, authenticated;

create table if not exists public.site_partners (
  id uuid primary key default gen_random_uuid(),
  nome text not null check (length(btrim(nome)) between 1 and 80),
  logo_url text check (logo_url is null or (length(logo_url) <= 500 and logo_url ~ '^https?://[^/]+/storage/v1/object/public/parceiros/[^/?#]+$')),
  descricao text check (descricao is null or length(descricao) <= 240),
  link text check (link is null or (length(link) <= 300 and link ~ '^https?://[^\s/?#]+\.[^\s]*$')),
  whatsapp text check (whatsapp is null or whatsapp ~ '^[0-9]{12,13}$'),
  categoria text check (categoria is null or length(categoria) <= 40),
  ordem int not null default 100 check (ordem between 0 and 9999),
  destaque boolean not null default false,
  inicio timestamptz,
  fim timestamptz,
  ativo boolean not null default true,
  criado_por uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (link is not null or whatsapp is not null),
  check (inicio is null or fim is null or fim > inicio)
);
create index if not exists idx_site_partners_vitrine on public.site_partners (destaque desc, ordem, nome) where ativo;
alter table public.site_partners enable row level security;
revoke all on public.site_partners from public, anon, authenticated;

-- acessos às RPCs públicas da vitrine (rate limit leve por origem; guarda só o hash do IP)
create table if not exists public.vitrine_acessos_publicos (
  id bigint generated always as identity primary key,
  origem_hash text not null,
  quando timestamptz not null default now()
);
create index if not exists idx_vitrine_acessos_origem on public.vitrine_acessos_publicos (origem_hash, quando desc);
create index if not exists idx_vitrine_acessos_quando on public.vitrine_acessos_publicos (quando);
alter table public.vitrine_acessos_publicos enable row level security;
revoke all on public.vitrine_acessos_publicos from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2) helpers (não expostos)
-- ---------------------------------------------------------------------------
-- 120 leituras por origem a cada 5 min (uma pessoa navegando não chega perto; um robô raspando, sim)
create or replace function public._vitrine_registrar_acesso() returns void
language plpgsql security definer set search_path = '' as $$
declare v_origem text := public._entrada_origem();
begin
  if (select count(*) from public.vitrine_acessos_publicos
       where origem_hash = v_origem and quando > now() - interval '5 minutes') >= 120 then
    raise exception 'Muitas consultas. Espere alguns minutos e tente de novo.';
  end if;
  insert into public.vitrine_acessos_publicos (origem_hash) values (v_origem);
  if random() < 0.02 then
    delete from public.vitrine_acessos_publicos where quando < now() - interval '1 hour';
  end if;
end $$;
revoke all on function public._vitrine_registrar_acesso() from public, anon, authenticated;

-- texto livre: tira controle, apara, vazio vira null e corta no limite
create or replace function public._vitrine_texto(p jsonb, p_chave text, p_max int) returns text
language sql immutable set search_path = '' as $$
  select nullif(left(btrim(regexp_replace(coalesce(p ->> p_chave, ''), '[[:cntrl:]]+', ' ', 'g')), p_max), '');
$$;
revoke all on function public._vitrine_texto(jsonb, text, int) from public, anon, authenticated;

-- WhatsApp: só dígitos; DDD+número (10/11) ganha o 55; aceita 12/13 dígitos com DDI. Inválido = erro.
create or replace function public._vitrine_whatsapp(p_valor text) returns text
language plpgsql immutable set search_path = '' as $$
declare v text := regexp_replace(coalesce(p_valor, ''), '[^0-9]', '', 'g');
begin
  if v = '' then return null; end if;
  if length(v) in (10, 11) then v := '55' || v; end if;
  if length(v) not in (12, 13) then raise exception 'WhatsApp inválido: use DDD + número (ex.: 81 99999-9999).'; end if;
  return v;
end $$;
revoke all on function public._vitrine_whatsapp(text) from public, anon, authenticated;

create or replace function public._vitrine_url(p_valor text, p_campo text) returns text
language plpgsql immutable set search_path = '' as $$
declare v text := nullif(btrim(coalesce(p_valor, '')), '');
begin
  if v is null then return null; end if;
  if length(v) > 300 or v !~* '^https?://[^\s/?#]+\.[^\s]*$' then
    raise exception '% inválido: use um endereço começando com https://', p_campo;
  end if;
  return v;
end $$;
revoke all on function public._vitrine_url(text, text) from public, anon, authenticated;

-- o cartão como o PÚBLICO vê: só campos publicados. Único lugar que decide o que sai.
create or replace function public._vitrine_cartao_publico(s public.club_showcase, o public.organizational_units, p_completo boolean)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'slug', o.slug,
    'nome', o.nome,
    'sigla', o.metadata -> 'marca' ->> 'sigla',
    'lema', o.metadata -> 'marca' ->> 'lema',
    'cor', o.metadata -> 'marca' ->> 'cor_primaria',
    'logo_url', o.metadata -> 'marca' ->> 'logo_url',
    'cidade', s.cidade,
    'estado', s.estado
  ) || case when p_completo then jsonb_strip_nulls(jsonb_build_object(
    'apresentacao', s.apresentacao,
    'reuniao_dia', s.reuniao_dia,
    'reuniao_horario', s.reuniao_horario,
    'reuniao_local', s.reuniao_local,
    'diretor_nome', case when s.publicar_nome then s.diretor_nome end,
    'whatsapp', case when s.publicar_whatsapp then s.diretor_whatsapp end,
    'email', case when s.publicar_email then s.diretor_email end,
    'link_inscricao', s.link_inscricao
  )) else '{}'::jsonb end);
$$;
revoke all on function public._vitrine_cartao_publico(public.club_showcase, public.organizational_units, boolean) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3) RPCs públicas (anon)
-- ---------------------------------------------------------------------------
create or replace function public.vitrine_clubes_publico()
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform public._vitrine_registrar_acesso();
  return coalesce((
    select jsonb_agg(public._vitrine_cartao_publico(s, o, false) order by o.nome)
      from public.club_showcase s
      join public.organizational_units o on o.id = s.club_id
     where s.ativo and s.aceite_contato and not s.oculto_moderacao
       and o.type = 'clube' and o.status = 'ativo' and o.slug is not null
  ), '[]'::jsonb);
end $$;
revoke all on function public.vitrine_clubes_publico() from public;
grant execute on function public.vitrine_clubes_publico() to anon, authenticated;

create or replace function public.vitrine_clube_publico(p_slug text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v jsonb;
begin
  perform public._vitrine_registrar_acesso();
  select public._vitrine_cartao_publico(s, o, true) into v
    from public.club_showcase s
    join public.organizational_units o on o.id = s.club_id
   where o.slug = lower(btrim(coalesce(p_slug, '')))
     and s.ativo and s.aceite_contato and not s.oculto_moderacao
     and o.type = 'clube' and o.status = 'ativo';
  -- clube inexistente, desligado ou ocultado: MESMA resposta (não confirma que o slug existe)
  return coalesce(v, jsonb_build_object('encontrado', false)) || case when v is null then '{}'::jsonb else '{"encontrado":true}'::jsonb end;
end $$;
revoke all on function public.vitrine_clube_publico(text) from public;
grant execute on function public.vitrine_clube_publico(text) to anon, authenticated;

create or replace function public.parceiros_publico()
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform public._vitrine_registrar_acesso();
  return coalesce((
    select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
             'id', p.id, 'nome', p.nome, 'logo_url', p.logo_url, 'descricao', p.descricao,
             'link', p.link, 'whatsapp', p.whatsapp, 'categoria', p.categoria, 'destaque', p.destaque))
           order by p.destaque desc, p.ordem, p.nome)
      from public.site_partners p
     where p.ativo and (p.inicio is null or p.inicio <= now()) and (p.fim is null or p.fim > now())
  ), '[]'::jsonb);
end $$;
revoke all on function public.parceiros_publico() from public;
grant execute on function public.parceiros_publico() to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4) diretoria do clube: ler e salvar o próprio cartão (Configurações do clube)
-- ---------------------------------------------------------------------------
create or replace function public.vitrine_clube_ler(p_club_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v jsonb;
begin
  if auth.uid() is null or not (public.pode_gerir_no_clube(p_club_id) or public.eh_admin_plataforma()) then
    raise exception 'Sem permissão: só a diretoria do clube edita o cartão da vitrine.';
  end if;
  select coalesce(to_jsonb(s) - 'aceite_por' - 'oculto_por' - 'updated_by', jsonb_build_object('ativo', false, 'aceite_contato', false))
         || jsonb_build_object('slug', o.slug)
    into v
    from public.organizational_units o
    left join public.club_showcase s on s.club_id = o.id
   where o.id = p_club_id and o.type = 'clube';
  if v is null then raise exception 'Clube não encontrado.'; end if;
  return v;
end $$;
revoke all on function public.vitrine_clube_ler(uuid) from public, anon;
grant execute on function public.vitrine_clube_ler(uuid) to authenticated;

create or replace function public.vitrine_clube_salvar(p_club_id uuid, p_dados jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  d jsonb := coalesce(p_dados, '{}'::jsonb);
  v_ativo boolean := coalesce((d ->> 'ativo')::boolean, false);
  v_aceite boolean := coalesce((d ->> 'aceite_contato')::boolean, false);
  v_estado text := upper(nullif(btrim(coalesce(d ->> 'estado', '')), ''));
  v_email text := lower(public._vitrine_texto(d, 'diretor_email', 120));
  v_zap text := public._vitrine_whatsapp(d ->> 'diretor_whatsapp');
  v_nome text := public._vitrine_texto(d, 'diretor_nome', 80);
  v_pub_nome boolean := coalesce((d ->> 'publicar_nome')::boolean, false);
  v_pub_zap boolean := coalesce((d ->> 'publicar_whatsapp')::boolean, false);
  v_pub_email boolean := coalesce((d ->> 'publicar_email')::boolean, false);
begin
  if v_uid is null or not exists (select 1 from public.organizational_units where id = p_club_id and type = 'clube') then
    raise exception 'Clube não encontrado.';
  end if;
  if not (public.pode_gerir_no_clube(p_club_id) or public.eh_admin_plataforma(v_uid)) then
    raise exception 'Sem permissão: só a diretoria do clube edita o cartão da vitrine.';
  end if;
  if v_estado is not null and v_estado not in ('AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR',
                                               'PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO') then
    raise exception 'Estado inválido: use a sigla (ex.: PE).';
  end if;
  if v_email is not null and v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'E-mail inválido.'; end if;
  -- publicar um campo exige o campo preenchido
  if v_pub_nome and v_nome is null then raise exception 'Preencha o nome do diretor para publicá-lo.'; end if;
  if v_pub_zap and v_zap is null then raise exception 'Preencha o WhatsApp para publicá-lo.'; end if;
  if v_pub_email and v_email is null then raise exception 'Preencha o e-mail para publicá-lo.'; end if;
  if v_ativo and not v_aceite then
    raise exception 'Para aparecer na vitrine, a diretoria precisa aceitar publicar o contato.';
  end if;
  if v_ativo and not (v_pub_zap or v_pub_email) then
    raise exception 'Para aparecer na vitrine, publique ao menos um contato (WhatsApp ou e-mail).';
  end if;

  insert into public.club_showcase as s (
    club_id, ativo, aceite_contato, aceite_em, aceite_por, apresentacao, cidade, estado,
    reuniao_dia, reuniao_horario, reuniao_local, diretor_nome, diretor_whatsapp, diretor_email,
    publicar_nome, publicar_whatsapp, publicar_email, link_inscricao, updated_at, updated_by)
  values (
    p_club_id, v_ativo, v_aceite, case when v_aceite then now() end, case when v_aceite then v_uid end,
    public._vitrine_texto(d, 'apresentacao', 600), public._vitrine_texto(d, 'cidade', 60), v_estado,
    public._vitrine_texto(d, 'reuniao_dia', 40), public._vitrine_texto(d, 'reuniao_horario', 40),
    public._vitrine_texto(d, 'reuniao_local', 120), v_nome, v_zap, v_email,
    v_pub_nome, v_pub_zap, v_pub_email, public._vitrine_url(d ->> 'link_inscricao', 'Link de inscrição'), now(), v_uid)
  on conflict (club_id) do update set
    ativo = excluded.ativo,
    aceite_contato = excluded.aceite_contato,
    aceite_em = case when excluded.aceite_contato then coalesce(case when s.aceite_contato then s.aceite_em end, now()) end,
    aceite_por = case when excluded.aceite_contato then coalesce(case when s.aceite_contato then s.aceite_por end, v_uid) end,
    apresentacao = excluded.apresentacao, cidade = excluded.cidade, estado = excluded.estado,
    reuniao_dia = excluded.reuniao_dia, reuniao_horario = excluded.reuniao_horario, reuniao_local = excluded.reuniao_local,
    diretor_nome = excluded.diretor_nome, diretor_whatsapp = excluded.diretor_whatsapp, diretor_email = excluded.diretor_email,
    publicar_nome = excluded.publicar_nome, publicar_whatsapp = excluded.publicar_whatsapp, publicar_email = excluded.publicar_email,
    link_inscricao = excluded.link_inscricao, updated_at = now(), updated_by = v_uid;
    -- oculto_moderacao NÃO muda aqui: a diretoria não desfaz a moderação da plataforma

  return public.vitrine_clube_ler(p_club_id);
end $$;
revoke all on function public.vitrine_clube_salvar(uuid, jsonb) from public, anon;
grant execute on function public.vitrine_clube_salvar(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 5) admin da plataforma: moderação dos cartões e cadastro de parceiros
-- ---------------------------------------------------------------------------
create or replace function public.admin_vitrine_clubes_listar()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform public._exigir_admin_plataforma();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'club_id', s.club_id, 'slug', o.slug, 'nome', o.nome, 'cidade', s.cidade, 'estado', s.estado,
             'ativo', s.ativo, 'aceite_contato', s.aceite_contato, 'oculto_moderacao', s.oculto_moderacao,
             'oculto_motivo', s.oculto_motivo, 'updated_at', s.updated_at,
             'visivel', s.ativo and s.aceite_contato and not s.oculto_moderacao and o.status = 'ativo')
           order by o.nome)
      from public.club_showcase s join public.organizational_units o on o.id = s.club_id
  ), '[]'::jsonb);
end $$;
revoke all on function public.admin_vitrine_clubes_listar() from public, anon;
grant execute on function public.admin_vitrine_clubes_listar() to authenticated;

create or replace function public.admin_vitrine_clube_moderar(p_club_id uuid, p_ocultar boolean, p_motivo text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public._exigir_admin_plataforma();
begin
  if p_ocultar and nullif(btrim(coalesce(p_motivo, '')), '') is null then
    raise exception 'Informe o motivo para ocultar o cartão.';
  end if;
  update public.club_showcase set
    oculto_moderacao = coalesce(p_ocultar, false),
    oculto_motivo = case when p_ocultar then left(btrim(p_motivo), 300) end,
    oculto_em = case when p_ocultar then now() end,
    oculto_por = case when p_ocultar then v_uid end
   where club_id = p_club_id;
  if not found then raise exception 'Cartão não encontrado.'; end if;
  perform public._admin_auditar(case when p_ocultar then 'vitrine_ocultar' else 'vitrine_reexibir' end, 'clube', p_club_id,
                                jsonb_build_object('motivo', p_motivo));
end $$;
revoke all on function public.admin_vitrine_clube_moderar(uuid, boolean, text) from public, anon;
grant execute on function public.admin_vitrine_clube_moderar(uuid, boolean, text) to authenticated;

create or replace function public.admin_parceiros_listar()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform public._exigir_admin_plataforma();
  return coalesce((
    select jsonb_agg(to_jsonb(p) - 'criado_por' || jsonb_build_object(
             'no_ar', p.ativo and (p.inicio is null or p.inicio <= now()) and (p.fim is null or p.fim > now()))
           order by p.destaque desc, p.ordem, p.nome)
      from public.site_partners p
  ), '[]'::jsonb);
end $$;
revoke all on function public.admin_parceiros_listar() from public, anon;
grant execute on function public.admin_parceiros_listar() to authenticated;

create or replace function public.admin_parceiro_salvar(p_id uuid, p_dados jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := public._exigir_admin_plataforma();
  d jsonb := coalesce(p_dados, '{}'::jsonb);
  v_id uuid;
  v_nome text := public._vitrine_texto(d, 'nome', 80);
  v_logo text := nullif(btrim(coalesce(d ->> 'logo_url', '')), '');
  v_link text := public._vitrine_url(d ->> 'link', 'Link');
  v_zap text := public._vitrine_whatsapp(d ->> 'whatsapp');
  v_inicio timestamptz := nullif(d ->> 'inicio', '')::timestamptz;
  v_fim timestamptz := nullif(d ->> 'fim', '')::timestamptz;
begin
  if v_nome is null then raise exception 'Informe o nome do parceiro.'; end if;
  if v_link is null and v_zap is null then raise exception 'Informe o link e/ou o WhatsApp do parceiro.'; end if;
  if v_logo is not null and (length(v_logo) > 500 or v_logo !~ '^https?://[^/]+/storage/v1/object/public/parceiros/[^/?#]+$') then
    raise exception 'A logo precisa ser um arquivo enviado ao bucket "parceiros".';
  end if;
  if v_inicio is not null and v_fim is not null and v_fim <= v_inicio then
    raise exception 'O fim da exibição precisa ser depois do início.';
  end if;

  if p_id is null then
    insert into public.site_partners (nome, logo_url, descricao, link, whatsapp, categoria, ordem, destaque, inicio, fim, ativo, criado_por)
    values (v_nome, v_logo, public._vitrine_texto(d, 'descricao', 240), v_link, v_zap, public._vitrine_texto(d, 'categoria', 40),
            coalesce(nullif(d ->> 'ordem', '')::int, 100), coalesce((d ->> 'destaque')::boolean, false), v_inicio, v_fim,
            coalesce((d ->> 'ativo')::boolean, true), v_uid)
    returning id into v_id;
  else
    update public.site_partners set
      nome = v_nome, logo_url = v_logo, descricao = public._vitrine_texto(d, 'descricao', 240), link = v_link, whatsapp = v_zap,
      categoria = public._vitrine_texto(d, 'categoria', 40), ordem = coalesce(nullif(d ->> 'ordem', '')::int, 100),
      destaque = coalesce((d ->> 'destaque')::boolean, false), inicio = v_inicio, fim = v_fim,
      ativo = coalesce((d ->> 'ativo')::boolean, true), updated_at = now()
     where id = p_id
    returning id into v_id;
    if v_id is null then raise exception 'Parceiro não encontrado.'; end if;
  end if;
  perform public._admin_auditar('parceiro_salvar', 'parceiro', v_id, jsonb_build_object('nome', v_nome));
  return v_id;
end $$;
revoke all on function public.admin_parceiro_salvar(uuid, jsonb) from public, anon;
grant execute on function public.admin_parceiro_salvar(uuid, jsonb) to authenticated;

create or replace function public.admin_parceiro_apagar(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_nome text;
begin
  perform public._exigir_admin_plataforma();
  delete from public.site_partners where id = p_id returning nome into v_nome;
  if v_nome is null then raise exception 'Parceiro não encontrado.'; end if;
  perform public._admin_auditar('parceiro_apagar', 'parceiro', p_id, jsonb_build_object('nome', v_nome));
end $$;
revoke all on function public.admin_parceiro_apagar(uuid) from public, anon;
grant execute on function public.admin_parceiro_apagar(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 6) bucket PÚBLICO 'parceiros': só imagem (sem SVG), 2 MB; só o admin da plataforma grava.
--    Leitura por URL não passa por policy (bucket público); ninguém além do admin lista.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('parceiros', 'parceiros', true, 2 * 1024 * 1024, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "parceiros admin lista" on storage.objects;
create policy "parceiros admin lista" on storage.objects for select to authenticated
  using (bucket_id = 'parceiros' and public.eh_admin_plataforma());
drop policy if exists "parceiros admin envia" on storage.objects;
create policy "parceiros admin envia" on storage.objects for insert to authenticated
  with check (bucket_id = 'parceiros' and public.eh_admin_plataforma() and name ~ '^[^/]+$');
drop policy if exists "parceiros admin atualiza" on storage.objects;
create policy "parceiros admin atualiza" on storage.objects for update to authenticated
  using (bucket_id = 'parceiros' and public.eh_admin_plataforma())
  with check (bucket_id = 'parceiros' and public.eh_admin_plataforma() and name ~ '^[^/]+$');
drop policy if exists "parceiros admin apaga" on storage.objects;
create policy "parceiros admin apaga" on storage.objects for delete to authenticated
  using (bucket_id = 'parceiros' and public.eh_admin_plataforma());
