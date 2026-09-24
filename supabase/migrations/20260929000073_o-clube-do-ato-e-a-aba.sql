-- =============================================================================
--  Fase 9 (ISOLAMENTO / funcional) — o clube de uma escrita é o da ABA, não o da PESSOA.
--
--  O teste 58 pôs uma pessoa em A e em B e mandou ela agir nas duas abas. Três superfícies
--  falharam no segundo clube, pela mesma raiz — o gatilho de carimbo adivinha o clube a partir da
--  pessoa, ignorando em que clube ela está agindo:
--
--    · mensalidade   `definir_club_mensalidade` sobrescrevia com o vínculo MAIS ANTIGO do membro.
--                    O tesoureiro de B nunca conseguia cobrar alguém que também é de A (e, antes da
--                    migration 68, teria escrito no caixa de A);
--    · foto no mural `definir_club_foto` fazia o mesmo com o autor;
--    · ajuda         `definir_club_ajuda` exigia que o vínculo MAIS NOVO das duas pessoas fosse o
--                    mesmo, e `pedir_ajuda` lia o amigo pelo espelho legado de `profiles`. Recusava
--                    nas DUAS abas;
--    · e o aviso pessoal que a ajuda gera era carimbado no clube mais novo de quem recebe — o aviso
--      de um ato em A aparecia na aba B.
--
--  A REGRA NOVA, a mesma nos quatro:
--    1. `club_id` explícito (rotina do banco, ou cliente — que a RLS escopada da migration 68 ainda
--       confere) vale, desde que a pessoa tenha vínculo ativo ali;
--    2. senão, o clube da ABA, se a pessoa tem vínculo ativo nele;
--    3. senão, e SÓ fora de sessão de cliente (cron, service), o palpite antigo — uma rotina do banco
--       não tem aba, e sem header `clube_atual_id()` devolve o clube legado, que NÃO pode virar
--       carimbo de uma rotina que nada tem a ver com ele;
--    4. senão, recusa — com a mesma resposta de antes.
--
--  O que NÃO muda: nenhuma política, nenhuma RPC além de `pedir_ajuda`, nenhum dado existente.
-- =============================================================================

-- A aba, mas só quando quem escreve é um cliente. Fora disso não há aba — e o default legado de
-- `clube_atual_id()` (header ausente) não é uma aba, é compatibilidade.
create or replace function public._clube_da_aba()
returns uuid
language sql stable security definer set search_path = '' as $$
  select case when public._sessao_de_cliente() then public.clube_atual_id() end;
$$;
revoke all on function public._clube_da_aba() from public, anon, authenticated;

-- A pessoa tem vínculo com este clube? `p_so_ativo` = só o vínculo ativo e vigente (quem age);
-- falso = qualquer vínculo (quem RECEBE um aviso, inclusive o de que foi desativado).
create or replace function public._tem_vinculo(p_user uuid, p_club uuid, p_so_ativo boolean default true)
returns boolean
language sql stable security definer set search_path = '' as $$
  select p_user is not null and p_club is not null and exists (
    select 1 from public.organization_memberships m
     where m.user_id = p_user and m.organizational_unit_id = p_club
       and (not p_so_ativo
            or (m.status = 'ativo' and m.starts_at <= now() and (m.ends_at is null or m.ends_at > now()))));
$$;
revoke all on function public._tem_vinculo(uuid, uuid, boolean) from public, anon, authenticated;

-- O palpite antigo, para quando não há aba nem clube explícito: o vínculo ativo mais antigo.
create or replace function public._clube_mais_antigo(p_user uuid)
returns uuid
language sql stable security definer set search_path = '' as $$
  select organizational_unit_id from public.organization_memberships
   where user_id = p_user and status = 'ativo'
     and starts_at <= now() and (ends_at is null or ends_at > now())
   order by starts_at, created_at limit 1;
$$;
revoke all on function public._clube_mais_antigo(uuid) from public, anon, authenticated;


-- ---------- mensalidades ----------
create or replace function public.definir_club_mensalidade()
returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  -- o UPDATE que a FK (ON DELETE SET NULL) faz ao excluir o membro: a mensalidade fica sem dono,
  -- mas continua no MESMO clube (o caixa é preservado)
  if new.desbravador_id is null then
    if new.club_id is null then raise exception 'Mensalidade sem clube.'; end if;
    return new;
  end if;
  -- o dono não mudou (o upsert da tela reenvia `desbravador_id`): o clube da linha não muda. Antes,
  -- este UPDATE recalculava o clube e podia MOVER a linha para outro caixa.
  if tg_op = 'UPDATE' and new.desbravador_id = old.desbravador_id and new.club_id is not distinct from old.club_id then
    return new;
  end if;

  if new.club_id is not null then
    if not public._tem_vinculo(new.desbravador_id, new.club_id) then
      perform public._recusar_linha('mensalidades', 'Membro sem clube para mensalidade.');
    end if;
    return new;
  end if;

  new.club_id := public._clube_da_aba();
  if not public._tem_vinculo(new.desbravador_id, new.club_id) then
    new.club_id := case when public._sessao_de_cliente() then null
                        else public._clube_mais_antigo(new.desbravador_id) end;
  end if;

  if new.club_id is null then
    -- membro INATIVO do PRÓPRIO clube (a aba): mensagem clara — a liderança já enxerga essa pessoa.
    -- Qualquer outro caso — inexistente ou de outro clube — recebe a resposta padrão da RLS.
    if public._tem_vinculo(new.desbravador_id, public._clube_da_aba(), false) then
      raise exception 'Membro sem clube para mensalidade.';
    end if;
    perform public._recusar_linha('mensalidades', 'Membro sem clube para mensalidade.');
  end if;
  return new;
end;
$$;


-- ---------- fotos (mural) ----------
create or replace function public.definir_club_foto()
returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.autor_id is null then
    -- autor excluído (FK SET NULL): o clube da foto NÃO muda.
    return new;
  end if;
  if tg_op = 'UPDATE' and new.autor_id = old.autor_id and new.club_id is not distinct from old.club_id then
    return new;
  end if;

  if new.club_id is not null then
    if not public._tem_vinculo(new.autor_id, new.club_id) then
      perform public._recusar_linha('fotos', 'Sem clube: esta pessoa não participa deste clube.');
    end if;
    return new;
  end if;

  new.club_id := public._clube_da_aba();
  if not public._tem_vinculo(new.autor_id, new.club_id) then
    new.club_id := case when public._sessao_de_cliente() then null
                        else public._clube_mais_antigo(new.autor_id) end;
  end if;

  if new.club_id is null then
    perform public._recusar_linha('fotos', 'Sem clube: esta pessoa não participa de nenhum clube.');
  end if;
  return new;
end;
$$;


-- ---------- ajudas ----------
create or replace function public.definir_club_ajuda()
returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_a uuid; v_b uuid;
begin
  new.club_id := coalesce(new.club_id, public._clube_da_aba());
  if new.club_id is not null then
    -- as DUAS pessoas precisam estar ativas no clube em que a ajuda acontece
    if not (public._tem_vinculo(new.de_id, new.club_id) and public._tem_vinculo(new.para_id, new.club_id)) then
      raise exception 'Ajuda só entre amigos do mesmo clube.';
    end if;
    return new;
  end if;
  -- sem aba (rotina do banco): o palpite antigo
  v_a := public.clube_vinculo_do_usuario(new.de_id);
  v_b := public.clube_vinculo_do_usuario(new.para_id);
  if v_a is null or v_a is distinct from v_b then
    raise exception 'Ajuda só entre amigos do mesmo clube.';
  end if;
  new.club_id := v_a;
  return new;
end;
$$;

-- O amigo é lido pelo VÍNCULO no clube da aba, não pelo espelho de `profiles` (que reflete um clube
-- só: o primário). E a ajuda e o aviso saem com o clube explícito — o da aba em que ela foi pedida.
create or replace function public.pedir_ajuda(p_para uuid, p_jogo text, p_enunciado jsonb, p_resposta text)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_club uuid := public.clube_atual_id();
  v_uid uuid := auth.uid();
  v_id uuid;
  v_nome text;
  v_nomejogo text;
  v_ja_aberto boolean;
begin
  if v_uid is null then raise exception 'Não autenticado.'; end if;
  if not public.membro_ativo_no_clube(v_club) then raise exception 'Sem permissão.'; end if;
  if p_jogo not in ('anagrama', 'forca', 'termo') then raise exception 'Jogo inválido.'; end if;
  if p_para = v_uid then raise exception 'Escolha um amigo (não você mesmo).'; end if;
  if not exists (select 1 from public.organization_memberships m
                  where m.user_id = p_para and m.organizational_unit_id = v_club
                    and m.role <> 'pais' and m.status = 'ativo'
                    and m.starts_at <= now() and (m.ends_at is null or m.ends_at > now())) then
    raise exception 'Amigo inválido.';
  end if;
  if coalesce(trim(p_resposta), '') = '' then raise exception 'Desafio sem resposta.'; end if;

  perform pg_advisory_xact_lock(hashtext(v_uid::text || ':pedir_ajuda'));

  -- ANTI-FLOOD: no máximo 5 pedidos a cada 5 minutos (não deixa spammar a caixa de um colega)
  if (select count(*) from public.ajudas where de_id = v_uid and criado_em > now() - interval '5 minutes') >= 5 then
    raise exception 'Você pediu ajuda demais agora. Espere um pouquinho 🙂';
  end if;

  -- já havia pedido ABERTO pra ESTE mesmo amigo? então NÃO re-notifica (evita flood dirigido)
  v_ja_aberto := exists (select 1 from public.ajudas where de_id = v_uid and para_id = p_para and status = 'aberto');

  -- só 1 pedido aberto por vez: cancela os anteriores e cria o novo (com o desafio atual)
  update public.ajudas set status = 'cancelado' where de_id = v_uid and status = 'aberto';
  insert into public.ajudas (club_id, de_id, para_id, jogo, enunciado, resposta)
  values (v_club, v_uid, p_para, p_jogo, p_enunciado, p_resposta)
  returning id into v_id;

  if not v_ja_aberto then
    select nome into v_nome from public.profiles where id = v_uid;
    select nome into v_nomejogo from public._jogos_do_clube(v_club) where chave = p_jogo;
    -- notificação direcionada ao amigo (feita aqui dentro pois o cliente não pode inserir notificação)
    insert into public.notificacoes (club_id, titulo, corpo, tipo, link, para, para_usuario, criado_por)
    values (v_club, '🆘 Pedido de ajuda!',
      coalesce(v_nome, 'Um amigo') || ' precisou da sua ajuda no ' || coalesce(v_nomejogo, p_jogo) || '! Abra os 🎮 Jogos e ajude.',
      'geral', '/trilha', 'pessoal', p_para, v_uid);
  end if;

  return v_id;
end;
$$;


-- ---------- notificações pessoais ----------
create or replace function public.definir_club_notificacao()
returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_dest uuid;
begin
  if new.para_usuario is not null then
    -- aviso pessoal: no clube em que o ATO aconteceu, desde que quem recebe tenha vínculo ali
    -- (qualquer status: o aviso de "você foi desativado" é do clube que desativou). Ordem: o clube
    -- explícito da rotina, a aba de quem agiu, e só então o clube mais novo de quem recebe.
    if public._tem_vinculo(new.para_usuario, new.club_id, false) then
      return new;
    end if;
    v_dest := public._clube_da_aba();
    if not public._tem_vinculo(new.para_usuario, v_dest, false) then
      v_dest := public.clube_vinculo_do_usuario(new.para_usuario);
    end if;
    -- destinatário inexistente: para o cliente é a MESMA resposta de "destinatário de outro clube"
    if v_dest is null and public._sessao_de_cliente() then
      perform public._recusar_linha('notificacoes', 'Destinatário sem clube.');
    end if;
    new.club_id := v_dest;
  elsif new.club_id is not null then
    -- clube explícito (gatilhos e rotinas do banco). Se vier de um cliente, a RLS confere que é o
    -- clube dele e que ele é liderança dele; não dá para "mandar" aviso para outro clube.
    null;
  elsif new.criado_por is not null and public.clube_vinculo_do_usuario(new.criado_por) is not null then
    new.club_id := public.clube_vinculo_do_usuario(new.criado_por);
  end if;
  if new.club_id is null then
    perform public._recusar_linha('notificacoes', 'Sem clube: esta pessoa não participa de nenhum clube.');
  end if;
  return new;
end;
$$;
