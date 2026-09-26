-- =============================================================================
--  Avaliação da visita da coordenação pelo clube (pedido do dono, 26/09).
--
--  "Nas visitas, o clube pode AVALIAR a visita e pôr uma observação; aí os da hierarquia acima
--   veem esse histórico."
--
--  REGRAS
--  - Quem avalia: a DIRETORIA ativa e vigente do próprio clube (public.pode_administrar_clube).
--  - Quando: a visita foi marcada como REALIZADA pelo coordenador, OU a data já passou há 12 horas
--    e o coordenador ainda não marcou (status agendada/confirmada) — o clube não fica refém do
--    relatório. Visita CANCELADA não se avalia.
--  - Uma avaliação por visita (PK = visita). Editável pela diretoria por 7 dias contados da
--    PRIMEIRA avaliação; depois fica congelada (histórico).
--  - Conteúdo: nota geral 1–5 (obrigatória); pontualidade, orientação/contribuição e relacionamento
--    1–5 (opcionais); observação até 600 caracteres.
--  - Quem LÊ: exatamente quem já lê a visita — a diretoria do clube (clube_visitas) e, pelo portal,
--    a unidade que agendou (o coordenador que visitou) e TODOS os níveis acima dela na árvore
--    (escopo_visitas: _hier_eh_ancestral_ou_igual + clube descendente do escopo). Distrital de
--    outro distrito, clube de outro clube, membro comum e o site público NÃO leem.
--  - Aviso: o coordenador que visitou (quem registrou o relatório; senão quem agendou) recebe
--    notificação pessoal (tabela notificacoes — o push existente dispara pelo gatilho dela). O sino lê pelo
--    clube em uso, então o aviso vai para um clube ativo do coordenador; sem clube, fica na unidade dele.
--
--  Tabela com RLS ligada e SEM policy: só as RPCs SECURITY DEFINER (search_path '') leem/escrevem.
--  Não altera linha existente. Idempotente.
-- =============================================================================

create table if not exists public.club_visit_ratings (
  visit_id uuid primary key references public.club_visits(id) on delete cascade,
  club_id uuid not null references public.organizational_units(id) on delete cascade,
  nota_geral smallint not null check (nota_geral between 1 and 5),
  nota_pontualidade smallint check (nota_pontualidade between 1 and 5),
  nota_orientacao smallint check (nota_orientacao between 1 and 5),
  nota_relacionamento smallint check (nota_relacionamento between 1 and 5),
  observacao text check (observacao is null or length(observacao) <= 600),
  avaliada_por uuid references auth.users(id) on delete set null,
  criada_em timestamptz not null default now(),
  atualizada_em timestamptz not null default now()
);
create index if not exists idx_club_visit_ratings_club on public.club_visit_ratings (club_id);
alter table public.club_visit_ratings enable row level security;
revoke all on public.club_visit_ratings from public, anon, authenticated;

-- a visita já pode ser avaliada? (regra única, usada no JSON e na RPC)
create or replace function public._visita_avaliavel(p_v public.club_visits) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_v.status = 'realizada'
      or (p_v.status in ('agendada', 'confirmada') and p_v.agendada_para <= now() - interval '12 hours');
$$;
revoke all on function public._visita_avaliavel(public.club_visits) from public, anon, authenticated;

-- JSON da visita: igual ao da migration 141 + 'avaliacao' e 'avaliavel'. A visibilidade não muda:
-- quem recebe este JSON já é quem pode ver a visita.
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
    'avaliavel', public._visita_avaliavel(p_v),
    'avaliacao', (select json_build_object(
                     'geral', r.nota_geral, 'pontualidade', r.nota_pontualidade,
                     'orientacao', r.nota_orientacao, 'relacionamento', r.nota_relacionamento,
                     'observacao', r.observacao, 'criada_em', r.criada_em, 'atualizada_em', r.atualizada_em,
                     'editavel_ate', r.criada_em + interval '7 days')
                    from public.club_visit_ratings r where r.visit_id = p_v.id),
    'criada_em', p_v.created_at);
$$;
revoke all on function public._visita_json(public.club_visits, boolean) from public, anon, authenticated;

-- diretoria avalia (cria ou edita dentro dos 7 dias)
create or replace function public.clube_visita_avaliar(p_id uuid, p_geral int, p_pontualidade int default null,
  p_orientacao int default null, p_relacionamento int default null, p_observacao text default null) returns json
language plpgsql security definer set search_path = '' as $$
declare v_v public.club_visits; v_r public.club_visit_ratings; v_obs text := nullif(btrim(coalesce(p_observacao, '')), '');
  v_nova boolean; v_para uuid; v_dest uuid;
begin
  select * into v_v from public.club_visits where id = p_id for update;
  -- visita de outro clube / inexistente / sem ser diretoria: mesma resposta
  if not found or auth.uid() is null or not public.pode_administrar_clube(v_v.club_id) then
    raise exception 'Visita não encontrada.';
  end if;
  if v_v.status = 'cancelada' then raise exception 'Visita cancelada não pode ser avaliada.'; end if;
  if not public._visita_avaliavel(v_v) then raise exception 'A visita ainda não aconteceu.'; end if;
  if p_geral is null or p_geral not between 1 and 5 then raise exception 'Dê uma nota geral de 1 a 5 estrelas.'; end if;
  if (p_pontualidade is not null and p_pontualidade not between 1 and 5)
     or (p_orientacao is not null and p_orientacao not between 1 and 5)
     or (p_relacionamento is not null and p_relacionamento not between 1 and 5) then
    raise exception 'As notas vão de 1 a 5 estrelas.';
  end if;
  if length(coalesce(v_obs, '')) > 600 then raise exception 'Observação muito longa (até 600 caracteres).'; end if;

  select * into v_r from public.club_visit_ratings where visit_id = p_id for update;
  v_nova := not found;
  if not v_nova and v_r.criada_em + interval '7 days' < now() then
    raise exception 'O prazo para editar esta avaliação (7 dias) terminou.';
  end if;

  if v_nova then
    insert into public.club_visit_ratings (visit_id, club_id, nota_geral, nota_pontualidade, nota_orientacao, nota_relacionamento,
                                           observacao, avaliada_por)
    values (p_id, v_v.club_id, p_geral, p_pontualidade, p_orientacao, p_relacionamento, v_obs, auth.uid());
  else
    update public.club_visit_ratings set nota_geral = p_geral, nota_pontualidade = p_pontualidade, nota_orientacao = p_orientacao,
           nota_relacionamento = p_relacionamento, observacao = v_obs, avaliada_por = auth.uid(), atualizada_em = now()
     where visit_id = p_id;
  end if;

  -- aviso pessoal ao coordenador que visitou (nunca derruba a avaliação)
  -- O sino do app lê pelo CLUBE em uso (policy: club_id = clube_atual_id()). Então o aviso vai para
  -- um clube ATIVO do coordenador, se ele tiver; senão fica na unidade institucional dele (o push
  -- sai pelo gatilho da tabela e o portal mostra a avaliação de qualquer jeito).
  v_para := coalesce(v_v.relatorio_por, v_v.agendada_por);
  v_dest := (select m.organizational_unit_id from public.organization_memberships m
               join public.organizational_units u on u.id = m.organizational_unit_id and u.type = 'clube'
              where m.user_id = v_para and m.status = 'ativo' and m.starts_at <= now() and (m.ends_at is null or m.ends_at > now())
              order by m.starts_at, m.created_at limit 1);
  if v_dest is null and public._tem_vinculo(v_para, v_v.escopo_id, true) then v_dest := v_v.escopo_id; end if;
  if v_para is not null and v_dest is not null then
    begin
      insert into public.notificacoes (club_id, titulo, corpo, tipo, link, para, para_usuario)
      values (v_dest, case when v_nova then '⭐ Sua visita foi avaliada' else '⭐ Avaliação de visita atualizada' end,
              left((select nome from public.organizational_units where id = v_v.club_id) || ' deu ' || p_geral
                   || ' de 5 estrelas à visita de ' || public._visita_quando_txt(v_v.club_id, v_v.agendada_para) || '.', 240),
              'visita', '/institucional', 'todos', v_para);
    exception when others then null;
    end;
  end if;

  return json_build_object('ok', true, 'nova', v_nova);
end;
$$;
revoke all on function public.clube_visita_avaliar(uuid, int, int, int, int, text) from public, anon;
grant execute on function public.clube_visita_avaliar(uuid, int, int, int, int, text) to authenticated;

notify pgrst, 'reload schema';

insert into public.migracoes_aplicadas (arquivo)
values ('2026-09-30-avaliacao-da-visita-pelo-clube.sql')
on conflict (arquivo) do update set aplicada_em = now();
