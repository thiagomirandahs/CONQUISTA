-- Aplica a REDE DBV em PRODUÇÃO: 470, 471, 472 (perfil, autorização de imagem, desafios, salvos, moderação,
-- vida útil das fotos) e 480, 481 (publicação direta com confirmação, stories de 24 h, busca).
-- Pode rodar mais de uma vez sem estragar nada. Para sozinho se a produção não estiver entre a 460 e a 481.
do $g$ begin
  if (select max(version) from supabase_migrations.schema_migrations) not between '20260930000460' and '20260930000481' then
    raise exception 'ABORTADO: produção fora do esperado (está em %)', (select max(version) from supabase_migrations.schema_migrations);
  end if;
end $g$;

-- ======================= 20260930000470_rede-dbv-perfil-e-autorizacao-de-imagem =======================
-- =============================================================================
-- 470 — REDE DBV (a Comunidade vira "outro mundo" dentro do app): perfil público e
--       AUTORIZAÇÃO DE USO DE IMAGEM
-- =============================================================================
-- Decisões do dono (28/09, frente "rede DBV"):
--   * Nome exibido = NOME + SOBRENOME (as duas primeiras palavras do nome; "de/da/do/dos/das/e"
--     são pulados, então "Maria de Souza Lima" vira "Maria Souza") + o NOME DO CLUBE embaixo.
--     MUDANÇA DE REGRA em relação à 431 (que mostrava só o primeiro nome).
--   * Perfil público (foto de rosto/avatar, "desde <ano do vínculo>", nº de publicações,
--     conquistas e pontos da rede) visível para TODOS os clubes da rede, MAS a FOTO DE ROSTO só
--     aparece com a AUTORIZAÇÃO DE USO DE IMAGEM. Sem ela: iniciais.
--   * A autorização é colhida em PAPEL na admissão; no app a DIRETORIA do clube marca
--     "autorização de imagem arquivada" por membro, e o RESPONSÁVEL vinculado pode DESLIGAR
--     (e religar o que ele mesmo desligou — nunca liga o que a diretoria não marcou).
--   * A autorização de USO da Comunidade dada pelos pais (430/432, comunidade_autorizacoes)
--     CONTINUA separada: uma diz "meu filho pode entrar na rede", a outra "a foto de rosto dele
--     pode aparecer". Unificar misturaria dois consentimentos diferentes (LGPD art. 14).
--   * Fotos PUBLICADAS continuam passando pela diretoria (sem IA de imagem ainda), com ou sem
--     a autorização de imagem.
-- Tudo security definer + search_path ''; tabela nova sem grant (só RPC).
-- =============================================================================

-- -----------------------------------------------------------------------------
--  1. Nome público: nome + sobrenome
-- -----------------------------------------------------------------------------
create or replace function public._comunidade_nome_publico(p_nome text)
returns text
language plpgsql immutable set search_path = '' as $$
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
  return initcap(v_primeiro) || coalesce(' ' || initcap(v_seg), '');
end;
$$;
revoke all on function public._comunidade_nome_publico(text) from public, anon, authenticated;


-- -----------------------------------------------------------------------------
--  2. Autorização de uso de imagem (por membro, por clube)
-- -----------------------------------------------------------------------------
create table if not exists public.rede_autorizacao_imagem (
  club_id uuid not null references public.organizational_units(id) on delete cascade,
  usuario_id uuid not null references public.profiles(id) on delete cascade,
  arquivada boolean not null default false,                  -- a diretoria confirmou o papel assinado
  marcada_por uuid references public.profiles(id) on delete set null,
  marcada_em timestamptz,
  desligada_pelo_responsavel boolean not null default false, -- o responsável vinculado desligou
  responsavel_id uuid references public.profiles(id) on delete set null,
  responsavel_em timestamptz,
  primary key (club_id, usuario_id)
);
create index if not exists rede_autorizacao_imagem_usuario_idx on public.rede_autorizacao_imagem (usuario_id);
alter table public.rede_autorizacao_imagem enable row level security;
revoke all on public.rede_autorizacao_imagem from public, anon, authenticated;
select public._manutencao_instalar_guarda();

-- Vale se ALGUM clube em que a pessoa está ativa arquivou o papel E nenhum responsável desligou
-- (o "não" do responsável vale em qualquer clube: é a família dizendo não).
create or replace function public._rede_imagem_autorizada(p_uid uuid)
returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
           select 1 from public.rede_autorizacao_imagem a
            where a.usuario_id = p_uid and a.arquivada and not a.desligada_pelo_responsavel
              and public._comunidade_papel(p_uid, a.club_id) is not null)
     and not exists (select 1 from public.rede_autorizacao_imagem a
                      where a.usuario_id = p_uid and a.desligada_pelo_responsavel);
$$;
revoke all on function public._rede_imagem_autorizada(uuid) from public, anon, authenticated;

-- A pessoa participa da rede pelo clube p_club? (vínculo ativo, recurso ligado, criança autorizada pelos pais)
create or replace function public._rede_participa(p_uid uuid, p_club uuid)
returns boolean
language sql stable security definer set search_path = '' as $$
  select public.recurso_habilitado_no_clube(p_club, 'comunidade')
     and coalesce(public._comunidade_papel(p_uid, p_club), '') <> ''
     and (public._comunidade_papel(p_uid, p_club) <> 'desbravador' or public._comunidade_autorizado(p_uid, p_club));
$$;
revoke all on function public._rede_participa(uuid, uuid) from public, anon, authenticated;


-- -----------------------------------------------------------------------------
--  3. Autor no feed: id (para abrir o perfil), nome + sobrenome, clube e foto SÓ com autorização
-- -----------------------------------------------------------------------------
create or replace function public._comunidade_autor_json(p_autor uuid, p_club uuid)
returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', p_autor,
    'nome', public._comunidade_nome_publico(pr.nome),
    'clube', (select u.nome from public.organizational_units u where u.id = p_club),
    'foto', case when public._rede_imagem_autorizada(p_autor) then pr.foto end)
    from public.profiles pr where pr.id = p_autor;
$$;
revoke all on function public._comunidade_autor_json(uuid, uuid) from public, anon, authenticated;


-- -----------------------------------------------------------------------------
--  4. Diretoria: lista de membros do clube com o interruptor "autorização de imagem arquivada"
-- -----------------------------------------------------------------------------
create or replace function public.rede_membros_autorizacao_imagem()
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_club uuid := public.clube_atual_id();
begin
  if auth.uid() is null or v_club is null or not public.pode_administrar_clube(v_club) then
    raise exception 'Sem permissão (apenas a diretoria do clube).';
  end if;
  if not public.recurso_habilitado_no_clube(v_club, 'comunidade') then
    raise exception 'A Comunidade não está liberada neste clube.';
  end if;
  return (select coalesce(jsonb_agg(jsonb_build_object(
            'usuario_id', m.user_id, 'nome', pr.nome, 'papel', m.role,
            'arquivada', coalesce(a.arquivada, false),
            'desligada_pelo_responsavel', coalesce(a.desligada_pelo_responsavel, false),
            'marcada_em', a.marcada_em) order by pr.nome), '[]'::jsonb)
            from (select distinct on (x.user_id) x.user_id, x.role from public.organization_memberships x
                   where x.organizational_unit_id = v_club and x.status = 'ativo' and x.role <> 'pais'
                     and x.starts_at <= now() and (x.ends_at is null or x.ends_at > now())
                   order by x.user_id, x.starts_at) m
            join public.profiles pr on pr.id = m.user_id
            left join public.rede_autorizacao_imagem a on a.club_id = v_club and a.usuario_id = m.user_id);
end;
$$;
revoke all on function public.rede_membros_autorizacao_imagem() from public, anon;
grant execute on function public.rede_membros_autorizacao_imagem() to authenticated;

create or replace function public.rede_marcar_autorizacao_imagem(p_usuario uuid, p_arquivada boolean)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_club uuid := public.clube_atual_id();
begin
  if auth.uid() is null or v_club is null or not public.pode_administrar_clube(v_club) then
    raise exception 'Sem permissão (apenas a diretoria do clube).';
  end if;
  if p_arquivada is null then raise exception 'Informe se a autorização está arquivada.'; end if;
  if p_arquivada and not public.recurso_habilitado_no_clube(v_club, 'comunidade') then
    raise exception 'A Comunidade não está liberada neste clube.';
  end if;
  if public._comunidade_papel(p_usuario, v_club) is null then
    raise exception 'Esta pessoa não é membro ativo do seu clube.';
  end if;
  insert into public.rede_autorizacao_imagem (club_id, usuario_id, arquivada, marcada_por, marcada_em)
  values (v_club, p_usuario, p_arquivada, auth.uid(), now())
  on conflict (club_id, usuario_id) do update
    set arquivada = excluded.arquivada, marcada_por = excluded.marcada_por, marcada_em = excluded.marcada_em;
  perform public._auditar('rede_autorizacao_imagem', v_club, p_usuario, jsonb_build_object('arquivada', p_arquivada));
  return jsonb_build_object('ok', true, 'arquivada', p_arquivada,
    'desligada_pelo_responsavel', (select a.desligada_pelo_responsavel from public.rede_autorizacao_imagem a
                                    where a.club_id = v_club and a.usuario_id = p_usuario));
end;
$$;
revoke all on function public.rede_marcar_autorizacao_imagem(uuid, boolean) from public, anon;
grant execute on function public.rede_marcar_autorizacao_imagem(uuid, boolean) to authenticated;


-- -----------------------------------------------------------------------------
--  5. Responsável: vê e DESLIGA (ou religa o que ele desligou). Desligar vale mesmo com o
--     recurso desligado (dizer "não" nunca fica bloqueado).
-- -----------------------------------------------------------------------------
create or replace function public.comunidade_autorizacoes_dos_filhos()
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_club uuid := public.clube_atual_id();
begin
  if v_uid is null or v_club is null then return jsonb_build_object('recurso_ligado', false, 'filhos', '[]'::jsonb); end if;
  return jsonb_build_object(
    'recurso_ligado', public.recurso_habilitado_no_clube(v_club, 'comunidade'),
    'filhos', (select coalesce(jsonb_agg(jsonb_build_object(
                  'desbravador_id', r.desbravador_id, 'nome', p.nome,
                  'autorizado', public._comunidade_autorizado(r.desbravador_id, v_club),
                  'atualizado_em', a.atualizado_em,
                  'imagem_arquivada', coalesce(i.arquivada, false),
                  'imagem_desligada', coalesce(i.desligada_pelo_responsavel, false),
                  'imagem_autorizada', public._rede_imagem_autorizada(r.desbravador_id)) order by p.nome), '[]'::jsonb)
                 from (select distinct desbravador_id from public.responsaveis
                        where responsavel_id = v_uid and club_id = v_club and status = 'aprovado') r
                 join public.profiles p on p.id = r.desbravador_id
                 left join public.comunidade_autorizacoes a on a.club_id = v_club and a.desbravador_id = r.desbravador_id
                 left join public.rede_autorizacao_imagem i on i.club_id = v_club and i.usuario_id = r.desbravador_id));
end;
$$;
revoke all on function public.comunidade_autorizacoes_dos_filhos() from public, anon;
grant execute on function public.comunidade_autorizacoes_dos_filhos() to authenticated;

create or replace function public.rede_responsavel_imagem(p_desbravador uuid, p_desligar boolean)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_club uuid := public.clube_atual_id();
begin
  if v_uid is null or v_club is null then raise exception 'Entre no clube para mudar a autorização.'; end if;
  if p_desligar is null then raise exception 'Informe se desliga ou não.'; end if;
  if not exists (select 1 from public.responsaveis r where r.responsavel_id = v_uid and r.desbravador_id = p_desbravador
                  and r.club_id = v_club and r.status = 'aprovado') then
    raise exception 'Só o responsável vinculado (aprovado pela diretoria) pode mudar a autorização de imagem.';
  end if;
  insert into public.rede_autorizacao_imagem (club_id, usuario_id, desligada_pelo_responsavel, responsavel_id, responsavel_em)
  values (v_club, p_desbravador, p_desligar, v_uid, now())
  on conflict (club_id, usuario_id) do update
    set desligada_pelo_responsavel = excluded.desligada_pelo_responsavel,
        responsavel_id = excluded.responsavel_id, responsavel_em = excluded.responsavel_em;
  perform public._auditar('rede_imagem_responsavel', v_club, p_desbravador, jsonb_build_object('desligada', p_desligar));
  return jsonb_build_object('ok', true, 'desligada', p_desligar, 'imagem_autorizada', public._rede_imagem_autorizada(p_desbravador));
end;
$$;
revoke all on function public.rede_responsavel_imagem(uuid, boolean) from public, anon;
grant execute on function public.rede_responsavel_imagem(uuid, boolean) to authenticated;


-- -----------------------------------------------------------------------------
--  6. Storage: a FOTO DE PERFIL (bucket privado 'imagens', perfis/<uid>-...) abre para quem está na
--     rede SÓ se a pessoa tiver a autorização de imagem. Policy ADICIONAL (as do clube continuam).
-- -----------------------------------------------------------------------------
create or replace function public._rede_pode_ver_foto_perfil(p_name text)
returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_club uuid := public.clube_atual_id(); v_dono text; v_papel text;
begin
  if v_uid is null or v_club is null then return false; end if;
  v_dono := substring(coalesce(p_name, '') from '^perfis/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})-');
  if v_dono is null then return false; end if;
  if not public.recurso_habilitado_no_clube(v_club, 'comunidade') then return false; end if;
  v_papel := public._comunidade_papel(v_uid, v_club);
  if v_papel is null or (v_papel = 'desbravador' and not public._comunidade_autorizado(v_uid, v_club)) then return false; end if;
  return exists (select 1 from public.profiles pr
                  where pr.id::text = v_dono and pr.foto is not null and right(pr.foto, length(p_name) + 1) = '/' || p_name
                    and public._rede_imagem_autorizada(pr.id));
end;
$$;
revoke all on function public._rede_pode_ver_foto_perfil(text) from public, anon;
grant execute on function public._rede_pode_ver_foto_perfil(text) to authenticated;

drop policy if exists "rede: foto de perfil autorizada" on storage.objects;
create policy "rede: foto de perfil autorizada" on storage.objects for select to authenticated
  using (bucket_id = 'imagens' and public._rede_pode_ver_foto_perfil(name));

;
insert into supabase_migrations.schema_migrations(version, name) values ('20260930000470', 'rede-dbv-perfil-e-autorizacao-de-imagem') on conflict do nothing;

-- ======================= 20260930000471_rede-dbv-desafios-publicacoes-e-salvos =======================
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

;
insert into supabase_migrations.schema_migrations(version, name) values ('20260930000471', 'rede-dbv-desafios-publicacoes-e-salvos') on conflict do nothing;

-- ======================= 20260930000472_rede-dbv-moderacao-e-vida-util-das-fotos =======================
-- =============================================================================
-- 472 — REDE DBV: moderação no visual novo ("Ocultar") e VIDA ÚTIL / armazenamento mínimo das fotos
-- =============================================================================
-- 1. Moderação: os cards da rede têm Manter · Ocultar · Remover. Manter = 'restaurar', Remover =
--    'remover' (as de sempre). 'ocultar' é NOVA e só serve para conteúdo que ainda está no ar com
--    denúncia pendente (denunciante sem poder de esconder na hora): a diretoria esconde enquanto
--    pensa. Não gera aviso (strike) ao autor; no histórico entra como 'ocultado_por_denuncia'
--    com via 'diretoria'/'plataforma' (o CHECK do log não muda).
-- 2. Armazenamento mínimo (decisão do dono, 28/09):
--    * o app comprime para WebP (fallback JPEG), lado maior 1080 px, alvo ≤ 150 KB;
--    * o bucket 'comunidade' passa a aceitar image/webp e o LIMITE cai para 300 KB (o servidor
--      recusa arquivo grande mesmo com app adulterado).
-- 3. Vida útil:
--    * foto de post expira em 90 dias (foto_expira_em): o post continua, sem a foto ("foto expirada");
--    * foto recusada/removida pela moderação, de post apagado ou retirado pelo responsável: entra
--      na fila de apagar NA HORA (gatilho); arquivo órfão (subiu e não virou post) em 1 dia;
--    * avatar (bucket 'imagens') fica enquanto o membro estiver ativo — nada muda aqui.
--    O Supabase NÃO deixa apagar arquivo por SQL (storage.protect_objects_delete): o banco só
--    MARCA (rede_fotos_para_apagar); a Edge Function `limpar-fotos-rede` (service_role) lê a
--    fila, remove pela API do Storage em lotes de até 100 e confirma. Cada rodada vai para
--    rede_limpeza_log (arquivos e bytes liberados).
--    O pg_cron roda public.rede_limpeza_rotina() todo dia: marca e, se o Vault tiver
--    'rede_limpeza_url' e 'rede_limpeza_secret', chama a Edge Function por pg_net. Sem eles
--    (ex.: banco local), só marca e registra em infra_falhas — a função pode ser chamada à mão.
-- =============================================================================

-- -----------------------------------------------------------------------------
--  1. Moderação: ação 'ocultar'
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
  else
    raise exception 'Tipo inválido.';
  end if;
  if v_club is null or (p_club_exigido is not null and v_club <> p_club_exigido) then
    raise exception 'Conteúdo não encontrado.';
  end if;
  v_pend := exists (select 1 from public.comunidade_denuncias d where d.alvo_tipo = p_tipo and d.alvo_id = p_id and d.resultado = 'pendente');

  if p_acao in ('aprovar_foto', 'recusar_foto') then
    if p_tipo <> 'post' or v_status <> 'em_analise' then raise exception 'Só fotos em análise podem ser aprovadas ou recusadas.'; end if;
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


-- -----------------------------------------------------------------------------
--  2. Bucket: WebP ou JPEG, até 300 KB
-- -----------------------------------------------------------------------------
update storage.buckets set allowed_mime_types = array['image/jpeg', 'image/webp'], file_size_limit = 307200, public = false
 where id = 'comunidade';

-- caminho aceita .jpg ou .webp (as policies de Storage da 432 chamam esta função)
create or replace function public._comunidade_pode_enviar_foto(p_name text)
returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_club uuid := public.clube_atual_id(); v_papel text;
begin
  if v_uid is null or v_club is null then return false; end if;
  if coalesce(p_name, '') !~ ('^' || v_club::text || '/' || v_uid::text || '/[0-9a-f-]{36}\.(jpg|webp)$') then return false; end if;
  if not public.recurso_habilitado_no_clube(v_club, 'comunidade') then return false; end if;
  v_papel := public._comunidade_papel(v_uid, v_club);
  if v_papel is null or v_papel = 'pais' then return false; end if;
  if v_papel = 'desbravador' and not public._comunidade_autorizado(v_uid, v_club) then return false; end if;
  return public._comunidade_suspenso_ate(v_uid) is null;
end;
$$;
revoke all on function public._comunidade_pode_enviar_foto(text) from public, anon;
grant execute on function public._comunidade_pode_enviar_foto(text) to authenticated;

-- comunidade_publicar (431) com o caminho .jpg|.webp — o resto é idêntico
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

-- foto expirada/apagada não abre mais (nem por URL assinada antiga pedida de novo)
create or replace function public._comunidade_pode_ver_foto(p_name text)
returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_club uuid := public.clube_atual_id(); p record; v_papel text;
begin
  if v_uid is null then return false; end if;
  select * into p from public.comunidade_posts where foto_path = p_name;
  if not found then
    return split_part(coalesce(p_name, ''), '/', 2) = v_uid::text;
  end if;
  if p.autor_id = v_uid or public.eh_admin_plataforma(v_uid) then return true; end if;
  if p.foto_apagada_em is not null or p.foto_expira_em <= now() then return false; end if;
  if v_club is null then return false; end if;
  if p.club_id = v_club and public.pode_administrar_clube(v_club) then return true; end if;
  if p.status <> 'publicado' or not public.recurso_habilitado_no_clube(p.club_id, 'comunidade')
     or not public.recurso_habilitado_no_clube(v_club, 'comunidade') then
    return false;
  end if;
  v_papel := public._comunidade_papel(v_uid, v_club);
  return v_papel is not null and (v_papel <> 'desbravador' or public._comunidade_autorizado(v_uid, v_club));
end;
$$;
revoke all on function public._comunidade_pode_ver_foto(text) from public, anon;
grant execute on function public._comunidade_pode_ver_foto(text) to authenticated;


-- -----------------------------------------------------------------------------
--  3. Vida útil: 90 dias, fila de apagar e log
-- -----------------------------------------------------------------------------
create or replace function public.rede_dias_de_foto() returns int
language sql immutable set search_path = '' as $$ select 90 $$;   -- mudar = migration nova
revoke all on function public.rede_dias_de_foto() from public, anon;
grant execute on function public.rede_dias_de_foto() to authenticated;

update public.comunidade_posts
   set foto_expira_em = coalesce(publicado_em, created_at) + make_interval(days => public.rede_dias_de_foto())
 where foto_path is not null and foto_expira_em is null;

create or replace function public._rede_foto_expira() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.foto_path is not null and new.foto_expira_em is null then
    new.foto_expira_em := now() + make_interval(days => public.rede_dias_de_foto());
  end if;
  return new;
end;
$$;
revoke all on function public._rede_foto_expira() from public, anon, authenticated;
drop trigger if exists trg_rede_foto_expira on public.comunidade_posts;
create trigger trg_rede_foto_expira before insert on public.comunidade_posts
  for each row execute function public._rede_foto_expira();

-- Fila (club_id = clube do post/pasta). O arquivo só sai pela Edge Function (API do Storage).
create table if not exists public.rede_fotos_para_apagar (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.organizational_units(id) on delete cascade,
  bucket text not null default 'comunidade',
  caminho text not null,
  motivo text not null check (motivo in ('expirada', 'recusada', 'removida', 'apagada', 'retirada', 'orfa')),
  post_id uuid references public.comunidade_posts(id) on delete set null,
  bytes bigint,
  marcada_em timestamptz not null default now(),
  apagada_em timestamptz,
  tentativas int not null default 0,
  erro text,
  unique (bucket, caminho)
);
create index if not exists rede_fotos_para_apagar_pendentes_idx on public.rede_fotos_para_apagar (marcada_em) where apagada_em is null;
alter table public.rede_fotos_para_apagar enable row level security;
revoke all on public.rede_fotos_para_apagar from public, anon, authenticated;

-- Log das rodadas (da PLATAFORMA; sem club_id — exceção no teste 20)
create table if not exists public.rede_limpeza_log (
  id uuid primary key default gen_random_uuid(),
  origem text not null check (origem in ('marcacao', 'edge')),
  marcadas int not null default 0,
  arquivos int not null default 0,
  bytes bigint not null default 0,
  erros int not null default 0,
  detalhe text,
  created_at timestamptz not null default now()
);
alter table public.rede_limpeza_log enable row level security;
revoke all on public.rede_limpeza_log from public, anon, authenticated;
select public._manutencao_instalar_guarda();

create or replace function public._rede_tamanho_objeto(p_bucket text, p_caminho text) returns bigint
language sql stable security definer set search_path = '' as $$
  select nullif(o.metadata ->> 'size', '')::bigint from storage.objects o where o.bucket_id = p_bucket and o.name = p_caminho;
$$;
revoke all on function public._rede_tamanho_objeto(text, text) from public, anon, authenticated;

-- Moderação/apagar/retirar: a foto entra na fila NA HORA
create or replace function public._rede_foto_fora_do_ar() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.foto_path is not null and new.status is distinct from old.status
     and new.status in ('recusado', 'removido', 'apagado', 'retirado') then
    insert into public.rede_fotos_para_apagar (club_id, caminho, motivo, post_id, bytes)
    values (new.club_id, new.foto_path,
            case new.status when 'recusado' then 'recusada' when 'removido' then 'removida'
                            when 'apagado' then 'apagada' else 'retirada' end,
            new.id, public._rede_tamanho_objeto('comunidade', new.foto_path))
    on conflict (bucket, caminho) do nothing;
  end if;
  return new;
end;
$$;
revoke all on function public._rede_foto_fora_do_ar() from public, anon, authenticated;
drop trigger if exists trg_rede_foto_fora_do_ar on public.comunidade_posts;
create trigger trg_rede_foto_fora_do_ar after update of status on public.comunidade_posts
  for each row execute function public._rede_foto_fora_do_ar();

-- Marcação diária: expiradas + fora do ar que escaparam + órfãs (subiu e não virou post em 1 dia)
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

  insert into public.rede_fotos_para_apagar (club_id, caminho, motivo, bytes)
  select u.id, o.name, 'orfa', nullif(o.metadata ->> 'size', '')::bigint
    from storage.objects o
    join public.organizational_units u on u.id::text = split_part(o.name, '/', 1)
   where o.bucket_id = 'comunidade' and o.created_at < now() - interval '1 day'
     and not exists (select 1 from public.comunidade_posts p where p.foto_path = o.name)
  on conflict (bucket, caminho) do nothing;
  get diagnostics v_k = row_count; v_n := v_n + v_k;

  insert into public.rede_limpeza_log (origem, marcadas) values ('marcacao', v_n);
  return v_n;
end;
$$;
revoke all on function public.rede_marcar_fotos_para_apagar() from public, anon, authenticated;

-- Lidas/confirmadas SÓ pela Edge Function (service_role)
create or replace function public.rede_fotos_pendentes(p_limite int default 500)
returns table (id uuid, bucket text, caminho text, bytes bigint)
language sql stable security definer set search_path = '' as $$
  select f.id, f.bucket, f.caminho, f.bytes from public.rede_fotos_para_apagar f
   where f.apagada_em is null and f.tentativas < 5
   order by f.marcada_em limit least(greatest(coalesce(p_limite, 500), 1), 2000);
$$;
revoke all on function public.rede_fotos_pendentes(int) from public, anon, authenticated;
grant execute on function public.rede_fotos_pendentes(int) to service_role;

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
  update public.rede_fotos_para_apagar set tentativas = tentativas + 1, erro = left(p_erro, 300)
   where id = any(coalesce(p_falhas, '{}')) and apagada_em is null;
  insert into public.rede_limpeza_log (origem, arquivos, bytes, erros, detalhe)
  values ('edge', v_arq, v_bytes, coalesce(array_length(p_falhas, 1), 0), left(p_erro, 300));
  return jsonb_build_object('arquivos', v_arq, 'bytes', v_bytes);
end;
$$;
revoke all on function public.rede_fotos_confirmar(uuid[], uuid[], text) from public, anon, authenticated;
grant execute on function public.rede_fotos_confirmar(uuid[], uuid[], text) to service_role;

-- Rotina do cron: marca e (se configurado) chama a Edge Function
create or replace function public.rede_limpeza_rotina()
returns void
language plpgsql security definer set search_path = '' as $$
declare v_url text; v_segredo text;
begin
  perform public.rede_marcar_fotos_para_apagar();
  begin
    select decrypted_secret into v_url     from vault.decrypted_secrets where name = 'rede_limpeza_url';
    select decrypted_secret into v_segredo from vault.decrypted_secrets where name = 'rede_limpeza_secret';
  exception when others then v_url := null;
  end;
  if v_url is null or v_segredo is null then
    insert into public.infra_falhas (origem, detalhe)
    values ('rede/limpeza', 'sem rede_limpeza_url/rede_limpeza_secret no Vault: só marcou; rode a Edge Function limpar-fotos-rede à mão');
    return;
  end if;
  perform net.http_post(url := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-rede-limpeza-secret', v_segredo),
    body := '{}'::jsonb, timeout_milliseconds := 10000);
end;
$$;
revoke all on function public.rede_limpeza_rotina() from public, anon, authenticated;

-- Admin da plataforma vê quanto foi liberado
create or replace function public.admin_rede_armazenamento()
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public._exigir_admin_plataforma();
  return jsonb_build_object(
    'pendentes', (select count(*) from public.rede_fotos_para_apagar where apagada_em is null),
    'liberados_arquivos', (select coalesce(sum(arquivos), 0) from public.rede_limpeza_log where origem = 'edge'),
    'liberados_bytes', (select coalesce(sum(bytes), 0) from public.rede_limpeza_log where origem = 'edge'),
    'ultima', (select max(created_at) from public.rede_limpeza_log where origem = 'edge'));
end;
$$;
revoke all on function public.admin_rede_armazenamento() from public, anon;
grant execute on function public.admin_rede_armazenamento() to authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'rede-limpar-fotos';
    perform cron.schedule('rede-limpar-fotos', '35 5 * * *', 'select public.rede_limpeza_rotina()');
  end if;
end $$;

;
insert into supabase_migrations.schema_migrations(version, name) values ('20260930000472', 'rede-dbv-moderacao-e-vida-util-das-fotos') on conflict do nothing;

-- ======================= 20260930000480_rede-dbv-publicacao-direta-e-stories =======================
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

;
insert into supabase_migrations.schema_migrations(version, name) values ('20260930000480', 'rede-dbv-publicacao-direta-e-stories') on conflict do nothing;

-- ======================= 20260930000481_rede-dbv-busca =======================
-- =============================================================================
-- 481 — REDE DBV: BUSCAR clubes e pessoas (/rede/buscar)
-- =============================================================================
--   * Só quem está na rede busca (_exigir_comunidade). Só aparecem pessoas que PARTICIPAM da rede
--     (vínculo ativo, recurso ligado no clube, criança com autorização dos pais; responsáveis não
--     aparecem) e clubes com o recurso ligado.
--   * A busca compara o NOME PÚBLICO (nome + sobrenome, o mesmo que o feed mostra) e o nome do
--     clube — nunca o nome completo, para não virar oráculo de nome de criança.
--   * Foto de rosto só com a autorização de imagem (mesmo _comunidade_autor_json).
--   * Termo com pelo menos 2 letras; até 20 pessoas e 10 clubes. p_clube lista as pessoas de um clube.
-- =============================================================================

create or replace function public._rede_busca_norm(p text)
returns text
language sql immutable set search_path = '' as $$
  select btrim(regexp_replace(translate(lower(coalesce(p, '')), 'áàâãäéèêëíìîïóòôõöúùûüçñ', 'aaaaaeeeeiiiiooooouuuucn'), '\s+', ' ', 'g'));
$$;
revoke all on function public._rede_busca_norm(text) from public, anon, authenticated;

create or replace function public.rede_buscar(p_termo text default null, p_clube uuid default null)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare c jsonb := public._exigir_comunidade(false); v_t text := public._rede_busca_norm(p_termo);
begin
  if p_clube is null and length(v_t) < 2 then
    return jsonb_build_object('pessoas', '[]'::jsonb, 'clubes', '[]'::jsonb);
  end if;
  if p_clube is not null and not public.recurso_habilitado_no_clube(p_clube, 'comunidade') then
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
                           and public.recurso_habilitado_no_clube(u2.id, 'comunidade')
                         order by u2.nome limit 10) u) end);
end;
$$;
revoke all on function public.rede_buscar(text, uuid) from public, anon;
grant execute on function public.rede_buscar(text, uuid) to authenticated;

;
insert into supabase_migrations.schema_migrations(version, name) values ('20260930000481', 'rede-dbv-busca') on conflict do nothing;

select 'OK' as resultado,
  (select max(version) from supabase_migrations.schema_migrations) as ledger,
  (select count(*) from public.rede_desafios) as desafios,
  (select public.rede_foto_exige_aprovacao()) as foto_exige_aprovacao,
  (select count(*) from public.organization_memberships m join public.organizational_units u on u.id = m.organizational_unit_id
    where u.slug = 'filhos-da-conquista' and m.status = 'ativo') as ativos_filhos_da_conquista;
