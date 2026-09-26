-- =============================================================================
--  Painel analítico por escopo (portal institucional).
--
--  escopo_painel_analitico(p_unidade)  → clubes DESCENDENTES do escopo em uso (derivado da árvore a cada
--  chamada: clube novo aparece sozinho; clube movido ou coordenador removido some na hora), com números
--  AGREGADOS por clube e totais. p_unidade (opcional) filtra por uma região/distrito DENTRO do escopo.
--    distrital → clubes do distrito; regional → todos os distritos da região; campo (geral, MDA,
--    secretário(a), associado(a), departamental) → toda a Associação/Missão.
--
--  O que sai (e só isto): nome e status do clube, distrito/região (nomes das unidades), contagens de
--  membros ativos por papel (sem "pais"), nº de unidades, matrículas por classe (em andamento /
--  concluídas / investidas), avaliações pendentes (contagem), atividade agregada (quantos membros usaram
--  em 7/30 dias, dia do último uso, envios em 30 dias), situação do cadastro/assinatura em rótulo simples
--  (sem valor, preço, fatura ou forma de pagamento), pendências (cadastros aguardando, pedido de região) e
--  a próxima visita agendada.
--
--  O que NUNCA sai: nome/foto de pessoa (criança, responsável ou líder — a migration 47 não expõe o
--  nome da diretoria no portal, então aqui também não), chat, mensagens, evidências, financeiro.
--  Nenhuma policy de RLS nova. SECURITY DEFINER com search_path ''. Não altera linha nenhuma. Idempotente.
-- =============================================================================

create or replace function public.escopo_painel_analitico(p_unidade uuid default null) returns json
language plpgsql stable security definer set search_path = '' as $$
declare v_e record; v_base uuid; v_u public.organizational_units; v_res json;
begin
  -- gate: sessão + escopo_atual_id() (vínculo ATIVO na unidade pedida no header) + papel com painel
  if auth.uid() is null then
    return json_build_object('sem_escopo', true, 'clubes', '[]'::json);
  end if;
  select * into v_e from public._escopo_em_uso_com_painel();
  if v_e.escopo is null then
    return json_build_object('sem_escopo', true, 'clubes', '[]'::json);
  end if;
  v_base := v_e.escopo;
  if p_unidade is not null then
    select * into v_u from public.organizational_units where id = p_unidade;
    if not found or v_u.type = 'clube' or not public._hier_eh_ancestral_ou_igual(v_e.escopo, p_unidade) then
      raise exception 'Unidade fora do seu escopo.';
    end if;
    v_base := p_unidade;
  end if;

  with recursive
  desce as (   -- todas as unidades do escopo (para o filtro), sem clubes
    select id, parent_id, type, nome, status, 0 as prof from public.organizational_units where id = v_e.escopo
    union all
    select o.id, o.parent_id, o.type, o.nome, o.status, d.prof + 1
      from public.organizational_units o join desce d on o.parent_id = d.id
     where o.type <> 'clube' and d.prof < 12
  ),
  cl as (
    select c.id, c.nome, c.status, c.parent_id
      from public.organizational_units c
     where c.type = 'clube' and c.id in (select club_id from public._clubes_descendentes(v_base))
  ),
  mem as (
    select m.organizational_unit_id as club_id, m.role, m.user_id
      from public.organization_memberships m join cl on cl.id = m.organizational_unit_id
     where m.status = 'ativo' and m.role <> 'pais'
       and m.starts_at <= now() and (m.ends_at is null or m.ends_at > now())
  ),
  uso as (   -- por membro: último login e último envio de requisito NESTE clube
    select mem.club_id, mem.user_id,
           au.last_sign_in_at as login,
           (select max(s.enviado_em) from public.requirement_submissions s
             where s.club_id = mem.club_id and s.usuario_id = mem.user_id) as envio
      from mem left join auth.users au on au.id = mem.user_id
  ),
  linhas as (
    select cl.*,
      (select count(*) from mem where mem.club_id = cl.id) as membros,
      (select count(*) from public.unidades un where un.club_id = cl.id) as unidades,
      (select count(*) from public.member_classes mc where mc.club_id = cl.id and mc.status = 'em_andamento') as cl_and,
      (select count(*) from public.member_classes mc where mc.club_id = cl.id
         and mc.status in ('requisitos_concluidos', 'aguardando_revisao', 'apto_investidura')) as cl_conc,
      (select count(*) from public.member_classes mc where mc.club_id = cl.id and mc.status = 'investida') as cl_inv,
      (select count(*) from public.member_requirements r where r.club_id = cl.id and r.status = 'aguardando_avaliacao')
        + (select count(*) from public.member_specialty_requirements r where r.club_id = cl.id and r.status = 'aguardando_avaliacao') as aval,
      (select count(*) from uso where uso.club_id = cl.id and greatest(uso.login, uso.envio) > now() - interval '7 days') as ativos_7d,
      (select count(*) from uso where uso.club_id = cl.id and greatest(uso.login, uso.envio) > now() - interval '30 days') as ativos_30d,
      (select max(greatest(uso.login, uso.envio)) from uso where uso.club_id = cl.id) as ultimo_uso,
      (select count(*) from public.requirement_submissions s where s.club_id = cl.id and s.enviado_em > now() - interval '30 days') as envios_30d,
      (select count(*) from public.organization_memberships m where m.organizational_unit_id = cl.id
         and m.status = 'pendente' and m.ends_at is null) as cad_pend,
      exists (select 1 from public.club_hierarchy_requests r where r.club_id = cl.id and r.status = 'pendente') as pedido_regiao,
      (select s.status from public.subscription_clubs sc join public.subscriptions s on s.id = sc.subscription_id
        where sc.club_id = cl.id order by (s.status <> 'cancelada') desc, sc.incluido_em desc limit 1) as assin_status,
      (select coalesce(case when s.status = 'trial' then s.trial_ate end, s.periodo_fim)
         from public.subscription_clubs sc join public.subscriptions s on s.id = sc.subscription_id
        where sc.club_id = cl.id order by (s.status <> 'cancelada') desc, sc.incluido_em desc limit 1) as assin_ate,
      (select min(v.agendada_para) from public.club_visits v where v.club_id = cl.id
         and v.status in ('agendada', 'confirmada') and v.agendada_para >= now() - interval '12 hours') as prox_visita,
      public.unidade_ancestral(cl.id, 'distrito') as distrito_id,
      public.unidade_ancestral(cl.id, 'regiao') as regiao_id
    from cl
  )
  select json_build_object(
    'escopo', (select json_build_object('id', u.id, 'nome', u.nome, 'tipo', u.type, 'papel', v_e.papel)
                 from public.organizational_units u where u.id = v_e.escopo),
    'filtro', (select json_build_object('id', u.id, 'nome', u.nome, 'tipo', u.type) from public.organizational_units u
                where u.id = p_unidade),
    'filtros', coalesce((select json_agg(json_build_object('id', d.id, 'nome', d.nome, 'tipo', d.type, 'parent_id', d.parent_id)
                                         order by public._hier_nivel(d.type), d.nome)
                           from desce d where d.id <> v_e.escopo and d.type in ('campo', 'regiao', 'distrito') and d.status = 'ativo'), '[]'::json),
    'clubes', coalesce((select json_agg(json_build_object(
        'club_id', l.id, 'nome', l.nome, 'status', l.status,
        'distrito', (select json_build_object('id', u.id, 'nome', u.nome) from public.organizational_units u where u.id = l.distrito_id),
        'regiao', (select json_build_object('id', u.id, 'nome', u.nome) from public.organizational_units u where u.id = l.regiao_id),
        'membros', json_build_object('total', l.membros,
            'por_papel', coalesce((select json_object_agg(x.role, x.n) from (
                select role, count(*) as n from mem where mem.club_id = l.id group by role) x), '{}'::json)),
        'unidades', l.unidades,
        'classes', json_build_object('em_andamento', l.cl_and, 'concluidas', l.cl_conc, 'investidas', l.cl_inv,
            'por_classe', coalesce((select json_agg(json_build_object('classe', x.nome, 'em_andamento', x.a, 'concluidas', x.c, 'investidas', x.i)
                                                    order by x.ordem nulls last, x.nome) from (
                select cls.nome, min(cls.ordem) as ordem,
                       count(*) filter (where mc.status = 'em_andamento') as a,
                       count(*) filter (where mc.status in ('requisitos_concluidos', 'aguardando_revisao', 'apto_investidura')) as c,
                       count(*) filter (where mc.status = 'investida') as i
                  from public.member_classes mc join public.classes cls on cls.id = mc.class_id
                 where mc.club_id = l.id and mc.status <> 'cancelada'
                 group by cls.nome) x), '[]'::json)),
        'avaliacoes_pendentes', l.aval,
        'atividade', json_build_object('ativos_7d', l.ativos_7d, 'ativos_30d', l.ativos_30d,
                                       'ultimo_uso', (l.ultimo_uso at time zone 'America/Sao_Paulo')::date, 'envios_30d', l.envios_30d),
        'cadastro', json_build_object('status_clube', l.status,
            'assinatura', case l.assin_status when 'trial' then 'teste' when 'ativa' then 'ativa'
                               when 'pagamento_pendente' then 'pendente' when 'inadimplente' then 'pendente'
                               when 'suspensa' then 'suspensa' when 'cancelada' then 'cancelada' else 'sem_assinatura' end,
            'valida_ate', (l.assin_ate at time zone 'America/Sao_Paulo')::date),
        'pendencias', json_build_object('cadastros', l.cad_pend, 'pedido_regiao', l.pedido_regiao),
        'proxima_visita', l.prox_visita
      ) order by l.nome) from linhas l), '[]'::json),
    'totais', (select json_build_object(
        'clubes', count(*), 'membros', coalesce(sum(membros), 0), 'unidades', coalesce(sum(unidades), 0),
        'classes_em_andamento', coalesce(sum(cl_and), 0), 'classes_concluidas', coalesce(sum(cl_conc), 0),
        'classes_investidas', coalesce(sum(cl_inv), 0), 'avaliacoes_pendentes', coalesce(sum(aval), 0),
        'ativos_30d', coalesce(sum(ativos_30d), 0), 'cadastros_pendentes', coalesce(sum(cad_pend), 0),
        'visitas_agendadas', count(prox_visita),
        'por_papel', coalesce((select json_object_agg(x.role, x.n) from (select role, count(*) as n from mem group by role) x), '{}'::json))
      from linhas)
  ) into v_res;
  return v_res;
end;
$$;
revoke all on function public.escopo_painel_analitico(uuid) from public, anon;
grant execute on function public.escopo_painel_analitico(uuid) to authenticated;

notify pgrst, 'reload schema';

insert into public.migracoes_aplicadas (arquivo)
values ('2026-09-30-painel-analitico-por-escopo.sql')
on conflict (arquivo) do update set aplicada_em = now();
