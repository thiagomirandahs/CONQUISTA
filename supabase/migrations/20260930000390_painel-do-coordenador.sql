-- =============================================================================
--  Painel do coordenador — "Como estão meus clubes" (28/09).
--
--  Público: coordenação de distrito/região (muitos idosos, 100% no celular). A tela inicial nova
--  precisa, POR CLUBE, de poucos números simples:
--    - quantos desbravadores estão fazendo classe;
--    - % dos requisitos aprovados (nas classes em andamento);
--    - requisitos aprovados no período escolhido (mês / trimestre / ano);
--    - última vez que o clube AVANÇOU (início de classe, envio ou aprovação de requisito) e há quantos dias;
--    - visitas da coordenação: realizadas no ano, no período, data da última e da próxima.
--  E totais do escopo (clubes, visitados no ano, faltando visitar, parados > 30 dias).
--
--  escopo_resumo_coordenador(p_periodo text) — 'mes' | 'trimestre' | 'ano' (padrão 'mes').
--  Mesmo gate da migration 300 (_escopo_em_uso_com_painel: sessão + x-escopo-atual com vínculo ATIVO
--  + papel com painel) e mesma árvore (_clubes_descendentes). Sem escopo → {sem_escopo:true, clubes:[]}.
--
--  SÓ AGREGADO: sai o nome do clube (dado institucional, já público na vitrine) e contagens/datas.
--  NUNCA sai nome/foto de pessoa, dado de criança, chat, mensagens, evidências, financeiro, plano.
--  SECURITY DEFINER com search_path ''. Nenhuma policy nova. Não altera linha nenhuma. Idempotente.
-- =============================================================================

create or replace function public.escopo_resumo_coordenador(p_periodo text default 'mes') returns json
language plpgsql stable security definer set search_path = '' as $$
declare v_e record; v_res json; v_ini date; v_per text := coalesce(nullif(p_periodo, ''), 'mes');
  v_agora timestamp := (now() at time zone 'America/Sao_Paulo');
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_ano date := date_trunc('year', (now() at time zone 'America/Sao_Paulo'))::date;
begin
  if v_per not in ('mes', 'trimestre', 'ano') then raise exception 'Período inválido.'; end if;
  if auth.uid() is null then return json_build_object('sem_escopo', true, 'clubes', '[]'::json); end if;
  select * into v_e from public._escopo_em_uso_com_painel();
  if v_e.escopo is null then return json_build_object('sem_escopo', true, 'clubes', '[]'::json); end if;

  v_ini := case v_per when 'mes' then date_trunc('month', v_agora)::date
                      when 'trimestre' then date_trunc('quarter', v_agora)::date
                      else v_ano end;

  with
  cl as (
    select c.id, c.nome from public.organizational_units c
     where c.type = 'clube'
       and c.id in (select club_id from public._clubes_descendentes(v_e.escopo))
  ),
  mc as (   -- classes em andamento (ainda fazendo requisito)
    select m.id, m.club_id, m.usuario_id, m.class_id, m.iniciada_em from public.member_classes m join cl on cl.id = m.club_id
     where m.status = 'em_andamento'
  ),
  linhas as (
    select cl.id, cl.nome,
      (select count(distinct mc.usuario_id) from mc where mc.club_id = cl.id) as fazendo,
      (select count(*) from mc join public.class_sections s on s.class_id = mc.class_id
         join public.class_requirements r on r.section_id = s.id and r.ativo where mc.club_id = cl.id) as req_total,
      (select count(*) from public.member_requirements mr join mc on mc.id = mr.member_class_id
        where mc.club_id = cl.id and mr.status = 'aprovado') as req_aprov,
      (select count(*) from public.requirement_approvals a where a.club_id = cl.id and a.decisao = 'aprovado'
         and (a.created_at at time zone 'America/Sao_Paulo')::date >= v_ini) as aprov_periodo,
      greatest(
        (select max(m.iniciada_em) from public.member_classes m where m.club_id = cl.id),
        (select max(mr.enviado_em) from public.member_requirements mr where mr.club_id = cl.id),
        (select max(a.created_at) from public.requirement_approvals a where a.club_id = cl.id)) as ultimo_avanco,
      (select count(*) from public.club_visits v where v.club_id = cl.id and v.status = 'realizada'
         and (v.realizada_em at time zone 'America/Sao_Paulo')::date >= v_ano) as visitas_ano,
      (select count(*) from public.club_visits v where v.club_id = cl.id and v.status = 'realizada'
         and (v.realizada_em at time zone 'America/Sao_Paulo')::date >= v_ini) as visitas_periodo,
      (select max(v.realizada_em) from public.club_visits v where v.club_id = cl.id and v.status = 'realizada') as ultima_visita,
      (select min(v.agendada_para) from public.club_visits v where v.club_id = cl.id
         and v.status in ('agendada', 'confirmada') and v.agendada_para >= now() - interval '12 hours') as prox_visita
    from cl
  ),
  fim as (
    select l.*, case when l.ultimo_avanco is not null
                     then v_hoje - (l.ultimo_avanco at time zone 'America/Sao_Paulo')::date end as dias_parado
      from linhas l
  )
  select json_build_object(
    'periodo', v_per, 'desde', v_ini, 'hoje', v_hoje,
    'escopo', (select json_build_object('id', u.id, 'nome', u.nome, 'tipo', u.type)
                 from public.organizational_units u where u.id = v_e.escopo),
    'clubes', coalesce((select json_agg(json_build_object(
        'club_id', f.id, 'nome', f.nome,
        'desbravadores_em_classe', f.fazendo,
        'requisitos_total', f.req_total, 'requisitos_aprovados', least(f.req_aprov, f.req_total),
        'requisitos_pct', case when f.req_total > 0 then least(100, round(100.0 * f.req_aprov / f.req_total))::int end,
        'aprovados_no_periodo', f.aprov_periodo,
        'ultimo_avanco', (f.ultimo_avanco at time zone 'America/Sao_Paulo')::date,
        'dias_sem_avancar', f.dias_parado,
        'parado', (f.dias_parado is null or f.dias_parado > 30),
        'visitas_ano', f.visitas_ano, 'visitas_periodo', f.visitas_periodo,
        'ultima_visita', (f.ultima_visita at time zone 'America/Sao_Paulo')::date,
        'proxima_visita', (f.prox_visita at time zone 'America/Sao_Paulo')::date
      ) order by f.nome) from fim f), '[]'::json),
    'totais', (select json_build_object(
        'clubes', count(*),
        'desbravadores_em_classe', coalesce(sum(fazendo), 0),
        'requisitos_pct', case when sum(req_total) > 0 then least(100, round(100.0 * sum(least(req_aprov, req_total)) / sum(req_total)))::int end,
        'aprovados_no_periodo', coalesce(sum(aprov_periodo), 0),
        'clubes_parados', count(*) filter (where dias_parado is null or dias_parado > 30),
        'visitados_ano', count(*) filter (where visitas_ano > 0),
        'faltando_visitar_ano', count(*) filter (where visitas_ano = 0),
        'visitas_periodo', coalesce(sum(visitas_periodo), 0))
      from fim)
  ) into v_res;
  return v_res;
end;
$$;
revoke all on function public.escopo_resumo_coordenador(text) from public, anon;
grant execute on function public.escopo_resumo_coordenador(text) to authenticated;

notify pgrst, 'reload schema';

insert into public.migracoes_aplicadas (arquivo)
values ('2026-09-30-painel-do-coordenador.sql')
on conflict (arquivo) do update set aplicada_em = now();
