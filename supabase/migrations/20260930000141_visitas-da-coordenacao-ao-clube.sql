-- =============================================================================
--  Visitas da coordenação ao clube.
--
--  - Quem está num escopo institucional (distrito/região/campo/união/divisão, vínculo ATIVO, escopo em uso
--    pelo header x-escopo-atual) agenda visita a um clube DESCENDENTE desse escopo (data/hora, objetivo,
--    observação). Acesso sempre derivado da árvore NA HORA: tirar o coordenador da unidade (vínculo
--    encerrado) ou mover o clube para fora corta tudo.
--  - A diretoria do clube vê as visitas do seu clube, confirma ou sugere outra data.
--  - Status: agendada → confirmada → realizada | cancelada. Depois de realizada, relatório curto (texto).
--  - Quem vê cada visita: a unidade que agendou (qualquer coordenador ativo dela), os níveis ACIMA dela
--    (desde que o clube esteja no escopo deles) e a diretoria do clube. Um nível ABAIXO de quem agendou
--    não vê (ex.: o distrital não lê o relatório de visita do regional).
--  - Só quem agendou (a mesma unidade) reagenda, cancela ou registra a realização.
--  - Aviso para a liderança do clube pela tabela notificacoes (mecanismo existente — o push que já
--    existe dispara pelo gatilho dela). Nenhum push novo.
--
--  Nada aqui expõe dado de criança/responsável, chat, foto, evidência ou financeiro. O nome do
--  coordenador (adulto, autoridade que agenda) aparece para a diretoria do clube — é quem vai visitar.
--  Tabela com RLS ligada e SEM policy: só as RPCs SECURITY DEFINER (search_path '') leem/escrevem.
--  Não altera nenhuma linha existente. Idempotente.
-- =============================================================================

create table if not exists public.club_visits (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.organizational_units(id) on delete cascade,
  escopo_id uuid not null references public.organizational_units(id) on delete cascade,  -- unidade que agendou
  agendada_por uuid references auth.users(id) on delete set null,
  papel text not null,
  agendada_para timestamptz not null,
  objetivo text not null check (length(btrim(objetivo)) between 3 and 200),
  observacao text check (observacao is null or length(observacao) <= 1000),
  status text not null default 'agendada' check (status in ('agendada', 'confirmada', 'realizada', 'cancelada')),
  sugestao_para timestamptz,
  sugestao_obs text check (sugestao_obs is null or length(sugestao_obs) <= 500),
  respondida_por uuid references auth.users(id) on delete set null,
  respondida_em timestamptz,
  motivo_cancelamento text check (motivo_cancelamento is null or length(motivo_cancelamento) <= 500),
  cancelada_por uuid references auth.users(id) on delete set null,
  relatorio text check (relatorio is null or length(relatorio) <= 4000),
  realizada_em timestamptz,
  relatorio_por uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_club_visits_club on public.club_visits (club_id, agendada_para desc);
create index if not exists idx_club_visits_escopo on public.club_visits (escopo_id, agendada_para desc);
alter table public.club_visits enable row level security;
revoke all on public.club_visits from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- helpers
-- ---------------------------------------------------------------------------
-- p_anc é p_unit ou está acima dele na árvore?
create or replace function public._hier_eh_ancestral_ou_igual(p_anc uuid, p_unit uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  with recursive sobe as (
    select id, parent_id, 0 as prof from public.organizational_units where id = p_unit
    union all
    select o.id, o.parent_id, s.prof + 1 from public.organizational_units o join sobe s on o.id = s.parent_id
    where s.prof < 12
  )
  select p_anc is not null and exists (select 1 from sobe where id = p_anc);
$$;
revoke all on function public._hier_eh_ancestral_ou_igual(uuid, uuid) from public, anon, authenticated;

-- escopo em uso + papel com capacidade de painel (null = sem acesso). Derivado a cada chamada.
create or replace function public._escopo_em_uso_com_painel(out escopo uuid, out papel text)
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := auth.uid();
begin
  escopo := public.escopo_atual_id();
  if v_uid is null or escopo is null then escopo := null; return; end if;
  select m.role into papel from public.organization_memberships m
   where m.user_id = v_uid and m.organizational_unit_id = escopo and m.status = 'ativo'
     and m.starts_at <= now() and (m.ends_at is null or m.ends_at > now())
   order by m.created_at limit 1;
  if papel is null or not coalesce((public._capacidades_institucionais(papel) ->> 'ver_painel')::boolean, false) then
    escopo := null; papel := null;
  end if;
end;
$$;
revoke all on function public._escopo_em_uso_com_painel() from public, anon, authenticated;

create or replace function public._visita_json(p_v public.club_visits, p_pode_editar boolean) returns json
language sql stable security definer set search_path = '' as $$
  select json_build_object(
    'id', p_v.id, 'club_id', p_v.club_id,
    'clube', (select nome from public.organizational_units where id = p_v.club_id),
    'agendada_para', p_v.agendada_para, 'objetivo', p_v.objetivo, 'observacao', p_v.observacao, 'status', p_v.status,
    'sugestao', case when p_v.sugestao_para is not null
                     then json_build_object('para', p_v.sugestao_para, 'obs', p_v.sugestao_obs) end,
    'respondida_em', p_v.respondida_em,
    'motivo_cancelamento', p_v.motivo_cancelamento,
    'relatorio', p_v.relatorio, 'realizada_em', p_v.realizada_em,
    'agendada_por', json_build_object(
        'nome', (select nome from public.profiles where id = p_v.agendada_por), 'papel', p_v.papel,
        'unidade', (select json_build_object('id', u.id, 'nome', u.nome, 'tipo', u.type)
                      from public.organizational_units u where u.id = p_v.escopo_id)),
    'pode_editar', p_pode_editar,
    'criada_em', p_v.created_at);
$$;
revoke all on function public._visita_json(public.club_visits, boolean) from public, anon, authenticated;

create or replace function public._visita_avisar_clube(p_v public.club_visits, p_titulo text, p_corpo text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.notificacoes (titulo, corpo, tipo, link, para, club_id)
  values (p_titulo, left(p_corpo, 300), 'visita', '/visitas', 'lideranca', p_v.club_id);
end;
$$;
revoke all on function public._visita_avisar_clube(public.club_visits, text, text) from public, anon, authenticated;

create or replace function public._visita_quando_txt(p_club uuid, p_quando timestamptz) returns text
language sql stable security definer set search_path = '' as $$
  select to_char(p_quando at time zone coalesce((select nullif(timezone, '') from public.organizational_units where id = p_club),
                                                'America/Sao_Paulo'), 'DD/MM "às" HH24:MI');
$$;
revoke all on function public._visita_quando_txt(uuid, timestamptz) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- COORDENAÇÃO
-- ---------------------------------------------------------------------------
create or replace function public.escopo_visitas(p_club_id uuid default null) returns json
language plpgsql stable security definer set search_path = '' as $$
declare v_e record;
begin
  if auth.uid() is null then return '[]'::json; end if;
  -- gate: escopo_atual_id() (vínculo ATIVO na unidade pedida no header) + papel com painel
  select * into v_e from public._escopo_em_uso_com_painel();
  if v_e.escopo is null then return '[]'::json; end if;
  return coalesce((
    select json_agg(public._visita_json(v, v.escopo_id = v_e.escopo)
                    order by (v.status in ('agendada', 'confirmada')) desc,
                             case when v.status in ('agendada', 'confirmada') then v.agendada_para end asc,
                             v.agendada_para desc)
      from public.club_visits v
     where v.club_id in (select club_id from public._clubes_descendentes(v_e.escopo))
       and public._hier_eh_ancestral_ou_igual(v_e.escopo, v.escopo_id)
       and (p_club_id is null or v.club_id = p_club_id)), '[]'::json);
end;
$$;

create or replace function public.escopo_visita_agendar(p_club_id uuid, p_quando timestamptz, p_objetivo text,
  p_observacao text default null) returns json
language plpgsql security definer set search_path = '' as $$
declare v_e record; v_v public.club_visits; v_obj text := btrim(coalesce(p_objetivo, ''));
begin
  select * into v_e from public._escopo_em_uso_com_painel();
  if v_e.escopo is null then raise exception 'Sem permissão (escolha um escopo de coordenação ativo).'; end if;
  if p_club_id is null or not exists (select 1 from public._clubes_descendentes(v_e.escopo) d where d.club_id = p_club_id) then
    raise exception 'Este clube não está no seu escopo.';
  end if;
  if p_quando is null or p_quando < now() - interval '1 hour' then raise exception 'Escolha uma data e hora futuras.'; end if;
  if p_quando > now() + interval '400 days' then raise exception 'Data muito distante.'; end if;
  if length(v_obj) < 3 or length(v_obj) > 200 then raise exception 'Objetivo inválido (3 a 200 caracteres).'; end if;
  if length(coalesce(p_observacao, '')) > 1000 then raise exception 'Observação muito longa (até 1000 caracteres).'; end if;
  insert into public.club_visits (club_id, escopo_id, agendada_por, papel, agendada_para, objetivo, observacao)
  values (p_club_id, v_e.escopo, auth.uid(), v_e.papel, p_quando, v_obj, nullif(btrim(p_observacao), ''))
  returning * into v_v;
  perform public._visita_avisar_clube(v_v, '📅 Visita da coordenação',
    (select nome from public.organizational_units where id = v_e.escopo) || ' agendou uma visita para '
      || public._visita_quando_txt(p_club_id, p_quando) || ': ' || v_obj || '. Confirme ou sugira outra data.');
  return json_build_object('ok', true, 'id', v_v.id, 'status', v_v.status);
end;
$$;

-- p_acao: 'reagendar' (p_quando), 'cancelar' (p_texto = motivo), 'realizada' (p_texto = relatório)
create or replace function public.escopo_visita_atualizar(p_id uuid, p_acao text, p_quando timestamptz default null,
  p_texto text default null) returns json
language plpgsql security definer set search_path = '' as $$
declare v_e record; v_v public.club_visits; v_txt text := nullif(btrim(coalesce(p_texto, '')), '');
begin
  select * into v_e from public._escopo_em_uso_com_painel();
  if v_e.escopo is null then raise exception 'Sem permissão (escolha um escopo de coordenação ativo).'; end if;
  select * into v_v from public.club_visits where id = p_id for update;
  -- visita de outra unidade, ou de clube que saiu do escopo: mesma resposta de "não existe"
  if not found or v_v.escopo_id <> v_e.escopo
     or not exists (select 1 from public._clubes_descendentes(v_e.escopo) d where d.club_id = v_v.club_id) then
    raise exception 'Visita não encontrada.';
  end if;
  if v_v.status in ('realizada', 'cancelada') then raise exception 'Esta visita já foi %.', v_v.status; end if;

  if p_acao = 'reagendar' then
    if p_quando is null or p_quando < now() - interval '1 hour' then raise exception 'Escolha uma data e hora futuras.'; end if;
    if p_quando > now() + interval '400 days' then raise exception 'Data muito distante.'; end if;
    update public.club_visits set agendada_para = p_quando, status = 'agendada', sugestao_para = null, sugestao_obs = null,
           observacao = coalesce(v_txt, observacao), updated_at = now()
     where id = p_id returning * into v_v;
    perform public._visita_avisar_clube(v_v, '📅 Visita remarcada',
      'Nova data da visita da coordenação: ' || public._visita_quando_txt(v_v.club_id, p_quando) || '. Confirme no app.');
  elsif p_acao = 'cancelar' then
    if length(coalesce(v_txt, '')) > 500 then raise exception 'Motivo muito longo (até 500 caracteres).'; end if;
    update public.club_visits set status = 'cancelada', motivo_cancelamento = v_txt, cancelada_por = auth.uid(), updated_at = now()
     where id = p_id returning * into v_v;
    perform public._visita_avisar_clube(v_v, '📅 Visita cancelada',
      'A visita da coordenação de ' || public._visita_quando_txt(v_v.club_id, v_v.agendada_para) || ' foi cancelada.'
        || coalesce(' Motivo: ' || v_txt, ''));
  elsif p_acao = 'realizada' then
    if length(coalesce(v_txt, '')) < 10 then raise exception 'Escreva um relatório curto da visita (mínimo 10 caracteres).'; end if;
    if length(v_txt) > 4000 then raise exception 'Relatório muito longo (até 4000 caracteres).'; end if;
    if v_v.agendada_para > now() + interval '1 day' then raise exception 'A visita ainda não aconteceu.'; end if;
    update public.club_visits set status = 'realizada', relatorio = v_txt, realizada_em = now(), relatorio_por = auth.uid(), updated_at = now()
     where id = p_id returning * into v_v;
    perform public._visita_avisar_clube(v_v, '📝 Relatório de visita', 'O relatório da visita da coordenação já está disponível.');
  else
    raise exception 'Ação inválida.';
  end if;
  return json_build_object('ok', true, 'status', v_v.status);
end;
$$;

-- ---------------------------------------------------------------------------
-- DIRETORIA DO CLUBE
-- ---------------------------------------------------------------------------
create or replace function public.clube_visitas(p_club_id uuid) returns json
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or not public._hier_eh_diretoria(auth.uid(), p_club_id) then
    raise exception 'Sem permissão (apenas a diretoria deste clube).';
  end if;
  return coalesce((
    select json_agg(public._visita_json(v, false)
                    order by (v.status in ('agendada', 'confirmada')) desc,
                             case when v.status in ('agendada', 'confirmada') then v.agendada_para end asc,
                             v.agendada_para desc)
      from public.club_visits v where v.club_id = p_club_id), '[]'::json);
end;
$$;

-- confirmar (p_confirmar = true) ou sugerir outra data (p_confirmar = false + p_sugestao)
create or replace function public.clube_visita_responder(p_id uuid, p_confirmar boolean, p_sugestao timestamptz default null,
  p_obs text default null) returns json
language plpgsql security definer set search_path = '' as $$
declare v_v public.club_visits; v_obs text := nullif(btrim(coalesce(p_obs, '')), '');
begin
  select * into v_v from public.club_visits where id = p_id for update;
  if not found or auth.uid() is null or not public._hier_eh_diretoria(auth.uid(), v_v.club_id) then
    raise exception 'Visita não encontrada.';
  end if;
  if v_v.status not in ('agendada', 'confirmada') then raise exception 'Esta visita já foi %.', v_v.status; end if;
  if length(coalesce(v_obs, '')) > 500 then raise exception 'Observação muito longa (até 500 caracteres).'; end if;
  if p_confirmar then
    update public.club_visits set status = 'confirmada', sugestao_para = null, sugestao_obs = v_obs,
           respondida_por = auth.uid(), respondida_em = now(), updated_at = now()
     where id = p_id returning * into v_v;
  else
    if p_sugestao is null or p_sugestao < now() then raise exception 'Sugira uma data e hora futuras.'; end if;
    if p_sugestao > now() + interval '400 days' then raise exception 'Data muito distante.'; end if;
    update public.club_visits set status = 'agendada', sugestao_para = p_sugestao, sugestao_obs = v_obs,
           respondida_por = auth.uid(), respondida_em = now(), updated_at = now()
     where id = p_id returning * into v_v;
  end if;
  return json_build_object('ok', true, 'status', v_v.status);
end;
$$;

do $$
declare f text;
begin
  foreach f in array array['escopo_visitas(uuid)', 'escopo_visita_agendar(uuid, timestamptz, text, text)',
                           'escopo_visita_atualizar(uuid, text, timestamptz, text)', 'clube_visitas(uuid)',
                           'clube_visita_responder(uuid, boolean, timestamptz, text)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

notify pgrst, 'reload schema';

insert into public.migracoes_aplicadas (arquivo)
values ('2026-09-30-visitas-da-coordenacao-ao-clube.sql')
on conflict (arquivo) do update set aplicada_em = now();
