-- =============================================================================
--  Portal da coordenação: acompanhamento de verdade, SEM informação comercial (26/09).
--
--  Feedback do dono (print do coordenador real): o coordenador via "Em teste", "Sem assinatura",
--  plano... — isso não é informação para ele. E não conseguia acompanhar o clube.
--
--  1) escopo_painel_analitico(p_unidade) — mesma assinatura, mesma checagem de escopo
--     (_escopo_em_uso_com_painel + filtro só DENTRO do escopo), mesmos grants. Mudanças:
--       SAI   'cadastro' {assinatura, valida_ate} — nada de assinatura/plano/trial/cobrança no retorno.
--       ENTRA 'marca' {logo_url, sigla, cor} (pública: já aparece no convite/inscrição),
--             'atividade.dias_sem_uso', 'presenca' {media_pct_30d, reunioes_30d} e
--             'investiduras' {previstas, realizadas_mes}; totais ganham destaques
--             (clubes_sem_atividade_14d, clubes_avaliacoes_acumuladas, investiduras_mes, presenca_media_pct).
--  2) escopo_clube_detalhe(p_club_id) — NOVA. A página do clube na visão da coordenação.
--     Mesmo gate; clube fora do escopo e clube inexistente dão a MESMA resposta ("Clube não encontrado.").
--     Só agregado: membros por papel, unidades (quantidade e NOME da unidade — dado institucional),
--     classes por classe (regular/avançada), avaliações pendentes, cadastros aguardando, presença
--     (chamada = Apontamento: pontos.origem='apontamento', marca.presenca) em percentuais/contagens
--     por dia de reunião, atividade 7/30 dias, agenda (ver abaixo), investiduras e tendência mês a mês.
--
--  AGENDA: public.eventos NÃO tem marcação de "público/institucional". Por isso o portal NÃO recebe
--  título, local nem descrição de evento do clube — só a data do próximo evento e quantos há nos
--  próximos 30 dias. Se um dia existir a marcação, os títulos dos marcados podem entrar aqui.
--
--  NUNCA sai: nome/foto de pessoa do clube, chat, mensagens, evidências, pedidos de oração, caixa,
--  financeiro, responsáveis, contatos, plano, assinatura, limites, armazenamento.
--  Nenhuma policy nova. SECURITY DEFINER com search_path ''. Não altera linha nenhuma. Idempotente.
-- =============================================================================

-- ---------- helper: presença de uma chamada (mesma regra do Cantinho, migration 260) ----------
create or replace function public._apontamento_presente(p_marca jsonb, p_pontos numeric) returns boolean
language sql immutable set search_path = '' as $$
  select coalesce(p_marca ->> 'presenca', case when coalesce(p_pontos, 0) > 0 then 'naHora' else 'faltou' end) <> 'faltou';
$$;
revoke all on function public._apontamento_presente(jsonb, numeric) from public, anon, authenticated;

-- ---------- 1) painel do escopo (sem comercial) ----------
create or replace function public.escopo_painel_analitico(p_unidade uuid default null) returns json
language plpgsql stable security definer set search_path = '' as $$
declare v_e record; v_base uuid; v_u public.organizational_units; v_res json;
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_mes date := date_trunc('month', (now() at time zone 'America/Sao_Paulo'))::date;
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
    select c.id, c.nome, c.status, c.parent_id, c.metadata
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
  ap as (    -- chamadas (Apontamento) dos últimos 30 dias, só contagem
    select p.club_id, (p.data at time zone 'America/Sao_Paulo')::date as dia,
           public._apontamento_presente(p.marca, p.pontos) as presente
      from public.pontos p join cl on cl.id = p.club_id
     where p.origem = 'apontamento' and p.data > now() - interval '30 days'
  ),
  linhas as (
    select cl.*,
      (select count(*) from mem where mem.club_id = cl.id) as membros,
      (select count(*) from public.unidades un where un.club_id = cl.id) as unidades,
      (select count(*) from public.member_classes mc where mc.club_id = cl.id and mc.status = 'em_andamento') as cl_and,
      (select count(*) from public.member_classes mc where mc.club_id = cl.id
         and mc.status in ('requisitos_concluidos', 'aguardando_revisao', 'apto_investidura')) as cl_conc,
      (select count(*) from public.member_classes mc where mc.club_id = cl.id and mc.status = 'investida') as cl_inv,
      (select count(*) from public.member_classes mc where mc.club_id = cl.id and mc.status = 'apto_investidura') as inv_prev,
      (select count(*) from public.class_investitures ci where ci.club_id = cl.id and ci.status = 'registrada'
         and ci.data_investidura >= v_mes and ci.data_investidura <= v_hoje) as inv_mes,
      (select count(*) from public.member_requirements r where r.club_id = cl.id and r.status = 'aguardando_avaliacao')
        + (select count(*) from public.member_specialty_requirements r where r.club_id = cl.id and r.status = 'aguardando_avaliacao') as aval,
      (select count(*) from uso where uso.club_id = cl.id and greatest(uso.login, uso.envio) > now() - interval '7 days') as ativos_7d,
      (select count(*) from uso where uso.club_id = cl.id and greatest(uso.login, uso.envio) > now() - interval '30 days') as ativos_30d,
      (select max(greatest(uso.login, uso.envio)) from uso where uso.club_id = cl.id) as ultimo_uso,
      (select count(*) from public.requirement_submissions s where s.club_id = cl.id and s.enviado_em > now() - interval '30 days') as envios_30d,
      (select count(*) from public.organization_memberships m where m.organizational_unit_id = cl.id
         and m.status = 'pendente' and m.ends_at is null) as cad_pend,
      exists (select 1 from public.club_hierarchy_requests r where r.club_id = cl.id and r.status = 'pendente') as pedido_regiao,
      (select count(distinct ap.dia) from ap where ap.club_id = cl.id) as reunioes_30d,
      (select round(100.0 * count(*) filter (where ap.presente) / nullif(count(*), 0)) from ap where ap.club_id = cl.id) as presenca_pct,
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
        'marca', json_build_object('logo_url', nullif(l.metadata #>> '{marca,logo_url}', ''),
                                   'sigla', nullif(l.metadata #>> '{marca,sigla}', ''),
                                   'cor', nullif(l.metadata #>> '{marca,cor_primaria}', '')),
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
        'investiduras', json_build_object('previstas', l.inv_prev, 'realizadas_mes', l.inv_mes),
        'atividade', json_build_object('ativos_7d', l.ativos_7d, 'ativos_30d', l.ativos_30d,
                                       'ultimo_uso', (l.ultimo_uso at time zone 'America/Sao_Paulo')::date,
                                       'dias_sem_uso', case when l.ultimo_uso is not null
                                                            then v_hoje - (l.ultimo_uso at time zone 'America/Sao_Paulo')::date end,
                                       'envios_30d', l.envios_30d),
        'presenca', json_build_object('media_pct_30d', l.presenca_pct, 'reunioes_30d', l.reunioes_30d),
        'pendencias', json_build_object('cadastros', l.cad_pend, 'pedido_regiao', l.pedido_regiao),
        'proxima_visita', l.prox_visita
      ) order by l.nome) from linhas l), '[]'::json),
    'totais', (select json_build_object(
        'clubes', count(*), 'membros', coalesce(sum(membros), 0), 'unidades', coalesce(sum(unidades), 0),
        'classes_em_andamento', coalesce(sum(cl_and), 0), 'classes_concluidas', coalesce(sum(cl_conc), 0),
        'classes_investidas', coalesce(sum(cl_inv), 0), 'avaliacoes_pendentes', coalesce(sum(aval), 0),
        'ativos_30d', coalesce(sum(ativos_30d), 0), 'cadastros_pendentes', coalesce(sum(cad_pend), 0),
        'visitas_agendadas', count(prox_visita),
        'investiduras_previstas', coalesce(sum(inv_prev), 0), 'investiduras_mes', coalesce(sum(inv_mes), 0),
        'clubes_sem_atividade_14d', count(*) filter (where ultimo_uso is null or ultimo_uso < now() - interval '14 days'),
        'clubes_avaliacoes_acumuladas', count(*) filter (where aval >= 10),
        'presenca_media_pct', round(avg(presenca_pct)),
        'por_papel', coalesce((select json_object_agg(x.role, x.n) from (select role, count(*) as n from mem group by role) x), '{}'::json))
      from linhas)
  ) into v_res;
  return v_res;
end;
$$;
revoke all on function public.escopo_painel_analitico(uuid) from public, anon;
grant execute on function public.escopo_painel_analitico(uuid) to authenticated;

-- ---------- 2) página do clube na visão da coordenação ----------
create or replace function public.escopo_clube_detalhe(p_club_id uuid) returns json
language plpgsql stable security definer set search_path = '' as $$
declare v_e record; v_c public.organizational_units; v_res json;
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_mes date := date_trunc('month', (now() at time zone 'America/Sao_Paulo'))::date;
  v_mes_ant date := (date_trunc('month', (now() at time zone 'America/Sao_Paulo')) - interval '1 month')::date;
begin
  select * into v_e from public._escopo_em_uso_com_painel();
  if auth.uid() is null or v_e.escopo is null then raise exception 'Sem permissão (escolha um escopo de coordenação ativo).'; end if;
  -- fora do escopo e inexistente: MESMA resposta (não vira oráculo de UUID)
  if p_club_id is null or not exists (select 1 from public._clubes_descendentes(v_e.escopo) d where d.club_id = p_club_id) then
    raise exception 'Clube não encontrado.';
  end if;
  select * into v_c from public.organizational_units where id = p_club_id and type = 'clube';
  if not found then raise exception 'Clube não encontrado.'; end if;

  with
  mem as (
    select m.role, m.user_id from public.organization_memberships m
     where m.organizational_unit_id = p_club_id and m.status = 'ativo' and m.role <> 'pais'
       and m.starts_at <= now() and (m.ends_at is null or m.ends_at > now())
  ),
  uso as (
    select mem.user_id, greatest(au.last_sign_in_at,
             (select max(s.enviado_em) from public.requirement_submissions s where s.club_id = p_club_id and s.usuario_id = mem.user_id)) as quando
      from mem left join auth.users au on au.id = mem.user_id
  ),
  ap as (
    select (p.data at time zone 'America/Sao_Paulo')::date as dia, public._apontamento_presente(p.marca, p.pontos) as presente
      from public.pontos p
     where p.club_id = p_club_id and p.origem = 'apontamento' and p.data > now() - interval '70 days'
  ),
  dias as (
    select dia, count(*) filter (where presente) as presentes, count(*) as total from ap group by dia
  )
  select json_build_object(
    'clube', json_build_object('club_id', v_c.id, 'nome', v_c.nome, 'status', v_c.status,
        'marca', json_build_object('logo_url', nullif(v_c.metadata #>> '{marca,logo_url}', ''),
                                   'sigla', nullif(v_c.metadata #>> '{marca,sigla}', ''),
                                   'cor', nullif(v_c.metadata #>> '{marca,cor_primaria}', '')),
        'distrito', (select json_build_object('id', u.id, 'nome', u.nome) from public.organizational_units u
                      where u.id = public.unidade_ancestral(v_c.id, 'distrito')),
        'regiao', (select json_build_object('id', u.id, 'nome', u.nome) from public.organizational_units u
                    where u.id = public.unidade_ancestral(v_c.id, 'regiao'))),
    'membros', json_build_object(
        'total', (select count(*) from mem),
        'desbravadores', (select count(*) from mem where role = 'desbravador'),
        'lideranca', (select count(*) from mem where role <> 'desbravador'),
        'por_papel', coalesce((select json_object_agg(x.role, x.n) from (select role, count(*) as n from mem group by role) x), '{}'::json),
        -- tendência: membros com vínculo valendo no 1º dia do mês vs hoje (encerrados contam enquanto valiam)
        'inicio_do_mes', (select count(*) from public.organization_memberships m
                           where m.organizational_unit_id = p_club_id and m.role <> 'pais' and m.status <> 'pendente'
                             and m.starts_at <= v_mes::timestamptz and (m.ends_at is null or m.ends_at > v_mes::timestamptz)),
        'entraram_no_mes', (select count(*) from public.organization_memberships m
                             where m.organizational_unit_id = p_club_id and m.role <> 'pais' and m.status = 'ativo'
                               and m.starts_at >= v_mes::timestamptz and m.starts_at <= now()
                               and (m.ends_at is null or m.ends_at > now()))),
    'unidades', coalesce((select json_agg(json_build_object('id', un.id, 'nome', un.nome, 'cor', un.cor,
                                    'membros', (select count(*) from public.organization_memberships m
                                                 where m.organizational_unit_id = p_club_id and m.unidade_id = un.id and m.role <> 'pais'
                                                   and m.status = 'ativo' and m.starts_at <= now() and (m.ends_at is null or m.ends_at > now())))
                                  order by un.nome)
                           from public.unidades un where un.club_id = p_club_id), '[]'::json),
    'classes', coalesce((select json_agg(json_build_object('classe', x.nome, 'tipo', x.tipo, 'em_andamento', x.a, 'concluidas', x.c,
                                                           'investidas', x.i) order by x.tipo desc, x.ordem nulls last, x.nome) from (
                  select cls.nome, max(cls.tipo_classe) as tipo, min(cls.ordem) as ordem,
                         count(*) filter (where mc.status = 'em_andamento') as a,
                         count(*) filter (where mc.status in ('requisitos_concluidos', 'aguardando_revisao', 'apto_investidura')) as c,
                         count(*) filter (where mc.status = 'investida') as i
                    from public.member_classes mc join public.classes cls on cls.id = mc.class_id
                   where mc.club_id = p_club_id and mc.status <> 'cancelada'
                   group by cls.nome) x), '[]'::json),
    'avaliacoes_pendentes', (select count(*) from public.member_requirements r where r.club_id = p_club_id and r.status = 'aguardando_avaliacao')
                          + (select count(*) from public.member_specialty_requirements r where r.club_id = p_club_id and r.status = 'aguardando_avaliacao'),
    'cadastros_pendentes', (select count(*) from public.organization_memberships m where m.organizational_unit_id = p_club_id
                              and m.status = 'pendente' and m.ends_at is null),
    'presenca', json_build_object(
        'reunioes', coalesce((select json_agg(json_build_object('dia', d.dia, 'presentes', d.presentes, 'total', d.total,
                                                                'pct', round(100.0 * d.presentes / nullif(d.total, 0))) order by d.dia desc)
                                from (select * from dias order by dia desc limit 8) d), '[]'::json),
        'media_pct', (select round(100.0 * sum(presentes) / nullif(sum(total), 0)) from (select * from dias order by dia desc limit 8) d),
        'mes_atual_pct', (select round(100.0 * sum(presentes) / nullif(sum(total), 0)) from dias where dia >= v_mes),
        'mes_anterior_pct', (select round(100.0 * sum(presentes) / nullif(sum(total), 0)) from dias where dia >= v_mes_ant and dia < v_mes)),
    'atividade', json_build_object(
        'ativos_7d', (select count(*) from uso where quando > now() - interval '7 days'),
        'ativos_30d', (select count(*) from uso where quando > now() - interval '30 days'),
        'ultimo_uso', (select (max(quando) at time zone 'America/Sao_Paulo')::date from uso),
        'envios_30d', (select count(*) from public.requirement_submissions s where s.club_id = p_club_id and s.enviado_em > now() - interval '30 days')),
    -- agenda do clube: sem marcação de evento público → só data e contagem (sem título/local/descrição)
    'agenda', json_build_object(
        'proximo_evento', (select min(e.data) from public.eventos e where e.club_id = p_club_id and coalesce(e.data_fim, e.data) >= v_hoje),
        'eventos_30d', (select count(*) from public.eventos e where e.club_id = p_club_id
                          and coalesce(e.data_fim, e.data) >= v_hoje and e.data <= v_hoje + 30)),
    'investiduras', json_build_object(
        'previstas', (select count(*) from public.member_classes mc where mc.club_id = p_club_id and mc.status = 'apto_investidura'),
        'realizadas_mes', (select count(*) from public.class_investitures ci where ci.club_id = p_club_id and ci.status = 'registrada'
                             and ci.data_investidura >= v_mes and ci.data_investidura <= v_hoje),
        'realizadas_ano', (select count(*) from public.class_investitures ci where ci.club_id = p_club_id and ci.status = 'registrada'
                             and ci.data_investidura >= date_trunc('year', v_hoje)::date and ci.data_investidura <= v_hoje),
        'ultima', (select max(ci.data_investidura) from public.class_investitures ci where ci.club_id = p_club_id and ci.status = 'registrada')),
    'pendencias', json_build_object('pedido_regiao',
        exists (select 1 from public.club_hierarchy_requests r where r.club_id = p_club_id and r.status = 'pendente'))
  ) into v_res;
  return v_res;
end;
$$;
revoke all on function public.escopo_clube_detalhe(uuid) from public, anon;
grant execute on function public.escopo_clube_detalhe(uuid) to authenticated;

notify pgrst, 'reload schema';

insert into public.migracoes_aplicadas (arquivo)
values ('2026-09-30-portal-coordenacao-acompanhamento.sql')
on conflict (arquivo) do update set aplicada_em = now();
