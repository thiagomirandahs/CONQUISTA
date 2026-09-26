-- =============================================================================
--  HISTÓRICO DE INATIVAÇÃO (com motivo) e FIM DA LIXEIRA DE MEMBROS — 2026-09-26
--
--  DECISÃO DO DONO (26/09): "remover a parte de apagar um inativo, para a gente não perder. Quando
--  inativar, fica um histórico com o motivo da inativação desse desbravador."
--
--  1) LIXEIRA DE MEMBROS (migration 221) DESLIGADA DE VEZ
--     - lixeira_config e lixeira_config_clube ficam 'desligado' e uma CHECK impede outro modo
--       (ninguém consegue ligar 'dry_run'/'ativo', nem por SQL de RPC antiga);
--     - o agendamento 'lixeira-membros-inativos' sai do cron (se existir);
--     - lixeira_rotina() e _lixeira_rodar_clube() viram no-op; _lixeira_arquivar() e
--       _lixeira_expurgar() recusam (nenhum caminho move ou apaga dado de membro);
--     - saem as RPCs de ligar/simular (admin_lixeira_config_definir, admin_lixeira_clube_modo,
--       admin_lixeira_simular). FICAM admin_lixeira_config/admin_lixeira_listar (leitura) e
--       admin_lixeira_recuperar, só para devolver algum pacote que exista (hoje: zero).
--     - NENHUMA tabela nem dado é apagado.
--  2) MOTIVO + HISTÓRICO por vínculo (public.vinculo_historico): inativar/suspender/encerrar exige
--     motivo (vinculo_inativar); reativar registra (motivo opcional, vinculo_reativar). Um gatilho
--     em organization_memberships grava TODA saída de ativo e toda volta a ativo — o que vier de
--     rotina ou de outro caminho entra como 'nao_informado'. vinculo_gerir passa a RECUSAR tirar um
--     vínculo ativo sem motivo. O membro inativo continua no clube, com pontos e classes.
--  3) Só a DIRETORIA do clube em uso lê o motivo (pode_administrar_clube). Tabela sem acesso direto.
--  4) excluir_usuario recusa apagar quem está INATIVO no clube (desativado, ou encerrado com
--     histórico): inativo não se apaga, fica guardado.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1) lixeira de membros: desligada e travada
-- ---------------------------------------------------------------------------
update public.lixeira_config set modo = 'desligado', atualizado_em = now() where modo <> 'desligado';
update public.lixeira_config_clube set modo = 'desligado', atualizado_em = now() where modo <> 'desligado';
alter table public.lixeira_config alter column modo set default 'desligado';
alter table public.lixeira_config drop constraint if exists lixeira_config_sempre_desligada;
alter table public.lixeira_config add constraint lixeira_config_sempre_desligada check (modo = 'desligado');
alter table public.lixeira_config_clube drop constraint if exists lixeira_config_clube_sempre_desligada;
alter table public.lixeira_config_clube add constraint lixeira_config_clube_sempre_desligada check (modo = 'desligado');
delete from public.lixeira_marcacoes;   -- só a "lista de quem iria" (dry-run); não é dado de membro

do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    if exists (select 1 from cron.job where jobname = 'lixeira-membros-inativos') then
      perform cron.unschedule('lixeira-membros-inativos');
    end if;
  end if;
end $$;

create or replace function public._lixeira_modo(p_club uuid) returns text
language sql stable security definer set search_path = '' as $$ select 'desligado'::text $$;
revoke all on function public._lixeira_modo(uuid) from public, anon, authenticated;

create or replace function public._lixeira_rodar_clube(p_club uuid, p_forcar_dry_run boolean default false) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  return jsonb_build_object('modo', 'desligado');
end;
$$;
revoke all on function public._lixeira_rodar_clube(uuid, boolean) from public, anon, authenticated;

create or replace function public.lixeira_rotina() returns int
language plpgsql security definer set search_path = '' as $$
begin
  return 0;   -- lixeira de membros desligada (decisão do dono, 26/09): inativo não sai do clube
end;
$$;
revoke all on function public.lixeira_rotina() from public, anon, authenticated;
grant execute on function public.lixeira_rotina() to service_role;

create or replace function public._lixeira_arquivar(p_club uuid, p_user uuid, p_motivo text, p_inativo_desde timestamptz,
                                                    p_por uuid default null) returns uuid
language plpgsql security definer set search_path = '' as $$
begin
  raise exception 'A lixeira de membros foi desligada: membro inativo fica no clube, com o histórico.';
end;
$$;
revoke all on function public._lixeira_arquivar(uuid, uuid, text, timestamptz, uuid) from public, anon, authenticated;

create or replace function public._lixeira_expurgar(p_pacote uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  raise exception 'A lixeira de membros foi desligada: nada é expurgado.';
end;
$$;
revoke all on function public._lixeira_expurgar(uuid) from public, anon, authenticated;

drop function if exists public.admin_lixeira_config_definir(text, int, int, int);
drop function if exists public.admin_lixeira_clube_modo(uuid, text);
drop function if exists public.admin_lixeira_simular(uuid);

-- ---------------------------------------------------------------------------
-- 2) histórico por vínculo
-- ---------------------------------------------------------------------------
create table if not exists public.vinculo_historico (
  id bigint generated always as identity primary key,
  club_id uuid not null references public.organizational_units(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  acao text not null check (acao in ('inativado', 'reativado', 'suspenso', 'encerrado')),
  status_antes text,
  status_depois text not null,
  motivo_categoria text check (motivo_categoria in ('mudou_cidade_igreja', 'saiu_do_clube', 'idade_transferencia', 'faltas',
                                                    'disciplina', 'pedido_familia', 'outro', 'voltou_ao_clube', 'nao_informado')),
  motivo_texto text check (char_length(motivo_texto) <= 280),
  feito_por uuid references auth.users(id) on delete set null,
  em timestamptz not null default now()
);
create index if not exists idx_vinculo_historico_membro on public.vinculo_historico (club_id, user_id, em desc);
alter table public.vinculo_historico enable row level security;
revoke all on public.vinculo_historico from public, anon, authenticated;
comment on table public.vinculo_historico is
  'Linha do tempo de inativações/reativações por vínculo, com motivo (migration 310). Dado sensível do clube: só a diretoria lê, pelas RPCs.';

create or replace function public._vinculo_historico_registrar() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_acao text; v_cat text; v_txt text;
begin
  if new.status is not distinct from old.status then return new; end if;
  if old.status = 'ativo' and new.status in ('suspenso', 'encerrado') then
    v_acao := coalesce(nullif(current_setting('app.vinculo_acao', true), ''), new.status);
  elsif old.status = 'suspenso' and new.status = 'encerrado' then
    v_acao := 'encerrado';
  elsif old.status in ('suspenso', 'encerrado') and new.status = 'ativo' then
    v_acao := 'reativado';
  else
    return new;   -- pendente → ativo/encerrado é aprovação/recusa de cadastro, não inativação
  end if;
  v_cat := nullif(current_setting('app.vinculo_motivo_cat', true), '');
  v_txt := nullif(btrim(coalesce(current_setting('app.vinculo_motivo_txt', true), '')), '');
  insert into public.vinculo_historico (club_id, user_id, acao, status_antes, status_depois, motivo_categoria, motivo_texto, feito_por)
  values (new.organizational_unit_id, new.user_id, v_acao, old.status, new.status,
          case when v_cat is not null then v_cat when v_acao = 'reativado' then null else 'nao_informado' end,
          left(v_txt, 280), auth.uid());
  return new;
end;
$$;
revoke all on function public._vinculo_historico_registrar() from public, anon, authenticated;
drop trigger if exists trg_vinculo_historico on public.organization_memberships;
create trigger trg_vinculo_historico after update of status on public.organization_memberships
for each row execute function public._vinculo_historico_registrar();

-- vinculo_gerir: tirar um vínculo ATIVO exige motivo (vem de vinculo_inativar). Mesmo método da 210:
-- lê a definição VIVA e insere a checagem logo antes do UPDATE; falha se o ponto não for achado.
do $$
declare v_def text; v_novo text;
begin
  v_def := pg_get_functiondef('public.vinculo_gerir(uuid,text,text,uuid,boolean)'::regprocedure);
  if v_def like '%app.vinculo_motivo_cat%' then return; end if;
  v_novo := regexp_replace(v_def,
    '(\n\s*update public\.organization_memberships\s+set role = v_role)',
    E'\n  if v_status in (''suspenso'', ''encerrado'') and v_row.status = ''ativo''\n     and coalesce(current_setting(''app.vinculo_motivo_cat'', true), '''') = '''' then\n    raise exception ''Informe o motivo da inativação.'';\n  end if;\\1');
  if v_novo = v_def then raise exception 'historico-de-inativacao: ponto de inserção não achado em vinculo_gerir'; end if;
  execute v_novo;
end $$;

-- excluir_usuario: inativo não se apaga (fica no clube com o histórico)
do $$
declare v_def text; v_novo text;
begin
  v_def := pg_get_functiondef('public.excluir_usuario(uuid)'::regprocedure);
  if v_def like '%Membro inativo não é apagado%' then return; end if;
  v_novo := regexp_replace(v_def,
    '(raise exception ''Você não pode excluir a si mesmo\.'';\s*end if;)',
    E'\\1\n\n  if exists (select 1 from public.organization_memberships m\n              where m.user_id = p_id and m.organizational_unit_id = v_club\n                and (m.status = ''suspenso'' or (m.status = ''encerrado'' and exists (\n                     select 1 from public.vinculo_historico h where h.club_id = v_club and h.user_id = p_id)))) then\n    raise exception ''Membro inativo não é apagado: ele fica no clube como inativo, com todo o histórico.'';\n  end if;');
  if v_novo = v_def then raise exception 'historico-de-inativacao: ponto de inserção não achado em excluir_usuario'; end if;
  execute v_novo;
end $$;

-- ---------------------------------------------------------------------------
-- 3) RPCs da diretoria
-- ---------------------------------------------------------------------------
create or replace function public._vinculo_motivo_limpar() returns void
language sql security definer set search_path = '' as $$
  select set_config('app.vinculo_acao', '', true), set_config('app.vinculo_motivo_cat', '', true),
         set_config('app.vinculo_motivo_txt', '', true);
$$;
revoke all on function public._vinculo_motivo_limpar() from public, anon, authenticated;

create or replace function public.vinculo_inativar(p_user_id uuid, p_motivo_categoria text, p_motivo_texto text default null,
                                                   p_acao text default 'inativado') returns json
language plpgsql security definer set search_path = '' as $$
declare v_club uuid := public.clube_atual_id(); v_status_atual text; v_txt text := nullif(btrim(coalesce(p_motivo_texto, '')), '');
begin
  if auth.uid() is null or v_club is null then raise exception 'Sem clube em uso.'; end if;
  if not public.pode_administrar_clube(v_club) then raise exception 'Sem permissão (apenas a diretoria deste clube).'; end if;
  if p_acao not in ('inativado', 'suspenso', 'encerrado') then raise exception 'Ação inválida.'; end if;
  if p_motivo_categoria is null or p_motivo_categoria not in ('mudou_cidade_igreja', 'saiu_do_clube', 'idade_transferencia',
                                                              'faltas', 'disciplina', 'pedido_familia', 'outro') then
    raise exception 'Informe o motivo da inativação.';
  end if;
  if p_motivo_categoria = 'outro' and v_txt is null then raise exception 'Escreva o motivo (opção "Outro").'; end if;
  if char_length(v_txt) > 280 then raise exception 'Motivo muito longo (até 280 letras).'; end if;

  select status into v_status_atual from public.organization_memberships
   where user_id = p_user_id and organizational_unit_id = v_club order by created_at desc limit 1;
  if not found then raise exception 'Esta pessoa não tem vínculo com o clube em uso.'; end if;
  if not (v_status_atual = 'ativo' or (v_status_atual = 'suspenso' and p_acao = 'encerrado')) then
    raise exception 'Esta pessoa já não está ativa no clube.';
  end if;

  perform set_config('app.vinculo_acao', p_acao, true), set_config('app.vinculo_motivo_cat', p_motivo_categoria, true),
          set_config('app.vinculo_motivo_txt', coalesce(v_txt, ''), true);
  perform public.vinculo_gerir(p_user_id, null, case when p_acao = 'encerrado' then 'encerrado' else 'suspenso' end);
  perform public._vinculo_motivo_limpar();
  perform public._auditar('vinculo_inativado', v_club, p_user_id, jsonb_build_object('acao', p_acao, 'motivo', p_motivo_categoria));
  return json_build_object('ok', true, 'acao', p_acao);
end;
$$;

create or replace function public.vinculo_reativar(p_user_id uuid, p_motivo_categoria text default null, p_motivo_texto text default null) returns json
language plpgsql security definer set search_path = '' as $$
declare v_club uuid := public.clube_atual_id(); v_status_atual text; v_txt text := nullif(btrim(coalesce(p_motivo_texto, '')), '');
begin
  if auth.uid() is null or v_club is null then raise exception 'Sem clube em uso.'; end if;
  if not public.pode_administrar_clube(v_club) then raise exception 'Sem permissão (apenas a diretoria deste clube).'; end if;
  if p_motivo_categoria is not null and p_motivo_categoria not in ('voltou_ao_clube', 'outro') then raise exception 'Motivo inválido.'; end if;
  if char_length(v_txt) > 280 then raise exception 'Motivo muito longo (até 280 letras).'; end if;
  select status into v_status_atual from public.organization_memberships
   where user_id = p_user_id and organizational_unit_id = v_club order by created_at desc limit 1;
  if not found then raise exception 'Esta pessoa não tem vínculo com o clube em uso.'; end if;
  if v_status_atual not in ('suspenso', 'encerrado') then raise exception 'Esta pessoa não está inativa.'; end if;

  perform set_config('app.vinculo_motivo_cat', coalesce(p_motivo_categoria, case when v_txt is not null then 'outro' end, ''), true),
          set_config('app.vinculo_motivo_txt', coalesce(v_txt, ''), true);
  perform public.vinculo_gerir(p_user_id, null, 'ativo');
  perform public._vinculo_motivo_limpar();
  perform public._auditar('vinculo_reativado', v_club, p_user_id, jsonb_build_object('motivo', p_motivo_categoria));
  return json_build_object('ok', true);
end;
$$;

create or replace function public.vinculo_historico_listar(p_user_id uuid) returns json
language plpgsql stable security definer set search_path = '' as $$
declare v_club uuid := public.clube_atual_id();
begin
  if v_club is null or not public.pode_administrar_clube(v_club) then
    raise exception 'Sem permissão (apenas a diretoria deste clube).';
  end if;
  return coalesce((select json_agg(json_build_object(
      'id', h.id, 'acao', h.acao, 'status_antes', h.status_antes, 'status_depois', h.status_depois,
      'motivo_categoria', h.motivo_categoria, 'motivo_texto', h.motivo_texto, 'em', h.em,
      'feito_por_nome', p.nome) order by h.em desc, h.id desc)
    from public.vinculo_historico h left join public.profiles p on p.id = h.feito_por
   where h.club_id = v_club and h.user_id = p_user_id), '[]'::json);
end;
$$;

-- quem está inativo no clube em uso, desde quando e o último motivo
create or replace function public.membros_inativos() returns json
language plpgsql stable security definer set search_path = '' as $$
declare v_club uuid := public.clube_atual_id();
begin
  if v_club is null or not public.pode_administrar_clube(v_club) then
    raise exception 'Sem permissão (apenas a diretoria deste clube).';
  end if;
  return coalesce((select json_agg(x order by x.inativo_desde desc nulls last) from (
    select m.user_id, pr.nome, m.role as papel, m.status, m.inativo_desde,
           u.acao as ultima_acao, u.motivo_categoria, u.motivo_texto, u.em as motivo_em
      from (select distinct on (user_id) * from public.organization_memberships
             where organizational_unit_id = v_club order by user_id, created_at desc) m
      left join public.profiles pr on pr.id = m.user_id
      left join lateral (select h.acao, h.motivo_categoria, h.motivo_texto, h.em from public.vinculo_historico h
                          where h.club_id = v_club and h.user_id = m.user_id and h.acao <> 'reativado'
                          order by h.em desc, h.id desc limit 1) u on true
     where m.status = 'suspenso' or (m.status = 'encerrado' and u.acao is not null)) x), '[]'::json);
end;
$$;

do $$
declare f text;
begin
  foreach f in array array['vinculo_inativar(uuid, text, text, text)', 'vinculo_reativar(uuid, text, text)',
                           'vinculo_historico_listar(uuid)', 'membros_inativos()'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

notify pgrst, 'reload schema';

insert into public.migracoes_aplicadas (arquivo)
values ('2026-09-30-historico-de-inativacao.sql')
on conflict (arquivo) do update set aplicada_em = now();
