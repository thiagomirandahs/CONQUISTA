-- =============================================================================
--  LIMITE DE MEMBROS AJUSTÁVEL PELO ADMIN DA PLATAFORMA (por clube).
--
--  Regra do que CONTA (inalterada desde a migration 48, agora documentada na tela):
--    membro = vínculo ATIVO e vigente no clube (starts_at <= agora < ends_at), de QUALQUER papel,
--    EXCETO responsável ('pais'). Pendente, suspenso e encerrado não contam; responsável nunca conta
--    nem é barrado. Vínculo que foi para a lixeira (migration 221) some da tabela e libera a vaga.
--
--  O que muda:
--    1) club_limit_overrides: o admin da plataforma fixa um teto de MEMBROS só para um clube, sem
--       mexer na versão do plano (que vale para todos os clubes daquele plano). Remover o ajuste
--       devolve o clube ao teto do plano. Toda mudança vai para platform_admin_audit.
--    2) plano_limite() passa a responder o ajuste do clube antes do teto do plano — então o gatilho
--       que JÁ barra a entrada (trg_exigir_limite_de_vinculo: aprovar cadastro/inscrição, aceitar
--       convite de equipe, reativar vínculo, inserir vínculo ativo) e a tela "Uso do plano" do clube
--       (limites_do_clube) passam a usar o teto efetivo sem nenhum ponto de entrada novo.
--    3) Mensagem clara para a diretoria: "O clube atingiu o limite de N membros do plano".
--    4) RPCs do admin: admin_clube_limite_membros (ler) e admin_clube_limite_membros_definir.
--
--  Não altera dado de clube nenhum (tabela nova vazia; funções).
-- =============================================================================

create table if not exists public.club_limit_overrides (
  club_id uuid not null references public.organizational_units(id) on delete cascade,
  chave text not null check (chave in ('membros')),
  valor bigint not null check (valor between 1 and 100000),
  motivo text,
  definido_por uuid references auth.users(id) on delete set null,
  definido_em timestamptz not null default now(),
  primary key (club_id, chave)
);
alter table public.club_limit_overrides enable row level security;
revoke all on public.club_limit_overrides from public, anon, authenticated;

-- Mesmo corpo da 48 + o ajuste do clube na frente. O ajuste vale mesmo sem assinatura.
create or replace function public.plano_limite(p_club_id uuid, p_chave text) returns bigint
language plpgsql stable security definer set search_path = '' as $$
declare v_sub record; v_val text; v_ajuste bigint;
begin
  select o.valor into v_ajuste from public.club_limit_overrides o where o.club_id = p_club_id and o.chave = p_chave;
  if v_ajuste is not null then return v_ajuste; end if;
  select s.* into v_sub from public.subscriptions s where s.id = public.assinatura_do_clube_id(p_club_id);
  if not found then return null; end if;                      -- sem assinatura = sem teto
  select nullif(p.limites ->> p_chave, '') into v_val from public.billing_plans p where p.id = v_sub.plan_id;
  return case when v_val ~ '^\d+$' then v_val::bigint end;    -- ausente/null/não-numérico = ilimitado
end;
$$;
revoke all on function public.plano_limite(uuid, text) from public, anon, authenticated;

-- teto que o PLANO daria sem o ajuste (para a tela mostrar "plano: 300 · ajustado: 350")
create or replace function public._plano_limite_sem_ajuste(p_club_id uuid, p_chave text) returns bigint
language sql stable security definer set search_path = '' as $$
  select case when v ~ '^\d+$' then v::bigint end
    from (select nullif(p.limites ->> p_chave, '') as v
            from public.subscriptions s join public.billing_plans p on p.id = s.plan_id
           where s.id = public.assinatura_do_clube_id(p_club_id)) x;
$$;
revoke all on function public._plano_limite_sem_ajuste(uuid, text) from public, anon, authenticated;

-- a tela "Uso do plano" do clube ganha 'ajustado' (sem expor quem ajustou nem o motivo)
create or replace function public.limites_do_clube(p_club_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_object_agg(k, jsonb_build_object(
           'limite', public.plano_limite(p_club_id, k),
           'uso', public.limite_uso(p_club_id, k),
           'medicao', case when public.limite_uso(p_club_id, k) is null then 'pendente' else 'ok' end,
           'ajustado', exists (select 1 from public.club_limit_overrides o where o.club_id = p_club_id and o.chave = k)
         )), '{}'::jsonb)
  from unnest(array['membros', 'administradores', 'clubes', 'fotos', 'armazenamento_mb']) k;
$$;
revoke all on function public.limites_do_clube(uuid) from public, anon, authenticated;

-- Gatilho da 48 com a mensagem nova. Continua: nunca remove ninguém, só barra a ENTRADA.
create or replace function public._exigir_limite_de_vinculo() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_lim bigint; v_uso bigint;
begin
  if new.status <> 'ativo' or new.role = 'pais' then return new; end if;
  if tg_op = 'UPDATE' and old.status = 'ativo' and old.role = new.role then return new; end if;

  v_lim := public.plano_limite(new.organizational_unit_id, 'membros');
  if v_lim is not null then
    v_uso := public.limite_uso(new.organizational_unit_id, 'membros');
    if v_uso >= v_lim then
      raise exception 'O clube atingiu o limite de % membros do plano (% ativos; responsáveis não contam). Nada foi removido: para incluir mais gente, encerre vínculos que não são mais usados ou fale com o suporte para ampliar o limite.', v_lim, v_uso
        using errcode = 'P0001', hint = 'limite_membros';
    end if;
  end if;

  if new.role in ('diretoria', 'tesoureiro') then
    v_lim := public.plano_limite(new.organizational_unit_id, 'administradores');
    if v_lim is not null then
      v_uso := public.limite_uso(new.organizational_unit_id, 'administradores');
      if v_uso >= v_lim then
        raise exception 'O plano deste clube permite % administradores (já são %). Nada foi removido: amplie o plano.', v_lim, v_uso;
      end if;
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public._exigir_limite_de_vinculo() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- admin da plataforma
-- ---------------------------------------------------------------------------
create or replace function public.admin_clube_limite_membros(p_club_id uuid) returns json
language plpgsql stable security definer set search_path = '' as $$
declare v_o public.club_limit_overrides;
begin
  perform public._exigir_admin_plataforma();
  if not exists (select 1 from public.organizational_units where id = p_club_id and type = 'clube') then
    raise exception 'Clube não encontrado.';
  end if;
  select * into v_o from public.club_limit_overrides where club_id = p_club_id and chave = 'membros';
  return json_build_object(
    'club_id', p_club_id,
    'uso', public.limite_uso(p_club_id, 'membros'),
    'limite_plano', public._plano_limite_sem_ajuste(p_club_id, 'membros'),
    'limite_efetivo', public.plano_limite(p_club_id, 'membros'),
    'ajuste', case when v_o.club_id is not null then json_build_object(
                'valor', v_o.valor, 'motivo', v_o.motivo, 'definido_em', v_o.definido_em) end,
    'regra', 'Conta vínculo ATIVO e vigente de qualquer papel, exceto responsável (pais). Pendente, suspenso, encerrado e quem está na lixeira não contam.');
end;
$$;

-- p_limite NULL = remove o ajuste (volta ao teto do plano). Pode ficar abaixo do uso atual: ninguém
-- é removido, só a entrada nova fica barrada (mesma regra do downgrade de plano).
create or replace function public.admin_clube_limite_membros_definir(p_club_id uuid, p_limite int, p_motivo text default null) returns json
language plpgsql security definer set search_path = '' as $$
declare v_admin uuid := public._exigir_admin_plataforma(); v_antes bigint; v_motivo text := nullif(btrim(coalesce(p_motivo, '')), '');
        v_uso bigint;
begin
  if not exists (select 1 from public.organizational_units where id = p_club_id and type = 'clube') then
    raise exception 'Clube não encontrado.';
  end if;
  select valor into v_antes from public.club_limit_overrides where club_id = p_club_id and chave = 'membros';
  if p_limite is null then
    delete from public.club_limit_overrides where club_id = p_club_id and chave = 'membros';
  else
    if p_limite < 1 or p_limite > 100000 then raise exception 'Limite inválido: use de 1 a 100000 membros.'; end if;
    if v_motivo is null then raise exception 'Informe o motivo do ajuste (fica na auditoria).'; end if;
    insert into public.club_limit_overrides (club_id, chave, valor, motivo, definido_por)
    values (p_club_id, 'membros', p_limite, left(v_motivo, 300), v_admin)
    on conflict (club_id, chave) do update
      set valor = excluded.valor, motivo = excluded.motivo, definido_por = excluded.definido_por, definido_em = now();
  end if;
  v_uso := public.limite_uso(p_club_id, 'membros');
  perform public._admin_auditar(case when p_limite is null then 'limite_membros_remover' else 'limite_membros_definir' end,
    'club', p_club_id,
    jsonb_build_object('antes', v_antes, 'depois', p_limite, 'limite_plano', public._plano_limite_sem_ajuste(p_club_id, 'membros'),
                       'uso', v_uso, 'motivo', v_motivo));
  return json_build_object('ok', true, 'limite_efetivo', public.plano_limite(p_club_id, 'membros'), 'uso', v_uso,
                           'abaixo_do_uso', p_limite is not null and v_uso > p_limite);
end;
$$;

do $$
declare f text;
begin
  foreach f in array array['admin_clube_limite_membros(uuid)', 'admin_clube_limite_membros_definir(uuid, int, text)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

notify pgrst, 'reload schema';

insert into public.migracoes_aplicadas (arquivo)
values ('2026-09-30-limite-de-membros-por-clube.sql')
on conflict (arquivo) do update set aplicada_em = now();
