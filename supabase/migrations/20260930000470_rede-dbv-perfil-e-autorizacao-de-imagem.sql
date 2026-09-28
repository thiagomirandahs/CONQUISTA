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
