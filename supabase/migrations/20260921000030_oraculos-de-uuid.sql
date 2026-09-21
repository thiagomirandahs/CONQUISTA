-- =====================================================================
-- Hardening final (2/3): oráculos de UUID nos gatilhos BEFORE INSERT/UPDATE.
-- Rodar DEPOIS da 20260921000029. Idempotente. Reproduzido no teste 24 antes de corrigir.
--
-- O problema: os gatilhos que decidem o clube de uma linha respondiam de forma DIFERENTE para "esse UUID existe em OUTRO clube" e
-- "esse UUID não existe" (mensagem própria x violação de chave estrangeira x sucesso). Quem tem sessão podia, chutando um UUID,
-- descobrir se ele existe em outro clube (atividade, pessoa, unidade). Os UUIDs são v4 (aleatórios), então o risco é baixo,
-- mas era alcançável por um cliente comum (membro que envia entrega, liderança que lança ponto, tesoureiro, aviso pessoal).
--
-- Agora, para QUEM VEM DE UMA SESSÃO DE CLIENTE (papel authenticated/anon):
--   * UUID de outro clube e UUID inexistente dão EXATAMENTE a mesma resposta: a de uma violação de RLS
--     (sqlstate 42501, `new row violates row-level security policy for table "<tabela>"`);
--   * `entregas.avaliado_por` e `mensalidades.registrado_por` (só marcam autoria) precisam ser quem faz a operação —
--     antes aceitavam o perfil de QUALQUER clube (referência cruzada + oráculo pela chave estrangeira).
-- Dono do banco, cron, service_role e o SQL Editor (papel postgres) continuam recebendo a mensagem específica e o
-- comportamento de sempre.
-- =====================================================================

-- ==================== 1) ferramentas ====================
-- Quem chama é uma sessão de cliente? (`role` é o papel da SESSÃO/requisição: dentro de função SECURITY DEFINER o current_user
-- vira o dono, mas `role` continua sendo o de quem chamou — o PostgREST usa SET ROLE por requisição.)
create or replace function public._sessao_de_cliente() returns boolean
language sql stable set search_path = '' as $$
  select coalesce(current_setting('role', true), '') in ('authenticated', 'anon')
$$;
revoke all on function public._sessao_de_cliente() from public, anon, authenticated;

-- Recusa a linha. Cliente: a resposta padrão da RLS (mesmo código e texto de uma policy que nega o INSERT/UPDATE).
-- Dono/cron: a mensagem específica (para quem depura).
create or replace function public._recusar_linha(p_tabela text, p_motivo text) returns void
language plpgsql set search_path = '' as $$
begin
  if public._sessao_de_cliente() then
    raise exception using errcode = '42501', message = format('new row violates row-level security policy for table "%s"', p_tabela);
  end if;
  raise exception '%', p_motivo;
end;
$$;
revoke all on function public._recusar_linha(text, text) from public, anon, authenticated;

-- ==================== 2) pontos: pessoa/unidade ====================
create or replace function public.definir_club_ponto() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_club_unidade uuid; v_club_pessoa uuid;
begin
  if new.unidade_id is not null then
    select club_id into v_club_unidade from public.unidades where id = new.unidade_id;
    -- unidade inexistente: para o cliente é a MESMA resposta de "unidade de outro clube" (antes caía no clube legado
    -- e só a chave estrangeira reclamava — dava para distinguir uma unidade que existe em outro clube)
    if v_club_unidade is null and public._sessao_de_cliente() then
      perform public._recusar_linha('pontos', 'Unidade inexistente.');
    end if;
  end if;
  if new.usuario_id is not null then
    v_club_pessoa := public.clube_vinculo_do_usuario(new.usuario_id);
    if v_club_pessoa is null and public._sessao_de_cliente() then
      perform public._recusar_linha('pontos', 'Pessoa sem clube.');
    end if;
  end if;
  if v_club_unidade is not null and v_club_pessoa is not null and v_club_unidade <> v_club_pessoa then
    perform public._recusar_linha('pontos', 'A pessoa e a unidade do ponto são de clubes diferentes.');
  end if;
  new.club_id := coalesce(v_club_unidade, v_club_pessoa, public.clube_legado_id());
  return new;
end;
$$;

-- ==================== 3) entregas: atividade/usuário ====================
create or replace function public.definir_club_entrega() returns trigger
language plpgsql security definer set search_path = 'public' as $$
begin
  select club_id into new.club_id
  from public.atividades
  where id = new.atividade_id;

  if new.club_id is null then
    perform public._recusar_linha('entregas', 'Atividade inválida ou sem clube.');
  end if;

  if not exists (
    select 1
    from public.organization_memberships m
    where m.user_id = new.usuario_id
      and m.organizational_unit_id = new.club_id
      and m.status in ('pendente', 'ativo')
      and m.starts_at <= now()
      and (m.ends_at is null or m.ends_at > now())
  ) then
    perform public._recusar_linha('entregas', 'O usuário não pertence ao clube desta atividade.');
  end if;

  return new;
end;
$$;

-- ==================== 4) mensalidades: pessoa ====================
create or replace function public.definir_club_mensalidade() returns trigger
language plpgsql security definer set search_path = 'public' as $$
begin
  -- o UPDATE que a FK (ON DELETE SET NULL) faz ao excluir o membro: a mensalidade fica sem dono,
  -- mas continua no MESMO clube (o caixa é preservado)
  if new.desbravador_id is null then
    if new.club_id is null then raise exception 'Mensalidade sem clube.'; end if;
    return new;
  end if;
  select organizational_unit_id into new.club_id
  from public.organization_memberships
  where user_id = new.desbravador_id and status = 'ativo'
    and starts_at <= now() and (ends_at is null or ends_at > now())
  order by starts_at, created_at limit 1;
  if new.club_id is null then
    -- membro INATIVO do PRÓPRIO clube: mensagem clara (a liderança já enxerga essa pessoa). Qualquer outro caso —
    -- inexistente ou de outro clube — recebe a resposta padrão da RLS (a mesma que a pessoa ATIVA de outro clube recebe).
    if public.clube_atual_id() is not null and public.clube_vinculo_do_usuario(new.desbravador_id) = public.clube_atual_id() then
      raise exception 'Membro sem clube para mensalidade.';
    end if;
    perform public._recusar_linha('mensalidades', 'Membro sem clube para mensalidade.');
  end if;
  return new;
end;
$$;

-- ==================== 5) notificações: destinatário ====================
create or replace function public.definir_club_notificacao() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_dest uuid;
begin
  if new.para_usuario is not null then
    -- aviso pessoal: sempre no clube de QUEM RECEBE (mesmo desativado)
    v_dest := public.clube_vinculo_do_usuario(new.para_usuario);
    -- destinatário inexistente: para o cliente é a MESMA resposta de "destinatário de outro clube" (antes caía no clube legado)
    if v_dest is null and public._sessao_de_cliente() then
      perform public._recusar_linha('notificacoes', 'Destinatário sem clube.');
    end if;
    new.club_id := coalesce(v_dest, public.clube_legado_id());
  elsif new.club_id is not null then
    -- clube explícito (gatilhos e rotinas do banco). Se vier de um cliente, a RLS confere que é o
    -- clube dele e que ele é liderança dele; não dá para "mandar" aviso para outro clube.
    null;
  elsif new.criado_por is not null and public.clube_vinculo_do_usuario(new.criado_por) is not null then
    new.club_id := public.clube_vinculo_do_usuario(new.criado_por);
  else
    new.club_id := public.clube_legado_id();
  end if;
  return new;
end;
$$;

-- ==================== 6) autoria: "quem avaliou/registrou" tem que ser quem faz a operação ====================
-- Gatilho (e não policy RESTRICTIVE) porque a policy não enxerga o valor ANTIGO: o membro que reenvia uma entrega, ou o tesoureiro que
-- edita outra mensalidade, mantém na linha o avaliado_por/registrado_por de OUTRA pessoa — isso não pode ser barrado.
create or replace function public.exigir_atribuicao_propria() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_col text := tg_argv[0]; v_novo uuid := (to_jsonb(new) ->> tg_argv[0])::uuid; v_antigo uuid;
begin
  if not public._sessao_de_cliente() or v_novo is null or v_novo is not distinct from auth.uid() then
    return new;
  end if;
  if tg_op = 'UPDATE' then
    v_antigo := (to_jsonb(old) ->> v_col)::uuid;
    if v_novo is not distinct from v_antigo then return new; end if;
  end if;
  perform public._recusar_linha(tg_table_name, format('%s precisa ser quem faz a operação.', v_col));
  return new;
end;
$$;
revoke all on function public.exigir_atribuicao_propria() from public, anon, authenticated;

drop trigger if exists trg_atribuicao_propria on public.entregas;
create trigger trg_atribuicao_propria before insert or update of avaliado_por on public.entregas
  for each row execute function public.exigir_atribuicao_propria('avaliado_por');
drop trigger if exists trg_atribuicao_propria on public.mensalidades;
create trigger trg_atribuicao_propria before insert or update of registrado_por on public.mensalidades
  for each row execute function public.exigir_atribuicao_propria('registrado_por');
